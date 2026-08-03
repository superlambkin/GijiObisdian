import test from "node:test";
import assert from "node:assert/strict";
import { renderMinutes, appendSegmentNote } from "../notes/generator";

test("renderMinutes fills template vars", () => {
  const md = renderMinutes({
    date: "2026-08-03",
    summary: "讨论 POC 方向",
    decisions: "- [ ] 决定A",
    actions: "- [ ] MiuMiu: 写原型",
    discussion: "- 要点1",
    transcript: "> 全文…",
  });
  assert.match(md, /2026-08-03/);
  assert.match(md, /讨论 POC 方向/);
  assert.match(md, /决定A/);
});

test("appendSegmentNote appends timestamped block", () => {
  const out = appendSegmentNote("# note\n", "00:00-01:20", "关于 POC 的讨论");
  assert.match(out, /## \[00:00-01:20\]/);
  assert.match(out, /> 关于 POC 的讨论/);
});
