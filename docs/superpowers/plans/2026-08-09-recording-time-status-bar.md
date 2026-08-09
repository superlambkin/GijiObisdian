# 録音時間ステータスバー表示 + ダイレクト時ブリッジOFF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 録音中に Obsidian ステータスバーへ録音時間（`🎙️ MM:SS`）を毎秒リアルタイム表示し、PC ダイレクト録音設定時はブリッジボタン非表示・ブリッジ自動起動 OFF・ブリッジ設定グレーアウトを行う。

**Architecture:** 新規 `RecordingTimer` クラス（ステータスバー制御・毎秒更新）を `src/ui/recordingTimer.ts` に作成。`main.ts` でステータスバー要素を作成し、コマンド経由（`startSegment`/`stopSegment`）と Claudian 🎙️ ボタン経由の両方に `timer` を配線する。ダイレクト時ブリッジ OFF は「純粋関数（`shouldShowBridgeButton` / `isBridgeSettingDisabled`）で判定 → UI 反映」の形で、テスト可能にする。

**Tech Stack:** TypeScript / Obsidian API（`addStatusBarItem()`、HTMLElement 拡張 `setText/show/hide`、`setDisabled`）/ node:test + tsx / esbuild

---

## Global Constraints

- プラグインソースルート: `D:\AI-Agent\giji-obsidian\obsidian-plugin`（以下 `obsidian-plugin/` と表記）
- テストコマンド: `cd obsidian-plugin && npm test`
- ビルドコマンド: `cd obsidian-plugin && npm run build`
- テスト環境は Node + `src/__tests__/setup.cjs` による obsidian モジュールスタブ。DOM は無いため、DOM 依存コードのテストは純粋関数のみ
- 既存 111 テストは全てパスし続けること
- タイマーはダイレクト / ブリッジ **両方** で表示（仕様で確定）
- 時間形式は `MM:SS`。分が 60 を超えても分で表現（例: `60:00`）
- PC ダイレクト設定時: ブリッジボタン（🟢🔴）非表示 / ブリッジ自動起動・ステータスポーリング停止 / ブリッジ設定（録音モード・URL・ディレクトリ）グレーアウト
- コミットメッセージは日本語、変更者は `MiuMiu 🐾` を明記（Co-authored 不要）
- 設計書 SSOT: `80_POC_Projects/POC_016_GijiObsidian/02_设计文档/06_録音時間ステータスバー表示_設計.md`（Vault 内）

---

## File Structure

| ファイル | 責務 |
|---------|------|
| `obsidian-plugin/src/ui/recordingTimer.ts` | 🆕 `formatElapsed()` + `RecordingTimer` クラス |
| `obsidian-plugin/src/__tests__/recordingTimer.test.ts` | 🆕 RecordingTimer の単体テスト |
| `obsidian-plugin/src/commands/recordSegment.ts` | `timer?` 引数追加、開始/停止でタイマー制御 |
| `obsidian-plugin/src/main.ts` | ステータスバー要素生成、コマンド + Claudian ボタンへ配線 |
| `obsidian-plugin/src/ui/claudianButton.ts` | 🎙️ ボタンへタイマー配線、ダイレクト時ブリッジボタン非表示・ポーリング停止 |
| `obsidian-plugin/src/__tests__/claudianButton.test.ts` | 🆕 `shouldShowBridgeButton` のテスト |
| `obsidian-plugin/src/settings.ts` | ダイレクト時ブリッジ設定グレーアウト、`isBridgeSettingDisabled` 追加 |
| `obsidian-plugin/src/__tests__/settings.test.ts` | `isBridgeSettingDisabled` のテストを追加 |

---

### Task 0: 既存の未コミット変更を先にコミット

**Files:**
- 対象: 前タスク（デフォルト設定 議事録 化）で変更した未コミット 6 ファイル

**Interfaces:**
- Consumes: なし
- Produces: クリーンな作業ツリー（新機能のコミットを分離するため）

- [ ] **Step 1: 現在の差分を確認**

Run: `cd D:\AI-Agent\giji-obsidian && git status --short`
Expected: `obsidian-plugin/src/settings.ts` ほか 5 ファイルが Modified / Untracked の `docs/`

- [ ] **Step 2: 前タスクの変更のみコミット**

