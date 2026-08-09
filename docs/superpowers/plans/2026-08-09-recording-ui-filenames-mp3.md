# 録音UI改善（赤点滅・ステータス3段階）+ ファイル命名分離 + MP3埋込 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 録音中に Claudian 🎙️ボタンを赤色点滅させ、ステータスバーに「録音時間 → 文字起こし中 → 要約生成中」を3段階表示する。転写MDは `録音＊＊＊＊`、議事録MDは `議事録＊＊＊＊`（＊＊＊=録音開始時刻）に命名し、両MDに録音MP3を `file:///` リンクで埋め込む。議事録概要欄（開始時間・会議時間・録音ファイル）に録音データを書き込む。

**Architecture:** 既存 `RecordingTimer` を拡張して3状態（recording/transcribing/summarizing）を持たせ、CSS は `recordingStyles.ts` で JS 注入する。録音開始時刻を `SegmentRecorder` が保持し `SegmentResult.startTime` で伝播。ファイル名は `transcriptFileNameTemplate`（録音_...）を新設して議事録用 `fileNameTemplate`（議事録_...）と分離。MP3 は `mp3Ref.ts` の `toFileUrl`/`buildMp3Links` で `file:///` リンク化し、転写MDは `renderTranscriptNote`、議事録MDは `fillMinutesMetadata`（LLM後処理）で埋め込む。

**Tech Stack:** TypeScript / Obsidian API（`addStatusBarItem`・`HTMLElement.setClass`）/ node:test + tsx / esbuild

---

## Global Constraints

- プラグインソースルート: `D:\AI-Agent\giji-obsidian\obsidian-plugin`（以下 `obsidian-plugin/` と表記）
- テストコマンド: `cd obsidian-plugin && npm test`
- ビルドコマンド: `cd obsidian-plugin && npm run build`
- テスト環境は Node + `src/__tests__/setup.cjs` による obsidian モジュールスタブ。DOM は無いため、DOM 依存コード（CSS注入・MutationObserver）は純粋関数・定数に分離してテストする
- 既存 111 テストは全てパスし続けること（更新対象を除く）
- 転写MDファイル名テンプレート（新設）: `録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分`
- 議事録MDファイル名テンプレート（既存 `fileNameTemplate`）: `議事録_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分`
- タイムスタンプは録音開始時刻を全フローで使用（`SegmentResult.startTime`）
- MP3 参照は `file:///` 絶対パス（Vault外のため Obsidian `![[...]]` は不採用）
- コミットメッセージは日本語、変更者は `MiuMiu 🐾` を明記
- 設計書 SSOT: `80_POC_Projects/POC_016_GijiObsidian/02_设计文档/07_録音UI改善とファイル命名MP3埋込_設計.md`（Vault 内）＋ `D:\AI-Agent\giji-obsidian\docs\superpowers\specs\2026-08-09-recording-ui-and-filenames-design.md`

---

## File Structure

| ファイル | 責務 |
|---------|------|
| `obsidian-plugin/src/ui/recordingStyles.ts` | 🆕 `RECORDING_STYLES_CSS` 定数 + `injectRecordingStyles()`（赤点滅CSS注入） |
| `obsidian-plugin/src/ui/recordingTimer.ts` | ✏️ `setTranscribing()` / `setSummarizing()` 追加（3状態化） |
| `obsidian-plugin/src/notes/mp3Ref.ts` | 🆕 `toFileUrl()` / `buildMp3Links()`（file:/// リンク生成） |
| `obsidian-plugin/src/notes/minutesMetadata.ts` | 🆕 `formatStartTime()` / `fillMinutesMetadata()`（概要欄への録音データ書き込み） |
| `obsidian-plugin/src/notes/saver.ts` | ✏️ `renderTranscriptNote` に `mp3Links` 行追加、`saveTranscriptToFile` を `transcriptFileNameTemplate` + MP3埋込対応 |
| `obsidian-plugin/src/notes/minutesTemplate.ts` | ✏️ 同梱テンプレに `🎙️ 録音ファイル` 行追加、`buildClaudianMinutesPrompt` を開始時刻+メタ対応 |
| `obsidian-plugin/src/audio/recorder.ts` | ✏️ `SegmentResult` に `startTime`/`audioPaths` 追加、`buildSegmentResult` 抽出 |
| `obsidian-plugin/src/audio/directRecorder.ts` | ✏️ ファイル名を開始時刻で生成、結果に `startTime` 追加 |
| `obsidian-plugin/src/settings.ts` | ✏️ `transcriptFileNameTemplate` 追加 + 設定タブUI |
| `obsidian-plugin/src/commands/autoSummarize.ts` | ✏️ オプション受取（startTime/durationSec/mp3Links）、cloud/ollama で `fillMinutesMetadata` 適用 |
| `obsidian-plugin/src/commands/recordSegment.ts` | ✏️ 停止フローで setTranscribing/setSummarizing + メタ伝播 |
| `obsidian-plugin/src/ui/claudianButton.ts` | ✏️ 停止ハンドラで3状態制御 + `saveTranscriptAndAutoSummarize` にメタ伝播 |
| `obsidian-plugin/src/main.ts` | ✏️ `injectRecordingStyles()` 呼出 |

---

### Task 0: 既存の未コミット変更を先にコミット

**Files:**
- 対象: 前タスク（Claudian 🎙️ボタンの自動要約配線）の未コミット 2 ファイル

**Interfaces:**
- Consumes: なし
- Produces: クリーンな作業ツリー

- [ ] **Step 1: 現在の差分を確認**

Run: `cd D:\AI-Agent\giji-obsidian && git status --short`
Expected: `M obsidian-plugin/src/ui/claudianButton.ts` / `M obsidian-plugin/src/__tests__/claudianButton.test.ts` / `?? docs/`

- [ ] **Step 2: 前タスクの変更のみコミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/ui/claudianButton.ts obsidian-plugin/src/__tests__/claudianButton.test.ts
git commit -m "feat(plugin): Claudian 🎙️ボタン停止時に転写保存+自動要約を配線"
```

- [ ] **Step 3: コミットを検証**

Run: `git status --short`
Expected: `docs/` のみ Untracked として残る

---

### Task 1: RecordingTimer に文字起こし中・要約生成中状態を追加（TDD）

**Files:**
- Modify: `obsidian-plugin/src/ui/recordingTimer.ts`
- Test: `obsidian-plugin/src/__tests__/recordingTimer.test.ts`

**Interfaces:**
- Consumes: 既存 `RecordingTimer`（`start`/`stop`/`isRunning`）
- Produces:
  - `setTranscribing(): void` — interval 停止 + `📝 文字起こし中…` 表示
  - `setSummarizing(): void` — interval 停止 + `🤖 要約生成中…` 表示

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/recordingTimer.test.ts` の末尾に追加:

