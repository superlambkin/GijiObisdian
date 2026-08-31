# GijiObsidian 単体使用化（外部参照なし）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プラグインフォルダをコピーするだけで任意の Vault で録音（マイク＋PC音声/TEAMS）→文字起こし→要約が動き、`D:\AI-Agent\GijiObsidian` ハードコード・ブリッジ録音・システム ffmpeg 依存を排除する。

**Architecture:** ブリッジ録音（recorder-bridge）を完全削除しダイレクト録音のみへ。PC 音声（TEAMS 含む）は WASAPI ループバック同梱スクリプトでキャプチャ。MP3 変換は wasm `@ffmpeg/ffmpeg` に統一。文字起こしはクラウド（groq）既定、whisper-local は spawn 復活＋外部モデルフォルダ参照。要約は既存（claudian/LLM API/claude/ollama/custom）維持。

**Tech Stack:** TypeScript + esbuild + Obsidian Plugin API + `@ffmpeg/ffmpeg`（wasm）+ node:test / node:assert（テストは `tsx --require ./src/__tests__/setup.cjs`）。

## Global Constraints

- バージョン：`package.json` / `manifest.json` → **`0.12.0`**
- テスト実行：`cd obsidian-plugin && npm test`（`tsx --require ./src/__tests__/setup.cjs --test "src/__tests__/**/*.test.ts"`）
- ブランチ保護：`master` から**新規ブランチ** `feat/standalone-0.12` を切って作業
- `pc_loopback_capture.py` 同梱時に `import config` を**インライン化**する（`SAMPLE_RATE = 16000` / `CHANNELS = 1` をリテラルで置換）。`numpy` / `soundcard` 依存はユーザー環境の pip に委ねる
- 削除する型・フィールド：`RecordingMethodId` / `recordingMethod` / `bridgeBaseUrl` / `bridgeDir` / `bridgeMicDeviceId` / `bridgeSpeakerDeviceId` / `isBridgeSettingDisabled`
- `sttBaseUrl`（whisper-local）のデフォルト `http://127.0.0.1:9000/v1` は**維持**（spawn 復活に必要）
- 同梱対象プラグインフォルダ：`.obsidian/plugins/giji-obsidian/`（デプロイ先）

---

## ファイル構造（変更前→後）

| ファイル | 変更 |
|---|---|
| `src/settings.ts` | 型・DEFAULT_SETTINGS・設定UIから bridge 削除、`sttProvider=groq` 既定、`sttServerDir=""`、`pcLoopbackScriptDir` 追加 |
| `src/bridge.ts` | **削除** |
| `src/bridgeLauncher.ts` | **削除** |
| `src/audio/recorder.ts` | bridge 分岐削除、WASAPI 経由の pcLoopbackScriptDir 対応 |
| `src/audio/directRecorder.ts` | ffmpeg wasm 化、`spawnPcLoopbackCapture` の bridgeDir→pcLoopbackScriptDir |
| `src/audio/deviceList.ts` | bridge fetch 削除（enumerateDevices のみ） |
| `src/ui/claudianButton.ts` | ブリッジボタン削除 |
| `src/whisperLocalLauncher.ts` | spawn 復活＋モデルフォルダ参照 |
| `src/main.ts` | マイグレーション調整、sttWhisperModelDir 既定 |
| `src/commands/importAudio.ts` | whisper-local 分岐維持 |
| `esbuild.config.mjs` | `pc_loopback_capture.py` をプラグインフォルダへコピー |
| `package.json` | `@ffmpeg/core`/`@ffmpeg/util` 整理（`@ffmpeg/ffmpeg` は維持）、version 0.12.0 |
| `manifest.json` | version 0.12.0 |
| `pc_loopback_capture.py`（新規同梱） | `import config` インライン化 |
| 既存テスト各所 | bridge 参照除去・期待値更新 |

---

## Task 1: settings 型・DEFAULT_SETTINGS の bridge 削除と新規値

