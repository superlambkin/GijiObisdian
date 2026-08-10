import { Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, GijiSettings, GijiSettingsTab } from "./settings";
import { startSegment, stopSegment } from "./commands/recordSegment";
import { isTranscriptNote, summarizeFromNote } from "./commands/summarizeNote";
import { importAudioFlow } from "./ui/filePicker";
import { setupClaudianButton } from "./ui/claudianButton";
import { ensureTemplatesDir } from "./notes/minutesTemplate";
import { RecordingTimer } from "./ui/recordingTimer";
import { injectRecordingStyles } from "./ui/recordingStyles";
import { injectSettingsTabStyles } from "./ui/settingsTabsStyles";
import { LLM_PRESETS } from "./providers/llmPresets";

const STT_PROVIDERS = ["openai", "google", "groq", "qwen3-asr", "whisper-small"];
export const LLM_PROVIDERS = Object.keys(LLM_PRESETS);

export default class GijiPlugin extends Plugin {
  settings: GijiSettings = DEFAULT_SETTINGS;
  recordingTimer!: RecordingTimer;
  claudianUi: { cleanup: () => void; refresh: () => void } | null = null;

  async onload() {
    await this.loadSettings();
    // テンプレートフォルダをインストール先に作成し、デフォルトテンプレートを格納
    await ensureTemplatesDir(this.app, this.manifest.dir);

    injectRecordingStyles();
    injectSettingsTabStyles();
    this.recordingTimer = new RecordingTimer(this.addStatusBarItem());
    this.register(() => this.recordingTimer.stop());

    this.addSettingTab(new GijiSettingsTab(this.app, this));

    const claudianUi = setupClaudianButton(this, this.settings, this.recordingTimer);
    this.register(claudianUi.cleanup);
    this.claudianUi = claudianUi;

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

    // 録音MD の右クリックメニューに「議事録要約」を追加
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || !isTranscriptNote(this.app, file)) return;
        menu.addItem((item) =>
          item
            .setTitle("議事録要約")
            .setIcon("file-text")
            .onClick(() => {
              void summarizeFromNote(
                this.app,
                this.settings,
                this.manifest.dir ?? "",
                file,
                this.recordingTimer
              );
            })
        );
      })
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // 廃止・未対応プロバイダー値のマイグレーション（例: doubao / 旧デフォルト groq）
    if (!STT_PROVIDERS.includes(this.settings.sttProvider)) {
      this.settings.sttProvider = "qwen3-asr";
    }
    if (!LLM_PROVIDERS.includes(this.settings.llmProvider)) {
      this.settings.llmProvider = "claudian";
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.claudianUi?.refresh();
  }
}
