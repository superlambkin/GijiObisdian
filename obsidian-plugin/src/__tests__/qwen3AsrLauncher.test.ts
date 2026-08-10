import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureLocalAsrServer,
  launchLocalAsrServer,
  asrServerOrigin,
} from "../qwen3AsrLauncher";
import { DEFAULT_SETTINGS } from "../settings";

const base = {
  ...DEFAULT_SETTINGS,
  sttProvider: "qwen3-asr" as const,
  sttBaseUrl: "http://127.0.0.1:9000/v1",
  sttServerDir: "D:\\AI-Agent\\giji-obsidian\\qwen3-asr-server",
};

/** health チェックの URL を検証しつつ、okAfter 回目以降を up とみなす fetch モック */
function healthFetch(okAfter: number) {
  let calls = 0;
  return (async (url: string) => {
    calls++;
    assert.equal(url, "http://127.0.0.1:9000/health");
    return {
      ok: calls > okAfter,
      status: calls > okAfter ? 200 : 503,
      text: async () => "not ready",
    } as any;
  }) as any;
}

test("asrServerOrigin strips /v1 from sttBaseUrl", () => {
  assert.equal(asrServerOrigin("http://127.0.0.1:9000/v1"), "http://127.0.0.1:9000");
  assert.equal(asrServerOrigin("http://127.0.0.1:9000"), "http://127.0.0.1:9000");
});

test("ensureLocalAsrServer: cloud provider returns true and does NOT spawn", async () => {
  const cloudSettings = { ...base, sttProvider: "openai" as const };
  const spawnCalls: any[] = [];
  const spawnImpl = (cmd: string, args: string[], opts: any) => {
    spawnCalls.push({ cmd, args, opts });
    return {} as any;
  };
  const ok = await ensureLocalAsrServer(cloudSettings, { spawnImpl });
  assert.equal(ok, true);
  assert.equal(spawnCalls.length, 0);
});

test("launchLocalAsrServer returns true when server already up (health 200, no spawn)", async () => {
  const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as any;
  const spawnCalls: any[] = [];
  const spawnImpl = (cmd: string, args: string[], opts: any) => {
    spawnCalls.push({ cmd, args, opts });
    return {} as any;
  };
  const ok = await launchLocalAsrServer(base, { fetchImpl, spawnImpl });
  assert.equal(ok, true);
  assert.equal(spawnCalls.length, 0);
});

test("launchLocalAsrServer spawns venv python and polls until up", async () => {
  const fetchImpl = healthFetch(1);
  const spawnCalls: any[] = [];
  const spawnImpl = (cmd: string, args: string[], opts: any) => {
    spawnCalls.push({ cmd, args, opts });
    return {} as any;
  };
  const ok = await launchLocalAsrServer(base, {
    fetchImpl,
    spawnImpl,
    pollIntervalMs: 10,
    timeoutMs: 500,
  });
  assert.equal(ok, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(
    spawnCalls[0].cmd,
    "D:\\AI-Agent\\giji-obsidian\\qwen3-asr-server\\.venv\\Scripts\\python.exe"
  );
  assert.deepEqual(spawnCalls[0].args, ["main.py"]);
  assert.equal(spawnCalls[0].opts.cwd, base.sttServerDir);
  assert.equal(spawnCalls[0].opts.detached, true);
  assert.equal(spawnCalls[0].opts.stdio, "ignore");
  assert.equal(spawnCalls[0].opts.windowsHide, true);
});

test("ensureLocalAsrServer throws friendly start message when server never comes up", async () => {
  const fetchImpl = (async () => ({ ok: false, status: 503, text: async () => "down" })) as any;
  const spawnImpl = () => ({}) as any;
  await assert.rejects(
    () =>
      ensureLocalAsrServer(base, {
        fetchImpl,
        spawnImpl,
        pollIntervalMs: 10,
        timeoutMs: 100,
      }),
    /start_qwen3_asr\.bat/
  );
});
