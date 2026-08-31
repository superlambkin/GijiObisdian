import { GijiSettings } from "../settings";

export interface AudioDeviceInfo {
  id: string;
  name: string;
}

export interface DeviceListResult {
  microphones: AudioDeviceInfo[];
  speakers: AudioDeviceInfo[];
  /** どのソースから取得したか */
  source: "direct" | "none";
}

export interface DeviceListFetcher {
  browserEnumerate?: () => Promise<MediaDeviceInfo[]>;
}

const defaultBrowserEnumerate = async (): Promise<MediaDeviceInfo[]> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    throw new Error("no enumerateDevices");
  }
  return navigator.mediaDevices.enumerateDevices();
};

/**
 * 録音デバイス一覧を取得する。
 *
 * 常に navigator.mediaDevices.enumerateDevices() を使う。
 * 失敗時 → 空配列 + source="none"。
 */
export async function listDevices(
  settings: GijiSettings,
  fetcher: DeviceListFetcher = {}
): Promise<DeviceListResult> {
  const browser = fetcher.browserEnumerate ?? defaultBrowserEnumerate;

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
