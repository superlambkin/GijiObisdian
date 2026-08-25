import test from "node:test";
import assert from "node:assert/strict";
import { createSttProvider } from "../providers/stt";
import { DEFAULT_SETTINGS } from "../settings";

const base = {
  ...DEFAULT_SETTINGS,
  sttProvider: "whisper-local" as const,
  sttBaseUrl: "http://127.0.0.1:9000/v1",
  sttWhisperModel: "small" as const,
  sttApiKey: "",
};

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test("createSttProvider returns whisper-local provider", () => {
  const p = createSttProvider(base, jsonFetch({ text: "ok" }));
  assert.equal(p.id, "whisper-local");
});

test("whisper-local posts model=whisper-small to sttBaseUrl and returns text", async () => {
  let capturedUrl = "";
  let capturedModel = "";
  const fakeFetch = (async (url: string, init: any) => {
    capturedUrl = url;
    capturedModel = (init.body as FormData).get("model") as string;
    return new Response(JSON.stringify({ text: "こんにちは" }), { status: 200 });
  }) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  const text = await p.transcribe(new ArrayBuffer(10), "ja");
  assert.equal(capturedUrl, "http://127.0.0.1:9000/v1/audio/transcriptions");
  assert.equal(capturedModel, "whisper-small");
  assert.equal(text, "こんにちは");
});

test("whisper-local maps ja->Japanese and auto->no language", async () => {
  const langs: Array<string | null> = [];
  const fakeFetch = (async (_url: string, init: any) => {
    langs.push((init.body as FormData).get("language") as string | null);
    return new Response(JSON.stringify({ text: "x" }), { status: 200 });
  }) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "ja");
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.deepEqual(langs, ["Japanese", null]);
});

test("whisper-local surfaces HTTP error", async () => {
  const p = createSttProvider(
    base,
    (async () => new Response("boom", { status: 500 })) as typeof fetch
  );
  await assert.rejects(() => p.transcribe(new ArrayBuffer(10), "auto"), /STT 500/);
});

test("whisper-local surfaces friendly error on network rejection", async () => {
  const p = createSttProvider(
    base,
    (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch
  );
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    /start_whisper_local\.bat/
  );
});

test("whisper-local posts model=whisper-tiny when tiny is selected", async () => {
  let capturedModel = "";
  const fakeFetch = (async (_url: string, init: any) => {
    capturedModel = (init.body as FormData).get("model") as string;
    return new Response(JSON.stringify({ text: "x" }), { status: 200 });
  }) as typeof fetch;
  const p = createSttProvider({ ...base, sttWhisperModel: "tiny" }, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "ja");
  assert.equal(capturedModel, "whisper-tiny");
});

test("whisper-local posts model=whisper-medium when medium is selected", async () => {
  let capturedModel = "";
  const fakeFetch = (async (_url: string, init: any) => {
    capturedModel = (init.body as FormData).get("model") as string;
    return new Response(JSON.stringify({ text: "x" }), { status: 200 });
  }) as typeof fetch;
  const p = createSttProvider({ ...base, sttWhisperModel: "medium" }, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "ja");
  assert.equal(capturedModel, "whisper-medium");
});
