import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { bridgeHealth, bridgeStart, bridgeStop } from "../bridge";
import { createSttProvider } from "../providers/stt";
import { splitWavBySeconds } from "./chunker";

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
      this.sessionId = await bridgeStart(settings.bridgeBaseUrl);
      return true;
    } catch (err: any) {
      this.sessionId = null;
      new Notice(`启动录音失败: ${err?.message ?? err}`);
      throw err;
    }
  }

  async stop(settings: GijiSettings): Promise<string | null> {
    if (!this.sessionId) {
      new Notice("当前没有进行中的录音");
      return null;
    }
    const sessionId = this.sessionId;
    this.sessionId = null;
    try {
      const { wavPath } = await bridgeStop(settings.bridgeBaseUrl, sessionId);
      new Notice("转写中…");

      const adapter = this.app.vault.adapter as any;
      let buf: ArrayBuffer;
      try {
        buf = await adapter.readBinary(wavPath);
      } catch {
        const fs = await import("fs");
        const nodeBuf = fs.readFileSync(wavPath);
        buf = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);
      }

      const stt = createSttProvider(settings);
      const chunks = splitWavBySeconds(buf, 600);
      const parts: string[] = [];
      for (const c of chunks) parts.push(await stt.transcribe(c, settings.sttLang));
      return parts.join("\n\n");
    } catch (err: any) {
      new Notice(`${err?.message ?? err}`);
      throw err;
    }
  }
}
