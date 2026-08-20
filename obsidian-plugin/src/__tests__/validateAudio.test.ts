import test from "node:test";
import assert from "node:assert/strict";
import { validateAudioFile, AudioFormat } from "../audio/validateAudio";
import { AudioFileLike } from "../commands/transcribeFile";

function makeFile(overrides: Partial<AudioFileLike> = {}): AudioFileLike {
  return {
    name: "test.mp3",
    lastModified: Date.now(),
    arrayBuffer: async () => new ArrayBuffer(100),
    ...overrides,
  };
}

test("validateAudioFile accepts .mp3 with MPEG signature", async () => {
  const file = makeFile({
    name: "test.mp3",
    arrayBuffer: async () => {
      const buf = new ArrayBuffer(16);
      const view = new Uint8Array(buf);
      view[0] = 0xFF; view[1] = 0xFB; // MPEG frame sync
      return buf;
    },
  });
  const result = await validateAudioFile(file);
  assert.equal(result.ok, true);
  assert.equal(result.format, "mp3");
});

test("validateAudioFile accepts .m4a with ftyp signature", async () => {
  const file = makeFile({
    name: "test.m4a",
    arrayBuffer: async () => {
      const buf = new ArrayBuffer(32);
      const view = new Uint8Array(buf);
      const view32 = new DataView(buf);
      view32.setUint32(0, buf.byteLength, false);
      // MP4 ftyp box
      view[4] = 0x66; view[5] = 0x74; view[6] = 0x79; view[7] = 0x70; // "ftyp"
      return buf;
    },
  });
  const result = await validateAudioFile(file);
  assert.equal(result.ok, true);
  assert.equal(result.format, "m4a");
});

test("validateAudioFile accepts .wav with RIFF/WAVE signature", async () => {
  const file = makeFile({
    name: "test.wav",
    arrayBuffer: async () => {
      const buf = new ArrayBuffer(44);
      const view = new Uint8Array(buf);
      // RIFF
      view[0] = 0x52; view[1] = 0x49; view[2] = 0x46; view[3] = 0x46;
      // WAVE at offset 8
      view[8] = 0x57; view[9] = 0x41; view[10] = 0x56; view[11] = 0x45;
      return buf;
    },
  });
  const result = await validateAudioFile(file);
  assert.equal(result.ok, true);
  assert.equal(result.format, "wav");
});

test("validateAudioFile rejects unsupported extension", async () => {
  const file = makeFile({ name: "test.flac" });
  const result = await validateAudioFile(file);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /unsupported extension/);
});

test("validateAudioFile rejects mismatched MIME type when File.type is provided", async () => {
  const file = makeFile({ name: "test.m4a", type: "audio/mpeg" });
  const result = await validateAudioFile(file);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /MIME/);
});

test("validateAudioFile rejects zero-byte file", async () => {
  const file = makeFile({
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  const result = await validateAudioFile(file);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /empty|zero-byte/i);
});

test("validateAudioFile rejects signature mismatch", async () => {
  const file = makeFile({
    name: "test.mp3",
    arrayBuffer: async () => {
      const buf = new ArrayBuffer(16);
      const view = new Uint8Array(buf);
      view[0] = 0x00; view[1] = 0x00; // not MPEG
      return buf;
    },
  });
  const result = await validateAudioFile(file);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /signature/i);
});
