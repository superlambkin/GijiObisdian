import { GijiSettings, SttLang } from "../settings";

export interface SttProvider {
  id: string;
  transcribe(audio: ArrayBuffer, lang: SttLang): Promise<string>;
}

class GroqStt implements SttProvider {
  id = "groq";
  constructor(private apiKey: string, private fetchImpl: typeof fetch) {}

  async transcribe(audio: ArrayBuffer, lang: SttLang): Promise<string> {
    const form = new FormData();
    form.append("model", "whisper-large-v3-turbo");
    form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
    if (lang !== "auto") form.append("language", lang);

    const res = await this.fetchImpl(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form as any,
      }
    );
    if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.text ?? "";
  }
}

export function createSttProvider(
  settings: GijiSettings,
  fetchImpl: typeof fetch = fetch
): SttProvider {
  switch (settings.sttProvider) {
    case "groq":
      return new GroqStt(settings.sttApiKey, fetchImpl);
    default:
      // V1: only groq is required; others fall back to groq-compatible shape.
      return new GroqStt(settings.sttApiKey, fetchImpl);
  }
}
