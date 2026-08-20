import test from "node:test";
import assert from "node:assert/strict";
import { transcribeWithRetry } from "../providers/sttRetry";
import { DEFAULT_SETTINGS } from "../settings";

function settings(concurrency = 2) {
  return { ...DEFAULT_SETTINGS, sttMaxConcurrency: concurrency };
}

test("transcribeWithRetry processes chunks in order", async () => {
  const chunks = [new ArrayBuffer(10), new ArrayBuffer(10), new ArrayBuffer(10)];
  const result = await transcribeWithRetry(chunks, settings(2), 2, {
    transcribe: async (_buf, _settings) => `text-${chunks.indexOf(_buf)}`,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.results, ["text-0", "text-1", "text-2"]);
});

test("transcribeWithRetry retries HTTP 429 once", async () => {
  let attempts = 0;
  const result = await transcribeWithRetry([new ArrayBuffer(10)], settings(1), 1, {
    retryDelayMs: 0,
    transcribe: async () => {
      attempts++;
      if (attempts === 1) {
        const err: any = new Error("STT 429: rate limit");
        err.status = 429;
        throw err;
      }
      return "success";
    },
  });
  assert.equal(result.success, true);
  assert.equal(attempts, 2);
  assert.deepEqual(result.results, ["success"]);
});

test("transcribeWithRetry reports a failed chunk and no transcript", async () => {
  const result = await transcribeWithRetry([new ArrayBuffer(10)], settings(1), 1, {
    retryDelayMs: 0,
    transcribe: async () => {
      const err: any = new Error("STT 500: server error");
      err.status = 500;
      throw err;
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.results.length, 0);
  assert.equal(result.failedChunks.length, 1);
  assert.equal(result.failedChunks[0].index, 0);
});

test("clamp limits concurrency to four even if a higher value is supplied", async () => {
  let active = 0;
  let maxActive = 0;
  const chunks = Array.from({ length: 8 }, () => new ArrayBuffer(1));
  const result = await transcribeWithRetry(chunks, settings(4), 99, {
    transcribe: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return "ok";
    },
  });
  assert.equal(result.success, true);
  assert.ok(maxActive <= 4);
});
