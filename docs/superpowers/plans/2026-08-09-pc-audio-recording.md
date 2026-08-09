# PC Audio Recording (WASAPI Loopback) Implementation Plan

> ⚠️ **改訂履歴（as-built 同期 2026-08-09）**: 実装時に **sounddevice 0.5.5 は `WasapiSettings` に loopback 引数を持たない** ことが判明（PyPI 最新でも非対応）。主人承認のもと **soundcard 0.4.6 へ pivot** した。以下の本文は初版（sounddevice 前提）のまま残す。実際の実装は：
> - `recorder-bridge/audio_source.py`：`AudioSource` enum + `list_available_sources()` + `mix_pcm()`（pass-through 意味論）
> - `recorder-bridge/recorder.py`：soundcard ブロッキング `record()` を **ソースごとに 1 スレッド** でループ（`CHUNK_SAMPLES=1600`、float32→int16 変換）、`stop()` でミックス
> - `requirements.txt`：sounddevice/soundfile → `soundcard>=0.4.6` + `numpy>=1.26`
> - スピーカー無し時はマイクフォールバックせず **HTTP 500**（設計書 v1.1 に同期済み）
> - コミット：`d22a628`（bridge）、`066f2d3`（plugin）。テスト bridge 16/16・plugin 104/104 PASS

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定ページに「🎙️ 録音モード」ドロップダウンを追加し、`mic` / `pcLoopback` / `mix` の 3 モードを切替可能にする。デフォルト `mix`（マイク + PC 音声 WASAPI ループバック）。Teams 会議で「停止して転写」を実行すると、自分の声と相手の声の両方が 1 つの MP3 に保存される。承認済み設計書 `04_PC音声録音設定.md v1.0.0` を完全実装する。

**Architecture:** ブリッジ側で `Recorder` を拡張し、`audio_source` パラメータに応じて 1〜2 個の sounddevice ストリーム（`InputStream` / `OutputStream(extra_settings=WasapiSettings(loopback=True))`）を開く。ミックスモード時は 2 系列の PCM を numpy 加算で合成し、既存の `_save_mp3_segments` に渡す。プラグイン側は `GijiSettings.audioSource` を追加し、設定 UI と `bridgeStart` のリクエストに反映する。

**Tech Stack:** Python 3.10+ / sounddevice 0.5.5 / FastAPI / numpy / ffmpeg、TypeScript / Obsidian API / esbuild / node:test + tsx。

## Global Constraints

- ソース：`D:\AI-Agent\giji-obsidian\`（git リポジトリ、master、コミット可；コミット接頭辞 `feat(recorder-bridge):` / `feat(plugin):` / `fix(plugin):`）
- 録音ブリッジ：Python、`recorder-bridge/` 配下。テスト `cd recorder-bridge && pytest tests/ -v`
- プラグインソース：`obsidian-plugin/`；テスト `cd obsidian-plugin && npm test`
- ビルド `cd obsidian-plugin && npm run build`（esbuild → `main.js`）
- デプロイ：`obsidian-plugin/main.js` + `manifest.json` を `C:\Users\superlambkin\OneDrive\Edge\Obsidian Vault\.obsidian\plugins\giji-obsidian\` へコピー（`cp`）
- **fetch は必ず `fetch.bind(globalThis)` を使う**（Chromium Illegal invocation 前例 56fd94e）
- `sounddevice.WasapiSettings(loopback=True)` は Windows 専用。Linux/Mac では利用不可 → HTTP 500 エラー + Notice 表示
- ミックス時は numpy `int32` で加算後 `// 2` で `int16` に戻しクリッピング防止
- 既存ユーティリティ（`_save_mp3_segments`、`_encode_mp3`、`_write_wav`）は変更せず再利用
- 機能コード内の自然言語文字列（エラーメッセージ、Notice メッセージ）は設計書 §5 と完全一致
- 既存ユーザーは `audioSource = "mix"` でデフォルト適用（`DEFAULT_SETTINGS` 経由で）

---

## File Map

