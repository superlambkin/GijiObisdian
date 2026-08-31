import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

export type SttLang = "auto" | "zh" | "ja" | "en";
export type SttProviderId = "openai" | "google" | "groq" | "whisper-local" | "mywhisper";

/** STT カテゴリ（ローカル / クラウド）。sttProvider から導出する */
export const LOCAL_STT_PROVIDERS: readonly SttProviderId[] = ["whisper-local", "mywhisper"];
export const CLOUD_STT_PROVIDERS: readonly SttProviderId[] = ["openai", "google", "groq"];

export const STT_PROVIDER_LABELS: Record<SttProviderId, string> = {
  openai: "OpenAI",
  google: "Google",
  groq: "Groq",
  "whisper-local": "Whisper（ローカル・faster-whisper）",
  "mywhisper": "MyWhisper（ローカル・POC_020）",
};

export type WhisperModelId = "tiny" | "small" | "medium";

export const WHISPER_MODELS: Record<WhisperModelId, {
  repo: string;
  sizeBytes: number;
  displayName: string;
}> = {
  tiny:   { repo: "Systran/faster-whisper-tiny",   sizeBytes: 75_000_000,   displayName: "Tiny（最速・75MB）" },
  small:  { repo: "Systran/faster-whisper-small",  sizeBytes: 488_000_000,  displayName: "Small（バランス・488MB）" },
  medium: { repo: "Systran/faster-whisper-medium", sizeBytes: 1_500_000_000, displayName: "Medium（高精度・1.5GB）" },
};

