import { App, Notice } from "obsidian";
import { readFileSync } from "fs";
import { GijiSettings } from "../settings";
import { bridgeHealth, bridgeStart, bridgeStop } from "../bridge";
import { createSttProvider } from "../providers/stt";
import { renderTemplate } from "../notes/saver";
import { splitForTranscription } from "./chunker";
import { DirectRecorder } from "./directRecorder";

export interface SegmentResult {
  text: string;
  durationSec: number;
  startTime?: Date;
  audioPaths?: string[];
}

/** bridge / direct 共通の転写対象（BridgeStopResult と DirectRecordResult の共通部分） */
interface TranscribeInput {
  audioPaths: string[];
  wavPath?: string;
  durationSec: number;
  warning?: string;
}

/** 転写結果を SegmentResult にまとめる（audioPaths と startTime を引き継ぐ） */
export function buildSegmentResult(
  text: string,
  input: TranscribeInput,
  startTime?: Date
): SegmentResult {
  return { text, durationSec: input.durationSec, startTime, audioPaths: input.audioPaths };
}

/**
 * 録音ファイルのベース名をテンプレートから生成する。
 * 既定: `録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分{{second}}秒`
 * （拡張子はブリッジ/ダイレクト側で付与: .mp3、変換失敗時 .wav または .webm）
 */
export function buildRecordingFileName(now: Date, template: string): string {
  return renderTemplate(now, template).replace(/[\\/:*?"<>|]/g, "-");
}

export class SegmentRecorder {
  private sessionId: string | null = null;
  private direct: DirectRecorder;
  private startTime?: Date;

  constructor(private app: App, direct: DirectRecorder = new DirectRecorder()) {
    this.direct = direct;
  }

  isRecording(): boolean {
    return this.sessionId !== null || this.direct.isRecording();
  }

  async start(settings: GijiSettings): Promise<boolean> {
    this.startTime = new Date();
    // PC ダイレクト録音：ブリッジ確認なし・プラグイン単独で開始
    if (settings.recordingMethod === "direct") {
      return this.direct.start(settings);
    }
    try {
      const ok = await bridgeHealth(settings.bridgeBaseUrl);
      if (!ok) {
        new Notice("⚠️ 録音ブリッジが起動していません。先に recorder-bridge を実行してください");
        return false;
      }
      const outDir = (settings.recordingSaveDir || "").trim() || undefined;
      const fileName = (settings.recordingFileNameTemplate || "").trim()
        ? buildRecordingFileName(new Date(), settings.recordingFileNameTemplate)
        : undefined;
      this.sessionId = await bridgeStart(settings.bridgeBaseUrl, { outDir, fileName, audioSource: settings.audioSource });
      return true;
    } catch (err: any) {
      this.sessionId = null;
      new Notice(`⚠️ 録音の開始に失敗しました: ${err?.message ?? err}`);
      throw err;
    }
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

  /** bridge / direct 共通の後段：MP3/webm → STT → テキスト化 */
  private async transcribePaths(result: TranscribeInput, settings: GijiSettings): Promise<SegmentResult> {
    if (result.warning === "mp3_encode_failed") {
      new Notice("⚠️ MP3 変換に失敗したため WAV で保存しました（ffmpeg を確認してください）");
    }
    new Notice("転写中…");

    const paths = result.audioPaths?.length ? result.audioPaths : [result.wavPath!];
    const stt = createSttProvider(settings);
    const parts: string[] = [];
    for (const path of paths) {
      const buf = await this.readAudioFile(path);
      // プロバイダー制約に応じて分割（24MB 超 / Google 55 秒等）
      for (const chunk of splitForTranscription(buf, stt)) {
        parts.push(await stt.transcribe(chunk, settings.sttLang));
      }
    }
    return buildSegmentResult(parts.join("\n\n"), result, this.startTime);
  }

  async stop(settings: GijiSettings): Promise<SegmentResult | null> {
    if (this.direct.isRecording()) {
      const result = await this.direct.stop(settings);
      if (!result) return null;
      return await this.transcribePaths(result, settings);
    }
    if (!this.sessionId) {
      new Notice("進行中の録音がありません");
      return null;
    }
    const sessionId = this.sessionId;
    this.sessionId = null;
    try {
      const result = await bridgeStop(settings.bridgeBaseUrl, sessionId);
      return await this.transcribePaths(result, settings);
    } catch (err: any) {
      new Notice(`${err?.message ?? err}`);
      throw err;
    }
  }
}
