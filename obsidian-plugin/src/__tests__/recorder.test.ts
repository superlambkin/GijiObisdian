import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bridgeStart } from "../bridge";
import { buildRecordingFileName, buildSegmentResult, SegmentRecorder } from "../audio/recorder";

// Chromium（Obsidian レンダラー）の ESM ローダーは裸の Node 組み込み指定子
// （'fs' 等）を解決できず "Failed to resolve module specifier" になる。
// esbuild は target es2022 で import() を保持するため、動的 import は NG。
// 静的 import（→ require に変換される）を強制するソース走査回帰テスト。
// 前例: e2e7f47（child_process の静的态度 import 化）
const SRC_FILES = [
  "../audio/recorder.ts",
  "../audio/directRecorder.ts",
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

/* ---------------- 録音ファイル名・保存先（設定「① 録音」連携） ---------------- */

test("buildRecordingFileName renders 和式 template", () => {
  const d = new Date(2026, 7, 9, 6, 30, 15); // 2026-08-09 06:30:15
  assert.equal(
    buildRecordingFileName(d, "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分{{second}}秒"),
    "録音_2026年08月09日06時30分15秒"
  );
});

test("buildRecordingFileName strips illegal filename chars", () => {
  const name = buildRecordingFileName(new Date(2026, 7, 9), 'a/b\\c:d*e?f"g<h>i|j');
  assert.ok(!/[\\/:*?"<>|]/.test(name), `illegal chars remain: ${name}`);
});

test("bridgeStart posts outDir/fileName from 録音 settings", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: any, opts: any) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ sessionId: "s1" }) } as any;
  }) as any;
  const sid = await bridgeStart("http://bridge", { outDir: "C:/rec", fileName: "録音_test" }, fakeFetch);
  assert.equal(sid, "s1");
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.outDir, "C:/rec");
  assert.equal(body.fileName, "録音_test");
});

/* ---------------- 録音手法（bridge / direct）分岐 ---------------- */

test("recordingMethod=direct なら DirectRecorder に委譲（bridge 非呼出）", async () => {
  // スタブ DirectRecorder：呼び出し回数を記録する
  const stub = {
    startCalls: 0,
    isRecording: () => false,
    start: async () => {
      stub.startCalls++;
      return true;
    },
    stop: async () => null,
  } as any;
  const recorder = new SegmentRecorder({} as any, "", stub);
  const settings = { recordingMethod: "direct", bridgeBaseUrl: "http://bridge.invalid", audioSource: "mic" } as any;
  const ok = await recorder.start(settings);
  assert.equal(ok, true);
  assert.equal(stub.startCalls, 1, "direct では DirectRecorder.start が 1 回呼ばれる");
});

test("buildSegmentResult carries audioPaths and startTime", () => {
  const input = { audioPaths: ["C:/a.mp3", "C:/b.mp3"], durationSec: 12 };
  const start = new Date(2026, 7, 9, 13, 51);
  const res = buildSegmentResult("テキスト", input, start);
  assert.equal(res.text, "テキスト");
  assert.equal(res.durationSec, 12);
  assert.deepEqual(res.audioPaths, ["C:/a.mp3", "C:/b.mp3"]);
  assert.equal(res.startTime?.getTime(), start.getTime());
});

test("buildSegmentResult carries sttMs (処理時間表示用)", () => {
  const input = { audioPaths: [], durationSec: 5 };
  const res = buildSegmentResult("テキスト", input, undefined, 12345);
  assert.equal(res.sttMs, 12345);
});
