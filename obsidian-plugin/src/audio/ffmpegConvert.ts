import { FFmpeg } from "@ffmpeg/ffmpeg";
import type { AudioFileLike } from "../commands/transcribeFile";
import { isWav, splitWavByBytes } from "./chunker";

let ffmpeg: FFmpeg | null = null;

function getFfmpeg(): FFmpeg {
  if (!ffmpeg) ffmpeg = new FFmpeg();
  return ffmpeg;
}

export async function convertToWav16kMono(file: AudioFileLike): Promise<ArrayBuffer> {
  const ff = getFfmpeg();
  const inputName = `input-${Date.now()}.${file.name.toLowerCase().split(".").pop() ?? "audio"}`;
  const outputName = `output-${Date.now()}.wav`;

  try {
    // esbuildは .wasm を自動配置しないため、ffmpegConvert.mts の esbuild pluginで
    // main.js と同じディレクトリへコピーしたローカル資産を参照する。
    const coreURL = new URL("./ffmpeg-core.js", import.meta.url).href;
    const wasmURL = new URL("./ffmpeg-core.wasm", import.meta.url).href;
    if (!ff.loaded) await ff.load({ coreURL, wasmURL });

    await ff.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    await ff.exec([
      "-i", inputName,
      "-acodec", "pcm_s16le",
      "-ac", "1",
      "-ar", "16000",
      outputName,
    ]);

    const data = await ff.readFile(outputName);
    if (data instanceof Uint8Array) return data.slice().buffer;
    return new TextEncoder().encode(data as string).buffer;
  } catch (err: any) {
    throw new Error(`FFmpeg conversion failed: ${err?.message ?? String(err)}`, { cause: err });
  } finally {
    await Promise.allSettled([ff.deleteFile(inputName), ff.deleteFile(outputName)]);
  }
}

export function splitWavByMaxSize(wav: ArrayBuffer, maxBytes: number): ArrayBuffer[] {
  if (!isWav(wav)) throw new Error("input is not a valid WAV file");
  if (!Number.isFinite(maxBytes) || maxBytes <= 44) throw new Error("maxBytes must be greater than 44");
  // buildWav() adds a 44-byte header to each PCM payload, so keep payload below the limit.
  return splitWavByBytes(wav, Math.floor(maxBytes) - 44);
}

export async function prepareChunksForStt(
  file: AudioFileLike,
  maxChunkBytes: number = 20 * 1024 * 1024,
  converter: (file: AudioFileLike) => Promise<ArrayBuffer> = convertToWav16kMono
): Promise<ArrayBuffer[]> {
  const buf = await file.arrayBuffer();
  if (isWav(buf) && buf.byteLength <= maxChunkBytes) return [buf];
  if (isWav(buf)) return splitWavByMaxSize(buf, maxChunkBytes);

  const wav = await converter(file);
  return splitWavByMaxSize(wav, maxChunkBytes);
}
