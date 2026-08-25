import { spawn } from "child_process";
import { join } from "path";
import type { GijiSettings } from "./settings";

export interface EnsureOptions {
  fetchImpl?: typeof fetch;
  skipSpawn?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 500;

/**
 * ローカル Whisper サーバの起動を保証する。
 * - skipSpawn=true: spawn せずヘルスチェックのみ（テスト用）
 * - 通常: health チェック → 失敗時 spawn → 再度 health チェック
 */
export async function ensureWhisperLocalServer(
  settings: GijiSettings,
  opts: EnsureOptions = {},
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const skipSpawn = opts.skipSpawn ?? false;

  // ① 既に起動中ならスキップ
  if (await healthCheck(settings.sttBaseUrl, fetchImpl)) return;

  // ② サーバを spawn して起動（skipSpawn=true はテスト用に spawn を回避）
  if (!skipSpawn) {
    const scriptPath = join(settings.sttServerDir, "start_whisper_local.bat");
    const env = {
      ...process.env,
      WHISPER_MODEL: `whisper-${settings.sttWhisperModel}`,
      WHISPER_HOST: "127.0.0.1",
      WHISPER_PORT: "9000",
      WHISPER_DOWNLOAD_ROOT: settings.sttWhisperModelDir || undefined,
    };

    const child = spawn(scriptPath, [], {
      cwd: settings.sttServerDir,
      env,
      stdio: "ignore",
      detached: true,
      shell: true,
      windowsHide: true,
    });
    child.unref();
  }

  // ③ ヘルスチェックで起動完了を待つ
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await healthCheck(settings.sttBaseUrl, fetchImpl)) return;
    await sleep(HEALTH_CHECK_INTERVAL_MS);
  }
  throw new Error(
    `Whisper サーバの起動がタイムアウトしました（${timeoutMs / 1000}秒）。Python 環境・ポート競合を確認してください`,
  );
}

/**
 * ローカル Whisper サーバが起動中か（ヘルスチェックのみ・spawn しない）。
 * 録音ボタンの状態表示（refreshSttDownState）用。
 */
export async function isWhisperLocalUp(
  settings: GijiSettings,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<boolean> {
  return healthCheck(settings.sttBaseUrl, fetchImpl);
}

async function healthCheck(baseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const url = `${baseUrl.replace(/\/v1\/?$/, "")}/health`;
    const res = await fetchImpl(url, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