Run:
```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/settings.ts obsidian-plugin/src/notes/saver.ts obsidian-plugin/src/commands/autoSummarize.ts obsidian-plugin/src/__tests__/settings.test.ts obsidian-plugin/src/__tests__/saver.test.ts obsidian-plugin/src/__tests__/autoSummarize.test.ts
git commit -m "feat(plugin): 転写・議事録の保存先デフォルトを 議事録/ に変更"
```

- [ ] **Step 3: コミットを検証**

Run: `git status --short`
Expected: 上記 6 ファイルが消え、`docs/` のみ Untracked として残る

---

### Task 1: RecordingTimer クラス（TDD）

**Files:**
- Create: `obsidian-plugin/src/ui/recordingTimer.ts`
- Create: `obsidian-plugin/src/__tests__/recordingTimer.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `formatElapsed(ms: number): string` — `MM:SS`
  - `RecordingTimerDeps` — `{ setInterval?, clearInterval?, now? }`
  - `class RecordingTimer`
    - `constructor(el: HTMLElement, deps?: RecordingTimerDeps)`
    - `isRunning(): boolean`
    - `start(): void` — 表示 + 毎秒更新開始（多重開始ガード付き）
    - `stop(): void` — interval クリア + 非表示

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/recordingTimer.test.ts` を作成:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { formatElapsed, RecordingTimer, RecordingTimerDeps } from "../ui/recordingTimer";

function makeFakeEl() {
  let text = "";
  let visible = true;
  return {
    getText: () => text,
    isVisible: () => visible,
    setText: (v: string) => { text = v; },
    show: () => { visible = true; },
    hide: () => { visible = false; },
  } as any;
}

function makeFakeDeps() {
  let handlers: Array<() => void> = [];
  let now = 0;
  return {
    deps: {
      setInterval: (fn: () => void) => { handlers.push(fn); return handlers.length; },
      clearInterval: () => { handlers = []; },
      now: () => now,
    } as RecordingTimerDeps,
    fire: () => handlers.forEach((h) => h()),
    setNow: (v: number) => { now = v; },
    handlerCount: () => handlers.length,
  };
}

test("formatElapsed formats MM:SS", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(1000), "00:01");
  assert.equal(formatElapsed(61_000), "01:01");
  assert.equal(formatElapsed(3_600_000), "60:00");
  assert.equal(formatElapsed(3_660_000), "61:00");
});

test("starts hidden", () => {
  const el = makeFakeEl();
  const timer = new RecordingTimer(el);
  assert.equal(el.isVisible(), false);
});

test("start shows 🎙️ 00:00 and marks running", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  assert.equal(timer.isRunning(), true);
  assert.equal(el.getText(), "🎙️ 00:00");
  assert.equal(el.isVisible(), true);
  assert.equal(fake.handlerCount(), 1);
});

test("interval updates elapsed time", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  fake.setNow(65_000);
  fake.fire();
  assert.equal(el.getText(), "🎙️ 01:05");
});

test("stop clears interval and hides", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  timer.stop();
  assert.equal(timer.isRunning(), false);
  assert.equal(el.isVisible(), false);
  assert.equal(fake.handlerCount(), 0);
});

