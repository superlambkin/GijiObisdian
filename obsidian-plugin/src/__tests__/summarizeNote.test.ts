import test from "node:test";
import assert from "node:assert/strict";
import {
  isTranscriptNote,
  extractTranscript,
  extractRecordingMeta,
  resolveMinutesPath,
  summarizeFromNote,
} from "../commands/summarizeNote";
import { DEFAULT_SETTINGS } from "../settings";

const SAMPLE_NOTE = `---
title: "録音_2026年08月09日22時14分"
type: voice-transcript
---

# 🎙️ 録音_2026年08月09日22時14分

> 📂 パス：議事録/録音_2026年08月09日22時14分.md

録音の概要（文字数・会議時間・録音日時）は以下の通り。

| 項目 | 値 |
|------|------|
| 📝 文字数 | 3433 字 |
| ⏱️ 会議時間 | 10 分 2 秒 |
| 🕐 録音日時 | 2026-08-09 22:14 |
| 🎙️ 録音ファイル | [🎙️ 録音を再生](file:///C:/a.mp3) |

## 📝 転写本文

金閣寺の解説テキストです

---

## 📝 更新記録

| バージョン | 日付 |
|------|------|
`;

const settings = {
  ...DEFAULT_SETTINGS,
  outputDir: "議事録",
  llmProvider: "cloud" as const,
  llmBaseUrl: "https://api.example.com/v1",
  llmModel: "test-model",
  llmApiKey: "test-key",
};

test("isTranscriptNote: frontmatter type で判定", () => {
  const app: any = { metadataCache: { getFileCache: () => ({ frontmatter: { type: "voice-transcript" } }) } };
  assert.equal(isTranscriptNote(app, { extension: "md", basename: "雑記" } as any), true);
});

test("isTranscriptNote: 録音_ 接頭辞で判定 / 非 md は false", () => {
  const app: any = { metadataCache: { getFileCache: () => null } };
  assert.equal(isTranscriptNote(app, { extension: "md", basename: "録音_X" } as any), true);
  assert.equal(isTranscriptNote(app, { extension: "md", basename: "議事録_X" } as any), false);
  assert.equal(isTranscriptNote(app, { extension: "wav", basename: "録音_X" } as any), false);
});

test("extractTranscript: 転写本文のみ抽出（表・更新記録を含まない）", () => {
  const t = extractTranscript(SAMPLE_NOTE);
  assert.match(t, /金閣寺の解説テキストです/);
  assert.ok(!t.includes("文字数"));
  assert.ok(!t.includes("更新記録"));
});

test("extractTranscript: 追加録音セクションも結合", () => {
  const md = SAMPLE_NOTE + `\n## 🕐 追加録音（2026-08-09 23:00）\n\n追加録音の概要（文字数・会議時間）は以下の通り。\n\n| 項目 | 値 |\n|------|------|\n\n追録の本文\n`;
  const t = extractTranscript(md);
  assert.match(t, /金閣寺の解説テキストです/);
  assert.match(t, /追録の本文/);
  assert.ok(!t.includes("追加録音の概要"));
});

test("extractTranscript: マーカー無しは frontmatter 除去後の全文", () => {
  const t = extractTranscript("---\ntype: x\n---\n\nただの本文");
  assert.equal(t, "ただの本文");
});

// H1: stripFrontmatter 正規表現ドリフト＋空 body 副作用の回帰テスト
test("extractTranscript: 標準空 frontmatter (\"---\\n---\\n\") が剥がされる", () => {
  // ファイル先頭の空 frontmatter は剥がして、本文だけ取り出すこと
  const t = extractTranscript("---\n---\n本文テキスト");
  assert.equal(t, "本文テキスト");
});

test("extractTranscript: ファイル途中（先頭でない位置）の \"---\\n---\\n\" は剥がされない", () => {
  // 本文中の "---\n---\n" は水平線/マーカーであり frontmatter ではない
  // → 誤って剥がすと本文が消失するため、剥がされないことを検証する（false positive 防止）
  const md = "前置き本文\n---\n---\n後置き本文";
  const t = extractTranscript(md);
  assert.match(t, /前置き本文/);
  assert.match(t, /後置き本文/);
});

test("extractRecordingMeta: 概要表から日時・時間・mp3 を解析", () => {
  const meta = extractRecordingMeta(SAMPLE_NOTE, { basename: "録音_2026年08月09日22時14分" });
  assert.equal(meta.startTime?.getHours(), 22);
  assert.equal(meta.startTime?.getMinutes(), 14);
  assert.equal(meta.durationSec, 602);
  assert.match(meta.mp3Links ?? "", /録音を再生/);
});

test("extractRecordingMeta: 表が無ければファイル名から日時を解析", () => {
  const meta = extractRecordingMeta("---\n---\n本文", { basename: "録音_2026年01月02日03時04分" });
  assert.equal(meta.startTime?.getFullYear(), 2026);
  assert.equal(meta.startTime?.getMonth(), 0);
  assert.equal(meta.durationSec, undefined);
});

