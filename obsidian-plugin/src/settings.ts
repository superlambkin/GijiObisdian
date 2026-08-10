import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

export type SttLang = "auto" | "zh" | "ja" | "en";
export type SttProviderId = "openai" | "google" | "groq" | "qwen3-asr";
import type { LlmPresetId as LlmProviderId } from "./providers/llmPresets";
export type { LlmProviderId };
export type LlmApiFormat = "openai" | "anthropic";
/** STT provider 別に保存する設定（API キーを provider 間で共有しない） */
export interface SttProviderProfile {
  sttApiKey?: string;
}
/** provider 別に保存する LLM 設定（API キー・モデル名・URL などを共有しない） */
export interface LlmProviderProfile {
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiFormat?: LlmApiFormat;
  anthropicVersion?: string;
  llmMaxTokens?: number;
  llmTimeoutMs?: number;
  llmMaxRetries?: number;
  llmApiFormatOverride?: boolean;
  llmThinkingEnabled?: boolean;
}
export type MinutesTemplateSource = "vault" | "directory";
export type AudioSourceId = "mic" | "pcLoopback" | "mix";
export type RecordingMethodId = "bridge" | "direct";

export interface GijiSettings {
  // ② 文字起こし
  sttProvider: SttProviderId;
  sttApiKey: string;
  /** 🔜 qwen3-asr ローカルサーバ URL（既定 http://127.0.0.1:9000/v1） */
  sttBaseUrl: string;
  /** 🔜 qwen3-asr モデル名（既定 qwen3-asr-0.6b） */
  sttModel: string;
  sttLang: SttLang;
  /** STT provider 別に保存した API キープロファイル */
  sttProviderProfiles?: Record<string, SttProviderProfile>;
  // ③ 要約
  llmProvider: LlmProviderId;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  llmApiFormat: LlmApiFormat;
  anthropicVersion: string;
  llmMaxTokens: number;
  /** LLM 1 試行あたりのタイムアウト ms（デフォルト 90000） */
  llmTimeoutMs: number;
  /** LLM リトライ回数（デフォルト 2。0 で無効） */
  llmMaxRetries: number;
  /** 上級者向け詳細設定の折り畳み状態（永続化） */
  llmAdvancedOpen: boolean;
  /** API 形式を preset ではなく手動で上書きする */
  llmApiFormatOverride: boolean;
  /** Anthropic 互換で thinking（推論）を有効にするか（DeepSeek 等の thinking モデル用） */
  llmThinkingEnabled: boolean;
  /** provider 別に保存した LLM 設定プロファイル（API キー・モデル名・URL などを共有しない） */
  llmProviderProfiles?: Record<string, LlmProviderProfile>;
  /** 性能調査用デバッグログ（logs/giji-YYYY-MM-DD.log）を出力する */
  debugLog: boolean;
  autoSummarizeEnabled: boolean;
  outputDir: string;
  keepTranscript: boolean;
  minutesTemplateSource: MinutesTemplateSource;
  minutesTemplateVaultPath: string;
  minutesTemplateFile: string;
  // ① 録音
  bridgeBaseUrl: string;
  bridgeDir: string;
  recordingSaveDir: string;
  recordingFileNameTemplate: string;
  audioSource: AudioSourceId;
  recordingMethod: RecordingMethodId;
  appendRecordEnabled: boolean;
  // ② 文字起こし（保存・挿入）
  autoSaveTranscript: boolean;
  transcriptSaveDir: string;
  fileNameTemplate: string;
  transcriptFileNameTemplate: string;
  insertToClaudianEnabled: boolean;
  // ④ その他
  emailSummaryEnabled: boolean;
}

/** 録音ファイル保存場所のデフォルト（PC の絶対パス: C:\Users\<ユーザ名>\Music\GijiObsidian） */
export const DEFAULT_RECORDING_SAVE_DIR = join(homedir(), "Music", "GijiObsidian");

/** 録音手法がブリッジ以外（ダイレクト録音）のとき、ブリッジ関連設定をグレーアウトする */
export function isBridgeSettingDisabled(recordingMethod: string): boolean {
  return recordingMethod !== "bridge";
}

