import { GijiSettings, SttLang } from "../settings";
import { readWavHeader } from "../audio/chunker";

export interface SttProvider {
  id: string;
  /** プロバイダーの同期 API 制限に応じた最大チャンク秒数（省略時は 600 秒で分割） */
  maxChunkSec?: number;
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

/**
 * Google Cloud Speech-to-Text v1 同期 API（speech:recognize）。
 * API キー認証・LINEAR16 PCM・base64 インライン音声。
 * 同期 API は約 60 秒までのため maxChunkSec = 55 で分割する。
 */
class GoogleStt implements SttProvider {
  id = "google";
  maxChunkSec = 55;
  constructor(private apiKey: string, private fetchImpl: typeof fetch) {}

  /** Google 同期 API は languageCode 必須（自動検出は不可）のため auto は日本語に寄せる */
  private langCode(lang: SttLang): string {
    switch (lang) {
      case "ja":
        return "ja-JP";
      case "zh":
        return "cmn-Hans-CN";
      case "en":
        return "en-US";
      default:
        return "ja-JP";
    }
  }

  async transcribe(audio: ArrayBuffer, lang: SttLang): Promise<string> {
    const { sampleRate, dataOffset, dataLength } = readWavHeader(audio);
    const pcm = audio.slice(dataOffset, dataOffset + dataLength);

    const res = await this.fetchImpl(
      `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: sampleRate,
            languageCode: this.langCode(lang),
            enableAutomaticPunctuation: true,
          },
          audio: { content: arrayBufferToBase64(pcm) },
        }),
      }
    );
    if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return ((data.results ?? []) as any[])
      .map((r) => r?.alternatives?.[0]?.transcript ?? "")
      .filter((t: string) => t.length > 0)
      .join("\n");
  }
}

/** 大きなバッファでもスタック溢れしないよう分割して base64 化する */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function createSttProvider(
  settings: GijiSettings,
  fetchImpl: typeof fetch = fetch.bind(globalThis)
): SttProvider {
  switch (settings.sttProvider) {
    case "groq":
      return new GroqStt(settings.sttApiKey, fetchImpl);
    case "openai":
      return new OpenaiStt(settings.sttApiKey, fetchImpl);
    case "google":
      return new GoogleStt(settings.sttApiKey, fetchImpl);
    default:
      // 黙ったフォールバックは誤設定を隠す（例: OpenAI キーを Groq へ送信して 401）
      throw new Error(`unsupported STT provider: ${settings.sttProvider}（未対応の STT プロバイダーです）`);
  }
}
