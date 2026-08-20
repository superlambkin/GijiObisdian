import { FFmpeg } from "@ffmpeg/ffmpeg";
import type { AudioFileLike } from "../commands/transcribeFile";
import { isWav, splitWavByBytes } from "./chunker";
import { debug as logDebug, info as logInfo, error as logError } from "../debug/logRecorder";

let ffmpeg: FFmpeg | null = null;

function getFfmpeg(): FFmpeg {
  if (!ffmpeg) ffmpeg = new FFmpeg();
  return ffmpeg;
}

export async function convertToWav16kMono(file: AudioFileLike): Promise<ArrayBuffer> {
  const ff = getFfmpeg();
  const ext = file.name.toLowerCase().split(".").pop() ?? "audio";
  const inputName = `input-${Date.now()}.${ext}`;
  const outputName = `output-${Date.now()}.wav`;
  const fileSize = (() => {
    try {
      return file.size;
    } catch {
      return undefined;
    }
  })();
  logInfo("ffmpegConvert", "convertToWav16kMono start", {
    file: file.name,
    type: file.type,
    lastModified: file.lastModified,
    size: fileSize,
    ext,
  });

  try {
    // esbuild は .wasm を自動配置しないため、ffmpegConvert.mts の esbuild pluginで
    // main.js と同じディレクトリへコピーしたローカル資産を参照する。
    // さらに esbuild の CJS 出力は import.meta.url を空オブジェクトにするため、
    // esbuild.config.mjs の post-build patch でランタイム URL に置換済み。
    const coreURL = new URL("./ffmpeg-core.js", import.meta.url).href;
    const wasmURL = new URL("./ffmpeg-core.wasm", import.meta.url).href;
    logDebug("ffmpegConvert", "URLs resolved", { coreURL, wasmURL, importMetaUrl: import.meta.url });

    if (!ff.loaded) {
      logInfo("ffmpegConvert", "ffmpeg.load starting", { coreURL, wasmURL });
      await ff.load({ coreURL, wasmURL });
      logInfo("ffmpegConvert", "ffmpeg.load completed");
    } else {
      logDebug("ffmpegConvert", "ffmpeg already loaded, skipping load");
    }

    const inputBytes = await file.arrayBuffer();
    logDebug("ffmpegConvert", "writeFile input", { bytes: inputBytes.byteLength, inputName });
    await ff.writeFile(inputName, new Uint8Array(inputBytes));

    logInfo("ffmpegConvert", "exec starting", {
      args: ["-i", inputName, "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000", outputName],
    });
    await ff.exec([
      "-i", inputName,
      "-acodec", "pcm_s16le",
      "-ac", "1",
      "-ar", "16000",
      outputName,
    ]);
    logInfo("ffmpegConvert", "exec completed");

    const data = await ff.readFile(outputName);
    logDebug("ffmpegConvert", "readFile output", {
      type: data instanceof Uint8Array ? "Uint8Array" : typeof data,
      bytes: data instanceof Uint8Array ? data.byteLength : (data as string)?.length,
    });
    if (data instanceof Uint8Array) return data.slice().buffer;
    return new TextEncoder().encode(data as string).buffer;
  } catch (err: any) {
    logError("ffmpegConvert", "FFmpeg conversion failed", err, {
      file: file.name,
      ffLoaded: ff.loaded,
    });
    throw new Error(`FFmpeg conversion failed: ${err?.message ?? String(err)}`, { cause: err });
  } finally {
    try {
      await Promise.allSettled([ff.deleteFile(inputName), ff.deleteFile(outputName)]);
    } catch (cleanupErr: any) {
      logError("ffmpegConvert", "cleanup failed", cleanupErr);
    }
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
  logDebug("prepareChunksForStt", "input checked", {
    file: file.name,
    bytes: buf.byteLength,
    maxChunkBytes,
    isWav: isWav(buf),
  });
  if (isWav(buf) && buf.byteLength <= maxChunkBytes) {
    logInfo("prepareChunksForStt", "WAV under limit, skipping conversion", { chunks: 1 });
    return [buf];
  }
  if (isWav(buf)) {
    const chunks = splitWavByMaxSize(buf, maxChunkBytes);
    logInfo("prepareChunksForStt", "WAV split", { chunks: chunks.length });
    return chunks;
  }

  logInfo("prepareChunksForStt", "calling converter", { file: file.name });
  const wav = await converter(file);
  const chunks = splitWavByMaxSize(wav, maxChunkBytes);
  logInfo("prepareChunksForStt", "converted and split", { chunks: chunks.length });
  return chunks;
}
