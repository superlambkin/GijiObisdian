import { Notice } from "obsidian";
import { spawn as nodeSpawn } from "child_process";
import { readFileSync, writeFile as fsWriteFile, unlink as fsUnlink } from "fs";
import { tmpdir } from "os";
import { extname, join } from "path";
import { App } from "obsidian";
import { GijiSettings, RecordingFormat } from "../settings";
import { buildRecordingFileName } from "./recorder";
import { ensureFfmpegLoaded } from "./ffmpegConvert";
import { writeDebugLog } from "../util/debugLog";

export interface DirectRecordResult {
  audioPaths: string[];
  wavPath?: string;
  durationSec: number;
  startTime?: Date;
  warning?: string;
}

/** v0.11: WASAPI ループバック PC 音声キャプチャのハンドル。stop() で WAV パスを返す */
export interface PcLoopbackCaptureHandle {
  stop(): Promise<string>;
  /** v0.15: stdout レベルイベント（JSON 行）の購読。複数回呼ぶと全リスナーに通知 */
  onLevel(cb: PcLevelListener): void;
}

/** v0.13: PC キャプチャ subprocess の診断ログ出力（既定実装は debug log に書き込み） */
export type PcLoopbackLogFn = (stage: string, data?: Record<string, unknown>) => Promise<void>;

/** v0.15: PC 音声（WASAPI）の入力レベル。rms/peak は -1..1 正規化振幅 */
export type PcLevel = { rms: number; peak: number };

/** v0.15: レベルイベントの購読コールバック */
export type PcLevelListener = (level: PcLevel) => void;

/**
 * v0.15: Python stdout の行バッファリング + レベル JSON 行パーサ。
 * 改行で分割し、`{"type":"level","rms":...,"peak":...}` 形式のみ onLevel へ通知する。
 * それ以外の行は onOther（診断ログ用）へ渡す。改行がこない壊れた出力に備え、
 * バッファが 64KB を超えたら先頭を破棄する。
 */
export class LevelLineParser {
  private buffer = "";

  constructor(
    private onLevel: PcLevelListener,
    private onOther?: (line: string) => void
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 65536) {
      // 1 行が 64KB 超は明らかに異常出力のため全廃棄（末尾だけ残すと次の正規行と結合して壊れる）
      this.buffer = "";
    }
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const obj = JSON.parse(trimmed) as {
        type?: string;
        rms?: unknown;
        peak?: unknown;
      };
      if (
        obj?.type === "level" &&
        typeof obj.rms === "number" &&
        typeof obj.peak === "number"
      ) {
        this.onLevel({ rms: obj.rms, peak: obj.peak });
        return;
      }
    } catch {
      // JSON でない行 → 診断ログへ
    }
    this.onOther?.(line);
  }
}

export interface DirectRecorderDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** v0.8.6: PC 音声（システム音）キャプチャ用。画面共有ダイアログを伴う */
  getDisplayMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
  MediaRecorderCtor?: typeof MediaRecorder;
  /** v0.8.6: マイク + PC 音声をミックスする AudioContext（テスト DI 用） */
  AudioContextCtor?: typeof AudioContext;
  writeFile?: (path: string, data: ArrayBuffer) => Promise<void>;
  deleteFile?: (path: string) => Promise<void>;
  ffmpeg?: (args: string[]) => Promise<void>;
  /** v0.11: PC 音声（WASAPI ループバック）をサブプロセスでキャプチャする。不可なら null */
  spawnPcLoopbackCapture?: (
    outPath: string,
    speakerDeviceId: string,
    scriptDir: string,
    /** v0.13: サブプロセスの stderr/stdout/exit code を記録する診断ロガー */
    log?: PcLoopbackLogFn,
    /** v0.15: true で --monitor モード（WAV 書き出しなし・レベル出力のみ）。入力テスト用 */
    monitor?: boolean,
    /** v0.15.1: スピーカー表示名（ID が解決できない場合の Python 側解決ヒント） */
    speakerName?: string
  ) => Promise<PcLoopbackCaptureHandle | null>;
  /** v0.15: 録音中の入力レベル通知先（mic/pc）。未指定なら通知しない */
  onStreamLevel?: (source: "mic" | "pc", level: PcLevel) => void;
  /** v0.15: レベル polling 用タイマー（テスト DI 用） */
  setInterval?: (handler: () => void, timeout?: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

/** v0.15: time domain データから RMS/peak を計算する（無音=0） */
export function computeRmsLevel(data: Float32Array): PcLevel {
  if (data.length === 0) return { rms: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    sum += v * v;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
  }
  return { rms: Math.sqrt(sum / data.length), peak };
}

export const defaultGetUserMedia = (constraints: MediaStreamConstraints): Promise<MediaStream> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error("MediaDevices API がありません"));
  }
  return navigator.mediaDevices.getUserMedia(constraints);
};

