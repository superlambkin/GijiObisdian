import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { transcribeAudioToMinutes } from "../commands/importAudio";

export async function importAudioFlow(app: App, settings: GijiSettings) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*,.wav,.mp3,.m4a,.flac,.ogg";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      new Notice(`转写 ${file.name}…`);
      const buf = await file.arrayBuffer();
      const md = await transcribeAudioToMinutes(buf, settings);
      const name = `📋 ${new Date().toISOString().slice(0, 10)} 会议纪要.md`;
      await app.vault.create(`${settings.outputDir}/${name}`, md);
      new Notice("✅ 纪要已生成");
    } catch (err: any) {
      new Notice(`${err?.message ?? err}`);
    }
  };
  input.click();
}