```
D:\AI-Agent\giji-obsidian\
├── recorder-bridge/
│   ├── audio_source.py    (新)
│   ├── recorder.py         (変更: AudioSource 対応)
│   ├── main.py             (変更: StartReq.audioSource 追加)
│   ├── config.py           (既存・変更なし)
│   └── tests/
│       ├── test_bridge.py  (既存・変更なし)
│       └── test_audio_source.py  (新)
└── obsidian-plugin/
    ├── src/
    │   ├── settings.ts     (変更: audioSource 追加 + UI ドロップダウン)
    │   ├── audio/
    │   │   └── recorder.ts (変更: bridgeStart に audioSource を渡す)
    │   ├── commands/
    │   │   └── recordSegment.ts (既存・変更なし、main.ts のみ変更)
    │   └── main.ts         (変更: bridgeStart 第 4 引数 audioSource)
    └── src/__tests__/
        └── settings.test.ts (変更: DEFAULT_SETTINGS.audioSource のアサーション追加)
```

---

### Task 1: recorder-bridge/audio_source.py 新規 + 単体テスト

**Files:**
- Create: `D:\AI-Agent\giji-obsidian\recorder-bridge\audio_source.py`
- Create: `D:\AI-Agent\giji-obsidian\recorder-bridge\tests\test_audio_source.py`

**Interfaces:**
- Consumes:
  - `sounddevice` ライブラリ（既存依存）
  - `config.SAMPLE_RATE` / `config.CHANNELS`（`recorder-bridge/config.py` 既存）
- Produces:
  - `class AudioSource(str, Enum)` — 値 `"mic"` / `"pcLoopback"` / `"mix"`
  - `def open_streams(source: AudioSource, samplerate: int, channels: int, dtype: str) -> list[sd.Stream]` — モード別に必要なストリームを返す
  - `def mix_pcm(mic_frames: list[np.ndarray] | None, pc_frames: list[np.ndarray] | None, channels: int) -> np.ndarray` — 2 系列を numpy 加算（短い方は 0 パディング）

- [ ] **Step 1: 失敗するテストを書く**

`D:\AI-Agent\giji-obsidian\recorder-bridge\tests\test_audio_source.py` を新規作成：

```python
import numpy as np
from audio_source import AudioSource, open_streams, mix_pcm


def test_audio_source_enum_values():
    assert AudioSource.MIC.value == "mic"
    assert AudioSource.PC_LOOPBACK.value == "pcLoopback"
    assert AudioSource.MIX.value == "mix"


def test_audio_source_from_string():
    assert AudioSource("mic") == AudioSource.MIC
    assert AudioSource("pcLoopback") == AudioSource.PC_LOOPBACK
    assert AudioSource("mix") == AudioSource.MIX


def test_open_streams_mic_returns_one_stream():
    streams = open_streams(AudioSource.MIC, samplerate=16000, channels=1, dtype="int16")
    assert len(streams) == 1


def test_open_streams_pcLoopback_returns_one_stream():
    """PC 音声キャプチャは OutputStream + WasapiSettings(loopback=True)"""
    streams = open_streams(AudioSource.PC_LOOPBACK, samplerate=16000, channels=1, dtype="int16")
    assert len(streams) == 1


def test_open_streams_mix_returns_two_streams():
    streams = open_streams(AudioSource.MIX, samplerate=16000, channels=1, dtype="int16")
    assert len(streams) == 2


def test_mix_pcm_with_empty_inputs_returns_zeros():
    """両方空の場合、長さ 0 の PCM を返さず、少なくとも呼び出し側で扱える形を返す"""
    # 仕様: 両方 None なら空の 1 次元 int16 配列を返す（stop() 側で concatenate 失敗を防ぐ）
    mixed = mix_pcm(None, None, channels=1)
    assert mixed.dtype == np.int16
    assert mixed.shape[1] == 1


def test_mix_pcm_only_mic():
    """mic のみ：pc_frames が None → mic だけ返す"""
    mic = [np.array([[100], [200], [300]], dtype=np.int16)]
    mixed = mix_pcm(mic, None, channels=1)
    assert mixed.shape == (3, 1)
    assert mixed[0, 0] == 100
    assert mixed[2, 0] == 300


def test_mix_pcm_only_pc():
    """pc のみ：mic_frames が None → pc だけ返す"""
    pc = [np.array([[500], [600]], dtype=np.int16)]
    mixed = mix_pcm(None, pc, channels=1)
    assert mixed.shape == (2, 1)
    assert mixed[1, 0] == 600


def test_mix_pcm_both_same_length_averages():
    """同長：要素ごとに平均"""
    mic = [np.array([[1000], [2000]], dtype=np.int16)]
    pc = [np.array([[2000], [4000]], dtype=np.int16)]
    mixed = mix_pcm(mic, pc, channels=1)
    # (1000 + 2000) // 2 = 1500
    assert mixed[0, 0] == 1500
    # (2000 + 4000) // 2 = 3000
    assert mixed[1, 0] == 3000


def test_mix_pcm_different_length_pads_with_zero():
    """長さ違い：短い方に 0 パディング"""
    mic = [np.array([[100], [200], [300], [400]], dtype=np.int16)]
    pc = [np.array([[10], [20]], dtype=np.int16)]
    mixed = mix_pcm(mic, pc, channels=1)
    # 長さ 4 にパディングされ、要素 [0,1] は mix、要素 [2,3] は mic そのまま
    assert mixed.shape == (4, 1)
    # (100+10)//2 = 55
    assert mixed[0, 0] == 55
    # mic のみ
    assert mixed[2, 0] == 300
    assert mixed[3, 0] == 400
```

