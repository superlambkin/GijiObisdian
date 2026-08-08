import { App, Notice } from "obsidian";
import { readFileSync } from "fs";
import { GijiSettings } from "../settings";
import { bridgeHealth, bridgeStart, bridgeStop } from "../bridge";
import { createSttProvider } from "../providers/stt";
import { renderTemplate } from "../notes/saver";
import { splitForTranscription } from "./chunker";

export interface SegmentResult {
  text: string;
  durationSec: number;
}

/**
 * 録音 WAV のファイル名をテンプレートから生成する。
 * 既定: `録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分{{second}}秒`
 * （拡張子はブリッジ側で付与: 通常 .mp3、変換失敗時 .wav）
 */
export function buildRecordingFileName(now: Date, template: string): string {
  return renderTemplate(now, template).replace(/[\\/:*?"<>|]/g, "-");
}

export class SegmentRecorder {
  private sessionId: string | null = null;

  constructor(private app: App) {}

  isRecording(): boolean {
    return this.sessionId !== null;
  }

  async start(settings: GijiSettings): Promise<boolean> {
    try {
      const ok = await bridgeHealth(settings.bridgeBaseUrl);
      if (!ok) {
        new Notice("录音桥未启动，请先运行 recorder-bridge");
        return false;
      }
      const outDir = (settings.recordingSaveDir || "").trim() || undefined;
      const fileName = (settings.recordingFileNameTemplate || "").trim()
        ? buildRecordingFileName(new Date(), settings.recordingFileNameTemplate)
        : undefined;
      this.sessionId = await bridgeStart(settings.bridgeBaseUrl, { outDir, fileName });
      return true;
    } catch (err: any) {
      this.sessionId = null;
      new Notice(`启动录音失败: ${err?.message ?? err}`);
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

  async stop(settings: GijiSettings): Promise<SegmentResult | null> {
    if (!this.sessionId) {
      new Notice("当前没有进行中的录音");
      return null;
    }
    const sessionId = this.sessionId;
    this.sessionId = null;
    try {
      const result = await bridgeStop(settings.bridgeBaseUrl, sessionId);
      if (result.warning === "mp3_encode_failed") {
        new Notice("⚠️ MP3 変換に失敗したため WAV で保存しました（ffmpeg を確認してください）");
      }
      new Notice("转写中…");

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
      return { text: parts.join("\n\n"), durationSec: result.durationSec };
    } catch (err: any) {
      new Notice(`${err?.message ?? err}`);
      throw err;
    }
  }
}
