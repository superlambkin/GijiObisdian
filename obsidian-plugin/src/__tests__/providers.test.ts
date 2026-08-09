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

const openaiSettings = { ...DEFAULT_SETTINGS, sttProvider: "openai" as const, sttApiKey: "key" };

test("openai provider transcribes via openai whisper endpoint", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: any, opts: any) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => ({ text: "こんにちは" }),
    } as any;
  }) as any;

  const stt = createSttProvider(openaiSettings, fakeFetch);
  assert.equal(stt.id, "openai");
  const text = await stt.transcribe(new ArrayBuffer(8), "ja");
  assert.equal(text, "こんにちは");
  assert.equal(
    calls[0].url,
    "https://api.openai.com/v1/audio/transcriptions"
  );
});

test("openai provider throws on http error", async () => {
  const fakeFetch = (async () => ({ ok: false, status: 401, text: async () => "bad key" })) as any;
  const stt = createSttProvider(openaiSettings, fakeFetch);
  await assert.rejects(() => stt.transcribe(new ArrayBuffer(4), "zh"), /401/);
});

test("unsupported stt provider throws instead of silent fallback", () => {
  assert.throws(
    // 廃止プロバイダー（doubao 等）も黙ってフォールバックせず throw すること
    () => createSttProvider({ ...DEFAULT_SETTINGS, sttProvider: "doubao" as any, sttApiKey: "k" }),
    /未対応|unsupported/i
  );
});

/* ---------------- Google STT（Cloud Speech-to-Text v1 同期 API） ---------------- */

const googleSettings = { ...DEFAULT_SETTINGS, sttProvider: "google" as const, sttApiKey: "gkey" };

/** 44 バイト WAV ヘッダ + 最小 PCM（16kHz）のテスト用 WAV */
function makeTinyWav(): ArrayBuffer {
  const pcm = new Uint8Array([0, 0, 1, 0]);
  const buf = new ArrayBuffer(44 + pcm.length);
  const v = new DataView(buf);
  const writeStr = (o: number, s: string) => s.split("").forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  writeStr(0, "RIFF");
  writeStr(8, "WAVE");
  v.setUint32(24, 16000, true); // sampleRate
  v.setUint32(40, pcm.length, true); // dataLength
  new Uint8Array(buf).set(pcm, 44);
  return buf;
}

test("google provider posts LINEAR16 base64 PCM to speech:recognize", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: any, opts: any) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ results: [{ alternatives: [{ transcript: "テスト" }] }] }) } as any;
  }) as any;

  const stt = createSttProvider(googleSettings, fakeFetch);
  assert.equal(stt.id, "google");
  assert.equal(stt.maxChunkSec, 55); // 同期 API は約 60 秒制限
  const text = await stt.transcribe(makeTinyWav(), "ja");
  assert.equal(text, "テスト");

  assert.match(calls[0].url, /speech\.googleapis\.com\/v1\/speech:recognize\?key=gkey/);
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.config.encoding, "LINEAR16");
  assert.equal(body.config.sampleRateHertz, 16000);
  assert.equal(body.config.languageCode, "ja-JP");
  // WAV ヘッダ（44 バイト）を除去した PCM のみ base64 化されること
  assert.equal(body.audio.content, btoa(String.fromCharCode(0, 0, 1, 0)));
});

test("google provider maps lang codes (zh → cmn-Hans-CN, auto → ja-JP)", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (_url: any, opts: any) => {
    calls.push({ opts });
    return { ok: true, json: async () => ({ results: [] }) } as any;
  }) as any;
  const stt = createSttProvider(googleSettings, fakeFetch);
  await stt.transcribe(makeTinyWav(), "zh");
  assert.equal(JSON.parse(calls[0].opts.body).config.languageCode, "cmn-Hans-CN");
  await stt.transcribe(makeTinyWav(), "auto");
  assert.equal(JSON.parse(calls[1].opts.body).config.languageCode, "ja-JP");
});

