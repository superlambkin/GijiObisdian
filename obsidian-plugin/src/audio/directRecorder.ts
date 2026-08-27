import { Notice } from "obsidian";
import { execFile as nodeExecFile } from "child_process";
import { writeFile as fsWriteFile, unlink as fsUnlink } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { App } from "obsidian";
import { GijiSettings } from "../settings";
import { buildRecordingFileName } from "./recorder";
import { writeDebugLog } from "../util/debugLog";

export interface DirectRecordResult {
  audioPaths: string[];
  wavPath?: string;
  durationSec: number;
  startTime?: Date;
  warning?: string;
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
}

const defaultGetUserMedia = (constraints: MediaStreamConstraints): Promise<MediaStream> => {
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

const defaultFfmpeg = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    nodeExecFile("ffmpeg", args, (err) => (err ? reject(err) : resolve()));
  });

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
      ...deps,
    };
  }

  isRecording(): boolean {
    return this.mediaRecorder !== null;
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

  async start(settings: GijiSettings): Promise<boolean> {
    if (this.isRecording()) return true;
    const audioSource = settings.audioSource ?? "mic";
    const micId = (settings.directMicDeviceId || "").trim();
    const wantMic = audioSource === "mic" || audioSource === "mix";
    const wantPc = audioSource === "pcLoopback" || audioSource === "mix";
    try {
      if (!this.deps.MediaRecorderCtor) {
        new Notice("⚠️ この環境は PC ダイレクト録音に対応していません");
        return false;
      }

      // 1) マイクストリーム
      let micStream: MediaStream | null = null;
      if (wantMic) {
        const constraints: MediaStreamConstraints = micId
          ? { audio: { deviceId: { exact: micId } } }
          : { audio: true };
        micStream = await this.deps.getUserMedia(constraints);
      }

      // 2) PC 音声ストリーム（getDisplayMedia = 画面共有ダイアログ）
      let pcStream: MediaStream | null = null;
      if (wantPc) {
        if (typeof this.deps.getDisplayMedia !== "function") {
          new Notice("⚠️ この環境は PC 音声キャプチャ（画面共有）に対応していません");
          micStream?.getTracks().forEach((t) => t.stop());
          return false;
        }
        try {
          pcStream = await this.deps.getDisplayMedia({ video: true, audio: true });
        } catch (pcErr) {
          // v0.8.7: PC 音声（画面共有）の取得に失敗しても、マイクがあればマイクのみで録音を継続。
          // pcLoopback はマイクが無いため全体失敗。
          if (micStream) {
            const reason =
              (pcErr as Error)?.name === "NotAllowedError"
                ? "画面共有がキャンセルされました"
                : `画面共有の取得に失敗しました（${(pcErr as Error)?.message ?? pcErr}）`;
            new Notice(`⚠️ PC 音声は録音できません（${reason}）。マイクのみで録音します`);
            console.warn("[cb-direct] getDisplayMedia failed, fallback to mic-only:", pcErr);
            pcStream = null;
          } else {
            throw pcErr;
          }
        }
      }

      // 3) 録音ストリームの決定
      let recordStream: MediaStream;
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
      } else if (pcStream) {
        recordStream = pcStream;
      } else {
        recordStream = micStream!;
      }

      this.micStream = micStream;
      this.pcStream = pcStream;

      const rec = new this.deps.MediaRecorderCtor(recordStream, {
        mimeType: "audio/webm;codecs=opus",
      });
      this.chunks = [];
      rec.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
      };
      rec.start();
      this.mediaRecorder = rec;
      this.startTime = Date.now();
      await writeDebugLog(
        this.app,
        this.manifestDir,
        `[${new Date().toISOString()}] stage=getusermedia mode=direct audio_source=${audioSource} device_id=${micId || "(default)"} status=ok`
      ).catch(() => {});
      return true;
    } catch (err: any) {
      // 失敗時は取得済みストリームを解放
      this.stopTracks(this.micStream);
      this.stopTracks(this.pcStream);
      this.closeAudioContext();
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
    if (!rec) return null;
    // chunks は this.chunks と同じ配列を参照する。stop() 後の最終
    // ondataavailable フラッシュが完了してから確定するため、
    // this.chunks の差し替えはフラッシュ完了後に行う（先に空配列へ
    // 差し替えると最終チャンクが欠落する）。
    const chunks = this.chunks;
    const startTime = this.startTime;
    this.mediaRecorder = null;

    // v0.8.6: 録音終了後、ソースストリーム（マイク / PC 音声）と AudioContext を解放
    const releaseSources = (): void => {
      this.stopTracks(this.micStream);
      this.stopTracks(this.pcStream);
      this.closeAudioContext();
      this.micStream = this.pcStream = null;
    };

    try {
      // stop() 後、最終 ondataavailable のフラッシュが終わってから onstop が発火する
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
      releaseSources();
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      const arrayBuf = await blob.arrayBuffer();
      this.chunks = []; // 次セッション用リセット（chunks は確定済み）
      const startedAt = new Date(startTime);
      const base = (settings.recordingFileNameTemplate || "").trim()
        ? buildRecordingFileName(startedAt, settings.recordingFileNameTemplate)
        : `giji_${startTime}`;
      const outDir = (settings.recordingSaveDir || "").trim() || tmpdir();
      const webmPath = join(outDir, `${base}.webm`);
      const mp3Path = join(outDir, `${base}.mp3`);
      await this.deps.writeFile(webmPath, arrayBuf);
      const durationSec = (Date.now() - startTime) / 1000;

      try {
        await this.deps.ffmpeg([
          "-y",
          "-i", webmPath,
          "-codec:a", "libmp3lame",
          "-b:a", "64k",
          "-write_xing", "0",
          mp3Path,
        ]);
        await this.deps.deleteFile(webmPath);
        return { audioPaths: [mp3Path], wavPath: mp3Path, durationSec, startTime: new Date(startTime) };
      } catch {
        // 明示的フォールバック：webm のまま残す（ブリッジの warning 文字列と同一）
        return { audioPaths: [webmPath], wavPath: webmPath, durationSec, startTime: new Date(startTime), warning: "mp3_encode_failed" };
      }
    } catch (err: any) {
      new Notice(`⚠️ 録音の停止に失敗しました: ${err?.message ?? err}`);
      return null;
    }
  }
}
