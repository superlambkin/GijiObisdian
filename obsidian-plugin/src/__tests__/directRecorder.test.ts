import test from "node:test";
import assert from "node:assert/strict";
import { basename } from "path";
import { DirectRecorder, DirectRecorderDeps, rewriteFfmpegArgsForWasm } from "../audio/directRecorder";
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
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    enumerateDevices: async () => [],
    MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
    AudioContextCtor: null as unknown as typeof AudioContext,
    writeFile: async () => {},
    deleteFile: async () => {},
    ffmpeg: async () => {},
    spawnPcLoopbackCapture: async () => null,
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

/* ---------------- v0.11: WASAPI ループバック PC 音声キャプチャ（getDisplayMedia 不可時のフォールバック） ---------------- */

test("start: mix で getDisplayMedia 失敗 → spawnPcLoopbackCapture で WASAPI キャプチャ開始", async () => {
  FakeMediaRecorder.instances = [];
  let spawnCalled = 0;
  let capturedSpawn: { outPath: string; speakerId: string; scriptDir: string } | null = null;
  const deps = makeDeps({
    getUserMedia: async () => {
      return { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    },
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    spawnPcLoopbackCapture: async (outPath, speakerId, scriptDir) => {
      spawnCalled++;
      capturedSpawn = { outPath, speakerId, scriptDir };
      return { stop: async () => outPath };
    },
  });
  const r = new DirectRecorder(deps);
  const ok = await r.start({ ...settings, audioSource: "mix", pcLoopbackScriptDir: "C:/bridge" } as any);
  assert.equal(ok, true);
  assert.equal(spawnCalled, 1, "WASAPI キャプチャが起動される");
  assert.equal(capturedSpawn!.scriptDir, "C:/bridge");
  assert.equal(capturedSpawn!.speakerId, "");
  assert.equal(FakeMediaRecorder.instances.length, 1, "マイクは MediaRecorder で録音");
  const result = await r.stop(settings);
  assert.ok(result);
});

test("start: mix + WASAPI で spawnPcLoopbackCapture に pcLoopbackScriptDir を渡す", async () => {
  let captured: { scriptDir: string } | null = null;
  const deps = makeDeps({
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    spawnPcLoopbackCapture: async (_o, _s, scriptDir) => {
      captured = { scriptDir };
      return { stop: async () => "C:/pc.wav" };
    },
  });
  const r = new DirectRecorder(deps);
  await r.start({ ...settings, audioSource: "mix", pcLoopbackScriptDir: "C:/bundled" } as any);
  assert.equal(captured!.scriptDir, "C:/bundled");
});

test("start: pcLoopbackScriptDir 空なら spawnPcLoopbackCapture に manifestDir をフォールバックする（Critical C1）", async () => {
  let captured: { scriptDir: string } | null = null;
  const deps = makeDeps({
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    spawnPcLoopbackCapture: async (_o, _s, scriptDir) => {
      captured = { scriptDir };
      return { stop: async () => "C:/pc.wav" };
    },
  });
  const manifestDir = "C:/plugin/.obsidian/plugins/giji-obsidian";
  const r = new DirectRecorder(deps, undefined, manifestDir);
  // pcLoopbackScriptDir 未設定（既定 "" / undefined）→ 同梱スクリプトの manifest.dir が渡される
  await r.start({ ...settings, audioSource: "mix" } as any);
  assert.ok(captured, "WASAPI キャプチャが起動される");
  assert.equal(captured!.scriptDir, manifestDir);
});

test("stop: mix + WASAPI キャプチャ → ffmpeg がミックス引数（2 入力）で呼ばれる", async () => {
  FakeMediaRecorder.instances = [];
  const ffmpegCalls: string[][] = [];
  const deps = makeDeps({
    getUserMedia: async () => {
      return { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    },
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    spawnPcLoopbackCapture: async (outPath) => ({ stop: async () => outPath }),
    ffmpeg: async (args: string[]) => {
      ffmpegCalls.push(args);
    },
  });
  const r = new DirectRecorder(deps);
  await r.start({ ...settings, audioSource: "mix", pcLoopbackScriptDir: "C:/bridge" } as any);
  const result = await r.stop(settings);
  assert.ok(result, "stop は null でない");
  assert.equal(ffmpegCalls.length, 1, "ffmpeg が 1 回呼ばれる");
  const args = ffmpegCalls[0];
  const inputCount = args.filter((a) => a === "-i").length;
  assert.equal(inputCount, 2, "webm(mic) と wav(pc) の 2 入力でミックス");
  assert.ok(args.some((a) => a.includes("amix=inputs=2")), "amix フィルタが使われる");
  assert.equal(result!.audioPaths[0].endsWith(".mp3"), true);
});

test("start: pcLoopback で getDisplayMedia 失敗 → WASAPI キャプチャのみ・MediaRecorder なし", async () => {
  FakeMediaRecorder.instances = [];
  let gumCalled = 0;
  const deps = makeDeps({
    getUserMedia: async () => {
      gumCalled++;
      return {} as MediaStream;
    },
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    spawnPcLoopbackCapture: async (outPath) => ({ stop: async () => outPath }),
  });
  const r = new DirectRecorder(deps);
  const ok = await r.start({ ...settings, audioSource: "pcLoopback", pcLoopbackScriptDir: "C:/bridge" } as any);
  assert.equal(ok, true);
  assert.equal(gumCalled, 0, "pcLoopback では getUserMedia は呼ばれない");
  assert.equal(FakeMediaRecorder.instances.length, 0, "MediaRecorder は使わない");
  assert.equal(r.isRecording(), true, "pcCapture により録音中");
  const result = await r.stop(settings);
  assert.ok(result);
  assert.equal(result!.audioPaths[0].endsWith(".mp3"), true);
});

test("stop: pcLoopback + WASAPI → pc wav → mp3（ffmpeg 1 入力）", async () => {
  FakeMediaRecorder.instances = [];
  const ffmpegCalls: string[][] = [];
  const deps = makeDeps({
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    spawnPcLoopbackCapture: async (outPath) => ({ stop: async () => outPath }),
    ffmpeg: async (args: string[]) => {
      ffmpegCalls.push(args);
    },
  });
  const r = new DirectRecorder(deps);
  await r.start({ ...settings, audioSource: "pcLoopback", pcLoopbackScriptDir: "C:/bridge" } as any);
  const result = await r.stop(settings);
  assert.ok(result);
  assert.equal(ffmpegCalls.length, 1);
  const inputCount = ffmpegCalls[0].filter((a) => a === "-i").length;
  assert.equal(inputCount, 1, "pc wav のみ 1 入力");
  assert.equal(result!.audioPaths[0].endsWith(".mp3"), true);
});

test("stop: mix + WASAPI キャプチャ → webm と pc wav の一時ファイルが削除される", async () => {
  FakeMediaRecorder.instances = [];
  const deleted: string[] = [];
  const deps = makeDeps({
    getUserMedia: async () => {
      return { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    },
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    spawnPcLoopbackCapture: async (outPath) => ({ stop: async () => outPath }),
    deleteFile: async (p: string) => {
      deleted.push(p);
    },
  });
  const r = new DirectRecorder(deps);
  await r.start({ ...settings, audioSource: "mix", pcLoopbackScriptDir: "C:/bridge" } as any);
  const result = await r.stop(settings);
  assert.ok(result);
  assert.equal(deleted.filter((p) => p.endsWith(".webm")).length, 1, "webm が削除される");
  assert.equal(deleted.filter((p) => p.endsWith(".wav")).length, 1, "pc wav が削除される");
});

/* ---------------- Fix Round 1: wasm ffmpeg ホストパスブリッジ（rewriteFfmpegArgsForWasm） ---------------- */

test("rewriteFfmpegArgsForWasm: 1 入力（mic webm → mp3）を仮想パスへ書き換える", () => {
  const args = [
    "-y",
    "-i", "C:/rec/録音_2026.webm",
    "-codec:a", "libmp3lame",
    "-b:a", "64k",
    "-write_xing", "0",
    "C:/rec/録音_2026.mp3",
  ];
  const r = rewriteFfmpegArgsForWasm(args);
  assert.deepEqual(r.inputs, [
    { hostPath: "C:/rec/録音_2026.webm", virtualName: "input-0.webm" },
  ]);
  assert.equal(r.output.hostPath, "C:/rec/録音_2026.mp3");
  assert.equal(r.output.virtualName, "output.mp3");
  assert.deepEqual(r.execArgs, [
    "-y",
    "-i", "input-0.webm",
    "-codec:a", "libmp3lame",
    "-b:a", "64k",
    "-write_xing", "0",
    "output.mp3",
  ]);
});

/* ---------------- v0.12.1: 録音ファイル形式（WAV / MP3） ---------------- */

test("stop: recordingFormat=wav → 出力は .wav・ffmpeg は PCM 引数・wavPath も同じ .wav を指す", async () => {
  FakeMediaRecorder.instances = [];
  const ffmpegCalls: string[][] = [];
  const deps = makeDeps({
    ffmpeg: async (args: string[]) => {
      ffmpegCalls.push(args);
    },
  });
  const r = new DirectRecorder(deps);
  await r.start(settings);
  const result = await r.stop({ ...settings, recordingFormat: "wav" } as any);
  assert.ok(result, "stop は null でない");
  assert.equal(ffmpegCalls.length, 1, "ffmpeg が 1 回呼ばれる");
  const args = ffmpegCalls[0];
  assert.ok(
    args.includes("pcm_s16le") || args.some((a) => a.includes("pcm_s16le")),
    "ffmpeg 引数に pcm_s16le が含まれる"
  );
  assert.ok(args.some((a) => a === "-ac"), "-ac フラグが含まれる");
  assert.ok(args.some((a) => a === "1"), "-ac 1 が含まれる");
  assert.ok(args.some((a) => a === "-ar"), "-ar フラグが含まれる");
  assert.ok(args.some((a) => a === "16000"), "-ar 16000 が含まれる");
  assert.equal(result!.audioPaths[0].endsWith(".wav"), true, "出力は .wav");
  assert.equal(result!.wavPath, result!.audioPaths[0], "wavPath は audioPaths[0] と一致");
});

test("stop: recordingFormat=wav + mix（webm + pcWav）→ ffmpeg 2 入力 + PCM 引数", async () => {
  FakeMediaRecorder.instances = [];
  const ffmpegCalls: string[][] = [];
  const deps = makeDeps({
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    spawnPcLoopbackCapture: async (outPath) => ({ stop: async () => outPath }),
    ffmpeg: async (args: string[]) => {
      ffmpegCalls.push(args);
    },
  });
  const r = new DirectRecorder(deps);
  await r.start({ ...settings, audioSource: "mix", pcLoopbackScriptDir: "C:/bridge" } as any);
  const result = await r.stop({ ...settings, recordingFormat: "wav" } as any);
  assert.ok(result, "stop は null でない");
  assert.equal(ffmpegCalls.length, 1, "ffmpeg が 1 回呼ばれる");
  const args = ffmpegCalls[0];
  const inputCount = args.filter((a) => a === "-i").length;
  assert.equal(inputCount, 2, "webm + pc wav の 2 入力でミックス");
  assert.ok(args.some((a) => a.includes("pcm_s16le")), "ffmpeg 引数に pcm_s16le が含まれる");
  assert.ok(args.some((a) => a.includes("amix=inputs=2")), "amix フィルタが使われる");
  assert.equal(result!.audioPaths[0].endsWith(".wav"), true, "mix の出力は .wav");
  assert.equal(result!.wavPath, result!.audioPaths[0]);
});

test("stop: recordingFormat=wav + pcLoopback + WASAPI → ffmpeg 1 入力 + PCM 引数", async () => {
  FakeMediaRecorder.instances = [];
  const ffmpegCalls: string[][] = [];
  const deps = makeDeps({
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    spawnPcLoopbackCapture: async (outPath) => ({ stop: async () => outPath }),
    ffmpeg: async (args: string[]) => {
      ffmpegCalls.push(args);
    },
  });
  const r = new DirectRecorder(deps);
  await r.start({ ...settings, audioSource: "pcLoopback", pcLoopbackScriptDir: "C:/bridge" } as any);
  const result = await r.stop({ ...settings, recordingFormat: "wav" } as any);
  assert.ok(result, "stop は null でない");
  assert.equal(ffmpegCalls.length, 1, "ffmpeg が 1 回呼ばれる");
  const args = ffmpegCalls[0];
  const inputCount = args.filter((a) => a === "-i").length;
  assert.equal(inputCount, 1, "pc wav のみ 1 入力");
  assert.ok(args.some((a) => a.includes("pcm_s16le")), "ffmpeg 引数に pcm_s16le が含まれる");
  assert.equal(result!.audioPaths[0].endsWith(".wav"), true, "出力は .wav");
});

test("stop: recordingFormat 未指定（undefined）→ MP3 既定動作を維持（後方互換）", async () => {
  FakeMediaRecorder.instances = [];
  const ffmpegCalls: string[][] = [];
  const deps = makeDeps({
    ffmpeg: async (args: string[]) => {
      ffmpegCalls.push(args);
    },
  });
  const r = new DirectRecorder(deps);
  await r.start(settings);
  // recordingFormat を意図的に渡さない（既存ユーザー設定の互換性検証）
  const result = await r.stop({ ...settings, recordingFormat: undefined } as any);
  assert.ok(result, "stop は null でない");
  assert.equal(result!.audioPaths[0].endsWith(".mp3"), true, "未指定時は MP3");
  assert.equal(ffmpegCalls.length, 1);
  const args = ffmpegCalls[0];
  assert.ok(args.some((a) => a === "libmp3lame"), "未指定時は libmp3lame を使用");
});

test("stop: recordingFormat=mp3 明示指定 → MP3 出力（明示的デフォルト）", async () => {
  FakeMediaRecorder.instances = [];
  const ffmpegCalls: string[][] = [];
  const deps = makeDeps({
    ffmpeg: async (args: string[]) => {
      ffmpegCalls.push(args);
    },
  });
  const r = new DirectRecorder(deps);
  await r.start(settings);
  const result = await r.stop({ ...settings, recordingFormat: "mp3" } as any);
  assert.ok(result, "stop は null でない");
  assert.equal(result!.audioPaths[0].endsWith(".mp3"), true, "mp3 明示時は MP3");
  assert.equal(ffmpegCalls.length, 1);
  const args = ffmpegCalls[0];
  assert.ok(args.some((a) => a === "libmp3lame"), "mp3 明示時は libmp3lame を使用");
});

test("rewriteFfmpegArgsForWasm: 2 入力 mix で -filter_complex を維持しつつ仮想パスへ書き換える", () => {
  const filterComplex =
    "[0:a]aresample=16000,pan=mono|c0=c0[mic];[1:a]aresample=16000,pan=mono|c0=c0[pc];[mic][pc]amix=inputs=2:duration=longest:dropout_transition=0";
  const args = [
    "-y",
    "-i", "C:/rec/録音_2026.webm",
    "-i", "C:/pc/giji_pc_123.wav",
    "-filter_complex", filterComplex,
    "-ac", "1",
    "-ar", "16000",
    "-codec:a", "libmp3lame",
    "-b:a", "64k",
    "-write_xing", "0",
    "C:/rec/録音_2026.mp3",
  ];
  const r = rewriteFfmpegArgsForWasm(args);
  assert.equal(r.inputs.length, 2, "2 入力の順序を維持");
  assert.equal(r.inputs[0].hostPath, "C:/rec/録音_2026.webm");
  assert.equal(r.inputs[0].virtualName, "input-0.webm");
  assert.equal(r.inputs[1].hostPath, "C:/pc/giji_pc_123.wav");
  assert.equal(r.inputs[1].virtualName, "input-1.wav");
  assert.equal(r.output.hostPath, "C:/rec/録音_2026.mp3");
  assert.equal(r.output.virtualName, "output.mp3");
  const filterIdx = r.execArgs.indexOf("-filter_complex");
  assert.ok(filterIdx >= 0, "-filter_complex が残る");
  assert.equal(r.execArgs[filterIdx + 1], filterComplex, "amix フィルタは不変");
  assert.deepEqual(r.execArgs.slice(0, 5), ["-y", "-i", "input-0.webm", "-i", "input-1.wav"], "入力順序と -i 数が維持される");
});