test("double start is ignored", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  fake.setNow(10_000);
  timer.start();
  fake.fire();
  assert.equal(el.getText(), "🎙️ 00:10");
  assert.equal(fake.handlerCount(), 1);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '../ui/recordingTimer'`（ファイル未作成のため）

- [ ] **Step 3: 最小実装を書く**

`src/ui/recordingTimer.ts` を作成:

```typescript
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export interface RecordingTimerDeps {
  setInterval?: (handler: () => void, timeout?: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
  now?: () => number;
}

export class RecordingTimer {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private deps: Required<Pick<RecordingTimerDeps, "setInterval" | "clearInterval" | "now">>;

  constructor(private el: HTMLElement, deps: RecordingTimerDeps = {}) {
    this.el.hide();
    this.deps = {
      setInterval: deps.setInterval ?? ((handler, timeout) => setInterval(handler, timeout)),
      clearInterval: deps.clearInterval ?? ((handle) => clearInterval(handle)),
      now: deps.now ?? (() => Date.now()),
    };
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  start(): void {
    if (this.isRunning()) return;
    this.startTime = this.deps.now();
    this.el.setText("🎙️ 00:00");
    this.el.show();
    this.intervalId = this.deps.setInterval(() => {
      this.el.setText(`🎙️ ${formatElapsed(this.deps.now() - this.startTime)}`);
    }, 1000);
  }

  stop(): void {
    if (this.intervalId !== null) {
      this.deps.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.el.hide();
  }
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -15`
Expected: PASS — 全ケース成功、失敗 0

- [ ] **Step 5: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/ui/recordingTimer.ts obsidian-plugin/src/__tests__/recordingTimer.test.ts
git commit -m "feat(plugin): RecordingTimer クラスを追加（ステータスバーに録音時間 MM:SS を毎秒表示）"
```

---

### Task 2: コマンド経路にタイマー配線（recordSegment.ts + main.ts）

**Files:**
- Modify: `obsidian-plugin/src/commands/recordSegment.ts`
- Modify: `obsidian-plugin/src/main.ts`

**Interfaces:**
- Consumes: `RecordingTimer`（Task 1 のクラス）
- Produces:
  - `startSegment(app: App, settings: GijiSettings, timer?: RecordingTimer): Promise<void>`
  - `stopSegment(app: App, settings: GijiSettings, manifestDir: string, timer?: RecordingTimer): Promise<void>`
  - `GijiPlugin.recordingTimer: RecordingTimer` フィールド

- [ ] **Step 1: recordSegment.ts に `timer?` を追加**

`src/commands/recordSegment.ts` の import に追加:
```typescript
import { RecordingTimer } from "../ui/recordingTimer";
```

`startSegment` と `stopSegment` のシグネチャとボディを変更:
```typescript
export async function startSegment(app: App, settings: GijiSettings, timer?: RecordingTimer) {
  const r = getRecorder(app);
  const started = await r.start(settings);
  if (started) {
    timer?.start();
    new Notice("🎙️ 録音中… もう一度「停止して転写」を実行すると終了します");
  }
}

export async function stopSegment(app: App, settings: GijiSettings, manifestDir: string, timer?: RecordingTimer) {
  timer?.stop();
  const r = getRecorder(app);
  const result = await r.stop(settings);
  if (result === null) {
    new Notice("⚠️ 進行中の録音がありません");
    return;
  }
  // 以下は既存のまま変更しない
  const view = app.workspace.getActiveViewOfType(Object as any) as any;
  const editor = view?.editor;
  if (!editor) {
    new Notice("⚠️ 転写を追記する前にノートを開いてください");
    return;
  }
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const cur = editor.getValue();
  editor.setValue(appendSegmentNote(cur, `${time}`, result.text));
  new Notice("✅ ノートに転写を追記しました");

  void runAutoSummarize(result.text, settings, app, manifestDir);
}
```

- [ ] **Step 2: main.ts でステータスバー要素 + recordingTimer を生成**

`src/main.ts` の import に追加:
```typescript
import { RecordingTimer } from "./ui/recordingTimer";
```

クラスにフィールド追加:
```typescript
export default class GijiPlugin extends Plugin {
  settings: GijiSettings = DEFAULT_SETTINGS;
  recordingTimer!: RecordingTimer;
```

`onload()` 内の `addSettingTab` 前に追加:
```typescript
this.recordingTimer = new RecordingTimer(this.addStatusBarItem());
```

コマンド登録を変更:
```typescript
this.addCommand({
  id: "record-start",
  name: "开始录音（会议分段）",
  callback: () => startSegment(this.app, this.settings, this.recordingTimer),
});
this.addCommand({
  id: "record-stop",
  name: "停止并转写（追加到笔记）",
  callback: () => stopSegment(this.app, this.settings, this.manifest.dir, this.recordingTimer),
});
```

> ⚠️ `setupClaudianButton(this, this.settings)` の呼び出しは Task 3 で変更するため、この時点では 2 引数のまま。

- [ ] **Step 3: ビルドで型エラーがないことを確認**

Run: `cd obsidian-plugin && npm run build 2>&1 | tail -10`
Expected: エラーなし（esbuild が `main.js` を生成）

- [ ] **Step 4: 既存テストが全てパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -8`
Expected: `pass 111`（+ Task 1 の新テストで増加）、`fail 0`

- [ ] **Step 5: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/commands/recordSegment.ts obsidian-plugin/src/main.ts
git commit -m "feat(plugin): 録音コマンド（start/stop）にステータスバータイマーを配線"
```

---

### Task 3: Claudian ボタンにタイマー配線 + ダイレクト時ブリッジボタン非表示・ポーリング停止

**Files:**
- Modify: `obsidian-plugin/src/ui/claudianButton.ts`
- Create: `obsidian-plugin/src/__tests__/claudianButton.test.ts`

**Interfaces:**
- Consumes: `RecordingTimer`（Task 1）
- Produces:
  - `shouldShowBridgeButton(recordingMethod: string): boolean` — `recordingMethod === "bridge"` で true
  - `setupClaudianButton(plugin: Plugin, settings: GijiSettings, timer?: RecordingTimer): () => void`

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/claudianButton.test.ts` を作成:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowBridgeButton } from "../ui/claudianButton";

test("shouldShowBridgeButton is true only for bridge", () => {
  assert.equal(shouldShowBridgeButton("bridge"), true);
  assert.equal(shouldShowBridgeButton("direct"), false);
  assert.equal(shouldShowBridgeButton(""), false);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -15`
Expected: FAIL — `Cannot find module '../ui/claudianButton'` または `shouldShowBridgeButton is not a function`

- [ ] **Step 3: 純粋関数を追加しテストを通す**

`src/ui/claudianButton.ts` の import 部に `RecordingTimer` を追加:
```typescript
import { RecordingTimer } from "./recordingTimer";
```

関数の先頭付近に純粋関数を追加:
```typescript
export function shouldShowBridgeButton(recordingMethod: string): boolean {
  return recordingMethod === "bridge";
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -8`
Expected: PASS — claudianButton テスト成功、失敗 0

- [ ] **Step 5: setupClaudianButton に `timer` を配線 + ダイレクト時ブリッジ OFF**

`src/ui/claudianButton.ts` を以下の通り変更:

`injectToolbar` を変更（ブリッジボタンは bridge 時のみ追加、ダイレクト時は既存を削除）:
```typescript
function injectToolbar(plugin: Plugin, settings: GijiSettings, toolbar: HTMLElement, timer?: RecordingTimer) {
  const hasBridge = toolbar.querySelector(".giji-bridge-btn");
  const hasRecord = toolbar.querySelector(".giji-record-btn");
  const showBridge = shouldShowBridgeButton(settings.recordingMethod);

  if (!showBridge) {
    toolbar.querySelectorAll(".giji-bridge-btn").forEach((el) => el.remove());
  }

  if (showBridge && !hasBridge) {
    const bridgeBtn = makeBridgeButton(plugin, settings);
    if (hasRecord) {
      toolbar.insertBefore(bridgeBtn, hasRecord);
    } else {
      toolbar.appendChild(bridgeBtn);
    }
  }

  if (!hasRecord) {
    const recordBtn = makeButton(plugin, settings, timer);
    toolbar.appendChild(recordBtn);
  }
}
```

`makeButton` のシグネチャ変更 + タイマー配線:
```typescript
function makeButton(plugin: Plugin, settings: GijiSettings, timer?: RecordingTimer): HTMLButtonElement {
  // ... 中略（既存のボタン生成コード）...
  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      if (state.recorder.isRecording()) {
        timer?.stop();                     // ← 録音停止はこの時点
        let text: string | null = null;
        let durationSec: number | undefined;
        try {
          const result = await state.recorder.stop(settings);
          if (result) {
            text = result.text;
            durationSec = result.durationSec;
          }
        } catch {
          // Recorder already surfaces Notice; reset UI below.
        }
        // ... 以降は既存のまま（text 処理・Claudian 挿入）...
      } else {
        try {
          const started = await state.recorder.start(settings);
          if (started) {
            btn.textContent = "■";
            btn.classList.add("giji-recording");
            timer?.start();                // ← ここでタイマー表示
          }
        } catch {
          // Notice already shown by SegmentRecorder.
        }
      }
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });
  return btn;
}
```

`setupClaudianButton` を変更（`timer` 受け取り、ダイレクト時はポーリング停止）:
```typescript
export function setupClaudianButton(plugin: Plugin, settings: GijiSettings, timer?: RecordingTimer): () => void {
  function scan() {
    const toolbars = document.querySelectorAll(TOOLBAR_SELECTOR);
    for (let i = 0; i < toolbars.length; i++) {
      injectToolbar(plugin, settings, toolbars[i] as HTMLElement, timer);
    }
  }

  scan();
  const showBridge = shouldShowBridgeButton(settings.recordingMethod);
  if (showBridge) {
    refreshBridgeButtons(settings).catch(() => {});
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

  const interval = showBridge
    ? setInterval(() => {
        refreshBridgeButtons(settings).catch((err) => console.warn("[giji] bridge status refresh failed", err));
      }, 5000)
    : null;

  return () => {
    if (interval) clearInterval(interval);
    observer.disconnect();
    document.querySelectorAll(`[${BTN_MARK}]`).forEach((btn) => btn.remove());
  };
}
```

- [ ] **Step 6: main.ts の setupClaudianButton 呼び出しに timer を渡す**

`src/main.ts` の変更:
```typescript
this.register(setupClaudianButton(this, this.settings, this.recordingTimer));
```

- [ ] **Step 7: ビルド + テストで検証**

Run: `cd obsidian-plugin && npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -8`
Expected: ビルド成功、`pass` 全件 / `fail 0`

- [ ] **Step 8: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/ui/claudianButton.ts obsidian-plugin/src/__tests__/claudianButton.test.ts obsidian-plugin/src/main.ts
git commit -m "feat(plugin): Claudian 🎙️ ボタンにタイマー配線 + ダイレクト時はブリッジボタン非表示・ポーリング停止"
```

---

### Task 4: 設定画面のブリッジ設定グレーアウト

**Files:**
- Modify: `obsidian-plugin/src/settings.ts`
- Modify: `obsidian-plugin/src/__tests__/settings.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `isBridgeSettingDisabled(recordingMethod: string): boolean` — `recordingMethod !== "bridge"` で true
  - 設定画面: `録音手法` が direct のとき、`録音モード` / `ブリッジ URL` / `ブリッジのディレクトリ` を `setDisabled(true)`

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/settings.test.ts` の import を変更:
```typescript
import { DEFAULT_SETTINGS, isBridgeSettingDisabled } from "../settings";
```

末尾にテストを追加:
```typescript
test("isBridgeSettingDisabled", () => {
  assert.equal(isBridgeSettingDisabled("bridge"), false);
  assert.equal(isBridgeSettingDisabled("direct"), true);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -15`
Expected: FAIL — `isBridgeSettingDisabled is not a function`

- [ ] **Step 3: 純粋関数を追加しテストを通す**

`src/settings.ts` にエクスポートを追加（`DEFAULT_SETTINGS` 定義の近く）:
```typescript
export function isBridgeSettingDisabled(recordingMethod: string): boolean {
  return recordingMethod !== "bridge";
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -8`
Expected: PASS

- [ ] **Step 5: display() にグレーアウト処理を追加**

`src/settings.ts` の `display()` 内、録音セクションの該当コンポーネントを参照保持する:

`🎙️ 録音モード` の dropdown を変数で受ける:
```typescript
let audioMode: any;
let bridgeUrl: any;
let bridgeDir: any;

new Setting(containerEl)
  .setName("🎙️ 録音モード")
  .setDesc("Teams 会議時は「マイク + PC 音声」を推奨。PC 音声は WASAPI ループバックで取得します（Windows のみ・ブリッジ v0.2.0 以降が必要）")
  .addDropdown((d) => {
    audioMode = d;
    d
      .addOption("mix", "マイク + PC 音声（WASAPI ループバック）")
      .addOption("mic", "マイクのみ（従来）")
      .addOption("pcLoopback", "PC 音声のみ（ループバック）")
      .setValue(s.audioSource ?? "mix")
      .onChange(async (v: string) => {
        s.audioSource = v as AudioSourceId;
        await this.save();
      });
  });
```

`ブリッジ URL` の text を変数で受ける:
```typescript
new Setting(containerEl)
  .setName("ブリッジ URL")
  .addText((t) => {
    bridgeUrl = t;
    t.setValue(s.bridgeBaseUrl).onChange(async (v: string) => {
      s.bridgeBaseUrl = v;
      await this.save();
    });
  });
```

`ブリッジのディレクトリ` の text を変数で受ける:
```typescript
new Setting(containerEl)
  .setName("ブリッジのディレクトリ")
  .addText((t) => {
    bridgeDir = t;
    t.setValue(s.bridgeDir).onChange(async (v: string) => {
      s.bridgeDir = v;
      await this.save();
    });
  });
```

`録音手法` ドロップダウンの onChange に連動を追加し、display 末尾に初期化を追加:
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
        updateBridgeDisabled(v);
      })
  );
```

`display()` 内（各コンポーネント定義の後）にヘルパーを追加:
```typescript
const updateBridgeDisabled = (method: string) => {
  const disabled = isBridgeSettingDisabled(method);
  audioMode?.setDisabled(disabled);
  bridgeUrl?.setDisabled(disabled);
  bridgeDir?.setDisabled(disabled);
};
updateBridgeDisabled(s.recordingMethod);
```

> ⚠️ `updateBridgeDisabled` は `const` 定義で、`録音手法` onChange のクロージャから参照する。onChange はユーザー操作時（display 完了後）に発火するため、参照は安全。

- [ ] **Step 6: ビルド + テストで検証**

Run: `cd obsidian-plugin && npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -8`
Expected: ビルド成功、`pass` 全件 / `fail 0`

- [ ] **Step 7: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/settings.ts obsidian-plugin/src/__tests__/settings.test.ts
git commit -m "feat(plugin): PC ダイレクト設定時はブリッジ設定（録音モード・URL・ディレクトリ）をグレーアウト"
```

---

### Task 5: 最終ビルド・全テスト・整合確認

**Files:**
- 対象: 全変更ファイル

**Interfaces:**
- Consumes: 全タスク成果物
- Produces: 出荷可能な `main.js`

- [ ] **Step 1: 全テスト実行**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -10`
Expected: `pass`（111 + 新規 12 程度）/ `fail 0`

- [ ] **Step 2: ビルドで main.js を再生成**

Run: `cd obsidian-plugin && npm run build 2>&1 | tail -5`
Expected: エラーなし

- [ ] **Step 3: main.js に新機能が入ったことを確認**

Run:
```bash
cd obsidian-plugin
grep -c "giji-recording" main.js
grep -o "shouldShowBridgeButton" main.js | head -1
```
Expected: 各 1 以上（minify で関数名が保たれる場合。保たれない場合はビルド成功 + 手動 UAT で代替確認）

- [ ] **Step 4: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/main.js
git commit -m "build(plugin): 録音時間ステータスバー表示 + ダイレクト時ブリッジOFF をビルド"
```

- [ ] **Step 5: 手動 UAT チェックリストを主人へ提示**

UAT 合格基準（設計書 §5 から抜粋）:
| 場面 | 合格基準 |
|------|---------|
| ブリッジ録音で record-start（コマンド） | ステータスバーに `🎙️ MM:SS` が毎秒更新表示 |
| record-stop（コマンド） | ステータスバーから消える |
| Claudian 🎙️ ボタンで録音開始 | ステータスバーに `🎙️ MM:SS` 表示 |
| Claudian 🎙️ ボタンで録音停止 | ステータスバーから消える |
| PC ダイレクト設定 | ブリッジボタン（🟢🔴）が非表示 |
| PC ダイレクト設定 | 設定画面のブリッジ関連がグレーアウト |
| PC ダイレクトで record-start | ステータスバーに `🎙️ MM:SS` 表示（共通動作） |

---

## Self-Review

**1. Spec coverage:**
- ✅ 録音時間ステータスバー表示 → Task 1（RecordingTimer）+ Task 2（コマンド）+ Task 3（🎙️ ボタン）
- ✅ ダイレクト時ブリッジボタン非表示 → Task 3（`injectToolbar` / `scan`）
- ✅ ダイレクト時ブリッジ自動起動 OFF（ポーリング停止）→ Task 3（`setupClaudianButton`）
- ✅ ダイレクト時ブリッジ設定グレーアウト → Task 4（`updateBridgeDisabled`）
- ✅ MM:SS 形式 → Task 1（`formatElapsed`）
- ✅ タイマー全モード共通 → 仕様確認済み（Task 2/3 はモード条件なしで配線）

**2. Placeholder scan:**
- 各 Step に実コード・実コマンドあり。プレースホルダなし。
- Task 3 の `makeButton` 変更は「中略」表記だが、既存コードの該当箇所を指しており、追加行（`timer?.stop()` / `timer?.start()`）は明示。

**3. Type consistency:**
- `RecordingTimer` / `formatElapsed` / `RecordingTimerDeps` は全タスクで同一シグネチャ
- `shouldShowBridgeButton(recordingMethod: string): boolean` は Task 3 定義、Task 3 内で使用
- `isBridgeSettingDisabled(recordingMethod: string): boolean` は Task 4 定義、Task 4 内で使用
- `startSegment` / `stopSegment` の `timer?: RecordingTimer` は Task 2 で定義、main.ts で使用
- `setupClaudianButton(plugin, settings, timer?)` は Task 3 でシグネチャ変更、main.ts で更新
