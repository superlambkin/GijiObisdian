import test from "node:test";
import assert from "node:assert/strict";
import { buildOverwriteMessage } from "../ui/confirmModal";

test("buildOverwriteMessage: 設計書 §7 の文字列通り", () => {
  const msg = buildOverwriteMessage("議事録/議事録_2026年08月09日22時14分.md");
  assert.equal(msg.title, "議事録の上書き確認");
  assert.deepEqual(msg.body, [
    "既存の議事録が見つかりました：議事録/議事録_2026年08月09日22時14分.md",
    "上書きしますか？（手動編集は失われます）",
  ]);
});
