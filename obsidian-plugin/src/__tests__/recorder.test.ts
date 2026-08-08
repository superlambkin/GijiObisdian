import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Chromium（Obsidian レンダラー）の ESM ローダーは裸の Node 組み込み指定子
// （'fs' 等）を解決できず "Failed to resolve module specifier" になる。
// esbuild は target es2022 で import() を保持するため、動的 import は NG。
// 静的 import（→ require に変換される）を強制するソース走査回帰テスト。
// 前例: e2e7f47（child_process の静的态度 import 化）
const SRC_FILES = [
  "../audio/recorder.ts",
  "../bridge.ts",
  "../commands/importAudio.ts",
  "../commands/recordSegment.ts",
  "../providers/stt.ts",
  "../providers/llm.ts",
  "../test/sttTest.ts",
  "../ui/filePicker.ts",
];

test("no dynamic import of node builtins (chromium cannot resolve them)", () => {
  for (const rel of SRC_FILES) {
    const raw = readFileSync(new URL(rel, import.meta.url), "utf8");
    // コメント内の言及（例: この修正理由の注記）は誤検出させない
    const src = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(
      src,
      /import\(["'](fs|node:fs|child_process|node:child_process|path|node:path|os|node:os)["']\)/,
      `${rel} must use static import for node builtins`
    );
  }
});
