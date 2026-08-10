import { GijiSettings } from "../settings";
import { getPreset } from "./llmPresets";
import type { LlmPresetConfig } from "./llmPresets";
import { createNodeFetch } from "./nodeFetch";

/** LLM 呼び出しの計測結果（complete() の stats 引数に書き戻す） */
export interface LlmCallStats {
  /** 最初の SSE チャンク到達までの時間 ms（ストリーミング応答時のみ） */
  ttfbMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** リトライした回数（0 = 初回成功） */
  retries: number;
}

/** LLM 生成の進捗コールバック（SSE ストリーミング時に発火） */
export interface LlmProgress {
  /** 最初のチャンク到達時（TTFB）に1回だけ呼ばれる */
  onFirstChunk?: () => void;
  /** テキスト受信ごとに累積文字数で呼ばれる */
  onChunk?: (receivedChars: number) => void;
}

export interface LlmProvider {
  id: string;
  complete(system: string, user: string, stats?: LlmCallStats, progress?: LlmProgress): Promise<string>;
}

/** リトライ対象の HTTP エラー（408/409/429/5xx） */
class RetryableHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "RetryableHttpError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableError(e: any): boolean {
  if (e?.name === "AbortError") return true; // タイムアウトによる中断
  if (e instanceof RetryableHttpError) return true; // 429/5xx 等
  if (e instanceof TypeError) return true; // ネットワーク断（fetch failed 等）
  return false;
}

/**
 * 指数バックオフ＋ジッター付きリトライ。
 * 最終失敗時は投げる Error に retriesAttempted を付与する。
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { maxRetries: number; sleep?: (ms: number) => Promise<void> }
): Promise<{ value: T; retries: number }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: any;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return { value: await fn(attempt), retries: attempt };
    } catch (e: any) {
      lastErr = e;
      if (!isRetryableError(e) || attempt >= opts.maxRetries) {
        e.retriesAttempted = attempt;
        throw e;
      }
      const backoff = Math.min(8000, 1000 * 2 ** attempt) * (0.5 + Math.random() * 0.5);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

/** 試行ごとのタイムアウト（AbortController） */
function withTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

interface ExtractedEvent {
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
}

interface CompleteOutcome {
  text: string;
  ttfbMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** SSE ストリームを読み、テキスト差分と usage を集計。ttfbMs は最初のチャンク到達時点。 */
async function consumeSse(
  res: Response,
  startedMs: number,
  handle: (json: any) => ExtractedEvent,
  progress?: LlmProgress
): Promise<CompleteOutcome> {
  const reader = (res.body as any).getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let ttfbMs: number | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let lastNotified = -1;
  const notifyProgress = () => {
    if (progress?.onChunk && text.length !== lastNotified) {
      lastNotified = text.length;
      progress.onChunk(text.length);
    }
  };

  const handleLine = (line: string) => {
    // （既存のまま変更なし）
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const out = handle(JSON.parse(payload));
      if (out.text) text += out.text;
      if (out.inputTokens !== undefined) inputTokens = out.inputTokens;
      if (out.outputTokens !== undefined) outputTokens = out.outputTokens;
    } catch {
      /* 分割された JSON 行などは読み捨て */
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      handleLine(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
    // NEW 修正（バックグラウンドレビュー）: text delta が届いた最初の時点で TTFB を記録。
    // keepalive/usage-only 等の空チャンクで過早に onFirstChunk を発火させない。
    // onFirstChunk は「初回 text delta 到着」のシグナルなので notifyProgress より先に呼ぶ。
    if (ttfbMs === undefined && text.length > 0) {
      ttfbMs = Date.now() - startedMs;
      progress?.onFirstChunk?.();
    }
    notifyProgress();
  }
  if (buf.trim()) handleLine(buf);
  notifyProgress();
  return { text, ttfbMs, inputTokens, outputTokens };
}

/** 共通の 1 試行：POST → SSE 優先で読み、非 SSE は JSON フォールバック */
async function postOnce(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  handleSse: (json: any) => ExtractedEvent,
  handleFull: (data: any) => CompleteOutcome,
  progress?: LlmProgress
): Promise<CompleteOutcome> {
  const startedMs = Date.now();
  const { signal, clear } = withTimeout(timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    } as any);
    if (!res.ok) {
      const msg = `LLM ${res.status}: ${await res.text()}`;
      if (isRetryableStatus(res.status)) throw new RetryableHttpError(res.status, msg);
      throw new Error(msg);
    }
    const contentType = (res.headers as any)?.get?.("content-type") ?? "";
    if ((res as any).body && String(contentType).includes("text/event-stream")) {
      return await consumeSse(res as any, startedMs, handleSse, progress);
    }
    // 非ストリーミング応答（モック / SSE 非対応プロキシ）フォールバック
    const out = handleFull(await res.json());
    if (out.text) {
      progress?.onFirstChunk?.();
      progress?.onChunk?.(out.text.length);
    }
    return out;
  } finally {
    clear();
  }
}

