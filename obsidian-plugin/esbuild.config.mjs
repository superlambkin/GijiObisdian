import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(root, "node_modules/@ffmpeg/core/dist/esm");
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
