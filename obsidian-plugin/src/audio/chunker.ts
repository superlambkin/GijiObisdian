const HEADER_LEN = 44;

/** OpenAI Whisper の 25MB 制限に対し、24MB 以上は分割して文字起こしする */
export const MAX_TRANSCRIPTION_BYTES = 24_000_000;

function readHeader(view: DataView) {
  return {
    sampleRate: view.getUint32(24, true),
    dataOffset: HEADER_LEN,
    dataLength: view.getUint32(40, true),
  };
}

/** WAV ヘッダ情報を読み取る（Google STT 等で PCM 抽出に使用） */
export function readWavHeader(wav: ArrayBuffer) {
  return readHeader(new DataView(wav));
}

/** RIFF/WAVE マジックで WAV かどうか判定する（拡張子に依存しない） */
export function isWav(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const b = new Uint8Array(buf);
  return (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45   // "WAVE"
  );
}

function buildWav(headerBytes: Uint8Array, pcm: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(HEADER_LEN + pcm.length);
  out.set(headerBytes.slice(0, HEADER_LEN), 0);
  out.set(pcm, HEADER_LEN);
  const v = new DataView(out.buffer);
  v.setUint32(4, 36 + pcm.length, true); // RIFF size
  v.setUint32(40, pcm.length, true);      // data size
  return out.buffer;
}

/** WAV をデータ部 maxBytes 以内のチャンクに分割する（各チャンクはヘッダ付き WAV） */
export function splitWavByBytes(wav: ArrayBuffer, maxBytes: number): ArrayBuffer[] {
  const view = new DataView(wav);
  const { dataOffset, dataLength } = readHeader(view);
  const bytes = new Uint8Array(wav);
  const header = bytes.slice(0, dataOffset);
  const pcm = bytes.slice(dataOffset, dataOffset + dataLength);

  if (pcm.length <= maxBytes) return [wav];

  const chunks: ArrayBuffer[] = [];
  // PCM16 のサンプル境界を守るため偶数に揃える
  const step = Math.max(2, Math.floor(maxBytes / 2) * 2);
  for (let off = 0; off < pcm.length; off += step) {
    const slice = pcm.slice(off, Math.min(off + step, pcm.length));
    chunks.push(buildWav(header, slice));
  }
  return chunks;
}

export function splitWavBySeconds(wav: ArrayBuffer, maxSeconds: number): ArrayBuffer[] {
  const { sampleRate } = readHeader(new DataView(wav));
  const bytesPerSec = sampleRate * 2; // PCM16 mono
  return splitWavByBytes(wav, Math.max(1, Math.floor(maxSeconds) * bytesPerSec));
}

/* ---------------- MP3（フレーム同期でサイズ分割） ---------------- */

/** [from, before) の範囲で最後の MP3 フレーム同期位置を返す（無ければ -1） */
function lastMp3SyncBefore(bytes: Uint8Array, from: number, before: number): number {
  let last = -1;
  const end = Math.min(before, bytes.length - 1);
  for (let i = Math.max(0, from); i < end; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) last = i;
  }
  return last;
}

/** (before, limit] の範囲で最初の MP3 フレーム同期位置を返す（無ければ -1） */
function firstMp3SyncAfter(bytes: Uint8Array, before: number, limit: number): number {
  const end = Math.min(limit, bytes.length - 1);
  for (let i = Math.max(0, before); i < end; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) return i;
  }
  return -1;
}

/**
 * MP3 をフレーム同期境界で maxBytes 以内に分割する。
 * 同期点が見つからない場合は分割せず残りをそのまま返す（API 側のエラーで明示される）。
 */
export function splitMp3BySize(buf: ArrayBuffer, maxBytes: number): ArrayBuffer[] {
  if (buf.byteLength <= maxBytes) return [buf];
  const bytes = new Uint8Array(buf);
  const chunks: ArrayBuffer[] = [];
  let start = 0;
  while (start < bytes.length) {
    const target = start + maxBytes;
    if (target >= bytes.length) {
      chunks.push(bytes.slice(start).buffer);
      break;
    }
    // target 以下の最後の同期点で切る（最大 64KB 遡る）
    let end = lastMp3SyncBefore(bytes, Math.max(start + 1, target - 65536), target + 1);
    if (end <= start) {
      // 見つからなければ target 以降の最初の同期点（次フレームの先頭で切る）
      const next = firstMp3SyncAfter(bytes, target + 1, target + 65536);
      if (next === -1) {
        chunks.push(bytes.slice(start).buffer);
        break;
      }
      end = next;
    }
    chunks.push(bytes.slice(start, end).buffer);
    start = end;
  }
  return chunks;
}

/** 音声をフォーマットに応じて maxBytes 以内に分割する（WAV / MP3 両対応） */
export function splitAudioBySize(buf: ArrayBuffer, maxBytes: number): ArrayBuffer[] {
  if (buf.byteLength <= maxBytes) return [buf];
  if (isWav(buf)) return splitWavByBytes(buf, maxBytes);
  return splitMp3BySize(buf, maxBytes);
}

/**
 * STT プロバイダーの制約に応じて音声を分割する。
 * - WAV: maxChunkSec（Google 等の秒数制限）→ 無ければ maxBytes でバイト分割
 * - MP3 等: maxBytes でフレーム同期分割
 */
export function splitForTranscription(
  buf: ArrayBuffer,
  provider: { maxChunkSec?: number; maxBytesPerRequest?: number }
): ArrayBuffer[] {
  const maxBytes = provider.maxBytesPerRequest ?? MAX_TRANSCRIPTION_BYTES;
  if (isWav(buf)) {
    if (provider.maxChunkSec) return splitWavBySeconds(buf, provider.maxChunkSec);
    return splitWavByBytes(buf, maxBytes);
  }
  return splitAudioBySize(buf, maxBytes);
}