**Files:**
- Modify: `src/settings.ts`（型定義 63, 114-129 行 / DEFAULT_SETTINGS 153-202 行）
- Test: `src/__tests__/settings.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `GijiSettings`：`sttServerDir: string`（現状維持）、`pcLoopbackScriptDir: string`（新規）、`sttProvider: SttProviderId`
  - 削除：`recordingMethod` / `bridgeBaseUrl` / `bridgeDir` / `bridgeMicDeviceId` / `bridgeSpeakerDeviceId` / `RecordingMethodId` / `isBridgeSettingDisabled`
  - `DEFAULT_SETTINGS`：`sttProvider: "groq"` / `sttServerDir: ""` / `pcLoopbackScriptDir: ""` / `sttWhisperModelDir: ""`
  - `AudioSourceId`（`"mic" | "pcLoopback" | "mix"`）は不変

- [ ] **Step 1: テストを更新**（`src/__tests__/settings.test.ts`）

```ts
test("DEFAULT_SETTINGS sttProvider はクラウド groq 既定", () => {
  assert.equal(DEFAULT_SETTINGS.sttProvider, "groq");
});
test("DEFAULT_SETTINGS は bridge 設定を持たない", () => {
  assert.ok(!("recordingMethod" in DEFAULT_SETTINGS));
  assert.ok(!("bridgeBaseUrl" in DEFAULT_SETTINGS));
  assert.ok(!("bridgeDir" in DEFAULT_SETTINGS));
  assert.equal(DEFAULT_SETTINGS.sttServerDir, "");
  assert.equal(DEFAULT_SETTINGS.pcLoopbackScriptDir, "");
});
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `cd obsidian-plugin && npm test`
Expected: FAIL（`sttProvider` が `whisper-local`、`recordingMethod` の除外が未反映で TS エラー）

- [ ] **Step 3: `src/settings.ts` を実装**

```ts
// 63 行: 削除
// export type RecordingMethodId = "bridge" | "direct";

// GijiSettings（114-129 行）から削除:
//   bridgeBaseUrl / bridgeDir / recordingMethod / bridgeMicDeviceId / bridgeSpeakerDeviceId
// 追加:
//   /** WASAPI ループバック同梱スクリプトのディレクトリ（空文字なら同梱既定 manifest.dir） */
//   pcLoopbackScriptDir: string;

// DEFAULT_SETTINGS（153-202 行）:
//   sttProvider: "groq",                       // 元 "whisper-local"
//   sttServerDir: "",                          // 元 "D:\\AI-Agent\\...\\whisper-local-server"
//   pcLoopbackScriptDir: "",                   // 新規
//   // 削除: bridgeBaseUrl / bridgeDir / recordingMethod / bridgeMicDeviceId / bridgeSpeakerDeviceId

// （144-146 行）isBridgeSettingDisabled 関数を削除
```

```ts
// 追加（既存の書式に揃えて）
const [0]: // 型注記のみ ※削除対象 recordingMethod 参照を除去
```

- [ ] **Step 4: テスト実行 → PASS**

Run: `cd obsidian-plugin && npm test`
Expected: PASS（他テストの bridge 参照エラーは以降のタスクで解消。この時点では settings.test のみの進捗を確認）

- [ ] **Step 5: コミット（ブランチ）**

```bash
cd D:/AI-Agent/GijiObsidian
git checkout -b feat/standalone-0.12
git add obsidian-plugin/src/settings.ts obsidian-plugin/src/__tests__/settings.test.ts
git commit -m "feat(plugin): settings からブリッジ設定を削除し sttProvider=groq / pcLoopbackScriptDir 既定を追加"
```

---

## Task 2: 設定UI からブリッジ関連を撤去

**Files:**
- Modify: `src/settings.ts`（renderRecordingTab 335-535 行）
- Test: `src/__tests__/settings.test.ts`

**Interfaces:**
- Consumes: Task 1 の `GijiSettings` / `AudioSourceId`
- Produces: 設定UIで `audioSource`（`mix`/`mic`/`pcLoopback`）のみを表示、スピーカーデバイスは `directSpeakerDeviceId` を操作

- [ ] **Step 1: テスト更新**（`src/__tests__/settings.test.ts` に録音手法ドロップダウン非表示を検証）

```ts
test("renderRecordingTab に録音手法（recordingMethod）ドロップダウンが無い", () => {
  // Setting スタブの addDropdown は _options に蓄積される
  // GijiSettingsTab をインスタンス化し renderRecordingTab を実行
  // → 全体のオプションに "bridge"/"direct" が含まれない
});
```

※ `setup.cjs` の `Setting.addDropdown` は `_options` を記録する。テストは `App`/`plugin.settings` を渡して `new GijiSettingsTab(app, plugin).renderRecordingTab(contentEl)` を呼び、蓄積されたすべての dropdown に `recordingMethod` 用の bridge/direct が無いことを確認する。

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `cd obsidian-plugin && npm test`
Expected: FAIL（現状の `renderRecordingTab` は `recordingMethod` ドロップダウンを生成する）

