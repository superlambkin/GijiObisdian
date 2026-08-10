from pathlib import Path

import pytest
from fastapi.testclient import TestClient

FIXTURE = Path(__file__).parent / "fixtures" / "hello.wav"
MODEL_DIR = Path(__file__).parent.parent / "model"

# AsrEngine は遅延ロード（__init__ がモデルを読まない）ため、モデル未配置でも import は安全。
from main import app  # noqa: E402

client = TestClient(app)

# モデル依存の転写テストだけ SKIP ガード（モデル未配置環境で 4.9GB の自動 DL を走らせない）。
_MODEL_SKIP = pytest.mark.skipif(
    not MODEL_DIR.exists() or not FIXTURE.exists(),
    reason="model or fixture not downloaded",
)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_health_without_model():
    """モデル未ダウンロードでも /health は 200 を返す（AsrEngine が遅延ロードだから）。"""
    resp = client.get("/health")
    assert resp.status_code == 200


@_MODEL_SKIP
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


@_MODEL_SKIP
def test_transcriptions_invalid_file_returns_500():
    resp = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("bad.wav", b"not-audio", "audio/wav")},
    )
    assert resp.status_code == 500


def _whisper_available() -> bool:
    try:
        import whisper  # noqa: F401
        import torch  # noqa: F401
        return True
    except Exception:
        return False


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
