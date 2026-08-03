export type SttLang = "auto" | "zh" | "ja" | "en";
export type SttProviderId = "groq" | "openai" | "doubao";
export type LlmProviderId = "cloud" | "ollama";

export interface GijiSettings {
  sttProvider: SttProviderId;
  sttApiKey: string;
  sttLang: SttLang;
  llmProvider: LlmProviderId;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  bridgeBaseUrl: string;
  minutesTemplate: string;
  outputDir: string;
  keepTranscript: boolean;
}

export const DEFAULT_SETTINGS: GijiSettings = {
  sttProvider: "groq",
  sttApiKey: "",
  sttLang: "auto",
  llmProvider: "cloud",
  llmBaseUrl: "https://api.deepseek.com/v1",
  llmModel: "deepseek-chat",
  llmApiKey: "",
  bridgeBaseUrl: "http://127.0.0.1:17890",
  minutesTemplate: "",
  outputDir: "📋 纪要",
  keepTranscript: true,
};
