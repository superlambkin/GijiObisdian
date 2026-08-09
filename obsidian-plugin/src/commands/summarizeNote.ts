import { App, Notice, TFile } from "obsidian";
import { GijiSettings } from "../settings";
import { RecordingTimer } from "../ui/recordingTimer";
import { confirmOverwrite } from "../ui/confirmModal";
import { runAutoSummarize } from "./autoSummarize";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 録音MD判定：frontmatter type === "voice-transcript" or ファイル名が 録音_ で始まる */
export function isTranscriptNote(app: App, file: TFile): boolean {
  if (file.extension !== "md") return false;
  const fm = (app.metadataCache?.getFileCache?.(file)?.frontmatter ?? {}) as Record<string, unknown>;
  if (fm.type === "voice-transcript") return true;
  return file.basename.startsWith("録音_");
}

function stripFrontmatter(content: string): string {
  // 空フロントマター ("---\n---\n") も剥がすため、本体行がなくても末尾 --- に到達できるよう
  // 中身グループを省略可能にする
  return content.replace(/^---\r?\n(?:[\s\S]*?\r?\n)?---\r?\n?/, "");
}

/** 「## 〜」セクションの本文を抽出（見出し行は含まない） */
function extractSectionBodies(body: string, headingRe: RegExp): string[] {
  const out: string[] = [];
  let collecting = false;
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) out.push(t);
    buf = [];
  };
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) {
      if (collecting) flush();
      collecting = headingRe.test(line);
      continue;
    }
    if (collecting) buf.push(line);
  }
  if (collecting) flush();
  return out;
}

/** 概要表・区切り線・説明文を除いた本文だけ残す */
function cleanSectionText(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*\|/.test(l))
    .filter((l) => !/^\s*---\s*$/.test(l))
    .filter((l) => !/^追加録音の概要/.test(l.trim()))
    .join("\n")
    .trim();
}

/**
 * 録音MD から転写テキストを抽出する。
 * 「## 📝 転写本文」＋ 全「## 🕐 追加録音（…）」の本文を結合。
 * マーカーが無い旧形式は frontmatter 除去後の全文を返す。
 */
export function extractTranscript(content: string): string {
  const body = stripFrontmatter(content);
  const sections = extractSectionBodies(body, /^## (📝 転写本文|🕐 追加録音)/);
  if (sections.length === 0) return body.trim();
  return sections.map(cleanSectionText).filter(Boolean).join("\n\n");
}

export interface RecordingMeta {
  startTime?: Date;
  durationSec?: number;
  mp3Links?: string;
}

/** `| 🕐 録音日時 | 2026-08-09 22:14 |` 形式の概要表セルを取得 */
function readTableCell(content: string, label: string): string | undefined {
  const m = content.match(new RegExp(`^\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*([^|]+?)\\s*\\|`, "m"));
  return m?.[1]?.trim() || undefined;
}

/** 概要表（またはファイル名）から録音メタを解析 */
export function extractRecordingMeta(content: string, file: Pick<TFile, "basename">): RecordingMeta {
  const meta: RecordingMeta = {};
  const dt = readTableCell(content, "🕐 録音日時");
  const dm = dt?.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (dm) meta.startTime = new Date(+dm[1], +dm[2] - 1, +dm[3], +dm[4], +dm[5]);
  const dur = readTableCell(content, "⏱️ 会議時間");
  const um = dur?.match(/(?:(\d+)\s*分)?\s*(\d+)\s*秒/);
  if (um) meta.durationSec = (um[1] ? +um[1] * 60 : 0) + +um[2];
  const mp3 = readTableCell(content, "🎙️ 録音ファイル");
  if (mp3) meta.mp3Links = mp3;
  if (!meta.startTime) {
    const fm = file.basename.match(/録音_(\d{4})年(\d{2})月(\d{2})日(\d{2})時(\d{2})分/);
    if (fm) meta.startTime = new Date(+fm[1], +fm[2] - 1, +fm[3], +fm[4], +fm[5]);
  }
  return meta;
}

/**
 * 上書き先の議事録パスを解決する。
 * ① 命名規則（録音_X → 議事録_X）② outputDir 内の 原文リンク走査 ③ ① を新規パスとする
 */
export async function resolveMinutesPath(
  app: App,
  settings: GijiSettings,
  file: TFile
): Promise<{ path: string; exists: boolean }> {
  const adapter = app.vault.adapter as any;
  const dir = (settings.outputDir || "").trim().replace(/^\/+|\/+$/g, "") || "議事録";
  const expected = `${dir}/${file.basename.replace(/^録音/, "議事録")}.md`;
  if (await adapter.exists(expected)) return { path: expected, exists: true };

  const link = `[[${file.basename}]]`;
  const linkAlias = `[[${file.basename}|`;
  const listed = await adapter.list(dir);
  const mdFiles = ((listed?.files ?? []) as string[]).filter((f) => f.endsWith(".md")).sort();
  for (const p of mdFiles) {
    if (p === file.path) continue;
    const head = ((await adapter.read(p)) as string).split("\n").slice(0, 30).join("\n");
    if (head.includes(link) || head.includes(linkAlias)) return { path: p, exists: true };
  }
  return { path: expected, exists: false };
}

export interface SummarizeNoteDeps {
  /** 上書き確認（既定: confirmOverwrite モーダル）。テストで差し替え可能 */
  confirm?: (path: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
}

/** 録音MD 右クリック「議事録要約」のエントリーポイント */
export async function summarizeFromNote(
  app: App,
  settings: GijiSettings,
  manifestDir: string,
  file: TFile,
  timer?: RecordingTimer,
  deps: SummarizeNoteDeps = {}
): Promise<void> {
  if (timer?.isSummarizing()) {
    new Notice("⚠️ 要約を実行中です");
    return;
  }
  const content: string = await (app.vault.adapter as any).read(file.path);
  const transcript = extractTranscript(content);
  if (!transcript) {
    new Notice("⚠️ 転写テキストが見つかりません");
    return;
  }
  const meta = extractRecordingMeta(content, file);
  const target = await resolveMinutesPath(app, settings, file);
  if (target.exists) {
    const ok = await (deps.confirm ?? ((p: string) => confirmOverwrite(app, p)))(target.path);
    if (!ok) {
      new Notice("⏹ キャンセルしました");
      return;
    }
  }
  timer?.setSummarizing();
  try {
    await runAutoSummarize(transcript, settings, app, manifestDir, {
      fetchImpl: deps.fetchImpl,
      startTime: meta.startTime,
      durationSec: meta.durationSec,
      mp3Links: meta.mp3Links,
      force: true,
      overwritePath: target.path,
      onProgress: (p) => timer?.updateSummarizeStage(p.stage, p.receivedChars),
    });
  } finally {
    timer?.stop();
  }
}
