import os
import wave
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_cors_headers_present_for_obsidian_origin():
    """Obsidian プラグイン（Origin: app://obsidian.md）からの fetch を許可する"""
    r = client.get("/health", headers={"Origin": "app://obsidian.md"})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "*"


def test_record_start_and_stop_produces_wav(tmp_path, monkeypatch):
    monkeypatch.setattr("config.TMP_DIR", str(tmp_path))
    # start
    r = client.post("/record/start", json={"format": "wav"})
    assert r.status_code == 200
    sid = r.json()["sessionId"]
    assert r.json()["recording"] is True
    # stop (uses a short silent recording injected by test double)
    r = client.post("/record/stop", json={"sessionId": sid})
    assert r.status_code == 200
    body = r.json()
    assert body["wavPath"].endswith(".wav")
    assert body["durationSec"] >= 0
    # validate WAV header
    with wave.open(body["wavPath"], "rb") as wf:
        assert wf.getnchannels() == 1
        assert wf.getframerate() == 16000


def test_stop_unknown_session_errors():
    r = client.post("/record/stop", json={"sessionId": "nope"})
    assert r.status_code == 404
