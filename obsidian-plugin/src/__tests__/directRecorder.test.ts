import test from "node:test";
import assert from "node:assert/strict";
import { basename } from "path";
import { DirectRecorder, DirectRecorderDeps } from "../audio/directRecorder";
import { buildRecordingFileName } from "../audio/recorder";
import { GijiSettings } from "../settings";

// ---- Fake AudioContext（v0.8.6: mix テスト用）----
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  closed = false;
  dest = { stream: {} as MediaStream };
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createMediaStreamDestination() { return this.dest; }
  createMediaStreamSource() { return { connect: () => {} }; }
  close() { this.closed = true; return Promise.resolve(); }
}

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
    enumerateDevices: async () => [],
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

test("stop: ファイル名は録音開始時刻（startTime）で生成される", async () => {
  FakeMediaRecorder.instances = [];
  const deps = makeDeps();
  const r = new DirectRecorder(deps);
  const before = Date.now();
  await r.start(settings);
  await new Promise((res) => setTimeout(res, 30)); // 開始時刻と停止時刻を分離
  const result = await r.stop(settings);
  assert.ok(result, "stop は null でない");
  assert.ok(result!.startTime instanceof Date);
  assert.ok(result!.startTime!.getTime() >= before);
  // ファイル名は録音開始時刻（startTime）をテンプレートで描画したものと完全一致する
  // （開始→停止の間に 30ms 以上空いているため、停止時刻で名付ける実装に退行したら検出できる）
  const name = basename(result!.audioPaths[0]);
  const expected =
    buildRecordingFileName(result!.startTime!, settings.recordingFileNameTemplate) + ".mp3";
  assert.equal(name, expected);
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

test("start: directMicDeviceId 設定時に deviceId.exact を getUserMedia に渡す", async () => {
  FakeMediaRecorder.instances = [];
  let captured: MediaStreamConstraints | undefined;
  const deps = makeDeps({
    getUserMedia: async (c) => {
      captured = c;
      return {} as MediaStream;
    },
  });
  const r = new DirectRecorder(deps);
  const ok = await r.start({ ...settings, directMicDeviceId: "bt-jm19" } as any);
  assert.equal(ok, true);
  assert.deepEqual(captured, { audio: { deviceId: { exact: "bt-jm19" } } });
});

test("start: directMicDeviceId 空文字なら audio: true にフォールバック", async () => {
  let captured: MediaStreamConstraints | undefined;
  const deps = makeDeps({
    getUserMedia: async (c) => {
      captured = c;
      return {} as MediaStream;
    },
  });
  const r = new DirectRecorder(deps);
  await r.start({ ...settings, directMicDeviceId: "" } as any);
  assert.deepEqual(captured, { audio: true });
});

test("start: audioSource=mix → getUserMedia + getDisplayMedia + AudioContext ミックス（v0.8.6）", async () => {
  FakeMediaRecorder.instances = [];
  FakeAudioContext.instances = [];
  let gumCalled = 0;
  let gdmCalled = 0;
  const deps = makeDeps({
    getUserMedia: async () => {
      gumCalled++;
      return { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    },
    getDisplayMedia: async () => {
      gdmCalled++;
      return {
        getTracks: () => [{ stop() {} }],
        getAudioTracks: () => [{ stop() {} }],
      } as unknown as MediaStream;
    },
    AudioContextCtor: FakeAudioContext as unknown as typeof AudioContext,
  });
  const r = new DirectRecorder(deps);
  const ok = await r.start({ ...settings, audioSource: "mix" } as any);
  assert.equal(ok, true);
  assert.equal(gumCalled, 1, "mix では getUserMedia が呼ばれる");
  assert.equal(gdmCalled, 1, "mix では getDisplayMedia が呼ばれる");
  assert.equal(FakeAudioContext.instances.length, 1, "AudioContext でミックス");
  const result = await r.stop(settings);
  assert.ok(result, "stop は null でない");
  assert.equal(FakeAudioContext.instances[0].closed, true, "AudioContext は close される");
});

test("start: audioSource=pcLoopback → getUserMedia は呼ばれず getDisplayMedia のみ（v0.8.6）", async () => {
  FakeMediaRecorder.instances = [];
  let gumCalled = 0;
  let gdmCalled = 0;
  const deps = makeDeps({
    getUserMedia: async () => {
      gumCalled++;
      return { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    },
    getDisplayMedia: async () => {
      gdmCalled++;
      return { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    },
  });
  const r = new DirectRecorder(deps);
  const ok = await r.start({ ...settings, audioSource: "pcLoopback" } as any);
  assert.equal(ok, true);
  assert.equal(gumCalled, 0, "pcLoopback では getUserMedia は呼ばれない");
  assert.equal(gdmCalled, 1, "pcLoopback では getDisplayMedia が呼ばれる");
  const result = await r.stop(settings);
  assert.ok(result);
});

test("start: mix で getDisplayMedia 失敗 → マイクのみで録音継続（v0.8.7）", async () => {
  FakeMediaRecorder.instances = [];
  let gdmCalled = 0;
  const deps = makeDeps({
    getUserMedia: async () => {
      return { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    },
    getDisplayMedia: async () => {
      gdmCalled++;
      const err = new Error("Permission denied") as Error & { name: string };
      err.name = "NotAllowedError";
      throw err;
    },
  });
  const r = new DirectRecorder(deps);
  const ok = await r.start({ ...settings, audioSource: "mix" } as any);
  // getDisplayMedia が失敗してもマイクのみで録音成功
  assert.equal(ok, true);
  assert.equal(gdmCalled, 1);
  assert.equal(FakeMediaRecorder.instances.length, 1, "マイクのみで MediaRecorder 開始");
  const result = await r.stop(settings);
  assert.ok(result);
});

test("start: mix で getDisplayMedia 音声なし（タブ音声未選択）→ マイクのみで録音継続（v0.8.7）", async () => {
  FakeMediaRecorder.instances = [];
  const deps = makeDeps({
    getUserMedia: async () => {
      return { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    },
    getDisplayMedia: async () => {
      // 音声トラックが無い（video のみ）を模擬
      return { getTracks: () => [{ stop() {}, kind: "video" }] } as unknown as MediaStream;
    },
  });
  const r = new DirectRecorder(deps);
  const ok = await r.start({ ...settings, audioSource: "mix" } as any);
  assert.equal(ok, true, "音声なしでもマイクのみで録音成功");
  assert.equal(FakeMediaRecorder.instances.length, 1);
  const result = await r.stop(settings);
  assert.ok(result);
});
