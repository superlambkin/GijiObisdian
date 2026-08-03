import test from "node:test";
import assert from "node:assert/strict";
import { parseMinutesSections } from "../commands/importAudio";

const sample = `SUMMARY: 本次会议讨论 POC 方向。
DECISIONS:
- [ ] 决定A
ACTIONS:
- [ ] MiuMiu: 写原型
DISCUSSION:
- 要点1
- 要点2`;

test("parseMinutesSections splits 4 sections", () => {
  const s = parseMinutesSections(sample);
  assert.match(s.summary, /POC 方向/);
  assert.match(s.decisions, /决定A/);
  assert.match(s.actions, /MiuMiu/);
  assert.match(s.discussion, /要点2/);
});

test("parseMinutesSections only matches labels at line start", () => {
  const tricky = `SUMMARY: 摘要里提到 SUMMARY: 不应被截断
DECISIONS:
- 决定
ACTIONS:
- 行动
DISCUSSION:
- 讨论`;
  const s = parseMinutesSections(tricky);
  assert.equal(s.summary, "摘要里提到 SUMMARY: 不应被截断");
  assert.match(s.decisions, /决定/);
  assert.match(s.actions, /行动/);
  assert.match(s.discussion, /讨论/);
});

test("keepTranscript blockquotes each paragraph", () => {
  const transcript = "第一段。\n\n第二段。\n\n第三段。";
  const formatted = transcript.split("\n\n").map((p) => `> ${p}`).join("\n\n");
  assert.equal(formatted, "> 第一段。\n\n> 第二段。\n\n> 第三段。");
});
