import { App } from "obsidian";
import { GijiSettings } from "../settings";

const pad = (n: number) => n.toString().padStart(2, "0");

/** 生成转写文件名，如 `转写 2026-08-04 06-30-15`（秒级，冲突由调用方加后缀） */
export function buildTranscriptFilename(now: Date): string {
  const d = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `转写 ${d} ${t}`;
}

/** 组装转写 MD 文档内容（frontmatter + 标题 + 时间 + 正文） */
export function renderTranscriptNote(title: string, now: Date, text: string): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return [
    "---",
    `title: "${title}"`,
    "type: voice-transcript",
    `date: ${date}`,
    "tags:",
    "  - 转写",
    "---",
    "",
    `# 🎙️ ${title}`,
    "",
    `> 🕐 ${date} ${time}`,
    "",
    text,
    "",
  ].join("\n");
}

/**
 * 把转写文本保存为 MD 文档到 `settings.transcriptSaveDir`（Vault 内路径）。
 * 返回保存的文件路径（相对 Vault），失败抛异常由调用方提示。
 */
export async function saveTranscriptToFile(
  app: App,
  settings: GijiSettings,
  text: string,
  now: Date = new Date()
): Promise<string> {
  const dir = (settings.transcriptSaveDir || "").trim().replace(/^\/+|\/+$/g, "") || "Clippings";
  const vault = app.vault as any;

  // 确保目录存在
  const dirExists = await vault.adapter.exists(dir);
  if (!dirExists) {
    await vault.createFolder(dir);
  }

  // 秒级文件名冲突时追加 -2, -3 …
  let filename = buildTranscriptFilename(now);
  let path = `${dir}/${filename}.md`;
  let counter = 2;
  while (await vault.adapter.exists(path)) {
    path = `${dir}/${filename}-${counter}.md`;
    counter++;
  }

  const content = renderTranscriptNote(buildTranscriptFilename(now), now, text);
  await vault.create(path, content);
  return path;
}
