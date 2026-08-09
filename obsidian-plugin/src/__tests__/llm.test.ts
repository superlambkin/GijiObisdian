import test from "node:test";
import assert from "node:assert/strict";
import { createLlmProvider, withRetry, LlmCallStats } from "../providers/llm";
import { runAutoSummarize } from "../commands/autoSummarize";
import { DEFAULT_SETTINGS, GijiSettings } from "../settings";

/* ==================== ヘルパー ==================== */

const openAiSettings: GijiSettings = {
  ...DEFAULT_SETTINGS,
  llmProvider: "cloud",
  llmApiFormat: "openai",
  llmBaseUrl: "https://api.example.com/v1",
  llmModel: "test-model",
  llmApiKey: "test-key",
  llmTimeoutMs: 5000,
  llmMaxRetries: 2,
};

function sseResponse(chunks: string[]): any {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return {
    ok: true,
    headers: { get: (k: string) => (k === "content-type" ? "text/event-stream" : null) },
    body: stream,
    json: async () => {
      throw new Error("SSE response has no json()");
    },
    text: async () => "",
  };
}

/** ログ出力を捕捉する fakeApp（adapter.append を記録） */
function makeLogCapturingApp() {
  const lines: string[] = [];
  const app: any = {
    vault: {
      adapter: {
        async exists() {
          return true;
        },
        async append(_path: string, line: string) {
          lines.push(line);
        },
      },
      async create() {},
      async exists() {
        return false;
      },
    },
  };
  return { app, lines };
}

/* ==================== withRetry ==================== */

test("withRetry: 初回成功なら retries=0", async () => {
  const { value, retries } = await withRetry(async () => "ok", { maxRetries: 2 });
  assert.equal(value, "ok");
  assert.equal(retries, 0);
});

test("withRetry: リトライ可能エラー（429 相当）は再試行する", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const { value, retries } = await withRetry(
    async () => {
      calls++;
      if (calls === 1) {
        const e: any = new Error("aborted");
        e.name = "AbortError"; // タイムアウト中断相当
        throw e;
      }
      return "recovered";
    },
    { maxRetries: 2, sleep: async (ms) => void sleeps.push(ms) }
  );
  assert.equal(value, "recovered");
  assert.equal(retries, 1);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 500 && sleeps[0] <= 1000); // ジッター付きバックオフ
});

test("withRetry: リトライ不可エラー（401 相当）は即座に投げる", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error("LLM 401: invalid api key"); // 通常 Error はリトライ不可
      },
      { maxRetries: 2, sleep: async () => {} }
    ),
    /401/
  );
  assert.equal(calls, 1);
});

test("withRetry: 全試行失敗時は retriesAttempted を付与して投げる", async () => {
  try {
    await withRetry(
      async () => {
        throw new TypeError("fetch failed"); // ネットワーク断相当（リトライ可能）
      },
      { maxRetries: 2, sleep: async () => {} }
    );
    assert.fail("should throw");
  } catch (e: any) {
    assert.equal(e.retriesAttempted, 2);
  }
});

/* ==================== OpenAI 互換プロバイダ ==================== */

test("cloud(openai): SSE ストリーミングで本文・usage・TTFB を取得", async () => {
  const fetchImpl = (async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"議事"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"録です"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":123,"completion_tokens":45}}\n\n',
      "data: [DONE]\n\n",
    ])) as any;
  const llm = createLlmProvider(openAiSettings, fetchImpl);
  const stats: LlmCallStats = { retries: 0 };
  const text = await llm.complete("sys", "user", stats);
  assert.equal(text, "議事録です");
  assert.equal(stats.inputTokens, 123);
  assert.equal(stats.outputTokens, 45);
  assert.equal(typeof stats.ttfbMs, "number");
  assert.equal(stats.retries, 0);
});

test("cloud(openai): 非ストリーミング応答は JSON フォールバック（ttfb なし）", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "フォールバック本文" } }] }),
  })) as any;
  const llm = createLlmProvider(openAiSettings, fetchImpl);
  const stats: LlmCallStats = { retries: 0 };
  const text = await llm.complete("sys", "user", stats);
  assert.equal(text, "フォールバック本文");
  assert.equal(stats.ttfbMs, undefined);
});