export const DEFAULT_SETTINGS: GijiSettings = {
  sttProvider: "openai",
  sttApiKey: "",
  sttBaseUrl: "http://127.0.0.1:9000/v1",
  sttModel: "qwen3-asr-0.6b",
  sttLang: "auto",
  sttProviderProfiles: {},
  llmProvider: "claudian",
  llmBaseUrl: "https://api.deepseek.com/v1",
  llmModel: "deepseek-v4-flash",
  llmApiKey: "",
  llmApiFormat: "openai",
  anthropicVersion: "2023-06-01",
  llmMaxTokens: 32000,
  llmTimeoutMs: 90000,
  llmMaxRetries: 2,
  llmAdvancedOpen: false,
  llmApiFormatOverride: false,
  llmThinkingEnabled: false,
  llmProviderProfiles: {},
  debugLog: true,
  autoSummarizeEnabled: true,
  outputDir: "議事録",
  keepTranscript: true,
  minutesTemplateSource: "vault",
  minutesTemplateVaultPath: "00_Vault管理/議事録テンプレート.md",
  minutesTemplateFile: "議事録テンプレート.md",
  bridgeBaseUrl: "http://127.0.0.1:17890",
  bridgeDir: "D:\\AI-Agent\\giji-obsidian\\recorder-bridge",
  recordingSaveDir: DEFAULT_RECORDING_SAVE_DIR,
  recordingFileNameTemplate: "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分{{second}}秒",
  audioSource: "mix",
  recordingMethod: "bridge",
  appendRecordEnabled: true,
  autoSaveTranscript: true,
  transcriptSaveDir: "議事録",
  fileNameTemplate: "議事録_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分",
  transcriptFileNameTemplate: "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分",
  insertToClaudianEnabled: true,
  emailSummaryEnabled: false,
};

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { runSttTest } from "./test/sttTest";
import { runLlmTest } from "./test/llmTest";
import {
  LlmPresetId,
  LLM_PRESETS,
  applyPreset,
  PRESET_DISPLAY_ORDER,
  switchLlmProvider,
  saveProviderProfile,
} from "./providers/llmPresets";
import { switchSttProvider, saveSttProviderProfile } from "./providers/sttProfiles";

/** 設定画面のタブ ID */
export type SettingsTabId = "recording" | "transcript" | "summary" | "other";

/** 設定画面のタブ定義（表示順） */
export const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: "recording", label: "① 🎙️ 録音" },
  { id: "transcript", label: "② 📝 文字起こし" },
  { id: "summary", label: "③ 🤖 要約" },
  { id: "other", label: "④ ⚙️ その他" },
];

export class GijiSettingsTab extends PluginSettingTab {
  /** 現在アクティブな設定タブ */
  activeTab: SettingsTabId = "recording";

