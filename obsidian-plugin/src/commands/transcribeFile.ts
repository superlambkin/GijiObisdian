import { App, Notice, TFile } from "obsidian";
import { GijiSettings, clampSttConcurrency } from "../settings";
import { transcribeAudio } from "./importAudio";
import { saveTranscriptToFile } from "../notes/saver";
import { buildMp3Links } from "../notes/mp3Ref";
import { validateAudioFile, AudioValidationResult } from "../audio/validateAudio";
import { prepareChunksForStt } from "../audio/ffmpegConvert";
import { transcribeWithRetry } from "../providers/sttRetry";
import { info as logInfo, warn as logWarn, error as logError, debug as logDebug } from "../debug/logRecorder";

/** File の互換インターフェース（テスト容易性） */
export interface AudioFileLike {
  name: string;
  path?: string;
  type?: string;
  lastModified: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** 再生時間を取得（失敗時は undefined）。既定実装。 */
async function defaultGetDurationSec(file: AudioFileLike): Promise<number | undefined> {
  try {
    const buf = await file.arrayBuffer();
    const url = URL.createObjectURL(new Blob([buf]));
    const audio = new Audio(url);
    const duration = await new Promise<number | undefined>((resolve) => {
      audio.addEventListener(
        "loadedmetadata",
        () => resolve(isFinite(audio.duration) ? audio.duration : undefined),
        { once: true }
      );
      audio.addEventListener("error", () => resolve(undefined), { once: true });
    });
    URL.revokeObjectURL(url);
    return duration;
  } catch {
    return undefined;
  }
}

/** 単一ファイルの文字起こし依存 */
export interface TranscribeFileDeps {
  transcribe?: (buf: ArrayBuffer, settings: GijiSettings) => Promise<string>;
  getDurationSec?: (file: AudioFileLike) => Promise<number | undefined>;
}

/**
 * 選択した録音ファイルを現在の STT 設定で転写し、転写 MD として自動保存する。
 * 追記は行わず常に新規 MD 作成（appendRecordEnabled は無視）。
 */
export async function transcribeAndSaveAudioFile(
  app: App,
  settings: GijiSettings,
  file: AudioFileLike,
  deps: TranscribeFileDeps = {}
): Promise<{ path: string; charCount: number }> {
  const transcribe = deps.transcribe ?? transcribeAudio;
  const getDurationSec = deps.getDurationSec ?? defaultGetDurationSec;

  const buf = await file.arrayBuffer();
  const sttStart = Date.now();
  const text = await transcribe(buf, settings);
  const sttMs = Date.now() - sttStart;

  const mp3Links = file.path ? buildMp3Links([file.path]) : "";
  const durationSec = await getDurationSec(file);
  const now = new Date(file.lastModified || Date.now());
  const saved = await saveTranscriptToFile(
    app,
    { ...settings, appendRecordEnabled: false },
    text,
    durationSec,
    now,
    mp3Links,
    sttMs
  );
  return { path: saved.path, charCount: text.trim().length };
}

export interface TranscribeFilesDeps {
  validate?: (file: AudioFileLike) => Promise<AudioValidationResult>;
  convert?: (file: AudioFileLike) => Promise<ArrayBuffer[] | ArrayBuffer>;
  transcribe?: (buf: ArrayBuffer, settings: GijiSettings) => Promise<string>;
  concurrency?: number;
}

interface BatchFileResult {
  file: AudioFileLike;
  text?: string;
  error?: string;
}

/**
 * 複数音声ファイルを検証・変換・文字起こしし、時系列順の統合 Markdown として保存する。
 */
export async function transcribeAndSaveAudioFiles(
  app: App,
  settings: GijiSettings,
  files: AudioFileLike[],
  deps: TranscribeFilesDeps = {}
): Promise<{ path?: string; failed: string[] }> {
  const validate = deps.validate ?? validateAudioFile;
  const convert = deps.convert ?? ((file) => prepareChunksForStt(file));
  const concurrency = deps.concurrency ?? clampSttConcurrency(settings.sttMaxConcurrency);
  const sortedFiles = [...files].sort((a, b) => {
    const byTime = a.lastModified - b.lastModified;
    return byTime || a.name.localeCompare(b.name);
  });

  logInfo("transcribeFiles", "start", {
    count: sortedFiles.length,
    concurrency,
    sttProvider: settings.sttProvider,
  });

  const validFiles: AudioFileLike[] = [];
  const results: BatchFileResult[] = [];
  const failed: string[] = [];

  for (const file of sortedFiles) {
    logInfo("transcribeFiles", "processing file", {
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
    });
    const validation = await validate(file);
    if (!validation.ok) {
      const error = validation.error ?? "validation failed";
      logWarn("transcribeFiles", "validation failed", { file: file.name, error });
      results.push({ file, error });
      failed.push(`${file.name}: ${error}`);
      continue;
    }
    logDebug("transcribeFiles", "validation ok", { file: file.name, format: validation.format });
    validFiles.push(file);

    try {
      logInfo("transcribeFiles", "convert start", { file: file.name });
      const rawChunks = await convert(file);
      const chunks = rawChunks instanceof ArrayBuffer
        ? [rawChunks]
        : Array.from(rawChunks);
      logInfo("transcribeFiles", "convert ok", { file: file.name, chunks: chunks.length });
      const transcript = await transcribeWithRetry(chunks, settings, concurrency, {
        transcribe: deps.transcribe,
      });
      if (!transcript.success) {
        const error = transcript.failedChunks
          .map((item) => `チャンク${item.index + 1}: ${item.error ?? "失敗"}`)
          .join("; ");
        logError("transcribeFiles", "transcribeWithRetry failed", undefined, {
          file: file.name,
          chunks: transcript.failedChunks.length,
          error,
        });
        results.push({ file, error });
        failed.push(`${file.name}: ${error}`);
      } else {
        logInfo("transcribeFiles", "transcribe ok", {
          file: file.name,
          chunks: transcript.results.length,
          chars: transcript.results.join("").length,
        });
        results.push({ file, text: transcript.results.join("\n\n") });
      }
    } catch (err: any) {
      const error = err?.message ?? String(err);
      logError("transcribeFiles", "convert or transcribe threw", err, {
        file: file.name,
        error,
      });
      results.push({ file, error });
      failed.push(`${file.name}: ${error}`);
    }
  }

  const successResults = results.filter((result): result is BatchFileResult & { text: string } =>
    typeof result.text === "string" && result.text.length > 0
  );
  logInfo("transcribeFiles", "summary", {
    total: sortedFiles.length,
    success: successResults.length,
    failed: failed.length,
  });
  if (successResults.length === 0) return { failed };

  const failedResults = results.filter((result) => Boolean(result.error));
  const oldest = sortedFiles[0]?.lastModified || Date.now();
  const content = renderTranscriptionResult(successResults, failedResults);
  const saved = await saveTranscriptToFile(
    app,
    { ...settings, appendRecordEnabled: false },
    content,
    undefined,
    new Date(oldest)
  );
  return { path: saved.path, failed };
}

export function renderTranscriptionResult(
  successResults: Array<{ file: AudioFileLike; text: string }>,
  failedResults: Array<{ file: AudioFileLike; error: string }>
): string {
  const lines = ["# 文字起こし結果", ""];
  if (failedResults.length > 0) {
    lines.push("## ⚠️ 一部ファイルの文字起こしに失敗", "", "| ファイル | エラー |", "|---------|--------|");
    for (const result of failedResults) lines.push(`| ${result.file.name} | ${result.error} |`);
    lines.push("");
  }
  for (const result of successResults) {
    lines.push(`## ${formatLocalDateTime(result.file.lastModified)} — ${result.file.name}`, "", result.text, "");
  }
  return lines.join("\n");
}

function formatLocalDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** ファイル選択ダイアログを開く DOM ラッパー（複数選択対応） */
export function openRecordingFilePicker(app: App, settings: GijiSettings): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = "audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,.wav,.mp3,.m4a";
  input.onchange = async () => {
    const fileList = input.files;
    if (!fileList || fileList.length === 0) return;
    try {
      new Notice(`文字起こし中: ${fileList.length} ファイルを処理します…`);
      const result = await transcribeAndSaveAudioFiles(app, settings, Array.from(fileList));
      if (result.path) {
        new Notice(`✅ 転写を保存しました: ${result.path}`);
        if (result.failed.length > 0) {
          // 失敗したファイル名とエラー内容を Notice に展開（デバッグ容易化）
          for (const fail of result.failed) {
            new Notice(`⚠️ 失敗: ${fail}`, 8000);
          }
        }
        const tfile = app.vault.getAbstractFileByPath(result.path);
        if (tfile instanceof TFile) await app.workspace.getLeaf(false).openFile(tfile);
      } else {
        const detail = result.failed.slice(0, 3).join("\n");
        new Notice(`❌ 全件失敗（${result.failed.length} 件）:\n${detail}`, 10000);
      }
    } catch (err: any) {
      new Notice(`❌ 転写に失敗しました: ${err?.message ?? err}`);
    }
  };
  document.body.appendChild(input);
  input.click();
  document.body.removeChild(input);
}
