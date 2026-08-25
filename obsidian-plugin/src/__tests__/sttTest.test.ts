import test from "node:test";
import assert from "node:assert/strict";
import { runSttTest } from "../test/sttTest";
import { DEFAULT_SETTINGS } from "../settings";

const base = { ...DEFAULT_SETTINGS, sttApiKey: "test-key" };

test("empty api key returns hint", async () => {
  const res = await runSttTest({ ...base, sttProvider: "openai", sttApiKey: "" });
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /请先填写 STT API Key/);
});

test("transcribe success returns text", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => ({ text: "你好，这是测试转写功能" }),
  })) as any;
  const res = await runSttTest(base, fetchImpl);
  assert.equal(res.ok, true);
  assert.equal(res.text, "你好，这是测试转写功能");
});

test("transcribe http error surfaces status", async () => {
  // 自動起動ヘルスチェック（/health）は OK、転写エンドポイントのみ 401 を返す
  const fetchImpl = (async (url: string) => {
    if (url.endsWith("/health")) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return {
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    };
  }) as any;
  const res = await runSttTest(base, fetchImpl);
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /401/);
});

test("empty transcript returns hint", async () => {
  const fetchImpl = (async () => ({ ok: true, json: async () => ({ text: "" }) })) as any;
  const res = await runSttTest(base, fetchImpl);
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /未识别出文本/);
});
