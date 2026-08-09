# Auto-Summarize & Japanese Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定ページに「📋 要約自動生成」トグル（デフォルト ON）を追加。ON のとき録音停止→転写追記後に自動で議事録を生成（cloud/ollama は新ノート作成、claudian は Claudian 入力欄にプロンプト挿入）。同時に録音フローの Notice をすべて日本語化する。承認済み設計書 `03_議事録自動生成設定.md v1.0.0` を完全実装する。

**Architecture:** 既存ユーティリティを再利用して新ファイル `src/commands/autoSummarize.ts` にオーケストレーション関数を切り出す（`loadMinutesTemplate` / `buildClaudianMinutesPrompt` / `appendToClaudianInput` を呼ぶ）。`recordSegment.ts::stopSegment` のフロー末尾から `runAutoSummarize()` を呼ぶ。Notice メッセージは該当行を直接置換。

**Tech Stack:** TypeScript、Obsidian API、node:test + tsx、esbuild。

## Global Constraints

- ソース：`D:\AI-Agent\giji-obsidian\`（git リポジトリ、master、コミット可；コミット接頭辞 `feat(plugin):` / `test(plugin):` / `fix(plugin):`）
- プラグインソースは `obsidian-plugin/`；テスト実行 `cd obsidian-plugin && npm test`（`tsx --test "src/__tests__/**/*.test.ts"`、preload は `src/__tests__/setup.cjs` の `obsidian` モジュールスタブ）
- ビルド `cd obsidian-plugin && npm run build`（esbuild → `main.js`、electron/obsidian/builtin は external、target es2022）
- デプロイ：`obsidian-plugin/main.js` + `manifest.json` を `C:\Users\superlambkin\OneDrive\Edge\Obsidian Vault\.obsidian\plugins\giji-obsidian\` へコピー（`cp`）
- **fetch は必ず `fetch.bind(globalThis)` を使う**（Chromium Illegal invocation 前例 56fd94e）
- `createLlmProvider(settings, fetchImpl)` の引数順は `src/providers/llm.ts` 既存実装と一致（`settings, fetchImpl`）
- `appendToClaudianInput(app, text)` は `src/ui/claudianApi.ts` の既存実装（claudian-selection-bridge 実績パターン）。**挿入は自動要約時のみ呼ぶ**（テストボタンでは呼ばない）
- 機能コード内の自然言語文字列（エラーメッセージ、Notice メッセージ）は設計書 §5 と**完全一致**させる
- 既存ユーティリティ（`loadMinutesTemplate`, `buildClaudianMinutesPrompt`, `appendToClaudianInput`, `buildTranscriptFilename`）は変更しない
- 既存ユーザー（`data.json` に新フィールドなし）にもデフォルト ON が適用される `loadSettings` マイグレーションを入れる

---

## File Map

```
obsidian-plugin/
├── src/
│   ├── commands/
│   │   ├── recordSegment.ts    (変更: stopSegment 拡張 + 日本語 Notice)
│   │   ├── autoSummarize.ts    (新)
│   │   └── importAudio.ts      (既存・変更なし)
│   ├── audio/
│   │   └── recorder.ts         (変更: 日本語 Notice のみ)
│   ├── ui/
│   │   └── claudianApi.ts      (既存・変更なし、ただし呼び出しは autoSummarize.ts からのみ)
│   ├── notes/
│   │   ├── minutesTemplate.ts  (既存・変更なし: loadMinutesTemplate/buildClaudianMinutesPrompt を再利用)
│   │   └── saver.ts            (既存・変更なし: buildTranscriptFilename を再利用)
│   ├── settings.ts             (変更: GijiSettings に autoSummarizeEnabled 追加 + DEFAULT_SETTINGS + UI トグル)
│   ├── main.ts                 (変更: loadSettings でデフォルト ON マイグレーション)
│   └── __tests__/
│       └── autoSummarize.test.ts (新)
└── main.js                     (npm run build で生成)
```

---

### Task 1: autoSummarize.ts（runAutoSummarize）+ 単体テスト

**Files:**
- Create: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\commands\autoSummarize.ts`
- Create: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__\autoSummarize.test.ts`

**Interfaces:**
- Consumes:
  - `GijiSettings`（`src/settings.ts`）
  - `App`（Obsidian API）
  - `createLlmProvider(settings, fetchImpl)`（`src/providers/llm.ts`）
  - `loadMinutesTemplate(app, settings, manifestDir)`（`src/notes/minutesTemplate.ts`）
  - `buildClaudianMinutesPrompt(template, transcript, outputDir, date)`（`src/notes/minutesTemplate.ts`）
  - `buildTemplateSystemPrompt(template)`（`src/notes/minutesTemplate.ts`）
  - `MINUTES_SYSTEM_PROMPT`（`src/notes/generator.ts`）
  - `appendToClaudianInput(app, text)`（`src/ui/claudianApi.ts`）
  - `buildTranscriptFilename(now, template)`（`src/notes/saver.ts`）
- Produces:
  - `export interface AutoSummarizeResult { ok: boolean; error?: string; skippedReason?: "disabled" | "no-llm-configured" }`
  - `export async function runAutoSummarize(transcript: string, settings: GijiSettings, app: App, manifestDir: string, fetchImpl?: typeof fetch): Promise<AutoSummarizeResult>`

- [ ] **Step 1: 失敗するテストを書く**

`D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__\autoSummarize.test.ts` を新規作成：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { runAutoSummarize } from "../commands/autoSummarize";
import { DEFAULT_SETTINGS } from "../settings";

// loadMinutesTemplate は vault adapter を呼ぶため、app.adapter.exists/read をスタブする。
// テストではシンプルに「テンプレ無し」で throw させ、disabled/no-llm-configured 系をカバーする。
// cloud/ollama/claudian の正常系は manifestDir を含むため、ここでは adapter をスタブする。

const baseSettings = {
  ...DEFAULT_SETTINGS,
  autoSummarizeEnabled: true,
  llmProvider: "cloud" as const,
  llmBaseUrl: "https://api.example.com/v1",
  llmModel: "test-model",
  llmApiKey: "test-key",
  outputDir: "Clippings",
};

test("disabled: returns skippedReason without calling anything", async () => {
  const res = await runAutoSummarize(
    "transcript",
    { ...baseSettings, autoSummarizeEnabled: false },
    {} as any,
    "/manifest/dir"
  );
  assert.equal(res.ok, true);
  assert.equal(res.skippedReason, "disabled");
});

test("no-llm-configured: cloud with empty baseUrl returns skippedReason", async () => {
  const res = await runAutoSummarize(
    "transcript",
    { ...baseSettings, llmBaseUrl: "" },
    {} as any,
    "/manifest/dir"
  );
  assert.equal(res.ok, false);
  assert.equal(res.skippedReason, "no-llm-configured");
});

test("no-llm-configured: cloud with empty model returns skippedReason", async () => {
  const res = await runAutoSummarize(
    "transcript",
    { ...baseSettings, llmModel: "" },
    {} as any,
    "/manifest/dir"
  );
  assert.equal(res.ok, false);
  assert.equal(res.skippedReason, "no-llm-configured");
});

test("no-llm-configured: cloud with empty apiKey returns skippedReason", async () => {
  const res = await runAutoSummarize(
    "transcript",
    { ...baseSettings, llmApiKey: "" },
    {} as any,
    "/manifest/dir"
  );
  assert.equal(res.ok, false);
  assert.equal(res.skippedReason, "no-llm-configured");
});

test("cloud: success creates a new note via vault.create", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "# 議事録\n- 要約 A" } }] }),
  })) as any;

  let createdPath: string | null = null;
  let createdContent: string | null = null;
  const fakeApp: any = {
    vault: {
      adapter: {
        // テンプレ無し → loadMinutesTemplate が throw するためテンプレロード失敗ケースを許容
        // ここでは template を使わず MINUTES_SYSTEM_PROMPT を使う path を通すためスタブ不要
      },
      async create(path: string, content: string) {
        createdPath = path;
        createdContent = content;
      },
      async exists(_path: string) {
        return false;
      },
    },
  };

  const res = await runAutoSummarize(
    "transcript content",
    baseSettings,
    fakeApp,
    "/manifest/dir",
    fetchImpl
  );
  assert.equal(res.ok, true);
  assert.ok(createdPath, "vault.create should be called");
  assert.ok((createdPath as string).startsWith("Clippings/議事録_"));
  assert.match((createdContent as string), /議事録/);
  assert.match((createdContent as string), /transcript content/);
});

test("ollama: empty apiKey is allowed", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "ok" } }] }),
  })) as any;
  let createdPath: string | null = null;
  const fakeApp: any = {
    vault: {
      async create(path: string, _c: string) {
        createdPath = path;
      },
      async exists(_p: string) {
        return false;
      },
    },
  };
  const res = await runAutoSummarize(
    "t",
    { ...baseSettings, llmProvider: "ollama", llmApiKey: "" },
    fakeApp,
    "/manifest/dir",
    fetchImpl
  );
  assert.equal(res.ok, true);
  assert.ok(createdPath);
});

test("claudian: appendToClaudianInput receives prompt containing SUMMARY command", async () => {
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
  const res = await runAutoSummarize(
    "transcript body",
    { ...baseSettings, llmProvider: "claudian" },
    fakeApp,
    "/manifest/dir"
  );
  assert.equal(res.ok, true);
  assert.equal(appendCalls.length, 1);
  // buildClaudianMinutesPrompt が出力するプロンプトは transcript body を含む
  assert.match(appendCalls[0], /transcript body/);
  // SUMMARY 命令が含まれている（Claude が議事録を生成する指示）
  assert.match(appendCalls[0], /議事録|SUMMARY|要約/);
});

test("claudian: missing plugin returns error result", async () => {
  const fakeApp: any = { plugins: { plugins: {} } };
  const res = await runAutoSummarize(
    "t",
    { ...baseSettings, llmProvider: "claudian" },
    fakeApp,
    "/manifest/dir"
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /Claudian プラグインが見つかりません/);
});

test("cloud: LLM 401 surfaces error", async () => {
  const fetchImpl = (async () => ({
    ok: false,
    status: 401,
    text: async () => "invalid api key",
  })) as any;
  const fakeApp: any = {
    vault: { async create() {}, async exists() { return false; } },
  };
  const res = await runAutoSummarize(
    "t",
    baseSettings,
    fakeApp,
    "/manifest/dir",
    fetchImpl
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /401/);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

実行:
```bash
cd /d/AI-Agent/giji-obsidian/obsidian-plugin && npm test -- --test-name-pattern="autoSummarize" 2>&1 | tail -10
```
期待結果: FAIL — `Cannot find module '../commands/autoSummarize'`

- [ ] **Step 3: 最小実装を書く**

`D:\AI-Agent\giji-obsidian\obsidian-plugin\src\commands\autoSummarize.ts` を新規作成：

```ts
import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { createLlmProvider } from "../providers/llm";
import {
  loadMinutesTemplate,
  buildClaudianMinutesPrompt,
  buildTemplateSystemPrompt,
} from "../notes/minutesTemplate";
import { MINUTES_SYSTEM_PROMPT } from "../notes/generator";
import { appendToClaudianInput } from "../ui/claudianApi";
import { buildTranscriptFilename } from "../notes/saver";

