import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, GijiSettings, GijiSettingsTab } from "./settings";
import { startSegment, stopSegment } from "./commands/recordSegment";
import { importAudioFlow } from "./ui/filePicker";
import { setupClaudianButton } from "./ui/claudianButton";
import { ensureTemplatesDir } from "./notes/minutesTemplate";
import { RecordingTimer } from "./ui/recordingTimer";

const STT_PROVIDERS = ["openai", "google", "groq"];
const LLM_PROVIDERS = ["claudian", "cloud", "ollama"];

export default class GijiPlugin extends Plugin {
  settings: GijiSettings = DEFAULT_SETTINGS;
  recordingTimer!: RecordingTimer;

  async onload() {
    await this.loadSettings();
    // テンプレートフォルダをインストール先に作成し、デフォルトテンプレートを格納
    await ensureTemplatesDir(this.app, this.manifest.dir);

    this.recordingTimer = new RecordingTimer(this.addStatusBarItem());

    this.addSettingTab(new GijiSettingsTab(this.app, this));

    this.register(setupClaudianButton(this, this.settings));

    this.addCommand({
      id: "record-start",
      name: "开始录音（会议分段）",
      callback: () => startSegment(this.app, this.settings, this.recordingTimer),
    });
    this.addCommand({
      id: "record-stop",
      name: "停止并转写（追加到笔记）",
      callback: () => stopSegment(this.app, this.settings, this.manifest.dir, this.recordingTimer),
    });
    this.addCommand({
      id: "import-audio",
      name: "导入音频生成会议纪要",
      callback: () => importAudioFlow(this.app, this.settings, this.manifest.dir),
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // 廃止・未対応プロバイダー値のマイグレーション（例: doubao / 旧デフォルト groq）
    if (!STT_PROVIDERS.includes(this.settings.sttProvider)) {
      this.settings.sttProvider = "openai";
    }
    if (!LLM_PROVIDERS.includes(this.settings.llmProvider)) {
      this.settings.llmProvider = "claudian";
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