- [ ] **Step 3: `renderRecordingTab` を実装**

```ts
// 340-372 行: 「🎙️ 録音手法」Setting ブロック全体を削除
// 343-372 行を削除（録音手法ドロップダウン。ダイレクトのみに固定）

// 376 行: let bridgeUrl / bridgeDir 宣言を削除

// 385-393 行 refreshAudioModeOptions: 「録音手法」呼び出し・updateBridgeDisabled 呼び出しを削除
//   → refreshAudioModeOptions() は audioMode のみ再構築。onChange(recordingMethod) の呼び出しを除去。

// 397 行の setDesc: "direct モードは画面共有ダイアログ、bridge モードは WASAPI..." → 
//   "WASAPI ループバックで PC 音声を取得します（TEAMS 会議の音声もキャプチャ可能）"

// 408 行 audioMode の onChange: 既存維持（s.audioSource = v; await this.save();）

// 411-414 行コメント更新: enumerateDevices のみ

// 439/445 行 currentMicId/currentSpkId: "bridge ? ... : ..." を direct のみに単純化
//   const currentMicId = s.directMicDeviceId;
//   const currentSpkId = s.directSpeakerDeviceId;

// 448-453 行 micDesc: source === "bridge" 分岐を削除（direct / none のみ）

// 455-459 行 speakerDeviceSetting.setDesc: direct 毎に単純化
//   "WASAPI ループバックで PC 音声キャプチャに使われるスピーカーを選択します（pcLoopback / mix 用）"

// 467/469 行 micDeviceDropdown.setValue/onChange: bridge 分岐を削除し direct のみ
//   setValue(s.directMicDeviceId || "")
//   onChange: s.directMicDeviceId = v; await this.save();

// 492/494 行 speakerDeviceDropdown.setValue/onChange: bridge 分岐を削除し direct のみ
//   setValue(s.directSpeakerDeviceId || "")
//   onChange: s.directSpeakerDeviceId = v; await this.save();

// 501-519 行: 「ブリッジ URL」「ブリッジのディレクトリ」Setting を削除

// 521-535 行 updateBridgeDisabled: 関数全体を削除し、呼び出し（535行 updateBridgeDisabled(s.recordingMethod)）も削除
```

- [ ] **Step 4: テスト実行 → PASS**

Run: `cd obsidian-plugin && npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add obsidian-plugin/src/settings.ts obsidian-plugin/src/__tests__/settings.test.ts
git commit -m "feat(plugin): 設定UIから録音手法/ブリッジURL/ブリッジディレクトリを撤去"
```

---

## Task 3: bridge.ts / bridgeLauncher.ts 削除、recorder.ts / deviceList.ts / claudianButton.ts の bridge 分岐除外

**Files:**
- Delete: `src/bridge.ts`, `src/bridgeLauncher.ts`
- Modify: `src/audio/recorder.ts`, `src/audio/deviceList.ts`, `src/ui/claudianButton.ts`
- Test: `src/__tests__/recorder.test.ts`, `src/__tests__/deviceList.test.ts`, `src/__tests__/claudianButton.test.ts`, `src/__tests__/bridgeLauncher.test.ts`

**Interfaces:**
- Consumes: Task 1 の削除型（`recordingMethod` 等）
- Produces: `SegmentRecorder` は `direct.start()` / `direct.stop()` のみ。`listDevices` は `source: "direct" | "none"`。`claudianButton` はブリッジボタンなし

- [ ] **Step 1: テスト更新**

`src/__tests__/recorder.test.ts`：`import { bridgeStart } from "../bridge"` 削除、bridge テスト（52-92 行）削除、「recordingMethod=direct ... bridge 非呼出」テスト（94-108 行）を「常に DirectRecorder に委譲」に変更。

`src/__tests__/deviceList.test.ts`：bridge fetch テスト削除。

`src/__tests__/claudianButton.test.ts`：10-11 行 `shouldShowBridgeButton` テスト削除。

`src/__tests__/bridgeLauncher.test.ts`：**ファイル削除**。