> 注: `test_open_streams_pcLoopback_returns_one_stream` は Windows 環境でしか通りません。Linux/Mac では WASAPI loopback は利用不可 → sd.OutputStream(extras=WasapiSettings) が OSError を投げます。**テスト実行は Windows で OK** だが、CI が Linux の場合は当該テストを skip マーカーで囲む、または `pytest.importorskip` でガードする。
>
> **実装簡略化案**: `open_streams` 内で `WasapiSettings(loopback=True)` を `extra_settings` に渡す。sounddevice は OS に WSAPI loopback がなければ `PortAudioError` を raise する。これは呼び出し側（`Recorder.start`）が `except` で受け止めて HTTP 500 にする。

- [ ] **Step 2: テストを実行して失敗を確認**

実行:
```bash
cd /d/AI-Agent/giji-obsidian/recorder-bridge && pytest tests/test_audio_source.py -v 2>&1 | tail -15
```
期待結果: FAIL — `ModuleNotFoundError: No module named 'audio_source'`

- [ ] **Step 3: 最小実装を書く**

`D:\AI-Agent\giji-obsidian\recorder-bridge\audio_source.py` を新規作成：

```python
"""Audio source selection for the recorder bridge.

Windows WASAPI loopback support only. macOS/Linux return None for loopback
(the OS does not expose a 'capture system output' API by default).
"""
from enum import Enum
from typing import List, Optional

import numpy as np
import sounddevice as sd


class AudioSource(str, Enum):
    MIC = "mic"
    PC_LOOPBACK = "pcLoopback"
    MIX = "mix"


def open_streams(
    source: AudioSource,
    samplerate: int,
    channels: int,
    dtype: str,
) -> List[sd.Stream]:
    """モードに応じて必要なストリーム（0〜2 個）を開いて返す。

    MIC / MIX の場合：InputStream（マイク入力）
    PC_LOOPBACK / MIX の場合：OutputStream + WasapiSettings(loopback=True)
        （Windows ではシステム既定の出力デバイスの音をキャプチャ）
    """
    streams: List[sd.Stream] = []
    if source in (AudioSource.MIC, AudioSource.MIX):
        streams.append(
            sd.InputStream(
                samplerate=samplerate, channels=channels, dtype=dtype
            )
        )
    if source in (AudioSource.PC_LOOPBACK, AudioSource.MIX):
        # WASAPI loopback は Windows 専用。macOS/Linux では OSError が発生するため、
        # 呼び出し側で try/except して HTTP 500 を返す想定。
        streams.append(
            sd.OutputStream(
                samplerate=samplerate,
                channels=channels,
                dtype=dtype,
                extra_settings=sd.WasapiSettings(loopback=True),
            )
        )
    return streams


def mix_pcm(
    mic_frames: Optional[List[np.ndarray]],
    pc_frames: Optional[List[np.ndarray]],
    channels: int,
) -> np.ndarray:
    """2 系列の PCM を numpy 加算（短い方は 0 パディング）。

    戻り値は (samples, channels) の int16 numpy 配列。
    両方が None の場合は空配列 (0, channels) を返す。
    """
    if not mic_frames and not pc_frames:
        return np.zeros((0, channels), dtype=np.int16)

    mic_concat = np.concatenate(mic_frames, axis=0) if mic_frames else None
    pc_concat = np.concatenate(pc_frames, axis=0) if pc_frames else None

    mic_len = len(mic_concat) if mic_concat is not None else 0
    pc_len = len(pc_concat) if pc_concat is not None else 0
    n = max(mic_len, pc_len)

    mic = np.zeros((n, channels), dtype=np.int16)
    pc = np.zeros((n, channels), dtype=np.int16)
    if mic_concat is not None:
        mic[:mic_len] = mic_concat
    if pc_concat is not None:
        pc[:pc_len] = pc_concat

    # int32 で加算してクリッピングを防止、// 2 で int16 範囲に正規化
    mixed = (mic.astype(np.int32) + pc.astype(np.int32)) // 2
    return mixed.astype(np.int16)
```