function makeFakeApp(over: {
  files?: Record<string, string>;
  minutesExists?: boolean;
}): any {
  const files = over.files ?? {};
  return {
    metadataCache: { getFileCache: () => ({ frontmatter: { type: "voice-transcript" } }) },
    vault: {
      adapter: {
        async exists(p: string) {
          if (p === "00_Vault管理/議事録テンプレート.md") return false; // テンプレ無し扱い
          return p in files;
        },
        async read(p: string) {
          if (!(p in files)) throw new Error(`not found: ${p}`);
          return files[p];
        },
        async list(_dir: string) {
          return { files: Object.keys(files), folders: [] };
        },
        async write(p: string, c: string) {
          files[p] = c;
        },
      },
      async exists(p: string) { return p in files; },
      async create(p: string, c: string) { files[p] = c; },
    },
    __files: files,
  };
}

const TRANSCRIPT_PATH = "議事録/録音_2026年08月09日22時14分.md";
const MINUTES_PATH = "議事録/議事録_2026年08月09日22時14分.md";
const fakeFile: any = {
  path: TRANSCRIPT_PATH,
  basename: "録音_2026年08月09日22時14分",
  extension: "md",
};

test("resolveMinutesPath: 命名規則で一致", async () => {
  const app = makeFakeApp({ files: { [MINUTES_PATH]: "旧議事録" } });
  const r = await resolveMinutesPath(app, settings, fakeFile);
  assert.deepEqual(r, { path: MINUTES_PATH, exists: true });
});

test("resolveMinutesPath: 命名不一致でも 原文リンク で検出", async () => {
  const renamed = "議事録/議事録_金閣寺解説.md";
  const app = makeFakeApp({
    files: { [renamed]: "---\n---\n> 🎙️ 原文：[[録音_2026年08月09日22時14分]]\n本文" },
  });
  const r = await resolveMinutesPath(app, settings, fakeFile);
  assert.deepEqual(r, { path: renamed, exists: true });
});

test("resolveMinutesPath: どちらも無ければ新規パス", async () => {
  const app = makeFakeApp({ files: {} });
  const r = await resolveMinutesPath(app, settings, fakeFile);
  assert.deepEqual(r, { path: MINUTES_PATH, exists: false });
});

function makeFetchImpl(): any {
  return (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "新しい議事録" } }] }),
  }));
}

function makeFakeTimer(): any {
  const stages: string[] = [];
  return {
    stages,
    summarizing: false,
    isSummarizing() { return this.summarizing; },
    setSummarizing() { this.summarizing = true; },
    stop() { this.summarizing = false; },
    // generating は複数回発火し得るため、連続する同一ステージは1回だけ記録する
    updateSummarizeStage(s: string) {
      if (stages[stages.length - 1] !== s) stages.push(s);
    },
  };
}

test("summarizeFromNote: 既存あり＋キャンセル → 書き込み無し", async () => {
  const app = makeFakeApp({
    files: { [TRANSCRIPT_PATH]: SAMPLE_NOTE, [MINUTES_PATH]: "旧議事録" },
  });
  await summarizeFromNote(app, settings, "/m", fakeFile, makeFakeTimer(), {
    confirm: async () => false,
    fetchImpl: makeFetchImpl(),
  });
  assert.equal(app.__files[MINUTES_PATH], "旧議事録");
});

test("summarizeFromNote: 上書き OK → overwritePath に保存＋番号引継ぎ", async () => {
  const OLD = "---\n議事録番号: 20260809-2214\ncreated: 2026-08-09\n---\n旧";
  const app = makeFakeApp({
    files: { [TRANSCRIPT_PATH]: SAMPLE_NOTE, [MINUTES_PATH]: OLD },
  });
  const timer = makeFakeTimer();
  await summarizeFromNote(app, settings, "/m", fakeFile, timer, {
    confirm: async () => true,
    fetchImpl: makeFetchImpl(),
  });
  const out = app.__files[MINUTES_PATH];
  assert.match(out, /新しい議事録/);
  assert.match(out, /議事録番号: 20260809-2214/);
  assert.match(out, /created: 2026-08-09/);
  assert.deepEqual(timer.stages, ["connecting", "generating", "saving"]);
  assert.equal(timer.isSummarizing(), false); // finally で停止
});

test("summarizeFromNote: 転写が空なら中断", async () => {
  const app = makeFakeApp({ files: { [TRANSCRIPT_PATH]: "---\n---\n" } });
  await summarizeFromNote(app, settings, "/m", fakeFile, makeFakeTimer(), {
    confirm: async () => { throw new Error("confirm は呼ばれないはず"); },
    fetchImpl: makeFetchImpl(),
  });
  assert.equal(Object.keys(app.__files).length, 1); // 新規ファイル無し
});

test("summarizeFromNote: 要約中は二重実行を拒否", async () => {
  const app = makeFakeApp({ files: { [TRANSCRIPT_PATH]: SAMPLE_NOTE } });
  const timer = makeFakeTimer();
  timer.summarizing = true;
  await summarizeFromNote(app, settings, "/m", fakeFile, timer, { fetchImpl: makeFetchImpl() });
  assert.equal(Object.keys(app.__files).length, 1); // 何も生成されない
});
