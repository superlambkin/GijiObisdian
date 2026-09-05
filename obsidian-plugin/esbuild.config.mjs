import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(root, ".."); // obsidian-plugin/ → GijiObsidian/
const coreDir = resolve(root, "node_modules/@ffmpeg/core/dist/esm");
const ffmpegDir = resolve(root, "node_modules/@ffmpeg/ffmpeg/dist/esm");

/**
 * v0.15.2: Python 補助スクリプト（と依存モジュール）をプラグインフォルダへ 1 セットで配布する。
 * v0.15.1 までは pc_loopback_capture.py 単独しか配布しておらず、config.py が欠落して
 * v0.11 以来 PC 音声キャプチャが ModuleNotFoundError で起動直後に死んでいた（不具合 #1）。
 */
const recorderBridgeFiles = [
  "pc_loopback_capture.py",
  "config.py",
];

const deployToPlugin = {
  name: "deploy-to-vault-plugin-folder",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      // 環境変数 GIJI_PLUGIN_DIR で配布先を上書き可能（CI / 別 PC 用）。
      // 未設定なら Obsidian Vault 内の GijiObsidian プラグインフォルダへコピー。
      const target =
        process.env.GIJI_PLUGIN_DIR ??
        resolve(process.env.USERPROFILE ?? process.env.HOME ?? "", "OneDrive/Edge/Obsidian Vault/.obsidian/plugins/GijiObsidian");

      await mkdir(target, { recursive: true });
      // 1) ビルドで生成された成果物
      await Promise.all([
        copyFile(resolve(root, "main.js"), resolve(target, "main.js")),
        copyFile(resolve(root, "manifest.json"), resolve(target, "manifest.json")),
        copyFile(resolve(root, "ffmpeg-core.js"), resolve(target, "ffmpeg-core.js")),
        copyFile(resolve(root, "ffmpeg-core.wasm"), resolve(target, "ffmpeg-core.wasm")),
      ]);
      // 2) Python 補助スクリプトと依存モジュール（v0.15.2 教訓：1 セット配布）
      await Promise.all(
        recorderBridgeFiles.map((f) =>
          copyFile(resolve(pluginRoot, "recorder-bridge", f), resolve(target, f))
        )
      );
      // 3) マーカー検証（デプロイ漏れを CI レベルで即検知）
      for (const f of ["main.js", "manifest.json", "ffmpeg-core.js", "ffmpeg-core.wasm", ...recorderBridgeFiles]) {
        await access(resolve(target, f));
      }
      console.log(`[deploy] ✅ → ${target}`);
    });
  },
};
const ffmpegAssets = {
  name: "ffmpeg-assets",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      await mkdir(root, { recursive: true });
      await Promise.all([
        copyFile(resolve(coreDir, "ffmpeg-core.js"), resolve(root, "ffmpeg-core.js")),
        copyFile(resolve(coreDir, "ffmpeg-core.wasm"), resolve(root, "ffmpeg-core.wasm")),
      ]);

      // @ffmpeg/ffmpeg の worker.js は const.js / errors.js を相対 import している。
      // Obsidian の CSP/セキュリティ制約により、Worker を file:// URL で起動できないため、
      // ランタイムで Blob URL 化する戦略を取る。Blob URL では相対 import が解決できないため、
      // ビルド時点で単一ファイルにインライン化する。
      const constJs = await readFile(resolve(ffmpegDir, "const.js"), "utf-8");
      const errorsJs = await readFile(resolve(ffmpegDir, "errors.js"), "utf-8");
      const workerJs = await readFile(resolve(ffmpegDir, "worker.js"), "utf-8");
      // export キーワードを除去（インライン化先で import 文に展開されるため）
      const strippedConst = constJs.replace(/^export\s+/gm, "");
      const strippedErrors = errorsJs.replace(/^export\s+/gm, "");
      const bundledWorker = workerJs
        .replace(
          /^import \{[\s\S]*?\} from "\.\/const\.js";\s*$/m,
          strippedConst
        )
        .replace(
          /^import \{[\s\S]*?\} from "\.\/errors\.js";\s*$/m,
          strippedErrors
        );
      await writeFile(resolve(root, "worker.js"), bundledWorker, "utf-8");

      // esbuild の CJS 出力は `import.meta.url` を空オブジェクトに展開してしまうため、
      // 生成された main.js 内の `var import_meta* = {};` を Node の
      // `pathToFileURL(__filename).href` でパッチする。@ffmpeg/ffmpeg 内の
      // Worker 初期化（new URL("./worker.js", import_meta.url)）にも必要。
      // ※ キャプチャグループで変数名（import_meta / import_meta2 など）を保持し、
      //    esbuild がソース側で参照する同名変数を残す。
      const mainJsPath = resolve(root, "main.js");
      const content = await readFile(mainJsPath, "utf-8");
      const patched = content.replace(
        /var (import_meta\d*) = \{\};/g,
        `var $1 = { url: require('url').pathToFileURL(__filename).href };`
      );
      if (patched !== content) await writeFile(mainJsPath, patched, "utf-8");
    });
  },
};

const watch = process.argv[2] === "watch";
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: "inline",
  treeShaking: true,
  outfile: "main.js",
  // v0.15.2: watch 時はデプロイを無効化（開発時の常時コピーを避ける）
  plugins: [ffmpegAssets, ...(watch ? [] : [deployToPlugin])],
});

if (watch) {
  await context.watch();
  console.log("[GijiObsidian] watching…");
} else {
  await context.rebuild();
  await context.dispose();
}
