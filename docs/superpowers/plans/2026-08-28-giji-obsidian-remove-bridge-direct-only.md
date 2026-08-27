# GijiObsidian ブリッジ削除・ダイレクトのみ化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GijiObsidian プラグインからブリッジ録音を完全に削除し、録音手法をダイレクトのみに固定する。

**Architecture:** `recordingMethod`（bridge/direct）分岐を撤去し、`SegmentRecorder` は常に `DirectRecorder` へ委譲する。ブリッジ API（`bridge.ts`）・自動起動（`bridgeLauncher.ts`）・ブリッジ設定 UI・ブリッジボタンを削除。録音モード（`audioSource`）の option 値 `mix` / `mic` / `pcLoopback` は維持し、ラベル表示のみ「MIX / マイクのみ / スピーカー」に変更する。`recorder-bridge`（Python）プロジェクトは削除しない。

**Tech Stack:** TypeScript / esbuild / node:test + tsx / Obsidian API

## Global Constraints

- ソース: `D:\AI-Agent\giji-obsidian\obsidian-plugin`（git リポジトリ `D:\AI-Agent\giji-obsidian`、master）
- テスト: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && npm test`（全件 PASS 必須）
- ビルド: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && npm run build`（main.js 生成）
- デプロイ先: `C:\Users\superlambkin\OneDrive\Edge\Obsidian Vault\.obsidian\plugins\giji-obsidian\`
- バージョン: v0.8.7 → **v0.9.0**（`package.json` / `manifest.json` 両方）
- `audioSource` の option 値は `mix` / `mic` / `pcLoopback` を**変更しない**（`directRecorder.ts` が参照）
- `recorder-bridge`（Python）プロジェクトは**削除しない**
- MIX 時に `getDisplayMedia` が失敗する警告は**残す**（設計書 §3 決定事項）
- 設計書: `docs/superpowers/specs/2026-08-28-giji-obsidian-remove-bridge-direct-only-design.md`

---

### Task 1: settings.ts から bridge を全削除 + settings.test.ts 修正

**Files:**
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\settings.ts`
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__\settings.test.ts`

**Interfaces:**
- Consumes: 既存 `GijiSettings` / `DEFAULT_SETTINGS`（変更対象）
- Produces: bridge フィールドを持たない `GijiSettings`。`AudioSourceId` は維持。`isBridgeSettingDisabled` は削除。

- [ ] **Step 1: settings.ts から型・デフォルトの bridge フィールドを削除**

`src/settings.ts` を編集する。

1a. 型定義（63 行目付近）から `RecordingMethodId` を削除:

```ts
export type AudioSourceId = "mic" | "pcLoopback" | "mix";
```

1b. `GijiSettings` の「① 録音」セクション（114〜129 行目）を以下に置換:

```ts
  // ① 録音
  recordingSaveDir: string;
  recordingFileNameTemplate: string;
  audioSource: AudioSourceId;
  appendRecordEnabled: boolean;
  /** PC ダイレクト録音時に getUserMedia に渡すマイク deviceId。空文字ならシステム既定 */
  directMicDeviceId: string;
  /** PC ダイレクト録音時のスピーカー指定（getUserMedia は出力デバイスを受け取らないため現状は保存のみ） */
  directSpeakerDeviceId: string;
```

1c. `isBridgeSettingDisabled` 関数（143〜146 行目）を削除:

```ts
/** STT 並列度を有効範囲（1〜4）にクランプする */
export function clampSttConcurrency(value: number): number {
  return Math.max(1, Math.min(4, Math.floor(value)));
}
```

1d. `DEFAULT_SETTINGS`（185〜195 行目）から bridge 関連を削除し、以下に置換:

```ts
  recordingSaveDir: DEFAULT_RECORDING_SAVE_DIR,
  recordingFileNameTemplate: "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分{{second}}秒",
  audioSource: "mix",
  appendRecordEnabled: true,
  directMicDeviceId: "",
  directSpeakerDeviceId: "",
