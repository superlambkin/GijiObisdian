import { GijiSettings } from "../settings";
import { createSttProvider } from "../providers/stt";
import { createLlmProvider } from "../providers/llm";
import { splitWavBySeconds } from "../audio/chunker";
import { renderMinutes, MINUTES_SYSTEM_PROMPT } from "../notes/generator";

export function parseMinutesSections(output: string) {
  const get = (name: string, next: string[]) => {
    const idx = output.indexOf(`${name}:`);
    if (idx === -1) return "";
    const from = idx + name.length + 1;
    const ends = next
      .map((n) => output.indexOf(`${n}:`))
      .filter((i) => i !== -1 && i > idx);
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
  for (const chunk of chunks) {
    parts.push(await stt.transcribe(chunk, settings.sttLang));
  }
  const transcript = parts.join("\n\n");

  const llm = createLlmProvider(settings, fetchImpl);
  const llmOut = await llm.complete(MINUTES_SYSTEM_PROMPT, transcript);
  const sections = parseMinutesSections(llmOut);

  const date = new Date().toISOString().slice(0, 10);
  return renderMinutes({
    date,
    summary: sections.summary,
    decisions: sections.decisions,
    actions: sections.actions,
    discussion: sections.discussion,
    transcript: settings.keepTranscript ? `> ${transcript}` : "(已省略)",
  });
}
