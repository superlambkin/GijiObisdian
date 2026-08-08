import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../settings";

test("DEFAULT_SETTINGS has required fields", () => {
  assert.equal(DEFAULT_SETTINGS.sttProvider, "openai");
  assert.equal(DEFAULT_SETTINGS.sttLang, "auto");
  assert.equal(DEFAULT_SETTINGS.llmProvider, "claudian");
  assert.equal(DEFAULT_SETTINGS.bridgeBaseUrl, "http://127.0.0.1:17890");
  assert.equal(DEFAULT_SETTINGS.autoSaveTranscript, true);
  assert.equal(DEFAULT_SETTINGS.transcriptSaveDir, "Clippings");
  assert.equal(DEFAULT_SETTINGS.outputDir, "Clippings");
});

test("DEFAULT_SETTINGS has recording save dir + file name template", () => {
  assert.ok(DEFAULT_SETTINGS.recordingSaveDir.includes("GijiObsidian"));
  assert.ok(DEFAULT_SETTINGS.recordingFileNameTemplate.includes("{{year}}"));
  assert.ok(DEFAULT_SETTINGS.recordingFileNameTemplate.includes("{{second}}"));
});

test("DEFAULT_SETTINGS has new feature flags", () => {
  assert.equal(DEFAULT_SETTINGS.insertToClaudianEnabled, true);
  assert.equal(DEFAULT_SETTINGS.minutesTemplateSource, "vault");
  assert.equal(DEFAULT_SETTINGS.minutesTemplateVaultPath, "00_Vault管理/議事録テンプレート.md");
  assert.equal(DEFAULT_SETTINGS.minutesTemplateFile, "議事録テンプレート.md");
  assert.equal(DEFAULT_SETTINGS.emailSummaryEnabled, false);
});
