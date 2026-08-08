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

class OpenaiStt implements SttProvider {
  id = "openai";
  constructor(private apiKey: string, private fetchImpl: typeof fetch) {}

  async transcribe(audio: ArrayBuffer, lang: SttLang): Promise<string> {
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
    if (lang !== "auto") form.append("language", lang);

    const res = await this.fetchImpl(
      "https://api.openai.com/v1/audio/transcriptions",
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
    case "openai":
      return new OpenaiStt(settings.sttApiKey, fetchImpl);
    default:
      // 黙ったフォールバックは誤設定を隠す（例: OpenAI キーを Groq へ送信して 401）
      throw new Error(`unsupported STT provider: ${settings.sttProvider}（未対応の STT プロバイダーです）`);
  }
}
