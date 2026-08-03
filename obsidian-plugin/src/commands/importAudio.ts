import { GijiSettings } from "../settings";
import { createSttProvider } from "../providers/stt";
import { createLlmProvider } from "../providers/llm";
import { splitWavBySeconds } from "../audio/chunker";
import { renderMinutes, MINUTES_SYSTEM_PROMPT } from "../notes/generator";

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

export async function transcribeAudioToMinutes(
  wav: ArrayBuffer,
  settings: GijiSettings,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const chunks = splitWavBySeconds(wav, 600);
  const stt = createSttProvider(settings, fetchImpl);
  const parts: string[] = [];
  try {
    for (const chunk of chunks) {
      parts.push(await stt.transcribe(chunk, settings.sttLang));
    }
  } catch (err: any) {
    throw new Error(`转写失败: ${err?.message ?? String(err)}`, { cause: err });
  }
  const transcript = parts.join("\n\n");

  const llm = createLlmProvider(settings, fetchImpl);
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