- [ ] **Step 4: テストを実行して合格を確認**

実行:
```bash
cd /d/AI-Agent/giji-obsidian/recorder-bridge && pytest tests/ -v 2>&1 | tail -20
```
期待結果: 既存テスト全件 + 新規 audio_source テスト 9 件 PASS

> 注: Windows 以外の CI で `test_open_streams_pcLoopback_*` がエラーになる場合は pytest.importorskip でガードする。本実装は Windows で実行するためガード不要。

- [ ] **Step 5: コミット**

```bash
cd /d/AI-Agent/giji-obsidian
git add recorder-bridge/audio_source.py recorder-bridge/tests/test_audio_source.py
git commit -m "feat(recorder-bridge): AudioSource enum + WASAPI loopback ストリーム生成 + mix_pcm + 単体テスト"
```

---

### Task 2: recorder.py + main.py 拡張 + プラグイン側設定 + UI + デプロイ

**Files:**
- Modify: `D:\AI-Agent\giji-obsidian\recorder-bridge\recorder.py`（Recorder.start に audio_source 引数追加、`_streams` / `_pc_frames` 管理、`_on_audio` 振り分け、`stop()` で mix_pcm 呼び出し）
- Modify: `D:\AI-Agent\giji-obsidian\recorder-bridge\main.py`（`StartReq.audioSource` 追加、`/record/start` で `_recorder.start(audio_source=req.audioSource)` を呼ぶ）
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\settings.ts`（`GijiSettings.audioSource` 追加 + `DEFAULT_SETTINGS.audioSource = "mix"` + 設定 UI ドロップダウン追加）
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\audio\recorder.ts`（`bridgeStart` の引数追加：audioSource を渡す）
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\main.ts`（`bridgeStart` 呼び出し時に `settings.audioSource` を渡す）
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__\settings.test.ts`（`DEFAULT_SETTINGS.audioSource === "mix"` をアサート）
- Build: `obsidian-plugin/main.js`
- Deploy: `C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/giji-obsidian/`

**Interfaces:**
- Consumes: `AudioSource` enum・`open_streams()`・`mix_pcm()`（Task 1）
- Produces: 設定 UI・bridge API 拡張・テスト拡張

- [ ] **Step 1: プラグイン settings.test.ts に audioSource アサーションを追加**

`D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__\settings.test.ts` を開き、既存テスト `DEFAULT_SETTINGS has required fields` の末尾に 1 行追加：

