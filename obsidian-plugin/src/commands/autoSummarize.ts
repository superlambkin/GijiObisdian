import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { createLlmProvider, getDefaultFetch, LlmCallStats } from "../providers/llm";
import {
  isLlmConfigured,
  LLM_PRESETS,
  loadProviderProfile,
  findFallbackLlmProvider,
} from "../providers/llmPresets";
import { writeDebugLog } from "../util/debugLog";
import {
  loadMinutesTemplate,
  buildClaudianMinutesPrompt,
  buildTemplateSystemPrompt,
} from "../notes/minutesTemplate";
import { MINUTES_SYSTEM_PROMPT } from "../notes/generator";
import {
  fillMinutesMetadata,
  formatStartTime,
  enforceFrontmatterDates,
  getFrontmatterField,
  setFrontmatterField,
} from "../notes/minutesMetadata";
import { appendToClaudianInput } from "../ui/claudianApi";
import { buildTranscriptFilename } from "../notes/saver";
import { SummarizeStage } from "../ui/recordingTimer";

export interface SummarizeProgress {
  stage: SummarizeStage;
  receivedChars?: number;
}

export interface AutoSummarizeOptions {
  fetchImpl?: typeof fetch;
  startTime?: Date;
  durationSec?: number;
  mp3Links?: string;
  /** STT 転写処理時間（ms）。議事録 MD の概要表に記録 */
  sttMs?: number;
  /** 手動実行: autoSummarizeEnabled が OFF でも実行する */
  force?: boolean;
  /** 指定時は連番を作らずこのパスへ保存する（既存なら上書き） */
  overwritePath?: string;
  /** 進捗コールバック（要約中 → 生成中 → 保存中） */
  onProgress?: (p: SummarizeProgress) => void;
}

export interface AutoSummarizeResult {
  ok: boolean;
  error?: string;
  skippedReason?: "disabled" | "no-llm-configured" | "no-fallback-llm";
}

// isLlmConfigured は ../providers/llmPresets から import して使用

