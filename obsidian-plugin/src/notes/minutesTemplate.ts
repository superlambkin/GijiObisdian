import { App } from "obsidian";
import { GijiSettings } from "../settings";
import { formatStartTime } from "./minutesMetadata";

/**
 * 議事録テンプレートの読み込み・初期化。
 * - Vault 内 MD（デフォルト: 00_Vault管理/議事録テンプレート.md）
 * - プラグインディレクトリの templates フォルダ（ロード時に作成・デフォルト同梱）
 */

export const DEFAULT_TEMPLATE_FILE_NAME = "議事録テンプレート.md";

/** インストール時に templates フォルダへ予め格納するデフォルトテンプレート */
export const DEFAULT_MINUTES_TEMPLATE_MD = `---
title: "議事録_タイトル"
type: meeting-minutes
language: Japanese
version: 1.0.0
議事録番号:
created: YYYY-MM-DD
modified: YYYY-MM-DD HH:MM
tags:
  - 議事録
  - 文字起こし
  - Clipping
aliases:
  - 別名
applied_rules_version: 2.11.0
---

# 📋 議事録：タイトル

> 📂 パス：\`保存先/ファイル名.md\`
> 🎙️ 原文：[[ソース録音ファイル]]（文字起こし元がある場合）
> ⚠️ 注意：==推定校正== は AI 推測を含みます。<mark style="background-color:#ffb6c1;color:#1a1a1a;">ピンクマーカー</mark> は LLM の推測修正箇所（要確認）

---

## 📋 概要

- 🔢 **議事録番号**:
- 🕐 **開始時間**: YYYY-MM-DD HH:MM
- ⏱️ **会議時間**: X 分 Y 秒（追加録音がある場合は合計時間）
- 🎙️ **録音ファイル**: [[録音ファイル名]]
- 🎯 **テーマ**:
- 🎯 **形式**:
- 🎯 **目的**:

---

## 👥 会議参加者

不明な項目は ==空欄== とする。

- **（参加者名）**
  - 所属:
  - メールアドレス:

（参加者が記録されていない場合は「参加者情報なし」と記載）

---

## 📊 議題・評価まとめ

### 1. （議題・項目）
- **評価 / 結論**:
- **理由（要約）**:

### 2. （議題・項目）
- **評価 / 結論**:
- **理由（要約）**:

---

## 🎯 アクションプラン

議題・評価まとめから導出したアクションを評価する。担当・期限は未定の場合 ==空欄==。

### 1. （アクション内容）
- **関連項目**: （議題番号）
- **期待効果**: 高 / 中 / 低
- **難易度**: 高 / 中 / 低
- **優先度**: ⭐⭐⭐ / ⭐⭐ / ⭐
- **担当**:
- **期限**:

---

## ✨ 要約

1. （要点1）
2. （要点2）
3. （要点3）

---

## 🔍 推定校正（誤認識の候補）

> 💡 LLM が推測・修正した内容は ==ピンクマーカー==（\`<mark style="background-color:#ffb6c1;color:#1a1a1a;">推測テキスト</mark>\`）で示す。✨ 要約・📊 議題など本文中の推測修正箇所も同様にマークし、==確認の目印== とする。
>
> ==校正方針==: 転写テキスト中の誤認識（固有名詞・人名・地名・専門用語など）を **漏れなく** 列挙する。確度は 高 / 中 / 低 の 3 段階。確度「高」の修正は 📝 原文 の校正後テキストにもピンクマーカーで反映する。

> **原文**: （転写の一部）
> **推定**: <mark style="background-color:#ffb6c1;color:#1a1a1a;">推測テキスト</mark>
> **確度**: 高 / 中 / 低
>
> （誤認識の候補を複数列挙）

---

## 💡 考察メモ

- （考察1）
- （考察2）

---

## 📝 原文

| 項目 | 値 |
|------|------|
| 🕐 開始時間 | YYYY-MM-DD HH:MM |
| ⏱️ 会議時間（合計） | X 分 Y 秒 |
| 👥 参加者数 |  |
| 📄 録音セグメント | X 件 |
| 📝 文字数 | X 字 |
| 🎙️ ソース | [[リンク]] |

### 🗣️ 転写テキスト（校正後）

> 転写テキストを **全文・省略なし** で貼り付け、誤認識を修正した箇所はピンクマーカーで示す。
> ピンクマーカー: \`<mark style="background-color:#ffb6c1;color:#1a1a1a;">修正テキスト</mark>\`
> （校正後の転写テキスト全文）

---

## 📚 参照文献

1. Vault MD: [[リンク]]
2. Web: https://example.com
3. LLM: Claude Sonnet 4.5 (claude.ai)

---

## 📝 更新記録

| バージョン | 日付 | 変更内容 | 変更者 |
|------|------|------|------|
| v1.6.0 | 2026-08-10 09:30 | 転写テキスト（校正後）の精度向上：📝 原文に「全文・省略なし＋ピンクマーカー」指示、🔍 推定校正に「誤認識を漏れなく列挙＋確度高は本文に反映」を明記 | MiuMiu & Claude 🐾 |
| v1.0.0 | YYYY-MM-DD HH:MM | 初版（転写テキストから議事録を作成） | 作成者 |
`;

