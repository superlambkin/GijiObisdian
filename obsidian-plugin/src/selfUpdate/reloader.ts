// プラグインを disable -> enable で再読込する。
import type { App } from "obsidian";

export async function reloadPlugin(app: App, pluginId: string): Promise<void> {
  const plugins = (app as unknown as {
    plugins?: {
      enablePlugin?: (id: string) => Promise<void>;
      disablePlugin?: (id: string) => Promise<void>;
    };
  }).plugins;
  await plugins?.disablePlugin?.(pluginId);
  await plugins?.enablePlugin?.(pluginId);
}
