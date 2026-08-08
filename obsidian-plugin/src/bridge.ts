export async function bridgeHealth(baseUrl: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export interface BridgeStartOptions {
  /** 録音ファイルの保存場所（PC 絶対パス）。省略時はブリッジの temp 保存 */
  outDir?: string;
  /** 録音ファイル名（拡張子 .wav はブリッジ側で付与）。省略時は giji_<sessionId> */
  fileName?: string;
}

export async function bridgeStart(
  baseUrl: string,
  opts: BridgeStartOptions = {},
  fetchImpl: typeof fetch = fetch.bind(globalThis)
): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/record/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "wav", outDir: opts.outDir, fileName: opts.fileName }),
  });
  if (!res.ok) throw new Error(`bridge start ${res.status}`);
  const data = await res.json();
  return data.sessionId;
}

export async function bridgeStop(
  baseUrl: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis)
): Promise<{ wavPath: string; durationSec: number }> {
  const res = await fetchImpl(`${baseUrl}/record/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error(`bridge stop ${res.status}`);
  return res.json();
}
