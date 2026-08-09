from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import config
from recorder import Recorder, RecorderStateError

app = FastAPI(title="GijiObsidian Recorder Bridge")

# Obsidian プラグイン（app://obsidian.md 等）からの fetch を許可する
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_recorder = Recorder()


class StartReq(BaseModel):
    format: str = "wav"
    # プラグイン設定「録音ファイルの保存場所」「録音ファイル名テンプレート」から渡される
    outDir: Optional[str] = None
    fileName: Optional[str] = None
    # 録音モード: mic（マイクのみ）/ pcLoopback（PC 音声のみ）/ mix（マイク+PC 音声）
    audioSource: Optional[str] = "mic"


class StopReq(BaseModel):
    sessionId: str


@app.get("/health")
def health():
    return {"status": "ok", "version": config.VERSION}


@app.post("/record/start")
def record_start(req: StartReq):
    try:
        sid = _recorder.start(
            out_dir=req.outDir,
            file_name=req.fileName,
            audio_source=req.audioSource or "mic",
        )
    except RecorderStateError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        # WASAPI ループバック非対応・デバイス無し・不正な audioSource 等
        raise HTTPException(status_code=500, detail=f"audio_source_failed: {e}")
    return {"recording": True, "sessionId": sid, "audioSource": req.audioSource or "mic"}


@app.post("/record/stop")
def record_stop(req: StopReq):
    if _recorder.session_id != req.sessionId:
        raise HTTPException(status_code=404, detail="unknown_session")
    try:
        return _recorder.stop()
    except RecorderStateError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        # I/O 例外等（recorder 側で状態は必ずリセット済み）
        raise HTTPException(status_code=500, detail=f"stop_failed: {e}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=config.PORT)
