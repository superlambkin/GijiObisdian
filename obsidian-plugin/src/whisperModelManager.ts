import { existsSync } from "fs";
import { join } from "path";
import type { WhisperModelId } from "./settings";
import { WHISPER_MODELS } from "./settings";
import { nodeFetch } from "./providers/nodeFetch";

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
 * Whisper モデルを DL する（Python サーバの `/v1/download/{repo}` エンドポイントを叩く）。
 * サーバ側で DL が完了してから JSON を返すため、進捗 % は出せない（不確定表示）。
 * DL 中は status を "downloading"、完了で "downloaded"、失敗で "error" に更新する。
 */
export async function downloadWhisperModel(
  model: WhisperModelId,
  baseUrl: string,
  fetchImpl: typeof fetch = nodeFetch,
): Promise<void> {
  setModelStatus(model, "downloading");
  try {
    // 空 / 相対 URL だと相対 fetch になり Obsidian 側で黙って失敗するため、先に明確なエラーにする
    if (!/^https?:\/\//.test(baseUrl)) {
      throw new Error(
        "STT Base URL が未設定です。設定タブの『ローカル Whisper サーバ URL』を確認してください",
      );
    }
    const apiBase = baseUrl.replace(/\/v1\/?$/, "") + "/v1";
    const res = await fetchImpl(`${apiBase}/download/${WHISPER_MODELS[model].repo}`, {
      method: "POST",
    });
    if (!res.ok) {
      throw new Error(`モデル DL に失敗しました（HTTP ${res.status}）`);
    }
    await res.json();
    setModelStatus(model, "downloaded");
  } catch (e) {
    setModelStatus(model, "error");
    throw e;
  }
}
