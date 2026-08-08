import test from "node:test";
import assert from "node:assert/strict";
import { appendToClaudianInput } from "../ui/claudianApi";

test("returns false when realclaudian is not installed", async () => {
  const app = { plugins: { plugins: {} } };
  assert.equal(await appendToClaudianInput(app as any, "hello"), false);
});

test("calls internal API in order and returns true on success", async () => {
  const calls: string[] = [];
  const view = {
    appendToActiveInput: (text: string) => {
      calls.push(`append:${text}`);
      return true;
    },
  };
  const p = {
    activateView: async () => {
      calls.push("activateView");
    },
    getView: () => {
      calls.push("getView");
      return view;
    },
  };
  const app = { plugins: { plugins: { realclaudian: p } } };
  assert.equal(await appendToClaudianInput(app as any, "转写文本"), true);
  assert.deepEqual(calls, ["activateView", "getView", "append:转写文本"]);
});

test("returns false when view is not ready", async () => {
  const p = {
    activateView: async () => {},
    getView: () => null,
  };
  const app = { plugins: { plugins: { realclaudian: p } } };
  assert.equal(await appendToClaudianInput(app as any, "x"), false);
});

test("returns false when appendToActiveInput rejects the text", async () => {
  const p = {
    activateView: async () => {},
    getView: () => ({ appendToActiveInput: () => false }),
  };
  const app = { plugins: { plugins: { realclaudian: p } } };
  assert.equal(await appendToClaudianInput(app as any, "x"), false);
});

test("returns false instead of throwing when API errors", async () => {
  const p = {
    activateView: async () => {
      throw new Error("boom");
    },
    getView: () => null,
  };
  const app = { plugins: { plugins: { realclaudian: p } } };
  assert.equal(await appendToClaudianInput(app as any, "x"), false);
});
