import type { App } from "obsidian";
import { join } from "path";
import { tmpdir } from "os";
import type { GijiSettings } from "../settings";
import {
  DirectRecorderDeps,
  PcLevel,
  PcLoopbackCaptureHandle,
  computeRmsLevel,
  defaultGetUserMedia,
  defaultSpawnPcLoopbackCapture,
  resolveAbsoluteScriptDir,
} from "./directRecorder";
import { ensurePythonDeps } from "./pythonDeps";
import type { LevelMeter } from "../ui/levelMeter";

export interface LevelMonitorDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  AudioContextCtor?: typeof AudioContext;
  spawnPcLoopbackCapture?: DirectRecorderDeps["spawnPcLoopbackCapture"];
  setInterval?: (handler: () => void, timeout?: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
  now?: () => number;
  /** 録音中は true を返す。録音中の入力テスト開始は録音を優先して拒否する */
  isRecording?: () => boolean;
  /** v0.15.1: パッケージ自動導入の進行通知（呼び出し側が Notice へ変換） */
  onNotice?: (message: string) => void;
}

/** PC レベルの無応答判定閾値（ms） */
const PC_LEVEL_TIMEOUT_MS = 3000;
/** レベル polling 周期（ms） */
const POLL_INTERVAL_MS = 100;

/**
 * v0.15: 録音前入力チェック。マイク（AnalyserNode）と PC 音声
 * （Python pc_loopback_capture.py --monitor の stdout レベル行）を
 * ステータスバーの LevelMeter に流す。録音パイプラインとは独立した
 * 単独プロセス / 単独ストリームで動く。
 */
export class LevelMonitor {
  private running = false;
  private micStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: { node: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null;
  private pcHandle: PcLoopbackCaptureHandle | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastPcLevelAt = 0;
  private deps: Required<
    Pick<LevelMonitorDeps, "setInterval" | "clearInterval" | "now">
  > & LevelMonitorDeps;

  constructor(
    private app?: App,
    private manifestDir: string = "",
    private meter?: LevelMeter,
    deps: LevelMonitorDeps = {}
  ) {
    this.deps = {
      // v0.15.1: 実機用デフォルト。未指定だと「バーは出るが何も測れない」状態になるため
      // （v0.15.0 回帰: main.ts は isRecording しか渡さない）
      getUserMedia: deps.getUserMedia ?? defaultGetUserMedia,
      AudioContextCtor:
        deps.AudioContextCtor ??
        (globalThis as any)?.AudioContext ??
        (globalThis as any)?.webkitAudioContext,
      spawnPcLoopbackCapture: deps.spawnPcLoopbackCapture ?? defaultSpawnPcLoopbackCapture,
      setInterval: deps.setInterval ?? ((handler, timeout) => setInterval(handler, timeout)),
      clearInterval: deps.clearInterval ?? ((handle) => clearInterval(handle)),
      now: deps.now ?? (() => Date.now()),
      ...deps,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(settings: GijiSettings): Promise<boolean> {
    if (this.running) return true;
    // 録音中は録音を優先（呼び出し側が Notice を出す）
    if (this.deps.isRecording?.()) return false;

    // 1) マイクストリーム（DirectRecorder と同じ制約）
    const micId = (settings.directMicDeviceId || "").trim();
    const constraints: MediaStreamConstraints = micId
      ? { audio: { deviceId: { exact: micId } } }
      : { audio: true };
    this.micStream = (await this.deps.getUserMedia?.(constraints)) ?? null;

    // 2) マイク AnalyserNode（ベストエフォート）
    const Ctor =
      this.deps.AudioContextCtor ??
      (globalThis as any)?.AudioContext ??
      (globalThis as any)?.webkitAudioContext;
    if (Ctor && this.micStream) {
      try {
        const ctx: AudioContext = new Ctor();
        const srcNode = ctx.createMediaStreamSource(this.micStream);
        const node = ctx.createAnalyser();
        node.fftSize = 1024;
        srcNode.connect(node);
        this.audioCtx = ctx;
        this.analyser = { node, buf: new Float32Array(node.fftSize) };
      } catch {
        this.analyser = null;
      }
    }

    // 3) Python --monitor 起動（WAV 書き出しなし・レベル出力のみ）
    const outPath = join(tmpdir(), `giji_pc_mon_${this.deps.now()}.wav`);
    const scriptDir = resolveAbsoluteScriptDir(
      this.app,
      settings.pcLoopbackScriptDir || this.manifestDir || ""
    );
    // v0.15.1: numpy/soundcard が無ければ pylibs へ自動導入（初回のみ・案A）
    await ensurePythonDeps(scriptDir, { onNotice: (m) => this.deps.onNotice?.(m) });
    this.pcHandle =
      (await this.deps.spawnPcLoopbackCapture?.(
        outPath,
        settings.directSpeakerDeviceId || "",
        scriptDir,
        undefined,
        true,
        settings.directSpeakerDeviceName || undefined
      )) ?? null;
    this.lastPcLevelAt = this.deps.now();
    this.pcHandle?.onLevel((level: PcLevel) => {
      this.lastPcLevelAt = this.deps.now();
      this.meter?.setLevel("pc", level);
    });

    // 4) polling 開始
    this.intervalId = this.deps.setInterval(() => this.poll(), POLL_INTERVAL_MS);
    this.meter?.show();
    this.running = true;
    return true;
  }

  private poll(): void {
    if (this.analyser) {
      try {
        this.analyser.node.getFloatTimeDomainData(this.analyser.buf);
        this.meter?.setLevel("mic", computeRmsLevel(this.analyser.buf));
      } catch {
        // 解放済み等。無視
      }
    }
    // レビュー指摘: Python が起動できなかった場合（pcHandle === null）も灰色表示にする
    if (this.deps.now() - this.lastPcLevelAt > PC_LEVEL_TIMEOUT_MS) {
      this.meter?.setUnavailable("pc");
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalId !== null) {
      this.deps.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    const tracks = this.micStream?.getTracks?.() ?? [];
    for (const t of tracks) {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    }
    this.micStream = null;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.analyser = null;
    if (this.pcHandle) {
      this.pcHandle.stop().catch(() => {});
      this.pcHandle = null;
    }
    this.meter?.hide();
  }
}