```ts
test("DEFAULT_SETTINGS has required fields", () => {
  assert.equal(DEFAULT_SETTINGS.sttProvider, "openai");
  assert.equal(DEFAULT_SETTINGS.sttLang, "auto");
  assert.equal(DEFAULT_SETTINGS.llmProvider, "claudian");
  assert.equal(DEFAULT_SETTINGS.bridgeBaseUrl, "http://127.0.0.1:17890");
  assert.equal(DEFAULT_SETTINGS.audioSource, "mix");  // ← 追加
});
```

実行:
```bash
cd /d/AI-Agent/giji-obsidian/obsidian-plugin && npm test -- --test-name-pattern="DEFAULT_SETTINGS" 2>&1 | tail -10
```
期待結果: FAIL — `undefined === "mix"` でアサーション失敗（`audioSource` フィールドがまだ存在しないため）

- [ ] **Step 2: settings.ts — GijiSettings と DEFAULT_SETTINGS を更新**

`D:\AI-Agent\giji-obsidian\obsidian-plugin\src\settings.ts` の `GijiSettings` インターフェースにフィールド追加（`// ① 録音` セクション、`appendRecordEnabled` の前あたり）：

```ts
export interface GijiSettings {
  // ② 文字起こし
  sttProvider: SttProviderId;
  sttApiKey: string;
  sttLang: SttLang;
  // ③ 要約
  llmProvider: LlmProviderId;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  autoSummarizeEnabled: boolean;
  outputDir: string;
  keepTranscript: boolean;
  minutesTemplateSource: MinutesTemplateSource;
  minutesTemplateVaultPath: string;
  minutesTemplateFile: string;
  // ① 録音
  bridgeBaseUrl: string;
  bridgeDir: string;
  recordingSaveDir: string;
  recordingFileNameTemplate: string;
  appendRecordEnabled: boolean;
  audioSource: "mic" | "pcLoopback" | "mix";  // ← 追加
  // ② 文字起こし（保存・挿入）
  autoSaveTranscript: boolean;
  transcriptSaveDir: string;
  fileNameTemplate: string;
  insertToClaudianEnabled: boolean;
  // ④ その他
  emailSummaryEnabled: boolean;
}
```

`DEFAULT_SETTINGS` に追加（`appendRecordEnabled: true,` の直後）：

```ts
  appendRecordEnabled: true,
  audioSource: "mix",  // ← 追加
```

- [ ] **Step 3: 設定 UI ドロップダウンを追加**

LLM 領域の前に録音領域があるはず（`bridgeBaseUrl` 設定ブロックの**直前**）に以下を追加：

```ts
    new Setting(containerEl)
      .setName("🎙️ 録音モード")
      .setDesc("Teams 会議時は「マイク + PC 音声」を推奨。PC 音声は WASAPI ループバックで取得")
      .addDropdown((d) =>
        d.addOption("mix", "マイク + PC 音声（WASAPI ループバック）")
          .addOption("mic", "マイクのみ（従来）")
          .addOption("pcLoopback", "PC 音声のみ（ループバック）")
          .setValue(s.audioSource)
          .onChange(async (v: string) => {
            s.audioSource = v as "mic" | "pcLoopback" | "mix";
            await this.save();
          })
      );
```

> 配置場所が見つからない場合は、`bridgeBaseUrl` Setting ブロックの**直前の addSetting** をコピーして貼る。

- [ ] **Step 4: テスト + ビルド（Settings 単体確認）**

実行:
```bash
cd /d/AI-Agent/giji-obsidian/obsidian-plugin && npm test 2>&1 | tail -10 && npm run build 2>&1 | tail -5
```
期待結果: 既存 + audioSource テスト全件 PASS + esbuild エラーなし

- [ ] **Step 5: audio/recorder.ts に audioSource 引数を追加**

`D:\AI-Agent\giji-obsidian\obsidian-plugin\src\audio\recorder.ts` の `bridgeStart` 呼び出し箇所に `audioSource: settings.audioSource ?? "mic"` を追加：

該当行（bridgeStart 呼び出し）を以下のように変更：

```ts
this.sessionId = await bridgeStart(settings.bridgeBaseUrl, {
  outDir,
  fileName,
  audioSource: settings.audioSource ?? "mic",  // ← 追加
});
```

