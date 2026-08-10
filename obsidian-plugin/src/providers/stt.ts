import { GijiSettings, SttLang } from "../settings";
import { isWav, readWavHeader, MAX_TRANSCRIPTION_BYTES } from "../audio/chunker";

export interface SttProvider {
  id: string;
  /** WAV 時間分割が必要なプロバイダーの最大チャンク秒数（例: Google 同期 API 55 秒） */
  maxChunkSec?: number;
  /** 1 リクエストの最大バイト数（省略時は 24MB: Whisper 25MB 制限対策） */
  maxBytesPerRequest?: number;
  transcribe(audio: ArrayBuffer, lang: SttLang): Promise<string>;
}

class GroqStt implements SttProvider {
  id = "groq";
  constructor(private apiKey: string, private fetchImpl: typeof fetch) {}

  async transcribe(audio: ArrayBuffer, lang: SttLang): Promise<string> {
    const wav = isWav(audio);
    const form = new FormData();
    form.append("model", "whisper-large-v3-turbo");
    form.append(
      "file",
      new Blob([audio], { type: wav ? "audio/wav" : "audio/mpeg" }),
      wav ? "audio.wav" : "audio.mp3"
    );
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

/** Qwen3-ASR ローカルサーバ（OpenAI 互換 /v1/audio/transcriptions）。API キー不要。 */
class Qwen3AsrStt implements SttProvider {
  id = "qwen3-asr";
  constructor(
    private baseUrl: string,
    private model: string,
    private fetchImpl: typeof fetch
  ) {}

  /** auto → 省略 / zh → Chinese / ja → Japanese / en → English */
  private langName(lang: SttLang): string | undefined {
    switch (lang) {
      case "zh":
        return "Chinese";
      case "ja":
        return "Japanese";
      case "en":
        return "English";
      default:
        return undefined; // 自動検出
    }
  }

  async transcribe(audio: ArrayBuffer, lang: SttLang): Promise<string> {
    const wav = isWav(audio);
    const form = new FormData();
    form.append("model", this.model);
    form.append(
      "file",
      new Blob([audio], { type: wav ? "audio/wav" : "audio/mpeg" }),
      wav ? "audio.wav" : "audio.mp3"
    );
    const l = this.langName(lang);
    if (l) form.append("language", l);

    const res = await this.fetchImpl(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      body: form as any,
    });
    if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.text ?? "";
  }
}

class OpenaiStt implements SttProvider {
  id = "openai";
  constructor(private apiKey: string, private fetchImpl: typeof fetch) {}

  async transcribe(audio: ArrayBuffer, lang: SttLang): Promise<string> {
    const wav = isWav(audio);
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append(
      "file",
      new Blob([audio], { type: wav ? "audio/wav" : "audio/mpeg" }),
      wav ? "audio.wav" : "audio.mp3"
    );
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

/** MP3 フレームヘッダからサンプルレートを読み取る（不明な場合は null） */
function mp3SampleRate(bytes: Uint8Array): number | null {
  for (let i = 0; i < Math.min(bytes.length - 4, 4096); i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (bytes[i + 1] >> 3) & 0x03; // 0=MPEG2.5, 2=MPEG2, 3=MPEG1
    const srIdx = (bytes[i + 2] >> 2) & 0x03;
    if (version === 1 || srIdx === 3) return null;
    const base = [44100, 48000, 32000][srIdx];
    return version === 3 ? base : version === 2 ? base / 2 : base / 4;
  }
  return null;
}

/**
 * Google Cloud Speech-to-Text v1 同期 API（speech:recognize）。
 * API キー認証・base64 インライン音声。WAV は LINEAR16、MP3 は MP3 encoding。
 * 同期 API は約 60 秒までのため、WAV は 55 秒・MP3 は 400KB（64kbps ≈ 50 秒）で分割する。
 */
class GoogleStt implements SttProvider {
  id = "google";
  maxChunkSec = 55;
  maxBytesPerRequest = 400_000;
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
    const wav = isWav(audio);
    let encoding: string;
    let sampleRateHertz: number;
    let payload: ArrayBuffer;
    if (wav) {
      const { sampleRate, dataOffset, dataLength } = readWavHeader(audio);
      encoding = "LINEAR16";
      sampleRateHertz = sampleRate;
      payload = audio.slice(dataOffset, dataOffset + dataLength); // ヘッダ除去した PCM
    } else {
      encoding = "MP3";
      sampleRateHertz = mp3SampleRate(new Uint8Array(audio)) ?? 16000;
      payload = audio; // MP3 はフレーム列ごと送る
    }

    const res = await this.fetchImpl(
      `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            encoding,
            sampleRateHertz,
            languageCode: this.langCode(lang),
            enableAutomaticPunctuation: true,
          },
          audio: { content: arrayBufferToBase64(payload) },
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
    case "qwen3-asr":
      return new Qwen3AsrStt(settings.sttBaseUrl, settings.sttModel, fetchImpl);
    default:
      // 黙ったフォールバックは誤設定を隠す（例: OpenAI キーを Groq へ送信して 401）
      throw new Error(`unsupported STT provider: ${settings.sttProvider}（未対応の STT プロバイダーです）`);
  }
}
