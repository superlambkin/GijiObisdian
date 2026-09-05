import test from "node:test";
import assert from "node:assert/strict";
import { LevelMeter, levelColorClass, rmsToWidthPercent } from "../ui/levelMeter";

function makeFakeEl(): any {
  const el: any = {
    children: [] as any[],
    style: {} as Record<string, string>,
    className: "",
    textContent: "",
    removed: false,
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
    remove() {
      el.removed = true;
    },
  };
  return el;
}

// ---- 純関数 ----

test("rmsToWidthPercent: フルスケール(rms=1)は 100%", () => {
  assert.equal(rmsToWidthPercent(1), 100);
});

test("rmsToWidthPercent: 無音(rms=0)は 0%", () => {
  assert.equal(rmsToWidthPercent(0), 0);
});

test("rmsToWidthPercent: -6dB(rms≈0.5)は約 90%", () => {
  assert.ok(Math.abs(rmsToWidthPercent(0.5) - 89.97) < 0.1);
});

test("rmsToWidthPercent: -60dB 以下は 0% にクランプ", () => {
  assert.equal(rmsToWidthPercent(0.0001), 0);
});

test("levelColorClass: 閾値で緑/黄/赤を切替", () => {
  assert.equal(levelColorClass(50), "giji-level-green");
  assert.equal(levelColorClass(80), "giji-level-yellow");
  assert.equal(levelColorClass(85), "giji-level-yellow");
  assert.equal(levelColorClass(90), "giji-level-red");
  assert.equal(levelColorClass(100), "giji-level-red");
});

// ---- DOM 挙動（fake el） ----

test("コンストラクタで 🎤/🔊 の 2 本バーを生成し非表示で始まる", () => {
  const el = makeFakeEl();
  const meter = new LevelMeter(el);
  assert.equal(el.shown, false); // 初期は hide
  assert.equal(el.children.length, 1); // root div
  const root = el.children[0];
  // root の中身: 🎤 icon + bar(fill) + 🔊 icon + bar(fill) = 4 要素
  assert.equal(root.children.length, 4);
  meter.destroy();
  assert.equal(root.removed, true);
});

test("setLevel がバー幅と色クラスを更新する", () => {
  const el = makeFakeEl();
  const meter = new LevelMeter(el);
  const root = el.children[0];
  const micFill = root.children[1].children[0];
  meter.setLevel("mic", { rms: 1, peak: 1 });
  assert.equal(micFill.style.width, "100.0%");
  assert.ok(micFill.className.includes("giji-level-red"));
  meter.setLevel("mic", { rms: 0.0001, peak: 0 });
  assert.ok(micFill.className.includes("giji-level-green"));
  meter.destroy();
});

test("setUnavailable が灰色クラスに切替、setLevel で復帰する", () => {
  const el = makeFakeEl();
  const meter = new LevelMeter(el);
  const root = el.children[0];
  const pcFill = root.children[3].children[0];
  meter.setUnavailable("pc");
  assert.ok(pcFill.className.includes("giji-level-unavailable"));
  meter.setLevel("pc", { rms: 0.1, peak: 0.1 });
  assert.ok(!pcFill.className.includes("giji-level-unavailable"));
  meter.destroy();
});

test("show/hide がコンテナの表示を制御する", () => {
  const el = makeFakeEl();
  const meter = new LevelMeter(el);
  assert.equal(el.shown, false);
  meter.show();
  assert.equal(el.shown, true);
  meter.hide();
  assert.equal(el.shown, false);
});
