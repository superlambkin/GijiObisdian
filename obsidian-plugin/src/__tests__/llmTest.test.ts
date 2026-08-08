import test from "node:test";
import assert from "node:assert/strict";
import { runLlmTest } from "../test/llmTest";
import { DEFAULT_SETTINGS } from "../settings";

const cloudBase = {
  ...DEFAULT_SETTINGS,
  llmProvider: "cloud" as const,
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