```

- [ ] **Step 2: settings.ts の設定 UI から bridge を削除**

`renderRecordingTab`（`src/settings.ts` 335 行目〜）を編集する。**録音手法ドロップダウン・ブリッジ URL・ブリッジのディレクトリ・`refreshAudioModeOptions`・`updateBridgeDisabled` を削除**し、録音モードのラベルを変更する。

2a. 「🎙️ 録音手法」ドロップダウン（343〜372 行目の `new Setting(content).setName("🎙️ 録音手法")...` ブロック全体）を削除。

2b. 変数宣言（374〜376 行目）を以下に置換:

```ts
    let audioMode: any;
```

2c. `refreshAudioModeOptions`（378〜393 行目）を削除。

2d. 「🎙️ 録音モード」ドロップダウン（395〜409 行目）を以下に置換:

```ts
    new Setting(content)
      .setName("🎙️ 録音モード")
      .setDesc("MIX はマイク + PC 音声を試みますが、Obsidian（Electron）では PC 音声を取得できずマイクのみで録音します")
      .addDropdown((d) => {
        audioMode = d;
        d.addOption("mix", "マイク + PC 音声");
        d.addOption("mic", "マイクのみ");
        d.addOption("pcLoopback", "スピーカー（PC 音声のみ）");
        d.setValue(s.audioSource ?? "mix")
          .onChange(async (v: string) => {
            s.audioSource = v as AudioSourceId;
            await this.save();
          });
      });
```

2e. `repopulateDevices`（433〜460 行目）を以下に置換:

```ts
    const repopulateDevices = async () => {
      const got: DeviceListResult = await listDevices(s);
      // マイク側を再構築
      micDeviceDropdown.selectEl.innerHTML = "";
      micDeviceDropdown.addOption("", "（システム既定）");
      for (const m of got.microphones) micDeviceDropdown.addOption(m.id, m.name || m.id);
      safeSetValue(micDeviceDropdown, s.directMicDeviceId || "");
      // スピーカー側を再構築
      speakerDeviceDropdown.selectEl.innerHTML = "";
      speakerDeviceDropdown.addOption("", "（システム既定）");
      for (const sp of got.speakers) speakerDeviceDropdown.addOption(sp.id, sp.name || sp.id);
      safeSetValue(speakerDeviceDropdown, s.directSpeakerDeviceId || "");
      // desc 更新
      const micDesc =
        got.source === "direct"
          ? "ブラウザから取得"
          : "（デバイス一覧が取得できませんでした）";
      micDeviceSetting.setDesc(`録音に使うマイクデバイスを選択します。${micDesc}`);
      speakerDeviceSetting.setDesc(
        "ダイレクト録音ではスピーカーはキャプチャ制御に使われません（設定保持のみ）"
      );
    };
```

2f. `micDeviceSetting`（462〜485 行目）のドロップダウン onChange を以下に置換:

```ts
      .addDropdown((d) => {
        micDeviceDropdown = d;
        d.addOption("", "（システム既定）").setValue(s.directMicDeviceId || "").onChange(async (v: string) => {
          s.directMicDeviceId = v;
          await this.save();
        });
      })
```

2g. `speakerDeviceSetting`（487〜499 行目）を以下に置換:

```ts
    speakerDeviceSetting = new Setting(content)
      .setName("🔊 録音用スピーカーデバイス（設定保持のみ）")
      .setDesc("ダイレクト録音ではスピーカーはキャプチャ制御に使われません（設定保持のみ）")
      .addDropdown((d) => {
        speakerDeviceDropdown = d;
        d.addOption("", "（システム既定）").setValue(s.directSpeakerDeviceId || "").onChange(async (v: string) => {
          s.directSpeakerDeviceId = v;
          await this.save();
        });
      });
