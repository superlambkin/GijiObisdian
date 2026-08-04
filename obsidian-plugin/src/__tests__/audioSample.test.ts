import test from "node:test";
import assert from "node:assert/strict";
import { TEST_AUDIO_BASE64, decodeTestAudio } from "../test/audioSample";

test("TEST_AUDIO_BASE64 is non-trivial", () => {
  assert.ok(TEST_AUDIO_BASE64.length > 1000);
});

test("decodeTestAudio returns a WAV ArrayBuffer", () => {
  const buf = decodeTestAudio();
  assert.ok(buf instanceof ArrayBuffer);
  assert.ok(buf.byteLength > 44); // RIFF header + payload
  const bytes = new Uint8Array(buf);
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), "RIFF");
  assert.equal(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]), "WAVE");
});
