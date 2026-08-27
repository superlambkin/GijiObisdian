import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { transcribeAudio, transcribeAudioToMinutes } from "../commands/importAudio";
import { nodeFetch } from "../providers/nodeFetch";
import { buildClaudianMinutesPrompt, loadMinutesTemplate } from "../notes/minutesTemplate";
import { appendToClaudianInput } from "./claudianApi";

export async function importAudioFlow(app: App, settings: GijiSettings, manifestDir: string) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*,.wav,.mp3,.m4a,.flac,.ogg";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      new Notice(`文字起こし中: ${file.name}…`);
      const buf = await file.arrayBuffer();

      // Claudian（デフォルト）: 要約プロンプトを Claudian 入力欄に挿入し、
      // Claudian のエージェントがテンプレートに従って議事録 MD を作成・保存する
      if (settings.llmProvider === "claudian") {
        // 設定「結果を Claudian 入力欄に挿入」が OFF の場合はスキップ
        if (!settings.insertToClaudianEnabled) {
          new Notice(
            "⚠️ Claudian への挿入設定が OFF のため、要約プロンプトを挿入しませんでした（議事録を生成するには LLM プロバイダを cloud/ollama に切り替えるか、設定を ON にしてください）"
          );
          return;
        }
        const transcript = await transcribeAudio(buf, settings);
        const template = await loadMinutesTemplate(app, settings, manifestDir);
        const prompt = buildClaudianMinutesPrompt(
          template,
          transcript,
          settings.outputDir,
          new Date()
        );
        const ok = await appendToClaudianInput(app, prompt);
        new Notice(
          ok
            ? "✅ 要約プロンプトを Claudian の入力欄に挿入しました（送信すると議事録を生成します）"
            : "❌ Claudian の入力欄が見つかりません"
        );
        return;
      }

      // クラウド / Ollama: テンプレートを適用して LLM で議事録 MD を生成
      const template = await loadMinutesTemplate(app, settings, manifestDir);
      const md = await transcribeAudioToMinutes(buf, settings, nodeFetch, template);
      const name = `議事録_${new Date().toISOString().slice(0, 10)}.md`;
      await app.vault.create(`${settings.outputDir}/${name}`, md);
      new Notice("✅ 議事録を生成しました");
    } catch (err: any) {
      new Notice(`${err?.message ?? err}`);
    }
  };
  input.click();
}
