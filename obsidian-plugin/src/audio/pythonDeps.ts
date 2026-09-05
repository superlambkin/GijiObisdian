import { spawn as nodeSpawn, type ChildProcess } from "child_process";
import { join } from "path";
import { delimiter } from "path";

export interface EnsurePythonDepsDeps {
  spawn?: typeof nodeSpawn;
  /** 進行状況の通知（呼び出し側が Notice 等に変換する） */
  onNotice?: (message: string) => void;
}

export interface EnsurePythonDepsResult {
  ok: boolean;
  /** 使えた Python コマンド（無ければ undefined） */
  python?: string;
}

/** PC音声キャプチャに必要な Python パッケージ */
const REQUIRED_PACKAGES = "numpy soundcard";
/** パッケージ導入先（プラグインフォルダ内・ポータブル） */
export function pylibsDir(scriptDir: string): string {
  return scriptDir ? join(scriptDir, "pylibs") : "";
}

/**
 * v0.15.1: WASAPI キャプチャ用 spawn 環境を組み立てる。
 * pylibs/（同梱パッケージ導入先）を PYTHONPATH 先頭に追加する。
 */
export function buildLoopbackEnv(scriptDir: string): NodeJS.ProcessEnv {
  const libs = pylibsDir(scriptDir);
  const existing = process.env.PYTHONPATH;
  const pythonPath = libs ? (existing ? `${libs}${delimiter}${existing}` : libs) : existing;
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    ...(pythonPath ? { PYTHONPATH: pythonPath } : {}),
  };
}

/** Python コマンド候補（defaultSpawnPcLoopbackCapture と同じ優先順） */
export function pythonCandidates(scriptDir: string): string[] {
  return scriptDir
    ? [join(scriptDir, "venv", "Scripts", "python.exe"), "python", "py"]
    : ["python", "py"];
}

/** `python -c "import numpy, soundcard"` が通るか（exit 0 = 通る） */
function checkInstalled(spawn: typeof nodeSpawn, py: string, scriptDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(py, ["-c", "import numpy, soundcard"], {
        stdio: "ignore",
        windowsHide: true,
        env: buildLoopbackEnv(scriptDir),
      });
    } catch {
      resolve(false);
      return;
    }
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

/** `python -m pip install --target pylibs numpy soundcard` */
function pipInstall(
  spawn: typeof nodeSpawn,
  py: string,
  scriptDir: string
): Promise<boolean> {
  const target = pylibsDir(scriptDir);
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(py, ["-m", "pip", "install", "--target", target, ...REQUIRED_PACKAGES.split(" ")], {
        stdio: "ignore",
        windowsHide: true,
        env: buildLoopbackEnv(scriptDir),
      });
    } catch {
      resolve(false);
      return;
    }
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

/**
 * v0.15.1（案A: 初回自動インストール）: PC音声キャプチャに必要な
 * numpy / soundcard を「その PC の Python に合う形」でプラグインフォルダ内
 * pylibs/ へ導入する。
 *
 * - 既に import できる → 何もしない
 * - 出来ない場合 → pip install --target pylibs（初回のみ・インターネット要）
 * - Python 自体が無い / pip 失敗 → ok=false（呼び出し側はマイクのみへフォールバック）
 */
export async function ensurePythonDeps(
  scriptDir: string,
  deps: EnsurePythonDepsDeps = {}
): Promise<EnsurePythonDepsResult> {
  const spawn = deps.spawn ?? nodeSpawn;
  const candidates = pythonCandidates(scriptDir);

  // 1) どれかの Python で import できるか
  for (const py of candidates) {
    if (await checkInstalled(spawn, py, scriptDir)) {
      return { ok: true, python: py };
    }
  }

  // 2) 動く Python が無ければ導入のしようがない
  let working: string | null = null;
  for (const py of candidates) {
    if (await probePython(spawn, py)) {
      working = py;
      break;
    }
  }
  if (!working) return { ok: false };

  // 3) pylibs へ導入して再チェック
  deps.onNotice?.("📦 PC音声用パッケージをインストールしています（初回のみ・数十秒かかることがあります）");
  const installed = await pipInstall(spawn, working, scriptDir);
  if (!installed) {
    deps.onNotice?.("⚠️ PC音声用パッケージのインストールに失敗しました。PC音声なし（マイクのみ）で録音します");
    return { ok: false, python: working };
  }
  deps.onNotice?.("✅ PC音声用パッケージのインストールが完了しました");
  const ok = await checkInstalled(spawn, working, scriptDir);
  return { ok, python: working };
}

/** `-c` ではなく Python として起動できるか（バージョン表示でプローブ） */
function probePython(spawn: typeof nodeSpawn, py: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(py, ["--version"], { stdio: "ignore", windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}
