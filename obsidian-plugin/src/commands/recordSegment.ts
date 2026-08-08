import { App, Notice } from "obsidian";
import { GijiSettings } from "../settings";
import { SegmentRecorder } from "../audio/recorder";
import { appendSegmentNote } from "../notes/generator";

let recorder: SegmentRecorder | null = null;

function getRecorder(app: App): SegmentRecorder {
  if (!recorder) recorder = new SegmentRecorder(app);
  return recorder;
}

export async function startSegment(app: App, settings: GijiSettings) {
  const r = getRecorder(app);
  const started = await r.start(settings);
  if (started) {
    new Notice("🎙️ 录音中… 再次执行「停止并转写」结束");
  }
}

export async function stopSegment(app: App, settings: GijiSettings) {
  const r = getRecorder(app);
  const result = await r.stop(settings);
  if (result === null) return;

  const view = app.workspace.getActiveViewOfType(Object as any) as any;
  const editor = view?.editor;
  if (!editor) {
    new Notice("请先打开一篇笔记再追加转写");
    return;
  }
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const cur = editor.getValue();
  editor.setValue(appendSegmentNote(cur, `${time}`, result.text));
  new Notice("✅ 转写已追加");
}
