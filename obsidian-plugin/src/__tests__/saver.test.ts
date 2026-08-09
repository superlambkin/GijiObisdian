import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../settings";
import {
  buildAppendedNote,
  buildHourPrefix,
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

/* ---------------- 追加録音の判定（「時」粒度） ---------------- */

const AT_0541 = new Date(2026, 7, 9, 5, 41, 7); // 2026-08-09 05:41:07

test("buildHourPrefix renders up to hour for default template", () => {
  assert.equal(buildHourPrefix(AT_0541), "議事録_2026年08月09日05時");
});

test("buildHourPrefix returns full name when template has no minute/second", () => {
  assert.equal(buildHourPrefix(AT_0541, "議事録_{{date}}"), "議事録_2026-08-09");
  assert.equal(buildHourPrefix(AT_0541, "議事録_{{date}}_{{hour}}時"), "議事録_2026-08-09_05時");
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

test("saveTranscriptToFile creates dir + writes file with 録音_ name", async () => {
  const created: string[] = [];
  const files = new Map<string, boolean>([
    ["Clippings", false], // dir not existing yet
  ]);
  const adapter = {
    exists: async (p: string) => files.get(p) ?? false,
    list: async () => ({ files: [], folders: [] }),
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
  assert.deepEqual(saved, { path: "Clippings/録音_2026年08月04日06時30分.md", appended: false });
  assert.equal(created.length, 1);
  assert.ok(files.get("Clippings")); // folder was created
});

test("renderTranscriptNote includes 録音ファイル row when mp3Links given", () => {
  const md = renderTranscriptNote("録音_2026年08月04日06時30分", FIXED, "本文。", 83, "Clippings/x.md", "[🎙️ 録音を再生](file:///C:/a.mp3)");
  assert.match(md, /\| 🎙️ 録音ファイル \| \[🎙️ 録音を再生\]/);
});

test("renderTranscriptNote omits 録音ファイル row when mp3Links empty", () => {
  const md = renderTranscriptNote("録音_2026年08月04日06時30分", FIXED, "本文。", 83, "Clippings/x.md");
  assert.equal(md.includes("🎙️ 録音ファイル"), false);
});

test("saveTranscriptToFile writes mp3Links into note content", async () => {
  const files = new Map<string, boolean>();
  let savedContent = "";
  const vault = {
    adapter: {
      exists: async (p: string) => files.get(p) ?? false,
      list: async () => ({ files: [], folders: [] }),
    },
    createFolder: async (dir: string) => files.set(dir, true),
    create: async (path: string, content: string) => {
      savedContent = content;
      files.set(path, true);
    },
  };
  const app = { vault } as any;
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "Clippings" };
  await saveTranscriptToFile(app, settings, "本文", 10, FIXED, "[🎙️ 録音を再生](file:///C:/a.mp3)");
  assert.match(savedContent, /\| 🎙️ 録音ファイル \| \[🎙️ 録音を再生\]/);
});

test("saveTranscriptToFile dedupes filename collisions when append disabled", async () => {
  const existing = new Set<string>([
    "Clippings/録音_2026年08月04日06時30分.md",
  ]);
  const created: string[] = [];
  const adapter = {
    exists: async (p: string) => existing.has(p),
    read: async () => { throw new Error("read should not be called when append disabled"); },
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
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "Clippings", appendRecordEnabled: false };

  const saved = await saveTranscriptToFile(app, settings, "文本", 5, FIXED);
  assert.deepEqual(saved, { path: "Clippings/録音_2026年08月04日06時30分-2.md", appended: false });
  assert.equal(created.length, 1);
});

test("saveTranscriptToFile falls back to 議事録 when dir empty", async () => {
  const created: string[] = [];
  const files = new Map<string, boolean>();
  const vault = {
    adapter: {
      exists: async (p: string) => files.get(p) ?? false,
      list: async () => ({ files: [], folders: [] }),
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
  assert.deepEqual(saved, { path: "議事録/録音_2026年08月04日06時30分.md", appended: false });
});

/* ---------------- 追加録音（append） ---------------- */

const LATER = new Date(2026, 7, 9, 4, 52, 0); // 2026-08-09 04:52

test("buildAppendedNote inserts segment before 更新記録 and bumps version", () => {
  const prev = renderTranscriptNote("議事録_2026年08月09日04時47分", FIXED, "最初の本文。", 60, "Clippings/x.md");
  const out = buildAppendedNote(prev, "追加の内容。", 45, LATER);

  const i1 = out.indexOf("最初の本文。");
  const i2 = out.indexOf("## 🕐 追加録音");
  const i3 = out.indexOf("## 📝 更新記録");
  assert.ok(i1 !== -1 && i2 !== -1 && i3 !== -1 && i1 < i2 && i2 < i3, "転写本文→追加録音→更新記録の順");

  assert.match(out, /追加の内容。/);
  assert.match(out, /📝 文字数 \| 6 字/);
  assert.match(out, /⏱️ 会議時間 \| 45 秒/);
  assert.match(out, /v1\.0\.1 \| 2026-08-09 04:52 \| 追加録音/);
  assert.match(out, /modified: 2026-08-09 04:52/);
});

test("buildAppendedNote increments patch version on repeated appends", () => {
  let note = renderTranscriptNote("t", FIXED, "最初。", 60, "Clippings/x.md");
  note = buildAppendedNote(note, "二回目。", 10, LATER);
  note = buildAppendedNote(note, "三回目。", 10, LATER);
  assert.match(note, /v1\.0\.1/);
  assert.match(note, /v1\.0\.2/);
  assert.equal(note.indexOf("二回目。") !== -1 && note.indexOf("三回目。") !== -1, true);
});

test("buildAppendedNote appends at end when 更新記録 section missing", () => {
  const prev = "---\ntitle: \"old\"\nmodified: 2026-08-01 10:00\n---\n\n# old note\n\n旧本文\n";
  const out = buildAppendedNote(prev, "追加分", undefined, LATER);
  assert.match(out, /旧本文/);
  assert.match(out, /## 🕐 追加録音/);
  assert.match(out, /追加分/);
  assert.match(out, /modified: 2026-08-09 04:52/); // modified は更新される
});

test("saveTranscriptToFile appends when enabled and same-minute file exists", async () => {
  const prevContent = renderTranscriptNote(
    "録音_2026年08月04日06時30分", FIXED, "最初の転写。", 30, "Clippings/録音_2026年08月04日06時30分.md"
  );
  const existing = new Map<string, string>([
    ["Clippings/録音_2026年08月04日06時30分.md", prevContent],
    ["Clippings", ""],
  ]);
  const written: { path: string; content: string }[] = [];
  const vault = {
    adapter: {
      exists: async (p: string) => existing.has(p),
      read: async (p: string) => existing.get(p) ?? "",
      list: async () => ({ files: ["Clippings/録音_2026年08月04日06時30分.md"], folders: [] }),
      write: async (p: string, content: string) => {
        written.push({ path: p, content });
        existing.set(p, content);
      },
    },
    createFolder: async () => {},
    create: async () => { throw new Error("create should not be called when appending"); },
  };
  const app = { vault } as any;
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "Clippings", appendRecordEnabled: true };

  const saved = await saveTranscriptToFile(app, settings, "追加の転写。", 45, FIXED);
  assert.deepEqual(saved, { path: "Clippings/録音_2026年08月04日06時30分.md", appended: true });
  assert.equal(written.length, 1);
  assert.match(written[0].content, /最初の転写。/);
  assert.match(written[0].content, /追加の転写。/);
  assert.match(written[0].content, /## 🕐 追加録音/);
});

/* ---------------- 「時」粒度の追記判定（主人の要件 2026-08-09） ---------------- */

function makeHourMockVault(existingFiles: Map<string, string>, written: { path: string; content: string }[], created: string[]) {
  return {
    adapter: {
      exists: async (p: string) => existingFiles.has(p),
      read: async (p: string) => existingFiles.get(p) ?? "",
      list: async () => ({ files: [...existingFiles.keys()].filter((k) => k.endsWith(".md")), folders: [] }),
      write: async (p: string, content: string) => {
        written.push({ path: p, content });
        existingFiles.set(p, content);
      },
    },
    createFolder: async () => {},
    create: async (path: string, content: string) => {
      created.push(path);
      existingFiles.set(path, content);
    },
  };
}

test("appends into same-hour file even when minutes differ (05:41 → 05時21分.md)", async () => {
  const prev = renderTranscriptNote("録音_2026年08月09日05時21分", new Date(2026, 7, 9, 5, 21), "五時台の最初の録音。", 60, "Clippings/録音_2026年08月09日05時21分.md");
  const existing = new Map<string, string>([
    ["Clippings/録音_2026年08月09日05時21分.md", prev],
    ["Clippings", ""],
  ]);
  const written: { path: string; content: string }[] = [];
  const created: string[] = [];
  const app = { vault: makeHourMockVault(existing, written, created) } as any;
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "Clippings", appendRecordEnabled: true };

  const saved = await saveTranscriptToFile(app, settings, "四十一分の追加録音。", 45, AT_0541);
  assert.deepEqual(saved, { path: "Clippings/録音_2026年08月09日05時21分.md", appended: true });
  assert.equal(created.length, 0);
  assert.match(written[0].content, /五時台の最初の録音。/);
  assert.match(written[0].content, /四十一分の追加録音。/);
});

test("creates new file when existing file is a different hour (04時 vs 05時)", async () => {
  const existing = new Map<string, string>([
    ["Clippings/録音_2026年08月09日04時41分.md", "old"],
    ["Clippings", ""],
  ]);
  const written: { path: string; content: string }[] = [];
  const created: string[] = [];
  const app = { vault: makeHourMockVault(existing, written, created) } as any;
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "Clippings", appendRecordEnabled: true };

  const saved = await saveTranscriptToFile(app, settings, "別時間の録音。", 30, AT_0541);
  assert.deepEqual(saved, { path: "Clippings/録音_2026年08月09日05時41分.md", appended: false });
  assert.equal(created.length, 1);
  assert.equal(written.length, 0);
});

test("appends into the earliest file when multiple same-hour files exist", async () => {
  const existing = new Map<string, string>([
    ["Clippings/録音_2026年08月09日05時41分.md", "later"],
    ["Clippings/録音_2026年08月09日05時21分.md", "earlier"],
    ["Clippings", ""],
  ]);
  const written: { path: string; content: string }[] = [];
  const created: string[] = [];
  const app = { vault: makeHourMockVault(existing, written, created) } as any;
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "Clippings", appendRecordEnabled: true };

  const saved = await saveTranscriptToFile(app, settings, "三番目の録音。", 30, new Date(2026, 7, 9, 5, 55));
  assert.deepEqual(saved, { path: "Clippings/録音_2026年08月09日05時21分.md", appended: true });
});
