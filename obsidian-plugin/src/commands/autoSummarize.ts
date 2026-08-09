import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { createLlmProvider } from "../providers/llm";
import {
  loadMinutesTemplate,
  buildClaudianMinutesPrompt,
  buildTemplateSystemPrompt,
} from "../notes/minutesTemplate";
import { MINUTES_SYSTEM_PROMPT } from "../notes/generator";
import { fillMinutesMetadata, formatStartTime } from "../notes/minutesMetadata";
import { appendToClaudianInput } from "../ui/claudianApi";
import { buildTranscriptFilename } from "../notes/saver";

export interface AutoSummarizeOptions {
  fetchImpl?: typeof fetch;
  startTime?: Date;
  durationSec?: number;
  mp3Links?: string;
}

export interface AutoSummarizeResult {
  ok: boolean;
  error?: string;
  skippedReason?: "disabled" | "no-llm-configured";
}

function isLlmConfigured(s: GijiSettings): boolean {
  if (s.llmProvider === "claudian") return true; // claudian は検出時に判定
  if (!s.llmBaseUrl.trim()) return false;
  if (!s.llmModel.trim()) return false;
  if (s.llmProvider === "cloud" && !s.llmApiKey) return false;
  return true;
}

export async function runAutoSummarize(
  transcript: string,
  settings: GijiSettings,
  app: App,
  manifestDir: string,
  opts: AutoSummarizeOptions = {}
): Promise<AutoSummarizeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  if (!settings.autoSummarizeEnabled) {
    return { ok: true, skippedReason: "disabled" };
  }
  if (!isLlmConfigured(settings)) {
    new Notice("⚠️ LLM プロバイダーが未設定のため、要約自動生成をスキップしました");
    return { ok: false, skippedReason: "no-llm-configured" };
  }

  try {
    // テンプレートのロードを試行（無ければ MINUTES_SYSTEM_PROMPT を使う）
    let templateMd: string | undefined;
    try {
      templateMd = await loadMinutesTemplate(app, settings, manifestDir);
    } catch {
      templateMd = undefined;
    }

    if (settings.llmProvider === "claudian") {
      const startTime = opts.startTime ?? new Date();
      const prompt = templateMd
        ? buildClaudianMinutesPrompt(templateMd, transcript, settings.outputDir, startTime, {
            durationSec: opts.durationSec,
            mp3Links: opts.mp3Links,
          })
        : [
            "以下の会議転写テキストを、構造化された議事録 Markdown として作成し、",
            `Vault の ${settings.outputDir}/ に保存してください。`,
            `【録音情報】開始時間=${formatStartTime(startTime)} / 会議時間=${opts.durationSec !== undefined ? `${Math.floor(opts.durationSec / 60)} 分 ${opts.durationSec % 60} 秒` : "不明"} / 録音ファイル=${opts.mp3Links ?? ""}`,
            "",
            "【転写テキスト】",
            transcript,
          ].join("\n");
      const ok = await appendToClaudianInput(app, prompt);
      if (!ok) {
        new Notice("⚠️ Claudian プラグインが見つかりません（未インストールまたは未有効化）");
        return { ok: false, error: "Claudian プラグインが見つかりません（未インストールまたは未有効化）" };
      }
      new Notice("📋 Claudian に要約プロンプトを送信しました");
      return { ok: true };
    }

    // cloud / ollama
    const llm = createLlmProvider(settings, fetchImpl);
    const systemPrompt = templateMd ? buildTemplateSystemPrompt(templateMd) : MINUTES_SYSTEM_PROMPT;
    const md = await llm.complete(systemPrompt, transcript);

    const now = opts.startTime ?? new Date();
    const fileName = buildTranscriptFilename(now, settings.fileNameTemplate);
    const dir = (settings.outputDir || "").trim() || "議事録";
    const basePath = `${dir}/${fileName}.md`;
    let path = basePath;
    let counter = 2;
    while (await app.vault.exists(path)) {
      path = `${dir}/${fileName}-${counter}.md`;
      counter++;
    }
    const finalMd = fillMinutesMetadata(templateMd ? md.trim() + "\n" : md, {
      startTime: now,
      durationSec: opts.durationSec,
      mp3Links: opts.mp3Links,
    });
    await app.vault.create(path, finalMd);
    new Notice("✅ 議事録を生成しました");
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    new Notice(`⚠️ 議事録の生成に失敗しました: ${msg}`);
    return { ok: false, error: msg };
  }
}