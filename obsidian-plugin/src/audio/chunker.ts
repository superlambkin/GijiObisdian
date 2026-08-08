const HEADER_LEN = 44;

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

function buildWav(headerBytes: Uint8Array, pcm: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(HEADER_LEN + pcm.length);
  out.set(headerBytes.slice(0, HEADER_LEN), 0);
  out.set(pcm, HEADER_LEN);
  const v = new DataView(out.buffer);
  v.setUint32(4, 36 + pcm.length, true); // RIFF size
  v.setUint32(40, pcm.length, true);      // data size
  return out.buffer;
}

export function splitWavBySeconds(wav: ArrayBuffer, maxSeconds: number): ArrayBuffer[] {
  const view = new DataView(wav);
  const { sampleRate, dataOffset, dataLength } = readHeader(view);
  const bytes = new Uint8Array(wav);
  const header = bytes.slice(0, dataOffset);
  const pcm = bytes.slice(dataOffset, dataOffset + dataLength);

  const bytesPerSec = sampleRate * 2; // PCM16 mono
  const maxBytes = Math.max(1, Math.floor(maxSeconds) * bytesPerSec);

  if (pcm.length <= maxBytes) return [wav];

  const chunks: ArrayBuffer[] = [];
  for (let off = 0; off < pcm.length; off += maxBytes) {
    const slice = pcm.slice(off, Math.min(off + maxBytes, pcm.length));
    chunks.push(buildWav(header, slice));
  }
  return chunks;
}