export function isLocalSttProvider(p: string): boolean {
  return (LOCAL_STT_PROVIDERS as readonly string[]).includes(p);
}
import type { LlmPresetId as LlmProviderId } from "./providers/llmPresets";
export type { LlmProviderId };
export type LlmApiFormat = "openai" | "anthropic";
/** STT provider 別に保存する設定（API キーのみ provider 間で共有しない） */
export interface SttProviderProfile {
  sttApiKey?: string;
  /** STT API の Base URL（openai / groq 互換 provider 用） */
  sttBaseUrl?: string;
  /** MyWhisper (POC_020) ASR サーバ Base URL */
  sttMyWhisperBaseUrl?: string;
  /** MyWhisper 用 Bearer Token（:9000 は無認証のため通常空） */
  sttMyWhisperToken?: string;
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

export interface GijiSettings {
  // ② 文字起こし
  sttProvider: SttProviderId;
  sttApiKey: string;
  /** Whisper ローカルサーバ URL（OpenAI 互換・既定 http://127.0.0.1:9000/v1） */
  sttBaseUrl: string;
  /** Whisper（faster-whisper）モデル ID（既定 small） */
  sttWhisperModel: WhisperModelId;
  /** Whisper モデルの保存ディレクトリ（空文字ならロード時に Vault パスから動的決定） */
  sttWhisperModelDir: string;
  /** 🔜 ローカル ASR サーバのディレクトリ（自動起動用） */
  sttServerDir: string;
  sttLang: SttLang;
  /** STT 送信の並列度（1〜4）。デフォルト 2 */
  sttMaxConcurrency: number;
  /** STT provider 別に保存した API キープロファイル */
  sttProviderProfiles?: Record<string, SttProviderProfile>;
  /** MyWhisper ASR サーバ Base URL (POC_020 本地 ASR) */
  sttMyWhisperBaseUrl: string;
  /** MyWhisper 用 Bearer Token（:9000 は無認証のため通常空） */
  sttMyWhisperToken: string;
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
  recordingSaveDir: string;
  recordingFileNameTemplate: string;
  audioSource: AudioSourceId;
  appendRecordEnabled: boolean;
  /** PC ダイレクト録音時に getUserMedia に渡すマイク deviceId。空文字ならシステム既定 */
  directMicDeviceId: string;
  /** PC ダイレクト録音時のスピーカー指定（getUserMedia は出力デバイスを受け取らないため現状は保存のみ） */
  directSpeakerDeviceId: string;
  /** WASAPI ループバック同梱スクリプトのディレクトリ（空文字なら同梱既定 manifest.dir） */
  pcLoopbackScriptDir: string;
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

/** STT 並列度を有効範囲（1〜4）にクランプする */
export function clampSttConcurrency(value: number): number {
  return Math.max(1, Math.min(4, Math.floor(value)));
}

export const DEFAULT_SETTINGS: GijiSettings = {
  sttProvider: "groq",
  sttApiKey: "",
  sttBaseUrl: "http://127.0.0.1:9000/v1",
  sttWhisperModel: "small",
  sttWhisperModelDir: "",
  sttServerDir: "",
  sttLang: "auto",
  sttMaxConcurrency: 2,
  sttProviderProfiles: {},
  sttMyWhisperBaseUrl: "http://192.168.0.88:9000/",
  sttMyWhisperToken: "",
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
  recordingSaveDir: DEFAULT_RECORDING_SAVE_DIR,
  recordingFileNameTemplate: "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分{{second}}秒",
  audioSource: "mix",
  appendRecordEnabled: true,
  directMicDeviceId: "",
  directSpeakerDeviceId: "",
  pcLoopbackScriptDir: "",
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
import { listDevices, DeviceListResult } from "./audio/deviceList";
import {
  LlmPresetId,
  LLM_PRESETS,
  applyPreset,
  PRESET_DISPLAY_ORDER,
  switchLlmProvider,
  saveProviderProfile,
} from "./providers/llmPresets";
import { switchSttProvider, saveSttProviderProfile } from "./providers/sttProfiles";
import { getModelStatus, checkModelExists, downloadWhisperModel, ModelDlStatus } from "./whisperModelManager";
import { ensureWhisperLocalServer } from "./whisperLocalLauncher";
import { writeDebugLog } from "./util/debugLog";
import { nodeFetch } from "./providers/nodeFetch";

/** 設定画面のタブ ID */
export type SettingsTabId = "recording" | "transcript" | "summary" | "other";

/** 設定画面のタブ定義（表示順） */
export const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: "recording", label: "① 🎙️ 録音" },
  { id: "transcript", label: "② 📝 文字起こし" },
  { id: "summary", label: "③ 🤖 要約" },
  { id: "other", label: "④ ⚙️ その他" },
];

/** モデル DL 状態の表示テキスト */
function renderStatusText(status: ModelDlStatus): string {
  switch (status) {
    case "not-downloaded": return "❌ 未ダウンロード";
    case "downloading":    return "⏳ DL中…";
    case "downloaded":     return "✅ DL済";
    case "error":          return "❌ DL失敗";
  }
}

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
  async handleSttTest(fetchImpl: typeof fetch = nodeFetch): Promise<void> {
    const s = this.plugin.settings as GijiSettings;
    const res = await runSttTest(s, fetchImpl);
    if (res.ok) {
      Object.assign(s, saveSttProviderProfile(s, s.sttProvider));
      await this.save();
      new Notice(`✅ 文字起こし成功: ${res.text}`);
    } else {
      new Notice(`❌ テスト失敗: ${res.error}`);
      await writeDebugLog(
        this.app,
        this.plugin.manifest.dir,
        `stage=stt-test status=fail provider=${s.sttProvider} baseUrl=${JSON.stringify(s.sttBaseUrl)} error="${res.error}"`,
      );
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
            // v0.8.6: 録音手法切替時は録音モードの選択肢を再構築（direct / bridge どちらも全オプション）
            refreshAudioModeOptions();
            // v0.5: 手法切替時は対応モードのデバイス ID 表示に切替＋一覧を最新化
            micDeviceDropdown?.setValue(
              (s.recordingMethod === "bridge" ? s.bridgeMicDeviceId : s.directMicDeviceId) || ""
            );
            speakerDeviceDropdown?.setValue(
              (s.recordingMethod === "bridge" ? s.bridgeSpeakerDeviceId : s.directSpeakerDeviceId) || ""
            );
            void repopulateDevices();
            // v0.8.5: 録音モードが mic のままなら PC 音声が録音されないため案内
            if (s.audioSource === "mic") {
              new Notice(
                "💡 PC 音声も録音するには「録音モード」を「マイク + PC 音声（WASAPI ループバック）」に切り替えてください"
              );
            }
          })
      );

    let audioMode: any;
    let bridgeUrl: any;
    let bridgeDir: any;

    /**
     * v0.8.6: audioSource ドロップダウンを再構築する。
     * direct / bridge どちらも mix / mic / pcLoopback を選択可能。
     * - direct + mix: getDisplayMedia（画面共有）で PC 音声を取得しマイクとミックス
     * - direct + pcLoopback: getDisplayMedia のみ
     * - bridge + mix: WASAPI ループバック
     */
    const refreshAudioModeOptions = (): void => {
      if (!audioMode) return;
      audioMode.selectEl.innerHTML = "";
      audioMode.addOption("mix", "マイク + PC 音声（WASAPI ループバック）");
      audioMode.addOption("mic", "マイクのみ（従来）");
      audioMode.addOption("pcLoopback", "PC 音声のみ（ループバック）");
      const value = s.audioSource ?? "mix";
      safeSetValue(audioMode, value);
    };

    new Setting(content)
      .setName("🎙️ 録音モード")
      .setDesc("PC 音声も録音するには「マイク + PC 音声」を選択。direct モードは画面共有ダイアログ、bridge モードは WASAPI ループバックで PC 音声を取得します")
      .addDropdown((d) => {
        audioMode = d;
        // v0.8.6: direct / bridge どちらも全オプション表示
        d.addOption("mix", "マイク + PC 音声（WASAPI ループバック）");
        d.addOption("mic", "マイクのみ（従来）");
        d.addOption("pcLoopback", "PC 音声のみ（ループバック）");
        d.setValue(s.audioSource ?? "mix")
          .onChange(async (v: string) => {
            s.audioSource = v as AudioSourceId;
            await this.save();
          });
      });

    // v0.5: デバイス選択（マイク + スピーカー）
    //   - recordingMethod === "bridge" → ブリッジの GET /audio/devices を使う
    //   - bridge 不可達・direct → navigator.mediaDevices.enumerateDevices()
    //   - いずれも失敗 → ドロップダウンに「（デバイス一覧未取得）」とだけ表示
    let micDeviceSetting: Setting;
    let speakerDeviceSetting: Setting;
    let micDeviceDropdown: any;
    let speakerDeviceDropdown: any;
    let refreshDevicesButton: any;

    /**
     * v0.8.4: setValue 安全化。指定 value が option に存在しない場合「（システム既定）」"" にフォールバック。
     * これにより、保存済みデバイスIDが現在のデバイス一覧に無い場合でもドロップダウン表示が壊れない。
     */
    const safeSetValue = (dd: any, value: string): void => {
      if (!dd) return;
      const exists = Array.from(dd.selectEl?.options ?? []).some(
        (o: any) => o.value === value
      );
      dd.setValue(exists ? value : "");
    };

    const repopulateDevices = async () => {
      const got: DeviceListResult = await listDevices(s);
      // マイク側を再構築
      micDeviceDropdown.selectEl.innerHTML = "";
      micDeviceDropdown.addOption("", "（システム既定）");
      for (const m of got.microphones) micDeviceDropdown.addOption(m.id, m.name || m.id);
      const currentMicId = s.recordingMethod === "bridge" ? s.bridgeMicDeviceId : s.directMicDeviceId;
      safeSetValue(micDeviceDropdown, currentMicId || "");
      // スピーカー側を再構築
      speakerDeviceDropdown.selectEl.innerHTML = "";
      speakerDeviceDropdown.addOption("", "（システム既定）");
      for (const sp of got.speakers) speakerDeviceDropdown.addOption(sp.id, sp.name || sp.id);
      const currentSpkId = s.recordingMethod === "bridge" ? s.bridgeSpeakerDeviceId : s.directSpeakerDeviceId;
      safeSetValue(speakerDeviceDropdown, currentSpkId || "");
      // desc 更新
      const micDesc =
        got.source === "bridge"
          ? `ブリッジから取得（${got.microphones.length} マイク / ${got.speakers.length} スピーカー）`
          : got.source === "direct"
            ? `ブラウザから取得（direct モード用）`
            : "（bridge 停止中・enumerateDevices も利用不可）";
      micDeviceSetting.setDesc(`録音に使うマイクデバイスを選択します。${micDesc}`);
      speakerDeviceSetting.setDesc(
        s.recordingMethod === "direct"
          ? "PC ダイレクト録音ではスピーカー制御不可（getUserMedia は入力のみ対応）"
          : "ブリッジ録音で PC 音声キャプチャに使われるスピーカーを選択します（pcLoopback / mix 用）"
      );
    };

    micDeviceSetting = new Setting(content)
      .setName("🎤 録音用マイクデバイス")
      .setDesc("録音に使うマイクデバイスを選択します（初回は「🔄 デバイス一覧を更新」を押してください）")
      .addDropdown((d) => {
        micDeviceDropdown = d;
        d.addOption("", "（システム既定）").setValue(
          (s.recordingMethod === "bridge" ? s.bridgeMicDeviceId : s.directMicDeviceId) || ""
        ).onChange(async (v: string) => {
          if (s.recordingMethod === "bridge") s.bridgeMicDeviceId = v;
          else s.directMicDeviceId = v;
          await this.save();
        });
      })
      .addButton((b) => {
        refreshDevicesButton = b;
        b.setButtonText("🔄 デバイス一覧を更新").onClick(async () => {
          b.setDisabled(true).setButtonText("更新中…");
          try {
            await repopulateDevices();
          } finally {
            b.setDisabled(false).setButtonText("🔄 デバイス一覧を更新");
          }
        });
      });

    speakerDeviceSetting = new Setting(content)
      .setName("🔊 録音用スピーカーデバイス（pcLoopback / mix 用）")
      .setDesc("ブリッジ録音で PC 音声キャプチャに使われるスピーカーを選択します")
      .addDropdown((d) => {
        speakerDeviceDropdown = d;
        d.addOption("", "（システム既定）").setValue(
          (s.recordingMethod === "bridge" ? s.bridgeSpeakerDeviceId : s.directSpeakerDeviceId) || ""
        ).onChange(async (v: string) => {
          if (s.recordingMethod === "bridge") s.bridgeSpeakerDeviceId = v;
          else s.directSpeakerDeviceId = v;
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
      // v0.8.1: audioMode（録音モード）は両モードで使えるため常時有効（旧コードでは direct で無効化されていたバグ修正）
      audioMode?.setDisabled(false);
      bridgeUrl?.setDisabled(disabled);
      bridgeDir?.setDisabled(disabled);
      // v0.5: マイクドロップダウンは両モードで使うため常時有効
      // v0.8.2: スピーカードロップダウンも常時有効化（旧コードでは direct でグレーアウトされていたバグ修正：
      //   direct でもユーザー設定としては保存したい・UI で見えるようにしたい要望に対応。
      //   実際に getUserMedia が出力デバイスを使うかは bridge 経由のため、direct 設定値は保持のみ）
      micDeviceDropdown?.setDisabled(false);
      speakerDeviceDropdown?.setDisabled(false);
      refreshDevicesButton?.setDisabled(false);
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

    const local = isLocalSttProvider(s.sttProvider);
    const providerList = local ? LOCAL_STT_PROVIDERS : CLOUD_STT_PROVIDERS;

    new Setting(content)
      .setName("STT カテゴリ")
      .setDesc("ローカル（無料・オフライン）またはクラウド（BYOK・API キー）")
      .addDropdown((d) =>
        d
          .addOption("local", "ローカル")
          .addOption("cloud", "クラウド")
          .setValue(local ? "local" : "cloud")
          .onChange(async (v: string) => {
            const target: SttProviderId = v === "local" ? "whisper-local" : "openai";
            Object.assign(s, switchSttProvider(s, target));
            await this.save();
            await this.display();
          })
      );

    new Setting(content)
      .setName("STT プロバイダー")
      .setDesc("カテゴリに応じたプロバイダを選択します")
      .addDropdown((d) => {
        for (const id of providerList) {
          d.addOption(id, STT_PROVIDER_LABELS[id]);
        }
        return d
          .setValue(s.sttProvider)
          .onChange(async (v: string) => {
            Object.assign(s, switchSttProvider(s, v as SttProviderId));
            await this.save();
            await this.display();
          });
      });

    if (local) {
      if (s.sttProvider === "whisper-local") {
        // 既定のモデル保存先（プラグインディレクトリ配下）
        const defaultModelDir = `${this.plugin.manifest.dir}\\Model`;

        // ① モデル選択
        new Setting(content)
          .setName("Whisper モデル")
          .setDesc("tiny=75MB / small=488MB / medium=1.5GB")
          .addDropdown((d) =>
            d
              .addOption("tiny", "Tiny（最速・75MB）")
              .addOption("small", "Small（バランス・488MB）")
              .addOption("medium", "Medium（高精度・1.5GB）")
              .setValue(s.sttWhisperModel)
              .onChange(async (v: string) => {
                s.sttWhisperModel = v as WhisperModelId;
                await this.save();
                await this.display();
              })
          );

        // ② モデル DL 状態 + ボタン（モデルごとに表示）
        const modelDir = (s.sttWhisperModelDir || "").trim() || defaultModelDir;
        for (const [id, info] of Object.entries(WHISPER_MODELS)) {
          const modelId = id as WhisperModelId;
          const runtime = getModelStatus(modelId);
          // 実行時状態が未 DL でもディスク上にキャッシュがあれば DL 済と表示（プラグイン再起動対策）
          const effective: ModelDlStatus =
            runtime === "not-downloaded" && checkModelExists(modelId, modelDir)
              ? "downloaded"
              : runtime;
          const setting = new Setting(content)
            .setName(info.displayName)
            .setDesc(`状態: ${renderStatusText(effective)}`);
          if (effective === "not-downloaded" || effective === "error") {
            setting.addButton((btn) =>
              btn.setButtonText("📥 ダウンロード").onClick(async () => {
                btn.setDisabled(true).setButtonText("DL中…");
                setting.setDesc(`状態: ⏳ DL中…（${info.displayName}・サイズにより数分かかります）`);
                try {
                  // サーバ未起動なら自動起動してから DL
                  await ensureWhisperLocalServer(s);
                  await downloadWhisperModel(modelId, s.sttBaseUrl);
                  new Notice(`✅ ${info.displayName} の DL 完了`);
                } catch (e) {
                  new Notice(`❌ DL 失敗: ${(e as Error).message}`);
                  await writeDebugLog(
                    this.app,
                    this.plugin.manifest.dir,
                    `stage=whisper-dl status=fail model=${modelId} baseUrl=${JSON.stringify(s.sttBaseUrl)} error="${(e as Error).message}"`,
                  );
                } finally {
                  btn.setDisabled(false).setButtonText("📥 ダウンロード");
                  await this.display();
                }
              })
            );
          }
        }

        // ③ モデル保存先 + 📂 フォルダを開く
        new Setting(content)
          .setName("モデル保存先")
          .setDesc(`既定: ${defaultModelDir}`)
          .addText((t) =>
            t.setValue(s.sttWhisperModelDir || defaultModelDir).onChange(async (v: string) => {
              s.sttWhisperModelDir = v;
              await this.save();
            })
          )
          .addButton((btn) =>
            btn.setButtonText("📂 開く").onClick(async () => {
              const dir = (s.sttWhisperModelDir || defaultModelDir).trim();
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

        // ④ ローカル Whisper サーバ URL
        new Setting(content)
          .setName("ローカル Whisper サーバ URL")
          .setDesc("既定: http://127.0.0.1:9000/v1")
          .addText((t) =>
            t.setValue(s.sttBaseUrl).onChange(async (v: string) => {
              s.sttBaseUrl = v;
              await this.save();
            })
          );
      }

      if (s.sttProvider === "mywhisper") {
        new Setting(content)
          .setName("MyWhisper 配置（本地 ASR 服务）")
          .setDesc("💡 默认指向主人 LAN 部署实例；可改为其他地址后保存。")
          .addText((text) =>
            text
              .setPlaceholder("http://192.168.0.88:9000/")
              .setValue(s.sttMyWhisperBaseUrl)
              .onChange(async (value: string) => {
                if (!/^https?:\/\//.test(value)) {
                  new Notice("Base URL 必须以 http:// 或 https:// 开头");
                  return;
                }
                s.sttMyWhisperBaseUrl = value;
                await this.save();
              })
          );

        new Setting(content)
          .setName("Token（可选）")
          .setDesc(":9000 默认无认证，留空即可；未来如启用认证可在此填写。")
          .addText((text) =>
            text
              .setPlaceholder("留空表示无认证")
              .setValue(s.sttMyWhisperToken)
              .onChange(async (value: string) => {
                s.sttMyWhisperToken = value;
                await this.save();
              })
          );
      }
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
      .setName("STT 送信並列度")
      .setDesc("OpenAI Whisper への同時送信数（1〜4）。初期値は 2")
      .addSlider((slider) =>
        slider
          .setLimits(1, 4, 1)
          .setValue(s.sttMaxConcurrency)
          .setDynamicTooltip()
          .onChange(async (value) => {
            s.sttMaxConcurrency = clampSttConcurrency(value);
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
        .setDesc("ON で GijiObsidian/logs/ に日次ログを書き出します。プラグイン性能調査用。")
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
