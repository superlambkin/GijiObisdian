from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import config
import soundcard as sc
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
    # v0.5: デバイス選択（soundcard の id フィールド）。空文字/None → システム既定
    micDeviceId: Optional[str] = None
    speakerDeviceId: Optional[str] = None


class StopReq(BaseModel):
    sessionId: str


@app.get("/health")
def health():
    return {"status": "ok", "version": config.VERSION}


@app.get("/audio/devices")
def list_devices():
    """soundcard で見える全マイク・スピーカーを返す。UI のドロップダウン充填用。

    - Bluetooth HFP マイクも列挙されるが、soundcard 経由での開放は
      端末側の WASAPI 制約で失敗することがある（v0.5 修正対象）。
    - いずれかの列挙に失敗しても全体を 500 にせず、その側だけ空配列にする。
    """
    try:
        mics = [
            {"id": m.id, "name": m.name}
            for m in sc.all_microphones()
        ]
    except Exception:
        mics = []
    try:
        spk = [
            {"id": s.id, "name": s.name}
            for s in sc.all_speakers()
        ]
    except Exception:
        spk = []
    return {"microphones": mics, "speakers": spk}


@app.post("/record/start")
def record_start(req: StartReq):
    try:
        sid = _recorder.start(
            out_dir=req.outDir,
            file_name=req.fileName,
            audio_source=req.audioSource or "mic",
            mic_device=(req.micDeviceId or None) or None,
            speaker_device=(req.speakerDeviceId or None) or None,
        )
    except RecorderStateError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        # WASAPI ループバック非対応・デバイス無し・不正な audioSource 等
        raise HTTPException(status_code=500, detail=f"audio_source_failed: {e}")
    return {
        "recording": True,
        "sessionId": sid,
        "audioSource": req.audioSource or "mic",
        "micDeviceId": req.micDeviceId,
        "speakerDeviceId": req.speakerDeviceId,
    }


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
