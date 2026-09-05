import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import { ensurePythonDeps, buildLoopbackEnv, resetPythonDepsCache } from "../audio/pythonDeps";

/** 指定スクリプトに従って終了コードを返す spawn のフェイク */
function makeSpawnFake(script: Array<{ match: (py: string, args: string[]) => boolean; code: number | "error" }>) {
  const calls: Array<{ py: string; args: string[]; env?: Record<string, string | undefined> }> = [];
  const spawn: any = (py: string, args: string[], opts: any) => {
    const entry = script.find((s) => s.match(py, args)) ?? { code: 1 as const, match: () => true };
    calls.push({ py, args, env: opts?.env });
    const child: any = new EventEmitter();
    child.stdin = { end: () => {} };
    child.pid = 12345;
    queueMicrotask(() => {
      if (entry.code === "error") child.emit("error", new Error("ENOENT"));
      else child.emit("close", entry.code);
    });
    return child;
  };
  return { spawn, calls };
}

test("ensurePythonDeps: 既にインストール済みなら pip を実行しない", async () => {
  resetPythonDepsCache();
  const { spawn, calls } = makeSpawnFake([
    { match: (_py, args) => args[0] === "-c", code: 0 },
  ]);
  const notices: string[] = [];
  const r = await ensurePythonDeps("C:/plugin", {
    spawn,
    onNotice: (m) => notices.push(m),
  });
  assert.equal(r.ok, true);
  assert.equal(calls.some((c) => c.args[0] === "-m"), false, "pip install は実行しない");
  assert.equal(notices.length, 0);
});

test("ensurePythonDeps: 未インストールなら pip install --target pylibs してから再チェック", async () => {
  resetPythonDepsCache();
  let checked = 0;
  const { spawn, calls } = makeSpawnFake([
    { match: (_py, args) => args[0] === "-c", code: 0 }, // 再チェックで成功
    { match: (_py, args) => args[0] === "-c", code: 1 }, // 初回チェックは失敗
    { match: (_py, args) => args[0] === "-m", code: 0 }, // pip install 成功
  ]);
  // match は先頭から評価されるため、呼び出し順で分岐させる実装にする
  const spawnOrdered: any = (py: string, args: string[], opts: any) => {
    let code: number | "error";
    if (args[0] === "-c") {
      // 候補 3 つ（venv/python/py）の初回チェックはすべて失敗、pip 後の再チェックで成功
      code = checked < 3 ? 1 : 0;
      checked++;
    } else {
      code = 0; // pip install 成功
    }
    calls.push({ py, args, env: opts?.env });
    const child: any = new EventEmitter();
    child.stdin = { end: () => {} };
    queueMicrotask(() => child.emit("close", code));
    return child;
  };
  const notices: string[] = [];
  const r = await ensurePythonDeps("C:/plugin", {
    spawn: spawnOrdered,
    onNotice: (m) => notices.push(m),
  });
  assert.equal(r.ok, true);
  const pip = calls.find((c) => c.args[0] === "-m");
  assert.ok(pip, "pip install が実行される");
  assert.deepEqual(pip!.args.slice(0, 4), ["-m", "pip", "install", "--target"]);
  assert.ok(pip!.args[4].includes("pylibs"), "導入先はプラグインフォルダ内 pylibs");
  assert.ok(notices.some((m) => m.includes("インストール")), "進行中の Notice が出る");
});

test("ensurePythonDeps: pip 失敗時は ok=false（呼び出し側はマイクのみへフォールバック）", async () => {
  resetPythonDepsCache();
  const spawnOrdered: any = (py: string, args: string[], opts: any) => {
    const code = args[0] === "-c" ? 1 : 1; // チェック失敗・pip も失敗
    calls.push({ py, args, env: opts?.env });
    const child: any = new EventEmitter();
    child.stdin = { end: () => {} };
    queueMicrotask(() => child.emit("close", code));
    return child;
  };
  const calls: Array<{ py: string; args: string[] }> = [];
  const r = await ensurePythonDeps("C:/plugin", { spawn: spawnOrdered });
  assert.equal(r.ok, false);
});

test("ensurePythonDeps: Python が全く無ければ ok=false（長時間待機しない）", async () => {
  resetPythonDepsCache();
  const { spawn } = makeSpawnFake([{ match: () => true, code: "error" }]);
  const r = await ensurePythonDeps("", { spawn });
  assert.equal(r.ok, false);
});

test("buildLoopbackEnv: scriptDir の pylibs を PYTHONPATH 先頭に追加する", () => {
  const env = buildLoopbackEnv("C:/plugin");
  assert.ok((env.PYTHONPATH ?? "").startsWith("C:\\plugin\\pylibs"));
  assert.equal(env.PYTHONIOENCODING, "utf-8");
});
