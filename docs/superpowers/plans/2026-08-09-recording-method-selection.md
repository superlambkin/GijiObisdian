# Recording Method Selection (Bridge / PC Direct) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定に「🎙️ 録音手法」ドロップダウン（`bridge` / `direct`、デフォルト `bridge`）を追加し、PC ダイレクト録音（MediaRecorder → webm → ffmpeg → MP3）を実装する。後段（STT → 要約 → 議事録保存）は完全共有。

**Architecture:** `DirectRecorder`（新規）が getUserMedia + MediaRecorder でマイク録音し、Blob → 一時 webm 保存 → `execFile("ffmpeg", ...)` で MP3 64kbps 変換。`SegmentRecorder.start()/stop()` が `settings.recordingMethod` でブリッジ / ダイレクトを分岐し、`transcribePaths()` ヘルパーで後段を共通化。ブリッジ（recorder-bridge Python）は無変更。

**Tech Stack:** TypeScript / Obsidian API / Chromium MediaRecorder + getUserMedia / child_process.execFile / node:test + tsx / esbuild。

## Global Constraints

- ソース：`D:\AI-Agent\giji-obsidian\`（git リポジトリ、master、コミット可；コミット接頭辞 `feat(plugin):` / `fix(plugin):`）
- テスト：`cd obsidian-plugin && npm test`（tsx --require setup.cjs）。ビルド `npm run build` → `main.js`
- デプロイ：`obsidian-plugin/main.js` + `manifest.json` を `C:\Users\superlambkin\OneDrive\Edge\Obsidian Vault\.obsidian\plugins\giji-obsidian\` へコピー
- **Node 組み込み（fs / child_process / path）は静的 import 必須**（Chromium ESM ローダーが動的 import を解決できない前例 e2e7f47）。`src/__tests__/recorder.test.ts` の SRC_FILES 走査テストに新ファイルを追加する
- 既存の録音フロー（`stopSegment` → `SegmentRecorder.stop` → STT → `runAutoSummarize`）は壊さない。既存テスト 104 件は全て通し続ける
- ffmpeg パラメータはブリッジと同一：`["-y", "-i", <webm>, "-codec:a", "libmp3lame", "-b:a", "64k", "-write_xing", "0", <mp3>]`
- 保存先・ファイル名テンプレートは既存 `recordingSaveDir` / `recordingFileNameTemplate` を共通使用（`buildRecordingFileName` を再利用）
- 設計書：`80_POC_Projects/POC_016_GijiObsidian/02_设计文档/05_録音手法選択.md`

---

### Task 1: DirectRecorder（MediaRecorder → webm → ffmpeg → MP3）

**Files:**
- Create: `obsidian-plugin/src/audio/directRecorder.ts`
- Test: `obsidian-plugin/src/__tests__/directRecorder.test.ts`

**Interfaces:**
- Produces:
  - `export interface DirectRecordResult { audioPaths: string[]; wavPath?: string; durationSec: number; warning?: string }`
  - `export interface DirectRecorderDeps { getUserMedia?: (c: {audio: boolean}) => Promise<MediaStream>; MediaRecorderCtor?: typeof MediaRecorder; writeFile?: (p: string, d: ArrayBuffer) => Promise<void>; deleteFile?: (p: string) => Promise<void>; ffmpeg?: (args: string[]) => Promise<void> }`
  - `export class DirectRecorder { constructor(deps?: DirectRecorderDeps); isRecording(): boolean; async start(settings: GijiSettings): Promise<boolean>; async stop(settings: GijiSettings): Promise<DirectRecordResult | null> }`
- Consumes: `GijiSettings`（`recordingSaveDir` / `recordingFileNameTemplate`）、`buildRecordingFileName`（`./recorder`）

- [ ] **Step 1: Write the failing test**

`src/__tests__/directRecorder.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { basename } from "path";
import { DirectRecorder, DirectRecorderDeps } from "../audio/directRecorder";
import { GijiSettings } from "../settings";

