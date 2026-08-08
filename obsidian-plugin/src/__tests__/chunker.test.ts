import test from "node:test";
import assert from "node:assert/strict";
import {
  isWav,
  splitForTranscription,
  splitMp3BySize,
  splitWavByBytes,
  splitWavBySeconds,
} from "../audio/chunker";

// Build a minimal 16kHz mono PCM16 WAV of `seconds` length.
function makeWav(seconds: number, rate = 16000): ArrayBuffer {
  const dataLen = rate * seconds * 2;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => s.split("").forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);          // block align
  view.setUint16(34, 16, true);         // bits
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);
  return buffer;
}

test("splits 25min wav into 3 chunks of 10min", () => {
  const chunks = splitWavBySeconds(makeWav(25 * 60), 600);
  assert.equal(chunks.length, 3);
});

test("does not split short wav", () => {
  const chunks = splitWavBySeconds(makeWav(120), 600);
  assert.equal(chunks.length, 1);
});

test("each chunk is a valid wav with data", () => {
  const chunks = splitWavBySeconds(makeWav(25 * 60), 600);
  for (const c of chunks) {
    const v = new DataView(c);
    assert.equal(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), "RIFF");
  }
});

/* ---------------- MP3 / サイズ分割（24MB ルール） ---------------- */

/** 同期ヘッダ付きダミー MP3 フレーム列を生成する（64kbps CBR 相当の 576B フレーム） */
function makeMp3(frames: number, frameLen = 576): ArrayBuffer {
  const buf = new Uint8Array(frames * frameLen);
  for (let f = 0; f < frames; f++) {
    buf[f * frameLen] = 0xff;
    buf[f * frameLen + 1] = 0xf3; // 同期 + MPEG2
  }
  return buf.buffer;
}

test("isWav detects RIFF/WAVE magic", () => {
  assert.equal(isWav(makeWav(1)), true);
  assert.equal(isWav(makeMp3(1)), false);
  assert.equal(isWav(new ArrayBuffer(4)), false);
});

test("splitWavByBytes splits oversized wav into header-carrying chunks", () => {
  const chunks = splitWavByBytes(makeWav(10), 100_000); // 10s = 320,000B → 4 chunks
  assert.equal(chunks.length, 4);
  for (const c of chunks) assert.ok(isWav(c));
});

test("splitMp3BySize splits at frame sync boundaries", () => {
  const frameLen = 576;
  const chunks = splitMp3BySize(makeMp3(10, frameLen), frameLen * 3);
  assert.equal(chunks.length, 4); // 3+3+3+1 フレーム
  for (const c of chunks) {
    assert.ok(c.byteLength <= frameLen * 3, "各チャンクは maxBytes 以内");
    assert.equal(new Uint8Array(c)[0], 0xff, "先頭はフレーム同期");
  }
});

test("splitMp3BySize returns remainder when no sync found (API 側で明示エラー)", () => {
  const chunks = splitMp3BySize(new Uint8Array(3000).buffer, 1000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].byteLength, 3000);
});

test("splitForTranscription: wav with maxChunkSec splits by seconds", () => {
  const chunks = splitForTranscription(makeWav(120), { maxChunkSec: 55 });
  assert.equal(chunks.length, 3); // 55 + 55 + 10
});

test("splitForTranscription: wav under 24MB is not split", () => {
  const chunks = splitForTranscription(makeWav(10), {});
  assert.equal(chunks.length, 1);
});

test("splitForTranscription: wav over maxBytes splits by bytes", () => {
  const chunks = splitForTranscription(makeWav(10), { maxBytesPerRequest: 100_000 });
  assert.equal(chunks.length, 4);
});

test("splitForTranscription: mp3 splits by provider maxBytes at syncs", () => {
  const chunks = splitForTranscription(makeMp3(10), { maxBytesPerRequest: 576 * 2 });
  assert.ok(chunks.length >= 5);
});