test("google provider throws on http error", async () => {
  const fakeFetch = (async () => ({ ok: false, status: 403, text: async () => "forbidden" })) as any;
  const stt = createSttProvider(googleSettings, fakeFetch);
  await assert.rejects(() => stt.transcribe(makeTinyWav(), "ja"), /403/);
});

/* ---------------- MP3 入力（24MB 分割後のセグメント等） ---------------- */

test("openai provider sends mp3 filename/mime for non-WAV audio", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (_url: any, opts: any) => {
    calls.push(opts);
    return { ok: true, json: async () => ({ text: "ok" }) } as any;
  }) as any;
  const stt = createSttProvider(openaiSettings, fakeFetch);
  await stt.transcribe(new Uint8Array([0xff, 0xf3, 0x08, 0x00, 1, 2, 3]).buffer, "ja");
  const file = (calls[0].body as FormData).get("file") as any;
  assert.equal(file.name, "audio.mp3");
  assert.equal(file.type, "audio/mpeg");
});

test("google provider uses MP3 encoding + frame sample rate for non-WAV audio", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (_url: any, opts: any) => {
    calls.push(opts);
    return { ok: true, json: async () => ({ results: [] }) } as any;
  }) as any;
  const stt = createSttProvider(googleSettings, fakeFetch);
  // MPEG2 / 16kHz のフレームヘッダ（0xFF 0xF3 0x08）
  await stt.transcribe(new Uint8Array([0xff, 0xf3, 0x08, 0x00, 1, 2, 3]).buffer, "ja");
  const body = JSON.parse(calls[0].body);
  assert.equal(body.config.encoding, "MP3");
  assert.equal(body.config.sampleRateHertz, 16000);
  // MP3 はバッファ全体を base64 化（ヘッダ除去しない）
  assert.equal(body.audio.content, btoa(String.fromCharCode(0xff, 0xf3, 0x08, 0x00, 1, 2, 3)));
});

// Chromium（Obsidian レンダラー）の window.fetch は this !== window で
// "Illegal invocation" を投げる。非バインド参照の持ち回りを防ぐ回帰テスト。
function withBindingSensitiveFetch(run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async function (this: unknown) {
    if (this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return { ok: true, json: async () => ({ text: "ok" }) } as any;
  }) as any;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("default stt fetchImpl works with binding-sensitive fetch (chromium)", async () => {
  await withBindingSensitiveFetch(async () => {
    const stt = createSttProvider(groqSettings); // fetchImpl 省略 → デフォルト経路
    const text = await stt.transcribe(new ArrayBuffer(4), "ja");
    assert.equal(text, "ok");
  });
});

test("default llm fetchImpl works with binding-sensitive fetch (chromium)", async () => {
  await withBindingSensitiveFetch(async () => {
    const llm = createLlmProvider({ ...DEFAULT_SETTINGS, llmProvider: "cloud", llmApiKey: "k" });
    await llm.complete("s", "u"); // Illegal invocation にならなければ OK
  });
});

test("cloud llm posts chat completion", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: any, opts: any) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ choices: [{ message: { content: "## 摘要\n讨论 POC" } }] }) } as any;
  }) as any;
  const llm = createLlmProvider({ ...DEFAULT_SETTINGS, llmProvider: "cloud", llmApiKey: "k" }, fakeFetch);
  const out = await llm.complete("sys", "user");
  assert.match(out, /讨论 POC/);
  assert.match(calls[0].url, /chat\/completions/);
});

test("claudian llm provider throws (handled by Claudian 連携フロー instead)", () => {
  assert.throws(
    () => createLlmProvider({ ...DEFAULT_SETTINGS, llmProvider: "claudian" }),
    /claudian/i
  );
});

