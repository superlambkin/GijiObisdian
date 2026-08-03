import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { bridgeHealth, bridgeStart, bridgeStop } from "../bridge";
import { createSttProvider } from "../providers/stt";
import { splitWavBySeconds } from "../audio/chunker";
import { appendSegmentNote } from "../notes/generator";

let activeSession: string | null = null;

export async function startSegment(app: App, settings: GijiSettings) {
  try {
    const ok = await bridgeHealth(settings.bridgeBaseUrl);
    if (!ok) {
      new Notice("录音桥未启动，请先运行 recorder-bridge");
      return;
    }
    activeSession = await bridgeStart(settings.bridgeBaseUrl);
    new Notice("🎙️ 录音中… 再次执行「停止并转写」结束");
  } catch (err: any) {
    activeSession = null;
    new Notice(`启动录音失败: ${err?.message ?? err}`);
    throw err;
  }
}

export async function stopSegment(app: App, settings: GijiSettings) {
  if (!activeSession) {
    new Notice("当前没有进行中的录音");
    return;
  }
  try {
    const { wavPath } = await bridgeStop(settings.bridgeBaseUrl, activeSession);
    new Notice("转写中…");

    // Read the wav file via Obsidian's adapter (vault-external path via bridge is absolute).
    // Obsidian adapters typically only resolve vault-internal paths, so we fall back to Node fs
    // for the absolute temp path written by the recorder bridge.
    const adapter = app.vault.adapter as any;
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

    const view = app.workspace.getActiveViewOfType(Object as any) as any;
    const editor = view?.editor;
    if (!editor) {
      new Notice("请先打开一篇笔记再追加转写");
      return;
    }
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    const cur = editor.getValue();
    editor.setValue(appendSegmentNote(cur, `${time}`, parts.join("\n\n")));
    new Notice("✅ 转写已追加");
  } catch (err: any) {
    new Notice(`${err?.message ?? err}`);
    throw err;
  } finally {
    activeSession = null;
  }
}
