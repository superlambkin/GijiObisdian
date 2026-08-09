import test from "node:test";
import assert from "node:assert/strict";
import { basename } from "path";
import { DirectRecorder, DirectRecorderDeps } from "../audio/directRecorder";
import { GijiSettings } from "../settings";

// ---- Fake MediaRecorder（DOM 非依存・テスト用）----
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  startCalls = 0;
  stopCalls = 0;
  constructor(public stream: any, public options: any) {
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.startCalls++;
    this.state = "recording";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) });
  }
  stop() {
    this.stopCalls++;
    this.state = "inactive";
    // 録音中チャンクに加えて stop() 後の最終フラッシュをシミュレート
    this.ondataavailable?.({ data: new Blob([new Uint8Array([4, 5])]) });
    this.onstop?.();
  }
}

const settings = {
  recordingSaveDir: "C:/rec",
  recordingFileNameTemplate: "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分{{second}}秒",
} as unknown as GijiSettings;

function makeDeps(overrides: Partial<DirectRecorderDeps> = {}): Required<DirectRecorderDeps> {
  return {
    getUserMedia: async () => ({}) as MediaStream,
    MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
    writeFile: async () => {},
    deleteFile: async () => {},
    ffmpeg: async () => {},
    ...overrides,
  } as Required<DirectRecorderDeps>;
}

test("start: getUserMedia 成功 → isRecording true・MediaRecorder.start 呼出", async () => {
  FakeMediaRecorder.instances = [];
  const deps = makeDeps();
  const r = new DirectRecorder(deps);
  const ok = await r.start(settings);
  assert.equal(ok, true);
  assert.equal(r.isRecording(), true);
  assert.equal(FakeMediaRecorder.instances.length, 1);
  const rec = FakeMediaRecorder.instances[0];
  assert.equal(rec.startCalls, 1);
  assert.equal(rec.options.mimeType, "audio/webm;codecs=opus");
});

test("start: マイク権限拒否 → false・isRecording false", async () => {
  const deps = makeDeps({ getUserMedia: async () => { throw new Error("denied"); } });
  const r = new DirectRecorder(deps);
  const ok = await r.start(settings);
  assert.equal(ok, false);
  assert.equal(r.isRecording(), false);
});

test("start: MediaRecorder 非対応 → false + isRecording false", async () => {
  const deps = makeDeps({ MediaRecorderCtor: null as any });
  const r = new DirectRecorder(deps);
  const ok = await r.start(settings);
  assert.equal(ok, false);
  assert.equal(r.isRecording(), false);
});

test("stop: ffmpeg 成功 → MP3 パス返却・webm 削除・durationSec 算出", async () => {
  FakeMediaRecorder.instances = [];
  const deleted: string[] = [];
  const deps = makeDeps({ deleteFile: async (p: string) => { deleted.push(p); } });
  const r = new DirectRecorder(deps);
  await r.start(settings);
  const result = await r.stop(settings);
  assert.ok(result, "stop は null でない");
  // Windows パス区切り非依存で検証する（path.join は "C:\\rec\\..." を返す）
  const name = basename(result!.audioPaths[0]);
  assert.equal(name.endsWith(".mp3"), true);
  assert.equal(name.startsWith("録音_"), true);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].endsWith(".webm"), true);
  assert.ok(result!.durationSec >= 0);
  assert.equal(r.isRecording(), false);
});

test("stop: ffmpeg 失敗 → warning=mp3_encode_failed・webm 残存", async () => {
  FakeMediaRecorder.instances = [];
  const deps = makeDeps({ ffmpeg: async () => { throw new Error("no ffmpeg"); } });
  const r = new DirectRecorder(deps);
  await r.start(settings);
  const result = await r.stop(settings);
  assert.ok(result, "stop は null でない");
  assert.equal(result!.warning, "mp3_encode_failed");
  assert.equal(result!.audioPaths[0].endsWith(".webm"), true);
});

test("stop: 録音していない → null", async () => {
  const r = new DirectRecorder(makeDeps());
  const result = await r.stop(settings);
  assert.equal(result, null);
});