export interface AutoSummarizeResult {
  ok: boolean;
  error?: string;
  skippedReason?: "disabled" | "no-llm-configured";
}

function isLlmConfigured(s: GijiSettings): boolean {
  if (s.llmProvider === "claudian") return true; // claudian は検出時に判定
  if (!s.llmBaseUrl.trim()) return false;
  if (!s.llmModel.trim()) return false;
  if (s.llmProvider === "cloud" && !s.llmApiKey) return false;
  return true;
}

export async function runAutoSummarize(
  transcript: string,
  settings: GijiSettings,
  app: App,
  manifestDir: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis)
): Promise<AutoSummarizeResult> {
  if (!settings.autoSummarizeEnabled) {
    return { ok: true, skippedReason: "disabled" };
  }
  if (!isLlmConfigured(settings)) {
    new Notice("⚠️ LLM プロバイダーが未設定のため、要約自動生成をスキップしました");
    return { ok: false, skippedReason: "no-llm-configured" };
  }

  try {
    // テンプレートのロードを試行（無ければ MINUTES_SYSTEM_PROMPT を使う）
    let templateMd: string | undefined;
    try {
      templateMd = await loadMinutesTemplate(app, settings, manifestDir);
    } catch {
      templateMd = undefined;
    }

    if (settings.llmProvider === "claudian") {
      const date = new Date().toISOString().slice(0, 10);
      const prompt = templateMd
        ? buildClaudianMinutesPrompt(templateMd, transcript, settings.outputDir, date)
        : [
            "以下の会議転写テキストを構造化された議事録 Markdown として作成し、",
            `Vault の ${settings.outputDir}/ に保存してください。`,
            "",
            "【転写テキスト】",
            transcript,
          ].join("\n");
      const ok = await appendToClaudianInput(app, prompt);
      if (!ok) {
        new Notice("⚠️ Claudian プラグインが見つかりません（未インストールまたは未有効化）");
        return { ok: false, error: "Claudian プラグインが見つかりません（未インストールまたは未有効化）" };
      }
      new Notice("📋 Claudian に要約プロンプトを送信しました");
      return { ok: true };
    }

    // cloud / ollama
    const llm = createLlmProvider(settings, fetchImpl);
    const systemPrompt = templateMd ? buildTemplateSystemPrompt(templateMd) : MINUTES_SYSTEM_PROMPT;
    const md = await llm.complete(systemPrompt, transcript);

    const now = new Date();
    const fileName = buildTranscriptFilename(now, settings.fileNameTemplate);
    const dir = (settings.outputDir || "").trim() || "Clippings";
    const basePath = `${dir}/${fileName}.md`;
    let path = basePath;
    let counter = 2;
    const adapter = app.vault.adapter as any;
    while (await adapter.exists(path)) {
      path = `${dir}/${fileName}-${counter}.md`;
      counter++;
    }
    const finalMd = (templateMd ? md.trim() + "\n" : md);
    await app.vault.create(path, finalMd);
    new Notice("✅ 議事録を生成しました");
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    new Notice(`⚠️ 議事録の生成に失敗しました: ${msg}`);
    return { ok: false, error: msg };
  }
}
```

- [ ] **Step 4: テストを実行して合格を確認**

実行:
```bash
cd /d/AI-Agent/giji-obsidian/obsidian-plugin && npm test 2>&1 | tail -15
```
期待結果: 既存テスト全件（95 件）+ 新規 autoSummarize テスト 9 件 PASS（合計 104 件）

- [ ] **Step 5: コミット**

```bash
cd /d/AI-Agent/giji-obsidian
git add obsidian-plugin/src/commands/autoSummarize.ts obsidian-plugin/src/__tests__/autoSummarize.test.ts
git commit -m "feat(plugin): 議事録自動生成 runAutoSummarize（cloud/ollama 新ノート作成・claudian プロンプト挿入）+ 単体テスト"
```

---

### Task 2: 設定追加・recordSegment 統合・日本語 Notice 化・ビルド・デプロイ

**Files:**
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\settings.ts`
  - `GijiSettings` インターフェースに `autoSummarizeEnabled: boolean` 追加
  - `DEFAULT_SETTINGS` に `autoSummarizeEnabled: true` 追加
  - 設定ページ LLM 領域（要約関連ブロック内）に「📋 要約自動生成」トグル UI 追加
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\main.ts`
  - `loadSettings()` に既存ユーザー向けデフォルト ON マイグレーション追加
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\commands\recordSegment.ts`
  - `import { runAutoSummarize } from "./autoSummarize";` 追加
  - `stopSegment()` のフロー末尾で `runAutoSummarize()` を呼ぶ（fire-and-forget で OK、エラーは内部 Notice で表示済み）
  - 既存 4 つの Notice をすべて日本語に置換
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\audio\recorder.ts`
  - 既存 2 つの Notice（bridgeHealth 失敗・録音失敗）をすべて日本語に置換

**Interfaces:**
- Consumes: `runAutoSummarize(transcript, settings, app, manifestDir)`（Task 1）、`this.manifest.dir`（main.ts 側で取得可能。recordSegment には別途渡す必要あり）
- Produces: 設定 UI トグル、stopSegment の自動要約呼び出し、日本語化された Notice

> ⚠️ `recordSegment` に `manifestDir` を渡すため、`startSegment`/`stopSegment` のシグネチャに第 4 引数 `manifestDir: string` を追加する。`main.ts` の `addCommand` 呼び出しも合わせて `this.manifest.dir` を渡す。

- [ ] **Step 1: settings.ts — フィールド + DEFAULT + UI トグル追加**

`src/settings.ts` の `GijiSettings` インターフェースに `// ③ 要約` セクションへ追加：

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
  autoSummarizeEnabled: boolean;  // ← 追加
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
  // ② 文字起こし（保存・挿入）
  autoSaveTranscript: boolean;
  transcriptSaveDir: string;
  fileNameTemplate: string;
  insertToClaudianEnabled: boolean;
  // ④ その他
  emailSummaryEnabled: boolean;
}
```

`DEFAULT_SETTINGS` に追加（`llmApiKey` の直後）：

```ts
  llmApiKey: "",
  autoSummarizeEnabled: true,  // ← 追加
  outputDir: "Clippings",
