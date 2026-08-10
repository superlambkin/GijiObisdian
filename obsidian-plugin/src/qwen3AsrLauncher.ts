import { spawn as nodeSpawn } from "child_process";
import { join } from "path";
import { GijiSettings, isLocalSttProvider } from "./settings";

export interface AsrLaunchDeps {
  fetchImpl?: typeof fetch;
  spawnImpl?: (cmd: string, args: string[], opts: any) => Promise<any>;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

let launching: Promise<boolean> | null = null;

/** sttBaseUrl（例 http://127.0.0.1:9000/v1）から origin（例 http://127.0.0.1:9000）を取り出す */
export function asrServerOrigin(sttBaseUrl: string): string {
  try {
    return new URL(sttBaseUrl).origin;
  } catch {
    return sttBaseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  }
}

export async function isLocalAsrUp(
  settings: GijiSettings,
  fetchImpl?: typeof fetch
): Promise<boolean> {
  const f = fetchImpl ?? fetch.bind(globalThis);
  try {
    const res = await f(`${asrServerOrigin(settings.sttBaseUrl)}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

async function defaultSpawn(cmd: string, args: string[], opts: any): Promise<any> {
  const child = nodeSpawn(cmd, args, opts);
  child.unref();
  return new Promise((resolve, reject) => {
    child.once("spawn", () => resolve(child));
    child.once("error", (err: Error) => reject(err));
  });
}

export async function launchLocalAsrServer(
  settings: GijiSettings,
  deps: AsrLaunchDeps = {}
): Promise<boolean> {
  if (launching) return launching;
  launching = doLaunch(settings, deps).finally(() => {
    launching = null;
  });
  return launching;
}

async function doLaunch(settings: GijiSettings, deps: AsrLaunchDeps): Promise<boolean> {
  const fetchImpl = deps.fetchImpl;
  const spawnImpl = deps.spawnImpl ?? defaultSpawn;
  const pollIntervalMs = deps.pollIntervalMs ?? 800;
  const timeoutMs = deps.timeoutMs ?? 60000;

  if (await isLocalAsrUp(settings, fetchImpl)) return true;

  const dir = settings.sttServerDir;
  const venvPy = join(dir, ".venv", "Scripts", "python.exe");
  try {
    await spawnImpl(venvPy, ["main.py"], {
      cwd: dir, detached: true, stdio: "ignore", windowsHide: true,
    });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      try {
        await spawnImpl("python", ["main.py"], {
          cwd: dir, detached: true, stdio: "ignore", windowsHide: true,
        });
      } catch (e2: any) {
        console.warn("[giji] failed to spawn qwen3-asr-server:", e2);
        return false;
      }
    } else {
      console.warn("[giji] failed to spawn qwen3-asr-server:", err);
      return false;
    }
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isLocalAsrUp(settings, fetchImpl)) return true;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return await isLocalAsrUp(settings, fetchImpl);
}

/** ローカル STT 使用時にサーバを確実に起動してから転写する（クラウド時は no-op）。失敗時はフレンドリーなエラーを throw */
export async function ensureLocalAsrServer(
  settings: GijiSettings,
  deps: AsrLaunchDeps = {}
): Promise<boolean> {
  if (!isLocalSttProvider(settings.sttProvider)) return true;
  const ok = await launchLocalAsrServer(settings, deps);
  if (!ok) {
    throw new Error(
      `ローカル ASR サーバを起動できませんでした。${settings.sttServerDir} で start_qwen3_asr.bat を実行してください`
    );
  }
  return true;
}
