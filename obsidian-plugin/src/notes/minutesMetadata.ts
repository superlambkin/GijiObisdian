import { formatDuration } from "./saver";

/** 開始時刻を YYYY-MM-DD HH:MM 形式へ */
export function formatStartTime(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface MinutesMetadata {
  startTime: Date;
  durationSec?: number;
  mp3Links?: string;
  /** STT 転写処理時間（ms） */
  sttMs?: number;
  /** LLM 要約処理時間（ms） */
  summarizeMs?: number;
}

/** 概要表の `| ラベル | ... |` セル内容を value に置換 */
function replaceCell(md: string, label: string, value: string): string {
  const re = new RegExp(`(\\| ${label} \\| )[^|\\n]*( \\|)`, "g");
  return md.replace(re, (_m, pre: string, post: string) => `${pre}${value}${post}`);
}

/** label 行が無ければ anchorLabel 行の直後に空行を挿入して返す */
function ensureRowAfter(out: string, label: string, anchorLabel: string): string {
  if (out.includes(`| ${label} |`)) return out;
  const anchorIdx = out.indexOf(`| ${anchorLabel} |`);
  if (anchorIdx === -1) return out;
  const lineEnd = out.indexOf("\n", anchorIdx);
  const insertAt = lineEnd === -1 ? out.length : lineEnd;
  return out.slice(0, insertAt) + `\n| ${label} |  |` + out.slice(insertAt);
}

/** 議事録MDの概要表セルに録音データを書き込む（LLM出力の後処理） */
export function fillMinutesMetadata(md: string, meta: MinutesMetadata): string {
  let out = md;
  // 録音ファイル・文字起こし時間・要約時間 行が無ければ挿入（会議時間の直後）
  out = ensureRowAfter(out, "🎙️ 録音ファイル", "⏱️ 会議時間");
  out = ensureRowAfter(out, "⏱️ 文字起こし時間", "⏱️ 会議時間");
  out = ensureRowAfter(out, "⏱️ 要約時間", "⏱️ 文字起こし時間");
  out = replaceCell(out, "🕐 開始時間", formatStartTime(meta.startTime));
  out = replaceCell(out, "⏱️ 会議時間", meta.durationSec !== undefined ? formatDuration(meta.durationSec) : "—");
  out = replaceCell(out, "🎙️ 録音ファイル", meta.mp3Links ?? "");
  out = replaceCell(
    out,
    "⏱️ 文字起こし時間",
    meta.sttMs !== undefined ? `${(meta.sttMs / 1000).toFixed(1)} 秒` : "—"
  );
  out = replaceCell(
    out,
    "⏱️ 要約時間",
    meta.summarizeMs !== undefined ? `${Math.round(meta.summarizeMs / 1000)} 秒` : "—"
  );
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** YYYY-MM-DD */
export function formatDate(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** frontmatter の値を取得（無い・空なら undefined） */
export function getFrontmatterField(md: string, key: string): string | undefined {
  const m = md.match(new RegExp(`^${escapeRegExp(key)}:[ \\t]*([^\\r\\n]*)$`, "m"));
  const v = m?.[1]?.trim();
  return v || undefined;
}

/** frontmatter の `key: value` を設定（既存行は置換、無ければ末尾に追加。frontmatter 自体が無ければ先頭に作成） */
export function setFrontmatterField(md: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return `---\n${line}\n---\n\n${md}`;
  const body = fm[1];
  const re = new RegExp(`^${escapeRegExp(key)}:.*$`, "m");
  const next = re.test(body) ? body.replace(re, line) : `${body}\n${line}`;
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${next}\n---`);
}

/** 日付ハルシネーション対策：created（録音開始日）/ modified（保存時刻）を実値で強制 */
export function enforceFrontmatterDates(md: string, created: Date, modified: Date): string {
  let out = setFrontmatterField(md, "created", formatDate(created));
  out = setFrontmatterField(out, "modified", formatStartTime(modified));
  return out;
}
