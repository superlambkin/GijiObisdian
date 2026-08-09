import test from "node:test";
import assert from "node:assert/strict";
import { buildOverwriteMessage, confirmOverwrite } from "../ui/confirmModal";

// setup.cjs の stub 経由で Modal の最後のインスタンスを globalThis.__lastModal に記録する

test("buildOverwriteMessage: 設計書 §7 の文字列通り", () => {
  const msg = buildOverwriteMessage("議事録/議事録_2026年08月09日22時14分.md");
  assert.equal(msg.title, "議事録の上書き確認");
  assert.deepEqual(msg.body, [
    "既存の議事録が見つかりました：議事録/議事録_2026年08月09日22時14分.md",
    "上書きしますか？（手動編集は失われます）",
  ]);
});

function getLastButtons(): any[] {
  const lastModal = (globalThis as any).__lastModal;
  if (!lastModal) return [];
  const setting = (lastModal.contentEl as any)._setting;
  return setting?._buttons ?? [];
}

// M3: confirmOverwrite の button 押下・Esc/× パス
test("confirmOverwrite: 「上書きする」ボタン押下で true を返す", async () => {
  (globalThis as any).__resetLastModal();
  const promise = confirmOverwrite({} as any, "議事録/X.md");
  await Promise.resolve();
  await Promise.resolve();
  const btns = getLastButtons();
  const overwriteBtn = btns.find((b) => b._text === "上書きする");
  assert.ok(overwriteBtn, "「上書きする」button が生成されていること");
  overwriteBtn._onClick();
  const result = await promise;
  assert.equal(result, true);
});

test("confirmOverwrite: 「キャンセル」ボタン押下で false を返す", async () => {
  (globalThis as any).__resetLastModal();
  const promise = confirmOverwrite({} as any, "議事録/X.md");
  await Promise.resolve();
  await Promise.resolve();
  const btns = getLastButtons();
  const cancelBtn = btns.find((b) => b._text === "キャンセル");
  assert.ok(cancelBtn, "「キャンセル」button が生成されていること");
  cancelBtn._onClick();
  const result = await promise;
  assert.equal(result, false);
});

test("confirmOverwrite: Modal の close()（Esc/× 相当）で false を返す", async () => {
  (globalThis as any).__resetLastModal();
  const promise = confirmOverwrite({} as any, "議事録/X.md");
  await Promise.resolve();
  await Promise.resolve();
  const lastModal = (globalThis as any).__lastModal;
  // onClose を直接呼び出す（Esc/× 押下相当）
  lastModal.onClose();
  const result = await promise;
  assert.equal(result, false);
});

test("confirmOverwrite: ボタン文字列が「上書きする」「キャンセル」と一致", async () => {
  (globalThis as any).__resetLastModal();
  confirmOverwrite({} as any, "議事録/X.md");
  await Promise.resolve();
  await Promise.resolve();
  const btns = getLastButtons();
  const texts = btns.map((b) => b._text);
  assert.ok(texts.includes("上書きする"));
  assert.ok(texts.includes("キャンセル"));
  // 上書きボタンは CTA スタイル（setCta が呼ばれている）
  const overwriteBtn = btns.find((b) => b._text === "上書きする");
  assert.equal(overwriteBtn._isCta, true);
});
