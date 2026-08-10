import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { SegmentRecorder, SegmentResult } from "../audio/recorder";
import { appendSegmentNote } from "../notes/generator";
import { buildMp3Links } from "../notes/mp3Ref";
import { runAutoSummarize } from "./autoSummarize";
import { RecordingTimer } from "../ui/recordingTimer";

let recorder: SegmentRecorder | null = null;

function getRecorder(app: App, manifestDir: string = ""): SegmentRecorder {
  if (!recorder) recorder = new SegmentRecorder(app, manifestDir);
  return recorder;
}

export async function startSegment(app: App, settings: GijiSettings, timer?: RecordingTimer) {
  const r = getRecorder(app);
  const started = await r.start(settings);
  if (started) {
    timer?.start();
    new Notice("🎙️ 録音中… もう一度「停止して転写」を実行すると終了します");
  }
}

export async function stopSegment(app: App, settings: GijiSettings, manifestDir: string, timer?: RecordingTimer) {
  timer?.setTranscribing(); // 録音停止 → 文字起こし中
  const r = getRecorder(app, manifestDir);
  let result: SegmentResult | null;
  try {
    result = await r.stop(settings);
  } catch (err) {
    timer?.stop(); // 例外時もタイマーを非表示に戻す
    throw err;
  }
  if (result === null) {
    timer?.stop();
    new Notice("⚠️ 進行中の録音がありません");
    return;
  }

  const view = app.workspace.getActiveViewOfType(Object as any) as any;
  const editor = view?.editor;
  if (!editor) {
    timer?.stop();
    new Notice("⚠️ 転写を追記する前にノートを開いてください");
    return;
  }
  const startTime = result.startTime ?? new Date();
  const time = `${startTime.getHours().toString().padStart(2, "0")}:${startTime.getMinutes().toString().padStart(2, "0")}`;
  const cur = editor.getValue();
  editor.setValue(appendSegmentNote(cur, `${time}`, result.text));
  const sttSec = typeof result.sttMs === "number" ? (result.sttMs / 1000).toFixed(1) : null;
  new Notice(
    sttSec ? `✅ ノートに転写を追記しました（処理時間: ${sttSec} 秒）` : "✅ ノートに転写を追記しました"
  );

  // 議事録の自動生成（要約中表示 → 完了で非表示）
  timer?.setSummarizing();
  const mp3Links = buildMp3Links(result.audioPaths ?? []);
  void runAutoSummarize(result.text, settings, app, manifestDir, {
    startTime,
    durationSec: result.durationSec,
    mp3Links,
    onProgress: (p) => timer?.updateSummarizeStage(p.stage, p.receivedChars),
  }).finally(() => timer?.stop());
}
