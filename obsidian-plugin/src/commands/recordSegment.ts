import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { SegmentRecorder, SegmentResult } from "../audio/recorder";
import { DirectRecorder, PcLevel } from "../audio/directRecorder";
import { appendSegmentNote } from "../notes/generator";
import { buildMp3Links } from "../notes/mp3Ref";
import { runAutoSummarize } from "./autoSummarize";
import { RecordingTimer, llmModelLabel } from "../ui/recordingTimer";
import { LevelMeter } from "../ui/levelMeter";

let recorder: SegmentRecorder | null = null;

/** v0.15: ステータスバーメーターと録音状態の照会 API（main.ts から登録する） */
let levelMeterApi: { meter: LevelMeter; isRecording: () => boolean } | null = null;

export function setLevelMeterApi(
  api: { meter: LevelMeter; isRecording: () => boolean } | null
): void {
  levelMeterApi = api;
}

/** v0.15: 録音進行中か（LevelMonitor のガードに使う） */
export function isSegmentRecording(): boolean {
  return recorder?.isRecording() ?? false;
}

/**
 * v0.15.1: 録音 UI すべてで共有する Recorder を返す。
 * Claudian ボタンが個別の SegmentRecorder を作ると、レベルメーターの中継や
 * isSegmentRecording() のガードが効かなくなるため、必ずこれを使う。
 */
export function getSharedRecorder(app: App, manifestDir: string = ""): SegmentRecorder {
  return getRecorder(app, manifestDir);
}

function getRecorder(app: App, manifestDir: string = ""): SegmentRecorder {
  if (!recorder) {
    const direct = new DirectRecorder({}, app, manifestDir);
    // v0.15: 録音中の入力レベルをステータスバーメーターへ中継
    if (levelMeterApi) {
      const meter = levelMeterApi.meter;
      direct.registerLevelListener((source: "mic" | "pc", level: PcLevel) =>
        meter.setLevel(source, level)
      );
    }
    recorder = new SegmentRecorder(app, manifestDir, direct);
  }
  return recorder;
}

export async function startSegment(app: App, settings: GijiSettings, manifestDir: string, timer?: RecordingTimer) {
  const r = getRecorder(app, manifestDir);
  const started = await r.start(settings);
  if (started) {
    timer?.start();
    levelMeterApi?.meter.show();
    new Notice("🎙️ 録音中… もう一度「停止して転写」を実行すると終了します");
  }
}

export async function stopSegment(app: App, settings: GijiSettings, manifestDir: string, timer?: RecordingTimer) {
  timer?.setTranscribing(); // 録音停止 → 文字起こし中
  levelMeterApi?.meter.hide(); // v0.15: 録音用メーターを隠す
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
  timer?.setSummarizing(llmModelLabel(settings));
  const mp3Links = buildMp3Links(result.audioPaths ?? []);
  void runAutoSummarize(result.text, settings, app, manifestDir, {
    startTime,
    durationSec: result.durationSec,
    mp3Links,
    sttMs: result.sttMs,
    onProgress: (p) => timer?.updateSummarizeStage(p.stage, p.receivedChars),
  }).finally(() => timer?.stop());
}
