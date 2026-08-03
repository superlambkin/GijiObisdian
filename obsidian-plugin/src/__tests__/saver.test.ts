import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../settings";
import {
  buildTranscriptFilename,
  renderTranscriptNote,
  saveTranscriptToFile,
} from "../notes/saver";

const FIXED = new Date(2026, 7, 4, 6, 30, 15); // 2026-08-04 06:30:15

test("buildTranscriptFilename formats date and time", () => {
  assert.equal(buildTranscriptFilename(FIXED), "转写 2026-08-04 06-30-15");
});

test("renderTranscriptNote includes frontmatter + body", () => {
  const md = renderTranscriptNote("转写 2026-08-04 06-30-15", FIXED, "你好，世界。");
  assert.match(md, /^---\n/);
  assert.match(md, /title: "转写 2026-08-04 06-30-15"/);
  assert.match(md, /type: voice-transcript/);
  assert.match(md, /# 🎙️ 转写 2026-08-04 06-30-15/);
  assert.match(md, /你好，世界。/);
});

test("saveTranscriptToFile creates dir + writes file", async () => {
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

  const saved = await saveTranscriptToFile(app, settings, "测试文本", FIXED);
  assert.equal(saved, "Clippings/转写 2026-08-04 06-30-15.md");
  assert.equal(created.length, 1);
  assert.ok(files.get("Clippings")); // folder was created
});

test("saveTranscriptToFile dedupes filename collisions", async () => {
  const existing = new Set<string>([
    "Clippings/转写 2026-08-04 06-30-15.md",
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

  const saved = await saveTranscriptToFile(app, settings, "文本", FIXED);
  assert.equal(saved, "Clippings/转写 2026-08-04 06-30-15-2.md");
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

  const saved = await saveTranscriptToFile(app, settings, "文本", FIXED);
  assert.equal(saved, "Clippings/转写 2026-08-04 06-30-15.md");
});
