import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getModelStatus,
  setModelStatus,
  checkModelExists,
  downloadWhisperModel,
} from "../whisperModelManager";
import { WHISPER_MODELS } from "../settings";

const tmpDir = join(tmpdir(), "giji-whisper-test-" + Date.now());

test.before(() => { mkdirSync(tmpDir, { recursive: true }); });
test.after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

test("getModelStatus returns 'not-downloaded' for fresh model", () => {
  setModelStatus("tiny", "not-downloaded");
  assert.equal(getModelStatus("tiny"), "not-downloaded");
});

test("setModelStatus updates state correctly", () => {
  setModelStatus("small", "downloading");
  assert.equal(getModelStatus("small"), "downloading");
  setModelStatus("small", "downloaded");
  assert.equal(getModelStatus("small"), "downloaded");
});

test("checkModelExists returns false when model cache absent", () => {
  setModelStatus("medium", "not-downloaded");
  assert.equal(checkModelExists("medium", tmpDir), false);
});

test("checkModelExists returns true when model cache present", () => {
  const repoName = WHISPER_MODELS.medium.repo.replace(/\//g, "--");
  const cacheDir = join(tmpDir, `models--${repoName}`);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, "model.bin"), "fake");
  assert.equal(checkModelExists("medium", tmpDir), true);
});

test("downloadWhisperModel throws clear error when baseUrl is empty", async () => {
  setModelStatus("tiny", "not-downloaded");
  await assert.rejects(
    () => downloadWhisperModel("tiny", ""),
    /STT Base URL が未設定/,
  );
  assert.equal(getModelStatus("tiny"), "error");
});

test("downloadWhisperModel posts to /v1/download/{repo} and marks downloaded", async () => {
  setModelStatus("tiny", "not-downloaded");
  let capturedUrl = "";
  const fakeFetch = (async (url: string) => {
    capturedUrl = String(url);
    return { ok: true, status: 200, json: async () => ({ status: "ok" }) };
  }) as unknown as typeof fetch;
  await downloadWhisperModel("tiny", "http://127.0.0.1:9000/v1", fakeFetch);
  assert.equal(capturedUrl, "http://127.0.0.1:9000/v1/download/Systran/faster-whisper-tiny");
  assert.equal(getModelStatus("tiny"), "downloaded");
});

test("downloadWhisperModel marks error status on HTTP failure", async () => {
  setModelStatus("medium", "not-downloaded");
  const fakeFetch = (async () => ({
    ok: false,
    status: 404,
    json: async () => ({}),
  })) as unknown as typeof fetch;
  await assert.rejects(
    () => downloadWhisperModel("medium", "http://127.0.0.1:9000/v1", fakeFetch),
    /HTTP 404/,
  );
  assert.equal(getModelStatus("medium"), "error");
});
