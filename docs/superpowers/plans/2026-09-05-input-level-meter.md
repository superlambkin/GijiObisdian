# 入力レベルメーター実装計画（マイク + PC音声 WASAPI ループバック）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 録音モード「マイク + PC音声（WASAPI ループバック）」で、マイクとスピーカー（PC音声）それぞれの入力レベルをステータスバーのアニメーションメーターで確認できるようにする（録音前チェック + 録音中）。

**Architecture:** マイクは renderer 内 `AnalyserNode` で RMS 算出。PC音声は Python サブプロセス（`pc_loopback_capture.py`）が 0.1 秒ごとに RMS/peak を stdout に JSON 行で出力し、Node 側で行パースして UI へ中継。録音前チェックは同じ Python スクリプトの `--monitor` モード（WAV 書き出しスキップ）を使い、設定画面の「🎤 入力テスト」ボタンから起動する。

**Tech Stack:** Python 3.10+（soundcard, numpy, pytest）/ TypeScript（Obsidian Plugin API, node:test + tsx, esbuild）

**設計書:** `docs/superpowers/specs/2026-09-05-input-level-meter-design.md`

## Global Constraints

- 既存の引数契約を壊さない: `pc_loopback_capture.py <出力WAVパス> [スピーカーデバイスID]` は従来どおり動作すること（`--monitor` は追加オプション）
- `PC_LOOPBACK_ERROR:`（stderr）と終了コード契約は変更しない
- `PcLoopbackCaptureHandle.stop()` の契約（WAV パス解決）は不変
- TS テストは `npm test`（node:test + tsx + `src/__tests__/setup.cjs`）。obsidian モジュールは setup.cjs のスタブで置換される
- Python テストは `recorder-bridge` の venv で `venv/Scripts/python.exe -m pytest tests/ -v`
- DOM 依存のクラスは既存パターン（fake el、DI deps）でテストする。jsdom は使わない
- CSS クラスは `giji-level-` プレフィックス。スタイル注入は `recordingStyles.ts` の `injectRecordingStyles()` と同じガードパターン
- 録音中は録音を優先し、録音中に入力テストは開始できない（LevelMonitor のガード）
- deps の DI はすべてオプショナルで既定は実機実装（既存 `DirectRecorderDeps` 方針を踏襲）

---

### Task 1: Python `--monitor` モード + レベル計算

**Files:**
- Modify: `recorder-bridge/pc_loopback_capture.py`
- Test: `recorder-bridge/tests/test_pc_loopback_capture.py`

**Interfaces:**
- Consumes: なし（既存 `_capture` / `main` を拡張）
- Produces:
  - `compute_level(data: np.ndarray) -> dict` — `{"rms": float, "peak": float}`（round 4 桁、空配列は 0）
  - `parse_args(argv: list[str]) -> argparse.Namespace` — `out_path` / `speaker_id` / `monitor`
  - stdout 行: `{"type": "level", "rms": ..., "peak": ...}`（0.1 秒ごと・flush 付き）
  - `--monitor` 時は WAV を書き出さない（`out_path` は無視される）

- [ ] **Step 1: 失敗するテストを書く**

`recorder-bridge/tests/test_pc_loopback_capture.py` を新規作成:

```python
"""pc_loopback_capture のレベル計算・--monitor モードのテスト。"""
import argparse
import contextlib
import json
import threading

import numpy as np

import pc_loopback_capture as m


# ---- compute_level（純関数） ----

def test_compute_level_sine():
    """振幅 0.5 の正弦波 → rms≈0.354・peak=0.5"""
    t = np.linspace(0, 1, 1600, endpoint=False)
    data = (0.5 * np.sin(2 * np.pi * 440 * t)).reshape(-1, 1)
    level = m.compute_level(data)
    assert abs(level["rms"] - 0.5 / np.sqrt(2)) < 0.001
    assert abs(level["peak"] - 0.5) < 0.001


def test_compute_level_silence():
    level = m.compute_level(np.zeros((1600, 2), dtype=np.float32))
    assert level["rms"] == 0.0
    assert level["peak"] == 0.0


def test_compute_level_empty():
    level = m.compute_level(np.zeros((0, 2), dtype=np.float32))
    assert level["rms"] == 0.0
    assert level["peak"] == 0.0


# ---- parse_args ----

def test_parse_args_legacy_format():
    """従来形式（out_path + speaker_id）は互換維持"""
    args = m.parse_args(["C:/out.wav", "dev123"])
    assert args.out_path == "C:/out.wav"
    assert args.speaker_id == "dev123"
    assert args.monitor is False


def test_parse_args_monitor_flag():
    args = m.parse_args(["C:/mon.wav", "--monitor"])
    assert args.out_path == "C:/mon.wav"
    assert args.speaker_id is None
    assert args.monitor is True


# ---- --monitor モード ----

class _FakeRec:
    """2 回 record したら停止イベントをセットするフェイクレコーダ。"""

    def __init__(self, ev: threading.Event):
        self.ev = ev
        self.calls = 0

    def record(self, numframes: int):
        self.calls += 1
        if self.calls >= 2:
            self.ev.set()
        return np.full((numframes, 2), 0.25, dtype=np.float32)


class _FakeSpk:
    def __init__(self, ev: threading.Event):
        self.ev = ev

    def recorder(self, samplerate, channels):
        return contextlib.nullcontext(_FakeRec(self.ev))


def test_capture_monitor_emits_level_and_skips_wav(tmp_path, capsys, monkeypatch):
    """--monitor は WAV を書かずレベル JSON 行を出す"""
    ev = threading.Event()
    monkeypatch.setattr(m.sc, "get_microphone", lambda *a, **k: _FakeSpk(ev))

    def _boom(*a, **k):  # wave.open が呼ばれたら失敗
        raise AssertionError("monitor モードで WAV を書き出した")

    monkeypatch.setattr(m.wave, "open", _boom)

    m._capture(str(tmp_path / "ignored.wav"), None, ev, monitor=True)

    lines = [l for l in capsys.readouterr().out.splitlines() if l.strip()]
    assert len(lines) >= 2
    for line in lines:
        obj = json.loads(line)
        assert obj["type"] == "level"
        assert isinstance(obj["rms"], float)
        assert isinstance(obj["peak"], float)
        assert abs(obj["rms"] - 0.25) < 0.001
        assert abs(obj["peak"] - 0.25) < 0.001


def test_capture_normal_mode_does_not_emit_level(tmp_path, capsys, monkeypatch):
    """従来モード（monitor=False）ではレベル行を出さない（stdout 契約を壊さない）"""
    ev = threading.Event()
    monkeypatch.setattr(m.sc, "get_microphone", lambda *a, **k: _FakeSpk(ev))

    written = {}

    class _FakeWave:
        def __init__(self):
            self._frames = []

        def setnchannels(self, n):
            written["ch"] = n

        def setsampwidth(self, w):
            written["w"] = w

        def setframerate(self, r):
            written["r"] = r

        def writeframes(self, b):
            written["bytes"] = len(b)

    ctx = contextlib.nullcontext(_FakeWave())
    monkeypatch.setattr(m.wave, "open", lambda *a, **k: ctx)

    m._capture(str(tmp_path / "out.wav"), None, ev, monitor=False)

    assert capsys.readouterr().out.strip() == ""
    assert written["bytes"] > 0
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd D:/AI-Agent/GijiObsidian/recorder-bridge && venv/Scripts/python.exe -m pytest tests/test_pc_loopback_capture.py -v`
Expected: FAIL（`compute_level` / `parse_args` / `monitor` 引数が未定義・`_capture` に `monitor` 引数がない）

- [ ] **Step 3: 最小実装**

`pc_loopback_capture.py` を以下のように変更する:

