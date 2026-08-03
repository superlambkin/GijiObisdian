import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

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
});

if (watch) {
  await context.watch();
  console.log("[giji-obsidian] watching…");
} else {
  await context.rebuild();
  await context.dispose();
}