```ts
// recorder.test.ts
test("start: ダイレクト録音のみ（DirectRecorder に委譲）", async () => {
  const deps = { start: async () => true };
  // DirectRecorder を probe し bridge 非依存を確認
});
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `cd obsidian-plugin && npm test`
Expected: FAIL（`../bridge` import 解決不能・bridge 参照残存）

- [ ] **Step 3: 実装**

```bash
rm src/bridge.ts src/bridgeLauncher.ts src/__tests__/bridgeLauncher.test.ts
```

`src/audio/recorder.ts`：
```ts
// import { bridgeHealth, bridgeStart, bridgeStop } from "../bridge";  削除
// sessionId フィールド削除
// start(): bridge 分岐を削除し常に this.direct.start(settings)
// stop(): bridge セッション処理削除、常に this.direct.stop(settings) → transcribePaths
// transcribePaths(): 変更なし（whisper-local は ensureWhisperLocalServer 継続）
```

`src/audio/deviceList.ts`：
```ts
// source: "direct" | "none" に変更（"bridge" 削除）
// DeviceListFetcher.bridgeFetch / defaultBridgeFetch 削除
// listDevices(): recordingMethod 分岐を削除し常に browser()
```

`src/ui/claudianButton.ts`：
```ts
// import { isBridgeUp, launchBridge } from "../bridgeLauncher";  削除
// shouldShowBridgeButton / makeBridgeButton / refreshBridgeButtons / updateBridgeButton 削除
// injectToolbar からブリッジボタン挿入・更新削除
// refresh/syncPolling からブリッジポーリング削除（stt のみ 15 秒）
```

- [ ] **Step 4: テスト実行 → PASS**

Run: `cd obsidian-plugin && npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add -A obsidian-plugin/src
git rm obsidian-plugin/src/bridge.ts obsidian-plugin/src/bridgeLauncher.ts obsidian-plugin/src/__tests__/bridgeLauncher.test.ts
git commit -m "feat(plugin): ブリッジ（recorder-bridge）依存を完全削除しダイレクト録音のみに"
```

---

## Task 4: directRecorder の ffmpeg wasm 化・WASAPI キャプチャの pcLoopbackScriptDir 対応

**Files:**
- Modify: `src/audio/directRecorder.ts`
- Test: `src/__tests__/directRecorder.test.ts`

**Interfaces:**
- Consumes: Task 1 の `pcLoopbackScriptDir`
- Produces:
  - `spawnPcLoopbackCapture(outPath, speakerDeviceId, scriptDir: string)`（`bridgeDir` → `scriptDir` に改名）
  - `deps.ffmpeg` は wasm ラッパー（`(args: string[]) => Promise<void>`）へ。実装は `@ffmpeg/ffmpeg` の `FFmpeg` を `load()` して `exec(args)` するもので、`ffmpegConvert.ts` の `loadFFmpegAssetURLs` を再利用する。

- [ ] **Step 1: テスト更新**（`src/__tests__/directRecorder.test.ts`）

```ts
// makeDeps の spawnPcLoopbackCapture 第3引数を bridgeDir → scriptDir に読み替え
// テスト内の bridgeDir: "C:/bridge" を pcLoopbackScriptDir に変更

test("start: mix + WASAPI で spawnPcLoopbackCapture に pcLoopbackScriptDir を渡す", async () => {
  let captured: { scriptDir: string } | null = null;
  const deps = makeDeps({
    getDisplayMedia: async () => { throw new Error("Not supported"); },
    spawnPcLoopbackCapture: async (_o, _s, scriptDir) => {
      captured = { scriptDir };
      return { stop: async () => "C:/pc.wav" };
    },
  });
  const r = new DirectRecorder(deps);
  await r.start({ ...settings, audioSource: "mix", pcLoopbackScriptDir: "C:/bundled" } as any);
  assert.equal(captured!.scriptDir, "C:/bundled");
});
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `cd obsidian-plugin && npm test`
Expected: FAIL（`bridgeDir` 参照・`spawnPcLoopbackCapture` 第3引数名）

- [ ] **Step 3: 実装**

`src/audio/directRecorder.ts`：
```ts
// DirectRecorderDeps:
//   spawnPcLoopbackCapture?: (outPath, speakerDeviceId, scriptDir: string) => Promise<PcLoopbackCaptureHandle | null>
//   ffmpeg?: (args: string[]) => Promise<void>   // wasm ラッパーへ

// defaultFfmpeg（74-77 行）を削除し、wasm ラッパー defaultFfmpegWasm を導入:
//   import { FFmpeg } from "@ffmpeg/ffmpeg";
//   import { loadFFmpegAssetURLs, ensureFfmpegLoaded } from "./ffmpegConvert"; // ※ffmpegConvert にロード済み判定関数を公開
//   実装: getFfmpeg() → load() → ff.exec(args)

// spawnPcLoopbackCapture（86-137 行）: scriptPath を scriptDir から解決
//   const scriptPath = scriptDir ? join(scriptDir, "pc_loopback_capture.py") : null;
//   if (!scriptPath) return null;
//   pythonCandidates = scriptDir ? [join(scriptDir,"venv","Scripts","python.exe"),"python","py"] : ["python","py"]

// start() の 2b フォールバック: settings.bridgeDir → settings.pcLoopbackScriptDir
// stop() は変わらず（ffmpeg は wasm ラッパーで exec）
```

