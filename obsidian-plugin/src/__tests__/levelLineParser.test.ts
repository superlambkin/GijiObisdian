import test from "node:test";
import assert from "node:assert/strict";
import { LevelLineParser } from "../audio/directRecorder";

test("1 行のレベル JSON を onLevel に通知する", () => {
  const got: unknown[] = [];
  const p = new LevelLineParser((l) => got.push(l));
  p.push('{"type": "level", "rms": 0.05, "peak": 0.12}\n');
  assert.deepEqual(got, [{ rms: 0.05, peak: 0.12 }]);
});

test("行がチャンク境界で分断されても正しくパースする", () => {
  const got: unknown[] = [];
  const p = new LevelLineParser((l) => got.push(l));
  p.push('{"type": "level", "r');
  p.push('ms": 0.1, "peak": 0.2}\n{"type": "le');
  p.push('vel", "rms": 0.3, "peak": 0.4}\n');
  assert.deepEqual(got, [
    { rms: 0.1, peak: 0.2 },
    { rms: 0.3, peak: 0.4 },
  ]);
});

test("複数行を 1 チャンクで受けても全行通知する", () => {
  const got: unknown[] = [];
  const p = new LevelLineParser((l) => got.push(l));
  p.push('{"type":"level","rms":0.1,"peak":0.1}\n{"type":"level","rms":0.2,"peak":0.2}\n');
  assert.equal(got.length, 2);
});

test("不正 JSON・type 相違・数値欠落の行は無視する", () => {
  const got: unknown[] = [];
  const p = new LevelLineParser((l) => got.push(l));
  p.push("not json\n");
  p.push('{"foo": 1}\n');
  p.push('{"type":"level","rms":"x","peak":0.1}\n');
  p.push('{"type":"level","rms":0.5}\n');
  assert.deepEqual(got, []);
});

test("非レベル行は onOther に渡る（診断ログ用）", () => {
  const got: unknown[] = [];
  const others: string[] = [];
  const p = new LevelLineParser((l) => got.push(l), (line) => others.push(line));
  p.push("PC_LOOPBACK_TRACE: hello\n");
  p.push('{"type":"level","rms":0.1,"peak":0.1}\n');
  assert.equal(others.length, 1);
  assert.equal(got.length, 1);
});

test("空行・空白のみの行は無視する", () => {
  const got: unknown[] = [];
  const others: string[] = [];
  const p = new LevelLineParser((l) => got.push(l), (l) => others.push(l));
  p.push("\n   \n");
  assert.deepEqual(got, []);
  assert.deepEqual(others, []);
});

test("異常膨張ガード: 改行のない巨大チャンクでバッファ先頭を破棄する", () => {
  const got: unknown[] = [];
  const p = new LevelLineParser((l) => got.push(l));
  // 70KB の改行なし garbage → バッファは 4096 文字に丸められる
  p.push("x".repeat(70 * 1024));
  // 直後に正常行を流してもパースできる（バッファが壊れていない）
  p.push('{"type":"level","rms":0.1,"peak":0.1}\n');
  assert.deepEqual(got, [{ rms: 0.1, peak: 0.1 }]);
});

import { buildLoopbackArgs } from "../audio/directRecorder";

test("buildLoopbackArgs: ID + monitor + name を正しい順で組み立てる", () => {
  const args = buildLoopbackArgs("C:/p/script.py", "C:/t/out.wav", "dev123", true, "スピーカー (SMSL M400)");
  assert.deepEqual(args, ["C:/p/script.py", "C:/t/out.wav", "dev123", "--monitor", "--name", "スピーカー (SMSL M400)"]);
});

test("buildLoopbackArgs: 従来形（ID のみ・monitor なし）は互換", () => {
  const args = buildLoopbackArgs("C:/p/script.py", "C:/t/out.wav", "", false, "");
  assert.deepEqual(args, ["C:/p/script.py", "C:/t/out.wav"]);
});

test("buildLoopbackArgs: default は ID として渡さない", () => {
  const args = buildLoopbackArgs("C:/p/script.py", "C:/t/out.wav", "default", false, "");
  assert.deepEqual(args, ["C:/p/script.py", "C:/t/out.wav"]);
});
