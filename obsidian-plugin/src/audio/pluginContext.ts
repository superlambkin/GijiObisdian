import type { App } from "obsidian";

/**
 * プラグインランタイム情報を保持するシングルトン。
 *
 * Obsidian の Plugin.onload() で `setPluginContext()` を呼び、
 * 音声変換モジュール（ffmpegConvert.ts 等）から参照する。
 *
 * 音声変換では App の adapter 経由でプラグインアセットを読み込み、
 * Worker 起動用の Blob URL / app:// URL を生成するために App 参照が必要。
 */
let appRef: App | null = null;
let pluginFolderAbs: string | null = null;

export function setPluginContext(app: App, pluginFolderAbsPath: string): void {
  appRef = app;
  pluginFolderAbs = pluginFolderAbsPath;
}

export function getPluginApp(): App | null {
  return appRef;
}

export function getPluginFolderAbs(): string | null {
  return pluginFolderAbs;
}