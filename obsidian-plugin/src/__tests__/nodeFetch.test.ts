import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createLlmProvider } from "../providers/llm";
import { DEFAULT_SETTINGS } from "../settings";

const nodeRequire = createRequire(import.meta.url);

async function withServer(
  handler: (req: any, res: any) => void,
  run: (port: number) => Promise<void>
) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  try {
    await run(port);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("createNodeFetch: require 供給時は function、不在時は undefined", async () => {
  const { createNodeFetch } = await import("../providers/nodeFetch");
  assert.equal(typeof createNodeFetch(nodeRequire), "function");
  // テスト環境では globalThis.require は存在しない → undefined
  assert.equal((globalThis as any).require, undefined);
  assert.equal(createNodeFetch(), undefined);
});

// api.kimi.com 対策の本丸: Chromium fetch（CORS/プロキシ）を通らない直接接続で
// SSE ストリームを end-to-end（withRetry → postOnce → consumeSse）で読めること
test("nodeFetch: SSE ストリームを end-to-end で読める", async () => {
  const { createNodeFetch } = await import("../providers/nodeFetch");
  const f = createNodeFetch(nodeRequire)!;
  await withServer(
    (req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n');
        res.write('data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n');
        res.end("data: [DONE]\n\n");
      });
    },
    async (port) => {
      const llm = createLlmProvider(
        { ...DEFAULT_SETTINGS, llmProvider: "cloud", llmApiKey: "k", llmBaseUrl: `http://127.0.0.1:${port}` },
        f
      );
      const stats: any = { retries: 0 };
      const out = await llm.complete("", "hi", stats);
      assert.equal(out, "OK");
      assert.equal(stats.inputTokens, 3);
      assert.equal(stats.outputTokens, 1);
    }
  );
});

test("nodeFetch: 非 SSE JSON 応答を読める", async () => {
  const { createNodeFetch } = await import("../providers/nodeFetch");
  const f = createNodeFetch(nodeRequire)!;
  await withServer(
    (req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "JSON-OK" } }] }));
      });
    },
    async (port) => {
      const llm = createLlmProvider(
        { ...DEFAULT_SETTINGS, llmProvider: "cloud", llmApiKey: "k", llmBaseUrl: `http://127.0.0.1:${port}` },
        f
      );
      assert.equal(await llm.complete("s", "hi"), "JSON-OK");
    }
  );
});

test("nodeFetch: HTTP エラーは ok=false + status + body を返す", async () => {
  const { createNodeFetch } = await import("../providers/nodeFetch");
  const f = createNodeFetch(nodeRequire)!;
  await withServer(
    (_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end('{"error":"bad key"}');
    },
    async (port) => {
      const res = await f(`http://127.0.0.1:${port}/`, { method: "POST", body: "{}" });
      assert.equal(res.ok, false);
      assert.equal(res.status, 401);
      assert.match(await res.text(), /bad key/);
    }
  );
});

test("nodeFetch: abort シグナルで AbortError 系の拒否", async () => {
  const { createNodeFetch } = await import("../providers/nodeFetch");
  const f = createNodeFetch(nodeRequire)!;
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    () => f("http://127.0.0.1:9/unused", { signal: ctrl.signal } as any),
    /abort/i
  );
});
