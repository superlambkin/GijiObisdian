import { GijiSettings } from "../settings";

export interface AudioDeviceInfo {
  id: string;
  name: string;
}

export interface DeviceListResult {
  microphones: AudioDeviceInfo[];
  speakers: AudioDeviceInfo[];
  /** どのソースから取得したか */
  source: "bridge" | "direct" | "none";
}

export interface DeviceListFetcher {
  bridgeFetch?: (baseUrl: string) => Promise<DeviceListResult | null>;
  browserEnumerate?: () => Promise<MediaDeviceInfo[]>;
}

const defaultBridgeFetch = async (baseUrl: string): Promise<DeviceListResult | null> => {
  try {
    const res = await fetch(`${baseUrl}/audio/devices`);
    if (!res.ok) return null;
    const body = await res.json();
    return {
      microphones: Array.isArray(body.microphones) ? body.microphones : [],
      speakers: Array.isArray(body.speakers) ? body.speakers : [],
      source: "bridge",
    };
  } catch {
    return null;
  }
};

const defaultBrowserEnumerate = async (): Promise<MediaDeviceInfo[]> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    throw new Error("no enumerateDevices");
  }
  return navigator.mediaDevices.enumerateDevices();
};

/**
 * 録音デバイス一覧を取得する。
 *
 * - recordingMethod === "bridge" → ブリッジの GET /audio/devices を優先し、
 *   失敗時は navigator.mediaDevices.enumerateDevices() にフォールバック。
 * - recordingMethod === "direct" → 常に enumerateDevices() を使う。
 * - 両方失敗 → 空配列 + source="none"。
 */
export async function listDevices(
  settings: GijiSettings,
  fetcher: DeviceListFetcher = {}
): Promise<DeviceListResult> {
  const bridge = fetcher.bridgeFetch ?? defaultBridgeFetch;
  const browser = fetcher.browserEnumerate ?? defaultBrowserEnumerate;

  if (settings.recordingMethod === "bridge") {
    const got = await bridge(settings.bridgeBaseUrl);
    if (got) return got;
  }
  try {
    const all = await browser();
    return {
      microphones: all
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({ id: d.deviceId, name: d.label || "(unnamed input)" })),
      speakers: all
        .filter((d) => d.kind === "audiooutput")
        .map((d) => ({ id: d.deviceId, name: d.label || "(unnamed output)" })),
      source: "direct",
    };
  } catch {
    return { microphones: [], speakers: [], source: "none" };
  }
}
