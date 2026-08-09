import { App } from "obsidian";

/**
 * 性能調査用デバッグロガー。
 * `<manifestDir>/logs/giji-YYYY-MM-DD.log` に 1 イベント 1 行で追記する。
 * 失敗しても本体処理を止めない（console.warn のみ）。
 */
export async function writeDebugLog(
  app: App | undefined,
  manifestDir: string,
  entry: string
): Promise<void> {
  if (!app || !manifestDir) return;
  try {
    const logsDir = `${manifestDir}/logs`;
    const adapter = app.vault.adapter as any;
    if (!(await adapter.exists(logsDir))) {
      await adapter.mkdir(logsDir);
    }
    const date = new Date().toISOString().slice(0, 10);
    const logFile = `${logsDir}/giji-${date}.log`;
    await adapter.append(logFile, entry + "\n");
  } catch (e) {
    console.warn("[giji] debug log write failed:", e);
  }
}
