import test from "node:test";
import assert from "node:assert/strict";
import { formatElapsed, RecordingTimer, RecordingTimerDeps } from "../ui/recordingTimer";

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

test("setSummarizing clears interval and shows 要約生成中", () => {
  const el = makeFakeEl();
  const fake = makeFakeDeps();
  const timer = new RecordingTimer(el, fake.deps);
  timer.start();
  timer.setSummarizing();
  assert.equal(timer.isRunning(), false);
  assert.equal(el.getText(), "🤖 要約生成中…");
  assert.equal(el.isVisible(), true);
  assert.equal(fake.handlerCount(), 0);
});
