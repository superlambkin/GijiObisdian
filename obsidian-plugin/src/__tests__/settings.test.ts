import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, GijiSettingsTab, isBridgeSettingDisabled } from "../settings";

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

// ユーザー要求: 「テスト成功した場合、対応LLMのAPIキーを保存する」
// 接続テスト成功時は saveSettings が呼ばれる（API キーを含む設定が永続化される）
test("LLM 接続テスト成功時に saveSettings が呼ばれる（API キー保存）", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "OK" } }] }),
  })) as any;
  try {
    let saved = 0;
    const plugin = {
      manifest: { version: "0.0.0" },
      settings: {
        ...DEFAULT_SETTINGS,
        llmProvider: "cloud" as const,
        llmBaseUrl: "https://api.example.com/v1",
        llmModel: "test-model",
        llmApiKey: "test-key",
      },
      saveSettings: async () => {
        saved++;
      },
    };
    const tab = new GijiSettingsTab({} as any, plugin as any);
    await tab.handleLlmTest();
    assert.equal(saved, 1);
    // 成功時は provider 別プロファイルにも保存される
    assert.equal((plugin.settings.llmProviderProfiles as any)?.cloud?.llmApiKey, "test-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM 接続テスト失敗時は saveSettings が呼ばれない", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 401,
    text: async () => "bad key",
  })) as any;
  try {
    let saved = 0;
    const plugin = {
      manifest: { version: "0.0.0" },
      settings: {
        ...DEFAULT_SETTINGS,
        llmProvider: "cloud" as const,
        llmBaseUrl: "https://api.example.com/v1",
        llmModel: "test-model",
        llmApiKey: "bad",
      },
      saveSettings: async () => {
        saved++;
      },
    };
    const tab = new GijiSettingsTab({} as any, plugin as any);
    await tab.handleLlmTest();
    assert.equal(saved, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
