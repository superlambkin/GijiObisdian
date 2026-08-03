import test from "node:test";
import assert from "node:assert/strict";
import { splitWavBySeconds } from "../audio/chunker";

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
