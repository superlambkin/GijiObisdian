"""Whisper ローカルサーバ（OpenAI 互換）

環境変数:
- WHISPER_MODEL: "whisper-tiny" / "whisper-small" / "whisper-medium"（デフォルト: whisper-small）
- WHISPER_HOST: バインドアドレス（デフォルト: 127.0.0.1）
- WHISPER_PORT: ポート番号（デフォルト: 9000）
- WHISPER_COMPUTE_TYPE: "int8" / "float16" / "float32"（デフォルト: int8）
- WHISPER_DOWNLOAD_ROOT: モデル保存先（デフォルト: なし → HuggingFace 既定キャッシュ）
"""
import os
import logging
import tempfile
import threading
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel
from huggingface_hub import snapshot_download

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# 設定
MODEL_ID = os.getenv("WHISPER_MODEL", "whisper-small")
HOST = os.getenv("WHISPER_HOST", "127.0.0.1")
PORT = int(os.getenv("WHISPER_PORT", "9000"))
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
DOWNLOAD_ROOT = os.getenv("WHISPER_DOWNLOAD_ROOT") or None  # 空文字は None 扱い

# Systran マッピング（faster-whisper 用 HF リポジトリ名）
HF_REPO_MAP = {
    "whisper-tiny": "Systran/faster-whisper-tiny",
    "whisper-small": "Systran/faster-whisper-small",
    "whisper-medium": "Systran/faster-whisper-medium",
}
HF_REPO = HF_REPO_MAP.get(MODEL_ID, MODEL_ID)

# モデル（遅延ロード。起動時にはロードしない → 未 DL でもサーバは起動できる）
model: Optional[WhisperModel] = None
_loaded_repo: Optional[str] = None
_model_lock = threading.Lock()


def get_model(repo: Optional[str] = None) -> WhisperModel:
    """モデルを遅延ロード。repo（Systran/...）指定時はそのリポジトリへ切替ロード。"""
    global model, _loaded_repo
    target = repo or HF_REPO
    with _model_lock:
        if model is not None and _loaded_repo == target:
            return model
        logger.info(f"Loading model: {target} (compute_type={COMPUTE_TYPE}, download_root={DOWNLOAD_ROOT})")
        loaded = WhisperModel(
            target,
            device="cpu",
            compute_type=COMPUTE_TYPE,
            download_root=DOWNLOAD_ROOT,
        )
        model = loaded
        _loaded_repo = target
        logger.info(f"Model loaded: {target}")
        return model


# TS 側は言語名（Chinese/Japanese/English）を送る → コードへ正規化
LANG_MAP = {"Chinese": "zh", "Japanese": "ja", "English": "en"}


def _normalize_lang(language: Optional[str]) -> Optional[str]:
    if not language or language == "auto":
        return None
    return LANG_MAP.get(language, language)


app = FastAPI(title="GijiObsidian Whisper Server")

# Obsidian レンダラーの fetch は CORS を強制されるため、ローカルサーバ側で許可する。
# （STT の multipart FormData 送信はレンダラー fetch が必須）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """ヘルスチェック（サーバ起動確認用。モデル未ロードでも 200 を返す）"""
    return JSONResponse({
        "status": "ok",
        "model": _loaded_repo or MODEL_ID,  # 実際にロード中のモデル
        "ready": model is not None,
    })


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: bytes = File(...),
    model: str = Form(default=MODEL_ID),
    language: Optional[str] = Form(default=None),
):
    """OpenAI 互換転写エンドポイント。model フォーム（whisper-tiny/small/medium）で切替可能。"""
    repo = HF_REPO_MAP.get(model, model) if model else HF_REPO
    try:
        m = get_model(repo)
    except Exception as e:
        logger.error(f"Model load failed: {e}")
        raise HTTPException(status_code=500, detail=f"モデルをロードできませんでした: {e}")

    # 一時ファイル保存（faster-whisper はファイルパスが必要）
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(file)
        tmp_path = tmp.name

    try:
        segments, info = m.transcribe(
            tmp_path,
            language=_normalize_lang(language),
            beam_size=5,
            vad_filter=True,
        )
        text = " ".join(seg.text.strip() for seg in segments)
        return JSONResponse({"text": text})
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


@app.post("/download/{repo_id:path}")
@app.post("/v1/download/{repo_id:path}")
async def download_model(repo_id: str):
    """モデル DL（事前キャッシュ用）。/v1 プレフィックス付きでも受ける（TS 側 URL 互換）"""
    try:
        logger.info(f"Downloading model: {repo_id}")
        snapshot_download(
            repo_id=repo_id,
            cache_dir=DOWNLOAD_ROOT,
        )
        return JSONResponse({"status": "ok", "repo": repo_id})
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