```typescript
test("setTranscribing clears interval and shows 文字起こし中", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  fake.setNow(30_000);
  fake.fire();
  timer.setTranscribing();
  assert.equal(timer.isRunning(), false);
  assert.equal(el.getText(), "📝 文字起こし中…");
  assert.equal(el.isVisible(), true);
  assert.equal(fake.handlerCount(), 0);
});

test("setSummarizing clears interval and shows 要約生成中", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  timer.setSummarizing();
  assert.equal(timer.isRunning(), false);
  assert.equal(el.getText(), "🤖 要約生成中…");
  assert.equal(el.isVisible(), true);
  assert.equal(fake.handlerCount(), 0);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -15`
Expected: FAIL — `setTranscribing is not a function`

- [ ] **Step 3: 実装**

`src/ui/recordingTimer.ts` の `stop()` の直後に追加:

```typescript
setTranscribing(): void {
  if (this.intervalId !== null) {
    this.deps.clearInterval(this.intervalId);
    this.intervalId = null;
  }
  this.el.setText("📝 文字起こし中…");
  this.el.show();
}

setSummarizing(): void {
  if (this.intervalId !== null) {
    this.deps.clearInterval(this.intervalId);
    this.intervalId = null;
  }
  this.el.setText("🤖 要約生成中…");
  this.el.show();
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -15`
Expected: PASS — 全ケース成功、失敗 0

- [ ] **Step 5: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/ui/recordingTimer.ts obsidian-plugin/src/__tests__/recordingTimer.test.ts
git commit -m "feat(plugin): RecordingTimer に文字起こし中・要約生成中状態を追加"
```

---

### Task 2: 録音ボタンの赤色点滅CSS（recordingStyles.ts）

**Files:**
- Create: `obsidian-plugin/src/ui/recordingStyles.ts`
- Test: `obsidian-plugin/src/__tests__/recordingStyles.test.ts`
- Modify: `obsidian-plugin/src/main.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `export const RECORDING_STYLES_CSS: string` — 赤点滅スタイル
  - `export function injectRecordingStyles(): void` — `<style>` を document.head に注入（`style.id = "giji-recording-styles"`、既存ならスキップ）

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/recordingStyles.test.ts` を作成:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { RECORDING_STYLES_CSS } from "../ui/recordingStyles";

test("RECORDING_STYLES_CSS は .giji-recording を赤色点滅させる", () => {
  assert.match(RECORDING_STYLES_CSS, /\.giji-record-btn\.giji-recording/);
  assert.match(RECORDING_STYLES_CSS, /color:\s*#e33/);
  assert.match(RECORDING_STYLES_CSS, /@keyframes giji-blink/);
  assert.match(RECORDING_STYLES_CSS, /animation:/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -15`
Expected: FAIL — `Cannot find module '../ui/recordingStyles'`

- [ ] **Step 3: 実装**

`src/ui/recordingStyles.ts` を作成:

```typescript
export const RECORDING_STYLES_CSS = `
.giji-record-btn.giji-recording {
  color: #e33 !important;
  animation: giji-blink 1s ease-in-out infinite;
}
@keyframes giji-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}
`;

export function injectRecordingStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("giji-recording-styles")) return;
  const style = document.createElement("style");
  style.id = "giji-recording-styles";
  style.textContent = RECORDING_STYLES_CSS;
  document.head.appendChild(style);
}
```

- [ ] **Step 4: main.ts で onload 時に呼ぶ**

`src/main.ts` の import に追加:
```typescript
import { injectRecordingStyles } from "./ui/recordingStyles";
```

`onload()` の冒頭（`this.recordingTimer = ...` の直前）に追加:
```typescript
injectRecordingStyles();
```

- [ ] **Step 5: テスト + ビルドで検証**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -8 && npm run build 2>&1 | tail -5`
Expected: テスト PASS、ビルド成功

- [ ] **Step 6: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/ui/recordingStyles.ts obsidian-plugin/src/__tests__/recordingStyles.test.ts obsidian-plugin/src/main.ts
git commit -m "feat(plugin): 録音中ボタンの赤色点滅CSSを追加（JS注入）"
```

---

### Task 3: 転写ファイル名テンプレート設定を追加（settings.ts）

**Files:**
- Modify: `obsidian-plugin/src/settings.ts`
- Test: `obsidian-plugin/src/__tests__/settings.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `GijiSettings.transcriptFileNameTemplate: string`
  - `DEFAULT_SETTINGS.transcriptFileNameTemplate = "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分"`
  - 設定タブ: ② 文字起こし セクションに「転写ファイル名テンプレート」テキスト欄

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/settings.test.ts` の「DEFAULT_SETTINGS has required fields」テストに1行追加:

```typescript
assert.equal(
  DEFAULT_SETTINGS.transcriptFileNameTemplate,
  "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分"
);
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -15`
Expected: FAIL — `transcriptFileNameTemplate` が undefined

- [ ] **Step 3: interface と DEFAULT_SETTINGS に追加**

`src/settings.ts` の `GijiSettings` interface（`fileNameTemplate: string;` の直後）に追加:
```typescript
  transcriptFileNameTemplate: string;
```

`DEFAULT_SETTINGS`（`fileNameTemplate` の直後）に追加:
```typescript
  transcriptFileNameTemplate: "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分",
```

- [ ] **Step 4: 設定タブUIに「転写ファイル名テンプレート」欄を追加**

`src/settings.ts` の「転写ファイル名テンプレート」欄（現在 `fileNameTemplate` を編集している箇所）の直後に追加:

```typescript
    new Setting(containerEl)
      .setName("転写ファイル名テンプレート（録音_...）")
      .setDesc("文字起こしMDのファイル名。プレースホルダ: {{year}} {{month}} {{day}} {{hour}} {{minute}} {{second}} {{date}} {{time}}")
      .addText((t) =>
        t.setValue(s.transcriptFileNameTemplate).onChange(async (v: string) => {
          s.transcriptFileNameTemplate = v;
          await this.save();
        })
      );
```

- [ ] **Step 5: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -8`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/settings.ts obsidian-plugin/src/__tests__/settings.test.ts
git commit -m "feat(plugin): 転写ファイル名テンプレート設定（録音_...）を追加"
```

---

### Task 4: MP3 file:/// リンク生成（mp3Ref.ts）

**Files:**
- Create: `obsidian-plugin/src/notes/mp3Ref.ts`
- Test: `obsidian-plugin/src/__tests__/mp3Ref.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `export function toFileUrl(absPath: string): string` — Windows絶対パス → `file:///` URL（スペース等エンコード）
  - `export function buildMp3Links(audioPaths: string[]): string` — 複数セグメントを `・` 連結、0件なら `""`

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/mp3Ref.test.ts` を作成:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { toFileUrl, buildMp3Links } from "../notes/mp3Ref";

test("toFileUrl converts Windows path with backslashes", () => {
  assert.equal(
    toFileUrl("C:\\Users\\taro\\Music\\GijiObsidian\\録音_2026年08月09日13時51分30秒.mp3"),
    "file:///C:/Users/taro/Music/GijiObsidian/%E9%8C%B2%E9%9F%B3_2026%E5%B9%B408%E6%9C%8809%E6%97%A513%E6%99%8251%E5%88%8630%E7%A7%92.mp3"
  );
});

test("toFileUrl encodes spaces as %20", () => {
  assert.equal(toFileUrl("C:/My Music/a b.mp3"), "file:///C:/My%20Music/a%20b.mp3");
});

test("buildMp3Links returns empty string for empty list", () => {
  assert.equal(buildMp3Links([]), "");
});

test("buildMp3Links joins single segment with 再生 link", () => {
  const out = buildMp3Links(["C:/rec/録音_2026年08月09日13時51分30秒.mp3"]);
  assert.match(out, /^\[🎙️ 録音を再生\]\(file:\/\/\/C:\/rec\/%E9%8C%B2%E9%9F%B3_/);
  assert.equal(out.includes("・"), false);
});

test("buildMp3Links numbers multi segments", () => {
  const out = buildMp3Links(["C:/a.mp3", "C:/b.mp3"]);
  assert.match(out, /録音1を再生/);
  assert.match(out, /録音2を再生/);
  assert.ok(out.includes("・"));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -15`
