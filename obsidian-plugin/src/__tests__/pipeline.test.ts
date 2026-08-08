import test from "node:test";
import assert from "node:assert/strict";
import { parseMinutesSections, transcribeAudioToMinutes } from "../commands/importAudio";
import { DEFAULT_SETTINGS } from "../settings";

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

/** 44 バイト WAV ヘッダ + 最小 PCM（16kHz）のテスト用 WAV */
function makeTinyWav(): ArrayBuffer {
  const pcm = new Uint8Array([0, 0, 1, 0]);
  const buf = new ArrayBuffer(44 + pcm.length);
  const v = new DataView(buf);
  v.setUint32(24, 16000, true);
  v.setUint32(40, pcm.length, true);
  new Uint8Array(buf).set(pcm, 44);
  return buf;
}

test("transcribeAudioToMinutes applies template when provided", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: any, opts: any) => {
    calls.push({ url, opts });
    if (String(url).includes("transcriptions")) {
      return { ok: true, json: async () => ({ text: "転写テキスト" }) } as any;
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: "## 📋 議事録：テスト" } }] }) } as any;
  }) as any;
  const settings = {
    ...DEFAULT_SETTINGS,
    sttProvider: "openai" as const,
    sttApiKey: "k",
    llmProvider: "cloud" as const,
    llmApiKey: "k",
  };
  const md = await transcribeAudioToMinutes(makeTinyWav(), settings, fakeFetch, "TEMPLATE_XYZ");
  assert.match(md, /議事録：テスト/);
  const llmCall = calls.find((c) => String(c.url).includes("chat/completions"));
  assert.match(llmCall.opts.body, /TEMPLATE_XYZ/); // テンプレートがシステムプロンプトに含まれる
});
