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
  bridgeDir: string;
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
  bridgeDir: "D:\\AI-Agent\\giji-obsidian\\recorder-bridge",
  minutesTemplate: "",
  outputDir: "📋 纪要",
  keepTranscript: true,
};

import { App, PluginSettingTab, Setting } from "obsidian";

export class GijiSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: any) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "GijiObsidian 设置" });

    new Setting(containerEl)
      .setName("STT Provider")
      .addDropdown((d) =>
        d.addOption("groq", "Groq Whisper")
          .addOption("openai", "OpenAI Whisper")
          .addOption("doubao", "豆包")
          .setValue(this.plugin.settings.sttProvider)
          .onChange(async (v: string) => {
            this.plugin.settings.sttProvider = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("STT API Key")
      .addText((t) =>
        t.setValue(this.plugin.settings.sttApiKey).onChange(async (v: string) => {
          this.plugin.settings.sttApiKey = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("语言")
      .addDropdown((d) =>
        d.addOption("auto", "自动检测")
          .addOption("zh", "中文")
          .addOption("ja", "日本語")
          .addOption("en", "English")
          .setValue(this.plugin.settings.sttLang)
          .onChange(async (v: string) => {
            this.plugin.settings.sttLang = v as any;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("LLM baseUrl")
      .addText((t) =>
        t.setValue(this.plugin.settings.llmBaseUrl).onChange(async (v: string) => {
          this.plugin.settings.llmBaseUrl = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("LLM API Key")
      .addText((t) =>
        t.setValue(this.plugin.settings.llmApiKey).onChange(async (v: string) => {
          this.plugin.settings.llmApiKey = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("录音桥地址")
      .addText((t) =>
        t.setValue(this.plugin.settings.bridgeBaseUrl).onChange(async (v: string) => {
          this.plugin.settings.bridgeBaseUrl = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("录音桥目录")
      .addText((t) =>
        t.setValue(this.plugin.settings.bridgeDir).onChange(async (v: string) => {
          this.plugin.settings.bridgeDir = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
