from pathlib import Path

import pytest
from fastapi.testclient import TestClient

FIXTURE = Path(__file__).parent / "fixtures" / "hello.wav"
MODEL_DIR = Path(__file__).parent.parent / "model"

pytestmark = pytest.mark.skipif(
    not MODEL_DIR.exists() or not FIXTURE.exists(),
    reason="model or fixture not downloaded",
)


def _whisper_available() -> bool:
    try:
        import whisper  # noqa: F401
        import torch  # noqa: F401
        return True
    except Exception:
        return False

# model/ が無い環境（fresh clone）でもコレクションエラーにせず SKIP にするため、
# app の import（main → asr_engine → onnx_inference）は MODEL_DIR が存在する場合のみ行う。
if MODEL_DIR.exists():
    from main import app

    client = TestClient(app)
else:
    app = None
    client = None


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


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


@pytest.mark.skipif(
    not MODEL_DIR.exists() or not FIXTURE.exists() or not _whisper_available(),
    reason="model, fixture, or whisper/torch not available",
)
def test_transcriptions_whisper_small():
    with FIXTURE.open("rb") as f:
        resp = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("audio.wav", f, "audio/wav")},
            data={"model": "whisper-small", "language": "Japanese"},
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "text" in data
    assert data["text"].strip()
