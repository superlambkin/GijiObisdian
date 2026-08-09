/** Windows絶対パス → file:/// URL（セグメント単位でエンコード） */
export function toFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((seg, i) => {
      // ドライブレター（例: C:）はエンコードせず `file:///C:/...` を維持する
      if (i === 0 && /^[A-Za-z]:$/.test(seg)) return seg;
      return encodeURIComponent(seg);
    })
    .join("/");
  return `file:///${encoded}`;
}

/** 録音ファイルのMarkdownリンク（複数セグメントは「録音1」「録音2」） */
export function buildMp3Links(audioPaths: string[]): string {
  if (audioPaths.length === 0) return "";
  return audioPaths
    .map((p, i) =>
      audioPaths.length > 1
        ? `[🎙️ 録音${i + 1}を再生](${toFileUrl(p)})`
        : `[🎙️ 録音を再生](${toFileUrl(p)})`
    )
    .join("・");
}