```

LLM 領域内の適切な位置（`LLM API キー` 設定ブロックの直前など）に UI トグルを追加：

```ts
    new Setting(containerEl)
      .setName("📋 要約自動生成")
      .setDesc("ON の場合、転写完了後に自動で議事録を生成します（OFF で従来通り）")
      .addToggle((t) =>
        t.setValue(s.autoSummarizeEnabled).onChange(async (v: boolean) => {
          s.autoSummarizeEnabled = v;
          await this.save();
        })
      );
```

- [ ] **Step 2: main.ts — loadSettings マイグレーション**

`src/main.ts` の `loadSettings()` を修正：

```ts
  async loadSettings() {
    this.settings = Object.assign(
      { autoSummarizeEnabled: true },  // 既存ユーザーにはデフォルト ON
      DEFAULT_SETTINGS,
      await this.loadData()
    );
    // 廃止・未対応プロバイダー値のマイグレーション（例: doubao / 旧デフォルト groq）
    if (!STT_PROVIDERS.includes(this.settings.sttProvider)) {
      this.settings.sttProvider = "openai";
    }
    if (!LLM_PROVIDERS.includes(this.settings.llmProvider)) {
      this.settings.llmProvider = "claudian";
    }
  }
```

> 注: 既存実装は `Object.assign({}, DEFAULT_SETTINGS, await this.loadData())` の形。新フィールド `autoSummarizeEnabled` は `DEFAULT_SETTINGS` にあるため**新規ユーザー**は問題なく ON で読み込まれる。**既存ユーザー**（`data.json` に新フィールドなし）は最初のセーブ時にデフォルト ON で書き込まれる（settings UI トグルを一度触らなくても ON で動作する）。

- [ ] **Step 3: recordSegment.ts — manifestDir 引数追加 + 自動要約呼び出し + 日本語 Notice**

`src/commands/recordSegment.ts` を**全面書き換え**：

```ts
import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { SegmentRecorder } from "../audio/recorder";
import { appendSegmentNote } from "../notes/generator";
import { runAutoSummarize } from "./autoSummarize";

