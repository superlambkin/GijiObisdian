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
  outputDir: "議事録",
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
    { fetchImpl }
  );
  assert.equal(res.ok, true);
  assert.ok(createdPath);
});

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
    { fetchImpl }
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /401/);
});

test("force: autoSummarizeEnabled が false でも実行される", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "議事録" } }] }),
  })) as any;
  let createdPath: string | null = null;
  const fakeApp: any = {
    vault: {
      adapter: {},
      async create(path: string) { createdPath = path; },
      async exists() { return false; },
    },
  };
  const res = await runAutoSummarize(
    "t",
    { ...baseSettings, autoSummarizeEnabled: false },
    fakeApp,
    "/manifest/dir",
    { fetchImpl, force: true }
  );
  assert.equal(res.ok, true);
  assert.ok(createdPath);
});

test("overwritePath: 連番を作らず上書きし 議事録番号・created を引き継ぐ", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "---\n議事録番号: \ncreated: \nmodified: \n---\n新しい議事録" } }] }),
  })) as any;
  const OLD = "---\n議事録番号: 20260809-2214\ncreated: 2026-08-09\nmodified: 2026-08-09 22:36\n---\n古い議事録";
  let writtenPath: string | null = null;
  let writtenContent: string | null = null;
  const fakeApp: any = {
    vault: {
      adapter: {
        async exists(p: string) { return p === "議事録/議事録_2026年08月09日22時14分.md"; },
        async read(_p: string) { return OLD; },
        async write(p: string, c: string) { writtenPath = p; writtenContent = c; },
      },
      async exists() { return true; },
      async create() { throw new Error("create は呼ばれないはず"); },
    },
  };
  const res = await runAutoSummarize("t", baseSettings, fakeApp, "/manifest/dir", {
    fetchImpl,
    startTime: new Date(2026, 7, 9, 22, 14),
    overwritePath: "議事録/議事録_2026年08月09日22時14分.md",
  });
  assert.equal(res.ok, true);
  assert.equal(writtenPath, "議事録/議事録_2026年08月09日22時14分.md");
  assert.match(writtenContent as string, /議事録番号: 20260809-2214/);
  assert.match(writtenContent as string, /created: 2026-08-09/);
  assert.match(writtenContent as string, /modified: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  assert.match(writtenContent as string, /新しい議事録/);
});

test("onProgress: connecting → generating → saving の順で発火", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "議事録" } }] }),
  })) as any;
  const stages: string[] = [];
  const fakeApp: any = {
    vault: {
      adapter: {},
      async create() {},
      async exists() { return false; },
    },
  };
  await runAutoSummarize("t", baseSettings, fakeApp, "/manifest/dir", {
    fetchImpl,
    onProgress: (p) => stages.push(p.stage),
  });
  // connecting → generating（複数回あり得る）→ saving の順
  assert.equal(stages[0], "connecting");
  assert.equal(stages[stages.length - 1], "saving");
  assert.ok(stages.includes("generating"));
  assert.ok(stages.indexOf("connecting") < stages.indexOf("generating"));
  assert.ok(stages.lastIndexOf("generating") < stages.lastIndexOf("saving"));
});