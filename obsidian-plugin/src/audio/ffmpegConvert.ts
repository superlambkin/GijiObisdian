import { FFmpeg } from "@ffmpeg/ffmpeg";
import type { AudioFileLike } from "../commands/transcribeFile";
import { isWav, splitWavByBytes } from "./chunker";
import { debug as logDebug, info as logInfo, error as logError } from "../debug/logRecorder";
import { getPluginApp } from "./pluginContext";

let ffmpeg: FFmpeg | null = null;

function getFfmpeg(): FFmpeg {
  if (!ffmpeg) ffmpeg = new FFmpeg();
  return ffmpeg;
}

interface FFmpegAssetURLs {
  workerURL: string;
  coreURL: string;
  wasmURL: string;
}

let assetURLs: FFmpegAssetURLs | null = null;

/**
 * FFmpeg 関連アセット（worker.js / ffmpeg-core.js / ffmpeg-core.wasm）を
 * Obsidian の app.vault.adapter.read で読み込み、Blob URL 化する。
 *
 * 理由: Obsidian の main world（app://obsidian.md）から file:// URL の Worker を
 *       起動できないため、すべて Blob URL に統一して同一オリジンで動作させる。
 */
async function loadFFmpegAssetURLs(): Promise<FFmpegAssetURLs> {
  if (assetURLs) return assetURLs;
  const app = getPluginApp();
  if (!app) {
    throw new Error("plugin context not initialized (App reference missing)");
  }
  const adapter = app.vault.adapter;
  const pluginId = "GijiObsidian";
  const base = `.obsidian/plugins/${pluginId}`;
  const [workerCode, coreCode, wasmBuffer] = await Promise.all([
    adapter.read(`${base}/worker.js`),
    adapter.read(`${base}/ffmpeg-core.js`),
    adapter.readBinary(`${base}/ffmpeg-core.wasm`),
  ]);
  logDebug("ffmpegConvert", "asset bytes loaded", {
    workerBytes: workerCode.length,
    coreBytes: coreCode.length,
    wasmBytes: (wasmBuffer as ArrayBuffer).byteLength,
  });
  const workerURL = URL.createObjectURL(
    new Blob([workerCode], { type: "text/javascript" })
  );
  const coreURL = URL.createObjectURL(
    new Blob([coreCode], { type: "text/javascript" })
  );
  const wasmURL = URL.createObjectURL(
    new Blob([wasmBuffer as ArrayBuffer], { type: "application/wasm" })
  );
  assetURLs = { workerURL, coreURL, wasmURL };
  logInfo("ffmpegConvert", "asset Blob URLs created", { workerURL, coreURL, wasmURL });
  return assetURLs;
}

/**
 * FFmpeg インスタンスを取得し、未ロードならアセット Blob URL を設定して load() する。
 * ロード済みインスタンスは再利用する（directRecorder の wasm ffmpeg ラッパーと
 * convertToWav16kMono が同一インスタンスを共有し、競合・再初期化しない）。
 */
export async function ensureFfmpegLoaded(): Promise<FFmpeg> {
  const ff = getFfmpeg();
  if (!ff.loaded) {
    const { workerURL, coreURL, wasmURL } = await loadFFmpegAssetURLs();
    await ff.load({ classWorkerURL: workerURL, coreURL, wasmURL });
  }
  return ff;
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
    // Obsidian のセキュリティ制約により file:// URL の Worker は使えないため、
    // plugin 内の 3 ファイルを Blob URL 化して同一オリジンで起動する。
    const { workerURL, coreURL, wasmURL } = await loadFFmpegAssetURLs();

    if (!ff.loaded) {
      logInfo("ffmpegConvert", "ffmpeg.load starting", { coreURL, wasmURL });
      // classWorkerURL を Blob URL として渡すことで、FFmpeg ライブラリの Worker 解決を
      // file:// → blob: に切替え、CSP 制約を回避する。
      await ff.load({
        classWorkerURL: workerURL,
        coreURL,
        wasmURL,
      });
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