```python
"""PC 音声（WASAPI ループバック）を単体で WAV ファイルへキャプチャするスクリプト。

直接録音（DirectRecorder）が PC 音声を取得するための補助プロセスとして使う。
- 引数: <出力WAVパス> [スピーカーデバイスID] [--monitor]
- 終了: SIGTERM / SIGINT / stdin が閉じられるまでループバックを録音し、終了時に WAV を書き出す
- --monitor: WAV を書き出さず、0.1 秒ごとの入力レベルを stdout に JSON 行で出力する
  （入力テスト用。行形式: {"type": "level", "rms": ..., "peak": ...}）
import argparse
import json
import signal
import sys
import threading
import wave

import numpy as np
import soundcard as sc

import config


def compute_level(data: np.ndarray) -> dict:
    """float 音声フレーム（-1..1 正規化）から RMS と peak を計算する。"""
    if data.size == 0:
        return {"rms": 0.0, "peak": 0.0}
    rms = float(np.sqrt(np.mean(np.square(data))))
    peak = float(np.max(np.abs(data)))
    return {"rms": round(rms, 4), "peak": round(peak, 4)}


def _emit_level(pcm_float: np.ndarray) -> None:
    """現在チャンクのレベルを stdout へ 1 行 JSON で出力する（flush 必須）。"""
    print(json.dumps({"type": "level", **compute_level(pcm_float)}), flush=True)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="WASAPI ループバック PC 音声キャプチャ")
    parser.add_argument("out_path", nargs="?", default="pc_loopback.wav")
    parser.add_argument("speaker_id", nargs="?", default=None)
    parser.add_argument(
        "--monitor", action="store_true",
        help="WAV を書き出さず、入力レベルを stdout に出力し続ける（入力テスト用）",
    )
    return parser.parse_args(argv)


def _capture(out_path: str, speaker_id: str | None, stop_event: threading.Event,
             monitor: bool = False) -> None:
    """スピーカー（ループバック）を録音する。monitor 時は WAV を書き出さない。"""
    if speaker_id:
        spk = sc.get_microphone(speaker_id, include_loopback=True)
    else:
        spk = sc.get_microphone(sc.default_speaker().id, include_loopback=True)

    frames: list[np.ndarray] = []
    # 0.1 秒 / チャンク（16kHz）
    with spk.recorder(samplerate=config.SAMPLE_RATE, channels=config.CHANNELS) as rec:
        while not stop_event.is_set():
            data = rec.record(numframes=1600)
            if monitor:
                _emit_level(data)
                continue
            pcm = (data * 32767).clip(-32768, 32767).astype(np.int16)
            frames.append(pcm)

    if monitor:
        return

    audio = (
        np.concatenate(frames, axis=0).astype(np.int16)
        if frames
        else np.zeros((0, config.CHANNELS), dtype=np.int16)
    )
    with wave.open(out_path, "wb") as wf:
        wf.setnchannels(config.CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(config.SAMPLE_RATE)
        wf.writeframes(audio.tobytes())


def main() -> int:
    args = parse_args(sys.argv[1:])

    stop_event = threading.Event()

    def _handler(signum, frame):
        stop_event.set()

    signal.signal(signal.SIGTERM, _handler)
    signal.signal(signal.SIGINT, _handler)

    # stdin が閉じられたら（親プロセスが消えたら）終了する監視スレッド
    def _stdin_watch():
        try:
            sys.stdin.read()
        except Exception:
            pass
        finally:
            stop_event.set()

    watcher = threading.Thread(target=_stdin_watch, daemon=True)
    watcher.start()

    try:
        _capture(args.out_path, args.speaker_id, stop_event, monitor=args.monitor)
    except Exception as e:  # noqa: BLE001 — プロセス終了コードで異常を伝える
        print(f"PC_LOOPBACK_ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd D:/AI-Agent/GijiObsidian/recorder-bridge && venv/Scripts/python.exe -m pytest tests/test_pc_loopback_capture.py -v`
Expected: PASS（全 7 件）

- [ ] **Step 5: 既存テストの回帰確認**

Run: `cd D:/AI-Agent/GijiObsidian/recorder-bridge && venv/Scripts/python.exe -m pytest tests/ -v`
Expected: PASS（既存 test_bridge.py / test_audio_source.py も含めて全緑。pytest が足りない場合は `venv/Scripts/python.exe -m pip install pytest`）

- [ ] **Step 6: コミット**

```bash
cd D:/AI-Agent/GijiObsidian
git add recorder-bridge/pc_loopback_capture.py recorder-bridge/tests/test_pc_loopback_capture.py
git commit -m "feat(python): pc_loopback_capture に --monitor モードとレベル出力追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: TS stdout 行パーサ + spawn 変更（pipe 化・onLevel・monitor 引数）

**Files:**
- Modify: `obsidian-plugin/src/audio/directRecorder.ts`
- Test: `obsidian-plugin/src/__tests__/levelLineParser.test.ts`（新規）

**Interfaces:**
- Consumes: なし（Task 1 の stdout 行形式 `{"type":"level","rms":number,"peak":number}` を消費）
- Produces:
  - `export type PcLevel = { rms: number; peak: number }`
  - `export type PcLevelListener = (level: PcLevel) => void`
  - `export class LevelLineParser { constructor(onLevel: PcLevelListener, onOther?: (line: string) => void); push(chunk: string): void }`
  - `PcLoopbackCaptureHandle` に `onLevel(cb: PcLevelListener): void` を追加（複数登録可・登録順に通知）
  - `DirectRecorderDeps.spawnPcLoopbackCapture` の第 5 引数に `monitor?: boolean` を追加（true で `--monitor` フラグを渡す）。既存呼び出し（引数 4 個）は互換

- [ ] **Step 1: 失敗するテストを書く**

`obsidian-plugin/src/__tests__/levelLineParser.test.ts` を新規作成:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { LevelLineParser } from "../audio/directRecorder";

test("1 行のレベル JSON を onLevel に通知する", () => {
  const got: unknown[] = [];
  const p = new LevelLineParser((l) => got.push(l));
  p.push('{"type": "level", "rms": 0.05, "peak": 0.12}\n');
  assert.deepEqual(got, [{ rms: 0.05, peak: 0.12 }]);
});

test("行がチャンク境界で分断されても正しくパースする", () => {
  const got: unknown[] = [];
  const p = new LevelLineParser((l) => got.push(l));
  p.push('{"type": "level", "r');
  p.push('ms": 0.1, "peak": 0.2}\n{"type": "le');
  p.push('vel", "rms": 0.3, "peak": 0.4}\n');
  assert.deepEqual(got, [
    { rms: 0.1, peak: 0.2 },
    { rms: 0.3, peak: 0.4 },
  ]);
});

test("複数行を 1 チャンクで受けても全行通知する", () => {
  const got: unknown[] = [];
  const p = new LevelLineParser((l) => got.push(l));
  p.push('{"type":"level","rms":0.1,"peak":0.1}\n{"type":"level","rms":0.2,"peak":0.2}\n');
  assert.equal(got.length, 2);
});

test("不正 JSON・type 相違・数値欠落の行は無視する", () => {
  const got: unknown[] = [];
  const p = new LevelLineParser((l) => got.push(l));
  p.push("not json\n");
  p.push('{"foo": 1}\n');
  p.push('{"type":"level","rms":"x","peak":0.1}\n');
  p.push('{"type":"level","rms":0.5}\n');
  assert.deepEqual(got, []);
});

test("非レベル行は onOther に渡る（診断ログ用）", () => {
  const got: unknown[] = [];
  const others: string[] = [];
  const p = new LevelLineParser((l) => got.push(l), (line) => others.push(line));
  p.push("PC_LOOPBACK_TRACE: hello\n");
  p.push('{"type":"level","rms":0.1,"peak":0.1}\n');
  assert.equal(others.length, 1);
  assert.equal(got.length, 1);
});

test("空行・空白のみの行は無視する", () => {
  const got: unknown[] = [];
  const others: string[] = [];
  const p = new LevelLineParser((l) => got.push(l), (l) => others.push(l));
  p.push("\n   \n");
  assert.deepEqual(got, []);
  assert.deepEqual(others, []);
});

test("異常膨張ガード: 改行のない巨大チャンクでバッファ先頭を破棄する", () => {
  const got: unknown[] = [];
  const p = new LevelLineParser((l) => got.push(l));
  // 70KB の改行なし garbage → バッファは 4096 文字に丸められる
  p.push("x".repeat(70 * 1024));
  // 直後に正常行を流してもパースできる（バッファが壊れていない）
  p.push('{"type":"level","rms":0.1,"peak":0.1}\n');
  assert.deepEqual(got, [{ rms: 0.1, peak: 0.1 }]);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npx tsx --require ./src/__tests__/setup.cjs --test src/__tests__/levelLineParser.test.ts`
Expected: FAIL（`LevelLineParser` がエクスポートされていない）

- [ ] **Step 3: 最小実装**

`directRecorder.ts` に以下を追加（`PcLoopbackCaptureHandle` 定義の近く・ファイル上部）:

```ts
/** v0.15: PC 音声（WASAPI）の入力レベル。rms/peak は -1..1 正規化振幅 */
export type PcLevel = { rms: number; peak: number };

/** v0.15: レベルイベントの購読コールバック */
export type PcLevelListener = (level: PcLevel) => void;

/**
 * v0.15: Python stdout の行バッファリング + レベル JSON 行パーサ。
 * 改行で分割し、`{"type":"level","rms":...,"peak":...}` 形式のみ onLevel へ通知する。
 * それ以外の行は onOther（診断ログ用）へ渡す。改行がこない壊れた出力に備え、
 * バッファが 64KB を超えたら先頭を破棄する。
 */
export class LevelLineParser {
  private buffer = "";

  constructor(
    private onLevel: PcLevelListener,
    private onOther?: (line: string) => void
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 65536) {
      this.buffer = this.buffer.slice(-4096);
    }
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const obj = JSON.parse(trimmed) as {
        type?: string;
        rms?: unknown;
        peak?: unknown;
      };
      if (
        obj?.type === "level" &&
        typeof obj.rms === "number" &&
        typeof obj.peak === "number"
      ) {
        this.onLevel({ rms: obj.rms, peak: obj.peak });
        return;
      }
    } catch {
      // JSON でない行 → 診断ログへ
    }
    this.onOther?.(line);
  }
}
```

