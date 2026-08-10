import test from "node:test";
import assert from "node:assert/strict";
import { RECORDING_STYLES_CSS } from "../ui/recordingStyles";

test("RECORDING_STYLES_CSS は .giji-recording を赤色点滅させる", () => {
  assert.match(RECORDING_STYLES_CSS, /\.giji-record-btn\.giji-recording/);
  assert.match(RECORDING_STYLES_CSS, /color:\s*#e33/);
  assert.match(RECORDING_STYLES_CSS, /@keyframes giji-blink/);
  assert.match(RECORDING_STYLES_CSS, /animation:/);
});

test("RECORDING_STYLES_CSS は .giji-stt-down（サーバ未起動警告・赤背景）を持つ", () => {
  assert.match(RECORDING_STYLES_CSS, /\.giji-record-btn\.giji-stt-down/);
  assert.match(RECORDING_STYLES_CSS, /background:\s*#e33/);
});
