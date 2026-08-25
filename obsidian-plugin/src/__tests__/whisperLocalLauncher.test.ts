import test from "node:test";
import assert from "node:assert/strict";
import { ensureWhisperLocalServer } from "../whisperLocalLauncher";
import { DEFAULT_SETTINGS } from "../settings";

const base = {
  ...DEFAULT_SETTINGS,
  sttBaseUrl: "http://127.0.0.1:9000/v1",
  sttServerDir: "D:\\AI-Agent\\giji-obsidian\\whisper-local-server",
  sttWhisperModel: "small" as const,
};

test("ensureWhisperLocalServer skips startup when health check succeeds", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ status: "ok", model: "small" }), { status: 200 })
  ) as typeof fetch;
  // skipSpawn=true で spawn を回避し、health check 成功の即リターンを検証
  await ensureWhisperLocalServer(base, { fetchImpl: fakeFetch, skipSpawn: true });
});

test("ensureWhisperLocalServer throws when health check fails repeatedly", async () => {
  const fakeFetch = (async () =>
    new Response("not ready", { status: 503 })
  ) as typeof fetch;
  await assert.rejects(
    () => ensureWhisperLocalServer(base, { fetchImpl: fakeFetch, skipSpawn: true, timeoutMs: 1000 }),
    /Whisper サーバの起動がタイムアウト/,
  );
});
