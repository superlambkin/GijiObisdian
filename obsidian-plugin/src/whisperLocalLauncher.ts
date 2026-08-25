import { spawn } from "child_process";
import { join } from "path";
import { createWriteStream } from "fs";
import type { GijiSettings } from "./settings";

export interface EnsureOptions {
  fetchImpl?: typeof fetch;
  skipSpawn?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 500;

/** sttBaseUrl から host / port を抽出（パース不能時は既定 127.0.0.1:9000） */
function parseBaseUrl(baseUrl: string): { host: string; port: string } {
  try {
    const u = new URL(baseUrl);
    return { host: u.hostname, port: u.port || (u.protocol === "https:" ? "443" : "80") };
  } catch {
    return { host: "127.0.0.1", port: "9000" };
  }
}

/** ループバックアドレス判定（自動 spawn してよいのはローカルのみ） */
function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

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

  const { host, port } = parseBaseUrl(settings.sttBaseUrl);
  // リモート URL は自動起動しない（対象サーバが起動済みであること）
  if (!isLoopback(host)) {
    throw new Error(
      `ローカル Whisper サーバに接続できません（${settings.sttBaseUrl}）。リモート URL の場合は対象サーバが起動済みか確認してください`,
    );
  }

  // ② サーバを spawn して起動（skipSpawn=true はテスト用に spawn を回避）
  if (!skipSpawn) {
    const scriptPath = join(settings.sttServerDir, "start_whisper_local.bat");
    const env = {
      ...process.env,
      WHISPER_MODEL: `whisper-${settings.sttWhisperModel}`,
      WHISPER_HOST: host,
      WHISPER_PORT: port,
      WHISPER_DOWNLOAD_ROOT: settings.sttWhisperModelDir || undefined,
    };
    const logStream = createWriteStream(join(settings.sttServerDir, "whisper-local.log"), { flags: "a" });
    const child = spawn(scriptPath, [], {
      cwd: settings.sttServerDir,
      env,
      stdio: ["ignore", logStream, logStream],
      detached: true,
      shell: true,
      windowsHide: true,
    });
    child.on("error", (err) => {
      // spawn 失敗（bat 不在等）で未処理 error イベントによるクラッシュを防ぐ
      console.error(`[giji] whisper local spawn error: ${err.message}`);
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
    if (res.ok) return true;
    // 404/405 = HTTP サーバは応答しているが /health ルートが無い（OpenAI 互換リモート等）→ 到達可能とみなす
    if (res.status === 404 || res.status === 405) return true;
    return false;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