  constructor(app: App, private plugin: any) {
    super(app, plugin);
  }

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
  }

  /**
   * LLM 接続テストを実行し、成功時は設定（対応 LLM の API キー含む）を永続化する。
   * 入力欄の onChange 保存に依存せず、テスト成功を保存の確実な契機とする。
   */
  async handleLlmTest(): Promise<void> {
    const s = this.plugin.settings as GijiSettings;
    const res = await runLlmTest(s, this.app);
    if (res.ok) {
      // テスト成功時、この provider の設定（API キー・モデル名・URL など）を
      // provider 別プロファイルに保存してから永続化する
      Object.assign(s, saveProviderProfile(s, s.llmProvider));
      await this.save();
      new Notice(`✅ 接続成功: ${res.text}`);
    } else {
      new Notice(`❌ テスト失敗: ${res.error}`);
    }
  }

  /**
   * STT 接続テストを実行し、成功時はこの provider の API キーを
   * provider 別プロファイルに保存してから永続化する。
   */
  async handleSttTest(): Promise<void> {
    const s = this.plugin.settings as GijiSettings;
    const res = await runSttTest(s);
    if (res.ok) {
      Object.assign(s, saveSttProviderProfile(s, s.sttProvider));
      await this.save();
      new Notice(`✅ 文字起こし成功: ${res.text}`);
    } else {
      new Notice(`❌ テスト失敗: ${res.error}`);
    }
  }

  /** タブ切替（設定内容は display() で再描画） */
  setActiveTab(id: SettingsTabId): void {
    this.activeTab = id;
    if (this.containerEl) void this.display();
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    const version = this.plugin.manifest?.version ?? "0.0.0";
    containerEl.createEl("h2", { text: `GijiObsidian 設定（v${version}）` });

    // タブナビゲーション
    const tabBar = containerEl.createDiv({ cls: "giji-settings-tabs" });
    const content = containerEl.createDiv({ cls: "giji-settings-tab-content" });

    for (const tab of SETTINGS_TABS) {
      const btn = tabBar.createEl("button", {
        text: tab.label,
        cls: `giji-settings-tab${tab.id === this.activeTab ? " is-active" : ""}`,
      });
      btn.addEventListener("click", () => this.setActiveTab(tab.id));
    }

    switch (this.activeTab) {
      case "recording":
        this.renderRecordingTab(content);
        break;
      case "transcript":
        this.renderTranscriptTab(content);
        break;
      case "summary":
        await this.renderSummaryTab(content);
        break;
      case "other":
        this.renderOtherTab(content);
        break;
    }
  }

  /* ==================== ① 🎙️ 録音 ==================== */
  renderRecordingTab(content: HTMLElement): void {
    const s = this.plugin.settings as GijiSettings;

    new Setting(content)
      .setName("① 🎙️ 録音")
      .setDesc("マイク → ローカル録音ブリッジ（Python FastAPI）で WAV を録音します")
      .setHeading();

    new Setting(content)
      .setName("🎙️ 録音手法")
      .setDesc("PC ダイレクト録音はブリッジ不要でマイクのみ。Teams 会議（PC 音声）はブリッジ録音を選択")
      .addDropdown((d) =>
        d
          .addOption("bridge", "ブリッジ録音（Python・PC 音声対応）")
          .addOption("direct", "PC ダイレクト録音（ブリッジ不要・マイクのみ）")
          .setValue(s.recordingMethod)
          .onChange(async (v: string) => {
            s.recordingMethod = v as RecordingMethodId;
            await this.save();
            updateBridgeDisabled(v);
          })
      );

    let audioMode: any;
    let bridgeUrl: any;
    let bridgeDir: any;

    new Setting(content)
      .setName("🎙️ 録音モード")
      .setDesc("Teams 会議時は「マイク + PC 音声」を推奨。PC 音声は WASAPI ループバックで取得します（Windows のみ・ブリッジ v0.2.0 以降が必要）")
      .addDropdown((d) => {
        audioMode = d;
        d
          .addOption("mix", "マイク + PC 音声（WASAPI ループバック）")
          .addOption("mic", "マイクのみ（従来）")
          .addOption("pcLoopback", "PC 音声のみ（ループバック）")
          .setValue(s.audioSource ?? "mix")
          .onChange(async (v: string) => {
            s.audioSource = v as AudioSourceId;
            await this.save();
          });
      });

    new Setting(content)
      .setName("ブリッジ URL")
      .addText((t) => {
        bridgeUrl = t;
        t.setValue(s.bridgeBaseUrl).onChange(async (v: string) => {
          s.bridgeBaseUrl = v;
          await this.save();
        });
      });

    new Setting(content)
      .setName("ブリッジのディレクトリ")
      .addText((t) => {
        bridgeDir = t;
        t.setValue(s.bridgeDir).onChange(async (v: string) => {
          s.bridgeDir = v;
          await this.save();
        });
      });

    const updateBridgeDisabled = (method: string) => {
      const disabled = isBridgeSettingDisabled(method);
      audioMode?.setDisabled(disabled);
      bridgeUrl?.setDisabled(disabled);
      bridgeDir?.setDisabled(disabled);
    };
    updateBridgeDisabled(s.recordingMethod);

    new Setting(content)
      .setName("録音ファイルの保存場所")
      .setDesc(`PC の絶対パス（デフォルト: ${DEFAULT_RECORDING_SAVE_DIR}）`)
      .addText((t) =>
        t.setValue(s.recordingSaveDir).onChange(async (v: string) => {
          s.recordingSaveDir = v;
          await this.save();
        })
      );

    new Setting(content)
      .setName("録音ファイル名テンプレート")
      .setDesc("録音ファイルの名前。プレースホルダ: {{year}} {{month}} {{day}} {{hour}} {{minute}} {{second}} {{date}} {{time}}")
      .addText((t) =>
        t.setValue(s.recordingFileNameTemplate).onChange(async (v: string) => {
          s.recordingFileNameTemplate = v;
          await this.save();
        })
      );

    new Setting(content)
      .setName("録音フォーマット")
      .setDesc("MP3 64 kbps（音声向け圧縮・16kHz モノラル）。Whisper の 25MB 制限のため、24MB 以上は自動分割して文字起こしします");

    new Setting(content)
      .setName("📂 録音フォルダを開く")
      .setDesc("録音ファイルの保存場所をエクスプローラーで開きます（無ければ作成）")
      .addButton((btn) =>
        btn.setButtonText("開く").onClick(async () => {
          const dir = (s.recordingSaveDir || "").trim() || DEFAULT_RECORDING_SAVE_DIR;
          try {
            mkdirSync(dir, { recursive: true });
            // 遅延 require: 静的 import だと Node テスト環境で electron を解決できないため
            const { shell } = require("electron");
            const err = await shell.openPath(dir);
            if (err) new Notice(`フォルダを開けませんでした: ${err}`);
          } catch (e: any) {
            new Notice(`フォルダを開けませんでした: ${e?.message ?? e}`);
          }
        })
      );

    new Setting(content)
      .setName("追加録音")
      .setDesc("ON の場合、同じ時間（年月日時が同一）に開始した録音は、その時間の最早の議事録 MD に追記されます")
      .addToggle((t) =>
        t.setValue(s.appendRecordEnabled).onChange(async (v: boolean) => {
          s.appendRecordEnabled = v;
          await this.save();
        })
      );
  }

  /* ==================== ② 📝 文字起こし ==================== */
  renderTranscriptTab(content: HTMLElement): void {
    const s = this.plugin.settings as GijiSettings;

    new Setting(content)
      .setName("② 📝 文字起こし")
      .setDesc("WAV → クラウド STT で文字起こし → 議事録 MD として自動保存します")
      .setHeading();

    new Setting(content)
      .setName("STT プロバイダー")
      .setDesc("切り替えると、接続テスト成功時に保存した provider 別 API キーを自動反映します")
      .addDropdown((d) =>
        d.addOption("openai", "OpenAI（デフォルト）")
          .addOption("google", "Google")
          .addOption("groq", "Groq")
          .addOption("qwen3-asr", "Qwen3-ASR（ローカル）")
          .setValue(s.sttProvider)
          .onChange(async (v: string) => {
            Object.assign(s, switchSttProvider(s, v as SttProviderId));
            await this.save();
            await this.display();
          })
      );

    if (s.sttProvider === "qwen3-asr") {
      new Setting(content)
        .setName("ASR サーバ URL")
        .setDesc("ローカル qwen3-asr サーバ（既定: http://127.0.0.1:9000/v1）")
        .addText((t) =>
          t.setValue(s.sttBaseUrl).onChange(async (v: string) => {
            s.sttBaseUrl = v;
            await this.save();
          })
        );

      new Setting(content)
        .setName("ASR モデル名")
        .setDesc("サーバに送る model 名（既定: qwen3-asr-0.6b）")
        .addText((t) =>
          t.setValue(s.sttModel).onChange(async (v: string) => {
            s.sttModel = v;
            await this.save();
          })
        );
    } else {
      new Setting(content)
        .setName("STT API キー")
        .addText((t) =>
          t.setValue(s.sttApiKey).onChange(async (v: string) => {
            s.sttApiKey = v;
            await this.save();
          })
        );
    }

    new Setting(content)
      .setName("言語")
      .addDropdown((d) =>
        d.addOption("auto", "自動検出")
          .addOption("ja", "日本語")
          .addOption("zh", "中文")
          .addOption("en", "English")
          .setValue(s.sttLang)
          .onChange(async (v: string) => {
            s.sttLang = v as SttLang;
            await this.save();
          })
      );

    new Setting(content)
      .setName("🔌 接続テスト")
      .setDesc("内蔵の音声サンプルで ② 文字起こしの設定が使えるか検証します")
      .addButton((btn) =>
        btn.setButtonText("テスト開始").onClick(async () => {
          btn.setDisabled(true).setButtonText("テスト中…");
          try {
            await this.handleSttTest();
          } finally {
            btn.setDisabled(false).setButtonText("テスト開始");
          }
        })
      );

    new Setting(content)
      .setName("結果を Claudian 入力欄に挿入")
      .setDesc("ON の場合、文字起こし後のテキストを Claudian の入力欄に表示します（デフォルト: ON）")
      .addToggle((t) =>
        t.setValue(s.insertToClaudianEnabled).onChange(async (v: boolean) => {
          s.insertToClaudianEnabled = v;
          await this.save();
        })
      );

    new Setting(content)
      .setName("転写を自動保存")
      .setDesc("録音の文字起こし後、Markdown 文書として自動保存します")
      .addToggle((t) =>
        t.setValue(s.autoSaveTranscript).onChange(async (v: boolean) => {
          s.autoSaveTranscript = v;
          await this.save();
        })
      );

    new Setting(content)
      .setName("転写の保存先")
      .setDesc("転写 MD の Vault 内保存先（デフォルト: 議事録）")
      .addText((t) =>
        t.setValue(s.transcriptSaveDir).onChange(async (v: string) => {
          s.transcriptSaveDir = v;
          await this.save();
        })
      );

    new Setting(content)
      .setName("議事録ファイル名テンプレート")
      .setDesc("議事録 MD のファイル名。プレースホルダ: {{year}} {{month}} {{day}} {{hour}} {{minute}} {{second}} {{date}} {{time}}")
      .addText((t) =>
        t.setValue(s.fileNameTemplate).onChange(async (v: string) => {
          s.fileNameTemplate = v;
          await this.save();
        })
      );

    new Setting(content)
      .setName("転写ファイル名テンプレート（録音_...）")
      .setDesc("文字起こしMDのファイル名。プレースホルダ: {{year}} {{month}} {{day}} {{hour}} {{minute}} {{second}} {{date}} {{time}}")
      .addText((t) =>
        t.setValue(s.transcriptFileNameTemplate).onChange(async (v: string) => {
          s.transcriptFileNameTemplate = v;
          await this.save();
        })
      );
  }

  /* ==================== ③ 🤖 要約 ==================== */
  async renderSummaryTab(content: HTMLElement): Promise<void> {
    const s = this.plugin.settings as GijiSettings;

    new Setting(content)
      .setName("③ 🤖 要約")
      .setDesc("転写テキスト → LLM で議事録を生成します（「音声をインポートして議事録生成」コマンドで使用）")
      .setHeading();

    // === 基本セクション（常時表示） ===

    new Setting(content)
      .setName("🔌 プリセット")
      .setDesc("主要プロバイダのプリセットです。選択すると baseUrl・モデル・API 形式・既定 max tokens が自動入力されます")
      .addDropdown((d) => {
        for (const id of PRESET_DISPLAY_ORDER) {
          d.addOption(id, LLM_PRESETS[id].displayName);
        }
        return d.setValue(s.llmProvider).onChange(async (v: string) => {
          Object.assign(s, switchLlmProvider(s, v as LlmPresetId));
          await this.save();
          await this.display();
        });
      });

    new Setting(content)
      .setName("🔑 API キー")
      .setDesc(
        LLM_PRESETS[s.llmProvider as keyof typeof LLM_PRESETS]?.apiKeyHint ??
          "LLM プロバイダの API キー"
      )
      .addText((t) =>
        t.setValue(s.llmApiKey).onChange(async (v: string) => {
          s.llmApiKey = v;
          await this.save();
        })
      );

    new Setting(content)
      .setName("🧪 接続テスト")
      .setDesc("プリセット＋API キーで疎通確認します。claudian はプラグイン連携を検出")
      .addButton((btn) =>
        btn.setButtonText("テスト開始").onClick(async () => {
          btn.setDisabled(true).setButtonText("テスト中…");
          try {
            await this.handleLlmTest();
          } finally {
            btn.setDisabled(false).setButtonText("テスト開始");
          }
        })
      );

    // === 上級者向け詳細設定（折り畳み） ===

    new Setting(content)
      .setName("⚙️ 上級者向け詳細設定")
      .setDesc("baseUrl・モデル・API 形式・タイムアウトなどの詳細設定")
      .addToggle((t) =>
        t.setValue(s.llmAdvancedOpen).onChange(async (v: boolean) => {
          s.llmAdvancedOpen = v;
          await this.save();
          await this.display();
        })
      );

    if (s.llmAdvancedOpen) {
      new Setting(content)
        .setName("🧠 Thinking（推論）")
        .setDesc("OFF（デフォルト）: 直接回答（高速）。ON: 思考してから回答（時間がかかる・高品質）。DeepSeek 等の thinking モデルで比較できます")
        .addToggle((t) =>
          t.setValue(s.llmThinkingEnabled === true).onChange(async (v: boolean) => {
            s.llmThinkingEnabled = v;
            await this.save();
          })
        );

      new Setting(content)
        .setName("LLM baseUrl")
        .setDesc("API のエンドポイント URL（プリセット既定を上書き）")
        .addText((t) =>
          t.setValue(s.llmBaseUrl).onChange(async (v: string) => {
            s.llmBaseUrl = v;
            await this.save();
          })
        );

      new Setting(content)
        .setName("LLM モデル")
        .setDesc("モデル ID（例: gpt-4o-mini / claude-3-5-sonnet-latest など）")
        .addText((t) =>
          t.setValue(s.llmModel).onChange(async (v: string) => {
            s.llmModel = v;
            await this.save();
          })
        );

      new Setting(content)
        .setName("LLM API 形式（上書き）")
        .setDesc("プリセット既定ではなく手動で API 形式を選ぶ")
        .addToggle((t) =>
          t
            .setValue(!s.llmApiFormatOverride)
            .setTooltip(s.llmApiFormatOverride ? "ON: 手動上書き" : "OFF: プリセット既定を使用")
            .onChange(async (v: boolean) => {
              s.llmApiFormatOverride = !v;
              await this.save();
              await this.display();
            })
        );

      if (s.llmApiFormatOverride) {
        new Setting(content)
          .setName("API 形式")
          .setDesc("OpenAI 互換（/chat/completions）または Anthropic 互換（/v1/messages）")
          .addDropdown((d) =>
            d
              .addOption("openai", "OpenAI 互換（/chat/completions）")
              .addOption("anthropic", "Anthropic 互換（/v1/messages）")
              .setValue(s.llmApiFormat)
              .onChange(async (v: string) => {
                s.llmApiFormat = v as LlmApiFormat;
                await this.save();
              })
          );
      }

      new Setting(content)
        .setName("Anthropic API バージョン")
        .setDesc("例: 2023-06-01（Anthropic 形式選択時のみ使用）")
        .addText((t) =>
          t.setValue(s.anthropicVersion).onChange(async (v: string) => {
            s.anthropicVersion = v;
            await this.save();
          })
        );

      new Setting(content)
        .setName("Max tokens")
        .setDesc(
          `LLM 出力トークン上限（Anthropic 形式では必須）。プリセット既定: ${
            LLM_PRESETS[s.llmProvider as keyof typeof LLM_PRESETS]?.defaultMaxTokens ?? 32000
          }`
        )
        .addText((t) =>
          t.setValue(String(s.llmMaxTokens)).onChange(async (v: string) => {
            const n = parseInt(v, 10);
            s.llmMaxTokens = Number.isFinite(n) && n > 0 ? n : 32000;
            await this.save();
          })
        );

      new Setting(content)
        .setName("⏱️ LLM タイムアウト（ms）")
        .setDesc("1 試行あたりの上限時間。超えると中断してリトライします（デフォルト: 90000）")
        .addText((t) =>
          t.setValue(String(s.llmTimeoutMs)).onChange(async (v: string) => {
            const n = parseInt(v, 10);
            s.llmTimeoutMs = Number.isFinite(n) && n > 0 ? n : 90000;
            await this.save();
          })
        );

      new Setting(content)
        .setName("🔁 LLM リトライ回数")
        .setDesc("タイムアウト・429・5xx 時に指数バックオフで再試行する回数（デフォルト: 2。0 で無効）")
        .addText((t) =>
          t.setValue(String(s.llmMaxRetries)).onChange(async (v: string) => {
            const n = parseInt(v, 10);
            s.llmMaxRetries = Number.isFinite(n) && n >= 0 ? n : 2;
            await this.save();
          })
        );

      new Setting(content)
        .setName("📋 要約自動生成")
        .setDesc("ON の場合、転写完了後に自動で議事録を生成します（OFF で従来通り）")
        .addToggle((t) =>
          t.setValue(s.autoSummarizeEnabled).onChange(async (v: boolean) => {
            s.autoSummarizeEnabled = v;
            await this.save();
          })
        );

      new Setting(content)
        .setName("📝 デバッグログ出力")
        .setDesc("ON で giji-obsidian/logs/ に日次ログを書き出します。プラグイン性能調査用。")
        .addToggle((t) =>
          t.setValue(s.debugLog).onChange(async (v: boolean) => {
            s.debugLog = v;
            await this.save();
          })
        );
    }

    new Setting(content)
      .setName("議事録テンプレートの場所")
      .setDesc("Vault 内の MD か、プラグインディレクトリのテンプレートフォルダから選択します")
      .addDropdown((d) =>
        d.addOption("vault", "Vault（デフォルト）")
          .addOption("directory", "プラグインディレクトリ")
          .setValue(s.minutesTemplateSource)
          .onChange(async (v: string) => {
            s.minutesTemplateSource = v as MinutesTemplateSource;
            await this.save();
            await this.display(); // 入力欄を切り替えるため再描画
          })
      );

    if (s.minutesTemplateSource === "directory") {
      const templatesDir = `${this.plugin.manifest.dir}/templates`;
      const setting = new Setting(content)
        .setName("テンプレートファイル")
        .setDesc(`${templatesDir} 内の MD ファイルから選択します`);
      try {
        const listed = await this.app.vault.adapter.list(templatesDir);
        const files = (listed.files as string[])
          .filter((f) => f.endsWith(".md"))
          .map((f) => f.split("/").pop() ?? f)
          .sort();
        setting.addDropdown((d) => {
          for (const f of files) d.addOption(f, f);
          if (files.length === 0) d.addOption("", "（テンプレートがありません）");
          d.setValue(files.includes(s.minutesTemplateFile) ? s.minutesTemplateFile : files[0] ?? "")
            .onChange(async (v: string) => {
              s.minutesTemplateFile = v;
              await this.save();
            });
        });
      } catch {
        setting.setDesc(`⚠️ ${templatesDir} を読み込めませんでした（プラグイン再読み込みで作成されます）`);
      }
    } else {
      new Setting(content)
        .setName("テンプレートのパス")
        .setDesc("Vault 内のテンプレート MD（デフォルト: 00_Vault管理/議事録テンプレート.md）")
        .addText((t) =>
          t.setValue(s.minutesTemplateVaultPath).onChange(async (v: string) => {
            s.minutesTemplateVaultPath = v;
            await this.save();
          })
        );
    }

    new Setting(content)
      .setName("議事録の保存先")
      .setDesc("生成した議事録 MD の Vault 内保存先（デフォルト: 議事録）")
      .addText((t) =>
        t.setValue(s.outputDir).onChange(async (v: string) => {
          s.outputDir = v;
          await this.save();
        })
      );

    new Setting(content)
      .setName("議事録に転写原文を含める")
      .setDesc("ON の場合、生成した議事録 MD に完全な転写原文を添付します")
      .addToggle((t) =>
        t.setValue(s.keepTranscript).onChange(async (v: boolean) => {
          s.keepTranscript = v;
          await this.save();
        })
      );
  }

  /* ==================== ④ ⚙️ その他 ==================== */
  renderOtherTab(content: HTMLElement): void {
    const s = this.plugin.settings as GijiSettings;

    new Setting(content)
      .setName("④ ⚙️ その他")
      .setHeading();

    new Setting(content)
      .setName("要約メール添付")
      .setDesc("（準備中）要約生成後にメールへ添付して送信します（デフォルト: OFF）")
      .addToggle((t) =>
        t.setValue(s.emailSummaryEnabled).onChange(async (v: boolean) => {
          s.emailSummaryEnabled = v;
          await this.save();
        })
      );
  }
}
