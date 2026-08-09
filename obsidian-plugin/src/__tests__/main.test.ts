import test from "node:test";
import assert from "node:assert/strict";
import { LLM_PROVIDERS } from "../main";
import { PRESET_DISPLAY_ORDER } from "../providers/llmPresets";

test("LLM_PROVIDERS contains every preset id", () => {
  assert.deepEqual(new Set(LLM_PROVIDERS), new Set(PRESET_DISPLAY_ORDER));
});
