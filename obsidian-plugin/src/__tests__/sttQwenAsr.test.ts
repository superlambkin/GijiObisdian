import test from "node:test";
import assert from "node:assert/strict";
import { createSttProvider } from "../providers/stt";
import { DEFAULT_SETTINGS } from "../settings";

const base = {
  ...DEFAULT_SETTINGS,
  sttProvider: "qwen3-asr" as const,
  sttBaseUrl: "http://127.0.0.1:9000/v1",
  sttModel: "qwen3-asr-0.6b",
  sttApiKey: "",
};

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test("createSttProvider returns qwen3-asr provider", () => {
  const p = createSttProvider(base, jsonFetch({ text: "ok" }));
  assert.equal(p.id, "qwen3-asr");
});

test("qwen3-asr transcribe posts to sttBaseUrl and returns text", async () => {
  let capturedUrl = "";
  const fakeFetch = (async (url: string) => {
    capturedUrl = url;
    return new Response(JSON.stringify({ text: "こんにちは" }), { status: 200 });
  }) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  const text = await p.transcribe(new ArrayBuffer(10), "ja");
  assert.equal(capturedUrl, "http://127.0.0.1:9000/v1/audio/transcriptions");
  assert.equal(text, "こんにちは");
});

test("qwen3-asr maps ja->Japanese, zh->Chinese, en->English, auto->no language", async () => {
  const langs: Array<string | null> = [];
  const fakeFetch = (async (_url: string, init: any) => {
    const form = init.body as FormData;
    langs.push(form.get("language") as string | null);
    return new Response(JSON.stringify({ text: "x" }), { status: 200 });
  }) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "ja");
  await p.transcribe(new ArrayBuffer(10), "zh");
  await p.transcribe(new ArrayBuffer(10), "en");
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.deepEqual(langs, ["Japanese", "Chinese", "English", null]);
});

test("qwen3-asr surfaces HTTP error", async () => {
  const p = createSttProvider(
    base,
    (async () => new Response("boom", { status: 500 })) as typeof fetch
  );
  await assert.rejects(() => p.transcribe(new ArrayBuffer(10), "auto"), /STT 500/);
});

test("qwen3-asr surfaces friendly error on network rejection", async () => {
  const p = createSttProvider(
    base,
    (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch
  );
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    /start_qwen3_asr\.bat/
  );
});
