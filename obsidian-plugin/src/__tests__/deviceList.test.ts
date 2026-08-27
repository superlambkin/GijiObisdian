import test from "node:test";
import assert from "node:assert/strict";
import { listDevices, DeviceListResult } from "../audio/deviceList";

const baseSettings = {
  recordingMethod: "bridge" as const,
  bridgeBaseUrl: "http://bridge.invalid",
};

test("bridge 成功時は bridge payload を返す（source=bridge）", async () => {
  const result = await listDevices(baseSettings as any, {
    bridgeFetch: async () => ({
      microphones: [{ id: "m1", name: "BT JM19" }],
      speakers: [{ id: "s1", name: "PC Speaker" }],
      source: "bridge",
    }),
    browserEnumerate: async () => {
      throw new Error("should not be called");
    },
  });
  assert.equal(result.source, "bridge");
  assert.equal(result.microphones.length, 1);
  assert.equal(result.microphones[0].id, "m1");
  assert.equal(result.speakers.length, 1);
});

test("bridge 不可達時は browser enumerate にフォールバック（source=direct）", async () => {
  const result = await listDevices(baseSettings as any, {
    bridgeFetch: async () => null,
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

test("bridge 不可達 + browser 失敗 → source=none、空配列", async () => {
  const result = await listDevices(baseSettings as any, {
    bridgeFetch: async () => null,
    browserEnumerate: async () => {
      throw new Error("no enumerateDevices");
    },
  });
  assert.equal(result.source, "none");
  assert.equal(result.microphones.length, 0);
  assert.equal(result.speakers.length, 0);
});

test("direct モードでは bridge を試さず browser enumerate を使う", async () => {
  const result = await listDevices(
    { ...baseSettings, recordingMethod: "direct" } as any,
    {
      bridgeFetch: async () => {
        throw new Error("should not be called");
      },
      browserEnumerate: async () =>
        [{ kind: "audioinput", deviceId: "direct-mic", label: "Direct Mic" } as MediaDeviceInfo],
    }
  );
  assert.equal(result.source, "direct");
  assert.equal(result.microphones.length, 1);
  assert.equal(result.microphones[0].id, "direct-mic");
});

test("browser enumerate が例外を投げると source=none", async () => {
  const result = await listDevices(
    { ...baseSettings, recordingMethod: "direct" } as any,
    {
      browserEnumerate: async () => {
        throw new Error("permission denied");
      },
    }
  );
  assert.equal(result.source, "none");
});

test("audioinput のみ microphones、audiooutput のみ speakers に分類", async () => {
  const result = await listDevices(
    { ...baseSettings, recordingMethod: "direct" } as any,
    {
      browserEnumerate: async () =>
        [
          { kind: "audioinput", deviceId: "in-1", label: "Mic1" } as MediaDeviceInfo,
          { kind: "audioinput", deviceId: "in-2", label: "Mic2" } as MediaDeviceInfo,
          { kind: "audiooutput", deviceId: "out-1", label: "Spk" } as MediaDeviceInfo,
          { kind: "videoinput", deviceId: "cam-1", label: "Cam" } as MediaDeviceInfo,
        ] as MediaDeviceInfo[],
    }
  );
  assert.equal(result.microphones.length, 2);
  assert.equal(result.speakers.length, 1);
  assert.ok(!result.microphones.some((m) => m.id === "cam-1"));
  assert.ok(!result.speakers.some((s) => s.id === "cam-1"));
});

test("label が空なら (unnamed input/output) にフォールバック", async () => {
  const result = await listDevices(
    { ...baseSettings, recordingMethod: "direct" } as any,
    {
      browserEnumerate: async () =>
        [
          { kind: "audioinput", deviceId: "in-x", label: "" } as MediaDeviceInfo,
          { kind: "audiooutput", deviceId: "out-x", label: "" } as MediaDeviceInfo,
        ] as MediaDeviceInfo[],
    }
  );
  assert.equal(result.microphones[0].name, "(unnamed input)");
  assert.equal(result.speakers[0].name, "(unnamed output)");
});
