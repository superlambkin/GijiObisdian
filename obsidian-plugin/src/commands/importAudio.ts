import { GijiSettings } from "../settings";
import { createSttProvider } from "../providers/stt";
import { ensureWhisperLocalServer } from "../whisperLocalLauncher";
import { createLlmProvider } from "../providers/llm";
import { nodeFetch } from "../providers/nodeFetch";
import { splitForTranscription } from "../audio/chunker";
import { renderMinutes, MINUTES_SYSTEM_PROMPT } from "../notes/generator";
import { buildTemplateSystemPrompt } from "../notes/minutesTemplate";

export function parseMinutesSections(output: string) {
  const findLabel = (label: string, startAt = 0): number => {
    const re = new RegExp(`(^|\\n)${label}:`, "g");
    re.lastIndex = startAt;
    const m = re.exec(output);
    return m ? m.index + (m[1] === "\n" ? 1 : 0) : -1;
  };

  const get = (name: string, next: string[]) => {
    const idx = findLabel(name, 0);
    if (idx === -1) return "";
    const from = idx + name.length + 1;
    const ends = next
      .map((n) => findLabel(n, from))
      .filter((i) => i !== -1);
    const to = ends.length ? Math.min(...ends) : output.length;
    return output.slice(from, to).trim();
  };
  return {
    summary: get("SUMMARY", ["DECISIONS", "ACTIONS", "DISCUSSION"]),
    decisions: get("DECISIONS", ["ACTIONS", "DISCUSSION"]),
    actions: get("ACTIONS", ["DISCUSSION"]),
    discussion: get("DISCUSSION", []),
  };
}

export async function transcribeAudio(
  wav: ArrayBuffer,
  settings: GijiSettings,
  fetchImpl: typeof fetch = nodeFetch
): Promise<string> {
  const stt = createSttProvider(settings, fetchImpl);
  if (settings.sttProvider === "whisper-local") {
    await ensureWhisperLocalServer(settings, { fetchImpl });
  }
  // プロバイダー制約に応じて分割（Whisper 25MB → 24MB / Google 55 秒・400KB）
  const chunks = splitForTranscription(wav, stt);
  const parts: string[] = [];
  try {
    for (const chunk of chunks) {
      parts.push(await stt.transcribe(chunk, settings.sttLang));
    }
  } catch (err: any) {
    throw new Error(`转写失败: ${err?.message ?? String(err)}`, { cause: err });
  }
  return parts.join("\n\n");
}

export async function transcribeAudioToMinutes(
  wav: ArrayBuffer,
  settings: GijiSettings,
  fetchImpl: typeof fetch = nodeFetch,
  templateMd?: string
): Promise<string> {
  const transcript = await transcribeAudio(wav, settings, fetchImpl);

  const llm = createLlmProvider(settings, fetchImpl);
  if (templateMd) {
    // テンプレート指定時: LLM にテンプレート構造の議事録 MD を直接生成させる
    let md: string;
    try {
      md = await llm.complete(buildTemplateSystemPrompt(templateMd), transcript);
    } catch (err: any) {
      throw new Error(`纪要生成失败: ${err?.message ?? String(err)}`, { cause: err });
    }
    return md.trim() + "\n";
  }

  let llmOut: string;
  try {
    llmOut = await llm.complete(MINUTES_SYSTEM_PROMPT, transcript);
  } catch (err: any) {
    throw new Error(`纪要生成失败: ${err?.message ?? String(err)}`, { cause: err });
  }
  const sections = parseMinutesSections(llmOut);

  const date = new Date().toISOString().slice(0, 10);
  return renderMinutes({
    date,
    summary: sections.summary,
    decisions: sections.decisions,
    actions: sections.actions,
    discussion: sections.discussion,
    transcript: settings.keepTranscript
      ? transcript.split("\n\n").map((p) => `> ${p}`).join("\n\n")
      : "(已省略)",
  });
}
