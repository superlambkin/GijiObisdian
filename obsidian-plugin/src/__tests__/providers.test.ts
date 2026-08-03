import test from "node:test";
import assert from "node:assert/strict";
import { createSttProvider } from "../providers/stt";
import { createLlmProvider } from "../providers/llm";
import { DEFAULT_SETTINGS } from "../settings";

const groqSettings = { ...DEFAULT_SETTINGS, sttProvider: "groq" as const, sttApiKey: "key" };

test("groq provider transcribes via whisper endpoint", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: any, opts: any) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => ({ text: "こんにちは" }),
    } as any;
  }) as any;

  const stt = createSttProvider(groqSettings, fakeFetch);
  const text = await stt.transcribe(new ArrayBuffer(8), "ja");
  assert.equal(text, "こんにちは");
  assert.equal(
    calls[0].url,
    "https://api.groq.com/openai/v1/audio/transcriptions"
  );
});

test("groq provider throws on http error", async () => {
  const fakeFetch = (async () => ({ ok: false, status: 401, text: async () => "bad key" })) as any;
  const stt = createSttProvider(groqSettings, fakeFetch);
  await assert.rejects(() => stt.transcribe(new ArrayBuffer(4), "zh"), /401/);
});

test("cloud llm posts chat completion", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: any, opts: any) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ choices: [{ message: { content: "## 摘要\n讨论 POC" } }] }) } as any;
  }) as any;
  const llm = createLlmProvider({ ...DEFAULT_SETTINGS, llmApiKey: "k" }, fakeFetch);
  const out = await llm.complete("sys", "user");
  assert.match(out, /讨论 POC/);
  assert.match(calls[0].url, /chat\/completions/);
});

test("ollama llm uses localhost base", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: any) => {
    calls.push({ url });
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) } as any;
  }) as any;
  const llm = createLlmProvider(
    { ...DEFAULT_SETTINGS, llmProvider: "ollama", llmBaseUrl: "http://localhost:11434/v1", llmModel: "qwen2.5" },
    fakeFetch
  );
  await llm.complete("s", "u");
  assert.match(calls[0].url, /localhost:11434\/v1\/chat\/completions/);
});
