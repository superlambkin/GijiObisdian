# 設計: 設定画面から録音ファイルを開いて文字起こし（転写MD保存）

> 📂 パス：`docs/superpowers/specs/2026-08-15-transcribe-audio-file-from-settings-design.md`
> 📍 対象：`obsidian-plugin/`（GijiObsidian プラグイン）
> 🗓️ 作成日：2026-08-15
> 📊 状態：✅ ユーザー承認済み

---

## 1. 機能概要

設定画面 **② 📝 文字起こしタブ** に **「📂 録音ファイルを開いて文字起こし」** ボタンを追加する。

クリックするとファイル選択ダイアログを開き、選択した録音ファイルを **現在の STT 設定** で文字起こしし、**転写 MD として自動保存** する。保存後は保存先を Notice 表示し、作成した MD をエディタで開く。

| 項目 | 内容 |
|------|------|
| 設置場所 | 設定画面 ② 📝 文字起こし タブ（🔌 接続テスト の下） |
| 入力 | PC 上の録音ファイル（WAV / MP3 / M4A / FLAC / OGG） |
| 処理 | STT 転写 → 転写 MD 保存 |
| 出力 | 転写 MD（`type: voice-transcript`）＋ Notice 通知 ＋ MD を開く |

---

## 2. コンポーネント構成

| 種別 | ファイル | 内容 |
|------|---------|------|
| ➕ 新規 | `obsidian-plugin/src/commands/transcribeFile.ts` | 純粋ロジック `transcribeAndSaveAudioFile()` + DOM ラッパー `openRecordingFilePicker()` |
| ✏️ 変更 | `obsidian-plugin/src/settings.ts` | `renderTranscriptTab()` にボタン追加（1 Setting ブロック） |
| 🔁 再利用 | `transcribeAudio` / `saveTranscriptToFile` / `buildMp3Links` | 変更なし |

### 2-1. 新規モジュール `src/commands/transcribeFile.ts`

```ts
/** テスト注入用依存 */
export interface TranscribeFileDeps {
  transcribe?: (buf: ArrayBuffer, settings: GijiSettings) => Promise<string>;
  getDurationSec?: (file: AudioFileLike) => Promise<number | undefined>;
}

/** File の互換インターフェース（テスト容易性） */
export interface AudioFileLike {
  name: string;
  path?: string;
  lastModified: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** 転写 → 転写MD保存 の純粋ロジック */
export async function transcribeAndSaveAudioFile(
  app: App,
  settings: GijiSettings,
  file: AudioFileLike,
  deps: TranscribeFileDeps = {}
): Promise<{ path: string; charCount: number }>;

/** ファイル選択ダイアログを開く DOM ラッパー（settings.ts から呼ぶ） */
export function openRecordingFilePicker(app: App, settings: GijiSettings): void;
```

---

## 3. データフロー

```mermaid
flowchart LR
    A[②タブのボタン] --> B[file input 生成・click]
    B --> C[ファイル選択]
    C --> D[arrayBuffer 読込]
    D --> E[transcribeAudio で転写]
    E --> F[mp3Links 生成 file.path]
    F --> G[saveTranscriptToFile でMD保存]
    G --> H[Notice + 作成MDを開く]
```

1. ボタンクリック → `openRecordingFilePicker()` が `<input type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg">` を生成して click
2. ファイル選択 → `onchange` で `transcribeAndSaveAudioFile()` を呼ぶ
3. `file.arrayBuffer()` → `transcribeAudio(buf, settings)` で転写テキスト取得
   - `sttMs` は `Date.now()` 前後差で計測（`transcribeAudio` は所要時間を返さないため）
4. `file.path` があれば `buildMp3Links([file.path])` で再生リンク生成（無ければ空文字）
5. `durationSec` は `getDurationSec(file)`（`new Audio(URL.createObjectURL(blob))`）で取得（失敗時は undefined）
6. `{ ...settings, appendRecordEnabled: false }` をクローンした設定を渡し、
   `saveTranscriptToFile(app, settingsClone, text, durationSec, new Date(file.lastModified), mp3Links, sttMs)` で MD 保存
