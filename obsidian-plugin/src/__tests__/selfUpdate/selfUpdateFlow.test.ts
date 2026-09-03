import test from "node:test";
import assert from "node:assert/strict";
import { runSelfUpdate, deps } from "../../selfUpdate/index";

const ADAPTER = {} as any;
const APP = {} as any;

/** deps の依存を差し替え、呼び出し順を記録する */
function installMocks(
  t: any,
  opts: { updateAvailable: boolean; failAt?: "backup" | "download" | "reload" | "check" },
  calls: string[],
): void {
  t.mock.method(deps, "checkForUpdate", async () => {
    calls.push("check");
    if (opts.failAt === "check") throw new Error("api down");
    return {
      updateAvailable: opts.updateAvailable,
      tagName: "v0.14.0",
      assets: [{ name: "main.js", browser_download_url: "https://x/main.js" }],
    };
  });
  t.mock.method(deps, "backupPluginFiles", async () => {
    if (opts.failAt === "backup") throw new Error("backup boom");
    calls.push("backup");
    return "plugin/.backup/x";
  });
  t.mock.method(deps, "downloadAssets", async () => {
    if (opts.failAt === "download") throw new Error("dl boom");
    calls.push("download");
  });
  t.mock.method(deps, "reloadPlugin", async () => {
    if (opts.failAt === "reload") throw new Error("reload boom");
    calls.push("reload");
  });
}

test("runSelfUpdate: 更新あり → check→backup→download→reload の順で実行", async (t) => {
  const calls: string[] = [];
  installMocks(t, { updateAvailable: true }, calls);
  const notices: string[] = [];
  await runSelfUpdate(APP, "GijiObsidian", "0.13.2", "plugin", ADAPTER, (m) => notices.push(m));
  assert.deepEqual(calls, ["check", "backup", "download", "reload"]);
  assert.ok(notices.some((m) => m.includes("v0.14.0") && m.includes("更新しました")));
});

test("runSelfUpdate: 最新版なら何もしない", async (t) => {
  const calls: string[] = [];
  installMocks(t, { updateAvailable: false }, calls);
  const notices: string[] = [];
  await runSelfUpdate(APP, "GijiObsidian", "0.14.0", "plugin", ADAPTER, (m) => notices.push(m));
  assert.deepEqual(calls, ["check"]);
  assert.ok(notices.some((m) => m.includes("最新版")));
});

test("runSelfUpdate: チェック失敗でエラー Notice", async (t) => {
  const calls: string[] = [];
  installMocks(t, { updateAvailable: true, failAt: "check" }, calls);
  const notices: string[] = [];
  await runSelfUpdate(APP, "GijiObsidian", "0.13.2", "plugin", ADAPTER, (m) => notices.push(m));
  assert.deepEqual(calls, ["check"]);
  assert.ok(notices.some((m) => m.includes("api down")));
});

test("runSelfUpdate: DL 失敗時はバックアップ先を案内", async (t) => {
  const calls: string[] = [];
  installMocks(t, { updateAvailable: true, failAt: "download" }, calls);
  const notices: string[] = [];
  await runSelfUpdate(APP, "GijiObsidian", "0.13.2", "plugin", ADAPTER, (m) => notices.push(m));
  assert.ok(notices.some((m) => m.includes("plugin/.backup/x") && m.includes("dl boom")));
});
