import { GijiSettings } from "./settings";
import { bridgeHealth } from "./bridge";

export interface LaunchDeps {
  fetchImpl?: typeof fetch;
  spawnImpl?: (cmd: string, args: string[], opts: any) => any;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

let launching: Promise<boolean> | null = null;

export async function isBridgeUp(
  settings: GijiSettings,
  fetchImpl?: typeof fetch
): Promise<boolean> {
  return bridgeHealth(settings.bridgeBaseUrl, fetchImpl);
}

async function defaultSpawn(cmd: string, args: string[], opts: any): Promise<any> {
  const { spawn } = await import("child_process");
  const child = spawn(cmd, args, opts);
  child.unref();
  return child;
}

export async function launchBridge(
  settings: GijiSettings,
  deps: LaunchDeps = {}
): Promise<boolean> {
  if (launching) {
    return launching;
  }
  launching = doLaunch(settings, deps).finally(() => {
    launching = null;
  });
  return launching;
}

async function doLaunch(settings: GijiSettings, deps: LaunchDeps): Promise<boolean> {
  const fetchImpl = deps.fetchImpl;
  const spawnImpl = deps.spawnImpl ?? defaultSpawn;
  const pollIntervalMs = deps.pollIntervalMs ?? 500;
  const timeoutMs = deps.timeoutMs ?? 15000;

  if (await isBridgeUp(settings, fetchImpl)) {
    return true;
  }

  try {
    await spawnImpl("python", ["main.py"], {
      cwd: settings.bridgeDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      try {
        await spawnImpl("py", ["main.py"], {
          cwd: settings.bridgeDir,
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
      } catch (fallbackErr: any) {
        console.warn("[giji] failed to spawn py fallback:", fallbackErr);
        return false;
      }
    } else {
      console.warn("[giji] failed to spawn python bridge:", err);
      return false;
    }
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isBridgeUp(settings, fetchImpl)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return await isBridgeUp(settings, fetchImpl);
}
