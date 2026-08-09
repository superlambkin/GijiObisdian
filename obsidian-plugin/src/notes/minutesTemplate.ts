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
> ⚠️ 注意：==推定校正== は AI 推測を含みます

---

## 📋 概要

| 項目 | 内容 |
|------|------|
| 🔢 議事録番号 |  |
| 🕐 開始時間 | YYYY-MM-DD HH:MM |
| ⏱️ 会議時間 | X 分 Y 秒（追加録音がある場合は合計時間） |
| 🎙️ 録音ファイル |  |
| テーマ |  |
| 形式 |  |
| 目的 |  |

---

## 👥 会議参加者

不明な項目は ==空欄== とする。

| 会議参加者 | 所属 | メールアドレス |
|------|------|------|
|  |  |  |

---

## 📊 議題・評価まとめ

| # | 議題 / 項目 | 評価 / 結論 | 理由（要約） |
|:--:|------|:--:|------|
| 1 |  |  |  |

---

## 🎯 アクションプラン評価表

議題・評価まとめから導出したアクションを評価する。担当・期限は未定の場合 ==空欄==。

| # | アクション | 関連項目 | 期待効果 | 難易度 | 優先度 | 担当 | 期限 |
|:--:|------|------|:--:|:--:|:--:|------|------|
| 1 |  |  | 高 / 中 / 低 | 高 / 中 / 低 | ⭐⭐⭐ / ⭐⭐ / ⭐ |  |  |

---

## ✨ 要約

1.

---

## 📝 原文

### 🗣️ 転写テキスト（無加工）

>

---

## 📝 更新記録

| バージョン | 日付 | 変更内容 | 変更者 |
|------|------|------|------|
| v1.0.0 | YYYY-MM-DD HH:MM | 初版（転写テキストから議事録を作成） |  |
`;

/** テンプレートフォルダの Vault 相対パス（例: .obsidian/plugins/giji-obsidian/templates） */
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
