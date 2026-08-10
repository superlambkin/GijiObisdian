"""ローカル ONNX-CPU ASR サーバ。OpenAI 互換 POST /v1/audio/transcriptions を公開する。"""
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from asr_engine import AsrEngine, WhisperEngine

app = FastAPI(title="qwen3-asr-server", version="0.1.0")

# Obsidian（Electron app://obsidian.md）からの fetch を通す
app.add_middleware(
    CORSMiddleware,
    allow_origins=["app://obsidian.md", "http://localhost", "http://127.0.0.1"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

engine = AsrEngine()
whisper_engine = WhisperEngine()  # 遅延ロード（モデルは初回 transcribe 時に読込）


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


def _pick_engine(model: str | None):
    """model パラメータでエンジンを選択（既定は Qwen3-ASR）。"""
    return whisper_engine if model == "whisper-small" else engine


@app.post("/v1/audio/transcriptions")
def transcriptions(
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
):
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        tmp = f.name
        f.write(file.file.read())
    try:
        result = _pick_engine(model).transcribe(tmp, language=language)
        return {"text": result.get("text", "").strip()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("QWEN3_ASR_PORT", "9000")),
    )
