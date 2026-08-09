import test from "node:test";
import assert from "node:assert/strict";
import {
  LLM_PRESETS,
  PRESET_DISPLAY_ORDER,
  getPreset,
  applyPreset,
  saveProviderProfile,
  loadProviderProfile,
  switchLlmProvider,
} from "../providers/llmPresets";
import { DEFAULT_SETTINGS } from "../settings";

test("LLM_PRESETS: 必須プリセット（11 個）が全て含まれる", () => {
  const required: Array<keyof typeof LLM_PRESETS> = [
    "claudian", "deepseek", "MiniMax", "kimi", "kimi-coding",
    "openai", "claude", "gemini", "ollama", "cloud", "custom",
  ];
  for (const id of required) {
    assert.ok(LLM_PRESETS[id], `LLM_PRESETS.${id} が存在すること`);
    assert.equal(LLM_PRESETS[id].id, id);
  }
});

test("getPreset: MiniMax は defaultMaxTokens === 524288", () => {
  const p = getPreset("MiniMax");
  assert.ok(p);
  assert.equal(p.defaultMaxTokens, 524288);
  assert.equal(p.apiFormat, "anthropic");
  assert.equal(p.requiresApiKey, true);
});

test("getPreset: claudian は requiresApiKey === false", () => {
  const p = getPreset("claudian");
  assert.ok(p);
  assert.equal(p.requiresApiKey, false);
});

test("getPreset: ollama は baseUrl に localhost:11434 が含まれる", () => {
  const p = getPreset("ollama");
  assert.ok(p);
  assert.match(p.baseUrl, /localhost:11434/);
  assert.equal(p.requiresApiKey, false);
});

test("getPreset: 未知の id は undefined を返す", () => {
  assert.equal(getPreset("nonexistent"), undefined);
});

test("applyPreset: deepseek は baseUrl / model / apiFormat / anthropicVersion / llmMaxTokens を埋める", () => {
  const out = applyPreset(DEFAULT_SETTINGS, "deepseek");
  assert.equal(out.llmProvider, "deepseek");
  assert.equal(out.llmBaseUrl, "https://api.deepseek.com/anthropic");
  assert.equal(out.llmModel, "deepseek-v4-flash");
  assert.equal(out.llmApiFormat, "anthropic");
  assert.equal(out.anthropicVersion, "2023-06-01");
  assert.equal(out.llmMaxTokens, 32000);
  // 保持される
  assert.equal(out.llmTimeoutMs, DEFAULT_SETTINGS.llmTimeoutMs);
  assert.equal(out.llmMaxRetries, DEFAULT_SETTINGS.llmMaxRetries);
  assert.equal(out.autoSummarizeEnabled, DEFAULT_SETTINGS.autoSummarizeEnabled);
});

test("applyPreset: MiniMax は llmMaxTokens === 524288 を設定", () => {
  const out = applyPreset(DEFAULT_SETTINGS, "MiniMax");
  assert.equal(out.llmMaxTokens, 524288);
  assert.equal(out.llmModel, "MiniMax-M3[1M]");
});

test("getPreset: OpenAI / Claude / Gemini は各 API 形式と URL を持つ", () => {
  assert.equal(getPreset("openai")?.apiFormat, "openai");
  assert.equal(getPreset("openai")?.baseUrl, "https://api.openai.com/v1");
  assert.equal(getPreset("claude")?.apiFormat, "anthropic");
  assert.equal(getPreset("claude")?.baseUrl, "https://api.anthropic.com");
  assert.equal(getPreset("gemini")?.apiFormat, "openai");
  assert.equal(
    getPreset("gemini")?.baseUrl,
    "https://generativelanguage.googleapis.com/v1beta/openai"
  );
});

test("applyPreset: custom はユーザーが既に設定した baseUrl / model を上書きしない", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    llmBaseUrl: "https://my-custom.example.com/v1",
    llmModel: "my-custom-model",
  };
  const out = applyPreset(settings, "custom");
  assert.equal(out.llmBaseUrl, "https://my-custom.example.com/v1");
  assert.equal(out.llmModel, "my-custom-model");
});

test("applyPreset: claudian はユーザーが既に設定した baseUrl / model を上書きしない", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    llmBaseUrl: "https://stale.example.com",
    llmModel: "stale-model",
  };
  const out = applyPreset(settings, "claudian");
  assert.equal(out.llmBaseUrl, "https://stale.example.com");
  assert.equal(out.llmModel, "stale-model");
});

test("applyPreset: 未知の presetId は入力をそのまま返す", () => {
  const out = applyPreset(DEFAULT_SETTINGS, "nonexistent" as any);
  assert.equal(out, DEFAULT_SETTINGS);
});

