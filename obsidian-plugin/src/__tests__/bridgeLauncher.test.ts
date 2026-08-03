import test from "node:test";
import assert from "node:assert/strict";
import { isBridgeUp, launchBridge } from "../bridgeLauncher";
import { DEFAULT_SETTINGS } from "../settings";

const baseSettings = { ...DEFAULT_SETTINGS };

function makeFetch(okAfter: number) {
  let calls = 0;
  return (async () => {
    calls++;
    return {
      ok: calls > okAfter,
      status: calls > okAfter ? 200 : 503,
      text: async () => "not ready",
    } as any;
  }) as any;
}

test("isBridgeUp reports bridge status from /health", async () => {
  const ok = await isBridgeUp(baseSettings, (async () => ({ ok: true })) as any);
  assert.equal(ok, true);
  const down = await isBridgeUp(baseSettings, (async () => ({ ok: false })) as any);
  assert.equal(down, false);
});

test("launchBridge returns true immediately when bridge already up", async () => {
  const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as any;
  const spawnCalls: any[] = [];
  const spawnImpl = (cmd: string, args: string[], opts: any) => {
    spawnCalls.push({ cmd, args, opts });
    return {} as any;
  };
  const ok = await launchBridge(baseSettings, { fetchImpl, spawnImpl });
  assert.equal(ok, true);
  assert.equal(spawnCalls.length, 0);
});

test("launchBridge spawns python main.py and polls until bridge is up", async () => {
  const fetchImpl = makeFetch(2);
  const spawnCalls: any[] = [];
  const spawnImpl = (cmd: string, args: string[], opts: any) => {
    spawnCalls.push({ cmd, args, opts });
    return {} as any;
  };
  const ok = await launchBridge(baseSettings, {
    fetchImpl,
    spawnImpl,
    pollIntervalMs: 10,
    timeoutMs: 500,
  });
  assert.equal(ok, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].cmd, "python");
  assert.deepEqual(spawnCalls[0].args, ["main.py"]);
  assert.equal(spawnCalls[0].opts.cwd, baseSettings.bridgeDir);
  assert.equal(spawnCalls[0].opts.detached, true);
  assert.equal(spawnCalls[0].opts.stdio, "ignore");
  assert.equal(spawnCalls[0].opts.windowsHide, true);
});

test("launchBridge returns false when bridge never comes up", async () => {
  const fetchImpl = (async () => ({ ok: false, status: 503, text: async () => "down" })) as any;
  const spawnImpl = () => ({}) as any;
  const ok = await launchBridge(baseSettings, {
    fetchImpl,
    spawnImpl,
    pollIntervalMs: 20,
    timeoutMs: 100,
  });
  assert.equal(ok, false);
});

test("launchBridge falls back from python to py on ENOENT", async () => {
  const fetchImpl = makeFetch(1);
  const spawnCalls: any[] = [];
  const spawnImpl = (cmd: string, args: string[], opts: any) => {
    spawnCalls.push({ cmd, args, opts });
    if (cmd === "python") {
      const err: any = new Error("python not found");
      err.code = "ENOENT";
      throw err;
    }
    return {} as any;
  };
  const ok = await launchBridge(baseSettings, { fetchImpl, spawnImpl });
  assert.equal(ok, true);
  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[0].cmd, "python");
  assert.equal(spawnCalls[1].cmd, "py");
});
