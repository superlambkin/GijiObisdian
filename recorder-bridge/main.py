from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import config
from recorder import Recorder

app = FastAPI(title="GijiObsidian Recorder Bridge")
_recorder = Recorder()


class StartReq(BaseModel):
    format: str = "wav"


class StopReq(BaseModel):
    sessionId: str


@app.get("/health")
def health():
    return {"status": "ok", "version": config.VERSION}


@app.post("/record/start")
def record_start(req: StartReq):
    try:
        sid = _recorder.start()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"recording": True, "sessionId": sid}


@app.post("/record/stop")
def record_stop(req: StopReq):
    if _recorder.session_id != req.sessionId:
        raise HTTPException(status_code=404, detail="unknown_session")
    try:
        return _recorder.stop()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=config.PORT)
