import test from "node:test";
import assert from "node:assert/strict";
import { LevelMonitor, LevelMonitorDeps } from "../audio/levelMonitor";
import { LevelMeter } from "../ui/levelMeter";
import { GijiSettings } from "../settings";

function makeFakeEl(): any {
  const el: any = {
    children: [],
    style: {},
    className: "",
    textContent: "",
    shown: true,
    createDiv() {
      const c = makeFakeEl();
      el.children.push(c);
      return c;
    },
    createSpan() {
      const c = makeFakeEl();
      el.children.push(c);
      return c;
    },
    show() {
      el.shown = true;
    },
    hide() {
      el.shown = false;
    },
    remove() {},
  };
  return el;
}

function makeFakeStream() {
  const stopped: number[] = [];
  return {
    stream: { getTracks: () => [{ stop: () => stopped.push(1) }] } as unknown as MediaStream,
    stopped,
  };
}

class FakeMonitorAudioContext {
  closed = false;
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createAnalyser() {
    return {
      fftSize: 1024,
      getFloatTimeDomainData(buf: Float32Array) {
        buf.fill(0.5);
      },
    };
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

interface MonitorHarness {
  monitor: LevelMonitor;
  meter: LevelMeter;
  el: any;
  fireInterval: () => void;
  intervalCount: () => number;
  pcHandle: { onLevelCbs: Array<(l: any) => void>; stdinEnded: boolean };
  closedCtxs: FakeMonitorAudioContext[];
  stopped: number[];
  setNow: (ms: number) => void;
  settings: GijiSettings;
}

function makeHarness(overrides: Partial<LevelMonitorDeps> = {}): MonitorHarness {
  const handlers: Array<() => void> = [];
  let now = 0;
  const pcHandle = {
    onLevelCbs: [] as Array<(l: any) => void>,
    stdinEnded: false,
    onLevel(cb: (l: any) => void) {
      pcHandle.onLevelCbs.push(cb);
    },
    stop: async () => {
      pcHandle.stdinEnded = true;
      return "C:/mon.wav";
    },
  };
  const closedCtxs: FakeMonitorAudioContext[] = [];
  const mic = makeFakeStream();
  const settings = {
    directMicDeviceId: "",
    directSpeakerDeviceId: "",
    pcLoopbackScriptDir: "",
  } as unknown as GijiSettings;

  const deps: LevelMonitorDeps = {
    getUserMedia: async () => mic.stream,
    // 注意: new Ctor() で呼ばれるためアロー関数は使えない（通常の function を使う）
    AudioContextCtor: (function () {
      const ctx = new FakeMonitorAudioContext();
      closedCtxs.push(ctx);
      return ctx;
    }) as unknown as typeof AudioContext,
    spawnPcLoopbackCapture: async () => pcHandle as any,
    setInterval: (fn: () => void) => {
      handlers.push(fn);
      return handlers.length as any;
    },
    clearInterval: (h: any) => {
      handlers.splice(Number(h) - 1, 1);
    },
    now: () => now,
    ...overrides,
  };

  const el = makeFakeEl();
  const meter = new LevelMeter(el);
  const monitor = new LevelMonitor(undefined, "", meter, deps);
  return {
    monitor,
    meter,
    el,
    fireInterval: () => handlers.forEach((h) => h()),
    intervalCount: () => handlers.length,
    pcHandle,
    closedCtxs,
    stopped: mic.stopped,
    setNow: (ms: number) => {
      now = ms;
    },
    settings,
  };
}

test("start: マイク取得 + Python monitor 起動 + メーター表示", async () => {
  const h = makeHarness();
  const ok = await h.monitor.start(h.settings);
  assert.equal(ok, true);
  assert.equal(h.monitor.isRunning(), true);
  assert.equal(h.el.shown, true); // meter.show()
  assert.equal(h.pcHandle.onLevelCbs.length, 1); // onLevel 登録済み
});

test("polling: マイクの rms が setLevel('mic') に流れる", async () => {
  const h = makeHarness();
  await h.monitor.start(h.settings);
  h.fireInterval();
  const root = h.el.children[0];
  const micFill = root.children[1].children[0];
  // analyser の fake は 0.5 埋め → -6.02dB → 幅 89.97%
  assert.ok(parseFloat(micFill.style.width) > 80);
  h.monitor.stop();
});

test("onLevel: Python からのレベルが setLevel('pc') に流れる", async () => {
  const h = makeHarness();
  await h.monitor.start(h.settings);
  h.pcHandle.onLevelCbs[0]({ rms: 1, peak: 1 });
  const root = h.el.children[0];
  const pcFill = root.children[3].children[0];
  assert.equal(pcFill.style.width, "100.0%");
  h.monitor.stop();
});

test("無応答: 3 秒レベルが来ないと setUnavailable('pc')", async () => {
  const h = makeHarness();
  await h.monitor.start(h.settings);
  h.setNow(3100);
  h.fireInterval();
  const root = h.el.children[0];
  const pcFill = root.children[3].children[0];
  assert.ok(pcFill.className.includes("giji-level-unavailable"));
  h.monitor.stop();
});

test("stop: ストリーム停止・AudioContext close・メーター非表示", async () => {
  const h = makeHarness();
  await h.monitor.start(h.settings);
  h.monitor.stop();
  assert.equal(h.monitor.isRunning(), false);
  assert.equal(h.el.shown, false);
  assert.equal(h.intervalCount(), 0);
  assert.ok(h.stopped.length >= 1);
  assert.equal(h.closedCtxs[0].closed, true);
  assert.equal(h.pcHandle.stdinEnded, true);
});

test("録音中は開始しない（録音優先）", async () => {
  const h = makeHarness({ isRecording: () => true });
  const ok = await h.monitor.start(h.settings);
  assert.equal(ok, false);
  assert.equal(h.monitor.isRunning(), false);
  assert.equal(h.el.shown, false); // メーターも出ない
});

test("二重開始は無視される", async () => {
  const h = makeHarness();
  assert.equal(await h.monitor.start(h.settings), true);
  assert.equal(await h.monitor.start(h.settings), true);
  assert.equal(h.intervalCount(), 1);
  h.monitor.stop();
});

test("getUserMedia 失敗は throw され、running にならない", async () => {
  const h = makeHarness({
    getUserMedia: async () => {
      throw new Error("denied");
    },
  });
  await assert.rejects(() => h.monitor.start(h.settings), /denied/);
  assert.equal(h.monitor.isRunning(), false);
});

test("実機デフォルト: deps 未指定でもデフォルト実装が使われ、黙って動かない", async () => {
  // 回帰: v0.15.0 では getUserMedia/spawn のデフォルトが無く、main.ts が
  // isRecording しか渡さないため「バーは出るが何も測れない」状態だった
  const el = makeFakeEl();
  const meter = new LevelMeter(el);
  const monitor = new LevelMonitor(undefined, "", meter, {});
  // node には navigator.mediaDevices がないため、デフォルト getUserMedia が
  // 使われていれば start は reject する（デフォルトが無ければ true で返ってしまう）
  await assert.rejects(() => monitor.start(harnessSettings), /MediaDevices/);
  assert.equal(monitor.isRunning(), false);
});

// settings 共有（テスト本体の makeHarness と同じ最小構成）
const harnessSettings = {
  directMicDeviceId: "",
  directSpeakerDeviceId: "",
  pcLoopbackScriptDir: "",
} as unknown as GijiSettings;
