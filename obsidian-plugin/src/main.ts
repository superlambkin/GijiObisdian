import { Notice, Plugin, TFile } from "obsidian";
import { join } from "path";
import { DEFAULT_SETTINGS, GijiSettings, GijiSettingsTab } from "./settings";
import { startSegment, stopSegment, setLevelMeterApi, isSegmentRecording } from "./commands/recordSegment";
import { isTranscriptNote, summarizeFromNote } from "./commands/summarizeNote";
import { importAudioFlow } from "./ui/filePicker";
import { openRecordingFilePicker } from "./commands/transcribeFile";
import { setupClaudianButton } from "./ui/claudianButton";
import { ensureTemplatesDir } from "./notes/minutesTemplate";
import { RecordingTimer } from "./ui/recordingTimer";
import { LevelMeter, injectLevelMeterStyles } from "./ui/levelMeter";
import { LevelMonitor } from "./audio/levelMonitor";
import { injectRecordingStyles } from "./ui/recordingStyles";
import { injectSettingsTabStyles } from "./ui/settingsTabsStyles";
import { LLM_PRESETS } from "./providers/llmPresets";
import { initLogRecorder, info as logInfo } from "./debug/logRecorder";
import { setPluginContext } from "./audio/pluginContext";

const STT_PROVIDERS = ["openai", "google", "groq", "whisper-local", "mywhisper"];
export const LLM_PROVIDERS = Object.keys(LLM_PRESETS);

export default class GijiPlugin extends Plugin {
  settings: GijiSettings = DEFAULT_SETTINGS;
  recordingTimer!: RecordingTimer;
  levelMeter!: LevelMeter;
  levelMonitor!: LevelMonitor;
  claudianUi: { cleanup: () => void; refresh: () => void } | null = null;

  async onload() {
    await this.loadSettings();
    // ログレコーダーを早期初期化（以降の失敗記録のため）
    initLogRecorder(this.manifest.dir);
    // FFmpeg 用に App 参照を共有（Blob URL 生成で必要）
    setPluginContext(this.app, this.manifest.dir);
    logInfo("plugin", "onload", { version: this.manifest.version });
    // テンプレートフォルダをインストール先に作成し、デフォルトテンプレートを格納
    await ensureTemplatesDir(this.app, this.manifest.dir);

    injectRecordingStyles();
    injectSettingsTabStyles();
    injectLevelMeterStyles();
    // v0.15: ステータスバーは「[レベルメーター][録音タイマー]」の順にする
    this.levelMeter = new LevelMeter(this.addStatusBarItem());
    this.recordingTimer = new RecordingTimer(this.addStatusBarItem());
    this.register(() => this.recordingTimer.stop());
    // v0.15: 録音前入力チェック（設定画面の「🎤 入力テスト」ボタンから使う）
    this.levelMonitor = new LevelMonitor(this.app, this.manifest.dir, this.levelMeter, {
      isRecording: () => isSegmentRecording(),
      onNotice: (m) => new Notice(m),
    });
    // レビュー指摘: 入力テスト中のプラグイン無効化/再読込でリソースが残るため解放する
    this.register(() => this.levelMonitor.stop());
    setLevelMeterApi({ meter: this.levelMeter, isRecording: () => isSegmentRecording() });

    this.addSettingTab(new GijiSettingsTab(this.app, this));

    const claudianUi = setupClaudianButton(this, this.settings, this.recordingTimer);
    this.register(claudianUi.cleanup);
    this.claudianUi = claudianUi;

    this.addCommand({
      id: "record-start",
      name: "开始录音（会议分段）",
      callback: () => startSegment(this.app, this.settings, this.manifest.dir, this.recordingTimer),
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

    // リボン: 録音ファイルを開いて文字起こし（設定画面ボタンから移設）
    this.addRibbonIcon("file-audio", "録音ファイルを開いて文字起こし", () => {
      void openRecordingFilePicker(this.app, this.settings);
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
      this.settings.sttProvider = "whisper-local";
    }
    if (!LLM_PROVIDERS.includes(this.settings.llmProvider)) {
      this.settings.llmProvider = "claudian";
    }
    // Whisper モデル保存先の既定値（未設定時のみ・初回ロード時に設定）
    if (!this.settings.sttWhisperModelDir) {
      this.settings.sttWhisperModelDir = join(this.manifest.dir ?? "", "Model");
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.claudianUi?.refresh();
  }
}