/** テンプレートフォルダの Vault 相対パス（例: .obsidian/plugins/GijiObsidian/templates） */
export function templatesDir(manifestDir: string): string {
  return `${manifestDir}/templates`;
}

/**
 * プラグインロード時に templates フォルダを作成し、
 * デフォルトテンプレートを予め格納する（既存ファイルは上書きしない）。
 */
export async function ensureTemplatesDir(app: App, manifestDir: string): Promise<void> {
  const adapter = app.vault.adapter as any;
  const dir = templatesDir(manifestDir);
  if (!(await adapter.exists(dir))) {
    await adapter.mkdir(dir);
  }
  const def = `${dir}/${DEFAULT_TEMPLATE_FILE_NAME}`;
  if (!(await adapter.exists(def))) {
    await adapter.write(def, DEFAULT_MINUTES_TEMPLATE_MD);
  }
}

/**
 * テンプレート本文を抽出する。
 * 説明書きを含む MD（例: Vault の議事録テンプレート）からは
 * 最初の ```markdown フェンス内を取り出す。フェンスが無ければ全文をそのまま使う。
 */
export function extractTemplateBody(content: string): string {
  const m = content.match(/```markdown\s*\n([\s\S]*?)```/);
  return (m ? m[1] : content).trim();
}

/** 設定に応じて議事録テンプレートを読み込む。見つからない場合は明示的に throw */
export async function loadMinutesTemplate(
  app: App,
  settings: GijiSettings,
  manifestDir: string
): Promise<string> {
  const adapter = app.vault.adapter as any;
  const path =
    settings.minutesTemplateSource === "directory"
      ? `${templatesDir(manifestDir)}/${settings.minutesTemplateFile || DEFAULT_TEMPLATE_FILE_NAME}`
      : settings.minutesTemplateVaultPath;
  if (!(await adapter.exists(path))) {
    throw new Error(`議事録テンプレートが見つかりません: ${path}`);
  }
  return extractTemplateBody(await adapter.read(path));
}

/** Claudian 連携用の要約プロンプトを組み立てる（Claudian のエージェントが議事録 MD を作成・保存する） */
export function buildClaudianMinutesPrompt(
  template: string,
  transcript: string,
  outputDir: string,
  startTime: Date,
  meta: { durationSec?: number; mp3Links?: string } = {}
): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const ts = `${startTime.getFullYear()}年${pad(startTime.getMonth() + 1)}月${pad(startTime.getDate())}日${pad(startTime.getHours())}時${pad(startTime.getMinutes())}分`;
  const duration = meta.durationSec !== undefined ? `${Math.floor(meta.durationSec / 60)} 分 ${meta.durationSec % 60} 秒` : "不明";
  return [
    "以下の会議転写テキストを、議事録テンプレートに従って議事録 Markdown として作成し、Vault に保存してください。",
    "",
    `【保存先】${outputDir}/議事録_${ts}.md`,
    "【ルール】不明な項目は空欄にしてください。テンプレートの構成を厳密に守ってください。",
    `【録音情報】開始時間=${formatStartTime(startTime)} / 会議時間=${duration} / 録音ファイル=${meta.mp3Links ?? ""}`,
    "",
    "【議事録テンプレート】",
    template,
    "",
    "【転写テキスト】",
    transcript,
  ].join("\n");
}

/** クラウド / Ollama LLM 用のテンプレート適用システムプロンプト */
export function buildTemplateSystemPrompt(template: string): string {
  return [
    "あなたは議事録作成アシスタントです。以下のテンプレートに厳密に従って、",
    "ユーザーが送る会議転写テキストから議事録 Markdown を作成してください。",
    "不明な項目は空欄にしてください。出力は Markdown 本文のみ（説明・前置き不要）。",
    "",
    "【議事録テンプレート】",
    template,
  ].join("\n");
}
