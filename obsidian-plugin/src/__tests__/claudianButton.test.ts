import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowBridgeButton, saveTranscriptAndAutoSummarize } from "../ui/claudianButton";
import { DEFAULT_SETTINGS } from "../settings";

test("shouldShowBridgeButton is true only for bridge", () => {
  assert.equal(shouldShowBridgeButton("bridge"), true);
  assert.equal(shouldShowBridgeButton("direct"), false);
  assert.equal(shouldShowBridgeButton(""), false);
});

// ツールバー 🎙️ ボタン停止フローが要約自動生成を呼ぶこと（回帰テスト）
// コマンドフロー（recordSegment.ts）では呼ばれるが、ツールバーでは漏れていたバグを防止する
test("saveTranscriptAndAutoSummarize calls autoSummarize with text/settings/app/manifestDir", async () => {
  const calls: any[] = [];
  const spy: any = async (...args: any[]) => {
    calls.push(args);
    return { ok: true };
  };
  const plugin = { app: {}, manifest: { dir: "/manifest/dir" } } as any;
  const settings = { ...DEFAULT_SETTINGS, autoSaveTranscript: false, autoSummarizeEnabled: true };
  await saveTranscriptAndAutoSummarize(plugin, settings, "転写テキスト", 12, { autoSummarizeImpl: spy });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "転写テキスト"); // text
  assert.equal(calls[0][1], settings); // settings
  assert.equal(calls[0][2], plugin.app); // app
  assert.equal(calls[0][3], "/manifest/dir"); // manifestDir
});

test("saveTranscriptAndAutoSummarize passes startTime/audioPaths to autoSummarize", async () => {
  const calls: any[] = [];
  const spy: any = async (...args: any[]) => {
    calls.push(args);
    return { ok: true };
  };
  const plugin = { app: {}, manifest: { dir: "/manifest/dir" } } as any;
  const settings = { ...DEFAULT_SETTINGS, autoSaveTranscript: false, autoSummarizeEnabled: true };
  const start = new Date(2026, 7, 9, 13, 51);
  await saveTranscriptAndAutoSummarize(plugin, settings, "転写テキスト", 12, {
    startTime: start,
    audioPaths: ["C:/a.mp3"],
    autoSummarizeImpl: spy,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "転写テキスト");
  assert.equal(calls[0][3], "/manifest/dir");
  assert.equal(calls[0][4].startTime.getTime(), start.getTime());
  assert.deepEqual(calls[0][4].mp3Links, "[🎙️ 録音を再生](file:///C:/a.mp3)");
  assert.equal(calls[0][4].durationSec, 12);
});

test("saveTranscriptAndAutoSummarize saves transcript before autoSummarize", async () => {
  const order: string[] = [];
  const fakeApp: any = {
    vault: {
      adapter: {
        exists: async () => false,
      },
      createFolder: async () => {
        order.push("createFolder");
      },
      create: async (path: string, _content: string) => {
        order.push(`create:${path}`);
      },
    },
  };
  const plugin = { app: fakeApp, manifest: { dir: "/m" } } as any;
  const settings = {
    ...DEFAULT_SETTINGS,
    autoSaveTranscript: true,
    appendRecordEnabled: false,
    autoSummarizeEnabled: true,
  };
  const spy: any = async (..._args: any[]) => {
    order.push("summarize");
    return { ok: true };
  };
  await saveTranscriptAndAutoSummarize(plugin, settings, "転写", 5, { autoSummarizeImpl: spy });
  assert.ok(order.some((o) => o.startsWith("create:")), "transcript should be saved");
  assert.equal(order[order.length - 1], "summarize", "autoSummarize should run after save");
});
