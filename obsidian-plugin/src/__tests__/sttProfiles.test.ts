import test from "node:test";
import assert from "node:assert/strict";
import { saveSttProviderProfile, switchSttProvider } from "../providers/sttProfiles";
import { DEFAULT_SETTINGS } from "../settings";

test("saveSttProviderProfile: 現在の STT API キーを provider 別に保存する", () => {
  const s = { ...DEFAULT_SETTINGS, sttProvider: "openai" as const, sttApiKey: "openai-key" };
  const out = saveSttProviderProfile(s, "openai");
  assert.equal(out.sttProviderProfiles?.openai?.sttApiKey, "openai-key");
});

test("switchSttProvider: 保存済みキーを読み込み、旧キーは保存される", () => {
  const s = {
    ...DEFAULT_SETTINGS,
    sttProvider: "groq" as const,
    sttApiKey: "groq-key",
    sttProviderProfiles: { openai: { sttApiKey: "openai-key" } },
  };
  const out = switchSttProvider(s, "openai");
  assert.equal(out.sttProvider, "openai");
  assert.equal(out.sttApiKey, "openai-key"); // 保存済みキーを反映
  assert.equal(out.sttProviderProfiles?.groq?.sttApiKey, "groq-key"); // 旧キーを保存
});

test("switchSttProvider: 保存が無ければキーを引き継がない", () => {
  const s = { ...DEFAULT_SETTINGS, sttProvider: "groq" as const, sttApiKey: "groq-key" };
  const out = switchSttProvider(s, "openai");
  assert.equal(out.sttProvider, "openai");
  assert.equal(out.sttApiKey, ""); // 旧キーを引き継がない
});