> 注: `bridge.ts` の `bridgeStart` のシグネチャは既に第 2 引数をオブジェクト型で受け取っているはず。なければ引数オブジェクトを `{ outDir?, fileName? }` 形式に拡張する（後述 Step 7 で `bridge.ts` も修正）。

- [ ] **Step 6: bridge.ts に audioSource フィールドを追加**

`D:\AI-Agent\giji-obsidian\obsidian-plugin\src\bridge.ts` の `bridgeStart` 関数を変更：

```ts
export async function bridgeStart(
  baseUrl: string,
  options: {
    outDir?: string;
    fileName?: string;
    audioSource?: "mic" | "pcLoopback" | "mix";
  } = {},
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/record/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: "wav",
      outDir: options.outDir,
      fileName: options.fileName,
      audioSource: options.audioSource,
    }),
  });
  if (!res.ok) throw new Error(`bridge start ${res.status}`);
  const data = await res.json();
  return data.sessionId;
}
```

- [ ] **Step 7: recorder.py に audio_source 対応を追加**

`D:\AI-Agent\giji-obsidian\recorder-bridge\recorder.py` の `Recorder` クラスを拡張：

```python
from audio_source import AudioSource, open_streams, mix_pcm

class Recorder:
    """Records mic / PC-loopback / mixed audio to 16kHz mono, saved as MP3 64kbps."""

    def __init__(self):
        self._stream = None  # 既存互換用
        self._streams = []   # 新規：モード別ストリーム群
        self._frames = []
        self._pc_frames = []
        self._audio_source: AudioSource = AudioSource.MIC
        self._session_id = None
        self._out_dir_override: Optional[str] = None
        self._file_name: Optional[str] = None
        self._lock = threading.Lock()

    @property
    def session_id(self):
        return self._session_id

    def _out_dir(self):
        return config.TMP_DIR or tempfile.gettempdir()

    def start(
        self,
        out_dir: Optional[str] = None,
        file_name: Optional[str] = None,
        audio_source: str = "mic",
    ) -> str:
        with self._lock:
            if self._stream is not None or self._streams:
                raise RuntimeError("already_recording")
            try:
                source = AudioSource(audio_source)
            except ValueError:
                source = AudioSource.MIC
            self._frames = []
            self._pc_frames = []
            self._session_id = str(uuid.uuid4())
            self._out_dir_override = out_dir or None
            self._file_name = file_name or None
            self._audio_source = source

            # モード別ストリームを開く
            self._streams = open_streams(
                source, config.SAMPLE_RATE, config.CHANNELS, "int16"
            )

            # コールバック振り分け（mic / pc を別バッファへ）
            streams_count = len(self._streams)
            for idx, stream in enumerate(self._streams):
                if source == AudioSource.MIX and idx == 1:
                    # MIX の 2 番目 = PC ループバック
                    stream.callback = self._on_pc_audio
                else:
                    stream.callback = self._on_audio
                stream.start()
            return self._session_id

    def _on_audio(self, indata, frames, time, status):
        with self._lock:
            self._frames.append(indata.copy())

    def _on_pc_audio(self, indata, frames, time, status):
        with self._lock:
            self._pc_frames.append(indata.copy())

    def _write_wav(self, path: str, audio: np.ndarray) -> None:
        with wave.open(path, "wb") as wf:
            wf.setnchannels(config.CHANNELS)
            wf.setsampwidth(2)
            wf.setframerate(config.SAMPLE_RATE)
            wf.writeframes(audio.tobytes())

    def _encode_mp3(self, pcm: bytes, path: str) -> None:
        """既存のまま：ffmpeg で PCM → MP3 64kbps"""
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "s16le",
                "-ar", str(config.SAMPLE_RATE),
                "-ac", str(config.CHANNELS),
                "-i", "pipe:0",
                "-codec:a", "libmp3lame",
                "-b:a", "64k",
                "-write_xing", "0",
                path,
            ],
            input=pcm,
            check=True,
            capture_output=True,
        )

    def _save_mp3_segments(self, audio: np.ndarray, out_dir: str, name: str) -> list:
        """既存のまま"""
        total = len(audio)
        seg_count = max(1, -(-total // MAX_SEGMENT_SAMPLES))
        paths = []
        for i in range(seg_count):
            seg = audio[i * MAX_SEGMENT_SAMPLES : (i + 1) * MAX_SEGMENT_SAMPLES]
            fname = f"{name}.mp3" if seg_count == 1 else f"{name}-{i + 1}.mp3"
            path = os.path.join(out_dir, fname)
            self._encode_mp3(seg.tobytes(), path)
            paths.append(path)
        return paths

    def stop(self) -> dict:
        with self._lock:
            if self._stream is None and not self._streams:
                raise RuntimeError("not_recording")
            # 全ストリーム停止
            for stream in self._streams:
                stream.stop()
                stream.close()
            self._stream = None
            self._streams = []

            # PCM 合成（モード別）
            mic_frames = self._frames if self._audio_source in (AudioSource.MIC, AudioSource.MIX) else []
            pc_frames = self._pc_frames if self._audio_source in (AudioSource.PC_LOOPBACK, AudioSource.MIX) else []
            audio = mix_pcm(
                mic_frames if mic_frames else None,
                pc_frames if pc_frames else None,
                config.CHANNELS,
            )
            duration = (len(audio) / config.SAMPLE_RATE) if len(audio) else 0.0

            out_dir = self._out_dir_override or self._out_dir()
            os.makedirs(out_dir, exist_ok=True)
            name = self._file_name or f"giji_{self._session_id}"

            warning = None
            try:
                paths = self._save_mp3_segments(audio, out_dir, name)
            except Exception:
                warning = "mp3_encode_failed"
                wav_path = os.path.join(out_dir, f"{name}.wav")
                self._write_wav(wav_path, audio)
                paths = [wav_path]

            self._session_id = None
            self._out_dir_override = None
            self._file_name = None
            result = {
                "audioPaths": paths,
                "wavPath": paths[0],
                "durationSec": round(float(duration), 3),
                "audioSource": self._audio_source.value,
            }
            self._audio_source = AudioSource.MIC
            if warning:
                result["warning"] = warning
            return result
```

