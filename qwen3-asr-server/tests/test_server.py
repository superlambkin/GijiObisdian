import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "hello.wav"
MODEL_DIR = Path(__file__).parent.parent / "model"

pytestmark = pytest.mark.skipif(
    not MODEL_DIR.exists() or not FIXTURE.exists(),
    reason="model or fixture not downloaded",
)


def test_transcriptions_returns_text():
    with FIXTURE.open("rb") as f:
        resp = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("audio.wav", f, "audio/wav")},
            data={"model": "qwen3-asr-0.6b", "language": "Japanese"},
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "text" in data
    assert data["text"].strip()


def test_transcriptions_invalid_file_returns_500():
    resp = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("bad.wav", b"not-audio", "audio/wav")},
    )
    assert resp.status_code == 500
