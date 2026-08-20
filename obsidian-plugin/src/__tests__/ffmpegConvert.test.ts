import test from "node:test";
import assert from "node:assert/strict";
import { prepareChunksForStt, splitWavByMaxSize } from "../audio/ffmpegConvert";
import { AudioFileLike } from "../commands/transcribeFile";

function wavWithDataLength(dataLength: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  bytes[0] = 0x52; bytes[1] = 0x49; bytes[2] = 0x46; bytes[3] = 0x46;
  bytes[8] = 0x57; bytes[9] = 0x41; bytes[10] = 0x56; bytes[11] = 0x45;
  view.setUint32(4, 36 + dataLength, true);
  view.setUint32(40, dataLength, true);
  return buf;
}

function fileOf(buf: ArrayBuffer, name = "audio.m4a"): AudioFileLike {
  return { name, lastModified: 0, arrayBuffer: async () => buf };
}

test("splitWavByMaxSize keeps every chunk under the requested byte limit", () => {
  const wav = wavWithDataLength(2048);
  const chunks = splitWavByMaxSize(wav, 512);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.byteLength <= 512));
});

test("prepareChunksForStt sends a small WAV without conversion", async () => {
  const wav = wavWithDataLength(100);
  const chunks = await prepareChunksForStt(fileOf(wav, "audio.wav"), 512, async () => {
    throw new Error("converter should not be called");
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].byteLength, wav.byteLength);
});

test("prepareChunksForStt converts MP4 through injected converter and chunks it", async () => {
  const m4a = new ArrayBuffer(32);
  const view = new DataView(m4a);
  const bytes = new Uint8Array(m4a);
  bytes[4] = 0x66; bytes[5] = 0x74; bytes[6] = 0x79; bytes[7] = 0x70;
  view.setUint32(0, 32, false);
  const wav = wavWithDataLength(2048);
  const chunks = await prepareChunksForStt(fileOf(m4a), 512, async () => wav);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.byteLength <= 512));
});