※ `ffmpegConvert.ts` に `async function ensureFfmpegLoaded(): Promise<FFmpeg>` を追加し、`directRecorder` の wasm ffmpeg ラッパーがロード済みインスタンスを再利用できるようにする（File 変換と競合しない）。

- [ ] **Step 4: テスト実行 → PASS**

Run: `cd obsidian-plugin && npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add obsidian-plugin/src/audio/directRecorder.ts obsidian-plugin/src/audio/ffmpegConvert.ts obsidian-plugin/src/__tests__/directRecorder.test.ts
git commit -m "feat(plugin): directRecorder を wasm ffmpeg 化し WASAPI キャプチャ先を pcLoopbackScriptDir に変更"
```

---

## Task 5: pc_loopback_capture.py を同梱（config 依存インライン化）＋ esbuild コピー

**Files:**
- Create: `obsidian-plugin/pc_loopback_capture.py`
- Modify: `esbuild.config.mjs`
- Test: スクリプト同梱確認（ビルド後にファイル存在）

**Interfaces:**
- Consumes: Task 4 の `scriptDir`（既定 `manifest.dir`）
- Produces: プラグインフォルダ直下に `pc_loopback_capture.py`

- [ ] **Step 1: 同梱スクリプト作成**（`obsidian-plugin/pc_loopback_capture.py`）

`recorder-bridge/pc_loopback_capture.py` をコピーし、`import config` をリテラル置換：

```python
# import config  → 削除し、下記を直接定義
SAMPLE_RATE = 16000
CHANNELS = 1
# 以降同梱。numpy / soundcard はユーザー環境に pip install が必要（起動失敗時に案内）
```

- [ ] **Step 2: esbuild にコピー追加**

`esbuild.config.mjs`：
```js
// ffmpegAssets プラグインの build.onEnd に追加:
await copyFile(resolve(root, "src/../pc_loopback_capture.py") /* または同梱元 */, resolve(root, "pc_loopback_capture.py"));
```

※実際は同梱元（プラグインリポジトリ管理下）から `resolve(root, "pc_loopback_capture.py")` へコピー。既に `obsidian-plugin/pc_loopback_capture.py` がソース管理下にある場合はコピー不要（フォルダ同梱で自動的に含まれる）。

- [ ] **Step 3: ビルドして検証**

Run: `cd obsidian-plugin && npm run build`
Expected: `obsidian-plugin/pc_loopback_capture.py` が存在。`main.js` / `manifest.json` 生成。`ffmpeg-core.js` / `ffmpeg-core.wasm` / `worker.js` も同梱。

- [ ] **Step 4: コミット**

```bash
git add obsidian-plugin/pc_loopback_capture.py obsidian-plugin/esbuild.config.mjs
git commit -m "feat(plugin): WASAPI ループバックキャプチャスクリプトを同梱（config 依存インライン化）"
```

---

## Task 6: whisper-local の spawn 復活＋外部モデルフォルダ参照

**Files:**
- Modify: `src/whisperLocalLauncher.ts`, `src/main.ts`
- Test: `src/__tests__/whisperLocalLauncher.test.ts`

**Interfaces:**
- Consumes: Task 1 の `sttServerDir` / `sttWhisperModelDir`
- Produces: `ensureWhisperLocalServer(settings, opts)` は `sttServerDir` の `start_whisper_local.bat` を spawn。`WHISPER_DOWNLOAD_ROOT` に `sttWhisperModelDir` を渡す

- [ ] **Step 1: テスト更新**

`src/__tests__/whisperLocalLauncher.test.ts`：`sttServerDir` を設定値（例 `"C:/whisper"`）に。spawn 時モデルフォルダを検証するテストを追加。

