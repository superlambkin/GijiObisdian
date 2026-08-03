import { GijiSettings } from "../settings";

export interface LlmProvider {
  id: string;
  complete(system: string, user: string): Promise<string>;
}

class OpenAiCompatibleLlm implements LlmProvider {
  constructor(
    public id: string,
    private baseUrl: string,
    private model: string,
    private apiKey: string,
    private fetchImpl: typeof fetch
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
}

export function createLlmProvider(
  settings: GijiSettings,
  fetchImpl: typeof fetch = fetch
): LlmProvider {
  if (settings.llmProvider === "ollama") {
    return new OpenAiCompatibleLlm("ollama", settings.llmBaseUrl, settings.llmModel, "", fetchImpl);
  }
  return new OpenAiCompatibleLlm("cloud", settings.llmBaseUrl, settings.llmModel, settings.llmApiKey, fetchImpl);
}
