import { App } from "obsidian";
import { DEFAULT_SETTINGS, GijiSettings } from "../settings";

const pad = (n: number) => n.toString().padStart(2, "0");

/** MD生成ルールの適用バージョン（生成物に記録する） */
const APPLIED_RULES_VERSION = "2.11.0";

/**
 * テンプレートから転写ファイル名を生成する。
 * 既定: `議事録_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分`
 * 例: `議事録_2026年08月04日06時30分`（衝突は呼び出し側で -2 接尾）
 */
export function buildTranscriptFilename(
  now: Date,
  template: string = DEFAULT_SETTINGS.fileNameTemplate
): string {
  const values: Record<string, string> = {
    year: String(now.getFullYear()),
    month: pad(now.getMonth() + 1),
    day: pad(now.getDate()),
    hour: pad(now.getHours()),
    minute: pad(now.getMinutes()),
    second: pad(now.getSeconds()),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}-${pad(now.getMinutes())}`,
  };
  const rendered = template.replace(
    /\{\{(year|month|day|hour|minute|second|date|time)\}\}/g,
    (_full, key: string) => values[key] ?? _full
  );
  // Windows/Obsidian で使えないファイル名文字を除去
  return rendered.replace(/[\\/:*?"<>|]/g, "-");
}

/** 秒数を「X 分 Y 秒」表記に整形する */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

/**
 * 転写 MD 文書を組み立てる。
 * frontmatter は [[00_Vault管理/MD生成ルール.md]] 準拠（日本語プロパティ値）。
 * 先頭に文字数・会議時間の概要表を置く。
 */
export function renderTranscriptNote(
  title: string,
  now: Date,
  text: string,
  durationSec?: number,
  notePath?: string
): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeHM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const charCount = text.trim().length;
  const duration = durationSec === undefined ? "—" : formatDuration(durationSec);

  return [
    "---",
    `title: "${title}"`,
    "type: voice-transcript",
    "language: Japanese",
    "version: 1.0.0",
    `created: ${date}`,
    `modified: ${date} ${timeHM}`,
    "tags:",
    "  - 議事録",
    "  - 文字起こし",
    "  - Clipping",
    `applied_rules_version: ${APPLIED_RULES_VERSION}`,
    "---",
    "",
    `# 🎙️ ${title}`,
    "",
    ...(notePath ? [`> 📂 パス：${notePath}`, ""] : []),
    "録音の概要（文字数・会議時間・録音日時）は以下の通り。",
    "",
    "| 項目 | 値 |",
    "|------|------|",
    `| 📝 文字数 | ${charCount} 字 |`,
    `| ⏱️ 会議時間 | ${duration} |`,
    `| 🕐 録音日時 | ${date} ${timeHM} |`,
    "",
    "## 📝 転写本文",
    "",
    text,
    "",
    "---",
    "",
    "## 📝 更新記録",
    "",
    "| バージョン | 日付 | 変更内容 | 変更者 |",
    "|------|------|------|------|",
    `| v1.0.0 | ${date} ${timeHM} | 初版（音声転写から自動生成） | GijiObsidian 🎙️ |`,
    "",
  ].join("\n");
}

/**
 * 把转写文本保存为 MD 文档到 `settings.transcriptSaveDir`（Vault 内路径）。
 * 返回保存的文件路径（相对 Vault），失败抛异常由调用方提示。
 */
export async function saveTranscriptToFile(
  app: App,
  settings: GijiSettings,
  text: string,
  durationSec?: number,
  now: Date = new Date()
): Promise<string> {
  const dir = (settings.transcriptSaveDir || "").trim().replace(/^\/+|\/+$/g, "") || "Clippings";
  const vault = app.vault as any;

  // 确保目录存在
  const dirExists = await vault.adapter.exists(dir);
  if (!dirExists) {
    await vault.createFolder(dir);
  }

  // ファイル名衝突時は -2, -3 … を追加
  const template = (settings.fileNameTemplate || "").trim() || DEFAULT_SETTINGS.fileNameTemplate;
  const filename = buildTranscriptFilename(now, template);
  let path = `${dir}/${filename}.md`;
  let counter = 2;
  while (await vault.adapter.exists(path)) {
    path = `${dir}/${filename}-${counter}.md`;
    counter++;
  }

  const content = renderTranscriptNote(filename, now, text, durationSec, path);
  await vault.create(path, content);
  return path;
}
