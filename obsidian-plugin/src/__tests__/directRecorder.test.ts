import test from "node:test";
import assert from "node:assert/strict";
import { basename, join } from "path";
import { DirectRecorder, DirectRecorderDeps, rewriteFfmpegArgsForWasm, computeRmsLevel } from "../audio/directRecorder";
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
    onStreamLevel: () => {},
    setInterval: ((fn: any, ms?: number) => setInterval(fn, ms)) as any,
    clearInterval: ((h: any) => clearInterval(h)) as any,
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

test("stop: ffmpeg 失敗 → warning=encode_failed・webm 残存", async () => {
  FakeMediaRecorder.instances = [];
  const deps = makeDeps({ ffmpeg: async () => { throw new Error("no ffmpeg"); } });
  const r = new DirectRecorder(deps);
  await r.start(settings);
  const result = await r.stop(settings);
  assert.ok(result, "stop は null でない");
  assert.equal(result!.warning, "encode_failed");
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
  let capturedSpawn: { outPath: string; speakerId: string; scriptDir: string; logger?: Function } | null = null;
  const deps = makeDeps({
    getUserMedia: async () => {
      return { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    },
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    spawnPcLoopbackCapture: async (outPath, speakerId, scriptDir, logger) => {
      spawnCalled++;
      capturedSpawn = { outPath, speakerId, scriptDir, logger };
      return { stop: async () => outPath };
    },
  });
  const r = new DirectRecorder(deps);
  const ok = await r.start({ ...settings, audioSource: "mix", pcLoopbackScriptDir: "C:/bridge" } as any);
  assert.equal(ok, true);
  assert.equal(spawnCalled, 1, "WASAPI キャプチャが起動される");
  assert.equal(capturedSpawn!.scriptDir, "C:/bridge");
  assert.equal(capturedSpawn!.speakerId, "");
  assert.equal(typeof capturedSpawn!.logger, "function", "v0.13: logger コールバックが渡される（stderr/exit code 記録用）");
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

/* ---------------- v0.13.1: manifestDir 相対パス → 絶対パス解決（Electron cwd 問題対策） ---------------- */

test("start: manifestDir が相対パスの場合、Vault basePath と結合して絶対パスで spawn する（Electron cwd 対策）", async () => {
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
  // Electron 環境再現: manifestDir は相対、app.vault.adapter.basePath で Vault ルートを返す
  const fakeApp = {
    vault: { adapter: { basePath: "C:/Users/me/Vault" } },
  } as any;
  const manifestDir = ".obsidian/plugins/GijiObsidian"; // 相対
  const r = new DirectRecorder(deps, fakeApp, manifestDir);
  await r.start({ ...settings, audioSource: "mix" } as any);
  assert.ok(captured);
  // 期待: Vault basePath + 相対パス → 絶対パス
  // 区切り文字は path.join に揃える（CI は Linux のためスラッシュになる）
  const expected = join("C:/Users/me/Vault", ".obsidian/plugins/GijiObsidian");
  assert.equal(captured!.scriptDir, expected, `scriptDir should be ${expected}, got: ${captured!.scriptDir}`);
});

test("start: manifestDir が絶対パスの場合、そのまま spawn に渡す（絶対パス優先）", async () => {
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
  const fakeApp = {
    vault: { adapter: { basePath: "C:/Users/me/Vault" } },
  } as any;
  const manifestDir = "C:/already/absolute/plugin/dir";
  const r = new DirectRecorder(deps, fakeApp, manifestDir);
  await r.start({ ...settings, audioSource: "mix" } as any);
  assert.equal(captured!.scriptDir, manifestDir, "絶対パスはそのまま渡される（二重結合しない）");
});

test("start: app.vault.adapter.basePath 不在時、相対パスはそのまま渡す（best-effort）", async () => {
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
  // basePath がないアプリ（モバイル等）
  const fakeApp = { vault: { adapter: {} } } as any;
  const manifestDir = ".obsidian/plugins/GijiObsidian";
  const r = new DirectRecorder(deps, fakeApp, manifestDir);
  await r.start({ ...settings, audioSource: "mix" } as any);
  assert.equal(captured!.scriptDir, manifestDir, "basePath 不在なら相対パスのまま渡す");
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

/* ---------------- v0.13: エンコード失敗時の Notice format 対応 ---------------- */

test("stop: ffmpeg 失敗（format=wav）→ warning='encode_failed' + 実体は webm", async () => {
  FakeMediaRecorder.instances = [];
  const deps = makeDeps({
    ffmpeg: async () => { throw new Error("ffmpeg failed"); },
  });
  const r = new DirectRecorder(deps);
  await r.start(settings);
  const result = await r.stop({ ...settings, recordingFormat: "wav" } as any);
  assert.ok(result);
  assert.equal(result!.warning, "encode_failed", "warning キーは format 非依存");
  assert.equal(result!.audioPaths[0].endsWith(".webm"), true, "fallback で webm が残る");
});

test("stop: ffmpeg 失敗（format=mp3）→ warning='encode_failed'", async () => {
  FakeMediaRecorder.instances = [];
  const deps = makeDeps({
    ffmpeg: async () => { throw new Error("ffmpeg failed"); },
  });
  const r = new DirectRecorder(deps);
  await r.start(settings);
  const result = await r.stop({ ...settings, recordingFormat: "mp3" } as any);
  assert.ok(result);
  assert.equal(result!.warning, "encode_failed", "MP3 でも同じ警告キー");
  assert.equal(result!.audioPaths[0].endsWith(".webm"), true, "fallback で webm が残る");
});

import { buildEncodeFailedNotice } from "../audio/recorder";

test("buildEncodeFailedNotice: format=wav → 'WAV 変換に失敗'（MP3 と誤表示しない）", () => {
  const notice = buildEncodeFailedNotice(
    { recordingFormat: "wav" } as any,
    { warning: "encode_failed", audioPaths: ["/tmp/foo.webm"], durationSec: 1 }
  );
  assert.ok(notice);
  assert.ok(notice!.includes("WAV"), "WAV を含む");
  assert.ok(!notice!.includes("MP3"), "MP3 を含まない（format 設定と一致）");
  assert.ok(notice!.includes("WebM"), "実態（WebM）を明記");
});

test("buildEncodeFailedNotice: format=mp3 → 'MP3 変換に失敗'", () => {
  const notice = buildEncodeFailedNotice(
    { recordingFormat: "mp3" } as any,
    { warning: "encode_failed", audioPaths: ["/tmp/foo.webm"], durationSec: 1 }
  );
  assert.ok(notice);
  assert.ok(notice!.includes("MP3"), "MP3 を含む");
  assert.ok(!notice!.includes("WebM は") /* 'WebM は保存しました' 等の誤解表現を避ける */);
  assert.ok(notice!.includes("WebM"), "実態（WebM）を明記");
});

test("buildEncodeFailedNotice: warning 無し → null", () => {
  const notice = buildEncodeFailedNotice(
    { recordingFormat: "wav" } as any,
    { warning: undefined, audioPaths: ["/tmp/foo.wav"], durationSec: 1 }
  );
  assert.equal(notice, null);
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

// ---- v0.15: 入力レベル計測 ----

/** AnalyserNode を返す FakeAudioContext（既存 FakeAudioContext を拡張） */
class FakeAnalyserAudioContext extends FakeAudioContext {
  static frame: Float32Array | null = null;
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createAnalyser() {
    const self = this;
    return {
      fftSize: 1024,
      getFloatTimeDomainData(buf: Float32Array) {
        if (FakeAnalyserAudioContext.frame) buf.set(FakeAnalyserAudioContext.frame);
        else buf.fill(0);
      },
      context: self,
    };
  }
}

function makeTimerDeps() {
  const handlers: Array<() => void> = [];
  return {
    deps: {
      setInterval: (fn: () => void) => {
        handlers.push(fn);
        return handlers.length as any;
      },
      clearInterval: (h: any) => {
        handlers.splice(Number(h) - 1, 1);
      },
    },
    fire: () => handlers.forEach((h) => h()),
    handlerCount: () => handlers.length,
  };
}

test("computeRmsLevel: 正弦波相当の配列から rms/peak を計算する", () => {
  const data = new Float32Array(1024).fill(0.5);
  const lvl = computeRmsLevel(data);
  assert.ok(Math.abs(lvl.rms - 0.5) < 0.001);
  assert.ok(Math.abs(lvl.peak - 0.5) < 0.001);
});

test("computeRmsLevel: 空配列は rms=0", () => {
  assert.equal(computeRmsLevel(new Float32Array(0)).rms, 0);
});

test("start: マイク単独で onStreamLevel('mic') が 100ms polling で呼ばれる", async () => {
  FakeMediaRecorder.instances = [];
  FakeAnalyserAudioContext.frame = new Float32Array(1024).fill(0.25);
  const timer = makeTimerDeps();
  const got: Array<{ source: string; rms: number }> = [];
  const deps = makeDeps({
    AudioContextCtor: FakeAnalyserAudioContext as unknown as typeof AudioContext,
    onStreamLevel: (source, level) => got.push({ source, rms: level.rms }),
    ...timer.deps,
  } as any);
  const r = new DirectRecorder(deps);
  assert.equal(await r.start(settings), true);
  timer.fire();
  assert.equal(got.length, 1);
  assert.equal(got[0].source, "mic");
  assert.ok(Math.abs(got[0].rms - 0.25) < 0.001);
  await r.stop(settings); // interval が解放される
  assert.equal(timer.handlerCount(), 0);
});

test("start: WASAPI キャプチャの onLevel が onStreamLevel('pc') に中継される", async () => {
  FakeMediaRecorder.instances = [];
  FakeAnalyserAudioContext.frame = new Float32Array(1024).fill(0);
  const timer = makeTimerDeps();
  const registered: Array<(l: any) => void> = [];
  const got: Array<{ source: string; level: any }> = [];
  const deps = makeDeps({
    AudioContextCtor: FakeAnalyserAudioContext as unknown as typeof AudioContext,
    spawnPcLoopbackCapture: async () => ({
      onLevel: (cb: any) => registered.push(cb),
      stop: async () => "C:/pc.wav",
    }),
    onStreamLevel: (source, level) => got.push({ source, level }),
    ...timer.deps,
  } as any);
  // audioSource=pcLoopback 単独は MediaRecorder を使わないため mix 設定にする
  const mixSettings = { ...settings, audioSource: "mix" } as unknown as GijiSettings;
  const r = new DirectRecorder(deps);
  assert.equal(await r.start(mixSettings), true);
  assert.equal(registered.length, 1);
  // handle からレベル発火 → deps.onStreamLevel が呼ばれることまで検証
  registered[0]({ rms: 0.4, peak: 0.6 });
  assert.deepEqual(got, [{ source: "pc", level: { rms: 0.4, peak: 0.6 } }]);
  await r.stop(settings);
  assert.equal(timer.handlerCount(), 0);
});

test("registerLevelListener: 後から登録したリスナーにも通知される", async () => {
  FakeMediaRecorder.instances = [];
  FakeAnalyserAudioContext.frame = new Float32Array(1024).fill(0.25);
  const timer = makeTimerDeps();
  const got: string[] = [];
  const deps = makeDeps({
    AudioContextCtor: FakeAnalyserAudioContext as unknown as typeof AudioContext,
    ...timer.deps,
  } as any);
  const r = new DirectRecorder(deps);
  r.registerLevelListener((source) => got.push(source));
  assert.equal(await r.start(settings), true);
  timer.fire();
  assert.deepEqual(got, ["mic"]);
  await r.stop(settings);
});

// ---- v0.15.1: webm フォーマット ----

test("stop: format=webm でマイクのみ → ffmpeg を介さず webm を直接保存", async () => {
  FakeMediaRecorder.instances = [];
  let ffmpegCalled = false;
  const written: string[] = [];
  const deps = makeDeps({
    ffmpeg: async () => { ffmpegCalled = true; },
    writeFile: async (p: string) => { written.push(p); },
  } as any);
  const r = new DirectRecorder(deps);
  await r.start(settings);
  const result = await r.stop({ ...settings, recordingFormat: "webm" } as unknown as GijiSettings);
  assert.ok(result);
  assert.equal(basename(result!.audioPaths[0]).endsWith(".webm"), true);
  assert.equal(ffmpegCalled, false, "webm は変換不要");
  assert.equal(written.length, 1);
});

test("stop: format=webm で mic+PC → libopus で webm 出力（一時ファイル名も分離）", async () => {
  FakeMediaRecorder.instances = [];
  const argsLog: string[][] = [];
  const written: string[] = [];
  const deps = makeDeps({
    getDisplayMedia: async () => {
      throw new Error("Not supported");
    },
    spawnPcLoopbackCapture: async () => ({
      onLevel: () => {},
      stop: async () => "C:/pc.wav",
    }),
    ffmpeg: async (args: string[]) => { argsLog.push(args); },
    writeFile: async (p: string) => { written.push(p); },
  } as any);
  const mixSettings = { ...settings, audioSource: "mix" } as unknown as GijiSettings;
  const r = new DirectRecorder(deps);
  await r.start(mixSettings);
  const result = await r.stop({ ...settings, audioSource: "mix", recordingFormat: "webm" } as unknown as GijiSettings);
  assert.ok(result);
  assert.equal(basename(result!.audioPaths[0]).endsWith(".webm"), true);
  assert.equal(argsLog.length, 1, "ffmpeg で mix する");
  const args = argsLog[0];
  assert.ok(args.includes("libopus"), "webm は libopus エンコード");
  assert.equal(written.length, 1);
  assert.ok(basename(written[0]).endsWith(".mic.webm"), "出力と同じ .webm を避けるため一時名を分離");
});
