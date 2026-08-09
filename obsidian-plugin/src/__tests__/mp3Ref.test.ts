import test from "node:test";
import assert from "node:assert/strict";
import { toFileUrl, buildMp3Links } from "../notes/mp3Ref";

test("toFileUrl converts Windows path with backslashes", () => {
  assert.equal(
    toFileUrl("C:\\Users\\taro\\Music\\GijiObsidian\\録音_2026年08月09日13時51分30秒.mp3"),
    "file:///C:/Users/taro/Music/GijiObsidian/%E9%8C%B2%E9%9F%B3_2026%E5%B9%B408%E6%9C%8809%E6%97%A513%E6%99%8251%E5%88%8630%E7%A7%92.mp3"
  );
});

test("toFileUrl encodes spaces as %20", () => {
  assert.equal(toFileUrl("C:/My Music/a b.mp3"), "file:///C:/My%20Music/a%20b.mp3");
});

test("buildMp3Links returns empty string for empty list", () => {
  assert.equal(buildMp3Links([]), "");
});

test("buildMp3Links joins single segment with 再生 link", () => {
  const out = buildMp3Links(["C:/rec/録音_2026年08月09日13時51分30秒.mp3"]);
  assert.match(out, /^\[🎙️ 録音を再生\]\(file:\/\/\/C:\/rec\/%E9%8C%B2%E9%9F%B3_/);
  assert.equal(out.includes("・"), false);
});

test("buildMp3Links numbers multi segments", () => {
  const out = buildMp3Links(["C:/a.mp3", "C:/b.mp3"]);
  assert.match(out, /録音1を再生/);
  assert.match(out, /録音2を再生/);
  assert.ok(out.includes("・"));
});