interface CallOptions {
  timeoutMs: number;
  maxRetries: number;
}

class OpenAiCompatibleLlm implements LlmProvider {
  constructor(
    public id: string,
    private baseUrl: string,
    private model: string,
    private apiKey: string,
    private fetchImpl: typeof fetch,
    private includeUsage: boolean,
    private callOpts: CallOptions
  ) {}

  async complete(system: string, user: string, stats?: LlmCallStats, progress?: LlmProgress): Promise<string> {
    // 空の system メッセージを 400 で拒否するエンドポイント（Kimi for Coding 等）があるため、
    // system が空なら messages に含めない
    const messages: Array<{ role: string; content: string }> = [];
    if (system.trim()) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: user });
    const body: any = {
      model: this.model,
      messages,
      stream: true,
    };
    if (this.includeUsage) body.stream_options = { include_usage: true };
    try {
      const { value, retries } = await withRetry(
        () =>
          postOnce(
            this.fetchImpl,
            `${this.baseUrl.replace(/\/$/, "")}/chat/completions`,
            {
              "Content-Type": "application/json",
              ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body,
            this.callOpts.timeoutMs,
            (j) => ({
              text: j?.choices?.[0]?.delta?.content ?? "",
              inputTokens: j?.usage?.prompt_tokens,
              outputTokens: j?.usage?.completion_tokens,
            }),
            (data) => ({
              text: data?.choices?.[0]?.message?.content ?? "",
              inputTokens: data?.usage?.prompt_tokens,
              outputTokens: data?.usage?.completion_tokens,
            }),
            progress
          ),
        { maxRetries: this.callOpts.maxRetries }
      );
      if (stats) {
        stats.ttfbMs = value.ttfbMs;
        stats.inputTokens = value.inputTokens;
        stats.outputTokens = value.outputTokens;
        stats.retries = retries;
      }
      return value.text;
    } catch (e: any) {
      if (stats) stats.retries = e?.retriesAttempted ?? 0;
      throw e;
    }
  }
}

class AnthropicLlm implements LlmProvider {
  constructor(
    public id: string,
    private baseUrl: string,
    private model: string,
    private apiKey: string,
    private apiVersion: string,
    private maxTokens: number,
    private fetchImpl: typeof fetch,
    private callOpts: CallOptions,
    private thinkingEnabled: boolean = true
  ) {}

  async complete(system: string, user: string, stats?: LlmCallStats, progress?: LlmProgress): Promise<string> {
    const body: any = {
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      stream: true,
    };
    // DeepSeek 等の thinking モデル: thinking を無効化するには
    // Anthropic 互換の thinking:{type:"disabled"} を送る（curl で実証済み）。
    // 有効時はパラメータなし（モデル既定 = 思考あり）を維持する。
    if (!this.thinkingEnabled) {
      body.thinking = { type: "disabled" };
    }
    try {
      const { value, retries } = await withRetry(
        () =>
          postOnce(
            this.fetchImpl,
            `${this.baseUrl.replace(/\/$/, "")}/v1/messages`,
            {
              "Content-Type": "application/json",
              "x-api-key": this.apiKey,
              "anthropic-version": this.apiVersion,
            },
            body,
            this.callOpts.timeoutMs,
            (j) => ({
              text: j?.type === "content_block_delta" ? j?.delta?.text ?? "" : "",
              inputTokens: j?.type === "message_start" ? j?.message?.usage?.input_tokens : undefined,
              outputTokens: j?.type === "message_delta" ? j?.usage?.output_tokens : undefined,
            }),
            (data) => ({
              text: (Array.isArray(data?.content) ? data.content : [])
                .map((b: any) => b?.text ?? "")
                .join(""),
              inputTokens: data?.usage?.input_tokens,
              outputTokens: data?.usage?.output_tokens,
            }),
            progress
          ),
        { maxRetries: this.callOpts.maxRetries }
      );
      if (stats) {
        stats.ttfbMs = value.ttfbMs;
        stats.inputTokens = value.inputTokens;
        stats.outputTokens = value.outputTokens;
        stats.retries = retries;
      }
      return value.text;
    } catch (e: any) {
      if (stats) stats.retries = e?.retriesAttempted ?? 0;
      throw e;
    }
  }
}

