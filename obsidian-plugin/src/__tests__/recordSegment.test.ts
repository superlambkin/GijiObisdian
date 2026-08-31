import test from "node:test";
import assert from "node:assert/strict";

// C1 残経路回帰: コマンドパレット / リボン録音（startSegment）でも WASAPI PC 音声フォールバック用の
// manifestDir が recorder シングルトンへ渡ること。
// シングルトンは初回（startSegment）に生成されるため、stopSegment 側で manifestDir を渡しても
// 初回作成時に空だと以降は反映されない。startSegment が manifest.dir を渡すことを検証する。
//
// setup.cjs と同じ Module._load インターセプト方式で ../audio/recorder をモックする
//（tsx は package.json が CJS のため import を require に変換する）。
test("startSegment creates the recorder singleton with the passed manifestDir", async () => {
  const Module = require("node:module") as any;
  const originalLoad = Module._load;

  let ctorArgs: { app: unknown; manifestDir: string } | null = null;
  class FakeRecorder {
    constructor(app: unknown, manifestDir: string = "") {
      ctorArgs = { app, manifestDir };
    }
    async start() {
      return true;
    }
    async stop() {
      return null;
    }
  }

  // 対象モジュールを未ロード状態へ戻す（相対解決後の実ファイルパスでキャッシュを消す）
  const recFile = require.resolve("../audio/recorder");
  const segFile = require.resolve("../commands/recordSegment");
  delete require.cache[recFile];
  delete require.cache[segFile];

  Module._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "../audio/recorder") {
      return { SegmentRecorder: FakeRecorder };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    const { startSegment } = await import("../commands/recordSegment");
    const app = {};
    const settings = { audioSource: "mic" } as any;
    const timer = { start() {}, setTranscribing() {}, stop() {} };
    await startSegment(app, settings, "/plugin/manifest/dir", timer as any);
    assert.ok(ctorArgs, "recorder singleton should be created on first start");
    assert.equal(ctorArgs!.manifestDir, "/plugin/manifest/dir");
  } finally {
    Module._load = originalLoad;
  }
});
