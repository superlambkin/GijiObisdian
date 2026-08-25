/**
 * Node http/https ベースの fetch 互換実装（Obsidian デスクトップ用）。
 *
 * なぜ必要か（UAT 2026-08-10 で実証）:
 * - レンダラー（Chromium）の fetch は CORS を強制され、api.kimi.com のような
 *   CORS 非対応エンドポイントに到達できない（preflight 404 + ACAO なし）
 * - Electron net.fetch も Chromium net stack 経由のためシステムプロキシの影響を受け、
 *   curl が成功するのに TypeError: Failed to fetch になる事案が発生
 * - Node http/https は curl と同等の直接接続（CORS なし・プロキシ非経由）で、
 *   失敗時も ENOTFOUND / ECONNREFUSED 等の code 付きで診断できる
 *
 * 対応範囲: POST/GET + 文字列 / FormData（multipart）/ ArrayBuffer body +
 * SSE ストリーミング（body.getReader()）+ text()/json()（非 SSE 用）+ AbortSignal。
 * リダイレクト・gzip は未対応（Accept-Encoding を送らないのでサーバーは圧縮してこない）。
 *
 * FormData 対応（2026-08-26）:
 * - STT（whisper-local / mywhisper / groq / openai）は multipart で音声を送る。
 * - レンダラー fetch は CORS 非対応のローカル/リモート STT サーバに届かないため、
 *   Node 直結の http/https で multipart を組み立てて送信する。
 */

interface MinimalResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<any>;
}

/**
 * Node http/https を使う fetch 互換関数を生成する。
 * reqFn には require 相当（デフォルト: globalThis.require = Obsidian デスクトップの
 * nodeIntegration で供給される）。使えない環境では undefined を返す。
 */
export function createNodeFetch(
  reqFn?: (name: string) => any
): ((url: any, init?: any) => Promise<MinimalResponse>) | undefined {
  const req = reqFn ?? (globalThis as any).require;
  if (typeof req !== "function") return undefined;
  let http: any;
  let https: any;
  let Readable: any;
  try {
    http = req("node:http");
    https = req("node:https");
    Readable = req("node:stream").Readable;
  } catch {
    return undefined;
  }
  if (!http?.request || !https?.request || !Readable?.toWeb) return undefined;

  return (url: any, init: any = {}): Promise<MinimalResponse> =>
    new Promise((resolve, reject) => {
      (async () => {
        let u: URL;
        try {
          u = new URL(String(url));
        } catch (e) {
          reject(e);
          return;
        }
        const mod = u.protocol === "http:" ? http : https;
        const headers: Record<string, string> = { ...(init.headers || {}) };
        let bodyBuffer: Buffer | undefined;
        const body = init.body;
        if (body != null) {
          if (typeof body === "string") {
            bodyBuffer = Buffer.from(body, "utf-8");
          } else if (typeof FormData !== "undefined" && body instanceof FormData) {
            // multipart を手組み（レンダラー fetch の FormData は CORS 非対応サーバに届かない）
            const { buffer, contentType } = await formDataToMultipart(body);
            bodyBuffer = buffer;
            headers["Content-Type"] = contentType;
          } else if (body instanceof ArrayBuffer) {
            bodyBuffer = Buffer.from(new Uint8Array(body));
          } else if (ArrayBuffer.isView(body)) {
            bodyBuffer = Buffer.from(
              new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
            );
          } else {
            bodyBuffer = Buffer.from(String(body), "utf-8");
          }
          if (
            !Object.keys(headers).some((k) => k.toLowerCase() === "content-length")
          ) {
            headers["Content-Length"] = String(bodyBuffer.length);
          }
        }
        const nodeReq = mod.request(
          {
            method: init.method || "GET",
            hostname: u.hostname,
            port: u.port || (u.protocol === "http:" ? 80 : 443),
            path: u.pathname + u.search,
            headers,
            signal: init.signal, // Node 15.5+ : abort で request.destroy される
          },
          (res: any) => {
          // body（SSE）と text()/json()（非 SSE）の両方が同一の web ストリームを
          // 共有するよう遅延生成にする（postOnce は両パスで res.body に触れるため）
          let webBody: ReadableStream<Uint8Array> | undefined;
          const getBody = (): ReadableStream<Uint8Array> => {
            if (!webBody) webBody = Readable.toWeb(res) as ReadableStream<Uint8Array>;
            return webBody;
          };
          const readAll = async (): Promise<string> => {
            const reader = getBody().getReader();
            const dec = new TextDecoder();
            let out = "";
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              out += dec.decode(value, { stream: true });
            }
            out += dec.decode();
            return out;
          };
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: {
              get: (name: string) => (res.headers[name.toLowerCase()] as string) ?? null,
            },
            get body() {
              return getBody();
            },
            text: readAll,
            json: async () => JSON.parse(await readAll()),
          });
        }
      );
        nodeReq.on("error", reject);
        if (bodyBuffer) nodeReq.write(bodyBuffer);
        nodeReq.end();
      })();
    });
}

/**
 * FormData を multipart/form-data の Buffer に変換する。
 * - 文字列エントリ: プレーンな form-data パート
 * - Blob/File エントリ: filename + Content-Type 付きパート
 */
async function formDataToMultipart(
  form: FormData,
): Promise<{ buffer: Buffer; contentType: string }> {
  const boundary = "----gijibridge" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [key, value] of (form as any).entries()) {
    if (typeof value === "string") {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
          "utf-8",
        ),
      );
    } else {
      const blob = value as any;
      const filename =
        typeof blob?.name === "string" && blob.name ? blob.name : "file";
      const contentType =
        typeof blob?.type === "string" && blob.type
          ? blob.type
          : "application/octet-stream";
      const bytes = new Uint8Array(await blob.arrayBuffer());
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
          "utf-8",
        ),
      );
      parts.push(Buffer.from(bytes));
      parts.push(Buffer.from("\r\n", "utf-8"));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf-8"));
  return {
    buffer: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * 既定の fetch 実装:
 * - Obsidian デスクトップ（nodeIntegration あり）: Node http/https 直接接続。
 *   レンダラーの fetch は CORS を強制され CORS 非対応エンドポイントに到達できないため、
 *   curl と同等の Node スタックを優先する。
 * - モバイル / テスト環境: globalThis.fetch にフォールバック。
 */
export const nodeFetch: typeof fetch = (() => {
  const fn = createNodeFetch();
  if (fn) return fn as unknown as typeof fetch;
  return fetch.bind(globalThis);
})();