test("getPreset: kimi-coding は Kimi for Coding 定額プランのエンドポイントを持つ", () => {
  const p = getPreset("kimi-coding");
  assert.ok(p);
  assert.equal(p.baseUrl, "https://api.kimi.com/coding/v1");
  assert.equal(p.model, "kimi-for-coding");
  assert.equal(p.apiFormat, "openai");
  assert.equal(p.requiresApiKey, true);
});

test("getPreset: deepseek のモデルは deepseek-v4-flash", () => {
  assert.equal(getPreset("deepseek")?.model, "deepseek-v4-flash");
});

test("getPreset: deepseek は thinking モデル用の長いタイムアウト(300000)を持つ", () => {
  assert.equal(getPreset("deepseek")?.defaultTimeoutMs, 300000);
});

test("saveProviderProfile: 現在の LLM 設定を provider 別に保存する", () => {
  const s = {
    ...DEFAULT_SETTINGS,
    llmProvider: "deepseek" as const,
    llmApiKey: "ds-key",
    llmBaseUrl: "https://my.deepseek.example",
    llmModel: "my-model",
    llmMaxTokens: 12345,
    llmTimeoutMs: 7777,
  };
  const out = saveProviderProfile(s, "deepseek");
  assert.equal(out.llmProviderProfiles?.deepseek?.llmApiKey, "ds-key");
  assert.equal(out.llmProviderProfiles?.deepseek?.llmBaseUrl, "https://my.deepseek.example");
  assert.equal(out.llmProviderProfiles?.deepseek?.llmModel, "my-model");
  assert.equal(out.llmProviderProfiles?.deepseek?.llmMaxTokens, 12345);
  assert.equal(out.llmProviderProfiles?.deepseek?.llmTimeoutMs, 7777);
  // 既存プロファイルは保持される
  const out2 = saveProviderProfile(
    { ...s, llmProviderProfiles: { kimi: { llmApiKey: "k-key" } } },
    "deepseek"
  );
  assert.equal(out2.llmProviderProfiles?.kimi?.llmApiKey, "k-key");
});

test("loadProviderProfile: 保存済み profile を読み出す", () => {
  const s = {
    ...DEFAULT_SETTINGS,
    llmProvider: "deepseek" as const,
    llmProviderProfiles: {
      deepseek: { llmApiKey: "ds-key", llmModel: "custom-model" },
    },
  };
  const out = loadProviderProfile(s, "deepseek");
  assert.equal(out.llmApiKey, "ds-key");
  assert.equal(out.llmModel, "custom-model");
});

test("loadProviderProfile: profile が無ければ何も変えない", () => {
  const s = { ...DEFAULT_SETTINGS, llmProvider: "deepseek" as const, llmApiKey: "k" };
  const out = loadProviderProfile(s, "deepseek");
  assert.equal(out, s);
});

test("switchLlmProvider: 旧 provider を保存し新 provider の profile を読む", () => {
  const s = {
    ...DEFAULT_SETTINGS,
    llmProvider: "kimi-coding" as const,
    llmApiKey: "kimi-key",
    llmProviderProfiles: {
      deepseek: { llmApiKey: "ds-key", llmModel: "deepseek-v4-flash" },
    },
  };
  const out = switchLlmProvider(s, "deepseek");
  assert.equal(out.llmProvider, "deepseek");
  assert.equal(out.llmApiKey, "ds-key"); // 保存済みキーを読む
  assert.equal(out.llmModel, "deepseek-v4-flash");
  // 旧 provider（kimi-coding）の現在設定がプロファイルに保存されている
  assert.equal(out.llmProviderProfiles?.["kimi-coding"]?.llmApiKey, "kimi-key");
});

test("switchLlmProvider: 新 provider に profile が無ければ API キーを引き継がない", () => {
  const s = {
    ...DEFAULT_SETTINGS,
    llmProvider: "kimi-coding" as const,
    llmApiKey: "kimi-key",
  };
  const out = switchLlmProvider(s, "deepseek");
  assert.equal(out.llmProvider, "deepseek");
  assert.equal(out.llmApiKey, ""); // 旧キーを引き継がない
  assert.equal(out.llmBaseUrl, "https://api.deepseek.com/anthropic");
  assert.equal(out.llmModel, "deepseek-v4-flash");
});

test("PRESET_DISPLAY_ORDER: 最初の要素が claudian", () => {
  assert.equal(PRESET_DISPLAY_ORDER[0], "claudian");
  assert.equal(PRESET_DISPLAY_ORDER.length, 11);
});