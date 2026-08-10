import test from "node:test";
import assert from "node:assert/strict";
import {
  formatStartTime,
  fillMinutesMetadata,
  setFrontmatterField,
  getFrontmatterField,
  enforceFrontmatterDates,
} from "../notes/minutesMetadata";

const TPL = [
  "| 🔢 議事録番号 |  |",
  "| 🕐 開始時間 | YYYY-MM-DD HH:MM |",
  "| ⏱️ 会議時間 | X 分 Y 秒 |",
  "| 🎙️ 録音ファイル | [[録音ファイル名]] |",
  "| テーマ |  |",
].join("\n");

const START = new Date(2026, 7, 9, 13, 51); // 2026-08-09 13:51

test("formatStartTime formats YYYY-MM-DD HH:MM", () => {
  assert.equal(formatStartTime(START), "2026-08-09 13:51");
});

test("fillMinutesMetadata replaces 開始時間/会議時間/録音ファイル", () => {
  const out = fillMinutesMetadata(TPL, {
    startTime: START,
    durationSec: 83,
    mp3Links: "[🎙️ 録音を再生](file:///C:/a.mp3)",
  });
  assert.match(out, /\| 🕐 開始時間 \| 2026-08-09 13:51 \|/);
  assert.match(out, /\| ⏱️ 会議時間 \| 1 分 23 秒 \|/);
  assert.match(out, /\| 🎙️ 録音ファイル \| \[🎙️ 録音を再生\]/);
});

test("fillMinutesMetadata inserts 録音ファイル row when missing", () => {
  const withoutAudio = [
    "| 🔢 議事録番号 |  |",
    "| 🕐 開始時間 | YYYY-MM-DD HH:MM |",
    "| ⏱️ 会議時間 | X 分 Y 秒 |",
    "| テーマ |  |",
  ].join("\n");
  const out = fillMinutesMetadata(withoutAudio, {
    startTime: START,
    durationSec: 5,
    mp3Links: "LINK",
  });
  assert.match(out, /\| 🎙️ 録音ファイル \| LINK \|/);
});

test("fillMinutesMetadata records 文字起こし時間/要約時間", () => {
  const out = fillMinutesMetadata(TPL, {
    startTime: START,
    durationSec: 83,
    sttMs: 20300,
    summarizeMs: 45000,
  });
  assert.match(out, /\| ⏱️ 文字起こし時間 \| 20\.3 秒 \|/);
  assert.match(out, /\| ⏱️ 要約時間 \| 45 秒 \|/);
});

test("fillMinutesMetadata inserts 文字起こし時間/要約時間 rows and shows — when unknown", () => {
  const withoutRows = [
    "| 🔢 議事録番号 |  |",
    "| 🕐 開始時間 | YYYY-MM-DD HH:MM |",
    "| ⏱️ 会議時間 | X 分 Y 秒 |",
    "| テーマ |  |",
  ].join("\n");
  const out = fillMinutesMetadata(withoutRows, { startTime: START, durationSec: 5 });
  assert.match(out, /\| ⏱️ 文字起こし時間 \| — \|/);
  assert.match(out, /\| ⏱️ 要約時間 \| — \|/);
});

test("fillMinutesMetadata leaves rows intact when table missing", () => {
  const noTable = "# 議事録\n本文のみ";
  const out = fillMinutesMetadata(noTable, { startTime: START });
  assert.equal(out, "# 議事録\n本文のみ");
});

test("setFrontmatterField: 既存行を置換", () => {
  const md = "---\ntitle: \"x\"\ncreated: 2026-04-26\n---\n\n本文";
  const out = setFrontmatterField(md, "created", "2026-08-09");
  assert.match(out, /created: 2026-08-09/);
  assert.ok(!out.includes("2026-04-26"));
});

test("setFrontmatterField: 無ければ frontmatter 末尾に追加", () => {
  const md = "---\ntitle: \"x\"\n---\n\n本文";
  const out = setFrontmatterField(md, "議事録番号", "20260809-2214");
  assert.match(out, /議事録番号: 20260809-2214\n---/);
});

test("setFrontmatterField: frontmatter 自体が無ければ先頭に作成", () => {
  const out = setFrontmatterField("本文のみ", "modified", "2026-08-09 23:00");
  assert.ok(out.startsWith("---\nmodified: 2026-08-09 23:00\n---\n"));
});

test("getFrontmatterField: 値取得・空・未存在", () => {
  const md = "---\n議事録番号: 20260809-2214\ncreated: \n---\n";
  assert.equal(getFrontmatterField(md, "議事録番号"), "20260809-2214");
  assert.equal(getFrontmatterField(md, "created"), undefined);
  assert.equal(getFrontmatterField(md, "modified"), undefined);
});

test("enforceFrontmatterDates: created/modified を実値で強制", () => {
  const md = "---\ncreated: 2026-04-26\nmodified: 2026-04-26 00:00\n---\n\n本文";
  const out = enforceFrontmatterDates(md, new Date(2026, 7, 9, 22, 14), new Date(2026, 7, 9, 23, 30));
  assert.match(out, /created: 2026-08-09/);
  assert.match(out, /modified: 2026-08-09 23:30/);
});
