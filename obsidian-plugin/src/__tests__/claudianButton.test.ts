import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowBridgeButton } from "../ui/claudianButton";

test("shouldShowBridgeButton is true only for bridge", () => {
  assert.equal(shouldShowBridgeButton("bridge"), true);
  assert.equal(shouldShowBridgeButton("direct"), false);
  assert.equal(shouldShowBridgeButton(""), false);
});