`PcLoopbackCaptureHandle` を変更:

```ts
/** v0.11: WASAPI ループバック PC 音声キャプチャのハンドル。stop() で WAV パスを返す */
export interface PcLoopbackCaptureHandle {
  stop(): Promise<string>;
  /** v0.15: stdout レベルイベント（JSON 行）の購読。複数回呼ぶと全リスナーに通知 */
  onLevel(cb: PcLevelListener): void;
}
```

`DirectRecorderDeps.spawnPcLoopbackCapture` のシグネチャに `monitor` を追加:

```ts
  /** v0.11: PC 音声（WASAPI ループバック）をサブプロセスでキャプチャする。不可なら null */
  spawnPcLoopbackCapture?: (
    outPath: string,
    speakerDeviceId: string,
    scriptDir: string,
    /** v0.13: サブプロセスの stderr/stdout/exit code を記録する診断ロガー */
    log?: PcLoopbackLogFn,
    /** v0.15: true で --monitor モード（WAV 書き出しなし・レベル出力のみ）。入力テスト用 */
    monitor?: boolean
  ) => Promise<PcLoopbackCaptureHandle | null>;
```

`defaultSpawnPcLoopbackCapture` を以下のように変更（stdout を pipe にしてパーサ接続）:

```ts
const defaultSpawnPcLoopbackCapture = async (
  outPath: string,
  speakerDeviceId: string,
  scriptDir: string,
  log: PcLoopbackLogFn = async () => {},
  monitor = false
): Promise<PcLoopbackCaptureHandle | null> => {
  const scriptPath = scriptDir ? join(scriptDir, "pc_loopback_capture.py") : null;
  if (!scriptPath) return null;

  const args = [scriptPath, outPath];
  // "default" は soundcard のデバイスIDではないため、渡さない（Python 側で既定スピーカー使用）
  if (speakerDeviceId && speakerDeviceId !== "default") args.push(speakerDeviceId);
  if (monitor) args.push("--monitor");

  const levelListeners: PcLevelListener[] = [];

  const pythonCandidates = scriptDir
    ? [join(scriptDir, "venv", "Scripts", "python.exe"), "python", "py"]
    : ["python", "py"];

  for (const py of pythonCandidates) {
    try {
      // v0.13: 候補ごとに選択状況と起動コマンドを記録（真因究明用）
      log("spawn_try", { py, args, outPath, scriptDir, monitor });
      const child = nodeSpawn(py, args, {
        // v0.15: stdout を pipe に変更（レベル JSON 行の受信のため。従来は ignore）
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      // v0.15: stdout は行パーサへ。レベル行以外のみ診断ログに流す（レベルは 0.1 秒ごとに来るため全文ログはスパムになる）
      const parser = new LevelLineParser(
        (level) => levelListeners.forEach((cb) => cb(level)),
        (line) => log("stdout", { py, line })
      );
      child.stdout?.on("data", (chunk: Buffer) => {
        parser.push(chunk.toString("utf-8"));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        log("stderr", { py, chunk: chunk.toString("utf-8") });
      });
      child.on("error", (err) => {
        log("spawn_error", { py, message: err.message, code: (err as any).code });
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", () => {
          log("spawn_ok", { py, pid: child.pid });
          resolve();
        });
        child.once("error", (err) => {
          log("spawn_reject", { py, message: err.message });
          reject(err);
        });
      });
      child.on("exit", (code, signal) => {
        log("exit", { py, code, signal });
      });
      return {
        onLevel: (cb: PcLevelListener) => {
          levelListeners.push(cb);
        },
        stop: () =>
          new Promise<string>((resolve) => {
            let settled = false;
            const done = () => {
              if (!settled) {
                settled = true;
                log("stop_resolve", { outPath });
                resolve(outPath);
              }
            };
            child.on("exit", done);
            try {
              child.stdin.end();
              log("stop_stdin_end", { outPath });
            } catch (e: any) {
              log("stop_stdin_end_error", { outPath, message: e?.message });
            }
            // 安全のためのタイムアウト（WAV 書き出しに時間がかかる場合に備える）
            setTimeout(() => {
              log("stop_timeout", { outPath, timeoutMs: 5000 });
              done();
            }, 5000).unref?.();
          }),
      };
    } catch (e: any) {
      // この Python 候補で起動できない → 次の候補へ
      log("spawn_try_fail", { py, message: e?.message });
    }
  }
  log("spawn_all_candidates_failed", { pythonCandidates });
  return null;
};
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npx tsx --require ./src/__tests__/setup.cjs --test src/__tests__/levelLineParser.test.ts`
Expected: PASS（全 7 件）

- [ ] **Step 5: 既存テストの回帰確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npm test`
Expected: PASS（既存 directRecorder.test.ts 等を含め全緑。`spawnPcLoopbackCapture` の既存 fake は引数 4 個以下で呼ばれるため互換）

- [ ] **Step 6: コミット**

```bash
cd D:/AI-Agent/GijiObsidian
git add obsidian-plugin/src/audio/directRecorder.ts obsidian-plugin/src/__tests__/levelLineParser.test.ts
git commit -m "feat(plugin): WASAPI キャプチャ stdout のレベル行パーサと monitor 引数追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: LevelMeter UI（ステータスバー・アニメーションバー）

**Files:**
- Create: `obsidian-plugin/src/ui/levelMeter.ts`
- Test: `obsidian-plugin/src/__tests__/levelMeter.test.ts`

**Interfaces:**
- Consumes: `PcLevel`（Task 2 で定義。`import type { PcLevel } from "../audio/directRecorder"`）
- Produces:
  - `export type MeterSource = "mic" | "pc"`
  - `export function rmsToWidthPercent(rms: number): number` — dB 変換（下限 -60dB）→ 0〜100%
  - `export function levelColorClass(widthPercent: number): string` — ≥90 red / ≥80 yellow / その他 green
  - `export class LevelMeter { constructor(el: HTMLElement); setLevel(source: MeterSource, level: PcLevel): void; setUnavailable(source: MeterSource): void; show(): void; hide(): void; destroy(): void }`
  - `export function injectLevelMeterStyles(): void`
- DOM 使用メソッドは `createDiv` / `createSpan` / `show` / `hide` / `remove` のみ（fake el でテスト可能にするため）

- [ ] **Step 1: 失敗するテストを書く**

`obsidian-plugin/src/__tests__/levelMeter.test.ts` を新規作成:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { LevelMeter, levelColorClass, rmsToWidthPercent } from "../ui/levelMeter";

function makeFakeEl(): any {
  const el: any = {
    children: [] as any[],
    style: {} as Record<string, string>,
    className: "",
    textContent: "",
    removed: false,
    shown: true,
    createDiv() {
      const c = makeFakeEl();
      el.children.push(c);
      return c;
    },
    createSpan() {
      const c = makeFakeEl();
      el.children.push(c);
      return c;
    },
    show() {
      el.shown = true;
    },
    hide() {
      el.shown = false;
    },
    remove() {
      el.removed = true;
    },
  };
  return el;
}

// ---- 純関数 ----

test("rmsToWidthPercent: フルスケール(rms=1)は 100%", () => {
  assert.equal(rmsToWidthPercent(1), 100);
});

test("rmsToWidthPercent: 無音(rms=0)は 0%", () => {
  assert.equal(rmsToWidthPercent(0), 0);
});

test("rmsToWidthPercent: -6dB(rms≈0.5)は約 90%", () => {
  assert.ok(Math.abs(rmsToWidthPercent(0.5) - 89.97) < 0.1);
});

test("rmsToWidthPercent: -60dB 以下は 0% にクランプ", () => {
  assert.equal(rmsToWidthPercent(0.0001), 0);
});

test("levelColorClass: 閾値で緑/黄/赤を切替", () => {
  assert.equal(levelColorClass(50), "giji-level-green");
  assert.equal(levelColorClass(80), "giji-level-yellow");
  assert.equal(levelColorClass(85), "giji-level-yellow");
  assert.equal(levelColorClass(90), "giji-level-red");
  assert.equal(levelColorClass(100), "giji-level-red");
});

// ---- DOM 挙動（fake el） ----

test("コンストラクタで 🎤/🔊 の 2 本バーを生成し非表示で始まる", () => {
  const el = makeFakeEl();
  const meter = new LevelMeter(el);
  assert.equal(el.shown, false); // 初期は hide
  assert.equal(el.children.length, 1); // root div
  const root = el.children[0];
  // root の中身: 🎤 icon + bar(fill) + 🔊 icon + bar(fill) = 4 要素
  assert.equal(root.children.length, 4);
  meter.destroy();
  assert.equal(root.removed, true);
});