let recorder: SegmentRecorder | null = null;

function getRecorder(app: App): SegmentRecorder {
  if (!recorder) recorder = new SegmentRecorder(app);
  return recorder;
}

export async function startSegment(app: App, settings: GijiSettings) {
  const r = getRecorder(app);
  const started = await r.start(settings);
  if (started) {
    new Notice("🎙️ 録音中… もう一度「停止して転写」を実行すると終了します");
  }
}

export async function stopSegment(app: App, settings: GijiSettings, manifestDir: string) {
  const r = getRecorder(app);
  const result = await r.stop(settings);
  if (result === null) return;

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

  // 議事録の自動生成（fire-and-forget。内部で Notice 表示）
  void runAutoSummarize(result.text, settings, app, manifestDir);
}
```

> 注: 既存の中国語 Notice（「🎙️ 录音中…」「当前没有进行中の録音」「请先打开…」「✅ 转写已追加」）はすべて日本語に置換済み。`r.start`/`r.stop` がスローした例外を上位に伝播させない（既存の挙動を維持）一方、`r.stop` の戻り値が `null`（=進行中の録音なし）の場合の Notice は旧コードでは未定義だったので**新規追加**する。

> ⚠️ 重要: 上記コードには「進行中の録音なし」の Notice を追加していない（既存コードに存在しなかったため）。ただし設計書 §5 #2 で「⚠️ 進行中の録音がありません」を要求しているため、`r.stop` の戻り値 null パスに以下を追加すること：

```ts
export async function stopSegment(app: App, settings: GijiSettings, manifestDir: string) {
  const r = getRecorder(app);
  const result = await r.stop(settings);
  if (result === null) {
    new Notice("⚠️ 進行中の録音がありません");
    return;
  }
  // ... 以下同じ
}
```

最終的な `stopSegment` 完全版：

```ts
import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { SegmentRecorder } from "../audio/recorder";
import { appendSegmentNote } from "../notes/generator";
import { runAutoSummarize } from "./autoSummarize";

