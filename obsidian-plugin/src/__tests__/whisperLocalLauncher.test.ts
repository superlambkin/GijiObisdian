import test from "node:test";
import assert from "node:assert/strict";
import { ensureWhisperLocalServer } from "../whisperLocalLauncher";
import { DEFAULT_SETTINGS } from "../settings";

const base = {
  ...DEFAULT_SETTINGS,
  sttBaseUrl: "http://127.0.0.1:9000/v1",
  sttServerDir: "D:\\AI-Agent\\GijiObsidian\\whisper-local-server",
  sttWhisperModel: "small" as const,
};

test("ensureWhisperLocalServer throws clear error when sttBaseUrl is empty", async () => {
  await assert.rejects(
    () => ensureWhisperLocalServer(
      { ...base, sttBaseUrl: "" },
      { skipSpawn: true, timeoutMs: 1000 },
    ),
    /ローカル Whisper サーバ URL が未設定/,
  );
});

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

test("ensureWhisperLocalServer throws for non-loopback URL without spawning", async () => {
  const fakeFetch = (async () => new Response("not ready", { status: 503 })) as typeof fetch;
  await assert.rejects(
    () => ensureWhisperLocalServer(
      { ...base, sttBaseUrl: "http://192.168.0.88:9000/v1" },
      { fetchImpl: fakeFetch, skipSpawn: true, timeoutMs: 1000 },
    ),
    /接続できません/,
  );
});

test("ensureWhisperLocalServer treats 404 health as reachable", async () => {
  const fakeFetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
  // 404 は /health ルート無しの OpenAI 互換サーバ → 到達可能として即 return（spawn しない）
  await ensureWhisperLocalServer(
    { ...base, sttBaseUrl: "http://127.0.0.1:9999/v1" },
    { fetchImpl: fakeFetch, skipSpawn: true, timeoutMs: 1000 },
  );
});
