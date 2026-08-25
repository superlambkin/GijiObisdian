import { existsSync } from "fs";
import { join } from "path";
import type { WhisperModelId } from "./settings";
import { WHISPER_MODELS } from "./settings";

export type ModelDlStatus = "not-downloaded" | "downloading" | "downloaded" | "error";

// 実行時状態（永続化しない・プラグイン再起動時にリセット）
const modelStatus: Record<WhisperModelId, ModelDlStatus> = {
  tiny: "not-downloaded",
  small: "not-downloaded",
  medium: "not-downloaded",
};

export function getModelStatus(model: WhisperModelId): ModelDlStatus {
  return modelStatus[model];
}

export function setModelStatus(model: WhisperModelId, status: ModelDlStatus): void {
  modelStatus[model] = status;
}

/**
 * HuggingFace cache 配下の marker ディレクトリ存在チェック。
 * faster-whisper は Systran/faster-whisper-{model} を
 * <modelDir>/models--Systran--faster-whisper-{model}/ にキャッシュする。
 */
export function checkModelExists(model: WhisperModelId, modelDir: string): boolean {
  const repoName = WHISPER_MODELS[model].repo.replace(/\//g, "--");
  const markerDir = join(modelDir, `models--${repoName}`);
  return existsSync(markerDir);
}

/**
 * Whisper モデルを DL する（Python サーバの `/download/{repo}` エンドポイントを叩く）。
 * - onProgress は 0-100 の整数パーセントで進捗を報告する（content-length が取得できる場合のみ）
 * - DL 中は status を "downloading"、完了で "downloaded"、失敗で "error" に更新する
 */
export async function downloadWhisperModel(
  model: WhisperModelId,
  baseUrl: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  setModelStatus(model, "downloading");
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/download/${WHISPER_MODELS[model].repo}`, {
      method: "POST",
    });
    if (!res.ok) {
      throw new Error(`モデル DL に失敗しました（HTTP ${res.status}）`);
    }
    const contentLength = Number(res.headers.get("content-length") ?? 0);
    if (!res.body) {
      setModelStatus(model, "downloaded");
      return;
    }
    const reader = res.body.getReader();
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (onProgress && contentLength > 0) {
        onProgress(Math.min(100, Math.round((received / contentLength) * 100)));
      }
    }
    setModelStatus(model, "downloaded");
  } catch (e) {
    setModelStatus(model, "error");
    throw e;
  }
}
