import test from "node:test";
import assert from "node:assert/strict";
import { listDevices } from "../audio/deviceList";

const baseSettings = {} as any;

test("browser enumerate で source=direct を返す", async () => {
  const result = await listDevices(baseSettings, {
    browserEnumerate: async () =>
      [
        { kind: "audioinput", deviceId: "in-1", label: "Mic" } as MediaDeviceInfo,
        { kind: "audiooutput", deviceId: "out-1", label: "Speaker" } as MediaDeviceInfo,
      ] as MediaDeviceInfo[],
  });
  assert.equal(result.source, "direct");
  assert.equal(result.microphones.length, 1);
  assert.equal(result.microphones[0].id, "in-1");
  assert.equal(result.speakers.length, 1);
  assert.equal(result.speakers[0].id, "out-1");
});

test("browser enumerate が例外を投げると source=none", async () => {
  const result = await listDevices(baseSettings, {
    browserEnumerate: async () => {
      throw new Error("permission denied");
    },
  });
  assert.equal(result.source, "none");
});

test("audioinput のみ microphones、audiooutput のみ speakers に分類", async () => {
  const result = await listDevices(baseSettings, {
    browserEnumerate: async () =>
      [
        { kind: "audioinput", deviceId: "in-1", label: "Mic1" } as MediaDeviceInfo,
        { kind: "audioinput", deviceId: "in-2", label: "Mic2" } as MediaDeviceInfo,
        { kind: "audiooutput", deviceId: "out-1", label: "Spk" } as MediaDeviceInfo,
        { kind: "videoinput", deviceId: "cam-1", label: "Cam" } as MediaDeviceInfo,
      ] as MediaDeviceInfo[],
  });
  assert.equal(result.microphones.length, 2);
  assert.equal(result.speakers.length, 1);
  assert.ok(!result.microphones.some((m) => m.id === "cam-1"));
  assert.ok(!result.speakers.some((s) => s.id === "cam-1"));
});

test("label が空なら (unnamed input/output) にフォールバック", async () => {
  const result = await listDevices(baseSettings, {
    browserEnumerate: async () =>
      [
        { kind: "audioinput", deviceId: "in-x", label: "" } as MediaDeviceInfo,
        { kind: "audiooutput", deviceId: "out-x", label: "" } as MediaDeviceInfo,
      ] as MediaDeviceInfo[],
  });
  assert.equal(result.microphones[0].name, "(unnamed input)");
  assert.equal(result.speakers[0].name, "(unnamed output)");
});
