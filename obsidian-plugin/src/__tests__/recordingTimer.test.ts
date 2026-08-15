import test from "node:test";
import assert from "node:assert/strict";
import {
  formatElapsed,
  RecordingTimer,
  RecordingTimerDeps,
  llmModelLabel,
} from "../ui/recordingTimer";
import { DEFAULT_SETTINGS } from "../settings";

function makeFakeEl() {
  let text = "";
  let visible = true;
  return {
    getText: () => text,
    isVisible: () => visible,
    setText: (v: string) => { text = v; },
    show: () => { visible = true; },
    hide: () => { visible = false; },
  } as any;
}

function makeFakeDeps() {
  let handlers: Array<() => void> = [];
  let now = 0;
  return {
    deps: {
      setInterval: (fn: () => void) => { handlers.push(fn); return handlers.length; },
      clearInterval: () => { handlers = []; },
      now: () => now,
    } as RecordingTimerDeps,
    fire: () => handlers.forEach((h) => h()),
    setNow: (v: number) => { now = v; },
    handlerCount: () => handlers.length,
  };
}

test("formatElapsed formats MM:SS", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(1000), "00:01");
  assert.equal(formatElapsed(61_000), "01:01");
  assert.equal(formatElapsed(3_600_000), "60:00");
  assert.equal(formatElapsed(3_660_000), "61:00");
});

test("starts hidden", () => {
  const el = makeFakeEl();
  const timer = new RecordingTimer(el);
  assert.equal(el.isVisible(), false);
});

test("start shows 🎙️ 00:00 and marks running", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  assert.equal(timer.isRunning(), true);
  assert.equal(el.getText(), "🎙️ 00:00");
  assert.equal(el.isVisible(), true);
  assert.equal(fake.handlerCount(), 1);
});

test("interval updates elapsed time", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  fake.setNow(65_000);
  fake.fire();
  assert.equal(el.getText(), "🎙️ 01:05");
});

test("stop clears interval and hides", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  timer.stop();
  assert.equal(timer.isRunning(), false);
  assert.equal(el.isVisible(), false);
  assert.equal(fake.handlerCount(), 0);
});

test("double start is ignored", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  fake.setNow(10_000);
  timer.start();
  fake.fire();
  assert.equal(el.getText(), "🎙️ 00:10");
  assert.equal(fake.handlerCount(), 1);
});

test("setTranscribing clears interval and shows 文字起こし中", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  fake.setNow(30_000);
  fake.fire();
  timer.setTranscribing();
  assert.equal(timer.isRunning(), false);
  assert.equal(el.getText(), "📝 文字起こし中…");
  assert.equal(el.isVisible(), true);
  assert.equal(fake.handlerCount(), 0);
});

test("setSummarizing shows 要約生成中 with elapsed time and ticks", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  timer.setSummarizing();
  assert.equal(timer.isRunning(), true);
  assert.equal(el.getText(), "📡 要約中… 00:00");
  assert.equal(el.isVisible(), true);
  assert.equal(fake.handlerCount(), 1);
  fake.setNow(95_000);
  fake.fire();
  assert.equal(el.getText(), "📡 要約中… 01:35");
});

test("llmModelLabel: プリセットの短縮名を返す", () => {
  assert.equal(llmModelLabel({ ...DEFAULT_SETTINGS, llmProvider: "claudian" }), "Claudian");
  assert.equal(
    llmModelLabel({ ...DEFAULT_SETTINGS, llmProvider: "deepseek", llmModel: "deepseek-v4-flash" }),
    "DeepSeek"
  );
  assert.equal(llmModelLabel({ ...DEFAULT_SETTINGS, llmProvider: "kimi" }), "Kimi");
  assert.equal(llmModelLabel({ ...DEFAULT_SETTINGS, llmProvider: "kimi-coding" }), "KimiC");
  assert.equal(llmModelLabel({ ...DEFAULT_SETTINGS, llmProvider: "openai" }), "OpenAI");
});

test("setSummarizing(model) はステータスバーにモデル名を表示する", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.setSummarizing("deepseek-v4-flash");
  assert.equal(el.getText(), "📡 要約中…（deepseek-v4-flash） 00:00");
  timer.updateSummarizeStage("generating", 123);
  assert.equal(el.getText(), "✍️ 生成中…（deepseek-v4-flash） 123字 00:00");
});

test("summarizing の経過時間は setSummarizing 時点から計測される", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  fake.setNow(60_000); // 録音 60 秒経過
  fake.fire();
  timer.setSummarizing(); // 要約開始で 00:00 にリセット
  assert.equal(el.getText(), "📡 要約中… 00:00");
  fake.setNow(65_000);
  fake.fire();
  assert.equal(el.getText(), "📡 要約中… 00:05");
});

test("要約生成中に start すると録音表示へ切り替わる", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.setSummarizing();
  fake.setNow(30_000);
  fake.fire();
  assert.equal(el.getText(), "📡 要約中… 00:30");
  timer.start(); // 要約完了を待たずに新規録音開始
  assert.equal(el.getText(), "🎙️ 00:00");
  fake.setNow(33_000);
  fake.fire();
  assert.equal(el.getText(), "🎙️ 00:03");
  assert.equal(fake.handlerCount(), 1);
});

test("updateSummarizeStage: generating で受信文字数付き表示", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.setSummarizing();
  assert.equal(el.getText(), "📡 要約中… 00:00");
  timer.updateSummarizeStage("generating", 12345);
  assert.equal(el.getText(), "✍️ 生成中… 12,345字 00:00");
  fake.setNow(65_000);
  fake.fire();
  assert.equal(el.getText(), "✍️ 生成中… 12,345字 01:05");
});

test("updateSummarizeStage: saving 表示", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.setSummarizing();
  timer.updateSummarizeStage("saving");
  assert.equal(el.getText(), "💾 保存中… 00:00");
});

test("録音モード中の updateSummarizeStage は表示を切り替えない", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  timer.updateSummarizeStage("generating", 100);
  assert.equal(el.getText(), "🎙️ 00:00");
  // 要約モードでないので isSummarizing は false
  assert.equal(timer.isSummarizing(), false);
});

test("isSummarizing: setSummarizing 後は true、stop で false", () => {
  const el = makeFakeEl();
  const timer = new RecordingTimer(el, makeFakeDeps().deps);
  assert.equal(timer.isSummarizing(), false);
  timer.setSummarizing();
  assert.equal(timer.isSummarizing(), true);
  timer.stop();
  assert.equal(timer.isSummarizing(), false);
});
