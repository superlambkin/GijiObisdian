import { App, Notice } from "obsidian";
import { readFileSync } from "fs";
import { GijiSettings } from "../settings";
import { bridgeHealth, bridgeStart, bridgeStop } from "../bridge";
import { createSttProvider } from "../providers/stt";
import { renderTemplate } from "../notes/saver";
import { splitWavBySeconds } from "./chunker";

export interface SegmentResult {
  text: string;
  durationSec: number;
}

/**
 * 録音 WAV のファイル名をテンプレートから生成する。
 * 既定: `録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分{{second}}秒`
 * （拡張子 .wav はブリッジ側で付与）
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

  async stop(settings: GijiSettings): Promise<SegmentResult | null> {
    if (!this.sessionId) {
      new Notice("当前没有进行中的录音");
      return null;
    }
    const sessionId = this.sessionId;
    this.sessionId = null;
    try {
      const { wavPath, durationSec } = await bridgeStop(settings.bridgeBaseUrl, sessionId);
      new Notice("转写中…");

      const adapter = this.app.vault.adapter as any;
      let buf: ArrayBuffer;
      try {
        buf = await adapter.readBinary(wavPath);
      } catch {
        // vault 外の絶対パスは adapter が読めないため Node fs で読む。
        // 動的 import("fs") は Chromium が解決できないため静的 import 必須（e2e7f47 参照）。
        const nodeBuf = readFileSync(wavPath);
        buf = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);
      }

      const stt = createSttProvider(settings);
      const chunks = splitWavBySeconds(buf, stt.maxChunkSec ?? 600);
      const parts: string[] = [];
      for (const c of chunks) parts.push(await stt.transcribe(c, settings.sttLang));
      return { text: parts.join("\n\n"), durationSec };
    } catch (err: any) {
      new Notice(`${err?.message ?? err}`);
      throw err;
    }
  }
}