let recorder: SegmentRecorder | null = null;

function getRecorder(app: App): SegmentRecorder {
  if (!recorder) recorder = new SegmentRecorder(app);
  return recorder;
}

export async function startSegment(app: App, settings: GijiSettings) {
  const r = getRecorder(app);
  const started = await r.start(settings);
  if (started) {
    new Notice("🎙️ 録音中… もう一度「停止して転写」を実行すると終了します");
  }
}

export async function stopSegment(app: App, settings: GijiSettings, manifestDir: string) {
  const r = getRecorder(app);
  const result = await r.stop(settings);
  if (result === null) {
    new Notice("⚠️ 進行中の録音がありません");
    return;
  }

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

  // 議事録の自動生成（fire-and-forget。内部で Notice 表示）
  void runAutoSummarize(result.text, settings, app, manifestDir);
}
```

- [ ] **Step 4: main.ts — recordSegment コマンド呼び出しに manifestDir を渡す**

`src/main.ts` の `addCommand({ id: "record-stop", ... })` を修正：

```ts
    this.addCommand({
      id: "record-stop",
      name: "停止并转写（追加到笔记）",
      callback: () => stopSegment(this.app, this.settings, this.manifest.dir),
    });
```

> 注: コマンド名（表示文字列）も統一するなら「停止して転写（ノートに追記）」に変更可能だが、本タスクのスコープは UI 文字列ではない（設計書 §5 に含まれていない）ため、**コマンド名は変更しない**（将来の改善案）。

- [ ] **Step 5: audio/recorder.ts — 日本語 Notice 化**

`src/audio/recorder.ts` の Notice 2 箇所を日本語に置換：

- 既存: `new Notice("录音桥未启动，请先运行 recorder-bridge");` → `new Notice("⚠️ 録音ブリッジが起動していません。先に recorder-bridge を実行してください");`
- 既存: `new Notice(\`启动录音失败: ${err?.message ?? err}\`);` → `new Notice(\`⚠️ 録音の開始に失敗しました: ${err?.message ?? err}\`);`

確認: ファイルを開いて該当行を正確に置換する。`recorder.ts` 内に他の中国語 Notice が無いか grep で確認：

```bash
grep -n "录音桥\|启动录音" "D:\AI-Agent\giji-obsidian\obsidian-plugin\src\audio/recorder.ts"
```

なければ完了。あればすべて置換。

- [ ] **Step 6: テスト + ビルド**

実行:
```bash
cd /d/AI-Agent/giji-obsidian/obsidian-plugin && npm test 2>&1 | tail -15 && npm run build 2>&1 | tail -5
```
期待結果: 既存テスト + llmTest + autoSummarize テストすべて PASS（104 件）+ esbuild エラーなし

> 既存テストで `recordSegment` のテストがあるか確認: `grep -l "recordSegment\|stopSegment" "D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__/"` — 既存テストが無ければ影響なし、ある場合は `manifestDir` 引数追加への対応を確認。

- [ ] **Step 7: Vault へデプロイ**

実行:
```bash
cp "D:/AI-Agent/giji-obsidian/obsidian-plugin/main.js" "D:/AI-Agent/giji-obsidian/obsidian-plugin/manifest.json" "C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/giji-obsidian/" && echo "deployed"
```
期待結果: `deployed`（main.js のタイムスタンプが更新される）

- [ ] **Step 8: コミット**

```bash
cd /d/AI-Agent/giji-obsidian
git add obsidian-plugin/src/settings.ts obsidian-plugin/src/main.ts obsidian-plugin/src/commands/recordSegment.ts obsidian-plugin/src/audio/recorder.ts
git commit -m "feat(plugin): 要約自動生成トグル（デフォルト ON）+ 録音フローの Notice を日本語化"
```

---

## Self-Review

**1. 仕様カバレッジ（[[80_POC_Projects/POC_016_GijiObsidian/02_设计文档/03_議事録自動生成設定.md\|03_議事録自動生成設定 v1.0.0]]）:**

| 設計書セクション | カバー先タスク |
|---|---|
| §2.1 型定義 `AutoSummarizeResult` | Task 1 |
| §2.2 `runAutoSummarize` ロジック（disabled スキップ、isLlmConfigured チェック、claudian は appendToClaudianInput、cloud/ollama は vault.create、Notice 表示、catch 処理） | Task 1 |
| §2.3 `loadSettings` マイグレーション | Task 2 Step 2 |
| §4 UI トグル追加 | Task 2 Step 1 |
| §5 日本語 Notice 一覧（11 件）| Task 1（5,6,7,8,9） + Task 2 Step 3（1,2,3,4） + Task 2 Step 5（10,11） |
| §6 エラーハンドリング 6 シナリオ | Task 1（全て） |
| §7 自動テスト 7 ケース | Task 1 |
| §7 手動 UAT 4 場面 | **本計画スコープ外**（主人の実機受入） |

**2. プレースホルダースキャン:**
- 「TBD」「TODO」「適切に処理」「同上で」はなし
- 全テストコードに完全実装（9 ケース、design §7 で要求された 7 ケースより多め）
- `runAutoSummarize` 関数の完全実装を Step 3 で提示
- 設定 UI トグルの完全実装を Task 2 Step 1 で提示

**3. 型整合性:**
- `AutoSummarizeResult { ok: boolean; error?: string; skippedReason?: "disabled" | "no-llm-configured" }` は設計書 §2.1 と完全一致
- `runAutoSummarize(transcript: string, settings: GijiSettings, app: App, manifestDir: string, fetchImpl?: typeof fetch)` の引数順は設計書 §2.2 と完全一致
- `app.plugins.plugins["realclaudian"]` キー名は `src/ui/claudianApi.ts` 既存実装と一致
- `loadMinutesTemplate`/`buildClaudianMinutesPrompt`/`buildTemplateSystemPrompt` の引数順は `src/notes/minutesTemplate.ts` 既存実装と一致
- `appendToClaudianInput(app, text)` の引数順は `src/ui/claudianApi.ts` 既存実装と一致
- `buildTranscriptFilename(now, settings.fileNameTemplate)` の引数順は `src/notes/saver.ts` 既存実装と一致
- `createLlmProvider(settings, fetchImpl)` の引数順は `src/providers/llm.ts` 既存実装と一致
- `stopSegment(app, settings, manifestDir)` の新引数 `manifestDir: string` を `main.ts` の `addCommand` で `this.manifest.dir` から渡す流れが整合
- 設計書 §5 #1〜#11 の文言と本計画のコードブロック内文字列が**完全一致**

---

## Execution Handoff

Plan complete and saved to `D:\AI-Agent\giji-obsidian\docs\superpowers\plans\2026-08-09-auto-summarize-and-japanese-notices.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?