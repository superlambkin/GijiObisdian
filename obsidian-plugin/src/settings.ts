import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

export type SttLang = "auto" | "zh" | "ja" | "en";
export type SttProviderId = "openai" | "google" | "groq";
export type LlmProviderId = "claudian" | "cloud" | "ollama";
export type MinutesTemplateSource = "vault" | "directory";
export type AudioSourceId = "mic" | "pcLoopback" | "mix";
export type RecordingMethodId = "bridge" | "direct";

export interface GijiSettings {
  // ② 文字起こし
  sttProvider: SttProviderId;
  sttApiKey: string;
  sttLang: SttLang;
  // ③ 要約
  llmProvider: LlmProviderId;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
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
  sttLang: "auto",
  llmProvider: "claudian",
  llmBaseUrl: "https://api.deepseek.com/v1",
  llmModel: "deepseek-chat",
  llmApiKey: "",
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
  insertToClaudianEnabled: true,
  emailSummaryEnabled: false,
};

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { runSttTest } from "./test/sttTest";
import { runLlmTest } from "./test/llmTest";

export class GijiSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: any) {
    super(app, plugin);
  }

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    const version = this.plugin.manifest?.version ?? "0.0.0";
    containerEl.createEl("h2", { text: `GijiObsidian 設定（v${version}）` });
    containerEl.createEl("p", {
      text: "作業手順の時系列で分類：① 録音 → ② 文字起こし → ③ 要約 → ④ その他",
      cls: "setting-item-description",
    });

    const s = this.plugin.settings as GijiSettings;

    /* ==================== ① 🎙️ 録音 ==================== */
    new Setting(containerEl)
      .setName("① 🎙️ 録音")
      .setDesc("マイク → ローカル録音ブリッジ（Python FastAPI）で WAV を録音します")
      .setHeading();

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("ブリッジ URL")
      .addText((t) => {
        bridgeUrl = t;
        t.setValue(s.bridgeBaseUrl).onChange(async (v: string) => {
          s.bridgeBaseUrl = v;
          await this.save();
        });
      });

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("録音ファイルの保存場所")
      .setDesc(`PC の絶対パス（デフォルト: ${DEFAULT_RECORDING_SAVE_DIR}）`)
      .addText((t) =>
        t.setValue(s.recordingSaveDir).onChange(async (v: string) => {
          s.recordingSaveDir = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("録音ファイル名テンプレート")
      .setDesc("録音ファイルの名前。プレースホルダ: {{year}} {{month}} {{day}} {{hour}} {{minute}} {{second}} {{date}} {{time}}")
      .addText((t) =>
        t.setValue(s.recordingFileNameTemplate).onChange(async (v: string) => {
          s.recordingFileNameTemplate = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("録音フォーマット")
      .setDesc("MP3 64 kbps（音声向け圧縮・16kHz モノラル）。Whisper の 25MB 制限のため、24MB 以上は自動分割して文字起こしします");

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("追加録音")
      .setDesc("ON の場合、同じ時間（年月日時が同一）に開始した録音は、その時間の最早の議事録 MD に追記されます")
      .addToggle((t) =>
        t.setValue(s.appendRecordEnabled).onChange(async (v: boolean) => {
          s.appendRecordEnabled = v;
          await this.save();
        })
      );

    /* ==================== ② 📝 文字起こし ==================== */
    new Setting(containerEl)
      .setName("② 📝 文字起こし")
      .setDesc("WAV → クラウド STT で文字起こし → 議事録 MD として自動保存します")
      .setHeading();

    new Setting(containerEl)
      .setName("STT プロバイダー")
      .addDropdown((d) =>
        d.addOption("openai", "OpenAI（デフォルト）")
          .addOption("google", "Google")
          .addOption("groq", "Groq")
          .setValue(s.sttProvider)
          .onChange(async (v: string) => {
            s.sttProvider = v as SttProviderId;
            await this.save();
          })
      );

    new Setting(containerEl)
      .setName("STT API キー")
      .addText((t) =>
        t.setValue(s.sttApiKey).onChange(async (v: string) => {
          s.sttApiKey = v;
          await this.save();
        })
      );

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("🔌 接続テスト")
      .setDesc("内蔵の音声サンプルで ② 文字起こしの設定が使えるか検証します")
      .addButton((btn) =>
        btn.setButtonText("テスト開始").onClick(async () => {
          btn.setDisabled(true).setButtonText("テスト中…");
          try {
            const res = await runSttTest(s);
            if (res.ok) new Notice(`✅ 文字起こし成功: ${res.text}`);
            else new Notice(`❌ テスト失敗: ${res.error}`);
          } finally {
            btn.setDisabled(false).setButtonText("テスト開始");
          }
        })
      );

    new Setting(containerEl)
      .setName("結果を Claudian 入力欄に挿入")
      .setDesc("ON の場合、文字起こし後のテキストを Claudian の入力欄に表示します（デフォルト: ON）")
      .addToggle((t) =>
        t.setValue(s.insertToClaudianEnabled).onChange(async (v: boolean) => {
          s.insertToClaudianEnabled = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("転写を自動保存")
      .setDesc("録音の文字起こし後、Markdown 文書として自動保存します")
      .addToggle((t) =>
        t.setValue(s.autoSaveTranscript).onChange(async (v: boolean) => {
          s.autoSaveTranscript = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("転写の保存先")
      .setDesc("転写 MD の Vault 内保存先（デフォルト: 議事録）")
      .addText((t) =>
        t.setValue(s.transcriptSaveDir).onChange(async (v: string) => {
          s.transcriptSaveDir = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("転写ファイル名テンプレート")
      .setDesc("転写 MD のファイル名。プレースホルダ: {{year}} {{month}} {{day}} {{hour}} {{minute}} {{second}} {{date}} {{time}}")
      .addText((t) =>
        t.setValue(s.fileNameTemplate).onChange(async (v: string) => {
          s.fileNameTemplate = v;
          await this.save();
        })
      );

    /* ==================== ③ 🤖 要約 ==================== */
    new Setting(containerEl)
      .setName("③ 🤖 要約")
      .setDesc("転写テキスト → LLM で議事録を生成します（「音声をインポートして議事録生成」コマンドで使用）")
      .setHeading();

    new Setting(containerEl)
      .setName("LLM プロバイダー")
      .setDesc("Claudian（デフォルト）: 既存 Claudian の LLM に要約プロンプトを挿入します")
      .addDropdown((d) =>
        d.addOption("claudian", "Claudian（デフォルト）")
          .addOption("cloud", "クラウド（OpenAI 互換 API）")
          .addOption("ollama", "Ollama（ローカル）")
          .setValue(s.llmProvider)
          .onChange(async (v: string) => {
            s.llmProvider = v as LlmProviderId;
            await this.save();
          })
      );

    new Setting(containerEl)
      .setName("LLM baseUrl")
      .setDesc("クラウド / Ollama 選択時に使用")
      .addText((t) =>
        t.setValue(s.llmBaseUrl).onChange(async (v: string) => {
          s.llmBaseUrl = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("LLM モデル")
      .setDesc("例: deepseek-chat / gpt-4o-mini / qwen2.5 など")
      .addText((t) =>
        t.setValue(s.llmModel).onChange(async (v: string) => {
          s.llmModel = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("📋 要約自動生成")
      .setDesc("ON の場合、転写完了後に自動で議事録を生成します（OFF で従来通り）")
      .addToggle((t) =>
        t.setValue(s.autoSummarizeEnabled).onChange(async (v: boolean) => {
          s.autoSummarizeEnabled = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("LLM API キー")
      .setDesc("Ollama（ローカル）の場合は不要です")
      .addText((t) =>
        t.setValue(s.llmApiKey).onChange(async (v: string) => {
          s.llmApiKey = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("🧪 接続テスト")
      .setDesc("cloud/ollama は最小プロンプトで疎通確認、claudian はプラグイン連携を検出（テキスト挿入なし・claudian 選択時はビューが開きます）")
      .addButton((btn) =>
        btn.setButtonText("テスト開始").onClick(async () => {
          btn.setDisabled(true).setButtonText("テスト中…");
          try {
            const res = await runLlmTest(s, this.app);
            if (res.ok) new Notice(`✅ 接続成功: ${res.text}`);
            else new Notice(`❌ テスト失敗: ${res.error}`);
          } finally {
            btn.setDisabled(false).setButtonText("テスト開始");
          }
        })
      );

    new Setting(containerEl)
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
      const setting = new Setting(containerEl)
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
      new Setting(containerEl)
        .setName("テンプレートのパス")
        .setDesc("Vault 内のテンプレート MD（デフォルト: 00_Vault管理/議事録テンプレート.md）")
        .addText((t) =>
          t.setValue(s.minutesTemplateVaultPath).onChange(async (v: string) => {
            s.minutesTemplateVaultPath = v;
            await this.save();
          })
        );
    }

    new Setting(containerEl)
      .setName("議事録の保存先")
      .setDesc("生成した議事録 MD の Vault 内保存先（デフォルト: 議事録）")
      .addText((t) =>
        t.setValue(s.outputDir).onChange(async (v: string) => {
          s.outputDir = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("議事録に転写原文を含める")
      .setDesc("ON の場合、生成した議事録 MD に完全な転写原文を添付します")
      .addToggle((t) =>
        t.setValue(s.keepTranscript).onChange(async (v: boolean) => {
          s.keepTranscript = v;
          await this.save();
        })
      );

    /* ==================== ④ ⚙️ その他 ==================== */
    new Setting(containerEl)
      .setName("④ ⚙️ その他")
      .setHeading();

    new Setting(containerEl)
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
