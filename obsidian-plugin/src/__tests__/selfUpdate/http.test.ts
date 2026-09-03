import test from "node:test";
import assert from "node:assert/strict";
import { httpGet } from "../../selfUpdate/http";

test("httpGet: obsidian 未解決環境では fetch にフォールバックする", async (t) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ tag_name: "v0.14.0" }),
    } as unknown as Response;
  });
  const res = await httpGet("https://example.com/api", { Accept: "application/json" });
  assert.equal(res.status, 200);
  assert.equal(res.ok, true);
  assert.deepEqual(await res.json(), { tag_name: "v0.14.0" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/api");
});
