import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { SegmentRecorder } from "../audio/recorder";
import { appendSegmentNote } from "../notes/generator";
import { runAutoSummarize } from "./autoSummarize";

let recorder: SegmentRecorder | null = null;

function getRecorder(app: App): SegmentRecorder {
  if (!recorder) recorder = new SegmentRecorder(app);
  return recorder;
}

export async function startSegment(app: App, settings: GijiSettings) {
  const r = getRecorder(app);
  const started = await r.start(settings);
  if (started) {
    new Notice("🎙️ 録音中… もう一度「停止して転写」を実行すると終了します");
  }
}

export async function stopSegment(app: App, settings: GijiSettings, manifestDir: string) {
  const r = getRecorder(app);
  const result = await r.stop(settings);
  if (result === null) {
    new Notice("⚠️ 進行中の録音がありません");
    return;
  }

  const view = app.workspace.getActiveViewOfType(Object as any) as any;
  const editor = view?.editor;
  if (!editor) {
    new Notice("⚠️ 転写を追記する前にノートを開いてください");
    return;
  }
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const cur = editor.getValue();
  editor.setValue(appendSegmentNote(cur, `${time}`, result.text));
  new Notice("✅ ノートに転写を追記しました");

  // 議事録の自動生成（fire-and-forget。内部で Notice 表示）
  void runAutoSummarize(result.text, settings, app, manifestDir);
}