```

2h. 「ブリッジ URL」（501〜509 行目）と「ブリッジのディレクトリ」（511〜519 行目）の `new Setting` ブロックを削除。

2i. `updateBridgeDisabled` 関数（521〜534 行目）とその呼び出し `updateBridgeDisabled(s.recordingMethod);`（535 行目）を削除。

- [ ] **Step 3: settings.test.ts から bridge 参照を削除**

`src/__tests__/settings.test.ts` を編集する。

3a. import（3〜10 行目）から `isBridgeSettingDisabled` を削除:

```ts
import {
  DEFAULT_SETTINGS,
  GijiSettingsTab,
  isLocalSttProvider,
  SETTINGS_TABS,
  clampSttConcurrency,
} from "../settings";
```

3b. 「DEFAULT_SETTINGS has required fields」テスト（16 行目）から `bridgeBaseUrl` アサーション行を削除。

3c. 「DEFAULT_SETTINGS has recording save dir + file name template」テスト（38 行目）から `recordingMethod` アサーション行を削除。

3d. 「DEFAULT_SETTINGS has device id fields (empty by default)」テスト（41〜46 行目）を以下に置換:

```ts
test("DEFAULT_SETTINGS has device id fields (empty by default)", () => {
  assert.equal(DEFAULT_SETTINGS.directMicDeviceId, "");
  assert.equal(DEFAULT_SETTINGS.directSpeakerDeviceId, "");
});
```

3e. 「isBridgeSettingDisabled」テスト（64〜67 行目）を削除。

- [ ] **Step 4: テスト実行**

Run: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && npm test`
Expected: 全件 PASS（bridge 参照が残っていると FAIL になる）

- [ ] **Step 5: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/settings.ts obsidian-plugin/src/__tests__/settings.test.ts
git commit -m "refactor(plugin): settings からブリッジ設定・録音手法ドロップダウンを削除（ダイレクトのみ化）"
```

---

### Task 2: deviceList.ts から bridge フェッチ削除 + deviceList.test.ts 修正

**Files:**
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\audio\deviceList.ts`
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__\deviceList.test.ts`

**Interfaces:**
- Consumes: `GijiSettings`
- Produces: `listDevices(settings, fetcher): Promise<DeviceListResult>`（`source: "direct" | "none"` のみ）

- [ ] **Step 1: 失敗するテストを書く（deviceList.test.ts 全面書き換え）**

`src/__tests__/deviceList.test.ts` を以下で置換:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { listDevices } from "../audio/deviceList";

const baseSettings = {} as any;

test("browser enumerate で source=direct を返す", async () => {
  const result = await listDevices(baseSettings, {
    browserEnumerate: async () =>
      [
        { kind: "audioinput", deviceId: "in-1", label: "Mic" } as MediaDeviceInfo,
        { kind: "audiooutput", deviceId: "out-1", label: "Speaker" } as MediaDeviceInfo,
      ] as MediaDeviceInfo[],
  });
  assert.equal(result.source, "direct");
  assert.equal(result.microphones.length, 1);
  assert.equal(result.microphones[0].id, "in-1");
  assert.equal(result.speakers.length, 1);
  assert.equal(result.speakers[0].id, "out-1");
});

test("browser enumerate が例外を投げると source=none", async () => {
  const result = await listDevices(baseSettings, {
    browserEnumerate: async () => {
      throw new Error("permission denied");
    },
  });
  assert.equal(result.source, "none");
});

test("audioinput のみ microphones、audiooutput のみ speakers に分類", async () => {
  const result = await listDevices(baseSettings, {
    browserEnumerate: async () =>
      [
        { kind: "audioinput", deviceId: "in-1", label: "Mic1" } as MediaDeviceInfo,
        { kind: "audioinput", deviceId: "in-2", label: "Mic2" } as MediaDeviceInfo,
        { kind: "audiooutput", deviceId: "out-1", label: "Spk" } as MediaDeviceInfo,
        { kind: "videoinput", deviceId: "cam-1", label: "Cam" } as MediaDeviceInfo,
      ] as MediaDeviceInfo[],
  });
  assert.equal(result.microphones.length, 2);
  assert.equal(result.speakers.length, 1);
  assert.ok(!result.microphones.some((m) => m.id === "cam-1"));
  assert.ok(!result.speakers.some((s) => s.id === "cam-1"));
});

test("label が空なら (unnamed input/output) にフォールバック", async () => {
  const result = await listDevices(baseSettings, {
    browserEnumerate: async () =>
      [
        { kind: "audioinput", deviceId: "in-x", label: "" } as MediaDeviceInfo,
        { kind: "audiooutput", deviceId: "out-x", label: "" } as MediaDeviceInfo,
      ] as MediaDeviceInfo[],
  });
  assert.equal(result.microphones[0].name, "(unnamed input)");
  assert.equal(result.speakers[0].name, "(unnamed output)");
});
```