test("deepseek preset uses anthropic endpoint with default max_tokens", async () => {
  let capturedBody: any = null;
  const fakeFetch = (async (_url: string, init: any) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      headers: { get: () => "text/event-stream" },
      body: makeSseBody([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
        'data: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]),
      json: async () => ({}),
    } as any;
  }) as any;
  const llm = createLlmProvider(
    {
      ...DEFAULT_SETTINGS,
      llmProvider: "deepseek",
      llmApiKey: "k",
      llmBaseUrl: "",
      llmModel: "",
    },
    fakeFetch
  );
  await llm.complete("s", "u");
  // preset.baseUrl / preset.model / preset.defaultMaxTokens が適用される
  assert.match(capturedBody.model, /deepseek-chat/);
  assert.equal(capturedBody.max_tokens, 32000);
});

test("MiniMax preset enforces defaultMaxTokens=524288", async () => {
  let capturedBody: any = null;
  const fakeFetch = (async (_url: string, init: any) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      headers: { get: () => "text/event-stream" },
      body: makeSseBody([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
        'data: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]),
      json: async () => ({}),
    } as any;
  }) as any;
  const llm = createLlmProvider(
    {
      ...DEFAULT_SETTINGS,
      llmProvider: "MiniMax",
      llmApiKey: "k",
      llmBaseUrl: "",
      llmModel: "",
      llmMaxTokens: 524288,
    },
    fakeFetch
  );
  await llm.complete("s", "u");
  assert.match(capturedBody.model, /MiniMax-M3/);
  assert.equal(capturedBody.max_tokens, 524288);
});

test("MiniMax preset respects an explicit max_tokens override of 32000", async () => {
  let capturedBody: any = null;
  const fakeFetch = (async (_url: string, init: any) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ text: "OK" }] }) } as any;
  }) as any;
  const llm = createLlmProvider(
    {
      ...DEFAULT_SETTINGS,
      llmProvider: "MiniMax",
      llmApiKey: "k",
      llmBaseUrl: "",
      llmModel: "",
      llmMaxTokens: 32000,
    },
    fakeFetch
  );
  await llm.complete("s", "u");
  assert.equal(capturedBody.max_tokens, 32000);
});

test("kimi preset uses OpenAI 互換エンドポイント", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ choices: [{ message: { content: "OK" } }] }) } as any;
  }) as any;
  const llm = createLlmProvider(
    {
      ...DEFAULT_SETTINGS,
      llmProvider: "kimi",
      llmApiKey: "k",
      llmBaseUrl: "",
      llmModel: "",
    },
    fakeFetch
  );
  await llm.complete("s", "u");
  assert.match(calls[0].url, /api\.moonshot\.cn/);
  assert.match(calls[0].url, /\/v1\/chat\/completions/);
});

test("kimi-coding preset uses Kimi for Coding 定額プランエンドポイント", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ choices: [{ message: { content: "OK" } }] }) } as any;
  }) as any;
  const llm = createLlmProvider(
    {
      ...DEFAULT_SETTINGS,
      llmProvider: "kimi-coding",
      llmApiKey: "k",
      llmBaseUrl: "",
      llmModel: "",
    },
    fakeFetch
  );
  await llm.complete("s", "u");
  assert.match(calls[0].url, /api\.kimi\.com\/coding\/v1\/chat\/completions/);
  assert.equal(calls[0].body.model, "kimi-for-coding");
});

// Kimi for Coding 等のエンドポイントは空の system メッセージを 400 で拒否する。
// system が空なら messages に含めないこと（回帰テスト）。
test("openai-compatible llm omits empty system message", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: "OK" } }] }) } as any;
  }) as any;
  const llm = createLlmProvider({ ...DEFAULT_SETTINGS, llmProvider: "cloud", llmApiKey: "k" }, fakeFetch);
  await llm.complete("", "u");
  assert.deepEqual(
    calls[0].messages.map((m: any) => m.role),
    ["user"]
  );
  // 非空 system は従来通り先頭に含まれる
  await llm.complete("s", "u");
  assert.deepEqual(
    calls[1].messages.map((m: any) => m.role),
    ["system", "user"]
  );
});

test("unknown llmProvider throws", () => {
  assert.throws(
    () => createLlmProvider({ ...DEFAULT_SETTINGS, llmProvider: "nonexistent" as any }),
    /未知の llmProvider/
  );
});

function makeSseBody(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
}

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