test("setLevel がバー幅と色クラスを更新する", () => {
  const el = makeFakeEl();
  const meter = new LevelMeter(el);
  const root = el.children[0];
  const micFill = root.children[1].children[0];
  meter.setLevel("mic", { rms: 1, peak: 1 });
  assert.equal(micFill.style.width, "100.0%");
  assert.ok(micFill.className.includes("giji-level-red"));
  meter.setLevel("mic", { rms: 0.0001, peak: 0 });
  assert.ok(micFill.className.includes("giji-level-green"));
  meter.destroy();
});

test("setUnavailable が灰色クラスに切替、setLevel で復帰する", () => {
  const el = makeFakeEl();
  const meter = new LevelMeter(el);
  const root = el.children[0];
  const pcFill = root.children[3].children[0];
  meter.setUnavailable("pc");
  assert.ok(pcFill.className.includes("giji-level-unavailable"));
  meter.setLevel("pc", { rms: 0.1, peak: 0.1 });
  assert.ok(!pcFill.className.includes("giji-level-unavailable"));
  meter.destroy();
});

test("show/hide がコンテナの表示を制御する", () => {
  const el = makeFakeEl();
  const meter = new LevelMeter(el);
  assert.equal(el.shown, false);
  meter.show();
  assert.equal(el.shown, true);
  meter.hide();
  assert.equal(el.shown, false);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npx tsx --require ./src/__tests__/setup.cjs --test src/__tests__/levelMeter.test.ts`
Expected: FAIL（`../ui/levelMeter` が存在しない）

- [ ] **Step 3: 最小実装**

`obsidian-plugin/src/ui/levelMeter.ts` を新規作成:

```ts
import type { PcLevel } from "../audio/directRecorder";

/** v0.15: メーターの計測源。mic=録音マイク / pc=スピーカー（ループバック） */
export type MeterSource = "mic" | "pc";

/**
 * v0.15: RMS をメーターバー幅（0〜100%）へ変換する。
 * dB スケール（下限 -60dB）で変換し、知覚的に自然な動きにする。
 * - rms=1（フルスケール）→ 100%
 * - rms<=0.001（-60dB 以下・無音含む）→ 0%
 */
export function rmsToWidthPercent(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-9));
  const clamped = Math.min(0, Math.max(-60, db));
  return ((clamped + 60) / 60) * 100;
}

/** v0.15: バー幅（%）から色クラスを決める。-12dB=80% / -6dB=90% を閾値にする */
export function levelColorClass(widthPercent: number): string {
  if (widthPercent >= 90) return "giji-level-red";
  if (widthPercent >= 80) return "giji-level-yellow";
  return "giji-level-green";
}

export const LEVEL_METER_CSS = `
.giji-level-meter {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
}
.giji-level-icon {
  font-size: 10px;
}
.giji-level-bar {
  width: 60px;
  height: 8px;
  background: var(--background-modifier-cover, #ccc);
  border-radius: 4px;
  overflow: hidden;
  margin: 0 4px;
}
.giji-level-fill {
  height: 100%;
  width: 0%;
  transition: width 0.1s linear;
  border-radius: 4px;
}
.giji-level-green { background: #4caf50; }
.giji-level-yellow { background: #ffb300; }
.giji-level-red { background: #e53935; }
.giji-level-unavailable { background: #999; }
`;

/** recordingStyles.injectRecordingStyles と同じガードパターンで 1 回だけ注入する */
export function injectLevelMeterStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("giji-level-meter-styles")) return;
  const style = document.createElement("style");
  style.id = "giji-level-meter-styles";
  style.textContent = LEVEL_METER_CSS;
  document.head.appendChild(style);
}

/**
 * v0.15: ステータスバーに 🎤 / 🔊 の 2 本の入力レベルバーを表示する。
 * CSS transition（0.1s linear）でアニメーションする。録音中と入力テストで共用する。
 */
export class LevelMeter {
  private root: HTMLElement;
  private fills = new Map<MeterSource, HTMLElement>();
  private unavailable = new Set<MeterSource>();

  constructor(private el: HTMLElement) {
    this.root = el.createDiv();
    this.root.className = "giji-level-meter";
    this.fills.set("mic", this.buildBar("🎤", "mic"));
    this.fills.set("pc", this.buildBar("🔊", "pc"));
    el.hide();
  }

  private buildBar(icon: string, source: MeterSource): HTMLElement {
    const iconEl = this.root.createSpan();
    iconEl.className = "giji-level-icon";
    iconEl.textContent = icon;
    const bar = this.root.createDiv();
    bar.className = "giji-level-bar";
    const fill = bar.createDiv();
    fill.className = `giji-level-fill giji-level-${source} giji-level-green`;
    fill.style.width = "0%";
    return fill;
  }

  /** レベル更新。width を書き換え、色を閾値で切替。unavailable 状態から復帰する */
  setLevel(source: MeterSource, level: PcLevel): void {
    const fill = this.fills.get(source);
    if (!fill) return;
    this.unavailable.delete(source);
    const width = rmsToWidthPercent(level.rms);
    fill.style.width = `${width.toFixed(1)}%`;
    fill.className = `giji-level-fill giji-level-${source} ${levelColorClass(width)}`;
  }

  /** レベルが取得できない源（Python 無応答等）を灰色表示にする。冪等 */
  setUnavailable(source: MeterSource): void {
    const fill = this.fills.get(source);
    if (!fill || this.unavailable.has(source)) return;
    this.unavailable.add(source);
    fill.className = `giji-level-fill giji-level-${source} giji-level-unavailable`;
  }

  show(): void {
    this.el.show();
  }

  hide(): void {
    this.el.hide();
  }

