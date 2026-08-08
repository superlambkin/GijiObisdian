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
  autoSaveTranscript: boolean;
  transcriptSaveDir: string;
  fileNameTemplate: string;
  appendRecordEnabled: boolean;
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
  autoSaveTranscript: true,
  transcriptSaveDir: "Clippings",
  fileNameTemplate: "議事録_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分",
  appendRecordEnabled: true,
};

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { runSttTest } from "./test/sttTest";

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
      .setName("🧪 测试转写")
      .setDesc("用内置语音样本验证 STT 转换是否可用")
      .addButton((btn) =>
        btn.setButtonText("开始测试").onClick(async () => {
          btn.setDisabled(true).setButtonText("测试中…");
          try {
            const res = await runSttTest(this.plugin.settings);
            if (res.ok) new Notice(`✅ 转写成功: ${res.text}`);
            else new Notice(`❌ 测试失败: ${res.error}`);
          } finally {
            btn.setDisabled(false).setButtonText("开始测试");
          }
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

    new Setting(containerEl)
      .setName("自动保存转写为 MD")
      .setDesc("录音转文本后自动保存为 Markdown 文档")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.autoSaveTranscript)
          .onChange(async (v: boolean) => {
            this.plugin.settings.autoSaveTranscript = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("转写保存目录")
      .setDesc("转写 MD 在 OB 内的保存位置（默认 Clippings）")
      .addText((t) =>
        t.setValue(this.plugin.settings.transcriptSaveDir).onChange(async (v: string) => {
          this.plugin.settings.transcriptSaveDir = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("文件名模板")
      .setDesc("转写 MD 的文件名。占位符: {{year}} {{month}} {{day}} {{hour}} {{minute}} {{second}} {{date}} {{time}}")
      .addText((t) =>
        t.setValue(this.plugin.settings.fileNameTemplate).onChange(async (v: string) => {
          this.plugin.settings.fileNameTemplate = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("追加录音")
      .setDesc("开启后，若同名（同时间精度）议事录已存在，则将新转写内容追加到该文件而非新建")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.appendRecordEnabled)
          .onChange(async (v: boolean) => {
            this.plugin.settings.appendRecordEnabled = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
