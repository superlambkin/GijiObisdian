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
 * 既存議事録に追加録音セクションを追記した新しい内容を組み立てる。
 * - `## 📝 更新記録` の直前に `## 🕐 追加録音（日時）` セクションを挿入
 * - frontmatter `modified` を追記時刻に更新
 * - 更新記録に `v1.0.x`（パッチ番号インクリメント）の行を追加
 * 旧形式など更新記録セクションが無い場合は末尾に追記する。
 */
export function buildAppendedNote(
  prev: string,
  text: string,
  durationSec: number | undefined,
  now: Date
): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeHM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const charCount = text.trim().length;
  const duration = durationSec === undefined ? "—" : formatDuration(durationSec);

  // frontmatter modified を行単位で更新（他フィールドは保持）
  let out = prev.replace(/^modified: .*$/m, `modified: ${date} ${timeHM}`);

  // 追加録音セクション
  const segment = [
    `## 🕐 追加録音（${date} ${timeHM}）`,
    "",
    "追加録音の概要（文字数・会議時間）は以下の通り。",
    "",
    "| 項目 | 値 |",
    "|------|------|",
    `| 📝 文字数 | ${charCount} 字 |`,
    `| ⏱️ 会議時間 | ${duration} |`,
    "",
    text,
    "",
    "---",
    "",
  ].join("\n");

  // 更新記録の次バージョン（v1.0.N の最大値 + 1）
  const versions = [...prev.matchAll(/\| v1\.0\.(\d+) \|/g)].map((m) => parseInt(m[1], 10));
  const nextPatch = (versions.length ? Math.max(...versions) : 0) + 1;
  const changelogRow = `| v1.0.${nextPatch} | ${date} ${timeHM} | 追加録音を追記（音声転写から自動生成） | GijiObsidian 🎙️ |`;

  const changelogIdx = out.indexOf("\n## 📝 更新記録");
  if (changelogIdx === -1) {
    // 更新記録セクションが無い旧ノート → 末尾に追記
    const tail = out.endsWith("\n") ? out : out + "\n";
    return (
      tail +
      "\n---\n\n" +
      segment +
      "\n## 📝 更新記録\n\n" +
      "| バージョン | 日付 | 変更内容 | 変更者 |\n" +
      "|------|------|------|------|\n" +
      changelogRow +
      "\n"
    );
  }

  // `## 📝 更新記録` の直前にセクション挿入
  out = out.slice(0, changelogIdx + 1) + segment + "\n" + out.slice(changelogIdx + 1);

  // 更新記録テーブルの最終バージョン行の直後に新行を追加
  const lastRowIdx = out.lastIndexOf("\n| v1.0.");
  if (lastRowIdx !== -1) {
    const lineEnd = out.indexOf("\n", lastRowIdx + 1);
    const insertAt = lineEnd === -1 ? out.length : lineEnd;
    out = out.slice(0, insertAt) + "\n" + changelogRow + out.slice(insertAt);
  }

  return out;
}

/**
 * 把转写文本保存为 MD 文档到 `settings.transcriptSaveDir`（Vault 内路径）。
 * 同名（同时间精度）议事录已存在时：
 *   - 追加录音 ON → 追记到既有文件（appended: true）
 *   - 追加录音 OFF → 追加 -2, -3 … 后缀新建文件（appended: false）
 */
export async function saveTranscriptToFile(
  app: App,
  settings: GijiSettings,
  text: string,
  durationSec?: number,
  now: Date = new Date()
): Promise<{ path: string; appended: boolean }> {
  const dir = (settings.transcriptSaveDir || "").trim().replace(/^\/+|\/+$/g, "") || "Clippings";
  const vault = app.vault as any;

  // 确保目录存在
  const dirExists = await vault.adapter.exists(dir);
  if (!dirExists) {
    await vault.createFolder(dir);
  }

  const template = (settings.fileNameTemplate || "").trim() || DEFAULT_SETTINGS.fileNameTemplate;
  const filename = buildTranscriptFilename(now, template);
  const basePath = `${dir}/${filename}.md`;

  // 追加録音：同名（＝同じ時間に開始した録音）議事録が存在すれば追記
  if (settings.appendRecordEnabled && (await vault.adapter.exists(basePath))) {
    const prev: string = await vault.adapter.read(basePath);
    const next = buildAppendedNote(prev, text, durationSec, now);
    await vault.adapter.write(basePath, next);
    return { path: basePath, appended: true };
  }

  // 新規保存（衝突時は -2, -3 … を追加）
  let path = basePath;
  let counter = 2;
  while (await vault.adapter.exists(path)) {
    path = `${dir}/${filename}-${counter}.md`;
    counter++;
  }

  const content = renderTranscriptNote(filename, now, text, durationSec, path);
  await vault.create(path, content);
  return { path, appended: false };
}