```ts
test("ensureWhisperLocalServer が WHISPER_DOWNLOAD_ROOT に sttWhisperModelDir を渡す", async () => {
  // spawnImpl を probe し env.WHISPER_DOWNLOAD_ROOT === "C:/models" を検証
});
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `cd obsidian-plugin && npm test`
Expected: （既存 spawn はあるがモデルフォルダ検証がないため新規失敗）

- [ ] **Step 3: 実装**

`src/whisperLocalLauncher.ts`：
```ts
// env.WHISPER_DOWNLOAD_ROOT = settings.sttWhisperModelDir || undefined; （維持。モデルフォルダ参照）
// scriptPath = join(settings.sttServerDir, "start_whisper_local.bat") （維持・spawn 復活）
// sttServerDir が空のとき clear なエラー:
if (!settings.sttServerDir) {
  throw new Error("ローカル Whisper サーバのディレクトリが未設定です。設定タブで指定してください");
}
```

`src/main.ts`（loadSettings）：
```ts
// sttWhisperModelDir 既定（維持）: join(this.manifest.dir ?? "", "Model")
// ※ユーザーが任意の外部フォルダを指定可能（sttWhisperModelDir はそのまま）
// recordingMethod マイグレーション削除（STT_PROVIDERS 側は維持）
```

- [ ] **Step 4: テスト実行 → PASS**

Run: `cd obsidian-plugin && npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add obsidian-plugin/src/whisperLocalLauncher.ts obsidian-plugin/src/main.ts obsidian-plugin/src/__tests__/whisperLocalLauncher.test.ts
git commit -m "feat(plugin): whisper-local spawn 復活・外部モデルフォルダ参照・未設定時エラー"
```

---

## Task 7: 依存整理＋仕上げ（package.json / manifest / CHANGELOG）

**Files:**
- Modify: `package.json`, `manifest.json`, `CHANGELOG.md`
- Test: ビルド＋全テスト

**Interfaces:**
- Consumes: 全タスク
- Produces: `0.12.0` リリース

- [ ] **Step 1: package.json 依存整理**

```json
"dependencies": {
  "@ffmpeg/ffmpeg": "^0.12.15"
}
```
`@ffmpeg/core` / `@ffmpeg/util` を削除（wasm 実体 `ffmpeg-core.js` / `ffmpeg-core.wasm` は esbuild コピーで同梱継続）。`@ffmpeg/core`/`@ffmpeg/util` はソースで未 import のため安全。

- [ ] **Step 2: version 更新**

`package.json` → `"version": "0.12.0"`。`manifest.json` → `"version": "0.12.0"`。

- [ ] **Step 3: CHANGELOG 追記**

`CHANGELOG.md` 先頭に：

```markdown
## v0.12.0 (2026-08-31)
### Changed
- ブリッジ録音（recorder-bridge）を完全削除し、ダイレクト録音のみに統一
- PC 音声（TEAMS 含む）を WASAPI ループバック同梱スクリプトでキャプチャ
- MP3 変換をシステム ffmpeg CLI → wasm（@ffmpeg/ffmpeg）に統一
- 文字起こし既定を whisper-local → クラウド groq に変更
- sttServerDir / bridgeDir の D:\AI-Agent ハードコードを空文字に
- whisper-local は spawn 復活＋外部モデルフォルダ参照（sttWhisperModelDir）
```

- [ ] **Step 4: ビルド＋全テスト**

Run: `cd obsidian-plugin && npm run build && npm test`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット＋ブランチ確認**

```bash
git add -A obsidian-plugin
git commit -m "chore(plugin): v0.12.0 依存整理・リリース（単体使用化）"
```

- [ ] **Step 6: デプロイ（手動確認用リマインダー）**

Run: `cd obsidian-plugin && npm run build` → 生成物を `.obsidian/plugins/giji-obsidian/` へコピー。手動 UAT（TEAMS 録音・groq 文字起こし・whisper-local モデル参照）。

---

## 自己レビュー（計画 vs 設計書）

- **spec カバレッジ**：
  - ブリッジ完全削除 → Task 1/2/3 ✅
  - directRecorder ffmpeg wasm 化 → Task 4 ✅
  - WASAPI pcLoopbackScriptDir → Task 4/5 ✅
  - whisper-local spawn 復活＋モデルフォルダ → Task 6 ✅
  - sttProvider=groq 既定 / sttServerDir="" / D:\AI-Agent 除去 → Task 1 ✅
  - Claude CLI 追加なし → スコープ外（設計書 §8）✅
  - pc_loopback_capture.py 同梱・config インライン化 → Task 5 ✅
  - 未使用 @ffmpeg/core/util 整理 → Task 7 ✅
- **プレースホルダ**：なし（各ステップに実コード／具体手順を記載）
- **型一貫性**：`pcLoopbackScriptDir` / `spawnPcLoopbackCapture(..., scriptDir)` / `sttWhisperModelDir` 全タスクで統一
