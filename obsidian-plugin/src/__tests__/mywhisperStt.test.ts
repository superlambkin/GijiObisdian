import test from "node:test";
import assert from "node:assert/strict";
import { createSttProvider } from "../providers/stt";
import { DEFAULT_SETTINGS } from "../settings";

const base = {
  ...DEFAULT_SETTINGS,
  sttProvider: "mywhisper" as const,
  sttMyWhisperBaseUrl: "http://192.168.0.88:9000/",
  sttMyWhisperToken: "",
};

function makeResponse(
  body: string,
  init: { status?: number; contentType?: string } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "text/plain; charset=utf-8" },
  });
}

// 1. 正常転写
test("mywhisper: 正常転写 (ja)", async () => {
  const fakeFetch = (async () => makeResponse("こんにちは")) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  const text = await p.transcribe(new ArrayBuffer(10), "ja");
  assert.equal(text, "こんにちは");
});

// 2. language 透伝
test("mywhisper: language 字段透伝 (zh)", async () => {
  const langs: Array<string | null> = [];
  const fakeFetch = (async (_url: string, init: any) => {
    langs.push((init.body as FormData).get("language") as string | null);
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "zh");
  await p.transcribe(new ArrayBuffer(10), "ja");
  await p.transcribe(new ArrayBuffer(10), "en");
  assert.deepEqual(langs, ["zh", "ja", "en"]);
});

// 3. language=auto 省略
test("mywhisper: lang=auto 不发送 language 字段", async () => {
  let capturedLang: string | null = "init";
  const fakeFetch = (async (_url: string, init: any) => {
    capturedLang = (init.body as FormData).get("language") as string | null;
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(capturedLang, null);
});

// 4. Bearer Token 注入
test("mywhisper: token 非空时注入 Authorization", async () => {
  let capturedAuth: string | null = null;
  const fakeFetch = (async (_url: string, init: any) => {
    capturedAuth = (init.headers as Record<string, string>)?.Authorization ?? null;
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider(
    { ...base, sttMyWhisperToken: "abc123" },
    fakeFetch,
  );
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(capturedAuth, "Bearer abc123");
});

// 5. 空 token 不注入
test("mywhisper: token 空时无 Authorization", async () => {
  let capturedAuth: string | undefined;
  const fakeFetch = (async (_url: string, init: any) => {
    capturedAuth = (init.headers as Record<string, string>)?.Authorization;
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider({ ...base, sttMyWhisperToken: "" }, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(capturedAuth, undefined);
});

// 6. 422 エラー
test("mywhisper: 422 表単校验 → throw MyWhisperError", async () => {
  const fakeFetch = (async () =>
    makeResponse("missing audio_file", { status: 422 })) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    (err: any) => {
      assert.equal(err.name, "MyWhisperError");
      assert.equal(err.status, 422);
      return true;
    },
  );
});

// 7. 413 过大
test("mywhisper: 413 文件过大 → throw status=413", async () => {
  const fakeFetch = (async () =>
    makeResponse("too large", { status: 413 })) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    (err: any) => err.status === 413,
  );
});

// 8. HTML エラーページ検出
test("mywhisper: HTML エラーページ (text/html) → throw「HTML 错误页」", async () => {
  const fakeFetch = (async () =>
    makeResponse(
      "<html><body><h1>502 Bad Gateway</h1></body></html>",
      { status: 200, contentType: "text/html" },
    )) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    /HTML 错误页/,
  );
});

// 9. 非テキスト content-type
test("mywhisper: application/json 响应 → throw「返回非文本响应」", async () => {
  const fakeFetch = (async () =>
    makeResponse('{"err":"x"}', { status: 200, contentType: "application/json" })) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    /返回非文本响应/,
  );
});

// 10. 空応答検出
test("mywhisper: 空文本响应 → throw「返回空文本」", async () => {
  const fakeFetch = (async () => makeResponse("   ")) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    /返回空文本/,
  );
});

// 11. trim
test("mywhisper: 前后空白被 trim", async () => {
  const fakeFetch = (async () => makeResponse("  你好  \n")) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  const text = await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(text, "你好");
});

// 12. 字段名硬约束
test("mywhisper: FormData 字段名恒为 audio_file", async () => {
  let capturedFieldName: string | null = null;
  const fakeFetch = (async (_url: string, init: any) => {
    const form = init.body as FormData;
    for (const key of form.keys()) {
      capturedFieldName = key;
      break;
    }
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(capturedFieldName, "audio_file");
});

// 13. URL 去尾斜杠
test("mywhisper: Base URL 末尾斜杠被去除", async () => {
  let capturedUrl = "";
  const fakeFetch = (async (url: string) => {
    capturedUrl = url;
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider(
    { ...base, sttMyWhisperBaseUrl: "http://x:9000/////" },
    fakeFetch,
  );
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(capturedUrl, "http://x:9000/asr");
});

// 14. 認証なし接続（factory default fetchImpl が undefined の場合）
test("mywhisper: factory case が正しく分岐される", () => {
  const p = createSttProvider(base, (async () => makeResponse("x")) as typeof fetch);
  assert.equal(p.id, "mywhisper");
  assert.equal(p.maxChunkSec, undefined);
  assert.equal(p.maxBytesPerRequest, 1_073_741_824);
});
