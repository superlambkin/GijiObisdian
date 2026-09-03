import test from "node:test";
import assert from "node:assert/strict";
import { stripVPrefix, compareSemver, checkForUpdate } from "../../selfUpdate/updateChecker";

test("stripVPrefix: v プレフィックスを除去する", () => {
  assert.equal(stripVPrefix("v0.14.0"), "0.14.0");
  assert.equal(stripVPrefix("0.14.0"), "0.14.0");
});

test("compareSemver: 大小比較と同等判定", () => {
  assert.ok(compareSemver("0.14.0", "0.13.2") > 0);
  assert.ok(compareSemver("0.13.2", "0.14.0") < 0);
  assert.equal(compareSemver("0.13.2", "0.13.2"), 0);
  assert.ok(compareSemver("1.0.0", "0.99.99") > 0);
});

test("checkForUpdate: 更新あり（リモートが新しい）", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v0.14.0",
        assets: [{ name: "main.js", browser_download_url: "https://example.com/main.js" }],
      }),
    }) as unknown as Response,
  );
  const r = await checkForUpdate("0.13.2");
  assert.equal(r.updateAvailable, true);
  assert.equal(r.tagName, "v0.14.0");
  assert.equal(r.assets[0].name, "main.js");
});

test("checkForUpdate: 同一バージョンなら更新なし・不完全 asset は除外", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v0.13.2",
        assets: [{ name: "main.js" }, { browser_download_url: "https://x" }],
      }),
    }) as unknown as Response,
  );
  const r = await checkForUpdate("0.13.2");
  assert.equal(r.updateAvailable, false);
  assert.equal(r.assets.length, 0);
});

test("checkForUpdate: 404 は明示的エラー", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response,
  );
  await assert.rejects(() => checkForUpdate("0.13.2"), /404/);
});

test("checkForUpdate: 403（レート制限）は明示的エラー", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    ({ ok: false, status: 403, json: async () => ({}) }) as unknown as Response,
  );
  await assert.rejects(() => checkForUpdate("0.13.2"), /レート制限/);
});
