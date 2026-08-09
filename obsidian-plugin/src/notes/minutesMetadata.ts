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
}

/** 概要表の `| ラベル | ... |` セル内容を value に置換 */
function replaceCell(md: string, label: string, value: string): string {
  const re = new RegExp(`(\\| ${label} \\| )[^|\\n]*( \\|)`, "g");
  return md.replace(re, (_m, pre: string, post: string) => `${pre}${value}${post}`);
}

/** 議事録MDの概要表セルに録音データを書き込む（LLM出力の後処理） */
export function fillMinutesMetadata(md: string, meta: MinutesMetadata): string {
  let out = md;
  // 🎙️ 録音ファイル 行が無ければ 会議時間 行の直後に挿入
  if (!out.includes("| 🎙️ 録音ファイル |")) {
    const durIdx = out.indexOf("| ⏱️ 会議時間 |");
    if (durIdx !== -1) {
      const lineEnd = out.indexOf("\n", durIdx);
      const insertAt = lineEnd === -1 ? out.length : lineEnd;
      out = out.slice(0, insertAt) + "\n| 🎙️ 録音ファイル |  |" + out.slice(insertAt);
    }
  }
  out = replaceCell(out, "🕐 開始時間", formatStartTime(meta.startTime));
  out = replaceCell(out, "⏱️ 会議時間", meta.durationSec !== undefined ? formatDuration(meta.durationSec) : "—");
  out = replaceCell(out, "🎙️ 録音ファイル", meta.mp3Links ?? "");
  return out;
}
