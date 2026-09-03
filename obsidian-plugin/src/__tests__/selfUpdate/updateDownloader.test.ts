import test from "node:test";
import assert from "node:assert/strict";
import { downloadBinary, downloadAssets } from "../../selfUpdate/updateDownloader";

function makeAdapter() {
  const files = new Map<string, ArrayBuffer>();
  return {
    files,
    async writeBinary(p: string, d: ArrayBuffer) { files.set(p, d); },
  };
}

test("downloadBinary: fetch でバイナリ取得できる", async (t) => {
  const buf = new Uint8Array([1, 2, 3]).buffer;
  t.mock.method(globalThis, "fetch", async () =>
    ({ ok: true, status: 200, arrayBuffer: async () => buf }) as unknown as Response,
  );
  assert.equal(await downloadBinary("https://example.com/main.js"), buf);
});

test("downloadBinary: HTTP エラーは throw", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    ({ ok: false, status: 404 }) as unknown as Response,
  );
  await assert.rejects(() => downloadBinary("https://example.com/main.js"), /HTTP 404/);
});

test("downloadAssets: アセットを pluginDir へ書き込む・失敗時は名称付きエラー", async (t) => {
  const buf = new ArrayBuffer(4);
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request) => {
    if (String(_url).includes("bad")) return { ok: false, status: 500 } as unknown as Response;
    return { ok: true, status: 200, arrayBuffer: async () => buf } as unknown as Response;
  });
  const adapter = makeAdapter();
  await assert.rejects(
    () => downloadAssets(
      [{ name: "bad.js", browser_download_url: "https://example.com/bad" }],
      "plugin", adapter as any,
    ),
    /ダウンロード失敗: bad\.js/,
  );
  await downloadAssets(
    [{ name: "main.js", browser_download_url: "https://example.com/main.js" }],
    "plugin", adapter as any,
  );
  assert.ok(adapter.files.has("plugin/main.js"));
});