// ---- Fake MediaRecorder（DOM 非依存・テスト用）----
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  startCalls = 0;
  stopCalls = 0;
  constructor(public stream: any, public options: any) {
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.startCalls++;
    this.state = "recording";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) });
  }
  stop() {
    this.stopCalls++;
    this.state = "inactive";
    // 録音中チャンクに加えて stop() 後の最終フラッシュをシミュレート
    this.ondataavailable?.({ data: new Blob([new Uint8Array([4, 5])]) });
    this.onstop?.();
  }
}

const settings = {
  recordingSaveDir: "C:/rec",
  recordingFileNameTemplate: "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分{{second}}秒",
} as unknown as GijiSettings;

function makeDeps(overrides: Partial<DirectRecorderDeps> = {}): Required<DirectRecorderDeps> {
  return {
    getUserMedia: async () => ({}) as MediaStream,
    MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
    writeFile: async () => {},
    deleteFile: async () => {},
    ffmpeg: async () => {},
    ...overrides,
  } as Required<DirectRecorderDeps>;
}

test("start: getUserMedia 成功 → isRecording true・MediaRecorder.start 呼出", async () => {
  FakeMediaRecorder.instances = [];
  const deps = makeDeps();
  const r = new DirectRecorder(deps);
  const ok = await r.start(settings);
  assert.equal(ok, true);
  assert.equal(r.isRecording(), true);
  assert.equal(FakeMediaRecorder.instances.length, 1);
  const rec = FakeMediaRecorder.instances[0];
  assert.equal(rec.startCalls, 1);
  assert.equal(rec.options.mimeType, "audio/webm;codecs=opus");
});

test("start: マイク権限拒否 → false・isRecording false", async () => {
  const deps = makeDeps({ getUserMedia: async () => { throw new Error("denied"); } });
  const r = new DirectRecorder(deps);
  const ok = await r.start(settings);
  assert.equal(ok, false);
  assert.equal(r.isRecording(), false);
});

test("start: MediaRecorder 非対応 → false + isRecording false", async () => {
  const deps = makeDeps({ MediaRecorderCtor: null as any });
  const r = new DirectRecorder(deps);
  const ok = await r.start(settings);
  assert.equal(ok, false);
  assert.equal(r.isRecording(), false);
});

test("stop: ffmpeg 成功 → MP3 パス返却・webm 削除・durationSec 算出", async () => {
  FakeMediaRecorder.instances = [];
  const deleted: string[] = [];
  const deps = makeDeps({ deleteFile: async (p: string) => { deleted.push(p); } });
  const r = new DirectRecorder(deps);
  await r.start(settings);
  const result = await r.stop(settings);
  assert.ok(result, "stop は null でない");
  // Windows パス区切り非依存で検証する（path.join は "C:\\rec\\..." を返す）
  const name = basename(result!.audioPaths[0]);
  assert.equal(name.endsWith(".mp3"), true);
  assert.equal(name.startsWith("録音_"), true);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].endsWith(".webm"), true);
  assert.ok(result!.durationSec >= 0);
  assert.equal(r.isRecording(), false);
});

test("stop: ffmpeg 失敗 → warning=mp3_encode_failed・webm 残存", async () => {
  FakeMediaRecorder.instances = [];
  const deps = makeDeps({ ffmpeg: async () => { throw new Error("no ffmpeg"); } });
  const r = new DirectRecorder(deps);
  await r.start(settings);
  const result = await r.stop(settings);
  assert.ok(result, "stop は null でない");
  assert.equal(result!.warning, "mp3_encode_failed");
  assert.equal(result!.audioPaths[0].endsWith(".webm"), true);
});