test("cloud(openai): 500 はリトライし、2 回目で成功 → retry_count=1", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls === 1) {
      return { ok: false, status: 500, text: async () => "server busy" } as any;
    }
    return sseResponse(['data: {"choices":[{"delta":{"content":"再試行OK"}}]}\n\n', "data: [DONE]\n\n"]);
  }) as any;
  const llm = createLlmProvider({ ...openAiSettings, llmMaxRetries: 1 }, fetchImpl);
  const stats: LlmCallStats = { retries: 0 };
  const text = await llm.complete("sys", "user", stats);
  assert.equal(text, "再試行OK");
  assert.equal(calls, 2);
  assert.equal(stats.retries, 1);
});

test("cloud(openai): タイムアウトで中断 → リトライして成功", async () => {
  let calls = 0;
  const fetchImpl = ((url: string, init: any) => {
    calls++;
    if (calls === 1) {
      // abort されるまで応答しないリクエスト
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const e: any = new Error("The operation was aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }
    return Promise.resolve(
      sseResponse(['data: {"choices":[{"delta":{"content":"タイムアウト後OK"}}]}\n\n', "data: [DONE]\n\n"])
    );
  }) as any;
  const llm = createLlmProvider({ ...openAiSettings, llmTimeoutMs: 50, llmMaxRetries: 1 }, fetchImpl);
  const stats: LlmCallStats = { retries: 0 };
  const text = await llm.complete("sys", "user", stats);
  assert.equal(text, "タイムアウト後OK");
  assert.equal(calls, 2);
  assert.equal(stats.retries, 1);
});

test("cloud(openai): 全試行タイムアウトならエラー、retry_count は試行分", async () => {
  const fetchImpl = ((_url: string, init: any) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const e: any = new Error("The operation was aborted");
        e.name = "AbortError";
        reject(e);
      });
    })) as any;
  const llm = createLlmProvider({ ...openAiSettings, llmTimeoutMs: 30, llmMaxRetries: 1 }, fetchImpl);
  const stats: LlmCallStats = { retries: 0 };
  await assert.rejects(llm.complete("sys", "user", stats), /aborted/);
  assert.equal(stats.retries, 1);
});

/* ==================== Anthropic 互換プロバイダ ==================== */

test("cloud(anthropic): SSE で本文・usage を取得し max_tokens が設定値になる", async () => {
  let capturedBody: any = null;
  const fetchImpl = (async (_url: string, init: any) => {
    capturedBody = JSON.parse(init.body);
    return sseResponse([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":321}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"要約"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"テキスト"}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":54}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
  }) as any;
  const settings: GijiSettings = {
    ...openAiSettings,
    llmApiFormat: "anthropic",
    llmBaseUrl: "https://api.example.com/anthropic",
    llmMaxTokens: 12345,
  };
  const llm = createLlmProvider(settings, fetchImpl);
  const stats: LlmCallStats = { retries: 0 };
  const text = await llm.complete("sys", "user", stats);
  assert.equal(text, "要約テキスト");
  assert.equal(stats.inputTokens, 321);
  assert.equal(stats.outputTokens, 54);
  assert.equal(capturedBody.max_tokens, 12345); // 設定値が反映される（旧ハードコード 32000 ではない）
  assert.equal(capturedBody.stream, true);
});

test("ollama: API 形式が anthropic でも OpenAI 互換のまま", async () => {
  let capturedUrl = "";
  const fetchImpl = (async (url: string) => {
    capturedUrl = url;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ollama" } }] }),
    } as any;
  }) as any;
  const settings: GijiSettings = {
    ...openAiSettings,
    llmProvider: "ollama",
    llmApiKey: "",
    llmApiFormat: "anthropic", // 誤った残存設定でも ollama は OpenAI 形式を使う
  };
  const llm = createLlmProvider(settings, fetchImpl);
  const text = await llm.complete("sys", "user");
  assert.equal(text, "ollama");
  assert.match(capturedUrl, /\/chat\/completions$/);
});

/* ==================== runAutoSummarize 統合 ==================== */

