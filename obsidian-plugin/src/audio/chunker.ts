const HEADER_LEN = 44;

/** OpenAI Whisper の 25MB 制限に対し、24MB 以上は分割して文字起こしする */
export const MAX_TRANSCRIPTION_BYTES = 24_000_000;

/**
 * WAV の RIFF チャンク構造を線形スキャンし、sampleRate / data チャンクの
 * offset/length を取得する。
 *
 * 標準 PCM WAV は RIFF/WAVE/fmt /data の順で 44 バイトだが、FFmpeg や
 * 他のエンコーダは LIST / INFO / JUNK 等のメタデータチャンクを fmt と
 * data の間に挟む場合がある。その場合でも "data" タグを線形検索して
 * 正しく分割できるよう、本実装ではチャンク単位のパースを行う。
 */
function readHeader(view: DataView) {
  const bytes = new Uint8Array(view.buffer);
  // RIFF シグネチャ確認
  if (
    bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45
  ) {
    throw new Error("not a RIFF/WAVE file");
  }

  // fmt チャンクを探して sampleRate を取得
  let sampleRate = 0;
  let dataOffset = 0;
  let dataLength = 0;
  let foundFmt = false;
  let foundData = false;

  // RIFF の先頭 12 バイトを飛ばし、残りをチャンクとして走査
  let cursor = 12;
  while (cursor + 8 <= view.byteLength) {
    const tag = String.fromCharCode(
      bytes[cursor],
      bytes[cursor + 1],
      bytes[cursor + 2],
      bytes[cursor + 3]
    );
    const size = view.getUint32(cursor + 4, true);
    const valueOffset = cursor + 8;
    if (tag === "fmt ") {
      // sample rate は fmt チャンクの先頭 +4..+7 (LE) にある
      if (size >= 8) sampleRate = view.getUint32(valueOffset + 4, true);
      foundFmt = true;
    } else if (tag === "data") {
      dataOffset = valueOffset;
      dataLength = size;
      foundData = true;
      break; // data が先頭にあるとは限らないので最初に見つかった data を使う
    }
    // チャンクはワード境界に揃えられる（奇数サイズなら +1 パディング）
    cursor = valueOffset + size + (size % 2);
  }

  // フォールバック: 旧形式（44 バイト決め打ち）の互換性維持。
  // ※ テストや旧エンコーダが fmt/data タグを書かない最小 WAV を出力する場合のため。
  if (!foundFmt && sampleRate === 0) {
    sampleRate = view.getUint32(24, true);
  }
  if (!foundData) {
    dataOffset = HEADER_LEN;
    dataLength = view.getUint32(40, true);
  }

  return { sampleRate, dataOffset, dataLength };
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

function buildWav(headerBytes: Uint8Array, pcm: Uint8Array, dataOffset: number): ArrayBuffer {
  // 分割後の WAV は data チャンク単一のシンプルな構造に再構築する。
  // 元のヘッダ（fmt 等のサブチャンク）は破棄し、新しい 44 バイト標準ヘッダで置き換える。
  const out = new Uint8Array(HEADER_LEN + pcm.length);
  // RIFF マジック
  out[0] = 0x52; out[1] = 0x49; out[2] = 0x46; out[3] = 0x46;
  // RIFF サイズ（LE）
  const v = new DataView(out.buffer);
  v.setUint32(4, 36 + pcm.length, true);
  // WAVE マジック
  out[8] = 0x57; out[9] = 0x41; out[10] = 0x56; out[11] = 0x45;
  // fmt チャンク
  out[12] = 0x66; out[13] = 0x6d; out[14] = 0x74; out[15] = 0x20; // "fmt "
  v.setUint32(16, 16, true);  // fmt chunk size
  v.setUint16(20, 1, true);   // audio format = PCM
  // channels/sample rate/byte rate/block align/bits per sample は元ヘッダからコピー
  out.set(headerBytes.slice(20, 36), 20);
  // data チャンク
  out[36] = 0x64; out[37] = 0x61; out[38] = 0x74; out[39] = 0x61; // "data"
  v.setUint32(40, pcm.length, true);
  // PCM データ
  out.set(pcm, HEADER_LEN);
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
    chunks.push(buildWav(header, slice, dataOffset));
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