test("stop: 録音していない → null", async () => {
  const r = new DirectRecorder(makeDeps());
  const result = await r.stop(settings);
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd obsidian-plugin && npm test 2>&1 | grep -E "(directRecorder|fail)"`
Expected: FAIL — `Cannot find module '../audio/directRecorder'` 等（モジュール未作成）

- [ ] **Step 3: Write the implementation**

`src/audio/directRecorder.ts`:

```typescript
import { Notice } from "obsidian";
import { execFile as nodeExecFile } from "child_process";
import { writeFile as fsWriteFile, unlink as fsUnlink } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GijiSettings } from "../settings";
import { buildRecordingFileName } from "./recorder";

export interface DirectRecordResult {
  audioPaths: string[];
  wavPath?: string;
  durationSec: number;
  warning?: string;
}

export interface DirectRecorderDeps {
  getUserMedia?: (constraints: { audio: boolean }) => Promise<MediaStream>;
  MediaRecorderCtor?: typeof MediaRecorder;
  writeFile?: (path: string, data: ArrayBuffer) => Promise<void>;
  deleteFile?: (path: string) => Promise<void>;
  ffmpeg?: (args: string[]) => Promise<void>;
}

const defaultGetUserMedia = (constraints: { audio: boolean }): Promise<MediaStream> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error("MediaDevices API がありません"));
  }
  return navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints);
};

const defaultWriteFile = (path: string, data: ArrayBuffer): Promise<void> =>
  new Promise((resolve, reject) => {
    fsWriteFile(path, Buffer.from(data), (err) => (err ? reject(err) : resolve()));
  });

const defaultDeleteFile = (path: string): Promise<void> =>
  new Promise((resolve, reject) => {
    fsUnlink(path, (err) => (err ? reject(err) : resolve()));
  });

const defaultFfmpeg = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    nodeExecFile("ffmpeg", args, (err) => (err ? reject(err) : resolve()));
  });

/**
 * PC ダイレクト録音：Chromium の MediaRecorder でマイク録音 → webm → ffmpeg で MP3 64kbps。
 * ブリッジ（Python）不要。戻り値はブリッジの BridgeStopResult と互換形状。
 * 全 deps はテスト用に DI 可能（既定は実機用）。
 */
export class DirectRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startTime = 0;
  private deps: Required<DirectRecorderDeps>;

  constructor(deps: DirectRecorderDeps = {}) {
    const hasCtor =
      typeof globalThis !== "undefined" &&
      typeof (globalThis as any).MediaRecorder !== "undefined";
    this.deps = {
      getUserMedia: defaultGetUserMedia,
      MediaRecorderCtor: (hasCtor ? (globalThis as any).MediaRecorder : null) as typeof MediaRecorder,
      writeFile: defaultWriteFile,
      deleteFile: defaultDeleteFile,
      ffmpeg: defaultFfmpeg,
      ...deps,
    };
  }

  isRecording(): boolean {
    return this.mediaRecorder !== null;
  }

  async start(settings: GijiSettings): Promise<boolean> {
    if (this.isRecording()) return true;
    try {
      if (!this.deps.MediaRecorderCtor) {
        new Notice("⚠️ この環境は PC ダイレクト録音に対応していません");
        return false;
      }
      const stream = await this.deps.getUserMedia({ audio: true });
      const rec = new this.deps.MediaRecorderCtor(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      this.chunks = [];
      rec.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
      };
      rec.start();
      this.mediaRecorder = rec;
      this.startTime = Date.now();
      return true;
    } catch (err: any) {
      new Notice(`⚠️ マイクにアクセスできません: ${err?.message ?? err}`);
      this.mediaRecorder = null;
      return false;
    }
  }

  async stop(settings: GijiSettings): Promise<DirectRecordResult | null> {
    const rec = this.mediaRecorder;
    if (!rec) return null;
    // chunks は this.chunks と同じ配列を参照する。stop() 後の最終
    // ondataavailable フラッシュが完了してから確定するため、
    // this.chunks の差し替えはフラッシュ完了後に行う（先に空配列へ
    // 差し替えると最終チャンクが欠落する）。
    const chunks = this.chunks;
    const startTime = this.startTime;
    this.mediaRecorder = null;

    try {
      // stop() 後、最終 ondataavailable のフラッシュが終わってから onstop が発火する
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      const arrayBuf = await blob.arrayBuffer();
      this.chunks = []; // 次セッション用リセット（chunks は確定済み）
      const base = (settings.recordingFileNameTemplate || "").trim()
        ? buildRecordingFileName(new Date(), settings.recordingFileNameTemplate)
        : `giji_${Date.now()}`; // テンプレート未設定時はブリッジ同様のフォールバック名
      const outDir = (settings.recordingSaveDir || "").trim() || tmpdir();
      const webmPath = join(outDir, `${base}.webm`);
      const mp3Path = join(outDir, `${base}.mp3`);
      await this.deps.writeFile(webmPath, arrayBuf);
      const durationSec = (Date.now() - startTime) / 1000;

      try {
        await this.deps.ffmpeg([
          "-y",
          "-i", webmPath,
          "-codec:a", "libmp3lame",
          "-b:a", "64k",
          "-write_xing", "0",
          mp3Path,
        ]);
        await this.deps.deleteFile(webmPath);
        return { audioPaths: [mp3Path], wavPath: mp3Path, durationSec };
      } catch {
        // 明示的フォールバック：webm のまま残す（ブリッジの warning 文字列と同一）
        return { audioPaths: [webmPath], wavPath: webmPath, durationSec, warning: "mp3_encode_failed" };
      }
    } catch (err: any) {
      new Notice(`⚠️ 録音の停止に失敗しました: ${err?.message ?? err}`);
      return null;
    }
  }
}
```

> 注：`directRecorder.ts` は `buildRecordingFileName` を `./recorder` から import し、`recorder.ts` は `DirectRecorder` を `./directRecorder` から import する**循環参照**になる。両者とも import 先の関数/クラスは**メソッド内部（実行時）**でのみ使用するため、ESM ライブバインディング（tsx）・esbuild CJS プロパティアクセス（main.js）のどちらでも安全に解決される。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd obsidian-plugin && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: 全件 PASS（directRecorder 6 件 + 既存 104 件）

- [ ] **Step 5: Commit**

```bash
git add obsidian-plugin/src/audio/directRecorder.ts obsidian-plugin/src/__tests__/directRecorder.test.ts
git commit -m "feat(plugin): PC ダイレクト録音 DirectRecorder（MediaRecorder→webm→ffmpeg→MP3）
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 設定 recordingMethod + SegmentRecorder 分岐 + デプロイ

