import { App, Notice } from "obsidian";
import { readFileSync } from "fs";
import { GijiSettings } from "../settings";
import { createSttProvider } from "../providers/stt";
import { ensureWhisperLocalServer } from "../whisperLocalLauncher";
import { renderTemplate } from "../notes/saver";
import { writeDebugLog } from "../util/debugLog";
import { splitForTranscription } from "./chunker";
import { DirectRecorder } from "./directRecorder";

export interface SegmentResult {
  text: string;
  durationSec: number;
  startTime?: Date;
  audioPaths?: string[];
  /** STT 転写処理時間（ms）。終了メッセージの（処理時間）表示に使う */
  sttMs?: number;
}

/** ダイレクト録音の転写対象（DirectRecordResult 相当） */
interface TranscribeInput {
  audioPaths: string[];
  wavPath?: string;
  durationSec: number;
  warning?: string;
}

/** 転写結果を SegmentResult にまとめる（audioPaths / startTime / sttMs を引き継ぐ） */
export function buildSegmentResult(
  text: string,
  input: TranscribeInput,
  startTime?: Date,
  sttMs?: number
): SegmentResult {
  return {
    text,
    durationSec: input.durationSec,
    startTime,
    audioPaths: input.audioPaths,
    sttMs,
  };
}

/**
 * 録音ファイルのベース名をテンプレートから生成する。
 * 既定: `録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分{{second}}秒`
 * （拡張子はダイレクト側で付与: .mp3、変換失敗時 .wav または .webm）
 */
export function buildRecordingFileName(now: Date, template: string): string {
  return renderTemplate(now, template).replace(/[\\/:*?"<>|]/g, "-");
}

export class SegmentRecorder {
  private direct: DirectRecorder;
  private startTime?: Date;

  constructor(private app: App, private manifestDir: string = "", direct?: DirectRecorder) {
    // v0.5: DirectRecorder に app/manifestDir を渡し、writeDebugLog でデバイス選択診断を出せるようにする
    this.direct = direct ?? new DirectRecorder({}, app, manifestDir);
  }

  isRecording(): boolean {
    return this.direct.isRecording();
  }

  async start(settings: GijiSettings): Promise<boolean> {
    this.startTime = new Date();
    // PC ダイレクト録音：ブリッジ確認なし・プラグイン単独で開始
    await writeDebugLog(
      this.app,
      this.manifestDir,
      `[${new Date().toISOString()}] stage=device_select mode=direct mic_id=${(settings.directMicDeviceId || "").trim() || "(default)"} speaker_id=${(settings.directSpeakerDeviceId || "").trim() || "(default)"}`
    ).catch(() => {});
    return this.direct.start(settings);
  }

  /** Vault 内は adapter、Vault 外の絶対パスは Node fs で読む */
  private async readAudioFile(path: string): Promise<ArrayBuffer> {
    const adapter = this.app.vault.adapter as any;
    try {
      return await adapter.readBinary(path);
    } catch {
      // 動的 import("fs") は Chromium が解決できないため静的 import 必須（e2e7f47 参照）。
      const nodeBuf = readFileSync(path);
      return nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);
    }
  }

  /** 録音後の後段処理：MP3/webm → STT → テキスト化 */
  private async transcribePaths(result: TranscribeInput, settings: GijiSettings): Promise<SegmentResult> {
    if (result.warning === "mp3_encode_failed") {
      new Notice("⚠️ MP3 変換に失敗したため WAV で保存しました（ffmpeg を確認してください）");
    }
    new Notice("転写中…");

    const paths = result.audioPaths?.length ? result.audioPaths : [result.wavPath!];
    const sttStartMs = Date.now();
    let sttChunks = 0;
    try {
      const stt = createSttProvider(settings);
      if (settings.sttProvider === "whisper-local") {
        await ensureWhisperLocalServer(settings);
      }
      const parts: string[] = [];
      for (const path of paths) {
        const buf = await this.readAudioFile(path);
        // プロバイダー制約に応じて分割（24MB 超 / Google 55 秒等）
        for (const chunk of splitForTranscription(buf, stt)) {
          parts.push(await stt.transcribe(chunk, settings.sttLang));
          sttChunks++;
        }
      }
      const dur = Date.now() - sttStartMs;
      const audioMs = typeof result.durationSec === "number" ? Math.round(result.durationSec * 1000) : 0;
      await writeDebugLog(
        this.app,
        this.manifestDir,
        `[${new Date().toISOString()}] stage=stt dur_ms=${dur} status=ok provider=${settings.sttProvider} chunks=${sttChunks} audio_ms=${audioMs}`
      );
      return buildSegmentResult(parts.join("\n\n"), result, this.startTime, dur);
    } catch (e: any) {
      const dur = Date.now() - sttStartMs;
      await writeDebugLog(
        this.app,
        this.manifestDir,
        `[${new Date().toISOString()}] stage=stt dur_ms=${dur} status=fail provider=${settings.sttProvider} error="${(e?.message || "").replace(/"/g, "'")}"`
      );
      throw e;
    }
  }

  async stop(settings: GijiSettings): Promise<SegmentResult | null> {
    if (this.direct.isRecording()) {
      const result = await this.direct.stop(settings);
      if (!result) return null;
      return await this.transcribePaths(result, settings);
    }
    new Notice("進行中の録音がありません");
    return null;
  }
}
