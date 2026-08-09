import { App } from "obsidian";
import { DEFAULT_SETTINGS, GijiSettings } from "../settings";
import { buildMp3Links } from "./mp3Ref";

const pad = (n: number) => n.toString().padStart(2, "0");

/** MD生成ルールの適用バージョン（生成物に記録する） */
const APPLIED_RULES_VERSION = "2.11.0";

/** テンプレートの占位符を日時値で置き換える（サニタイズは呼び出し側で行う） */
export function renderTemplate(now: Date, template: string): string {
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
  return template.replace(
    /\{\{(year|month|day|hour|minute|second|date|time)\}\}/g,
    (_full, key: string) => values[key] ?? _full
  );
}

/**
 * テンプレートから転写ファイル名を生成する。
 * 既定: `議事録_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分`
 * 例: `議事録_2026年08月04日06時30分`（衝突は呼び出し側で -2 接尾）
 */
export function buildTranscriptFilename(
  now: Date,
  template: string = DEFAULT_SETTINGS.fileNameTemplate
): string {
  // Windows/Obsidian で使えないファイル名文字を除去
  return renderTemplate(now, template).replace(/[\\/:*?"<>|]/g, "-");
}

/**
 * 追加録音判定用の「時間プレフィックス」を生成する。
 * テンプレートを最初の {{minute}}/{{second}} 占位符の手前で切り、
 * そこまでを描画する（例: `議事録_2026年08月09日05時`）。
 * テンプレートに分・秒占位符が無い場合はファイル名全体を返す。
 */
export function buildHourPrefix(
  now: Date,
  template: string = DEFAULT_SETTINGS.fileNameTemplate
): string {
  const minuteIdx = template.search(/\{\{(minute|second)\}\}/);
  const hourTemplate = minuteIdx === -1 ? template : template.slice(0, minuteIdx);
  return renderTemplate(now, hourTemplate);
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
  notePath?: string,
  mp3Links?: string
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
    ...(mp3Links ? [`| 🎙️ 録音ファイル | ${mp3Links} |`, ""] : []),
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
 * 同じ時間（時）に開始した録音の議事録を探す。
 * 時間プレフィックスに前方一致する .md のうち ==最も早いもの==（名前順）を返す。
 * 例: プレフィックス `議事録_2026年08月09日05時` に
 *     `…05時21分.md` と `…05時41分.md` がある → `…05時21分.md`
 */
async function findSameHourFile(vault: any, dir: string, prefix: string): Promise<string | null> {
  const listed = await vault.adapter.list(dir);
  const base = (p: string) => p.split("/").pop() ?? p;
  const matches = (listed.files as string[])
    .filter((f) => f.endsWith(".md") && base(f).startsWith(prefix))
    .sort();
  return matches.length ? matches[0] : null;
}

/**
 * 把转写文本保存为 MD 文档到 `settings.transcriptSaveDir`（Vault 内路径）。
 * 追加录音 ON 时，若==同じ時間（時）==に開始した議事録が存在すれば追記：
 *   - 例: 05時21分.md が存在し 05:41 に録音 → 05時21分.md に追記（appended: true）
 *   - 別の時間の議事録しか無ければ新規作成（appended: false）
 * 追加录音 OFF 时は従来通り同名衝突で -2, -3 … 后缀。
 */
export async function saveTranscriptToFile(
  app: App,
  settings: GijiSettings,
  text: string,
  durationSec?: number,
  now: Date = new Date(),
  mp3Links?: string
): Promise<{ path: string; appended: boolean }> {
  const dir = (settings.transcriptSaveDir || "").trim().replace(/^\/+|\/+$/g, "") || "議事録";
  const vault = app.vault as any;

  // 确保目录存在
  const dirExists = await vault.adapter.exists(dir);
  if (!dirExists) {
    await vault.createFolder(dir);
  }

  const template =
    (settings.transcriptFileNameTemplate || "").trim() || DEFAULT_SETTINGS.transcriptFileNameTemplate;
  const filename = buildTranscriptFilename(now, template);
  const basePath = `${dir}/${filename}.md`;

  // 追加録音：同じ時間（時）に開始した議事録が存在すれば追記
  if (settings.appendRecordEnabled) {
    const hourPrefix = buildHourPrefix(now, template);
    const target = await findSameHourFile(vault, dir, hourPrefix);
    if (target) {
      const prev: string = await vault.adapter.read(target);
      const next = buildAppendedNote(prev, text, durationSec, now);
      await vault.adapter.write(target, next);
      return { path: target, appended: true };
    }
  }

  // 新規保存（衝突時は -2, -3 … を追加）
  let path = basePath;
  let counter = 2;
  while (await vault.adapter.exists(path)) {
    path = `${dir}/${filename}-${counter}.md`;
    counter++;
  }

  const content = renderTranscriptNote(filename, now, text, durationSec, path, mp3Links);
  await vault.create(path, content);
  return { path, appended: false };
}
