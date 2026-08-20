import { AudioFileLike } from "../commands/transcribeFile";

export type AudioFormat = "wav" | "mp3" | "m4a";

export interface AudioValidationResult {
  ok: boolean;
  format?: AudioFormat;
  error?: string;
}

export async function validateAudioFile(file: AudioFileLike): Promise<AudioValidationResult> {
  // 1. 拡張子チェック
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const allowed = ["wav", "mp3", "m4a"] as const;
  if (!allowed.includes(ext as (typeof allowed)[number])) {
    return { ok: false, error: `unsupported extension: .${ext}` };
  }

  // 2. MIMEタイプチェック（File.type が空の場合は拡張子・シグネチャ検証へ進む）
  const allowedMimeTypes: Record<AudioFormat, readonly string[]> = {
    wav: ["audio/wav", "audio/x-wav"],
    mp3: ["audio/mpeg", "audio/mp3"],
    m4a: ["audio/mp4", "audio/x-m4a"],
  };
  if (file.type && !allowedMimeTypes[ext].includes(file.type.toLowerCase())) {
    return { ok: false, error: `unsupported MIME type: ${file.type}` };
  }

  // 3. サイズチェック
  const buf = await file.arrayBuffer();
  if (buf.byteLength === 0) {
    return { ok: false, error: "empty or zero-byte file" };
  }

  const view = new Uint8Array(buf.slice(0, Math.min(buf.byteLength, 64)));

  // 3. シグネチャチェック
  switch (ext) {
    case "wav":
      if (isWavSignature(view)) return { ok: true, format: "wav" };
      return { ok: false, error: "invalid WAV signature" };

    case "mp3":
      if (isMp3Signature(view)) return { ok: true, format: "mp3" };
      return { ok: false, error: "invalid MP3 signature" };

    case "m4a":
      if (isM4aSignature(view)) return { ok: true, format: "m4a" };
      return { ok: false, error: "invalid M4A signature" };

    default:
      return { ok: false, error: `unknown format: .${ext}` };
  }
}

function isWavSignature(view: Uint8Array): boolean {
  if (view.length < 12) return false;
  return (
    view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46 && // "RIFF"
    view[8] === 0x57 && view[9] === 0x41 && view[10] === 0x56 && view[11] === 0x45   // "WAVE"
  );
}

function isMp3Signature(view: Uint8Array): boolean {
  if (view.length < 3) return false;
  // ID3v2 タグ
  if (view[0] === 0x49 && view[1] === 0x44 && view[2] === 0x33) return true; // "ID3"
  // MPEG フレーム同期
  if (view[0] === 0xFF && (view[1] & 0xE0) === 0xE0) return true;
  return false;
}

function isM4aSignature(view: Uint8Array): boolean {
  if (view.length < 8) return false;
  // ISO Base Media File Format の ftyp ボックス
  // 先頭 4 バイトがサイズ、次の 4 バイトが "ftyp"
  const size = (view[0] << 24) | (view[1] << 16) | (view[2] << 8) | view[3];
  const ftyp = String.fromCharCode(view[4], view[5], view[6], view[7]);
  return size > 0 && ftyp === "ftyp";
}
