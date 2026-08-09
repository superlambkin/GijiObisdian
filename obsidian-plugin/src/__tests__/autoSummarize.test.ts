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
    json: async () => ({ choices: [{ message: { content: "# 議事録\n議事録 by transcript content\n- 要約 A" } }] }),
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