> ⚠️ 注: 既存テスト `test_long_recording_is_split_into_segments` は `_recorder._frames = [...]` を直接書き換えるため、既存の `_frames` ロジックは保持すること。`_on_audio` は `_frames.append` のまま。

- [ ] **Step 8: main.py に audioSource リクエストフィールド追加**

`D:\AI-Agent\giji-obsidian\recorder-bridge\main.py` の `StartReq` に追加：

```python
class StartReq(BaseModel):
    format: str = "wav"
    outDir: Optional[str] = None
    fileName: Optional[str] = None
    audioSource: Optional[str] = "mic"
```

`/record/start` エンドポイントを更新：

```python
@app.post("/record/start")
def record_start(req: StartReq):
    try:
        sid = _recorder.start(
            out_dir=req.outDir,
            file_name=req.fileName,
            audio_source=req.audioSource or "mic",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        # WASAPI loopback 非対応 OS 等
        raise HTTPException(status_code=500, detail=f"audio_source_failed: {e}")
    return {"recording": True, "sessionId": sid, "audioSource": req.audioSource}
```

- [ ] **Step 9: テスト + ブリッジ再起動**

実行:
```bash
# 1. ブリッジ側のテスト
cd /d/AI-Agent/giji-obsidian/recorder-bridge && pytest tests/ -v 2>&1 | tail -10

# 2. プラグイン側のテスト（既存 + audioSource アサーション）
cd /d/AI-Agent/giji-obsidian/obsidian-plugin && npm test 2>&1 | tail -10
```

期待結果: 全件 PASS

- [ ] **Step 10: ブリッジ再起動（旧プロセス停止 → 新コード起動）**

```bash
# 旧ブリッジ停止
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | Where-Object { \$_.CommandLine -like '*main.py*' } | ForEach-Object { cmd //c \"taskkill /F /PID \$(\$_.ProcessId)\" }" 2>&1 | tail -5

# 新ブリッジ起動（バックグラウンド）
cd /d/AI-Agent/giji-obsidian/recorder-bridge && python main.py
```

