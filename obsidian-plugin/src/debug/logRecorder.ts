import { appendFile, mkdir, stat, rename } from "fs/promises";
import { dirname, join } from "path";

/**
 * 構造化ログユーティリティ。
 *
 * 目的: プラグインの音声変換フローの挙動を永続化し、UAT 失敗時の原因追跡を
 *      容易にする。console.* にもミラー出力するため、開発者コンソールでも
 *      同じ内容を観察できる。
 *
 * ログファイル: <plugin folder>/logs/audio-conversion.log
 * ログローテーション: 1 MiB を超えたら audio-conversion.log.1 に rename
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const MAX_LOG_BYTES = 1024 * 1024; // 1 MiB

let logDir: string | null = null;
let logFilePath: string | null = null;
let queue: Promise<void> = Promise.resolve();

/** Obsidian の Plugin インスタンスから plugin フォルダパスを解決して初期化 */
export function initLogRecorder(pluginFolder: string): void {
  logDir = join(pluginFolder, "logs");
  logFilePath = join(logDir, "audio-conversion.log");
  // ディレクトリ作成は fire-and-forget（失敗しても main 処理は継続）
  mkdir(logDir, { recursive: true }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn(`[logRecorder] failed to create log dir: ${err?.message ?? err}`);
  });
  debug("logRecorder", "initialized", { logFile: logFilePath });
}

/** 内部用：キューに追記タスクを追加（順序保証） */
function enqueueWrite(line: string): void {
  queue = queue
    .then(async () => {
      if (!logFilePath) return;
      try {
        // サイズチェック → 必要ならローテート
        try {
          const st = await stat(logFilePath);
          if (st.size > MAX_LOG_BYTES) {
            await rename(logFilePath, `${logFilePath}.1`).catch(() => undefined);
          }
        } catch {
          // ファイルが無いなら新規作成
        }
        await appendFile(logFilePath, line, "utf-8");
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error(`[logRecorder] appendFile failed: ${err?.message ?? err}`);
      }
    })
    .catch(() => undefined);
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatLine(
  level: LogLevel,
  context: string,
  message: string,
  detail?: Record<string, unknown>
): string {
  const base = `[${formatTimestamp()}] [${level}] [${context}] ${message}`;
  if (!detail) return `${base}\n`;
  try {
    return `${base} ${JSON.stringify(detail)}\n`;
  } catch {
    return `${base} <detail-serialization-failed>\n`;
  }
}

function emit(
  level: LogLevel,
  context: string,
  message: string,
  detail?: Record<string, unknown>
): void {
  const line = formatLine(level, context, message, detail);
  // コンソールミラー
  switch (level) {
    case "DEBUG":
    case "INFO":
      // eslint-disable-next-line no-console
      console.log(line.trimEnd());
      break;
    case "WARN":
      // eslint-disable-next-line no-console
      console.warn(line.trimEnd());
      break;
    case "ERROR":
      // eslint-disable-next-line no-console
      console.error(line.trimEnd());
      break;
  }
  enqueueWrite(line);
}

export function debug(context: string, message: string, detail?: Record<string, unknown>): void {
  emit("DEBUG", context, message, detail);
}
export function info(context: string, message: string, detail?: Record<string, unknown>): void {
  emit("INFO", context, message, detail);
}
export function warn(context: string, message: string, detail?: Record<string, unknown>): void {
  emit("WARN", context, message, detail);
}
export function error(
  context: string,
  message: string,
  err?: unknown,
  detail?: Record<string, unknown>
): void {
  const errInfo =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { value: String(err) };
  emit("ERROR", context, message, { ...errInfo, ...detail });
}

/** テスト・アプリ終了時にフラッシュ（noop: 現在のキュー方式では enqueue 時点で同期書き込み開始） */
export async function flushLogs(): Promise<void> {
  await queue;
}