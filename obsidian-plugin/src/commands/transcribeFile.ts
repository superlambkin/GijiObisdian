import { App, Notice, TFile } from "obsidian";
import { GijiSettings } from "../settings";
import { transcribeAudio } from "./importAudio";
import { saveTranscriptToFile } from "../notes/saver";
import { buildMp3Links } from "../notes/mp3Ref";

/** File の互換インターフェース（テスト容易性） */
export interface AudioFileLike {
  name: string;
  path?: string;
  lastModified: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** テスト注入用依存 */
export interface TranscribeFileDeps {
  transcribe?: (buf: ArrayBuffer, settings: GijiSettings) => Promise<string>;
  getDurationSec?: (file: AudioFileLike) => Promise<number | undefined>;
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

/**
 * 選択した録音ファイルを現在の STT 設定で転写し、転写 MD として自動保存する。
 * - 追記は行わず常に新規 MD 作成（appendRecordEnabled は無視）
 * - 時刻基準はファイルの lastModified（フォールバック: 現在時刻）
 * - 議事録（LLM要約）は生成しない
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

  // 追記無効化：1ファイル=1転写MD の一対一対応を保証
  const settingsClone = { ...settings, appendRecordEnabled: false };
  const saved = await saveTranscriptToFile(
    app,
    settingsClone,
    text,
    durationSec,
    now,
    mp3Links,
    sttMs
  );

  return { path: saved.path, charCount: text.trim().length };
}

/**
 * ファイル選択ダイアログを開く DOM ラッパー（settings.ts から呼ぶ）。
 * 選択後は transcribeAndSaveAudioFile で転写→MD保存し、作成 MD をエディタで開く。
 */
export function openRecordingFilePicker(app: App, settings: GijiSettings): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*,.wav,.mp3,.m4a,.flac,.ogg";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const { path } = await transcribeAndSaveAudioFile(app, settings, file as AudioFileLike);
      new Notice(`✅ 転写を保存しました: ${path}`);
      const tfile = app.vault.getAbstractFileByPath(path);
      if (tfile instanceof TFile) {
        await app.workspace.getLeaf(false).openFile(tfile);
      }
    } catch (err: any) {
      new Notice(`❌ 転写に失敗しました: ${err?.message ?? err}`);
    }
  };
  input.click();
}
