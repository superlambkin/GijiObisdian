"""asr_engine のモデル解決・自動ダウンロード・遅延ロードを検証するテスト。"""
from pathlib import Path

import pytest

import asr_engine
from asr_engine import AsrEngine, ensure_model_download, resolve_model_dir

_REPO_ID = "Daumee/Qwen3-ASR-0.6B-ONNX-CPU"


@pytest.fixture
def fake_home(tmp_path, monkeypatch):
    """Path.home を一時ディレクトリへ差し替え、QWEN3_ASR_MODEL_DIR を未設定にする。"""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.delenv("QWEN3_ASR_MODEL_DIR", raising=False)
    return home


def test_resolve_model_dir_prefers_env_var(tmp_path, monkeypatch):
    env_dir = tmp_path / "env-model"
    env_dir.mkdir()
    monkeypatch.setenv("QWEN3_ASR_MODEL_DIR", str(env_dir))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path / "home"))

    assert resolve_model_dir() == env_dir


def test_resolve_model_dir_prefers_central_cache_when_has_model(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.delenv("QWEN3_ASR_MODEL_DIR", raising=False)
    central = home / ".cache" / "qwen3-asr"
    (central / "onnx_models").mkdir(parents=True)
    # レガシーにもモデルがあるが、セントラルキャッシュが優先される
    legacy = tmp_path / "legacy"
    (legacy).mkdir(parents=True)
    monkeypatch.setattr(asr_engine, "_LEGACY_MODEL_DIR", legacy)
    (legacy / "tokenizer.json").write_text("{}")

    assert resolve_model_dir() == central


def test_resolve_model_dir_falls_back_to_legacy(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.delenv("QWEN3_ASR_MODEL_DIR", raising=False)
    # セントラルキャッシュは空、レガシーにのみモデルがある
    legacy = tmp_path / "legacy"
    (legacy).mkdir(parents=True)
    (legacy / "tokenizer.json").write_text("{}")
    monkeypatch.setattr(asr_engine, "_LEGACY_MODEL_DIR", legacy)

    assert resolve_model_dir() == legacy


def test_resolve_model_dir_defaults_to_central_cache_download_target(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.delenv("QWEN3_ASR_MODEL_DIR", raising=False)
    monkeypatch.setattr(asr_engine, "_LEGACY_MODEL_DIR", tmp_path / "missing")
    central = home / ".cache" / "qwen3-asr"

    assert resolve_model_dir() == central


def test_ensure_model_download_calls_snapshot_download_when_missing(tmp_path, monkeypatch):
    model_dir = tmp_path / "cache"
    calls = {}

    def fake_snapshot_download(*args, **kwargs):
        calls["repo_id"] = args[0] if args else kwargs.get("repo_id")
        calls["local_dir"] = kwargs.get("local_dir")
        # ダウンロード完了を模擬：onnx_models/ を作る
        (Path(kwargs["local_dir"]) / "onnx_models").mkdir(parents=True)
        return kwargs["local_dir"]

    monkeypatch.setattr("huggingface_hub.snapshot_download", fake_snapshot_download)

    result = ensure_model_download(model_dir)

    assert result == model_dir
    assert calls["repo_id"] == _REPO_ID
    assert calls["local_dir"] == model_dir


def test_ensure_model_download_skips_when_model_present(tmp_path, monkeypatch):
    model_dir = tmp_path / "cache"
    model_dir.mkdir(parents=True)
    (model_dir / "tokenizer.json").write_text("{}")
    called = []

    def fake_snapshot_download(*args, **kwargs):
        called.append(kwargs)
        return kwargs["local_dir"]

    monkeypatch.setattr("huggingface_hub.snapshot_download", fake_snapshot_download)

    ensure_model_download(model_dir)

    assert called == []  # 既にモデルがある場合は再ダウンロードしない


def test_asr_engine_init_is_cheap(tmp_path, monkeypatch):
    """モデル未配置・env 未設定でも __init__ は例外を出さずパイプラインも構築しない。"""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.delenv("QWEN3_ASR_MODEL_DIR", raising=False)
    monkeypatch.setattr(asr_engine, "_LEGACY_MODEL_DIR", tmp_path / "missing")

    engine = AsrEngine()

    assert engine._pipeline is None
    assert engine._model_dir == home / ".cache" / "qwen3-asr"
