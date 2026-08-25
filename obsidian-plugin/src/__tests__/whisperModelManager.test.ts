import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getModelStatus,
  setModelStatus,
  checkModelExists,
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
