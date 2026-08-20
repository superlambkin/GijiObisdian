import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(root, "node_modules/@ffmpeg/core/dist/esm");
const ffmpegDir = resolve(root, "node_modules/@ffmpeg/ffmpeg/dist/esm");
const ffmpegAssets = {
  name: "ffmpeg-assets",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      await mkdir(root, { recursive: true });
      await Promise.all([
        copyFile(resolve(coreDir, "ffmpeg-core.js"), resolve(root, "ffmpeg-core.js")),
        copyFile(resolve(coreDir, "ffmpeg-core.wasm"), resolve(root, "ffmpeg-core.wasm")),
        // @ffmpeg/ffmpeg のワーカースクリプト。Worker 初期化時に plugin フォルダから
        // 相対解決されるため、main.js と同じ階層にコピーする。
        copyFile(resolve(ffmpegDir, "worker.js"), resolve(root, "worker.js")),
      ]);
      // esbuild の CJS 出力は `import.meta.url` を空オブジェクトに展開してしまうため、
      // 生成された main.js 内の `var import_meta* = {};` を Node の
      // `pathToFileURL(__filename).href` でパッチする。@ffmpeg/ffmpeg 内の
      // Worker 初期化（new URL("./worker.js", import_meta.url)）にも必要。
      const mainJsPath = resolve(root, "main.js");
      const content = await readFile(mainJsPath, "utf-8");
      const patched = content.replace(
        /var import_meta\d* = \{\};/g,
        `var import_meta = { url: require('url').pathToFileURL(__filename).href };`
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
  plugins: [ffmpegAssets],
});

if (watch) {
  await context.watch();
  console.log("[giji-obsidian] watching…");
} else {
  await context.rebuild();
  await context.dispose();
}
