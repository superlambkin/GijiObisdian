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
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
  MediaRecorderCtor?: typeof MediaRecorder;
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
      enumerateDevices: defaultEnumerateDevices,
      MediaRecorderCtor: (hasCtor ? (globalThis as any).MediaRecorder : null) as typeof MediaRecorder,
      writeFile: defaultWriteFile,
      deleteFile: defaultDeleteFile,
      ffmpeg: defaultFfmpeg,
      ...deps,
    };
  }

  isRecording(): boolean {
    return this.mediaRecorder !== null;
  }

  async start(settings: GijiSettings): Promise<boolean> {
    if (this.isRecording()) return true;
    const micId = (settings.directMicDeviceId || "").trim();
    const constraints: MediaStreamConstraints = micId
      ? { audio: { deviceId: { exact: micId } } }
      : { audio: true };
    try {
      if (!this.deps.MediaRecorderCtor) {
        new Notice("⚠️ この環境は PC ダイレクト録音に対応していません");
        return false;
      }
      const stream = await this.deps.getUserMedia(constraints);
      const rec = new this.deps.MediaRecorderCtor(stream, {
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
        `[${new Date().toISOString()}] stage=getusermedia device_id=${micId || "(default)"} status=ok`
      ).catch(() => {});
      return true;
    } catch (err: any) {
      await writeDebugLog(
        this.app,
        this.manifestDir,
        `[${new Date().toISOString()}] stage=getusermedia device_id=${micId || "(default)"} status=fail error="${(err?.message || "").replace(/"/g, "'")}"`
      ).catch(() => {});
      new Notice(`⚠️ マイクにアクセスできません: ${err?.message ?? err}`);
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

    try {
      // stop() 後、最終 ondataavailable のフラッシュが終わってから onstop が発火する
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
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