7. 保存パスを Notice 表示 → 作成した MD を `app.workspace.getLeaf(false).openFile(file)` で開く

戻り値 `charCount` は `text.trim().length` とする（`renderTranscriptNote` の文字数欄と同一定義）。

---

## 4. 挙動の決定事項

| 項目 | 決定 | 理由 |
|------|------|------|
| 追記 | 常に**新規 MD 作成**（`appendRecordEnabled` は適用しない） | 1ファイル=1転写MDの一対一対応を保証 |
| 時刻基準 | ファイルの **`lastModified`** を使用（フォールバック: 現在時刻） | 録音日時をファイル名・MD内「録音日時」に反映 |
| autoSaveTranscript | **従わない**（手動の明示的操作のため常に保存） | トグルは録音フローの自動保存用 |
| 再生時間 | `new Audio(URL.createObjectURL(blob))` で取得（失敗時は undefined → MDに「—」） | MD 概要表の「会議時間」欄を埋める |
| 議事録生成 | **しない**（転写→MD保存まで） | LLM要約は既存「音频导入生成会议纪要」コマンドの役割 |
| ファイル形式 | `audio/*,.wav,.mp3,.m4a,.flac,.ogg` | 既存 import と同一 |

### 4-1. appendRecordEnabled の扱い

`saveTranscriptToFile()` は `settings.appendRecordEnabled` を内部で読むため、
本フローでは **`{ ...settings, appendRecordEnabled: false }`** を渡して
常に新規作成させる（既存関数のシグネチャは変更しない）。

### 4-2. 転写MD の内容

`saveTranscriptToFile()` をそのまま使用するため、既存の録音停止フローと同じ形式:

- frontmatter: `type: voice-transcript` / `language: Japanese` など（MD生成ルール準拠）
- 概要表: 📝 文字数 / ⏱️ 会議時間 / ⏱️ 文字起こし時間 / 🕐 録音日時
- 🎙️ 録音ファイル 行（再生リンク。`file.path` がある場合のみ）
- `## 📝 転写本文`
- `## 📝 更新記録`（v1.0.0 初版行）

---

## 5. エラーハンドリング

| ケース | 挙動 |
|--------|------|
| STT 失敗 | 既存 `transcribeAudio` のエラーメッセージを Notice 表示 |
| ファイル読込失敗 | catch して Notice 表示 |
| MD 保存失敗 | catch して Notice 表示 |
| ダイアログキャンセル | 何もしない（`onchange` が発火しない） |

---

## 6. テスト方針

`src/__tests__/transcribeFile.test.ts`（`transcribe` をモック注入・`app.vault` をモック）:

| テスト | 内容 |
|--------|------|
| MD 作成 | 期待どおりのパス・内容で作成される（`renderTranscriptNote` 準拠） |
| 再生リンク | `file.path` あり → 録音ファイル行を含む / なし → 含まない |
| 時刻基準 | `lastModified` 基準でファイル名・録音日時が決まる |
| 追記無効化 | `appendRecordEnabled=true` でも新規作成される |
| エラー伝播 | STT 失敗時は throw / エラーが伝播する |

---

## 7. スコープ外（やらないこと）

- コマンドパレットへの登録（今回は設定画面のみ）
- 議事録（LLM要約）自動生成
- フォルダ一括処理
- 話者分離 / リアルタイム転写

---

## 8. 関連ドキュメント

| ドキュメント | パス |
|------|------|
| 要件総覧 F002 | `80_POC_Projects/POC_016_GijiObsidian/01_要件定義/00_要件総覧.md` |
| 設計仕様書 | `80_POC_Projects/POC_016_GijiObsidian/02_設計文書/00_設計仕様書.md` |
