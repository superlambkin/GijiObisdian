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