const defaultGetDisplayMedia = (constraints: MediaStreamConstraints): Promise<MediaStream> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    return Promise.reject(new Error("getDisplayMedia API がありません"));
  }
  return navigator.mediaDevices.getDisplayMedia(constraints);
};

const defaultEnumerateDevices = (): Promise<MediaDeviceInfo[]> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return Promise.reject(new Error("MediaDevices API がありません"));
  }
  return navigator.mediaDevices.enumerateDevices();
};

const defaultWriteFile = (path: string, data: ArrayBuffer): Promise<void> =>
  new Promise((resolve, reject) => {
    fsWriteFile(path, Buffer.from(data), (err) => (err ? reject(err) : resolve()));
  });

const defaultDeleteFile = (path: string): Promise<void> =>
  new Promise((resolve, reject) => {
    fsUnlink(path, (err) => (err ? reject(err) : resolve()));
  });

/** wasm FFmpeg の exec 用に書き換えた引数・ホストパス↔仮想パスの対応 */
export interface WasmFfmpegRewrite {
  execArgs: string[];
  inputs: { hostPath: string; virtualName: string }[];
  output: { hostPath: string; virtualName: string };
}

/**
 * ホストパス混在の ffmpeg CLI 引数を、@ffmpeg/ffmpeg の MEMFS（仮想 FS）用に書き換える。
 *
 * - `-i` の直後の値（入力ホストパス）を `input-N<ext>` へ置換（出現順を維持）
 * - 末尾の出力パスを `output<ext>` へ置換（末尾がフラグの場合はその手前を出力とする）
 * - それ以外のフラグ・フィルタ（`-filter_complex` / `amix` 等）は不変で維持
 */
export function rewriteFfmpegArgsForWasm(args: string[]): WasmFfmpegRewrite {
  const inputs: { hostPath: string; virtualName: string }[] = [];
  const execArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-i" && i + 1 < args.length) {
      const hostPath = args[i + 1];
      const virtualName = `input-${inputs.length}${extname(hostPath)}`;
      inputs.push({ hostPath, virtualName });
      execArgs.push("-i", virtualName);
      i++; // 入力値は処理済み
    } else {
      execArgs.push(args[i]);
    }
  }
  let outputIndex = execArgs.length - 1;
  if (outputIndex >= 0 && execArgs[outputIndex].startsWith("-")) {
    outputIndex -= 1; // `-f` など末尾フラグの手前が出力パス
  }
  if (outputIndex < 0 || execArgs[outputIndex].startsWith("-")) {
    throw new Error("ffmpeg 出力パスを特定できません");
  }
  const hostOutput = execArgs[outputIndex];
  const virtualOutput = `output${extname(hostOutput)}`;
  execArgs[outputIndex] = virtualOutput;
  return {
    execArgs,
    inputs,
    output: { hostPath: hostOutput, virtualName: virtualOutput },
  };
}

/**
 * wasm FFmpeg ラッパー: ホストパスを MEMFS に読み込み exec 後に結果をホストへ書き戻す。
 * ffmpegConvert のロード済みインスタンスを再利用する（ensureFfmpegLoaded）。
 */