test("summarize ログに ttfb_ms / in_tokens / out_tokens / retry_count が含まれる", async () => {
  const fetchImpl = (async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"| 🕐 開始時間 | X |\\n議事録"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":77,"completion_tokens":88}}\n\n',
      "data: [DONE]\n\n",
    ])) as any;
  const { app, lines } = makeLogCapturingApp();
  const res = await runAutoSummarize("transcript", { ...openAiSettings, debugLog: true }, app, "/manifest/dir", {
    fetchImpl,
  });
  assert.equal(res.ok, true);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /stage=summarize/);
  assert.match(lines[0], /status=ok/);
  assert.match(lines[0], /ttfb_ms=\d+/);
  assert.match(lines[0], /in_tokens=77/);
  assert.match(lines[0], /out_tokens=88/);
  assert.match(lines[0], /retry_count=0/);
});

test("summarize 失敗時も retry_count がログに残る", async () => {
  const fetchImpl = (async () => ({ ok: false, status: 401, text: async () => "invalid api key" })) as any;
  const { app, lines } = makeLogCapturingApp();
  const res = await runAutoSummarize("t", { ...openAiSettings, debugLog: true }, app, "/manifest/dir", {
    fetchImpl,
  });
  assert.equal(res.ok, false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /status=fail/);
  assert.match(lines[0], /retry_count=0/); // 401 はリトライ不可
});

test("debugLog OFF ならログを書かない", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "x" } }] }),
  })) as any;
  const { app, lines } = makeLogCapturingApp();
  const res = await runAutoSummarize("t", { ...openAiSettings, debugLog: false }, app, "/manifest/dir", {
    fetchImpl,
  });
  assert.equal(res.ok, true);
  assert.equal(lines.length, 0);
});

test("complete: SSE で onFirstChunk/onChunk が発火し累積文字数が増える", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"議事"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"録テスト"}}]}\n\n',
    "data: [DONE]\n\n",
  ];
  const fetchImpl = (async () => sseResponse(chunks)) as any;
  const llm = createLlmProvider(openAiSettings, fetchImpl);
  const events: Array<string | number> = [];
  const text = await llm.complete("sys", "user", undefined, {
    onFirstChunk: () => events.push("first"),
    onChunk: (n) => events.push(n),
  });
  assert.equal(text, "議事録テスト");
  // NEW 修正後: text delta が届いた時点で TTFB。最初の chunk に text が含まれるので
  // events は ["first", 2, 4, 6, ...] となる（2 = "議事" の長さ）。
  assert.equal(events[0], "first");
  assert.equal(events[1], 2); // 最初の onChunk は 2
  const nums = events.filter((e): e is number => typeof e === "number");
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b)); // 単調増加
  assert.equal(nums[nums.length - 1], "議事録テスト".length);
});

test("complete: 最初の chunk が空/keepalive のとき text 到着まで onFirstChunk は遅延", async () => {
  const chunks = [
    ": keep-alive\n\n", // 空（text なし）
    'data: {"choices":[{"delta":{"content":"本"}}]}\n\n',
    "data: [DONE]\n\n",
  ];
  const fetchImpl = (async () => sseResponse(chunks)) as any;
  const llm = createLlmProvider(openAiSettings, fetchImpl);
  const order: string[] = [];
  const text = await llm.complete("sys", "user", undefined, {
    onFirstChunk: () => order.push("first"),
    onChunk: (n) => order.push(`chunk:${n}`),
  });
  assert.equal(text, "本");
  // "first" が必ず "chunk:1" より前
  assert.ok(order.indexOf("first") < order.indexOf("chunk:1"));
});

test("complete: 非SSE フォールバックでも onFirstChunk/onChunk が1回ずつ発火", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({ choices: [{ message: { content: "全文" } }] }),
  })) as any;
  const llm = createLlmProvider(openAiSettings, fetchImpl);
  let first = 0;
  const chunks: number[] = [];
  const text = await llm.complete("sys", "user", undefined, {
    onFirstChunk: () => first++,
    onChunk: (n) => chunks.push(n),
  });
  assert.equal(text, "全文");
  assert.equal(first, 1);
  assert.deepEqual(chunks, [2]);
});