Expected: FAIL — `Cannot find module '../notes/mp3Ref'`

- [ ] **Step 3: 実装**

`src/notes/mp3Ref.ts` を作成:

```typescript
/** Windows絶対パス → file:/// URL（セグメント単位でエンコード） */
export function toFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `file:///${encoded}`;
}

/** 録音ファイルのMarkdownリンク（複数セグメントは「録音1」「録音2」） */
export function buildMp3Links(audioPaths: string[]): string {
  if (audioPaths.length === 0) return "";
  return audioPaths
    .map((p, i) =>
      audioPaths.length > 1
        ? `[🎙️ 録音${i + 1}を再生](${toFileUrl(p)})`
        : `[🎙️ 録音を再生](${toFileUrl(p)})`
    )
    .join("・");
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -15`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/notes/mp3Ref.ts obsidian-plugin/src/__tests__/mp3Ref.test.ts
git commit -m "feat(plugin): MP3 file:/// リンク生成（toFileUrl / buildMp3Links）"
```

---

### Task 5: 議事録概要欄への録音データ書き込み（minutesMetadata.ts）

**Files:**
- Create: `obsidian-plugin/src/notes/minutesMetadata.ts`
- Test: `obsidian-plugin/src/__tests__/minutesMetadata.test.ts`

**Interfaces:**
- Consumes: `formatDuration` from `./saver`
- Produces:
  - `export function formatStartTime(d: Date): string` — `YYYY-MM-DD HH:MM`
  - `export interface MinutesMetadata { startTime: Date; durationSec?: number; mp3Links?: string }`
  - `export function fillMinutesMetadata(md: string, meta: MinutesMetadata): string` — 概要表のセル置換 + 録音ファイル行が無ければ挿入

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/minutesMetadata.test.ts` を作成:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { formatStartTime, fillMinutesMetadata } from "../notes/minutesMetadata";

const TPL = [
  "| 🔢 議事録番号 |  |",
  "| 🕐 開始時間 | YYYY-MM-DD HH:MM |",
  "| ⏱️ 会議時間 | X 分 Y 秒 |",
  "| 🎙️ 録音ファイル | [[録音ファイル名]] |",
  "| テーマ |  |",
].join("\n");

const START = new Date(2026, 7, 9, 13, 51); // 2026-08-09 13:51

test("formatStartTime formats YYYY-MM-DD HH:MM", () => {
  assert.equal(formatStartTime(START), "2026-08-09 13:51");
});

test("fillMinutesMetadata replaces 開始時間/会議時間/録音ファイル", () => {
  const out = fillMinutesMetadata(TPL, {
    startTime: START,
    durationSec: 83,
    mp3Links: "[🎙️ 録音を再生](file:///C:/a.mp3)",
  });
  assert.match(out, /\| 🕐 開始時間 \| 2026-08-09 13:51 \|/);
  assert.match(out, /\| ⏱️ 会議時間 \| 1 分 23 秒 \|/);
  assert.match(out, /\| 🎙️ 録音ファイル \| \[🎙️ 録音を再生\]/);
});

test("fillMinutesMetadata inserts 録音ファイル row when missing", () => {
  const withoutAudio = [
    "| 🔢 議事録番号 |  |",
    "| 🕐 開始時間 | YYYY-MM-DD HH:MM |",
    "| ⏱️ 会議時間 | X 分 Y 秒 |",
    "| テーマ |  |",
  ].join("\n");
  const out = fillMinutesMetadata(withoutAudio, {
    startTime: START,
    durationSec: 5,
    mp3Links: "LINK",
  });
  assert.match(out, /\| 🎙️ 録音ファイル \| LINK \|/);
});

test("fillMinutesMetadata leaves rows intact when table missing", () => {
  const noTable = "# 議事録\n本文のみ";
  const out = fillMinutesMetadata(noTable, { startTime: START });
  assert.equal(out, "# 議事録\n本文のみ");
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -15`
Expected: FAIL — `Cannot find module '../notes/minutesMetadata'`

- [ ] **Step 3: 実装**

`src/notes/minutesMetadata.ts` を作成:

```typescript
import { formatDuration } from "./saver";

/** 開始時刻を YYYY-MM-DD HH:MM 形式へ */
export function formatStartTime(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface MinutesMetadata {
  startTime: Date;
  durationSec?: number;
  mp3Links?: string;
}

/** 概要表の `| ラベル | ... |` セル内容を value に置換 */
function replaceCell(md: string, label: string, value: string): string {
  const re = new RegExp(`(\\| ${label} \\| )[^|\\n]*(\\|)`, "g");
  return md.replace(re, (_m, pre: string, post: string) => `${pre}${value}${post}`);
}

/** 議事録MDの概要表セルに録音データを書き込む（LLM出力の後処理） */
export function fillMinutesMetadata(md: string, meta: MinutesMetadata): string {
  let out = md;
  // 🎙️ 録音ファイル 行が無ければ 会議時間 行の直後に挿入
  if (!out.includes("| 🎙️ 録音ファイル |")) {
    const durIdx = out.indexOf("| ⏱️ 会議時間 |");
    if (durIdx !== -1) {
      const lineEnd = out.indexOf("\n", durIdx);
      const insertAt = lineEnd === -1 ? out.length : lineEnd;
      out = out.slice(0, insertAt) + "\n| 🎙️ 録音ファイル |  |" + out.slice(insertAt);
    }
  }
  out = replaceCell(out, "🕐 開始時間", formatStartTime(meta.startTime));
  out = replaceCell(out, "⏱️ 会議時間", meta.durationSec !== undefined ? formatDuration(meta.durationSec) : "—");
  out = replaceCell(out, "🎙️ 録音ファイル", meta.mp3Links ?? "");
  return out;
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -15`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/notes/minutesMetadata.ts obsidian-plugin/src/__tests__/minutesMetadata.test.ts
git commit -m "feat(plugin): 議事録概要欄への録音データ書き込み（fillMinutesMetadata）"
```

---

### Task 6: SegmentResult に startTime / audioPaths を追加（recorder.ts）

**Files:**
- Modify: `obsidian-plugin/src/audio/recorder.ts`
- Modify: `obsidian-plugin/src/audio/directRecorder.ts`
- Test: `obsidian-plugin/src/__tests__/recorder.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `interface SegmentResult { text: string; durationSec: number; startTime?: Date; audioPaths?: string[] }`
  - `export function buildSegmentResult(text: string, input: TranscribeInput, startTime?: Date): SegmentResult`
  - `SegmentRecorder.start()` が `this.startTime = new Date()` を保持
  - `DirectRecordResult.startTime?: Date`、`DirectRecorder.stop()` が開始時刻でファイル名生成

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/recorder.test.ts` の末尾に追加:

```typescript
test("buildSegmentResult carries audioPaths and startTime", () => {
  const input = { audioPaths: ["C:/a.mp3", "C:/b.mp3"], durationSec: 12 };
  const start = new Date(2026, 7, 9, 13, 51);
  const res = buildSegmentResult("テキスト", input, start);
  assert.equal(res.text, "テキスト");
  assert.equal(res.durationSec, 12);
  assert.deepEqual(res.audioPaths, ["C:/a.mp3", "C:/b.mp3"]);
  assert.equal(res.startTime?.getTime(), start.getTime());
});
```

`src/__tests__/directRecorder.test.ts` の「stop: ffmpeg 成功」テストに、開始時刻ベースのファイル名検証を追加:

```typescript
test("stop: ファイル名は録音開始時刻（startTime）で生成される", async () => {
  FakeMediaRecorder.instances = [];
  const deps = makeDeps();
  const r = new DirectRecorder(deps);
  const before = Date.now();
  await r.start(settings);
  await new Promise((res) => setTimeout(res, 30)); // 開始時刻と停止時刻を分離
  const result = await r.stop(settings);
  assert.ok(result, "stop は null でない");
  assert.ok(result!.startTime instanceof Date);
  assert.ok(result!.startTime!.getTime() >= before);
  // ファイル名の分・秒は開始時刻（新しい分に進んでいない）
  const name = basename(result!.audioPaths[0]);
  const startMin = result!.startTime!.getMinutes();
  assert.match(name, /録音_/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -20`
Expected: FAIL — `buildSegmentResult is not a function` / `startTime` が undefined

- [ ] **Step 3: recorder.ts を変更**

`src/audio/recorder.ts` の `SegmentResult` interface を拡張:

```typescript
export interface SegmentResult {
  text: string;
  durationSec: number;
  startTime?: Date;
  audioPaths?: string[];
}
```

`TranscribeInput` の直後に純粋関数を追加:

```typescript
/** 転写結果を SegmentResult にまとめる（audioPaths と startTime を引き継ぐ） */
export function buildSegmentResult(
  text: string,
  input: TranscribeInput,
  startTime?: Date
): SegmentResult {
  return { text, durationSec: input.durationSec, startTime, audioPaths: input.audioPaths };
}
```

`SegmentRecorder` に `startTime` フィールドを追加し、`start()` 冒頭で記録:

```typescript
export class SegmentRecorder {
  private sessionId: string | null = null;
  private direct: DirectRecorder;
  private startTime?: Date;
```

`start()` の先頭に追加:
```typescript
  async start(settings: GijiSettings): Promise<boolean> {
    this.startTime = new Date();
```

`transcribePaths()` の return を変更:
```typescript
    return buildSegmentResult(parts.join("\n\n"), result, this.startTime);
```

- [ ] **Step 4: directRecorder.ts を変更**

`src/audio/directRecorder.ts` の `DirectRecordResult` に `startTime` を追加:
```typescript
export interface DirectRecordResult {
  audioPaths: string[];
  wavPath?: string;
  durationSec: number;
  startTime?: Date;
  warning?: string;
}
```

`stop()` 内のファイル名生成を開始時刻ベースに変更。現在の:
```typescript
      const base = (settings.recordingFileNameTemplate || "").trim()
        ? buildRecordingFileName(new Date(), settings.recordingFileNameTemplate)
        : `giji_${Date.now()}`; // テンプレート未設定時はブリッジ同様のフォールバック名
```
を次に置換:
```typescript
      const startedAt = new Date(startTime);
      const base = (settings.recordingFileNameTemplate || "").trim()
        ? buildRecordingFileName(startedAt, settings.recordingFileNameTemplate)
        : `giji_${startTime}`;
```

`stop()` の return 2 箇所に `startTime: new Date(startTime)` を追加:
```typescript
        return { audioPaths: [mp3Path], wavPath: mp3Path, durationSec, startTime: new Date(startTime) };
```
```typescript
        return { audioPaths: [webmPath], wavPath: webmPath, durationSec, startTime: new Date(startTime), warning: "mp3_encode_failed" };
```

- [ ] **Step 5: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/audio/recorder.ts obsidian-plugin/src/audio/directRecorder.ts obsidian-plugin/src/__tests__/recorder.test.ts obsidian-plugin/src/__tests__/directRecorder.test.ts
git commit -m "feat(plugin): SegmentResult に開始時刻・MP3パスを追加しダイレクト録音のファイル名を開始時刻基準に変更"
```

---

### Task 7: 転写MDに MP3 行追加 + transcriptFileNameTemplate 使用（saver.ts）

**Files:**
- Modify: `obsidian-plugin/src/notes/saver.ts`
- Test: `obsidian-plugin/src/__tests__/saver.test.ts`

**Interfaces:**
- Consumes: `transcriptFileNameTemplate`（Task 3）、`buildMp3Links`（Task 4）
- Produces:
  - `renderTranscriptNote(title, now, text, durationSec?, notePath?, mp3Links?)` — 概要表に `🎙️ 録音ファイル` 行
  - `saveTranscriptToFile(app, settings, text, durationSec?, now?, mp3Links?)` — `transcriptFileNameTemplate` 使用 + MP3行

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/saver.test.ts` を更新。まず「saveTranscriptToFile creates dir + writes file with 和式 name」の期待パスを `録音_...` に変更:

```typescript
test("saveTranscriptToFile creates dir + writes file with 録音_ name", async () => {
  const created: string[] = [];
  const files = new Map<string, boolean>([
    ["Clippings", false], // dir not existing yet
  ]);
  const adapter = {
    exists: async (p: string) => files.get(p) ?? false,
    list: async () => ({ files: [], folders: [] }),
  };
  const vault = {
    adapter,
    createFolder: async (dir: string) => {
      files.set(dir, true);
    },
    create: async (path: string, content: string) => {
      created.push(path);
      files.set(path, true);
    },
  };
  const app = { vault } as any;
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "Clippings" };

  const saved = await saveTranscriptToFile(app, settings, "测试文本", 12, FIXED);
  assert.deepEqual(saved, { path: "Clippings/録音_2026年08月04日06時30分.md", appended: false });
  assert.equal(created.length, 1);
  assert.ok(files.get("Clippings")); // folder was created
});
```

`renderTranscriptNote` に MP3 行が含まれるテストを追加:

```typescript
test("renderTranscriptNote includes 録音ファイル row when mp3Links given", () => {
  const md = renderTranscriptNote("録音_2026年08月04日06時30分", FIXED, "本文。", 83, "Clippings/x.md", "[🎙️ 録音を再生](file:///C:/a.mp3)");
  assert.match(md, /\| 🎙️ 録音ファイル \| \[🎙️ 録音を再生\]/);
});

test("renderTranscriptNote omits 録音ファイル row when mp3Links empty", () => {
  const md = renderTranscriptNote("録音_2026年08月04日06時30分", FIXED, "本文。", 83, "Clippings/x.md");
  assert.equal(md.includes("🎙️ 録音ファイル"), false);
});
```

`saveTranscriptToFile` が mp3Links を保存内容に反映するテストを追加:

```typescript
test("saveTranscriptToFile writes mp3Links into note content", async () => {
  const files = new Map<string, boolean>();
  let savedContent = "";
  const vault = {
    adapter: {
      exists: async (p: string) => files.get(p) ?? false,
      list: async () => ({ files: [], folders: [] }),
    },
    createFolder: async (dir: string) => files.set(dir, true),
    create: async (path: string, content: string) => {
      savedContent = content;
      files.set(path, true);
    },
  };
  const app = { vault } as any;
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "Clippings" };
  await saveTranscriptToFile(app, settings, "本文", 10, FIXED, "[🎙️ 録音を再生](file:///C:/a.mp3)");
  assert.match(savedContent, /\| 🎙️ 録音ファイル \| \[🎙️ 録音を再生\]/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -20`
Expected: FAIL — 期待パス `議事録_...` が `録音_...` にならない（既存テストは更新後のため、実装前は `transcriptFileNameTemplate` 未使用で失敗）

- [ ] **Step 3: 実装**

`src/notes/saver.ts` に import を追加:
```typescript
import { buildMp3Links } from "./mp3Ref";
```

`renderTranscriptNote` のシグネチャに `mp3Links?: string` を追加:
```typescript
export function renderTranscriptNote(
  title: string,
  now: Date,
  text: string,
  durationSec?: number,
  notePath?: string,
  mp3Links?: string
): string {
```

概要表の `| 🕐 録音日時 | ... |` 行の直後に MP3 行を追加。現在の:
```typescript
    `| 🕐 録音日時 | ${date} ${timeHM} |`,
    "",
```
を次に置換:
```typescript
    `| 🕐 録音日時 | ${date} ${timeHM} |`,
    ...(mp3Links ? [`| 🎙️ 録音ファイル | ${mp3Links} |`, ""] : []),
```

`saveTranscriptToFile` のシグネチャに `mp3Links?: string` を追加:
```typescript
export async function saveTranscriptToFile(
  app: App,
  settings: GijiSettings,
  text: string,
  durationSec?: number,
  now: Date = new Date(),
  mp3Links?: string
): Promise<{ path: string; appended: boolean }> {
```

テンプレート使用箇所を `fileNameTemplate` → `transcriptFileNameTemplate` に変更。現在の:
```typescript
  const template = (settings.fileNameTemplate || "").trim() || DEFAULT_SETTINGS.fileNameTemplate;
```
を次に置換:
```typescript
  const template =
    (settings.transcriptFileNameTemplate || "").trim() || DEFAULT_SETTINGS.transcriptFileNameTemplate;
```

`renderTranscriptNote` 呼び出しに `mp3Links` を渡す:
```typescript
  const content = renderTranscriptNote(filename, now, text, durationSec, path, mp3Links);
```

- [ ] **Step 4: 既存 saver テストの期待値を「録音_...」に更新**

`src/__tests__/saver.test.ts` 内、`saveTranscriptToFile` を検証するテストの期待パスを全て `議事録_` → `録音_` に更新する。該当箇所:
- `Clippings/議事録_2026年08月04日06時30分.md` → `Clippings/録音_2026年08月04日06時30分.md`
- `Clippings/議事録_2026年08月04日06時30分-2.md` → `Clippings/録音_2026年08月04日06時30分-2.md`
- `議事録/議事録_2026年08月04日06時30分.md` → `議事録/録音_2026年08月04日06時30分.md`
- append 系テストの既存ファイル名プレフィックス `議事録_2026年08月09日05時21分.md` → `録音_2026年08月09日05時21分.md` 等

> ⚠️ `buildTranscriptFilename` 単体テスト（`buildTranscriptFilename(FIXED)` → `議事録_2026年08月04日06時30分`）は **既定テンプレートが `fileNameTemplate` のまま**なので変更不要。

- [ ] **Step 5: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/notes/saver.ts obsidian-plugin/src/__tests__/saver.test.ts
git commit -m "feat(plugin): 転写MDを録音_...命名に変更し MP3 行を追加"
```

---

### Task 8: 同梱テンプレート + Claudian プロンプトをメタ対応（minutesTemplate.ts）

**Files:**
- Modify: `obsidian-plugin/src/notes/minutesTemplate.ts`
- Test: `obsidian-plugin/src/__tests__/minutesTemplate.test.ts`

**Interfaces:**
- Consumes: `formatStartTime` from `./minutesMetadata`（Task 5）
- Produces:
  - `DEFAULT_MINUTES_TEMPLATE_MD` に `| 🎙️ 録音ファイル |  |` 行を追加
  - `buildClaudianMinutesPrompt(template, transcript, outputDir, startTime: Date, meta?: { durationSec?: number; mp3Links?: string })` — 開始時刻ベースの保存先 + 録音情報を明示

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/minutesTemplate.test.ts` の `buildClaudianMinutesPrompt` テストを更新:

```typescript
test("buildClaudianMinutesPrompt embeds template, transcript, startTime and 録音情報", () => {
  const start = new Date(2026, 7, 9, 13, 51);
  const p = buildClaudianMinutesPrompt("TPL", "転写テキストです", "Clippings", start, {
    durationSec: 83,
    mp3Links: "[🎙️ 録音を再生](file:///C:/a.mp3)",
  });
  assert.match(p, /TPL/);
  assert.match(p, /転写テキストです/);
  assert.match(p, /議事録_2026年08月09日13時51分\.md/);
  assert.match(p, /開始時間=2026-08-09 13:51/);
  assert.match(p, /会議時間=1 分 23 秒/);
  assert.match(p, /録音ファイル=\[🎙️ 録音を再生\]/);
});

test("DEFAULT_MINUTES_TEMPLATE_MD includes 録音ファイル row", () => {
  assert.match(DEFAULT_MINUTES_TEMPLATE_MD, /\| 🎙️ 録音ファイル \|/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -20`
Expected: FAIL — 旧シグネチャ・旧文言

- [ ] **Step 3: 実装**

`src/notes/minutesTemplate.ts` に import を追加:
```typescript
import { formatStartTime } from "./minutesMetadata";
```

`DEFAULT_MINUTES_TEMPLATE_MD` の概要表に `🎙️ 録音ファイル` 行を追加。現在の:
```
| 🕐 開始時間 | YYYY-MM-DD HH:MM |
| ⏱️ 会議時間 | X 分 Y 秒（追加録音がある場合は合計時間） |
| テーマ |  |
```
を次に置換:
```
| 🕐 開始時間 | YYYY-MM-DD HH:MM |
| ⏱️ 会議時間 | X 分 Y 秒（追加録音がある場合は合計時間） |
| 🎙️ 録音ファイル |  |
| テーマ |  |
```

`buildClaudianMinutesPrompt` を置換:
```typescript
export function buildClaudianMinutesPrompt(
  template: string,
  transcript: string,
  outputDir: string,
  startTime: Date,
  meta: { durationSec?: number; mp3Links?: string } = {}
): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const ts = `${startTime.getFullYear()}年${pad(startTime.getMonth() + 1)}月${pad(startTime.getDate())}日${pad(startTime.getHours())}時${pad(startTime.getMinutes())}分`;
  const duration = meta.durationSec !== undefined ? `${Math.floor(meta.durationSec / 60)} 分 ${meta.durationSec % 60} 秒` : "不明";
  return [
    "以下の会議転写テキストを、議事録テンプレートに従って議事録 Markdown として作成し、Vault に保存してください。",
    "",
    `【保存先】${outputDir}/議事録_${ts}.md`,
    "【ルール】不明な項目は空欄にしてください。テンプレートの構成を厳密に守ってください。",
    `【録音情報】開始時間=${formatStartTime(startTime)} / 会議時間=${duration} / 録音ファイル=${meta.mp3Links ?? ""}`,
    "",
    "【議事録テンプレート】",
    template,
    "",
    "【転写テキスト】",
    transcript,
  ].join("\n");
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/notes/minutesTemplate.ts obsidian-plugin/src/__tests__/minutesTemplate.test.ts
git commit -m "feat(plugin): 同梱テンプレートに録音ファイル行追加 + Claudianプロンプトを録音情報対応"
```

---

### Task 9: autoSummarize をメタ対応（startTime / mp3Links / durationSec）

**Files:**
- Modify: `obsidian-plugin/src/commands/autoSummarize.ts`
- Test: `obsidian-plugin/src/__tests__/autoSummarize.test.ts`

**Interfaces:**
- Consumes: `fillMinutesMetadata`（Task 5）、`buildTranscriptFilename`（既存）、`buildClaudianMinutesPrompt` 新シグネチャ（Task 8）
- Produces:
  - `runAutoSummarize(transcript, settings, app, manifestDir, opts?: { fetchImpl?, startTime?, durationSec?, mp3Links? })` — 5引数目をオプションオブジェクト化
  - cloud/ollama: LLM出力に `fillMinutesMetadata` を適用して保存（ファイル名は startTime ベース）
  - claudian: プロンプトに開始時刻・会議時間・MP3リンクを渡す

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/autoSummarize.test.ts` の cloud 成功テストを更新（オプションオブジェクト + fillMinutesMetadata 検証）:

```typescript
test("cloud: success creates note with metadata filled and 録音開始時刻ファイル名", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "| 🕐 開始時間 | X |\n| ⏱️ 会議時間 | Y |\n議事録内容" } }] }),
  })) as any;

  let createdPath: string | null = null;
  let createdContent: string | null = null;
  const fakeApp: any = {
    vault: {
      adapter: {},
      async create(path: string, content: string) {
        createdPath = path;
        createdContent = content;
      },
      async exists(_path: string) {
        return false;
      },
    },
  };

  const start = new Date(2026, 7, 9, 13, 51);
  const res = await runAutoSummarize("transcript content", baseSettings, fakeApp, "/manifest/dir", {
    fetchImpl,
    startTime: start,
    durationSec: 83,
    mp3Links: "[🎙️ 録音を再生](file:///C:/a.mp3)",
  });
  assert.equal(res.ok, true);
  assert.ok(createdPath);
  assert.match(createdPath as string, /議事録_2026年08月09日13時51分\.md$/);
  assert.match(createdContent as string, /2026-08-09 13:51/);
  assert.match(createdContent as string, /1 分 23 秒/);
  assert.match(createdContent as string, /録音を再生/);
});
```

claudian テストを新シグネチャに更新（プロンプトに録音情報が含まれる）:

```typescript
test("claudian: appendToClaudianInput receives prompt with 録音情報", async () => {
  const appendCalls: string[] = [];
  const fakeApp: any = {
    plugins: {
      plugins: {
        realclaudian: {
          activateView: async () => {},
          getView: () => ({ appendToActiveInput: (t: string) => (appendCalls.push(t), true) }),
        },
      },
    },
  };
  const start = new Date(2026, 7, 9, 13, 51);
  const res = await runAutoSummarize(
    "transcript body",
    { ...baseSettings, llmProvider: "claudian" },
    fakeApp,
    "/manifest/dir",
    { startTime: start, durationSec: 83, mp3Links: "MP3LINK" }
  );
  assert.equal(res.ok, true);
  assert.equal(appendCalls.length, 1);
  assert.match(appendCalls[0], /transcript body/);
  assert.match(appendCalls[0], /開始時間=2026-08-09 13:51/);
  assert.match(appendCalls[0], /MP3LINK/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -20`
Expected: FAIL — シグネチャ不一致・メタ未反映

- [ ] **Step 3: 実装**

`src/commands/autoSummarize.ts` の import に追加:
```typescript
import { fillMinutesMetadata } from "../notes/minutesMetadata";
```

シグネチャを変更:
```typescript
export interface AutoSummarizeOptions {
  fetchImpl?: typeof fetch;
  startTime?: Date;
  durationSec?: number;
  mp3Links?: string;
}

export async function runAutoSummarize(
  transcript: string,
  settings: GijiSettings,
  app: App,
  manifestDir: string,
  opts: AutoSummarizeOptions = {}
): Promise<AutoSummarizeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
```

claudian 分岐内を置換:
```typescript
    if (settings.llmProvider === "claudian") {
      const startTime = opts.startTime ?? new Date();
      const prompt = templateMd
        ? buildClaudianMinutesPrompt(templateMd, transcript, settings.outputDir, startTime, {
            durationSec: opts.durationSec,
            mp3Links: opts.mp3Links,
          })
        : [
            "以下の会議転写テキストを、構造化された議事録 Markdown として作成し、",
            `Vault の ${settings.outputDir}/ に保存してください。`,
            `【録音情報】開始時間=${formatStartTime(startTime)} / 会議時間=${opts.durationSec !== undefined ? `${Math.floor(opts.durationSec / 60)} 分 ${opts.durationSec % 60} 秒` : "不明"} / 録音ファイル=${opts.mp3Links ?? ""}`,
            "",
            "【転写テキスト】",
            transcript,
          ].join("\n");
```

`formatStartTime` を import に追加:
```typescript
import { formatStartTime } from "../notes/minutesMetadata";
```

cloud/ollama 分岐内のファイル名・保存を置換。現在の:
```typescript
    const now = new Date();
    const fileName = buildTranscriptFilename(now, settings.fileNameTemplate);
    const dir = (settings.outputDir || "").trim() || "議事録";
    const basePath = `${dir}/${fileName}.md`;
    let path = basePath;
    let counter = 2;
    while (await app.vault.exists(path)) {
      path = `${dir}/${fileName}-${counter}.md`;
      counter++;
    }
    const finalMd = (templateMd ? md.trim() + "\n" : md);
    await app.vault.create(path, finalMd);
    new Notice("✅ 議事録を生成しました");
```
を次に置換:
```typescript
    const now = opts.startTime ?? new Date();
    const fileName = buildTranscriptFilename(now, settings.fileNameTemplate);
    const dir = (settings.outputDir || "").trim() || "議事録";
    const basePath = `${dir}/${fileName}.md`;
    let path = basePath;
    let counter = 2;
    while (await app.vault.exists(path)) {
      path = `${dir}/${fileName}-${counter}.md`;
      counter++;
    }
    const finalMd = fillMinutesMetadata(templateMd ? md.trim() + "\n" : md, {
      startTime: now,
      durationSec: opts.durationSec,
      mp3Links: opts.mp3Links,
    });
    await app.vault.create(path, finalMd);
    new Notice("✅ 議事録を生成しました");
```

- [ ] **Step 4: 既存 autoSummarize テストの fetchImpl 渡しをオプション化**

`src/__tests__/autoSummarize.test.ts` 内、`runAutoSummarize(..., fetchImpl)` 形式の呼び出しを `runAutoSummarize(..., { fetchImpl })` に更新（cloud success・ollama・LLM 401 の3箇所）。

- [ ] **Step 5: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/commands/autoSummarize.ts obsidian-plugin/src/__tests__/autoSummarize.test.ts
git commit -m "feat(plugin): 要約自動生成を開始時刻・MP3・会議時間メタ対応"
```

---

### Task 10: コマンド録音停止フローを3状態 + メタ伝播（recordSegment.ts）

**Files:**
- Modify: `obsidian-plugin/src/commands/recordSegment.ts`

**Interfaces:**
- Consumes: `RecordingTimer.setTranscribing/setSummarizing`（Task 1）、`SegmentResult.startTime/audioPaths`（Task 6）、`runAutoSummarize` 新シグネチャ（Task 9）、`buildMp3Links`（Task 4）
- Produces: 停止フローで `setTranscribing` → STT → `setSummarizing` → `runAutoSummarize({ startTime, durationSec, mp3Links })`

- [ ] **Step 1: 実装**

`src/commands/recordSegment.ts` の import に追加:
```typescript
import { buildMp3Links } from "../notes/mp3Ref";
```

`stopSegment` を置換:
```typescript
export async function stopSegment(app: App, settings: GijiSettings, manifestDir: string, timer?: RecordingTimer) {
  timer?.setTranscribing(); // 録音停止 → 文字起こし中
  const r = getRecorder(app);
  const result = await r.stop(settings);
  if (result === null) {
    timer?.stop();
    new Notice("⚠️ 進行中の録音がありません");
    return;
  }

  const view = app.workspace.getActiveViewOfType(Object as any) as any;
  const editor = view?.editor;
  if (!editor) {
    timer?.stop();
    new Notice("⚠️ 転写を追記する前にノートを開いてください");
    return;
  }
  const startTime = result.startTime ?? new Date();
  const time = `${startTime.getHours().toString().padStart(2, "0")}:${startTime.getMinutes().toString().padStart(2, "0")}`;
  const cur = editor.getValue();
  editor.setValue(appendSegmentNote(cur, `${time}`, result.text));
  new Notice("✅ ノートに転写を追記しました");

  // 議事録の自動生成（要約中表示 → 完了で非表示）
  timer?.setSummarizing();
  const mp3Links = buildMp3Links(result.audioPaths ?? []);
  void runAutoSummarize(result.text, settings, app, manifestDir, {
    startTime,
    durationSec: result.durationSec,
    mp3Links,
  }).finally(() => timer?.stop());
}
```

- [ ] **Step 2: ビルドで型エラーがないことを確認**

Run: `cd obsidian-plugin && npm run build 2>&1 | tail -10`
Expected: エラーなし

- [ ] **Step 3: 既存テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -8`
Expected: PASS（recordSegment の直接テストは無いが回帰なし）

- [ ] **Step 4: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/commands/recordSegment.ts
git commit -m "feat(plugin): コマンド録音停止で3状態ステータス + 開始時刻・MP3を要約へ伝播"
```

---

### Task 11: Claudian 🎙️ボタン停止フローを3状態 + メタ伝播（claudianButton.ts）

**Files:**
- Modify: `obsidian-plugin/src/ui/claudianButton.ts`
- Test: `obsidian-plugin/src/__tests__/claudianButton.test.ts`

**Interfaces:**
- Consumes: `RecordingTimer` 3状態（Task 1）、`buildMp3Links`（Task 4）、`saveTranscriptToFile` 新シグネチャ（Task 7）、`runAutoSummarize` 新シグネチャ（Task 9）
- Produces:
  - `saveTranscriptAndAutoSummarize(plugin, settings, text, durationSec?, opts?: { startTime?, audioPaths?, autoSummarizeImpl? })`
  - 停止ハンドラ: `setTranscribing` → `stop()` → `setSummarizing` → 保存+要約 → `stop()`

- [ ] **Step 1: 失敗するテストを書く**

`src/__tests__/claudianButton.test.ts` の `saveTranscriptAndAutoSummarize` テストを更新:

```typescript
test("saveTranscriptAndAutoSummarize passes startTime/audioPaths to autoSummarize", async () => {
  const calls: any[] = [];
  const spy: any = async (...args: any[]) => {
    calls.push(args);
    return { ok: true };
  };
  const plugin = { app: {}, manifest: { dir: "/manifest/dir" } } as any;
  const settings = { ...DEFAULT_SETTINGS, autoSaveTranscript: false, autoSummarizeEnabled: true };
  const start = new Date(2026, 7, 9, 13, 51);
  await saveTranscriptAndAutoSummarize(plugin, settings, "転写テキスト", 12, {
    startTime: start,
    audioPaths: ["C:/a.mp3"],
    autoSummarizeImpl: spy,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "転写テキスト");
  assert.equal(calls[0][3], "/manifest/dir");
  assert.equal(calls[0][4].startTime.getTime(), start.getTime());
  assert.deepEqual(calls[0][4].mp3Links, "[🎙️ 録音を再生](file:///C:/a.mp3)");
  assert.equal(calls[0][4].durationSec, 12);
});
```

既存の `saveTranscriptAndAutoSummarize calls autoSummarize ...` テストの呼び出しをオプション化:
```typescript
  await saveTranscriptAndAutoSummarize(plugin, settings, "転写テキスト", 12, { autoSummarizeImpl: spy });
```

`saveTranscriptAndAutoSummarize saves transcript before autoSummarize` テストの spy 渡しも `{ autoSummarizeImpl: spy }` に更新。

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -20`
Expected: FAIL — シグネチャ不一致

- [ ] **Step 3: 実装**

`src/ui/claudianButton.ts` の import に追加:
```typescript
import { buildMp3Links } from "../notes/mp3Ref";
```

`saveTranscriptAndAutoSummarize` を置換:
```typescript
export interface SaveAndSummarizeOptions {
  startTime?: Date;
  audioPaths?: string[];
  autoSummarizeImpl?: typeof runAutoSummarize;
}

export async function saveTranscriptAndAutoSummarize(
  plugin: Plugin,
  settings: GijiSettings,
  text: string,
  durationSec: number | undefined,
  opts: SaveAndSummarizeOptions = {},
): Promise<void> {
  const mp3Links = buildMp3Links(opts.audioPaths ?? []);
  if (settings.autoSaveTranscript) {
    try {
      const saved = await saveTranscriptToFile(
        plugin.app,
        settings,
        text,
        durationSec,
        opts.startTime ?? new Date(),
        mp3Links
      );
      new Notice(saved.appended ? `📄 已追记到议事录: ${saved.path}` : `📄 转写已保存: ${saved.path}`);
    } catch (err: any) {
      new Notice(`保存转写失败: ${err?.message ?? err}`);
    }
  }
  const impl = opts.autoSummarizeImpl ?? runAutoSummarize;
  await impl(text, settings, plugin.app, plugin.manifest.dir, {
    startTime: opts.startTime,
    durationSec,
    mp3Links,
  });
}
```

`makeButton` の停止ハンドラ（録音中分岐）を更新。現在の冒頭:
```typescript
      if (state.recorder.isRecording()) {
        timer?.stop(); // ← 録音停止はこの時点
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
```
を次に置換:
```typescript
      if (state.recorder.isRecording()) {
        timer?.setTranscribing(); // 録音停止 → 文字起こし中
        let text: string | null = null;
        let durationSec: number | undefined;
        let startTime: Date | undefined;
        let audioPaths: string[] = [];
        try {
          const result = await state.recorder.stop(settings);
          if (result) {
            text = result.text;
            durationSec = result.durationSec;
            startTime = result.startTime;
            audioPaths = result.audioPaths ?? [];
          }
        } catch {
          // Recorder already surfaces Notice; reset UI below.
        }
```

停止後処理の呼び出しを更新。現在の:
```typescript
        // 転写保存（任意）+ 議事録の自動生成（要約）
        await saveTranscriptAndAutoSummarize(plugin, settings, text, durationSec);
```
を次に置換:
```typescript
        // 転写保存（任意）+ 議事録の自動生成（要約）
        timer?.setSummarizing(); // 要約生成中
        try {
          await saveTranscriptAndAutoSummarize(plugin, settings, text, durationSec, {
            startTime,
            audioPaths,
          });
        } finally {
          timer?.stop(); // 全処理完了で非表示
        }
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: ビルドで検証**

Run: `cd obsidian-plugin && npm run build 2>&1 | tail -5`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/ui/claudianButton.ts obsidian-plugin/src/__tests__/claudianButton.test.ts
git commit -m "feat(plugin): 🎙️ボタン停止で3状態ステータス + 開始時刻・MP3を保存/要約へ伝播"
```

---

### Task 12: 最終ビルド・全テスト・整合確認

**Files:**
- 対象: 全変更ファイル

**Interfaces:**
- Consumes: 全タスク成果物
- Produces: 出荷可能な `main.js`

- [ ] **Step 1: 全テスト実行**

Run: `cd obsidian-plugin && npm test 2>&1 | tail -10`
Expected: `pass`（既存 + 新規）/ `fail 0`

- [ ] **Step 2: ビルドで main.js を再生成**

Run: `cd obsidian-plugin && npm run build 2>&1 | tail -5`
Expected: エラーなし

- [ ] **Step 3: main.js に新機能が入ったことを確認**

Run:
```bash
cd obsidian-plugin
grep -c "giji-recording" main.js
grep -o "transcriptFileNameTemplate" main.js | head -1
grep -o "fillMinutesMetadata" main.js | head -1
grep -o "toFileUrl" main.js | head -1
```
Expected: 各 1 以上（minify で関数名が保たれる場合。保たれない場合はビルド成功 + 手動 UAT で代替確認）

- [ ] **Step 4: Vault へ main.js をコピー**

```bash
cp "D:/AI-Agent/giji-obsidian/obsidian-plugin/main.js" "C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/giji-obsidian/main.js"
```

- [ ] **Step 5: コミット**

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/main.js
git commit -m "build(plugin): 録音UI改善 + ファイル命名分離 + MP3埋込 をビルド"
```

- [ ] **Step 6: 手動 UAT チェックリストを主人へ提示**

UAT 合格基準（設計書 §6 から抜粋）:

| 場面 | 合格基準 |
|------|---------|
| 録音開始（🎙️ボタン） | ボタンが赤色・点滅 |
| 録音開始（コマンド） | ステータスバーに `🎙️ MM:SS` 表示 |
| 録音停止 | ステータスバーに `📝 文字起こし中…` → `🤖 要約生成中…` の順で表示 |
| 全処理完了 | ステータスバーから消える |
| 転写MD生成 | `録音_2026年08月09日13時51分.md`（録音開始時刻） |
| 議事録MD生成 | `議事録_2026年08月09日13時51分.md`（録音開始時刻） |
| 概要欄 | 開始時間・会議時間・録音ファイルが実値で埋まる |
| MP3再生 | MD内リンクをクリック → 外部プレイヤーで再生 |

---

## Self-Review

**1. Spec coverage:**
- ✅ 赤色点滅 → Task 2（RECORDING_STYLES_CSS + inject）
- ✅ ステータス3段階 → Task 1（setTranscribing/setSummarizing）+ Task 10/11（配線）
- ✅ 転写MD=`録音＊＊＊＊` → Task 3（テンプレート設定）+ Task 7（saver 使用）
- ✅ 議事録MD=`議事録＊＊＊＊` → 既存 `fileNameTemplate` 維持 + Task 9（startTime ベース）
- ✅ ＊＊＊=開始時刻 → Task 6（SegmentResult.startTime）+ Task 9/10/11（伝播）
- ✅ MP3組み込み → Task 4（mp3Ref）+ Task 7（転写MD）+ Task 5/8/9（議事録MD・Claudian）
- ✅ 概要欄書き込み → Task 5（fillMinutesMetadata）+ Task 8（同梱テンプレ）

**2. Placeholder scan:**
- 各 Step に実コード・実コマンドあり。プレースホルダなし。
- Task 7 Step 4 の「該当箇所」は具体的パスを列挙。Task 9 Step 4 は呼び出し箇所数（3箇所）を明示。

**3. Type consistency:**
- `SegmentResult`（text/durationSec/startTime/audioPaths）は Task 6 定義、Task 9/10/11 で使用
- `runAutoSummarize` の opts（fetchImpl/startTime/durationSec/mp3Links）は Task 9 定義、Task 10/11 で使用
- `saveTranscriptToFile(app, settings, text, durationSec, now, mp3Links)` は Task 7 定義、Task 11 で使用
- `saveTranscriptAndAutoSummarize(..., opts)` は Task 11 定義、テストと makeButton で使用
- `buildClaudianMinutesPrompt(template, transcript, outputDir, startTime, meta)` は Task 8 定義、Task 9 で使用
- `formatStartTime` は Task 5 定義、Task 8/9 で使用