function positiveInt(v: unknown, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonNegativeInt(v: unknown, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * LLM 1 試行あたりのタイムアウトを解決する。
 * - preset に defaultTimeoutMs が**無い**場合: ユーザー設定をそのまま尊重する
 *   （90000 より短く設定しても有効）。
 * - preset に defaultTimeoutMs が**ある**場合: その値を最低保証として max() で採用する。
 *   thinking モデル（deepseek-v4-flash 等）は思考中に SSE チャンクを送らず、
 *   90000ms タイムアウトと競合して失敗するため、長めの値を最低保証とする。
 *   ユーザーがさらに長く設定していれば尊重する。
 */
export function resolveLlmTimeoutMs(settings: GijiSettings, preset: LlmPresetConfig): number {
  const user = positiveInt(settings.llmTimeoutMs, 90000);
  if (preset.defaultTimeoutMs === undefined) return user;
  return Math.max(user, preset.defaultTimeoutMs);
}

/**
 * 既定の fetch 実装を解決する。
 * - Obsidian デスクトップ（nodeIntegration あり）: Node http/https 直接接続。
 *   レンダラーの fetch は CORS で api.kimi.com 等に到達できず、Electron net.fetch は
 *   システムプロキシの影響を受けるため（UAT 2026-08-10 で実証）、curl 同等の
 *   Node スタックを既定とする。SSE ストリーミング対応。
 * - モバイル / テスト環境: globalThis.fetch にフォールバック。
 * - transportName タグ: 実機でどの経路を使ったか診断するための識別子。
 */
export function getDefaultFetch(): typeof fetch {
  const nodeFetch = createNodeFetch();
  if (nodeFetch) {
    (nodeFetch as any).transportName = "node-direct";
    return nodeFetch as unknown as typeof fetch;
  }
  const f = fetch.bind(globalThis) as any;
  f.transportName = "window-fetch";
  return f as typeof fetch;
}

export function createLlmProvider(
  settings: GijiSettings,
  fetchImpl: typeof fetch = getDefaultFetch()
): LlmProvider {
  if (settings.llmProvider === "claudian") {
    // Claudian 連携は complete() ではなく importAudio フロー側で
    // 「要約プロンプトを Claudian 入力欄に挿入」する方式のため、ここでは生成できない
    throw new Error("claudian プロバイダーは createLlmProvider ではなく Claudian 連携フローで処理されます");
  }
  const preset = getPreset(settings.llmProvider);
  if (!preset) {
    throw new Error(`未知の llmProvider: ${settings.llmProvider}`);
  }
  const callOpts: CallOptions = {
    timeoutMs: resolveLlmTimeoutMs(settings, preset),
    maxRetries: nonNegativeInt(settings.llmMaxRetries, 2),
  };
  // ユーザーが空欄にした場合、preset の既定値にフォールバック
  const baseUrl = settings.llmBaseUrl.trim() || preset.baseUrl;
  const model = settings.llmModel.trim() || preset.model;
  // API 形式:
  //   - 上書きフラグ ON → 手動設定
  //   - 既存ユーザの後方互換 (cloud プリセットのみ): settings.llmApiFormat が preset 既定と一致しない
  //     → 手動設定を尊重（既存ユーザの llmProvider="cloud" + llmApiFormat="anthropic" を救う）
  //   - ollama: 強制 OpenAI 形式（既存挙動維持、stream_options 非対応のため）
  //   - それ以外 → preset 既定
  const apiFormat =
    preset.id === "ollama"
      ? "openai"
      : settings.llmApiFormatOverride ||
          (preset.id === "cloud" && settings.llmApiFormat !== preset.apiFormat)
        ? settings.llmApiFormat
        : preset.apiFormat;
  if (apiFormat === "anthropic") {
    // settings.llmMaxTokens が 0/undefined/NaN なら preset 既定値、それ以外はユーザー設定をそのまま尊重
    const effectiveMaxTokens = positiveInt(settings.llmMaxTokens, preset.defaultMaxTokens);
    return new AnthropicLlm(
      preset.id,
      baseUrl,
      model,
      settings.llmApiKey,
      settings.anthropicVersion || preset.anthropicVersion || "2023-06-01",
      effectiveMaxTokens,
      fetchImpl,
      callOpts,
      settings.llmThinkingEnabled !== false
    );
  }
  // Ollama は stream_options 非対応のため includeUsage=false（既存挙動維持）
  const includeUsage = preset.id !== "ollama";
  return new OpenAiCompatibleLlm(preset.id, baseUrl, model, settings.llmApiKey, fetchImpl, includeUsage, callOpts);
}