- [ ] **Step 2: テスト実行して失敗を確認**

Run: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && npm test -- --test-name-pattern="deviceList"`
Expected: FAIL（`bridgeFetch` が型エラーではなく実行時に渡されていないため、最初のテストは `source` が `direct` にならず FAIL。また `DeviceListFetcher` に `bridgeFetch` が残っている）

- [ ] **Step 3: deviceList.ts から bridge フェッチを削除**

`src/audio/deviceList.ts` を以下で置換:

```ts
import { GijiSettings } from "../settings";

export interface AudioDeviceInfo {
  id: string;
  name: string;
}

export interface DeviceListResult {
  microphones: AudioDeviceInfo[];
  speakers: AudioDeviceInfo[];
  /** どのソースから取得したか */
  source: "direct" | "none";
}

export interface DeviceListFetcher {
  browserEnumerate?: () => Promise<MediaDeviceInfo[]>;
}

const defaultBrowserEnumerate = async (): Promise<MediaDeviceInfo[]> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    throw new Error("no enumerateDevices");
  }
  return navigator.mediaDevices.enumerateDevices();
};

/**
 * 録音デバイス一覧を取得する。常に navigator.mediaDevices.enumerateDevices() を使う。
 * 失敗時は空配列 + source="none"。
 */
export async function listDevices(
  settings: GijiSettings,
  fetcher: DeviceListFetcher = {}
): Promise<DeviceListResult> {
  const browser = fetcher.browserEnumerate ?? defaultBrowserEnumerate;
  try {
    const all = await browser();
    return {
      microphones: all
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({ id: d.deviceId, name: d.label || "(unnamed input)" })),
      speakers: all
        .filter((d) => d.kind === "audiooutput")
        .map((d) => ({ id: d.deviceId, name: d.label || "(unnamed output)" })),
      source: "direct",
    };
  } catch {
    return { microphones: [], speakers: [], source: "none" };
  }
}
```

> 注: `settings` パラメータは今は未使用だが、`settings.ts` からの呼び出し `listDevices(s)` とのシグネチャ互換のため残す。`strict` は `noUnusedParameters` を含まないため問題なし。

- [ ] **Step 4: テスト実行して合格を確認**

Run: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && npm test`
Expected: 全件 PASS

- [ ] **Step 5: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/audio/deviceList.ts obsidian-plugin/src/__tests__/deviceList.test.ts
git commit -m "refactor(plugin): deviceList からブリッジフェッチを削除（enumerateDevices のみ）"
```

---

### Task 3: recorder.ts から bridge 分岐削除 + recorder.test.ts 修正

**Files:**
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\audio\recorder.ts`
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__\recorder.test.ts`

**Interfaces:**
- Consumes: `DirectRecorder`（既存）
- Produces: `SegmentRecorder.start(settings): Promise<boolean>`（常に direct へ委譲）、`SegmentRecorder.stop(settings): Promise<SegmentResult | null>`

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/recorder.test.ts` を編集する。

1a. import（4 行目）から `bridgeStart` を削除:

```ts
import { readFileSync } from "node:fs";
import { buildRecordingFileName, buildSegmentResult, SegmentRecorder } from "../audio/recorder";
```

1b. `SRC_FILES` 配列（15 行目）から `"../bridge.ts",` を削除:

```ts
const SRC_FILES = [
  "../audio/recorder.ts",
  "../audio/directRecorder.ts",
  "../commands/importAudio.ts",
  "../commands/recordSegment.ts",
  "../providers/stt.ts",
  "../providers/llm.ts",
  "../test/sttTest.ts",
  "../ui/filePicker.ts",
];
```

1c. bridgeStart テスト 3 件（52〜92 行目）を削除。

1d. 「recordingMethod=direct なら DirectRecorder に委譲（bridge 非呼出）」（96〜112 行目）を以下に置換:

