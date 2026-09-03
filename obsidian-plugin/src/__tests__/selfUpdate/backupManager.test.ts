import test from "node:test";
import assert from "node:assert/strict";
import { backupPluginFiles, BACKUP_TARGET_FILES } from "../../selfUpdate/backupManager";

/** DataAdapter のインメモリスタブ */
function makeAdapter(existing: string[] = []) {
  const files = new Map<string, ArrayBuffer>();
  for (const p of existing) files.set(p, new ArrayBuffer(1));
  return {
    files,
    async exists(p: string) { return files.has(p); },
    async mkdir(_p: string) { /* 記録省略 */ },
    async readBinary(p: string) { return files.get(p) ?? new ArrayBuffer(0); },
    async writeBinary(p: string, data: ArrayBuffer) { files.set(p, data); },
  };
}

const NOW = new Date("2026-09-04T12:34:56.789Z");

test("BACKUP_TARGET_FILES: 更新対象 5 ファイルを含む", () => {
  assert.deepEqual([...BACKUP_TARGET_FILES],
    ["main.js", "manifest.json", "styles.css", "worker.js", "ffmpeg-core.js"]);
});

test("backupPluginFiles: 存在するファイルのみ .backup/<UTC>/ へ退避する", async () => {
  const adapter = makeAdapter(["plugin/main.js", "plugin/manifest.json"]);
  const dir = await backupPluginFiles("plugin", adapter as any, NOW);
  assert.equal(dir, "plugin/.backup/2026-09-04T12-34-56Z");
  assert.ok(adapter.files.has("plugin/.backup/2026-09-04T12-34-56Z/main.js"));
  assert.ok(adapter.files.has("plugin/.backup/2026-09-04T12-34-56Z/manifest.json"));
  assert.ok(!adapter.files.has("plugin/.backup/2026-09-04T12-34-56Z/styles.css"));
});

test("backupPluginFiles: 同名ディレクトリ衝突時は -001 連番", async () => {
  const adapter = makeAdapter(["plugin/main.js", "plugin/.backup/2026-09-04T12-34-56Z"]);
  const dir = await backupPluginFiles("plugin", adapter as any, NOW);
  assert.equal(dir, "plugin/.backup/2026-09-04T12-34-56Z-001");
});