  destroy(): void {
    this.root.remove();
    this.fills.clear();
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npx tsx --require ./src/__tests__/setup.cjs --test src/__tests__/levelMeter.test.ts`
Expected: PASS（全 9 件）

- [ ] **Step 5: コミット**

```bash
cd D:/AI-Agent/GijiObsidian
git add obsidian-plugin/src/ui/levelMeter.ts obsidian-plugin/src/__tests__/levelMeter.test.ts
git commit -m "feat(plugin): ステータスバー入力レベルメーター UI 追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: DirectRecorder の録音中レベル供給（AnalyserNode + stdout 中継）

**Files:**
- Modify: `obsidian-plugin/src/audio/directRecorder.ts`
- Test: `obsidian-plugin/src/__tests__/directRecorder.test.ts`（既存ファイルに追記）

**Interfaces:**
- Consumes: `PcLevel` / `PcLoopbackCaptureHandle.onLevel`（Task 2）
- Produces:
  - `DirectRecorderDeps` に追加（いずれも省略可・既定は実機実装）:
    - `onStreamLevel?: (source: "mic" | "pc", level: PcLevel) => void` — 録音中のレベル通知先
    - `setInterval?: typeof setInterval` / `clearInterval?: typeof clearInterval` — レベル polling タイマー（テスト DI 用）
  - `export function computeRmsLevel(data: Float32Array): PcLevel` — 純関数
  - `DirectRecorder.start()` 成功時にレベル計測を開始、`stop()`・失敗パスで停止（ベストエフォート: AudioContext 非対応なら計測せず録音は続行）
- 重要: AnalyserNode 用 AudioContext は既存 `this.audioCtx` を再利用する（mix 時は mixStreams が生成済み。単独時はここで生成し、既存 `releaseSources()` が close する）

- [ ] **Step 1: 失敗するテストを書く**

`directRecorder.test.ts` に追記。まず既存 `makeDeps` の戻り値オブジェクトに新しいデフォルトを追加する（`spawnPcLoopbackCapture: async () => null,` の直後に挿入。**これを忘れると既存テストが `deps.setInterval undefined` で落ちる**）:

```ts
    onStreamLevel: () => {},
    setInterval: (fn: any, ms?: number) => setInterval(fn, ms),
    clearInterval: (h: any) => clearInterval(h),
```

次にテスト本体を追記（既存 `FakeAudioContext` はそのまま使う）:

```ts
// ---- v0.15: 入力レベル計測 ----

/** AnalyserNode を返す FakeAudioContext（既存 FakeAudioContext を継承的に使う） */
class FakeAnalyserAudioContext extends FakeAudioContext {
  static frame: Float32Array | null = null;
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createAnalyser() {
    const self = this;
    return {
      fftSize: 1024,
      getFloatTimeDomainData(buf: Float32Array) {
        if (FakeAnalyserAudioContext.frame) buf.set(FakeAnalyserAudioContext.frame);
        else buf.fill(0);
      },
      context: self,
    };
  }
}

function makeTimerDeps() {
  const handlers: Array<() => void> = [];
  return {
    deps: {
      setInterval: (fn: () => void) => {
        handlers.push(fn);
        return handlers.length as any;
      },
      clearInterval: (h: any) => {
        handlers.splice(Number(h) - 1, 1);
      },
    },
    fire: () => handlers.forEach((h) => h()),
    handlerCount: () => handlers.length,
  };
}

test("start: マイク単独で onStreamLevel('mic') が 100ms polling で呼ばれる", async () => {
  FakeMediaRecorder.instances = [];
  FakeAnalyserAudioContext.frame = new Float32Array(1024).fill(0.25);
  const timer = makeTimerDeps();
  const got: Array<{ source: string; rms: number }> = [];
  const deps = makeDeps({
    AudioContextCtor: FakeAnalyserAudioContext as unknown as typeof AudioContext,
    onStreamLevel: (source, level) => got.push({ source, rms: level.rms }),
    ...timer.deps,
  });
  const r = new DirectRecorder(deps);
  assert.equal(await r.start(settings), true);
  timer.fire();
  assert.equal(got.length, 1);
  assert.equal(got[0].source, "mic");
  assert.ok(Math.abs(got[0].rms - 0.25) < 0.001);
  await r.stop(settings); // interval が解放される
  assert.equal(timer.handlerCount(), 0);
});

test("start: WASAPI キャプチャの onLevel が onStreamLevel('pc') に中継される", async () => {
  FakeMediaRecorder.instances = [];
  const registered: Array<(l: any) => void> = [];
  const got: Array<{ source: string; level: any }> = [];
  const deps = makeDeps({
    spawnPcLoopbackCapture: async () => ({
      onLevel: (cb: any) => registered.push(cb),
      stop: async () => "C:/pc.wav",
    }),
    onStreamLevel: (source, level) => got.push({ source, level }),
  } as any);
  // audioSource=pcLoopback 単独は MediaRecorder を使わないため mix 設定にする
  const mixSettings = { ...settings, audioSource: "mix" } as unknown as GijiSettings;
  const r = new DirectRecorder(deps);
  assert.equal(await r.start(mixSettings), true);
  assert.equal(registered.length, 1);
  // handle からレベル発火 → deps.onStreamLevel が呼ばれることまで検証
  registered[0]({ rms: 0.4, peak: 0.6 });
  assert.deepEqual(got, [{ source: "pc", level: { rms: 0.4, peak: 0.6 } }]);
  await r.stop(settings);
});

test("computeRmsLevel: 正弦波相当の配列から rms/peak を計算する", () => {
  const data = new Float32Array(1024).fill(0.5);
  const lvl = computeRmsLevel(data);
  assert.ok(Math.abs(lvl.rms - 0.5) < 0.001);
  assert.ok(Math.abs(lvl.peak - 0.5) < 0.001);
});

test("computeRmsLevel: 空配列は rms=0", () => {
  assert.equal(computeRmsLevel(new Float32Array(0)).rms, 0);
});
```

先頭の import 行に `computeRmsLevel` を追加:

```ts
import { DirectRecorder, DirectRecorderDeps, rewriteFfmpegArgsForWasm, computeRmsLevel } from "../audio/directRecorder";
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npx tsx --require ./src/__tests__/setup.cjs --test src/__tests__/directRecorder.test.ts`
Expected: FAIL（`computeRmsLevel` が未エクスポート・`onStreamLevel` 呼び出しがない）

- [ ] **Step 3: 最小実装**

`directRecorder.ts` を変更:

1. `DirectRecorderDeps` に 3 フィールド追加（`spawnPcLoopbackCapture` の定義の後）:

```ts
  /** v0.15: 録音中の入力レベル通知先（mic/pc）。未指定なら通知しない */
  onStreamLevel?: (source: "mic" | "pc", level: PcLevel) => void;
  /** v0.15: レベル polling 用タイマー（テスト DI 用） */
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
```

2. 純関数をエクスポート（`LevelLineParser` の近く）:

```ts
/** v0.15: time domain データから RMS/peak を計算する（無音=0） */
export function computeRmsLevel(data: Float32Array): PcLevel {
  if (data.length === 0) return { rms: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    sum += v * v;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
  }
  return { rms: Math.sqrt(sum / data.length), peak };
}
```

3. コンストラクタの deps 既定値（`spawnPcLoopbackCapture: defaultSpawnPcLoopbackCapture,` の後）に追加:

```ts
      onStreamLevel: () => {},
      setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...(args as [])),
      clearInterval: (handle: Parameters<typeof clearInterval>[0]) => clearInterval(handle),
```

4. クラスフィールドを追加（`private pcCapture: PcLoopbackCaptureHandle | null = null;` の後）:

```ts
  /** v0.15: 入力レベル計測（AnalyserNode と polling タイマー） */
  private levelAnalysers: { source: "mic" | "pc"; analyser: AnalyserNode; buf: Float32Array }[] = [];
  private levelIntervalId: ReturnType<typeof setInterval> | null = null;
```

5. メソッドを追加（`mixStreams` の後）:

```ts
  /** v0.15: ストリームに AnalyserNode を接続する（ベストエフォート） */
  private attachAnalyser(source: "mic" | "pc", stream: MediaStream, ctx: AudioContext): void {
    try {
      const srcNode = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      srcNode.connect(analyser);
      this.levelAnalysers.push({ source, analyser, buf: new Float32Array(analyser.fftSize) });
    } catch {
      // 計測できないだけ。録音には影響させない
    }
  }

  /**
   * v0.15: 録音中の入力レベル計測を開始する。
   * - mic/pc の renderer 側ストリーム → AnalyserNode + 100ms polling
   * - WASAPI キャプチャ → handle.onLevel の中継
   * AudioContext 非対応でも録音は続行する（計測はベストエフォート）。
   */
  private setupLevelMonitoring(
    mic: MediaStream | null,
    pc: MediaStream | null,
    pcCapture: PcLoopbackCaptureHandle | null
  ): void {
    if (pcCapture) {
      pcCapture.onLevel((level) => this.deps.onStreamLevel("pc", level));
    }
    const ctx = this.audioCtx ?? this.createAudioContext();
    if (!ctx) return;
    this.audioCtx = ctx;
    if (mic) this.attachAnalyser("mic", mic, ctx);
    if (pc) this.attachAnalyser("pc", pc, ctx);
    if (this.levelAnalysers.length > 0) {
      this.levelIntervalId = this.deps.setInterval(() => this.pollLevels(), 100);
    }
  }

  private pollLevels(): void {
    for (const entry of this.levelAnalysers) {
      try {
        entry.analyser.getFloatTimeDomainData(entry.buf);
        this.deps.onStreamLevel(entry.source, computeRmsLevel(entry.buf));
      } catch {
        // 解放済み等。無視
      }
    }
  }

  private teardownLevelMonitoring(): void {
    if (this.levelIntervalId !== null) {
      this.deps.clearInterval(this.levelIntervalId);
      this.levelIntervalId = null;
    }
    this.levelAnalysers = [];
  }
```

6. `start()` 内の `this.micStream = micStream; this.pcStream = pcStream; this.pcCapture = pcCapture;` の直後に 1 行追加:

```ts
      // v0.15: 入力レベル計測（ベストエフォート）
      this.setupLevelMonitoring(micStream, pcStream, pcCapture);
```

7. `stop()` の `releaseSources` 定義内の先頭に `this.teardownLevelMonitoring();` を追加:

```ts
    const releaseSources = (): void => {
      this.teardownLevelMonitoring();
      this.stopTracks(this.micStream);
      // ... 既存のまま
```

8. `start()` の catch ブロックの先頭（`this.stopTracks(this.micStream);` の前）に `this.teardownLevelMonitoring();` を追加。

9. 公開メソッドを追加（`setupLevelMonitoring` などの隣。Task 6 の recordSegment 配線で後から登録する用途）:

```ts
  /** v0.15: 録音中レベルの追加リスナー登録（deps.onStreamLevel とは独立・複数登録可） */
  registerLevelListener(cb: (source: "mic" | "pc", level: PcLevel) => void): void {
    const prev = this.deps.onStreamLevel;
    this.deps.onStreamLevel = (source, level) => {
      prev(source, level);
      cb(source, level);
    };
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npx tsx --require ./src/__tests__/setup.cjs --test src/__tests__/directRecorder.test.ts`
Expected: PASS（既存テスト + 新規 4 件）

- [ ] **Step 5: 全テスト回帰確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npm test`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
cd D:/AI-Agent/GijiObsidian
git add obsidian-plugin/src/audio/directRecorder.ts obsidian-plugin/src/__tests__/directRecorder.test.ts
git commit -m "feat(plugin): 録音中の入力レベル計測（AnalyserNode + stdout 中継）追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: LevelMonitor（録音前チェック制御）

**Files:**
- Create: `obsidian-plugin/src/audio/levelMonitor.ts`
- Test: `obsidian-plugin/src/__tests__/levelMonitor.test.ts`

**Interfaces:**
- Consumes:
  - `resolveAbsoluteScriptDir` / `DirectRecorderDeps["spawnPcLoopbackCapture"]` / `PcLevel`（directRecorder.ts）
  - `LevelMeter` / `MeterSource`（ui/levelMeter.ts）
- Produces:
  - `export interface LevelMonitorDeps { getUserMedia?; AudioContextCtor?; spawnPcLoopbackCapture?; setInterval?; clearInterval?; now?; isRecording?: () => boolean }`
  - `export class LevelMonitor { constructor(app?: App, manifestDir?: string, meter?: LevelMeter, deps?: LevelMonitorDeps); isRunning(): boolean; start(settings: GijiSettings): Promise<boolean>; stop(): void }`
  - `start()` の契約: 録音中（`deps.isRecording()` が true）なら **false を返して何もしない**。マイク取得に失敗したら **throw**（呼び出し側で Notice）。成功時は `meter.show()` して `true` を返す
  - PC レベルが 3 秒間来ない場合 `meter.setUnavailable("pc")`

- [ ] **Step 1: 失敗するテストを書く**

`obsidian-plugin/src/__tests__/levelMonitor.test.ts` を新規作成:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { LevelMonitor, LevelMonitorDeps } from "../audio/levelMonitor";
import { LevelMeter } from "../ui/levelMeter";
import { GijiSettings } from "../settings";

function makeFakeEl(): any {
  const el: any = {
    children: [],
    style: {},
    className: "",
    textContent: "",
    shown: true,
    createDiv() {
      const c = makeFakeEl();
      el.children.push(c);
      return c;
    },
    createSpan() {
      const c = makeFakeEl();
      el.children.push(c);
      return c;
    },
    show() {
      el.shown = true;
    },
    hide() {
      el.shown = false;
    },
    remove() {},
  };
  return el;
}

function makeFakeStream() {
  const stopped: number[] = [];
  return {
    stream: { getTracks: () => [{ stop: () => stopped.push(1) }] } as unknown as MediaStream,
    stopped,
  };
}

class FakeMonitorAudioContext {
  closed = false;
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createAnalyser() {
    return {
      fftSize: 1024,
      getFloatTimeDomainData(buf: Float32Array) {
        buf.fill(0.5);
      },
    };
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

interface MonitorHarness {
  monitor: LevelMonitor;
  meter: LevelMeter;
  el: any;
  fireInterval: () => void;
  intervalCount: () => number;
  pcHandle: { onLevelCbs: Array<(l: any) => void>; stdinEnded: boolean };
  closedCtxs: FakeMonitorAudioContext[];
  stopped: number[];
  setNow: (ms: number) => void;
}

function makeHarness(overrides: Partial<LevelMonitorDeps> = {}): MonitorHarness {
  const handlers: Array<() => void> = [];
  let now = 0;
  const pcHandle = {
    onLevelCbs: [] as Array<(l: any) => void>,
    stdinEnded: false,
    onLevel(cb: (l: any) => void) {
      pcHandle.onLevelCbs.push(cb);
    },
    stop: async () => {
      pcHandle.stdinEnded = true;
      return "C:/mon.wav";
    },
  };
  const closedCtxs: FakeMonitorAudioContext[] = [];
  const mic = makeFakeStream();
  const settings = {
    directMicDeviceId: "",
    directSpeakerDeviceId: "",
    pcLoopbackScriptDir: "",
  } as unknown as GijiSettings;

  const deps: LevelMonitorDeps = {
    getUserMedia: async () => mic.stream,
    AudioContextCtor: (() => {
      const ctx = new FakeMonitorAudioContext();
      closedCtxs.push(ctx);
      return ctx;
    }) as unknown as typeof AudioContext,
    spawnPcLoopbackCapture: async () => pcHandle as any,
    setInterval: (fn: () => void) => {
      handlers.push(fn);
      return handlers.length as any;
    },
    clearInterval: (h: any) => {
      handlers.splice(Number(h) - 1, 1);
    },
    now: () => now,
    ...overrides,
  };

  const el = makeFakeEl();
  const meter = new LevelMeter(el);
  const monitor = new LevelMonitor(undefined, "", meter, deps);
  return {
    monitor,
    meter,
    el,
    fireInterval: () => handlers.forEach((h) => h()),
    intervalCount: () => handlers.length,
    pcHandle,
    closedCtxs,
    stopped: mic.stopped,
    setNow: (ms: number) => {
      now = ms;
    },
    settings,
  };
}

test("start: マイク取得 + Python monitor 起動 + メーター表示", async () => {
  const h = makeHarness();
  const ok = await h.monitor.start(h.settings);
  assert.equal(ok, true);
  assert.equal(h.monitor.isRunning(), true);
  assert.equal(h.el.shown, true); // meter.show()
  assert.equal(h.pcHandle.onLevelCbs.length, 1); // onLevel 登録済み
});

test("polling: マイクの rms が setLevel('mic') に流れる", async () => {
  const h = makeHarness();
  await h.monitor.start(h.settings);
  h.fireInterval();
  const root = h.el.children[0];
  const micFill = root.children[1].children[0];
  // analyser の fake は 0.5 埋め → -6.02dB → 幅 89.97%
  assert.ok(Number(micFill.style.width) > 80);
  h.monitor.stop();
});

test("onLevel: Python からのレベルが setLevel('pc') に流れる", async () => {
  const h = makeHarness();
  await h.monitor.start(h.settings);
  h.pcHandle.onLevelCbs[0]({ rms: 1, peak: 1 });
  const root = h.el.children[0];
  const pcFill = root.children[3].children[0];
  assert.equal(pcFill.style.width, "100.0%");
  h.monitor.stop();
});

test("無応答: 3 秒レベルが来ないと setUnavailable('pc')", async () => {
  const h = makeHarness();
  await h.monitor.start(h.settings);
  h.setNow(3100);
  h.fireInterval();
  const root = h.el.children[0];
  const pcFill = root.children[3].children[0];
  assert.ok(pcFill.className.includes("giji-level-unavailable"));
  h.monitor.stop();
});

test("stop: ストリーム停止・AudioContext close・メーター非表示", async () => {
  const h = makeHarness();
  await h.monitor.start(h.settings);
  h.monitor.stop();
  assert.equal(h.monitor.isRunning(), false);
  assert.equal(h.el.shown, false);
  assert.equal(h.intervalCount(), 0);
  assert.ok(h.stopped.length >= 1);
  assert.equal(h.closedCtxs[0].closed, true);
  assert.equal(h.pcHandle.stdinEnded, true);
});

test("録音中は開始しない（録音優先）", async () => {
  const h = makeHarness({ isRecording: () => true });
  const ok = await h.monitor.start(h.settings);
  assert.equal(ok, false);
  assert.equal(h.monitor.isRunning(), false);
  assert.equal(h.el.shown, false); // メーターも出ない
});

test("二重開始は無視される", async () => {
  const h = makeHarness();
  assert.equal(await h.monitor.start(h.settings), true);
  assert.equal(await h.monitor.start(h.settings), true);
  assert.equal(h.intervalCount(), 1);
  h.monitor.stop();
});

test("getUserMedia 失敗は throw され、running にならない", async () => {
  const h = makeHarness({
    getUserMedia: async () => {
      throw new Error("denied");
    },
  });
  await assert.rejects(() => h.monitor.start(h.settings), /denied/);
  assert.equal(h.monitor.isRunning(), false);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npx tsx --require ./src/__tests__/setup.cjs --test src/__tests__/levelMonitor.test.ts`
Expected: FAIL（`../audio/levelMonitor` が存在しない）

- [ ] **Step 3: 最小実装**

`obsidian-plugin/src/audio/levelMonitor.ts` を新規作成:

```ts
import type { App } from "obsidian";
import { join } from "path";
import { tmpdir } from "os";
import type { GijiSettings } from "../settings";
import {
  DirectRecorderDeps,
  PcLevel,
  resolveAbsoluteScriptDir,
} from "./directRecorder";
import { computeRmsLevel } from "./directRecorder";
import type { LevelMeter, MeterSource } from "../ui/levelMeter";

export interface LevelMonitorDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  AudioContextCtor?: typeof AudioContext;
  spawnPcLoopbackCapture?: DirectRecorderDeps["spawnPcLoopbackCapture"];
  setInterval?: (handler: () => void, timeout?: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
  now?: () => number;
  /** 録音中は true を返す。録音中の入力テスト開始は録音を優先して拒否する */
  isRecording?: () => boolean;
}

/** PC レベルの無応答判定閾値（ms） */
const PC_LEVEL_TIMEOUT_MS = 3000;
/** レベル polling 周期（ms） */
const POLL_INTERVAL_MS = 100;

/**
 * v0.15: 録音前入力チェック。マイク（AnalyserNode）と PC 音声
 * （Python pc_loopback_capture.py --monitor の stdout レベル行）を
 * ステータスバーの LevelMeter に流す。録音パイプラインとは独立した
 * 単独プロセス / 単独ストリームで動く。
 */
export class LevelMonitor {
  private running = false;
  private micStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: { node: AnalyserNode; buf: Float32Array } | null = null;
  private pcHandle: NonNullable<
    NonNullable<DirectRecorderDeps["spawnPcLoopbackCapture"]>
  > | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastPcLevelAt = 0;
  private deps: Required<Pick<
    LevelMonitorDeps,
    "setInterval" | "clearInterval" | "now"
  >> & LevelMonitorDeps;

  constructor(
    private app?: App,
    private manifestDir: string = "",
    private meter?: LevelMeter,
    deps: LevelMonitorDeps = {}
  ) {
    this.deps = {
      setInterval: deps.setInterval ?? ((handler, timeout) => setInterval(handler, timeout)),
      clearInterval: deps.clearInterval ?? ((handle) => clearInterval(handle)),
      now: deps.now ?? (() => Date.now()),
      ...deps,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(settings: GijiSettings): Promise<boolean> {
    if (this.running) return true;
    // 録音中は録音を優先（呼び出し側が Notice を出す）
    if (this.deps.isRecording?.()) return false;

    // 1) マイクストリーム（DirectRecorder と同じ制約）
    const micId = (settings.directMicDeviceId || "").trim();
    const constraints: MediaStreamConstraints = micId
      ? { audio: { deviceId: { exact: micId } } }
      : { audio: true };
    this.micStream = await this.deps.getUserMedia(constraints);

    // 2) マイク AnalyserNode（ベストエフォート）
    const Ctor =
      this.deps.AudioContextCtor ??
      (globalThis as any)?.AudioContext ??
      (globalThis as any)?.webkitAudioContext;
    if (Ctor && this.micStream) {
      try {
        const ctx: AudioContext = new Ctor();
        const srcNode = ctx.createMediaStreamSource(this.micStream);
        const node = ctx.createAnalyser();
        node.fftSize = 1024;
        srcNode.connect(node);
        this.audioCtx = ctx;
        this.analyser = { node, buf: new Float32Array(node.fftSize) };
      } catch {
        this.analyser = null;
      }
    }

    // 3) Python --monitor 起動（WAV 書き出しなし・レベル出力のみ）
    const outPath = join(tmpdir(), `giji_pc_mon_${this.deps.now()}.wav`);
    const scriptDir = resolveAbsoluteScriptDir(
      this.app,
      settings.pcLoopbackScriptDir || this.manifestDir || ""
    );
    this.pcHandle =
      (await this.deps.spawnPcLoopbackCapture?.(
        outPath,
        settings.directSpeakerDeviceId || "",
        scriptDir,
        undefined,
        true
      )) ?? null;
    this.lastPcLevelAt = this.deps.now();
    this.pcHandle?.onLevel((level: PcLevel) => {
      this.lastPcLevelAt = this.deps.now();
      this.meter?.setLevel("pc", level);
    });

    // 4) polling 開始
    this.intervalId = this.deps.setInterval(() => this.poll(), POLL_INTERVAL_MS);
    this.meter?.show();
    this.running = true;
    return true;
  }

  private poll(): void {
    if (this.analyser) {
      try {
        this.analyser.node.getFloatTimeDomainData(this.analyser.buf);
        this.meter?.setLevel("mic", computeRmsLevel(this.analyser.buf));
      } catch {
        // 解放済み等。無視
      }
    }
    if (this.pcHandle && this.deps.now() - this.lastPcLevelAt > PC_LEVEL_TIMEOUT_MS) {
      this.meter?.setUnavailable("pc");
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalId !== null) {
      this.deps.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    const tracks = this.micStream?.getTracks?.() ?? [];
    for (const t of tracks) {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    }
    this.micStream = null;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.analyser = null;
    if (this.pcHandle) {
      this.pcHandle.stop().catch(() => {});
      this.pcHandle = null;
    }
    this.meter?.hide();
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npx tsx --require ./src/__tests__/setup.cjs --test src/__tests__/levelMonitor.test.ts`
Expected: PASS（全 8 件）

- [ ] **Step 5: 全テスト回帰確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npm test`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
cd D:/AI-Agent/GijiObsidian
git add obsidian-plugin/src/audio/levelMonitor.ts obsidian-plugin/src/__tests__/levelMonitor.test.ts
git commit -m "feat(plugin): 録音前入力チェック LevelMonitor 追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 配線（main.ts・recordSegment.ts・settings.ts）

**Files:**
- Modify: `obsidian-plugin/src/main.ts`
- Modify: `obsidian-plugin/src/commands/recordSegment.ts`
- Modify: `obsidian-plugin/src/settings.ts`

**Interfaces:**
- Consumes:
  - `LevelMeter` / `injectLevelMeterStyles`（Task 3）
  - `LevelMonitor`（Task 5）
  - `DirectRecorderDeps["onStreamLevel"]` のシグネチャ `(source: "mic" | "pc", level: PcLevel) => void`（Task 4）
  - `SegmentRecorder.isRecording()`（既存 `recorder.ts:85`）
- Produces:
  - `GijiPlugin.levelMonitor: LevelMonitor` フィールド（settings タブから使う）
  - `recordSegment.ts` に `export function setLevelMeterApi(api: { meter: LevelMeter; isRecording: () => boolean } | null): void`（main.ts から登録）
  - `recordSegment.ts` に `export function isSegmentRecording(): boolean`
- このタスクは配線のみのため新規 unit test は追加しない（全テスト回帰 + ビルド + Task 7 の実機 UAT で検証）

- [ ] **Step 1: recordSegment.ts にレベルメーター API を追加**

ファイル冒頭の import に追加:

```ts
import { LevelMeter } from "../ui/levelMeter";
import { PcLevel } from "../audio/directRecorder";
```

モジュール変数とエクスポート関数を追加（`let recorder: SegmentRecorder | null = null;` の後）:

```ts
/** v0.15: ステータスバーメーターと録音状態の照会 API（main.ts から登録する） */
let levelMeterApi: { meter: LevelMeter; isRecording: () => boolean } | null = null;

export function setLevelMeterApi(
  api: { meter: LevelMeter; isRecording: () => boolean } | null
): void {
  levelMeterApi = api;
}

/** v0.15: 録音進行中か（LevelMonitor のガードに使う） */
export function isSegmentRecording(): boolean {
  return recorder?.isRecording() ?? false;
}
```

`startSegment` の成功ブロックにメーター表示を追加:

```ts
export async function startSegment(app: App, settings: GijiSettings, manifestDir: string, timer?: RecordingTimer) {
  const r = getRecorder(app, manifestDir);
  const started = await r.start(settings);
  if (started) {
    timer?.start();
    levelMeterApi?.meter.show();
    new Notice("🎙️ 録音中… もう一度「停止して転写」を実行すると終了します");
  }
}
```

`stopSegment` の冒頭（`timer?.setTranscribing();` の直後）にメーター非表示を追加:

```ts
  timer?.setTranscribing(); // 録音停止 → 文字起こし中
  levelMeterApi?.meter.hide(); // v0.15: 録音用メーターを隠す
```

さらに `getRecorder` を変更して DirectRecorder にレベル通知を橋渡しする:

```ts
function getRecorder(app: App, manifestDir: string = ""): SegmentRecorder {
  if (!recorder) {
    const direct = new DirectRecorder({}, app, manifestDir);
    // v0.15: 録音中の入力レベルをステータスバーメーターへ中継
    if (levelMeterApi) {
      const meter = levelMeterApi.meter;
      direct.registerLevelListener((source: "mic" | "pc", level: PcLevel) => meter.setLevel(source, level));
    }
    recorder = new SegmentRecorder(app, manifestDir, direct);
  }
  return recorder;
}
```

必要な import を追加（recorder.ts から `DirectRecorder` は既に re-export されていないため directRecorder から直接）:

```ts
import { DirectRecorder } from "../audio/directRecorder";
```

**注**: `direct.registerLevelListener` は deps 経由より後から登録できる方が安全（levelMeterApi が未登録のまま recorder が生成されるケース対策）。このメソッドは **Task 4 の実装ステップ 3-9 で既に `DirectRecorder` に追加済み**であり、ここでは呼び出すだけである。併せて Task 4 のテストに以下を追加すること（`registerLevelListener` の検証）:

```ts
test("registerLevelListener: 後から登録したリスナーにも通知される", async () => {
  FakeMediaRecorder.instances = [];
  FakeAnalyserAudioContext.frame = new Float32Array(1024).fill(0.25);
  const timer = makeTimerDeps();
  const got: string[] = [];
  const deps = makeDeps({
    AudioContextCtor: FakeAnalyserAudioContext as unknown as typeof AudioContext,
    ...timer.deps,
  });
  const r = new DirectRecorder(deps);
  r.registerLevelListener((source) => got.push(source));
  assert.equal(await r.start(settings), true);
  timer.fire();
  assert.deepEqual(got, ["mic"]);
  await r.stop(settings);
});
```

- [ ] **Step 2: main.ts でメーター・LevelMonitor を初期化**

import に追加:

```ts
import { LevelMeter, injectLevelMeterStyles } from "./ui/levelMeter";
import { LevelMonitor } from "./audio/levelMonitor";
import { setLevelMeterApi, isSegmentRecording } from "./commands/recordSegment";
```

クラスフィールドを追加（`recordingTimer!: RecordingTimer;` の後）:

```ts
  levelMeter!: LevelMeter;
  levelMonitor!: LevelMonitor;
```

`onload()` 内の `this.recordingTimer = new RecordingTimer(this.addStatusBarItem());` を以下に置き換え（**メーターを先に作るとタイマーの左に表示される**）:

```ts
    injectLevelMeterStyles();
    // v0.15: ステータスバーは「[レベルメーター][録音タイマー]」の順にする
    this.levelMeter = new LevelMeter(this.addStatusBarItem());
    this.recordingTimer = new RecordingTimer(this.addStatusBarItem());
    this.register(() => this.recordingTimer.stop());
    // v0.15: 録音前入力チェック（設定画面の「🎤 入力テスト」ボタンから使う）
    this.levelMonitor = new LevelMonitor(this.app, this.manifest.dir, this.levelMeter, {
      isRecording: () => isSegmentRecording(),
    });
    setLevelMeterApi({ meter: this.levelMeter, isRecording: () => isSegmentRecording() });
```

- [ ] **Step 3: settings.ts に「🎤 入力テスト」ボタンを追加**

`speakerDeviceSetting` の定義（`.addDropdown` で終わる Setting）の直後に追加:

```ts
    // v0.15: 録音前入力チェック（ステータスバーにレベルメーターを表示）
    new Setting(content)
      .setName("🎤 入力テスト（レベルメーター）")
      .setDesc("録音を開始する前にマイクと PC 音声の入力レベルを確認します。ステータスバーにメーターが表示されます。もう一度押すと停止します")
      .addButton((b) => {
        b.setButtonText("▶ 入力テスト開始").onClick(async () => {
          const mon = (this.plugin as any).levelMonitor as LevelMonitor | undefined;
          if (!mon) return;
          if (mon.isRunning()) {
            mon.stop();
            b.setButtonText("▶ 入力テスト開始");
            return;
          }
          b.setDisabled(true);
          try {
            const ok = await mon.start(s);
            if (!ok) {
              new Notice("⚠️ 録音中は入力テストを開始できません");
            } else {
              b.setButtonText("■ 入力テスト停止");
            }
          } catch (e: any) {
            new Notice(`⚠️ マイクにアクセスできません: ${e?.message ?? e}`);
          } finally {
            b.setDisabled(false);
          }
        });
      });
```

settings.ts 冒頭の import に追加:

```ts
import { LevelMonitor } from "./audio/levelMonitor";
```

**注**: `new Notice` が settings.ts で未 import の場合は `import { Notice } from "obsidian";` も追加する（既存 import を確認）。

- [ ] **Step 4: 全テスト回帰確認**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npm test`
Expected: PASS

- [ ] **Step 5: 型チェック・ビルド**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npx tsc --noEmit && npm run build`
Expected: エラーなし（esbuild の production ビルド成功）

- [ ] **Step 6: コミット**

```bash
cd D:/AI-Agent/GijiObsidian
git add obsidian-plugin/src/main.ts obsidian-plugin/src/commands/recordSegment.ts obsidian-plugin/src/settings.ts
git commit -m "feat(plugin): 入力レベルメーターの配線（ステータスバー・設定画面入力テスト）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: バージョン更新・ビルド・Vault デプロイ・実機 UAT

**Files:**
- Modify: `obsidian-plugin/package.json`（version 0.14.0 → 0.15.0）
- Modify: `obsidian-plugin/CHANGELOG.md`
- Modify: `obsidian-plugin/manifest.json`（version を 0.15.0 に）

**Interfaces:**
- Consumes: Task 1〜6 の全成果物
- Produces: Vault の `.obsidian/plugins/GijiObsidian/` にデプロイ済みプラグイン（`main.js`・`manifest.json`・**更新済み `pc_loopback_capture.py`**）

- [ ] **Step 1: バージョンを 0.15.0 に更新**

`obsidian-plugin/package.json` と `obsidian-plugin/manifest.json` の `version` を `0.15.0` にする。

- [ ] **Step 2: CHANGELOG に追記**

`obsidian-plugin/CHANGELOG.md` の先頭（既存フォーマットに倣う）に追加:

```markdown
## [0.15.0] - 2026-09-05

### Added
- 入力レベルメーター（F-XXX）: 録音モード「マイク + PC音声（WASAPI ループバック）」で、マイクとスピーカーの入力レベルをステータスバーのアニメーションバーで確認できる
  - 録音中は自動表示（`DirectRecorder` が AnalyserNode / WASAPI stdout レベルを中継）
  - 設定画面「🎤 入力テスト」ボタンで録音前チェック（Python `--monitor` モード・WAV 書き出しなし）
  - PC 音声レベルが 3 秒間取得できない場合は 🔊 バーが灰色表示
- `pc_loopback_capture.py` に `--monitor` モードとレベル JSON 行出力を追加（既存の引数契約は互換維持）
```

（`F-XXX` はリポジトリの F-番号マスターがあれば実際の番号に置き換える。なければ「入力レベルメーター」のまま）

- [ ] **Step 3: ビルド**

Run: `cd D:/AI-Agent/GijiObsidian/obsidian-plugin && npm test && npm run build`
Expected: テスト全緑・ビルド成功

- [ ] **Step 4: Vault へデプロイ**

デプロイ先: `C:\Users\superlambkin\OneDrive\Edge\Obsidian Vault\.obsidian\plugins\GijiObsidian\`

```bash
cd D:/AI-Agent/GijiObsidian/obsidian-plugin
ls esbuild.config.mjs && grep -n "deploy" esbuild.config.mjs
```

- `esbuild.config.mjs` に deploy 統合がある場合: `npm run build` でデプロイ済みなので手順 5 の検証のみ
- ない場合: 手動コピー

```bash
cp main.js manifest.json "C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/GijiObsidian/"
cp ../recorder-bridge/pc_loopback_capture.py "C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/GijiObsidian/"
```

- [ ] **Step 5: デプロイ検証**

```bash
grep -c "monitor" "C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/GijiObsidian/pc_loopback_capture.py"
grep -c "giji-level-meter" "C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/GijiObsidian/main.js"
```

Expected: 両方とも 1 以上（旧スクリプトのまま残っていないこと。**`--monitor` が無いと入力テストの 🔊 バーが灰色のままになる**）

- [ ] **Step 6: コミット**

```bash
cd D:/AI-Agent/GijiObsidian
git add obsidian-plugin/package.json obsidian-plugin/manifest.json obsidian-plugin/CHANGELOG.md
git commit -m "chore(plugin): v0.15.0 入力レベルメーター リリース準備

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 7: 実機 UAT（手動・Obsidian 再読込して確認）**

| # | 手順 | 合格基準 |
|:-:|------|---------|
| 1 | 設定 → GijiObsidian → 「▶ 入力テスト開始」 | ステータスバー左側に 🎤/🔊 バーが表示される |
| 2 | マイクに話しかける | 🎤 バーが声量に応じて動く（緑→黄→赤） |
| 3 | PC で音楽を再生 | 🔊 バーが動く |
| 4 | 両方無音 | 両バーとも 0% 付近 |
| 5 | スピーカー無効状態（または scriptDir を壊す）でテスト開始 | 🔊 バーが 3 秒後に灰色、🎤 は動き続ける |
| 6 | 「■ 入力テスト停止」 | バーが消える。タスクマネージャで python プロセスが残っていない |
| 7 | 録音モード「マイク + PC音声」で録音開始 | メーターが表示され両バーが動く |
| 8 | その状態で「▶ 入力テスト開始」 | 「⚠️ 録音中は入力テストを開始できません」 |
| 9 | 録音停止 → 転写・要約まで完了 | メーターが消え、録音ファイルが正常（従来どおり） |

- [ ] **Step 8: UAT 不具合があれば修正して再デプロイ（修正は個別コミット）。全項目合格後、タグ付けは主人の指示に従う**

---

## セルフレビュー記録

- **Spec 網羅**: 設計書 §3 コンポーネント 1〜6 → Task 1〜6、§4 データフロー → Task 2/4/5、§5 UI 挙動（録音優先・共用メーター）→ Task 5/6、§6 エラー処理（3 秒灰色・getUerMedia 失敗・解放）→ Task 3/5、§7 テスト → 各 Task、§9 デプロイ → Task 7
- **プレースホルダ**: なし（F-XXX 番号のみリポジトリの F-番号マスター確認を指示）
- **型整合**: `PcLevel` / `PcLevelListener` / `LevelLineParser` / `onLevel` / `monitor` 引数 / `computeRmsLevel` / `LevelMeter` / `LevelMonitor` / `setLevelMeterApi` の名称は全タスクで一致
