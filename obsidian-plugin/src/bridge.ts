export async function bridgeHealth(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function bridgeStart(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/record/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "wav" }),
  });
  if (!res.ok) throw new Error(`bridge start ${res.status}`);
  const data = await res.json();
  return data.sessionId;
}

export async function bridgeStop(
  baseUrl: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ wavPath: string; durationSec: number }> {
  const res = await fetchImpl(`${baseUrl}/record/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error(`bridge stop ${res.status}`);
  return res.json();
}