**Files:**
- Modify: `obsidian-plugin/src/settings.ts`（型定義・DEFAULT_SETTINGS・UI ドロップダウン）
- Modify: `obsidian-plugin/src/audio/recorder.ts`（start/stop 分岐・transcribePaths 共通化）
- Modify: `obsidian-plugin/src/__tests__/settings.test.ts`（デフォルト assert 追加）
- Modify: `obsidian-plugin/src/__tests__/recorder.test.ts`（SRC_FILES 追加 + 分岐テスト追加）

**Interfaces:**
- Consumes: `DirectRecorder` / `DirectRecordResult` / `DirectRecorderDeps`（Task 1）
- Produces:
  - `export type RecordingMethodId = "bridge" | "direct"`（settings.ts）
  - `GijiSettings.recordingMethod: RecordingMethodId`（デフォルト `"bridge"`）
  - `SegmentRecorder` は `constructor(app: App, direct?: DirectRecorder)` に拡張
  - `SegmentRecorder.start(settings)` / `stop(settings)` が `settings.recordingMethod` で分岐

- [ ] **Step 1: settings.ts に RecordingMethodId + recordingMethod 追加**

`src/settings.ts` の型定義セクション（`AudioSourceId` の行）に追加：

```typescript
export type AudioSourceId = "mic" | "pcLoopback" | "mix";
export type RecordingMethodId = "bridge" | "direct";
```

`GijiSettings` interface（`audioSource: AudioSourceId;` の後に）：

```typescript
  audioSource: AudioSourceId;
  recordingMethod: RecordingMethodId;
```

`DEFAULT_SETTINGS`（`audioSource: "mix",` の後に）：

```typescript
  audioSource: "mix",
  recordingMethod: "bridge",
```

- [ ] **Step 2: settings.ts に UI ドロップダウン「🎙️ 録音手法」追加**

「① 🎙️ 録音」見出しの直後（「🎙️ 録音モード」の前に）挿入：