const defaultFfmpeg = async (args: string[]): Promise<void> => {
  const ff = await ensureFfmpegLoaded();
  const { execArgs, inputs, output } = rewriteFfmpegArgsForWasm(args);
  for (const input of inputs) {
    const bytes = readFileSync(input.hostPath);
    await ff.writeFile(input.virtualName, new Uint8Array(bytes));
  }
  try {
    await ff.exec(execArgs);
    const data = await ff.readFile(output.virtualName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
    await new Promise<void>((resolve, reject) => {
      fsWriteFile(output.hostPath, Buffer.from(bytes), (err) => (err ? reject(err) : resolve()));
    });
  } finally {
    await Promise.allSettled([
      ...inputs.map((input) => ff.deleteFile(input.virtualName)),
      ff.deleteFile(output.virtualName),
    ]);
  }
};

/**
 * v0.11: WASAPI ループバックで PC 音声をキャプチャするサブプロセスを起動する。
 *
 * - `scriptDir/pc_loopback_capture.py` を venv Python で起動する（無ければ python / py）。
 * - 終了は `child.stdin.end()`（stdin EOF を検知 → WAV 書き出し → プロセス終了）。
 * - 起動できない場合は null を返し、呼び出し側でマイクのみへフォールバックする。
 *
 * v0.13: `log` が渡された場合、spawn / stderr / stdout / exit code / spawn error を記録する
 * （実機で Python 側クラッシュ原因を観測するため）。省略可。
 */
/**
 * v0.13.1: scriptDir が相対パスの場合、`app.vault.adapter.basePath`（Vault ルート）と
 * 結合して絶対パス化する。
 *
 * 背景: Electron 環境では `Plugin.manifest.dir` は **相対パス**（例: `.obsidian/plugins/GijiObsidian`）
 * を返し、Node プロセスの cwd は Obsidian バイナリの場所
 * （`C:\...\Programs\Obsidian\`）になる。相対パスをそのまま使うと存在しないパス
 * （`C:\...\Programs\Obsidian\.obsidian\plugins\GijiObsidian\...`）を解決しようとして
 * 「[Errno 2] No such file or directory」で Python が即死する。
 *
 * basePath が取得できない環境（モバイル等）ではそのまま返す（best-effort）。
 * 既に絶対パスの場合は二重結合を防ぐためそのまま返す。
 */
export function resolveAbsoluteScriptDir(
  app: unknown,
  scriptDir: string
): string {
  if (!scriptDir) return scriptDir;
  // Windows: ドライブレター始まり / Unix: `/` 始まりなら絶対パス
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(scriptDir) || scriptDir.startsWith("/") || scriptDir.startsWith("\\\\");
  if (isAbsolute) return scriptDir;
  const basePath = (app as { vault?: { adapter?: { basePath?: string } } } | undefined)?.vault
    ?.adapter?.basePath;
  if (basePath) return join(basePath, scriptDir);
  return scriptDir;
}

/**
 * v0.15.1: WASAPI キャプチャの Python 引数を組み立てる。
 * 解決順は Python 側（ID → 名前 → 既定）。speakerDeviceId は Chromium ハッシュの
 * 可能性があるため、speakerName をヒントに渡す。
 */
export function buildLoopbackArgs(
  scriptPath: string,
  outPath: string,
  speakerDeviceId: string,
  monitor: boolean,
  speakerName?: string
): string[] {
  const args = [scriptPath, outPath];
  // "default" は soundcard のデバイスIDではないため、渡さない（Python 側で既定スピーカー使用）
  if (speakerDeviceId && speakerDeviceId !== "default") args.push(speakerDeviceId);
  if (monitor) args.push("--monitor");
  if (speakerName && speakerName.trim()) args.push("--name", speakerName.trim());
  return args;
}

export const defaultSpawnPcLoopbackCapture = async (
  outPath: string,
  speakerDeviceId: string,
  scriptDir: string,
  log: PcLoopbackLogFn = async () => {},
  monitor = false,
  speakerName?: string
): Promise<PcLoopbackCaptureHandle | null> => {
  const scriptPath = scriptDir ? join(scriptDir, "pc_loopback_capture.py") : null;
  if (!scriptPath) return null;

  const args = buildLoopbackArgs(scriptPath, outPath, speakerDeviceId, monitor, speakerName);

  const levelListeners: PcLevelListener[] = [];

  const pythonCandidates = scriptDir
    ? [join(scriptDir, "venv", "Scripts", "python.exe"), "python", "py"]
    : ["python", "py"];

  for (const py of pythonCandidates) {
    try {
      // v0.13: 候補ごとに選択状況と起動コマンドを記録（真因究明用）
      log("spawn_try", { py, args, outPath, scriptDir, monitor });
      const child = nodeSpawn(py, args, {
        // v0.15: stdout を pipe に変更（レベル JSON 行の受信のため。従来は ignore）
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      // v0.15: stdout は行パーサへ。レベル行以外のみ診断ログに流す（レベルは 0.1 秒ごとに来るため全文ログはスパムになる）
      const parser = new LevelLineParser(
        (level) => levelListeners.forEach((cb) => cb(level)),
        (line) => log("stdout", { py, line })
      );
      child.stdout?.on("data", (chunk: Buffer) => {
        parser.push(chunk.toString("utf-8"));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        log("stderr", { py, chunk: chunk.toString("utf-8") });
      });
      child.on("error", (err) => {
        log("spawn_error", { py, message: err.message, code: (err as any).code });
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", () => {
          log("spawn_ok", { py, pid: child.pid });
          resolve();
        });
        child.once("error", (err) => {
          log("spawn_reject", { py, message: err.message });
          reject(err);
        });
      });
      child.on("exit", (code, signal) => {
        log("exit", { py, code, signal });
      });
      return {
        onLevel: (cb: PcLevelListener) => {
          levelListeners.push(cb);
        },
        stop: () =>
          new Promise<string>((resolve) => {
            let settled = false;
            const done = () => {
              if (!settled) {
                settled = true;
                log("stop_resolve", { outPath });
                resolve(outPath);
              }
            };
            child.on("exit", done);
            try {
              child.stdin.end();
              log("stop_stdin_end", { outPath });
            } catch (e: any) {
              log("stop_stdin_end_error", { outPath, message: e?.message });
            }
            // 安全のためのタイムアウト（WAV 書き出しに時間がかかる場合に備える）
            setTimeout(() => {
              log("stop_timeout", { outPath, timeoutMs: 5000 });
              done();
            }, 5000).unref?.();
          }),
      };
    } catch (e: any) {
      // この Python 候補で起動できない → 次の候補へ
      log("spawn_try_fail", { py, message: e?.message });
    }
  }
  log("spawn_all_candidates_failed", { pythonCandidates });
  return null;
};

/**
 * PC ダイレクト録音：Chromium の MediaRecorder でマイク録音 → webm → ffmpeg で MP3 64kbps。
 * ブリッジ（Python）不要。戻り値はブリッジの BridgeStopResult と互換形状。
 * 全 deps はテスト用に DI 可能（既定は実機用）。
 *
 * v0.5: デバイス選択対応。
 *  - `settings.directMicDeviceId` が設定されていれば `getUserMedia({ audio: { deviceId: { exact: id } } })`
 *  - 空文字／未設定なら従来の `{ audio: true }`（システム既定）にフォールバック。
 *  - `enumerateDevices` も DI 可能にして設定画面のデバイス一覧と共有できるようにした。
 */
export class DirectRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startTime = 0;
  private deps: Required<DirectRecorderDeps>;
  /** v0.8.6: mix 用に保持するソースストリーム（stop で解放） */
  private micStream: MediaStream | null = null;
  private pcStream: MediaStream | null = null;
  /** v0.8.6: mix 用 AudioContext（stop で close） */
  private audioCtx: AudioContext | null = null;
  /** v0.11: WASAPI ループバック PC 音声キャプチャのハンドル（getDisplayMedia 不可時のフォールバック） */
  private pcCapture: PcLoopbackCaptureHandle | null = null;
  /** v0.15: 入力レベル計測（AnalyserNode と polling タイマー） */
  private levelAnalysers: {
    source: "mic" | "pc";
    analyser: AnalyserNode;
    buf: Float32Array<ArrayBuffer>;
  }[] = [];
  private levelIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    deps: DirectRecorderDeps = {},
    private app?: App,
    private manifestDir: string = ""
  ) {
    const hasCtor =
      typeof globalThis !== "undefined" &&
      typeof (globalThis as any).MediaRecorder !== "undefined";
    this.deps = {
      getUserMedia: defaultGetUserMedia,
      getDisplayMedia: defaultGetDisplayMedia,
      enumerateDevices: defaultEnumerateDevices,
      MediaRecorderCtor: (hasCtor ? (globalThis as any).MediaRecorder : null) as typeof MediaRecorder,
      AudioContextCtor: null as unknown as typeof AudioContext,
      writeFile: defaultWriteFile,
      deleteFile: defaultDeleteFile,
      ffmpeg: defaultFfmpeg,
      spawnPcLoopbackCapture: defaultSpawnPcLoopbackCapture,
      onStreamLevel: () => {},
      setInterval: (handler, timeout) => setInterval(handler, timeout),
      clearInterval: (handle) => clearInterval(handle),
      ...deps,
    };
  }

  isRecording(): boolean {
    return this.mediaRecorder !== null || this.pcCapture !== null;
  }

  /** v0.8.6: ストリームのトラックを安全に停止（モック等で getTracks が無い場合も安全） */
  private stopTracks(stream: MediaStream | null): void {
    const tracks = stream?.getTracks?.() ?? [];
    for (const t of tracks) {
      try { t.stop(); } catch { /* ignore */ }
    }
  }

  /** v0.8.6: AudioContext を安全に close */
  private closeAudioContext(): void {
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  /** v0.8.6: AudioContext を生成（未対応なら null） */
  private createAudioContext(): AudioContext | null {
    const Ctor = this.deps.AudioContextCtor
      ?? (globalThis as any)?.AudioContext
      ?? (globalThis as any)?.webkitAudioContext;
    return Ctor ? new Ctor() : null;
  }

  /**
   * v0.8.6: マイク + PC 音声をミックスしたストリームを返す。
   * AudioContext 非対応時は null を返す（呼び出し側でフォールバック）。
   */
  private mixStreams(mic: MediaStream, pc: MediaStream): MediaStream | null {
    const ctx = this.createAudioContext();
    if (!ctx) return null;
    try {
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(mic).connect(dest);
      ctx.createMediaStreamSource(pc).connect(dest);
      this.audioCtx = ctx;
      return dest.stream;
    } catch {
      ctx.close().catch(() => {});
      this.audioCtx = null;
      return null;
    }
  }

  /** v0.15: ストリームに AnalyserNode を接続する（ベストエフォート） */
  private attachAnalyser(source: "mic" | "pc", stream: MediaStream, ctx: AudioContext): void {
    try {
      const srcNode = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      srcNode.connect(analyser);
      this.levelAnalysers.push({ source, analyser, buf: new Float32Array(analyser.fftSize) });
    } catch {
      // 計測できないだけ。録音には影響させない
    }
  }

  /**
   * v0.15: 録音中の入力レベル計測を開始する。
   * - mic/pc の renderer 側ストリーム → AnalyserNode + 100ms polling
   * - WASAPI キャプチャ → handle.onLevel の中継
   * AudioContext 非対応でも録音は続行する（計測はベストエフォート）。
   */
  private setupLevelMonitoring(
    mic: MediaStream | null,
    pc: MediaStream | null,
    pcCapture: PcLoopbackCaptureHandle | null
  ): void {
    if (pcCapture) {
      // 旧ハンドル（v0.14 以前の fake / 実装）は onLevel を持たないため防御的に呼ぶ
      pcCapture.onLevel?.((level) => this.deps.onStreamLevel("pc", level));
    }
    const ctx = this.audioCtx ?? this.createAudioContext();
    if (!ctx) return;
    this.audioCtx = ctx;
    if (mic) this.attachAnalyser("mic", mic, ctx);
    if (pc) this.attachAnalyser("pc", pc, ctx);
    if (this.levelAnalysers.length > 0) {
      this.levelIntervalId = this.deps.setInterval(() => this.pollLevels(), 100);
    }
  }

  private pollLevels(): void {
    for (const entry of this.levelAnalysers) {
      try {
        entry.analyser.getFloatTimeDomainData(entry.buf);
        this.deps.onStreamLevel(entry.source, computeRmsLevel(entry.buf));
      } catch {
        // 解放済み等。無視
      }
    }
  }

  private teardownLevelMonitoring(): void {
    if (this.levelIntervalId !== null) {
      this.deps.clearInterval(this.levelIntervalId);
      this.levelIntervalId = null;
    }
    this.levelAnalysers = [];
  }

  /** v0.15: 録音中レベルの追加リスナー登録（deps.onStreamLevel とは独立・複数登録可） */
  registerLevelListener(cb: (source: "mic" | "pc", level: PcLevel) => void): void {
    const prev = this.deps.onStreamLevel;
    this.deps.onStreamLevel = (source, level) => {
      prev(source, level);
      cb(source, level);
    };
  }

  async start(settings: GijiSettings): Promise<boolean> {
    if (this.isRecording()) return true;
    const audioSource = settings.audioSource ?? "mic";
    const micId = (settings.directMicDeviceId || "").trim();
    const wantMic = audioSource === "mic" || audioSource === "mix";
    const wantPc = audioSource === "pcLoopback" || audioSource === "mix";
    try {
      // 1) マイクストリーム
      let micStream: MediaStream | null = null;
      if (wantMic) {
        const constraints: MediaStreamConstraints = micId
          ? { audio: { deviceId: { exact: micId } } }
          : { audio: true };
        micStream = await this.deps.getUserMedia(constraints);
      }

      // 2) PC 音声ストリーム（getDisplayMedia → 不可なら WASAPI ループバック）
      let pcStream: MediaStream | null = null;
      let pcCapture: PcLoopbackCaptureHandle | null = null;
      if (wantPc) {
        // 2a) getDisplayMedia（画面共有ダイアログ）を試行
        if (typeof this.deps.getDisplayMedia === "function") {
          try {
            pcStream = await this.deps.getDisplayMedia({ video: true, audio: true });
          } catch (pcErr) {
            console.warn("[cb-direct] getDisplayMedia failed:", pcErr);
            pcStream = null;
          }
        }
        // 2b) 失敗時: WASAPI ループバック（pc_loopback_capture.py）へフォールバック
        if (!pcStream) {
          try {
            const pcWavPath = join(tmpdir(), `giji_pc_${Date.now()}.wav`);
            // v0.13.1: manifestDir が相対パスの場合は Vault basePath と結合して絶対パス化する
            const rawScriptDir = settings.pcLoopbackScriptDir || this.manifestDir || "";
            const scriptDir = resolveAbsoluteScriptDir(this.app, rawScriptDir);
            pcCapture = await this.deps.spawnPcLoopbackCapture(
              pcWavPath,
              settings.directSpeakerDeviceId || "",
              scriptDir,
              // v0.13: サブプロセスの spawn / stderr / stdout / exit code を debug log に流す
              async (stage, data) => {
                await writeDebugLog(
                  this.app,
                  this.manifestDir,
                  `[${new Date().toISOString()}] stage=pc_loopback event=${stage} ${JSON.stringify(data || {})}`
                ).catch(() => {});
              },
              // v0.15: 入力テストでは --monitor モード（レベル出力のみ）
              false,
              // v0.15.1: ID が解決できない場合の解決ヒント（表示名）
              settings.directSpeakerDeviceName || undefined
            );
          } catch (e) {
            console.warn("[cb-direct] WASAPI loopback spawn failed:", e);
            pcCapture = null;
          }
        }
        // 2c) 両方失敗
        if (!pcStream && !pcCapture) {
          if (micStream) {
            new Notice("⚠️ PC 音声は録音できません。マイクのみで録音します");
          } else {
            throw new Error("PC 音声キャプチャに失敗しました");
          }
        }
      }

      // 3) 録音ストリームの決定
      let recordStream: MediaStream | null = null;
      const pcHasAudio = (pcStream?.getAudioTracks?.().length ?? 0) > 0;
      if (micStream && pcStream && pcHasAudio) {
        const mixed = this.mixStreams(micStream, pcStream);
        if (mixed) {
          recordStream = mixed;
        } else {
          // AudioContext 非対応: マイク優先（PC 音声は諦める）
          new Notice("⚠️ この環境は音声ミックスに対応していません。マイクのみ録音します");
          recordStream = micStream;
          this.stopTracks(pcStream);
          pcStream = null;
        }
      } else if (micStream && pcStream && !pcHasAudio) {
        // v0.8.7: 画面共有で音声が無効（「タブの音声」未選択）→ PC 音声なしでマイクのみ録音
        new Notice("⚠️ 画面共有で「タブの音声」が選択されていません。マイクのみで録音します");
        recordStream = micStream;
        this.stopTracks(pcStream);
        pcStream = null;
      } else if (micStream) {
        // getDisplayMedia 失敗 + WASAPI キャプチャ中は、マイクのみ MediaRecorder で録音
        recordStream = micStream;
      } else if (pcStream) {
        recordStream = pcStream;
      }
      // pcCapture のみ（pcLoopback + WASAPI）の場合は MediaRecorder を使わない

      this.micStream = micStream;
      this.pcStream = pcStream;
      this.pcCapture = pcCapture;
      // v0.15: 入力レベル計測（ベストエフォート）
      this.setupLevelMonitoring(micStream, pcStream, pcCapture);

      if (recordStream) {
        if (!this.deps.MediaRecorderCtor) {
          new Notice("⚠️ この環境は PC ダイレクト録音に対応していません");
          this.stopTracks(micStream);
          this.stopTracks(pcStream);
          this.closeAudioContext();
          if (pcCapture) {
            pcCapture.stop().catch(() => {});
          }
          this.micStream = this.pcStream = this.pcCapture = null;
          return false;
        }
        const rec = new this.deps.MediaRecorderCtor(recordStream, {
          mimeType: "audio/webm;codecs=opus",
        });
        this.chunks = [];
        rec.ondataavailable = (ev: BlobEvent) => {
          if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
        };
        rec.start();
        this.mediaRecorder = rec;
      }
      this.startTime = Date.now();
      await writeDebugLog(
        this.app,
        this.manifestDir,
        `[${new Date().toISOString()}] stage=getusermedia mode=direct audio_source=${audioSource} device_id=${micId || "(default)"} status=ok`
      ).catch(() => {});
      return true;
    } catch (err: any) {
      // 失敗時は取得済みストリームとキャプチャを解放
      this.teardownLevelMonitoring();
      this.stopTracks(this.micStream);
      this.stopTracks(this.pcStream);
      this.closeAudioContext();
      if (this.pcCapture) {
        this.pcCapture.stop().catch(() => {});
        this.pcCapture = null;
      }
      this.micStream = this.pcStream = null;
      await writeDebugLog(
        this.app,
        this.manifestDir,
        `[${new Date().toISOString()}] stage=getusermedia mode=direct audio_source=${audioSource} device_id=${micId || "(default)"} status=fail error="${(err?.message || "").replace(/"/g, "'")}"`
      ).catch(() => {});
      new Notice(`⚠️ 録音デバイスにアクセスできません: ${err?.message ?? err}`);
      this.mediaRecorder = null;
      return false;
    }
  }

  async stop(settings: GijiSettings): Promise<DirectRecordResult | null> {
    const rec = this.mediaRecorder;
    const pcCapture = this.pcCapture;
    if (!rec && !pcCapture) return null;
    // chunks は this.chunks と同じ配列を参照する。stop() 後の最終
    // ondataavailable フラッシュが完了してから確定するため、
    // this.chunks の差し替えはフラッシュ完了後に行う（先に空配列へ
    // 差し替えると最終チャンクが欠落する）。
    const chunks = this.chunks;
    const startTime = this.startTime;
    this.mediaRecorder = null;
    this.pcCapture = null;

    // v0.8.6: 録音終了後、ソースストリーム（マイク / PC 音声）と AudioContext を解放
    const releaseSources = (): void => {
      this.teardownLevelMonitoring();
      this.stopTracks(this.micStream);
      this.stopTracks(this.pcStream);
      this.closeAudioContext();
      this.micStream = this.pcStream = null;
    };

    try {
      // 1) MediaRecorder（マイク）を停止 → webm データ
      let webmArrayBuf: ArrayBuffer | null = null;
      if (rec) {
        // stop() 後、最終 ondataavailable のフラッシュが終わってから onstop が発火する
        await new Promise<void>((resolve) => {
          rec.onstop = () => resolve();
          rec.stop();
        });
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        webmArrayBuf = await blob.arrayBuffer();
      }
      releaseSources();
      this.chunks = []; // 次セッション用リセット（chunks は確定済み）

      // 2) WASAPI PC 音声キャプチャを停止 → WAV パス
      let pcWavPath: string | null = null;
      if (pcCapture) {
        try {
          pcWavPath = await pcCapture.stop();
        } catch (e) {
          console.warn("[cb-direct] WASAPI capture stop failed:", e);
          pcWavPath = null;
        }
      }

      const startedAt = new Date(startTime);
      const base = (settings.recordingFileNameTemplate || "").trim()
        ? buildRecordingFileName(startedAt, settings.recordingFileNameTemplate)
        : `giji_${startTime}`;
      const outDir = (settings.recordingSaveDir || "").trim() || tmpdir();
      const webmPath = join(outDir, `${base}.webm`);
      const mp3Path = join(outDir, `${base}.mp3`);
      const wavPath = join(outDir, `${base}.wav`);
      const durationSec = (Date.now() - startTime) / 1000;

      // v0.12.1: 録音ファイルの出力形式を選択（既定 mp3 = 既存挙動と互換）
      const format: RecordingFormat = (settings.recordingFormat ?? "mp3") as RecordingFormat;
      const outputPath = format === "wav" ? wavPath : mp3Path;
      /** MP3 エンコーダ用フラグ群（既存挙動） */
      const mp3EncoderFlags = ["-codec:a", "libmp3lame", "-b:a", "64k", "-write_xing", "0"];
      /** WAV（PCM 16kHz モノラル）エンコーダ用フラグ群 */
      const wavEncoderFlags = ["-c:a", "pcm_s16le", "-ac", "1", "-ar", "16000"];
      const encoderFlags = format === "wav" ? wavEncoderFlags : mp3EncoderFlags;

      // 3) 出力生成（mic + PC ミックス / マイクのみ / PC のみ）
      if (webmArrayBuf && pcWavPath) {
        // マイク(webm) + PC(wav) をミックスして出力（mp3 or wav）を生成
        await this.deps.writeFile(webmPath, webmArrayBuf);
        try {
          await this.deps.ffmpeg([
            "-y",
            "-i", webmPath,
            "-i", pcWavPath,
            "-filter_complex",
            "[0:a]aresample=16000,pan=mono|c0=c0[mic];[1:a]aresample=16000,pan=mono|c0=c0[pc];[mic][pc]amix=inputs=2:duration=longest:dropout_transition=0",
            ...encoderFlags,
            outputPath,
          ]);
          await this.deps.deleteFile(webmPath);
          await this.deps.deleteFile(pcWavPath).catch(() => {});
          return { audioPaths: [outputPath], wavPath: outputPath, durationSec, startTime: new Date(startTime) };
        } catch {
          // 明示的フォールバック：webm と pc wav を両方残す
          return {
            audioPaths: [webmPath, pcWavPath],
            wavPath: webmPath,
            durationSec,
            startTime: new Date(startTime),
            warning: "encode_failed",
          };
        }
      }

      if (webmArrayBuf) {
        // マイクのみ webm → 出力（mp3 or wav）
        await this.deps.writeFile(webmPath, webmArrayBuf);
        try {
          await this.deps.ffmpeg([
            "-y",
            "-i", webmPath,
            ...encoderFlags,
            outputPath,
          ]);
          await this.deps.deleteFile(webmPath);
          return { audioPaths: [outputPath], wavPath: outputPath, durationSec, startTime: new Date(startTime) };
        } catch {
          // 明示的フォールバック：webm のまま残す
          return { audioPaths: [webmPath], wavPath: webmPath, durationSec, startTime: new Date(startTime), warning: "encode_failed" };
        }
      }

      if (pcWavPath) {
        // PC 音声のみ wav → 出力（mp3 or wav）
        try {
          await this.deps.ffmpeg([
            "-y",
            "-i", pcWavPath,
            ...encoderFlags,
            outputPath,
          ]);
          await this.deps.deleteFile(pcWavPath).catch(() => {});
          return { audioPaths: [outputPath], wavPath: outputPath, durationSec, startTime: new Date(startTime) };
        } catch {
          return { audioPaths: [pcWavPath], wavPath: pcWavPath, durationSec, startTime: new Date(startTime), warning: "encode_failed" };
        }
      }

      return null;
    } catch (err: any) {
      new Notice(`⚠️ 録音の停止に失敗しました: ${err?.message ?? err}`);
      return null;
    }
  }
}
