import test from "node:test";
import assert from "node:assert/strict";
import { formatStartTime, fillMinutesMetadata } from "../notes/minutesMetadata";

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

test("fillMinutesMetadata leaves rows intact when table missing", () => {
  const noTable = "# 議事録\n本文のみ";
  const out = fillMinutesMetadata(noTable, { startTime: START });
  assert.equal(out, "# 議事録\n本文のみ");
});
