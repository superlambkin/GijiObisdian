// GitHub Release アセットをダウンロードし Vault プラグインフォルダへ上書きする。
import type { DataAdapter } from "obsidian";
import type { ReleaseAsset } from "./types";

/** バイナリ 1 件をダウンロード（Obsidian requestUrl / fetch フォールバック） */
export async function downloadBinary(url: string): Promise<ArrayBuffer> {
  try {
    const obs = require("obsidian") as { requestUrl?: (o: { url: string; method: string }) => Promise<{ status: number; arrayBuffer?: ArrayBuffer }> };
    if (typeof obs.requestUrl === "function") {
      const res = await obs.requestUrl({ url, method: "GET" });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${url}`);
      return res.arrayBuffer ?? new ArrayBuffer(0);
    }
  } catch (e) {
    if (e instanceof Error && /HTTP \d+/.test(e.message)) throw e;
    /* obsidian 未解決環境は fetch へフォールバック */
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.arrayBuffer();
}

/** アセットを順次ダウンロードして pluginDir へ上書き（1 件でも失敗すれば throw） */
export async function downloadAssets(
  assets: ReleaseAsset[],
  pluginDir: string,
  adapter: DataAdapter,
): Promise<void> {
  for (const asset of assets) {
    try {
      const data = await downloadBinary(asset.browser_download_url);
      await adapter.writeBinary(`${pluginDir}/${asset.name}`, data);
    } catch (e) {
      throw new Error(`ダウンロード失敗: ${asset.name} — ${(e as Error).message}`);
    }
  }
}
