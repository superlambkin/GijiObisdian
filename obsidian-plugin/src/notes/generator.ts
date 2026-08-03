export interface MinutesVars {
  date: string;
  summary: string;
  decisions: string;
  actions: string;
  discussion: string;
  transcript: string;
}

const DEFAULT_TEMPLATE = `---
title: "{{date}} 会议纪要"
type: meeting-minutes
date: {{date}}
tags:
  - 会议
  - 纪要
source: 语音转写
---

# 📋 {{date}} 会议纪要

## ✨ 摘要
> {{summary}}

## ✅ 决定事项
{{decisions}}

## 📌 行动项
{{actions}}

## 💬 讨论要点
{{discussion}}

## 📝 转写记录
{{transcript}}

---
#语音记录 #会议纪要
`;

export function renderMinutes(vars: MinutesVars, template: string = DEFAULT_TEMPLATE): string {
  return template
    .replaceAll("{{date}}", vars.date)
    .replaceAll("{{summary}}", vars.summary)
    .replaceAll("{{decisions}}", vars.decisions)
    .replaceAll("{{actions}}", vars.actions)
    .replaceAll("{{discussion}}", vars.discussion)
    .replaceAll("{{transcript}}", vars.transcript);
}

export function appendSegmentNote(prev: string, time: string, text: string): string {
  const block = `\n## [${time}]\n> ${text}\n`;
  return prev.endsWith("\n") ? prev + block : prev + "\n" + block;
}

export const MINUTES_SYSTEM_PROMPT = `你是会议纪要助手。把会议转写文本整理为结构化纪要，输出 4 个部分，标题严格如下：
SUMMARY: 2-3 句摘要
DECISIONS: 决定事项（markdown 复选框列表）
ACTIONS: 行动项（markdown 复选框，含责任人）
DISCUSSION: 讨论要点（bullet 列表）
只输出这 4 段，不要额外说明。`;