export async function runAutoSummarize(
  transcript: string,
  settings: GijiSettings,
  app: App,
  manifestDir: string,
  opts: AutoSummarizeOptions = {}
): Promise<AutoSummarizeResult> {
  const fetchImpl = opts.fetchImpl ?? getDefaultFetch();
  const summarizeStartMs = Date.now();
  const stats: LlmCallStats = { retries: 0 };
  const fmt = (v: number | undefined) => (v === undefined ? "-" : String(v));
  const emitSummarizeLog = async (status: string, extra = "") => {
    if (!settings.debugLog) return;
    const dur = Date.now() - summarizeStartMs;
    const provider = settings.llmProvider;
    const model = provider === "claudian" ? "claudian" : settings.llmModel || "";
    const baseUrl = provider === "claudian" ? "" : settings.llmBaseUrl || "";
    const inChars = (transcript || "").length;
    await writeDebugLog(
      app,
      manifestDir,
      `[${new Date().toISOString()}] stage=summarize dur_ms=${dur} status=${status} provider=${provider} model=${model} baseUrl=${baseUrl} in_chars=${inChars} ttfb_ms=${fmt(stats.ttfbMs)} in_tokens=${fmt(stats.inputTokens)} out_tokens=${fmt(stats.outputTokens)} retry_count=${stats.retries} ${extra}`
    );
  };
  if (!settings.autoSummarizeEnabled && !opts.force) {
    return { ok: true, skippedReason: "disabled" };
  }
  if (!isLlmConfigured(settings)) {
    new Notice("⚠️ LLM プロバイダーが未設定のため、要約自動生成をスキップしました");
    await emitSummarizeLog("skipped", "reason=no-llm-configured");
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

    // === claudian モード + insertToClaudianEnabled=false のフォールバック解決 ===
    // activeSettings はそのまま cloud/ollama 経路で使われ、claudian 経路では settings のまま
    let activeSettings: GijiSettings = settings;
    if (settings.llmProvider === "claudian") {
      // === claudian モード ===
      if (!settings.insertToClaudianEnabled) {
        // OFF の場合: fallback LLM（cloud/ollama の profile）を自動選択して生成
        const fallbackId = findFallbackLlmProvider(settings);
        if (!fallbackId) {
          // fallback もない場合はエラー（議事録を保存できない）
          new Notice(
            "⚠️ Claudian への挿入設定が OFF かつ fallback LLM（cloud/ollama）も未設定のため、議事録を自動生成できません。設定 → ③ 要約 で cloud/ollama プロバイダの接続テストを実施してください"
          );
          await emitSummarizeLog("skipped", "reason=no-fallback-llm");
          return { ok: false, skippedReason: "no-fallback-llm" };
        }
        // fallback で生成することを Notice でユーザーに通知
        const fbDisplay = LLM_PRESETS[fallbackId].displayName;
        new Notice(
          `ℹ️ Claudian 挿入 OFF のため fallback LLM「${fbDisplay}」で議事録を生成します`
        );
        await emitSummarizeLog("skipped", `reason=fallback mode=${fallbackId}`);
        // ↓ cloud / ollama 経路へそのまま進む（activeSettings で上書き）
        activeSettings = loadProviderProfile(
          { ...settings, llmProvider: fallbackId },
          fallbackId
        );
      } else {
        // === ON の場合: 既存挙動（Claudian 入力欄へプロンプト挿入） ===
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
          await emitSummarizeLog("fail", "mode=claudian reason=plugin-not-found");
          return { ok: false, error: "Claudian プラグインが見つかりません（未インストールまたは未有効化）" };
        }
        new Notice(
          opts.force
            ? "📋 Claudian に要約プロンプトを送信しました（進捗表示・上書きはありません）"
            : "📋 Claudian に要約プロンプトを送信しました"
        );
        await emitSummarizeLog("ok", "mode=claudian");
        return { ok: true };
      }
    }

    // cloud / ollama（fallback 経由含む）
    const llm = createLlmProvider(activeSettings, fetchImpl);
    const systemPrompt = templateMd ? buildTemplateSystemPrompt(templateMd) : MINUTES_SYSTEM_PROMPT;
    opts.onProgress?.({ stage: "connecting" });
    const md = await llm.complete(systemPrompt, transcript, stats, {
      onFirstChunk: () => opts.onProgress?.({ stage: "generating" }),
      onChunk: (n) => opts.onProgress?.({ stage: "generating", receivedChars: n }),
    });

    const startTime = opts.startTime ?? new Date();
    const finalMd = fillMinutesMetadata(templateMd ? md.trim() + "\n" : md, {
      startTime,
      durationSec: opts.durationSec,
      mp3Links: opts.mp3Links,
      sttMs: opts.sttMs,
      summarizeMs: Date.now() - summarizeStartMs,
    });
    // 日付ハルシネーション対策：created/modified を実値で強制
    let out = enforceFrontmatterDates(finalMd, startTime, new Date());

    opts.onProgress?.({ stage: "saving" });
    const totalSec = Math.round((Date.now() - summarizeStartMs) / 1000);

    if (opts.overwritePath) {
      let overwritten = false;
      try {
        if (await app.vault.adapter.exists(opts.overwritePath)) {
          const old = await (app.vault.adapter as any).read(opts.overwritePath);
          const num = getFrontmatterField(old, "議事録番号");
          if (num) out = setFrontmatterField(out, "議事録番号", num);
          const oldCreated = getFrontmatterField(old, "created");
          if (oldCreated) out = setFrontmatterField(out, "created", oldCreated);
          overwritten = true;
        }
        await (app.vault.adapter as any).write(opts.overwritePath, out);
      } catch (e) {
        // === UAT 診断：write/read/同定失敗時の追加情報をログ ===
        const msg = (e as Error).message;
        const stack = (e as Error)?.stack?.split("\n").slice(0, 3).join(" | ") ?? "";
        await emitSummarizeLog("fail", `error="overwrite_diag path=${opts.overwritePath} msg=${(msg || "").replace(/"/g, "'")} stack=${stack.replace(/"/g, "'")}"`);
        // TOCTOU 対策：上書きブロック全体を try/catch で包み、失敗時は既存ファイルを
        // 変更せずに Notice で明示する（生成失敗と区別する文言）。
        new Notice(`⚠️ 議事録の上書きに失敗しました: ${msg}`);
        await emitSummarizeLog("fail", `error="overwrite_failed: ${(msg || "").replace(/"/g, "'")}"`);
        return { ok: false, error: msg };
      }
      new Notice(
        overwritten
          ? `✅ 議事録を上書きしました（${totalSec} 秒）`
          : `✅ 議事録を生成しました（${totalSec} 秒）`
      );
      await emitSummarizeLog("ok", `mode=${activeSettings.llmProvider} out_chars=${out.length} overwrite=${overwritten}`);
      return { ok: true };
    }

    const fileName = buildTranscriptFilename(startTime, settings.fileNameTemplate);
    const dir = (settings.outputDir || "").trim() || "議事録";
    let path = `${dir}/${fileName}.md`;
    let counter = 2;
    while (await app.vault.exists(path)) {
      path = `${dir}/${fileName}-${counter}.md`;
      counter++;
    }
    await app.vault.create(path, out);
    new Notice(`✅ 議事録を生成しました（${totalSec} 秒）`);
    await emitSummarizeLog("ok", `mode=${activeSettings.llmProvider} out_chars=${out.length}`);
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    new Notice(`⚠️ 議事録の生成に失敗しました: ${msg}`);
    await emitSummarizeLog("fail", `error="${(msg || "").replace(/"/g, "'")}"`);
    return { ok: false, error: msg };
  }
}