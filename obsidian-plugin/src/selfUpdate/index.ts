// 更新フロー全体: チェック -> バックアップ -> DL -> リロード。
// UI からはこの関数だけを呼ぶ。
import { Notice } from "obsidian";
import type { App, DataAdapter } from "obsidian";
import { checkForUpdate } from "./updateChecker";
import { backupPluginFiles } from "./backupManager";
import { downloadAssets } from "./updateDownloader";
import { reloadPlugin } from "./reloader";

/** テストから差し替え可能な依存（ESM/CJS 相互運用でも安定してモックできる） */
export const deps = { checkForUpdate, backupPluginFiles, downloadAssets, reloadPlugin };

export async function runSelfUpdate(
  app: App,
  pluginId: string,
  localVersion: string,
  pluginDir: string,
  adapter: DataAdapter,
  notice: (msg: string) => void = (m) => new Notice(m),
): Promise<void> {
  const fail = (prefix: string, e: unknown): void => {
    notice(`❌ ${prefix}: ${(e as Error).message}`);
  };
  try {
    notice("🔄 更新を確認中...");
    const result = await deps.checkForUpdate(localVersion);
    if (!result.updateAvailable) {
      notice(`✅ 最新版です (${result.tagName || `v${localVersion}`})`);
      return;
    }
    let backupPath: string;
    try {
      backupPath = await deps.backupPluginFiles(pluginDir, adapter);
    } catch (e) {
      return fail("バックアップ失敗", e);
    }
    try {
      await deps.downloadAssets(result.assets, pluginDir, adapter);
    } catch (e) {
      return fail(`${backupPath} から復元可 — ダウンロード失敗`, e);
    }
    try {
      await deps.reloadPlugin(app, pluginId);
      notice(`✅ ${result.tagName} に更新しました`);
    } catch (e) {
      return fail("再読込失敗", e);
    }
  } catch (e) {
    return fail("更新確認失敗", e);
  }
}
