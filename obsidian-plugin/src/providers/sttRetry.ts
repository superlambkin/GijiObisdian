import { GijiSettings, clampSttConcurrency } from "../settings";
import { createSttProvider } from "./stt";

export interface TranscribeChunkResult {
  index: number;
  success: boolean;
  text?: string;
  error?: string;
}

export interface TranscribeFileResult {
  success: boolean;
  results: string[];
  failedChunks: TranscribeChunkResult[];
}

export interface TranscribeRetryDeps {
  transcribe?: (buf: ArrayBuffer, settings: GijiSettings) => Promise<string>;
  /** テスト・呼び出し側が429再試行待機を制御するための拡張点 */
  retryDelayMs?: number;
}

/**
 * 音声チャンクを並列送信し、HTTP 429時は1回だけ再試行する。
 * 返却される results はチャンク番号順に並んだ成功結果。
 */
export async function transcribeWithRetry(
  chunks: ArrayBuffer[],
  settings: GijiSettings,
  maxConcurrency: number,
  deps: TranscribeRetryDeps = {}
): Promise<TranscribeFileResult> {
  const transcribe = deps.transcribe ?? (async (buf: ArrayBuffer, s: GijiSettings) => {
    const stt = createSttProvider(s, fetch.bind(globalThis));
    return stt.transcribe(buf, s.sttLang);
  });
  const concurrency = clampSttConcurrency(maxConcurrency);
  const results: Array<TranscribeChunkResult | undefined> = new Array(chunks.length);

  const workers = Array.from({ length: concurrency }, async (_, workerId) => {
    for (let index = workerId; index < chunks.length; index += concurrency) {
      results[index] = await processChunkWithRetry(
        chunks[index],
        index,
        settings,
        transcribe,
        deps.retryDelayMs ?? 1000
      );
    }
  });
  await Promise.all(workers);

  const completed = results.filter((result): result is TranscribeChunkResult => Boolean(result));
  const failedChunks = completed.filter((result) => !result.success);
  return {
    success: failedChunks.length === 0,
    results: completed.filter((result) => result.success).map((result) => result.text ?? ""),
    failedChunks,
  };
}

async function processChunkWithRetry(
  chunk: ArrayBuffer,
  index: number,
  settings: GijiSettings,
  transcribe: (buf: ArrayBuffer, settings: GijiSettings) => Promise<string>,
  retryDelayMs: number
): Promise<TranscribeChunkResult> {
  let lastError = "STT request failed";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { index, success: true, text: await transcribe(chunk, settings) };
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      if (extractStatus(err) !== 429 || attempt === 1) {
        return { index, success: false, error: lastError };
      }
      await sleep(retryDelayMs);
    }
  }
  return { index, success: false, error: lastError };
}

function extractStatus(err: any): number | undefined {
  if (typeof err?.status === "number") return err.status;
  const match = String(err?.message ?? "").match(/\b(429|500|401|400)\b/);
  return match ? Number(match[1]) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
