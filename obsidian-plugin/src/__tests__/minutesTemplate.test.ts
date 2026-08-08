import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClaudianMinutesPrompt,
  buildTemplateSystemPrompt,
  ensureTemplatesDir,
  extractTemplateBody,
  loadMinutesTemplate,
  DEFAULT_TEMPLATE_FILE_NAME,
} from "../notes/minutesTemplate";
import { DEFAULT_SETTINGS } from "../settings";

/* ---------------- フェンス抽出 ---------------- */

test("extractTemplateBody extracts ```markdown fence content", () => {
  const doc = "# 説明書き\n\n```markdown\n---\ntitle: x\n---\n\n## 概要\n```\n\n## 別セクション\n";
  assert.equal(extractTemplateBody(doc), "---\ntitle: x\n---\n\n## 概要");
});

test("extractTemplateBody returns whole content when no fence", () => {
  assert.equal(extractTemplateBody("## 概要\nテスト"), "## 概要\nテスト");
});

/* ---------------- テンプレートフォルダ初期化・読み込み ---------------- */

function mockApp(files: Map<string, string>) {
  return {
    vault: {
      adapter: {
        exists: async (p: string) => files.has(p),
        read: async (p: string) => files.get(p) ?? "",
        write: async (p: string, c: string) => void files.set(p, c),
        mkdir: async (p: string) => void files.set(`${p}/`, ""),
      },
    },
  } as any;
}

test("ensureTemplatesDir creates dir + default template, and does not overwrite", async () => {
  const files = new Map<string, string>();
  const app = mockApp(files);
  const dir = ".obsidian/plugins/giji-obsidian";
  await ensureTemplatesDir(app, dir);
  const defPath = `${dir}/templates/${DEFAULT_TEMPLATE_FILE_NAME}`;
  assert.ok(files.has(defPath), "デフォルトテンプレートが格納されること");
  const before = files.get(defPath);
  await ensureTemplatesDir(app, dir); // 2 回目: 既存ファイルを上書きしない
  assert.equal(files.get(defPath), before);
});

test("loadMinutesTemplate reads vault path and extracts fence", async () => {
  const files = new Map([
    ["00_Vault管理/議事録テンプレート.md", "# doc\n```markdown\nTEMPLATE_BODY\n```\n"],
  ]);
  const app = mockApp(files);
  const out = await loadMinutesTemplate(app, { ...DEFAULT_SETTINGS }, "any");
  assert.equal(out, "TEMPLATE_BODY");
});

test("loadMinutesTemplate reads directory file when source=directory", async () => {
  const files = new Map([["plug/templates/議事録テンプレート.md", "DIR_TEMPLATE"]]);
  const app = mockApp(files);
  const out = await loadMinutesTemplate(
    app,
    { ...DEFAULT_SETTINGS, minutesTemplateSource: "directory" as const },
    "plug"
  );
  assert.equal(out, "DIR_TEMPLATE");
});

test("loadMinutesTemplate throws explicitly when missing", async () => {
  const app = mockApp(new Map());
  await assert.rejects(() => loadMinutesTemplate(app, { ...DEFAULT_SETTINGS }, "x"), /見つかりません/);
});

/* ---------------- プロンプト組み立て ---------------- */

test("buildClaudianMinutesPrompt embeds template, transcript and save path", () => {
  const p = buildClaudianMinutesPrompt("TPL", "転写テキストです", "Clippings", "2026-08-09");
  assert.match(p, /TPL/);
  assert.match(p, /転写テキストです/);
  assert.match(p, /Clippings\/議事録_<テーマ>_2026-08-09\.md/);
  assert.match(p, /空欄/);
});

test("buildTemplateSystemPrompt embeds template", () => {
  const p = buildTemplateSystemPrompt("TPL");
  assert.match(p, /TPL/);
  assert.match(p, /空欄/);
});
