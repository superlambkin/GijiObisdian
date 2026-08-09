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
  /** 録音モード: mic（マイクのみ）/ pcLoopback（PC 音声のみ）/ mix（マイク+PC 音声）。省略時はブリッジ既定 "mic" */
  audioSource?: string;
}

export async function bridgeStart(
  baseUrl: string,
  opts: BridgeStartOptions = {},
  fetchImpl: typeof fetch = fetch.bind(globalThis)
): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/record/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "wav", outDir: opts.outDir, fileName: opts.fileName, audioSource: opts.audioSource }),
  });
  if (!res.ok) throw new Error(`bridge start ${res.status}`);
  const data = await res.json();
  return data.sessionId;
}

export interface BridgeStopResult {
  /** 保存された音声ファイル一覧（MP3 64kbps、24MB 超は複数セグメント） */
  audioPaths: string[];
  durationSec: number;
  /** 後方互換: 先頭ファイルのパス */
  wavPath?: string;
  /** 実際に使用された録音モード（mic / pcLoopback / mix） */
  audioSource?: string;
  /** "mp3_encode_failed": MP3 変換失敗で WAV フォールバック */
  warning?: string;
}

export async function bridgeStop(
  baseUrl: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis)
): Promise<BridgeStopResult> {
  const res = await fetchImpl(`${baseUrl}/record/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error(`bridge stop ${res.status}`);
  return res.json();
}
