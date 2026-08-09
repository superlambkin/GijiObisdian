import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, isBridgeSettingDisabled } from "../settings";

test("DEFAULT_SETTINGS has required fields", () => {
  assert.equal(DEFAULT_SETTINGS.sttProvider, "openai");
  assert.equal(DEFAULT_SETTINGS.sttLang, "auto");
  assert.equal(DEFAULT_SETTINGS.llmProvider, "claudian");
  assert.equal(DEFAULT_SETTINGS.bridgeBaseUrl, "http://127.0.0.1:17890");
  assert.equal(DEFAULT_SETTINGS.autoSaveTranscript, true);
  assert.equal(DEFAULT_SETTINGS.transcriptSaveDir, "議事録");
  assert.equal(DEFAULT_SETTINGS.outputDir, "議事録");
  assert.equal(
    DEFAULT_SETTINGS.transcriptFileNameTemplate,
    "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分"
  );
  assert.ok(DEFAULT_SETTINGS.fileNameTemplate.startsWith("議事録_"));
  assert.ok(DEFAULT_SETTINGS.transcriptFileNameTemplate.startsWith("録音_"));
});

test("DEFAULT_SETTINGS has recording save dir + file name template", () => {
  assert.ok(DEFAULT_SETTINGS.recordingSaveDir.includes("GijiObsidian"));
  assert.ok(DEFAULT_SETTINGS.recordingFileNameTemplate.includes("{{year}}"));
  assert.ok(DEFAULT_SETTINGS.recordingFileNameTemplate.includes("{{second}}"));
  assert.equal(DEFAULT_SETTINGS.audioSource, "mix");
  assert.equal(DEFAULT_SETTINGS.recordingMethod, "bridge");
});

test("DEFAULT_SETTINGS has new feature flags", () => {
  assert.equal(DEFAULT_SETTINGS.insertToClaudianEnabled, true);
  assert.equal(DEFAULT_SETTINGS.minutesTemplateSource, "vault");
  assert.equal(DEFAULT_SETTINGS.minutesTemplateVaultPath, "00_Vault管理/議事録テンプレート.md");
  assert.equal(DEFAULT_SETTINGS.minutesTemplateFile, "議事録テンプレート.md");
  assert.equal(DEFAULT_SETTINGS.emailSummaryEnabled, false);
});

test("DEFAULT_SETTINGS has simplified LLM defaults", () => {
  assert.equal(DEFAULT_SETTINGS.llmProvider, "claudian");
  assert.equal(DEFAULT_SETTINGS.llmMaxTokens, 32000);
  assert.equal(DEFAULT_SETTINGS.llmAdvancedOpen, false);
  assert.equal(DEFAULT_SETTINGS.llmApiFormatOverride, false);
});

test("isBridgeSettingDisabled", () => {
  assert.equal(isBridgeSettingDisabled("bridge"), false);
  assert.equal(isBridgeSettingDisabled("direct"), true);
});