```typescript
    new Setting(containerEl)
      .setName("🎙️ 録音手法")
      .setDesc("PC ダイレクト録音はブリッジ不要でマイクのみ。Teams 会議（PC 音声）はブリッジ録音を選択")
      .addDropdown((d) =>
        d
          .addOption("bridge", "ブリッジ録音（Python・PC 音声対応）")
          .addOption("direct", "PC ダイレクト録音（ブリッジ不要・マイクのみ）")
          .setValue(s.recordingMethod)
          .onChange(async (v: string) => {
            s.recordingMethod = v as RecordingMethodId;
            await this.save();
          })
      );
```

- [ ] **Step 3: settings.test.ts にデフォルト assert 追加**

`src/__tests__/settings.test.ts` の「recording save dir + file name template」テストに 1 行追加：

```typescript
  assert.equal(DEFAULT_SETTINGS.recordingMethod, "bridge");
```

- [ ] **Step 4: recorder.test.ts に SRC_FILES 追加 + 分岐テスト追加**

`SRC_FILES` 配列に追加：

```typescript
  "../audio/directRecorder.ts",
```

ファイル末尾に分岐テスト追加：

```typescript
/* ---------------- 録音手法（bridge / direct）分岐 ---------------- */

test("recordingMethod=direct なら DirectRecorder に委譲（bridge 非呼出）", async () => {
  // スタブ DirectRecorder：呼び出し回数を記録する
  const stub = {
    startCalls: 0,
    isRecording: () => false,
    start: async () => {
      stub.startCalls++;
      return true;
    },
    stop: async () => null,
  } as any;
  const recorder = new SegmentRecorder({} as any, stub);
  const settings = { recordingMethod: "direct", bridgeBaseUrl: "http://bridge.invalid", audioSource: "mic" } as any;
  const ok = await recorder.start(settings);
  assert.equal(ok, true);
  assert.equal(stub.startCalls, 1, "direct では DirectRecorder.start が 1 回呼ばれる");
});
```

> 注：`SegmentRecorder` は recorder.test.ts 上部の import（`../audio/recorder`）から使う。未 import なら既存 import 文に追加する。`bridgeBaseUrl` に到達不能ホスト `http://bridge.invalid` を指定しているのは、実装が誤ってブリッジ経路を辿った場合に `bridgeHealth` が false → 開始失敗（ok=false・startCalls=0）となり、テストが分岐バグを検出できるようにするため。正しい実装は direct 分岐で即座にスタブへ委譲する（Step 5 参照）。

- [ ] **Step 5: recorder.ts を分岐 + transcribePaths 共通化に書き換え**

`src/audio/recorder.ts` 全体を下記に置換（import 追加・クラス改修）：

