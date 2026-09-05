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

/** 導入済みキャッシュ（レビュー指摘: 毎録音の import チェック遅延を避ける） */
const okCache = new Set<string>();

/** テスト用: キャッシュをクリアする */
export function resetPythonDepsCache(): void {
  okCache.clear();
}

/**
 * v0.15.1: WASAPI キャプチャ用 spawn 環境を組み立てる。
 * pylibs/（同梱パッケージ導入先）を PYTHONPATH 先頭に追加する。
 * ただし skipPylibs の場合（venv Python 等・自身の site-packages を持つ）は付けない。
 * レビュー指摘: pylibs のネイティブ wheel が Python バージョン不一致で venv を
 * shadow して ImportError を起こすのを避けるため。
 */
export function buildLoopbackEnv(scriptDir: string, opts?: { skipPylibs?: boolean }): NodeJS.ProcessEnv {
  const libs = opts?.skipPylibs ? "" : pylibsDir(scriptDir);
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

/** spawn をタイムアウト付きで待つ（レビュー指摘: pip ハングで録音開始がブロックされないように） */
function waitClose(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (code: number | null) => {
      if (!done) {
        done = true;
        resolve(code);
      }
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish(null);
    }, timeoutMs);
    child.once("error", () => { clearTimeout(timer); finish(null); });
    child.once("close", (code) => { clearTimeout(timer); finish(code); });
  });
}

/** `python -c "import numpy, soundcard"` が通るか（exit 0 = 通る） */
function checkInstalled(spawn: typeof nodeSpawn, py: string, scriptDir: string, skipPylibs: boolean): Promise<boolean> {
  return new Promise(async (resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(py, ["-c", "import numpy, soundcard"], {
        stdio: "ignore",
        windowsHide: true,
        env: buildLoopbackEnv(scriptDir, { skipPylibs }),
      });
    } catch {
      resolve(false);
      return;
    }
    resolve((await waitClose(child, 10_000)) === 0);
  });
}

/** `python -m pip install --target pylibs numpy soundcard` */
function pipInstall(
  spawn: typeof nodeSpawn,
  py: string,
  scriptDir: string
): Promise<boolean> {
  const target = pylibsDir(scriptDir);
  return new Promise(async (resolve) => {
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
    // レビュー指摘: ネットワーク不良で録音開始が無期限にブロックされないよう 120 秒で打ち切り
    resolve((await waitClose(child, 120_000)) === 0);
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

  // 導入済みキャッシュ（レビュー指摘: 毎録音の起動遅延を避ける）
  if (okCache.has(scriptDir)) {
    return { ok: true, python: candidates[1] };
  }

  // 1) どれかの Python で import できるか（venv は自身の site-packages を使うため pylibs は渡さない）
  for (const py of candidates) {
    const isVenv = py.includes("venv");
    if (await checkInstalled(spawn, py, scriptDir, isVenv)) {
      okCache.add(scriptDir);
      return { ok: true, python: py };
    }
  }

  // 2) 動く Python が無ければ導入のしようがない（venv は pylibs を shadow し得るため導入先にしない）
  let working: string | null = null;
  for (const py of candidates) {
    if (py.includes("venv")) continue;
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
  const ok = await checkInstalled(spawn, working, scriptDir, false);
  if (ok) okCache.add(scriptDir);
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
