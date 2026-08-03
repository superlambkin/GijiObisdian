import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../settings";

test("DEFAULT_SETTINGS has required fields", () => {
  assert.equal(DEFAULT_SETTINGS.sttProvider, "groq");
  assert.equal(DEFAULT_SETTINGS.sttLang, "auto");
  assert.equal(DEFAULT_SETTINGS.llmProvider, "cloud");
  assert.equal(DEFAULT_SETTINGS.bridgeBaseUrl, "http://127.0.0.1:17890");
});