```typescript
import { App, Notice } from "obsidian";
import { readFileSync } from "fs";
import { GijiSettings } from "../settings";
import { bridgeHealth, bridgeStart, bridgeStop } from "../bridge";
import { createSttProvider } from "../providers/stt";
import { renderTemplate } from "../notes/saver";
import { splitForTranscription } from "./chunker";
import { DirectRecorder } from "./directRecorder";

export interface SegmentResult {
  text: string;
  durationSec: number;
}

/** bridge / direct 共通の転写対象（BridgeStopResult と DirectRecordResult の共通部分） */
interface TranscribeInput {
  audioPaths: string[];
  wavPath?: string;
  durationSec: number;
  warning?: string;
}

/**
 * 録音ファイルのベース名をテンプレートから生成する。
 * 既定: `録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分{{second}}秒`
 * （拡張子はブリッジ/ダイレクト側で付与: .mp3、変換失敗時 .wav または .webm）
 */
export function buildRecordingFileName(now: Date, template: string): string {
  return renderTemplate(now, template).replace(/[\\/:*?"<>|]/g, "-");
}

export class SegmentRecorder {
  private sessionId: string | null = null;
  private direct: DirectRecorder;

  constructor(private app: App, direct: DirectRecorder = new DirectRecorder()) {
    this.direct = direct;
  }

  isRecording(): boolean {
    return this.sessionId !== null || this.direct.isRecording();
  }

  async start(settings: GijiSettings): Promise<boolean> {
    // PC ダイレクト録音：ブリッジ確認なし・プラグイン単独で開始
    if (settings.recordingMethod === "direct") {
      return this.direct.start(settings);
    }
    try {
      const ok = await bridgeHealth(settings.bridgeBaseUrl);
      if (!ok) {
        new Notice("⚠️ 録音ブリッジが起動していません。先に recorder-bridge を実行してください");
        return false;
      }
      const outDir = (settings.recordingSaveDir || "").trim() || undefined;
      const fileName = (settings.recordingFileNameTemplate || "").trim()
        ? buildRecordingFileName(new Date(), settings.recordingFileNameTemplate)
        : undefined;
      this.sessionId = await bridgeStart(settings.bridgeBaseUrl, { outDir, fileName, audioSource: settings.audioSource });
      return true;
    } catch (err: any) {
      this.sessionId = null;
      new Notice(`⚠️ 録音の開始に失敗しました: ${err?.message ?? err}`);
      throw err;
    }
  }

  /** Vault 内は adapter、Vault 外の絶対パスは Node fs で読む */
  private async readAudioFile(path: string): Promise<ArrayBuffer> {
    const adapter = this.app.vault.adapter as any;
    try {
      return await adapter.readBinary(path);
    } catch {
      // 動的 import("fs") は Chromium が解決できないため静的 import 必須（e2e7f47 参照）。
      const nodeBuf = readFileSync(path);
      return nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);
    }
  }

  /** bridge / direct 共通の後段：MP3/webm → STT → テキスト化 */
  private async transcribePaths(result: TranscribeInput, settings: GijiSettings): Promise<SegmentResult> {
    if (result.warning === "mp3_encode_failed") {
      new Notice("⚠️ MP3 変換に失敗したため WAV で保存しました（ffmpeg を確認してください）");
    }
    new Notice("转写中…");

    const paths = result.audioPaths?.length ? result.audioPaths : [result.wavPath!];
    const stt = createSttProvider(settings);
    const parts: string[] = [];
    for (const path of paths) {
      const buf = await this.readAudioFile(path);
      // プロバイダー制約に応じて分割（24MB 超 / Google 55 秒等）
      for (const chunk of splitForTranscription(buf, stt)) {
        parts.push(await stt.transcribe(chunk, settings.sttLang));
      }
    }
    return { text: parts.join("\n\n"), durationSec: result.durationSec };
  }

  async stop(settings: GijiSettings): Promise<SegmentResult | null> {
    if (this.direct.isRecording()) {
      const result = await this.direct.stop(settings);
      if (!result) return null;
      return await this.transcribePaths(result, settings);
    }
    if (!this.sessionId) {
      new Notice("当前没有进行中的录音");
      return null;
    }
    const sessionId = this.sessionId;
    this.sessionId = null;
    try {
      const result = await bridgeStop(settings.bridgeBaseUrl, sessionId);
      return await this.transcribePaths(result, settings);
    } catch (err: any) {
      new Notice(`${err?.message ?? err}`);
      throw err;
    }
  }
}
```

- [ ] **Step 6: 全テスト実行**

Run: `cd obsidian-plugin && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: 全件 PASS（既存 104 + directRecorder 6 + 分岐 1 = 111 件程度）

- [ ] **Step 7: ビルド + Vault デプロイ**

Run:
```bash
cd obsidian-plugin && npm run build 2>&1 | tail -2
cp main.js manifest.json "C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/giji-obsidian/"
ls -la "C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/giji-obsidian/main.js"
```
Expected: build 成功・main.js が Vault へコピーされる

- [ ] **Step 8: Commit**

```bash
git add obsidian-plugin/src/settings.ts obsidian-plugin/src/audio/recorder.ts obsidian-plugin/src/__tests__/settings.test.ts obsidian-plugin/src/__tests__/recorder.test.ts
git commit -m "feat(plugin): 録音手法選択（bridge/direct）+ SegmentRecorder 分岐・後段共通化
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