```ts
test("SegmentRecorder.start は DirectRecorder に委譲する", async () => {
  const stub = {
    startCalls: 0,
    isRecording: () => false,
    start: async () => {
      stub.startCalls++;
      return true;
    },
    stop: async () => null,
  } as any;
  const recorder = new SegmentRecorder({} as any, "", stub);
  const settings = { audioSource: "mic" } as any;
  const ok = await recorder.start(settings);
  assert.equal(ok, true);
  assert.equal(stub.startCalls, 1, "ダイレクト録音では DirectRecorder.start が 1 回呼ばれる");
});
```

- [ ] **Step 2: テスト実行して失敗を確認**

Run: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && npm test -- --test-name-pattern="recorder"`
Expected: まだ `recorder.ts` が bridge を import しているため、`../bridge` は存在するが、`recorder.test.ts` から `bridgeStart` 参照が消え、`recorder.ts` 側は未変更のためテストは現状 PASS のまま。ただし Step 3 後に FAIL になる前提で先に進む（TDD: テストは削除対象の挙動を外す）。

- [ ] **Step 3: recorder.ts から bridge 分岐を削除**

`src/audio/recorder.ts` を編集する。

3a. import（4 行目）から bridge を削除:

```ts
import { App, Notice } from "obsidian";
import { readFileSync } from "fs";
import { GijiSettings } from "../settings";
import { createSttProvider } from "../providers/stt";
import { ensureWhisperLocalServer } from "../whisperLocalLauncher";
import { renderTemplate } from "../notes/saver";
import { writeDebugLog } from "../util/debugLog";
import { splitForTranscription } from "./chunker";
import { DirectRecorder } from "./directRecorder";
```

3b. `sessionId` フィールド（55 行目）を削除:

```ts
export class SegmentRecorder {
  private direct: DirectRecorder;
  private startTime?: Date;
```

3c. `start()`（68〜107 行目）を以下に置換:

```ts
  async start(settings: GijiSettings): Promise<boolean> {
    this.startTime = new Date();
    // PC ダイレクト録音：ブリッジ確認なし・プラグイン単独で開始
    await writeDebugLog(
      this.app,
      this.manifestDir,
      `[${new Date().toISOString()}] stage=device_select mode=direct mic_id=${(settings.directMicDeviceId || "").trim() || "(default)"} speaker_id=${(settings.directSpeakerDeviceId || "").trim() || "(default)"}`
    ).catch(() => {});
    return this.direct.start(settings);
  }
```

3d. `stop()`（164〜183 行目）を以下に置換:

```ts
  async stop(settings: GijiSettings): Promise<SegmentResult | null> {
    if (this.direct.isRecording()) {
      const result = await this.direct.stop(settings);
      if (!result) return null;
      return await this.transcribePaths(result, settings);
    }
    new Notice("進行中の録音がありません");
    return null;
  }
```

- [ ] **Step 4: テスト実行して合格を確認**

Run: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && npm test`
Expected: 全件 PASS

- [ ] **Step 5: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/audio/recorder.ts obsidian-plugin/src/__tests__/recorder.test.ts
git commit -m "refactor(plugin): SegmentRecorder から bridge 分岐を削除（常にダイレクト録音）"
```

---

### Task 4: claudianButton.ts からブリッジボタン削除 + claudianButton.test.ts 修正

**Files:**
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\ui\claudianButton.ts`
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__\claudianButton.test.ts`

**Interfaces:**
- Consumes: `SegmentRecorder` / `isWhisperLocalUp`（既存）
- Produces: `setupClaudianButton(plugin, settings, timer): { cleanup: () => void; refresh: () => void }`（ブリッジボタンなし）

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/claudianButton.test.ts` から `shouldShowBridgeButton` import とそのテスト（4 行目・10〜13 行目）を削除。

- [ ] **Step 2: claudianButton.ts からブリッジコードを削除**

`src/ui/claudianButton.ts` を編集する。

2a. import（4 行目）を削除:

```ts
import { SegmentRecorder } from "../audio/recorder";
import { isWhisperLocalUp } from "../whisperLocalLauncher";
```

2b. `shouldShowBridgeButton`（17〜19 行目）を削除。

2c. `updateBridgeButton` / `refreshBridgeButtons` / `makeBridgeButton`（130〜185 行目）を削除。

2d. `injectToolbar`（338〜360 行目）を以下に置換:

```ts
function injectToolbar(plugin: Plugin, settings: GijiSettings, toolbar: HTMLElement, timer?: RecordingTimer) {
  const hasRecord = toolbar.querySelector(".giji-record-btn");
  if (!hasRecord) {
    const recordBtn = makeButton(plugin, settings, timer);
    toolbar.appendChild(recordBtn);
  }
}
```

2e. `setupClaudianButton`（362〜442 行目）を以下に置換:

```ts
export function setupClaudianButton(
  plugin: Plugin,
  settings: GijiSettings,
  timer?: RecordingTimer,
): { cleanup: () => void; refresh: () => void } {
  let sttInterval: ReturnType<typeof setInterval> | null = null;

  function scan() {
    const toolbars = document.querySelectorAll(TOOLBAR_SELECTOR);
    for (let i = 0; i < toolbars.length; i++) {
      injectToolbar(plugin, settings, toolbars[i] as HTMLElement, timer);
    }
  }

  function refresh() {
    scan();
    // ローカル STT サーバ未起動警告の定期更新（15 秒間隔）
    if (!sttInterval) {
      void refreshSttDownState(settings).catch(() => {});
      sttInterval = setInterval(() => {
        void refreshSttDownState(settings).catch((err) =>
          console.warn("[giji] stt server status refresh failed", err)
        );
      }, 15000);
    }
  }

  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const m of mutations) {
      if (m.type !== "childList") continue;
      for (let i = 0; i < m.addedNodes.length; i++) {
        const node = m.addedNodes[i];
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches?.(TOOLBAR_SELECTOR) || node.querySelector(TOOLBAR_SELECTOR)) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) break;
    }
    if (shouldScan) scan();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  refresh();

  return {
    refresh,
    cleanup: () => {
      if (sttInterval) {
        clearInterval(sttInterval);
        sttInterval = null;
      }
      observer.disconnect();
      document.querySelectorAll(`[${BTN_MARK}]`).forEach((btn) => btn.remove());
    },
  };
}
```

- [ ] **Step 3: テスト実行**

Run: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && npm test`
Expected: 全件 PASS

- [ ] **Step 4: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/ui/claudianButton.ts obsidian-plugin/src/__tests__/claudianButton.test.ts
git commit -m "refactor(plugin): ツールバーからブリッジボタンを削除"
```

---

### Task 5: bridge.ts / bridgeLauncher.ts / bridgeLauncher.test.ts を削除

**Files:**
- Delete: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\bridge.ts`
- Delete: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\bridgeLauncher.ts`
- Delete: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__\bridgeLauncher.test.ts`

**Interfaces:**
- Consumes: なし（Task 1〜4 で全参照を除去済み）
- Produces: なし

- [ ] **Step 1: ファイル削除**

```bash
cd D:\AI-Agent\giji-obsidian
git rm obsidian-plugin/src/bridge.ts obsidian-plugin/src/bridgeLauncher.ts obsidian-plugin/src/__tests__/bridgeLauncher.test.ts
```

- [ ] **Step 2: 参照が残っていないことを確認**

Run: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && grep -rn "from \"../bridge\"\|from \"../bridgeLauncher\"\|from \"./bridge\"\|from \"./bridgeLauncher\"\|bridgeStart\|bridgeStop\|launchBridge\|isBridgeUp" src --include="*.ts" | grep -v node_modules`
Expected: 出力なし（`nodeFetch.ts` の `----gijibridge` 境界文字列と `claudianApi.ts` のコメント「claudian-selection-bridge」は対象外）

- [ ] **Step 3: テスト実行**

Run: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && npm test`
Expected: 全件 PASS

- [ ] **Step 4: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git commit -m "chore(plugin): bridge.ts / bridgeLauncher.ts / bridgeLauncher.test.ts を削除"
```

---

### Task 6: バージョン 0.9.0 + CHANGELOG + ビルド + デプロイ

**Files:**
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\package.json`
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\manifest.json`
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\CHANGELOG.md`
- Modify（ビルド成果物）: `D:\AI-Agent\giji-obsidian\obsidian-plugin\main.js`
- Deploy: `C:\Users\superlambkin\OneDrive\Edge\Obsidian Vault\.obsidian\plugins\giji-obsidian\`

**Interfaces:**
- Consumes: 全タスクの成果物
- Produces: v0.9.0 としてデプロイされたプラグイン

- [ ] **Step 1: バージョン更新**

`package.json` の `"version": "0.8.7"` → `"0.9.0"`。
`manifest.json` の `"version": "0.8.7"` → `"0.9.0"`。

- [ ] **Step 2: CHANGELOG 追記**

`CHANGELOG.md` の先頭（`# Changelog` の直後、`## [0.8.0]` の前）に以下を追加:

```markdown
## [0.9.0] - 2026-08-28

### 🔧 ブリッジ録音を削除・ダイレクトのみ化

- 🗑️ **ブリッジ録音（recorder-bridge）を完全削除**：録音手法ドロップダウン、ブリッジ URL / ディレクトリ設定、ブリッジボタン、`bridge.ts` / `bridgeLauncher.ts` を撤去
- ✅ **録音手法は PC ダイレクト録音（`MediaRecorder`）のみ**
- 🎙️ **録音モード**：MIX（デフォルト）/ MIC / スピーカー を選択可能に維持
- ⚠️ ダイレクト録音では Obsidian（Electron）の制約により PC 音声（システム音）はキャプチャ不可（MIX 選択時はマイクのみで録音し警告を表示）
```

- [ ] **Step 3: ビルド**

Run: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && npm run build`
Expected: `main.js` が再生成される（エラーなし）

- [ ] **Step 4: デプロイ**

Run:
```bash
cp "D:/AI-Agent/giji-obsidian/obsidian-plugin/main.js" "D:/AI-Agent/giji-obsidian/obsidian-plugin/manifest.json" "C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/giji-obsidian/" && echo "deployed"
```
Expected: `deployed`（`main.js` / `manifest.json` のタイムスタンプ更新）

- [ ] **Step 5: ビルド成果物を確認**

Run: `cd "C:\Users\superlambkin\OneDrive\Edge\Obsidian Vault\.obsidian\plugins\giji-obsidian" && grep -c "bridgeStart\|launchBridge" main.js && grep '"version"' manifest.json`
Expected: `grep -c` の結果が `0`、`manifest.json` に `"version": "0.9.0"`

- [ ] **Step 6: テスト最終確認 + コミット**

Run: `cd D:\AI-Agent\giji-obsidian\obsidian-plugin && npm test`
Expected: 全件 PASS

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/package.json obsidian-plugin/manifest.json obsidian-plugin/CHANGELOG.md obsidian-plugin/main.js
git commit -m "build(plugin): v0.9.0 ブリッジ削除・ダイレクトのみ化をリリース"
```

---

## Self-Review

**1. 設計書カバレッジ:**

| 設計書 § | 対応タスク |
|---|---|
| §4.1 削除ファイル（bridge.ts / bridgeLauncher.ts / bridgeLauncher.test.ts） | Task 5 |
| §4.2 settings.ts（型・DEFAULT・UI・ラベル変更） | Task 1 |
| §4.3 recorder.ts（bridge 分岐削除） | Task 3 |
| §4.5 deviceList.ts（bridge フェッチ削除） | Task 2 |
| §4.6 claudianButton.ts（ブリッジボタン削除） | Task 4 |
| §4.7 テスト | Task 1〜4 |
| §4.8 バージョン 0.9.0 / CHANGELOG / ビルド / デプロイ | Task 6 |
| §5 データフロー（direct のみ） | Task 3 |
| §6 エラーハンドリング（MIX 警告維持） | 変更なし（directRecorder.ts 維持） |
| §7 手動 UAT | 実装後、主人の実機確認 |

**2. プレースホルダースキャン:** 全ステップに実コードあり。TBD/TODO なし。

**3. 型整合性:**
- `audioSource` の値 `mix` / `mic` / `pcLoopback` は全タスクで不変。
- `listDevices(settings, fetcher)` シグネチャは維持（`settings.ts` の呼び出し `listDevices(s)` と互換）。
- `SegmentRecorder.start/stop` のシグネチャは不変。
- Task 5 の grep で全 bridge 参照が消えていることを確認する。
