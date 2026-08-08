import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../settings";
import {
  buildTranscriptFilename,
  formatDuration,
  renderTranscriptNote,
  saveTranscriptToFile,
} from "../notes/saver";

const FIXED = new Date(2026, 7, 4, 6, 30, 15); // 2026-08-04 06:30:15

test("buildTranscriptFilename uses default 和式 template", () => {
  assert.equal(buildTranscriptFilename(FIXED), "議事録_2026年08月04日06時30分");
});

test("buildTranscriptFilename renders custom template placeholders", () => {
  assert.equal(
    buildTranscriptFilename(FIXED, "議事録_{{date}}_{{time}}"),
    "議事録_2026-08-04_06-30"
  );
  assert.equal(
    buildTranscriptFilename(FIXED, "{{year}}-{{month}}-{{day}} {{hour}}-{{minute}}-{{second}}"),
    "2026-08-04 06-30-15"
  );
});

test("buildTranscriptFilename strips illegal filename chars", () => {
  const name = buildTranscriptFilename(FIXED, 'a/b\\c:d*e?f"g<h>i|j');
  assert.ok(!/[\\/:*?"<>|]/.test(name), `illegal chars remain: ${name}`);
});

test("formatDuration formats seconds to 分/秒", () => {
  assert.equal(formatDuration(83), "1 分 23 秒");
  assert.equal(formatDuration(45), "45 秒");
  assert.equal(formatDuration(600), "10 分 0 秒");
});

test("renderTranscriptNote has MD生成ルール compliant frontmatter", () => {
  const md = renderTranscriptNote(
    "議事録_2026年08月04日06時30分",
    FIXED,
    "你好，世界。",
    83,
    "Clippings/議事録_2026年08月04日06時30分.md"
  );
  assert.match(md, /^---\n/);
  assert.match(md, /title: "議事録_2026年08月04日06時30分"/);
  assert.match(md, /type: voice-transcript/);
  assert.match(md, /language: Japanese/);
  assert.match(md, /version: 1\.0\.0/);
  assert.match(md, /created: 2026-08-04\n/);
  assert.match(md, /modified: 2026-08-04 06:30/);
  assert.match(md, /applied_rules_version: 2\.11\.0/);
  assert.match(md, /- 議事録/);
  assert.match(md, /- 文字起こし/);
});

test("renderTranscriptNote prepends 文字数 and 会議時間 before body", () => {
  const md = renderTranscriptNote("議事録_2026年08月04日06時30分", FIXED, "你好，世界。", 83, "Clippings/x.md");
  assert.match(md, /文字数 \| 6 字/);
  assert.match(md, /会議時間 \| 1 分 23 秒/);
  assert.match(md, /📂 パス：Clippings\/x\.md/);
  const idxMeta = md.indexOf("文字数");
  const idxBody = md.indexOf("你好，世界。");
  assert.ok(idxMeta !== -1 && idxBody !== -1 && idxMeta < idxBody, "概要は本文より先頭にあること");
});

test("renderTranscriptNote shows — when duration unknown", () => {
  const md = renderTranscriptNote("t", FIXED, "abc", undefined, "Clippings/x.md");
  assert.match(md, /会議時間 \| —/);
});

test("renderTranscriptNote ends with 更新記録 initial entry", () => {
  const md = renderTranscriptNote("t", FIXED, "abc", 10, "Clippings/x.md");
  assert.match(md, /## 📝 更新記録/);
  assert.match(md, /v1\.0\.0 \| 2026-08-04 06:30 \| 初版/);
});

test("saveTranscriptToFile creates dir + writes file with 和式 name", async () => {
  const created: string[] = [];
  const files = new Map<string, boolean>([
    ["Clippings", false], // dir not existing yet
  ]);
  const adapter = {
    exists: async (p: string) => files.get(p) ?? false,
  };
  const vault = {
    adapter,
    createFolder: async (dir: string) => {
      files.set(dir, true);
    },
    create: async (path: string, content: string) => {
      created.push(path);
      files.set(path, true);
    },
  };
  const app = { vault } as any;
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "Clippings" };

  const saved = await saveTranscriptToFile(app, settings, "测试文本", 12, FIXED);
  assert.equal(saved, "Clippings/議事録_2026年08月04日06時30分.md");
  assert.equal(created.length, 1);
  assert.ok(files.get("Clippings")); // folder was created
});

test("saveTranscriptToFile dedupes filename collisions", async () => {
  const existing = new Set<string>([
    "Clippings/議事録_2026年08月04日06時30分.md",
  ]);
  const created: string[] = [];
  const adapter = {
    exists: async (p: string) => existing.has(p),
  };
  const vault = {
    adapter,
    createFolder: async () => {},
    create: async (path: string, _content: string) => {
      created.push(path);
      existing.add(path);
    },
  };
  const app = { vault } as any;
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "Clippings" };

  const saved = await saveTranscriptToFile(app, settings, "文本", 5, FIXED);
  assert.equal(saved, "Clippings/議事録_2026年08月04日06時30分-2.md");
  assert.equal(created.length, 1);
});

test("saveTranscriptToFile falls back to Clippings when dir empty", async () => {
  const created: string[] = [];
  const files = new Map<string, boolean>();
  const vault = {
    adapter: {
      exists: async (p: string) => files.get(p) ?? false,
    },
    createFolder: async (dir: string) => files.set(dir, true),
    create: async (path: string, _content: string) => {
      created.push(path);
      files.set(path, true);
    },
  };
  const app = { vault } as any;
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "  /  " };

  const saved = await saveTranscriptToFile(app, settings, "文本", undefined, FIXED);
  assert.equal(saved, "Clippings/議事録_2026年08月04日06時30分.md");
});
