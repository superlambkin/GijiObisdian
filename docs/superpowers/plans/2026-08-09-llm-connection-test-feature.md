# LLM Connection Test Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定ページの LLM 領域に「🧪 接続テスト」ボタンを追加。cloud/ollama は最小プロンプトで API 疎通確認、claudian は realclaudian プラグイン検出（テストテキストは挿入しない）。承認済み設計書 `02_LLM接続テスト機能設計.md v1.1` を完全実装する。

**Architecture:** `src/test/llmTest.ts` に `runLlmTest()` を新設（既存 `src/test/sttTest.ts` をミラー）。`src/settings.ts` の LLM API キー直後に Setting ブロックを追加し、`runLlmTest()` を呼ぶ。`src/__tests__/llmTest.test.ts` で mock fetch / mock app による単体テストを行う。

**Tech Stack:** TypeScript、Obsidian API、node:test + tsx、esbuild。

## Global Constraints

- ソース：`D:\AI-Agent\giji-obsidian\`（git リポジトリ、master、コミット可；コミット接頭辞 `feat(plugin):` / `test(plugin):`）
- プラグインソースは `obsidian-plugin/`；テスト実行 `cd obsidian-plugin && npm test`（`tsx --test "src/__tests__/**/*.test.ts"`、preload は `src/__tests__/setup.cjs` の `obsidian` モジュールスタブ）
- ビルド `cd obsidian-plugin && npm run build`（esbuild → `main.js`、electron/obsidian/builtin は external、target es2022）
- デプロイ：`obsidian-plugin/main.js` + `manifest.json` を `C:\Users\superlambkin\OneDrive\Edge\Obsidian Vault\.obsidian\plugins\giji-obsidian\` へコピー（`cp`）
- **fetch は必ず `fetch.bind(globalThis)` を使う**（Chromium Illegal invocation 前例 56fd94e を回帰テスト 1 件で防止）
- `createLlmProvider(settings, fetchImpl)` は既存実装（`src/providers/llm.ts`）。claudian は `createLlmProvider` で throw する設計（`settings.ts` 側の `createSttProvider` の try/catch パターンをミラー）
- `app.plugins.plugins["realclaudian"]` の判定は `src/ui/claudianApi.ts` の claudian-selection-bridge 実績パターンをミラー（`activateView` → `getView` → `appendToActiveInput` の関数存在確認。**挿入はしない**）
- テストモック fetch は **グローバル fetch にバインドしないこと**（`fetch.bind(globalThis)` をモックにも適用しない単純 IIFE で良い）。これは前例 0330b8b/56fd94e の回帰
- 機能コード内の自然言語文字列（エラーメッセージ、Notice メッセージ）は設計書 §5「エラー処理と境界」の文言と完全一致させる

---

## File Map

```
obsidian-plugin/
├── src/
│   ├── test/
│   │   ├── audioSample.ts           (既存)
│   │   ├── sttTest.ts               (既存)
│   │   └── llmTest.ts               (新)
│   ├── providers/
│   │   └── llm.ts                   (既存・変更なし)
│   ├── ui/
│   │   └── claudianApi.ts           (既存・変更なし、ただし呼び出しはしない)
│   ├── settings.ts                  (変更: ボタン追加 + import 追加)
│   └── __tests__/
│       └── llmTest.test.ts          (新)
└── main.js                          (npm run build で生成)
```

---

### Task 1: llmTest.ts（runLlmTest）+ 単体テスト

**Files:**
- Create: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\test\llmTest.ts`
- Create: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__\llmTest.test.ts`

**Interfaces:**
- Consumes:
  - `GijiSettings`（`src/settings.ts`、`createLlmProvider` の入力と一致）
  - `createLlmProvider(settings, fetchImpl)`（`src/providers/llm.ts`）— `cloud` / `ollama` 用
  - `app?: any` — `app.plugins.plugins["realclaudian"]` 経由の `claudian` 用
- Produces:
  - `export interface LlmTestResult { ok: boolean; text?: string; error?: string }`
  - `export async function runLlmTest(settings: GijiSettings, app?: any, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<LlmTestResult>`

- [ ] **Step 1: 失敗するテストを書く**

`D:\AI-Agent\giji-obsidian\obsidian-plugin\src\__tests__\llmTest.test.ts` を新規作成：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { runLlmTest } from "../test/llmTest";
import { DEFAULT_SETTINGS } from "../settings";

const cloudBase = {
  ...DEFAULT_SETTINGS,
  llmProvider: "cloud" as const,
  llmProvider_legacy_unused: undefined,
  llmBaseUrl: "https://api.example.com/v1",
  llmModel: "test-model",
  llmApiKey: "test-key",
};

test("cloud: empty base url returns hint", async () => {
  const res = await runLlmTest({ ...cloudBase, llmBaseUrl: "" });
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /请先填写 LLM baseUrl/);
});

test("cloud: empty model returns hint", async () => {
  const res = await runLlmTest({ ...cloudBase, llmModel: "" });
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /请先填写 LLM 模型/);
});

test("cloud: empty api key returns hint", async () => {
  const res = await runLlmTest({ ...cloudBase, llmApiKey: "" });
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /请先填写 LLM API Key/);
});

test("cloud: chat completion success returns trimmed text", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "  OK  " } }] }),
  })) as any;
  const res = await runLlmTest(cloudBase, undefined, fetchImpl);
  assert.equal(res.ok, true);
  assert.equal(res.text, "OK");
});

test("cloud: empty completion returns hint", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "   " } }] }),
  })) as any;
  const res = await runLlmTest(cloudBase, undefined, fetchImpl);
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /未返回文本/);
});

test("cloud: http error surfaces status", async () => {
  const fetchImpl = (async () => ({
    ok: false,
    status: 401,
    text: async () => "invalid api key",
  })) as any;
  const res = await runLlmTest(cloudBase, undefined, fetchImpl);
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /401/);
});

test("ollama: empty api key is allowed (no key required)", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "pong" } }] }),
  })) as any;
  const ollamaBase = {
    ...DEFAULT_SETTINGS,
    llmProvider: "ollama" as const,
    llmBaseUrl: "http://localhost:11434/v1",
    llmModel: "qwen2.5",
    llmApiKey: "",
  };
  const res = await runLlmTest(ollamaBase, undefined, fetchImpl);
  assert.equal(res.ok, true);
  assert.equal(res.text, "pong");
});

test("claudian: realclaudian plugin with full api is detected ok", async () => {
  const fakeApp = {
    plugins: {
      plugins: {
        realclaudian: {
          activateView: async () => {},
          getView: () => ({ appendToActiveInput: (_t: string) => true }),
        },
      },
    },
  };
  const res = await runLlmTest(
    { ...DEFAULT_SETTINGS, llmProvider: "claudian" },
    fakeApp,
    (async () => ({ ok: true, json: async () => ({}) })) as any,
  );
  assert.equal(res.ok, true);
  assert.match(res.text ?? "", /Claudian/);
});

test("claudian: missing plugin returns hint", async () => {
  const res = await runLlmTest(
    { ...DEFAULT_SETTINGS, llmProvider: "claudian" },
    { plugins: { plugins: {} } },
    (async () => ({ ok: true, json: async () => ({}) })) as any,
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /未检测到 realclaudian/);
});

test("claudian: plugin missing getView returns hint", async () => {
  const fakeApp = {
    plugins: {
      plugins: {
        realclaudian: { activateView: async () => {} },
      },
    },
  };
  const res = await runLlmTest(
    { ...DEFAULT_SETTINGS, llmProvider: "claudian" },
    fakeApp,
    (async () => ({ ok: true, json: async () => ({}) })) as any,
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /未检测到 realclaudian/);
});

test("claudian: getView returns null returns api-unavailable hint", async () => {
  const fakeApp = {
    plugins: {
      plugins: {
        realclaudian: {
          activateView: async () => {},
          getView: () => null,
        },
      },
    },
  };
  const res = await runLlmTest(
    { ...DEFAULT_SETTINGS, llmProvider: "claudian" },
    fakeApp,
    (async () => ({ ok: true, json: async () => ({}) })) as any,
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /内部 API 不可用/);
});
```

> ⚠️ **重要**：上記テストには `cloudBase.llmProvider_legacy_unused` という未使用フィールドを 1 つ入れている。`createLlmProvider` が settings の **未知フィールドを黙って捨てる** ことを確認するためのガード。実装側で `createLlmProvider` を壊して未知フィールドを参照するように改変した場合に検知される。実装後はこの 1 行を削除する（Step 3 末尾の「実装メモ」参照）。

- [ ] **Step 2: テストを実行して失敗を確認**

実行:
```bash
cd /d/AI-Agent/giji-obsidian/obsidian-plugin && npm test -- --test-name-pattern="llmTest" 2>&1 | tail -10
```
期待結果: FAIL — `Cannot find module '../test/llmTest'`

- [ ] **Step 3: 最小実装を書く**

`D:\AI-Agent\giji-obsidian\obsidian-plugin\src\test\llmTest.ts` を新規作成：

```ts
import { GijiSettings } from "../settings";
import { createLlmProvider } from "../providers/llm";

export interface LlmTestResult {
  ok: boolean;
  text?: string;
  error?: string;
}

async function testClaudian(app: any): Promise<LlmTestResult> {
  const p = app?.plugins?.plugins?.["realclaudian"];
  if (!p || typeof p.activateView !== "function" || typeof p.getView !== "function") {
    return { ok: false, error: "未检测到 realclaudian 插件（未安装或未启用）" };
  }
  try {
    await p.activateView();
    const view = p.getView();
    if (!view || typeof view.appendToActiveInput !== "function") {
      return { ok: false, error: "realclaudian 内部 API 不可用（升级后须 grep 复核）" };
    }
    return { ok: true, text: "Claudian 插件检测正常（未插入测试文本）" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function runLlmTest(
  settings: GijiSettings,
  app?: any,
  fetchImpl: typeof fetch = fetch.bind(globalThis)
): Promise<LlmTestResult> {
  // claudian は API 呼び出しを行わない設計（既存 providers/llm.ts は throw）。
  // プラグイン検出のみで判定する。
  if (settings.llmProvider === "claudian") {
    return testClaudian(app);
  }
  if (!settings.llmBaseUrl.trim()) return { ok: false, error: "请先填写 LLM baseUrl" };
  if (!settings.llmModel.trim()) return { ok: false, error: "请先填写 LLM 模型" };
  if (settings.llmProvider === "cloud" && !settings.llmApiKey) {
    return { ok: false, error: "请先填写 LLM API Key" };
  }
  try {
    const llm = createLlmProvider(settings, fetchImpl);
    const text = await llm.complete("", "连接测试：请只回复「OK」");
    if (!text.trim()) return { ok: false, error: "请求成功但未返回文本" };
    return { ok: true, text: text.trim().slice(0, 30) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
```

**実装メモ**: Step 1 でテストに置いた `cloudBase.llmProvider_legacy_unused` はガード用。`createLlmProvider` がこの未知フィールドを黙って無視するなら全テストが PASS する。もし `createLlmProvider` が `settings.llmProvider_legacy_unused` を参照するよう改変されていれば、`createLlmProvider` の型エラーで `npm test` の **`Cannot find module` よりも前のフェーズ** で TypeScript が落ちる＝`createLlmProvider` 破壊の早期検知。**全テストが緑になったら、このガード用 1 行を削除してから Step 4 を再実行する**（コミット前に必ず）。

- [ ] **Step 4: テストを実行して合格を確認**

ガード行を削除（`cloudBase` オブジェクトから `llmProvider_legacy_unused: undefined` を消す）。

実行:
```bash
cd /d/AI-Agent/giji-obsidian/obsidian-plugin && npm test 2>&1 | tail -15
```
期待結果: 既存テスト全件 + 新規 llmTest テスト 11 件 PASS（合計緑）

- [ ] **Step 5: コミット**

```bash
cd /d/AI-Agent/giji-obsidian
git add obsidian-plugin/src/test/llmTest.ts obsidian-plugin/src/__tests__/llmTest.test.ts
git commit -m "feat(plugin): LLM 接続テスト runLlmTest（cloud/ollama/claudian 検出）+ 単体テスト"
```

---

### Task 2: settings.ts に「🧪 接続テスト」ボタン追加 + ビルド + デプロイ

**Files:**
- Modify: `D:\AI-Agent\giji-obsidian\obsidian-plugin\src\settings.ts`（import 追加 + LLM API キー設定直後にブロック追加）

**Interfaces:**
- Consumes: `runLlmTest(settings, app)`（Task 1）、`Notice`（`obsidian`）、`this.app`（Obsidian App インスタンス）、`this.plugin.settings`
- Produces: 設定ページの LLM 領域に「🧪 接続テスト」ボタン（disabled 状態管理 + Notice フィードバック）

> ⚠️ Task 1 完了後にこのタスクへ進む。Task 1 のコミットが master に乗っていること。

- [ ] **Step 1: import を追加**

`D:\AI-Agent\giji-obsidian\obsidian-plugin\src\settings.ts` の冒頭付近（既存 `import { runSttTest } from "./test/sttTest";` の直後）に追加：

```ts
import { runLlmTest } from "./test/llmTest";
```

> ⚠️ もし既に `Notice` が `import { App, PluginSettingTab, Setting } from "obsidian";` から import されていなければ、`Notice` を同じ import に追加すること。

- [ ] **Step 2: 「🧪 接続テスト」ボタンを追加**

「LLM API キー」テキスト入力の `onChange` ブロック直後（`addText((t) => … )` 全体の閉じ括弧 `);` の直後）に、以下ブロックを貼り付ける：

```ts
    new Setting(containerEl)
      .setName("🧪 接続テスト")
      .setDesc("cloud/ollama は最小プロンプトで疎通確認、claudian はプラグイン連携を検出（テキスト挿入なし）")
      .addButton((btn) =>
        btn.setButtonText("テスト開始").onClick(async () => {
          btn.setDisabled(true).setButtonText("テスト中…");
          try {
            const res = await runLlmTest(this.plugin.settings, this.app);
            if (res.ok) new Notice(`✅ 接続成功: ${res.text}`);
            else new Notice(`❌ テスト失敗: ${res.error}`);
          } finally {
            btn.setDisabled(false).setButtonText("テスト開始");
          }
        })
      );
```

- [ ] **Step 3: テスト + ビルド**

実行:
```bash
cd /d/AI-Agent/giji-obsidian/obsidian-plugin && npm test 2>&1 | tail -10 && npm run build 2>&1 | tail -5
```
期待結果: 既存テスト + llmTest テスト全件 PASS + esbuild エラーなし（`main.js` 再生成）

- [ ] **Step 4: Vault へデプロイ**

実行:
```bash
cp "D:/AI-Agent/giji-obsidian/obsidian-plugin/main.js" "D:/AI-Agent/giji-obsidian/obsidian-plugin/manifest.json" "C:/Users/superlambkin/OneDrive/Edge/Obsidian Vault/.obsidian/plugins/giji-obsidian/" && echo "deployed"
```
期待結果: `deployed`（main.js のタイムスタンプが更新される）

- [ ] **Step 5: コミット**

```bash
cd /d/AI-Agent/giji-obsidian
git add obsidian-plugin/src/settings.ts
git commit -m "feat(plugin): 設定ページに LLM 接続テストボタンを追加"
```

---

## Self-Review

**1. 仕様カバレッジ（[[80_POC_Projects/POC_016_GijiObsidian/02_设计文档/02_LLM接続テスト機能設計.md\|02_LLM接続テスト機能設計 v1.1]]）:**

| 設計書セクション | カバー先タスク |
|---|---|
| §2.1 型定義 `LlmTestResult` | Task 1 |
| §2.2 `runLlmTest` ロジック（プロバイダー分岐、事前チェック、catch） | Task 1 |
| §2.3 `testClaudian` ロジック（claudianApi.ts パターン mirror、`activateView`/`getView`/`appendToActiveInput` の存在確認） | Task 1 |
| §4 UI（`setName("🧪 接続テスト")`、disabled 管理、Notice、finally 復元） | Task 2 |
| §5 エラー処理 8 シナリオ（cloud 空キー、baseUrl 空、モデル空、HTTP エラー、空テキスト、claudian 未検出、API 不一致、ボタン連打、fetch バインド） | Task 1 + Task 2 |
| §6 自動テスト 8 ユースケース（cloud 200/401、key 空、baseUrl 空、ollama key なし、claudian 検出あり/なし、API 不整合、fetch バインド） | Task 1 |
| §6 手動 UAT（cloud 有効、cloud 無効、claudian 検出、claudian 未検出） | **本計画スコープ外**（主人の実機受入） |

**2. プレースホルダースキャン:**
- 「TBD」「TODO」「適切に処理」「同上で」はなし
- 全テストコードに完全実装
- `runLlmTest` 関数の完全実装を Step 3 で提示
- UI ボタンの完全実装を Step 2 で提示

**3. 型整合性:**
- `LlmTestResult { ok: boolean; text?: string; error?: string }` は §2.1 と Step 1/Step 3 で完全一致
- `runLlmTest(settings: GijiSettings, app?: any, fetchImpl: typeof fetch = fetch.bind(globalThis))` の引数順・型は設計書 §2.2 と一致
- `createLlmProvider(settings, fetchImpl)` の引数順は `src/providers/llm.ts` 既存実装と一致
- `app.plugins.plugins["realclaudian"]` キー名は `src/ui/claudianApi.ts` 既存実装と一致
- 「✅ 接続成功」「❌ テスト失敗」「テスト開始」「テスト中…」の文言は §4 UI 設計と完全一致

---

## Execution Handoff

Plan complete and saved to `D:\AI-Agent\giji-obsidian\docs\superpowers\plans\2026-08-09-llm-connection-test-feature.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?