別ターミナルで疎通確認:
```bash
curl -s http://127.0.0.1:17890/health
```
期待結果: `{"status":"ok","version":"0.1.0"}`

- [ ] **Step 11: プラグイン ビルド + デプロイ**

```bash
cd /d/AI-Agent/giji-obsidian/obsidian-plugin && npm run build 2>&1 | tail -5

cp "D:/AI-Agent/giji-obsidian/obsidian-plugin/main.js" "D:/AI-Agent/giji-obsidian/obsidian-plugin/manifest.json" "C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/giji-obsidian/" && echo "deployed"
```
期待結果: `deployed`（main.js のタイムスタンプ更新）

- [ ] **Step 12: コミット**

```bash
cd /d/AI-Agent/giji-obsidian
git add recorder-bridge/recorder.py recorder-bridge/main.py obsidian-plugin/src/settings.ts obsidian-plugin/src/audio/recorder.ts obsidian-plugin/src/bridge.ts obsidian-plugin/src/__tests__/settings.test.ts obsidian-plugin/main.js obsidian-plugin/manifest.json
git commit -m "feat(recorder+plugin): 録音モード 3 種切替（mic/pcLoopback/mix）+ WASAPI ループバック"
```

> 注: `main.js` / `manifest.json` は git 管理外の可能性あり（`.gitignore` 確認）。その場合はコミットから除外する。

---

## Self-Review

**1. 仕様カバレッジ（[[80_POC_Projects/POC_016_GijiObsidian/02_设计文档/04_PC音声録音設定.md\|04_PC音声録音設定 v1.0.0]]）:**

| 設計書セクション | カバー先タスク |
|---|---|
| §3.1 `AudioSource` enum + `open_streams` | Task 1 |
| §3.2 `Recorder.start()` の改修（`audio_source` 引数） | Task 2 Step 7 |
| §3.3 `_mix_pcm`（numpy 加算） | Task 1 + Task 2 Step 7 |
| §3.4 `StartReq.audioSource` 追加 | Task 2 Step 8 |
| §4 UI ドロップダウン | Task 2 Step 3 |
| §5 エラー処理 5 ケース | Task 2 Step 8（HTTP 500）/ Task 2 Step 7（`try` 内 WASAPI 失敗）|
| §6 自動テスト 8 ケース | Task 1（9 ケース追加）/ Task 2 Step 1（1 アサーション） |
| §6 手動 UAT 4 場面 | **本計画スコープ外**（主人の実機受入） |

**2. プレースホルダースキャン:**
- 「TBD」「TODO」「適切に処理」「同上で」はなし
- 全テストコードに完全実装
- `audio_source.py` / `recorder.py` / `main.py` の完全実装を各 Step で提示

**3. 型整合性:**
- `AudioSource(str, Enum)` の値 `"mic"` / `"pcLoopback"` / `"mix"` は設計書 §3.1 と完全一致
- `open_streams(source, samplerate, channels, dtype) -> List[sd.Stream]` のシグネチャは §3.1 と完全一致
- `mix_pcm(mic_frames, pc_frames, channels) -> np.ndarray` のシグネチャは §3.3 と完全一致
- `Recorder.start(out_dir?, file_name?, audio_source: str = "mic") -> str` の引数順は設計書 §3.2 と一致
- `StartReq.audioSource: Optional[str] = "mic"` は §3.4 と一致
- `bridgeStart(baseUrl, options: { outDir?, fileName?, audioSource? })` の型は TypeScript プラグイン側で `bridge.ts` に追加、obsidian-plugin/src/audio/recorder.ts から呼ばれる
- `GijiSettings.audioSource: "mic" | "pcLoopback" | "mix"` は §4 UI ドロップダウン値と byte-exact 一致
- 機能コード内の自然言語文字列（エラーメッセージ、Notice メッセージ）は設計書 §5 と完全一致

---

## Execution Handoff

Plan complete and saved to `D:\AI-Agent\giji-obsidian\docs\superpowers\plans\2026-08-09-pc-audio-recording.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?