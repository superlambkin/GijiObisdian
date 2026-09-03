// CORS を回避する HTTP GET ヘルパー。
// Obsidian では requestUrl（メインプロセス経由）、テスト等では fetch にフォールバック。

export interface HttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

type RequestUrlLike = (opts: {
  url: string;
  method: string;
  headers: Record<string, string>;
}) => Promise<{ status: number; json?: unknown; text?: string; arrayBuffer?: ArrayBuffer }>;

function resolveObsidianRequestUrl(): RequestUrlLike | null {
  try {
    const obs = require("obsidian") as { requestUrl?: RequestUrlLike };
    if (typeof obs.requestUrl === "function") return obs.requestUrl;
  } catch {
    /* obsidian 未解決環境（テスト等）は無視 */
  }
  return null;
}

let cached: RequestUrlLike | null | undefined;
function getRequestUrl(): RequestUrlLike | null {
  if (cached === undefined) cached = resolveObsidianRequestUrl();
  return cached;
}

export async function httpGet(url: string, headers: Record<string, string>): Promise<HttpResponse> {
  const ru = getRequestUrl();
  if (ru) {
    const res = await ru({ url, method: "GET", headers });
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      async json() {
        if (res.json !== undefined) return res.json;
        return JSON.parse(res.text ?? "");
      },
    };
  }
  const res = await fetch(url, { headers });
  return { status: res.status, ok: res.ok, json: () => res.json() };
}
