"""Daumee/Qwen3-ASR-0.6B-ONNX-CPU の OnnxAsrPipeline をラップするエンジン。

AsrEngine は遅延ロード方式を採用している：
- __init__ はモデルディレクトリの解決のみ（パイプライン構築・ダウンロードはしない）
- 初回 transcribe() 時にモデルを確認（不足なら自動ダウンロード）してパイプラインを構築

これにより GET /health はモデル未配置でも即座に 200 を返す。
"""
import os
import shutil
import sys
from pathlib import Path

# Hugging Face のモデルリポジトリ ID（自動ダウンロードに使用）
_REPO_ID = "Daumee/Qwen3-ASR-0.6B-ONNX-CPU"

# 後方互換用のレガシーモデル置き場（git-ignored）。既存配置があれば再ダウンロードしない。
_LEGACY_MODEL_DIR = Path(__file__).parent / "model"


def _has_model(model_dir: Path) -> bool:
    """「モデルがある」= onnx_models/ が存在 または tokenizer.json が存在。"""
    model_dir = Path(model_dir)
    return (model_dir / "onnx_models").is_dir() or (model_dir / "tokenizer.json").is_file()


def resolve_model_dir() -> Path:
    """モデルディレクトリの解決順序:

    1. 環境変数 QWEN3_ASR_MODEL_DIR（最優先）
    2. セントラルキャッシュ ~/.cache/qwen3-asr（モデルがあれば）
    3. レガシー model/（後方互換。あれば再ダウンロードしない）
    4. どれにも無ければセントラルキャッシュをダウンロード先として返す
    """
    env_dir = os.environ.get("QWEN3_ASR_MODEL_DIR")
    if env_dir:
        return Path(env_dir)
    central = Path.home() / ".cache" / "qwen3-asr"
    if _has_model(central):
        return central
    if _has_model(_LEGACY_MODEL_DIR):
        return _LEGACY_MODEL_DIR
    return central


def ensure_model_download(model_dir: Path) -> Path:
    """モデルが無ければ Hugging Face から自動ダウンロードする（再開可能）。"""
    model_dir = Path(model_dir)
    if _has_model(model_dir):
        return model_dir
    from huggingface_hub import snapshot_download  # noqa: PLC0415

    model_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo_id=_REPO_ID, local_dir=model_dir)
    if not _has_model(model_dir):
        raise RuntimeError(
            f"モデルのダウンロード後も onnx_models/ か tokenizer.json が見つかりません: {model_dir}"
        )
    return model_dir


class AsrEngine:
    """Qwen3-ASR を遅延ロードするエンジン。

    __init__ はモデルディレクトリの解決のみで、パイプライン構築もダウンロードも行わない。
    初回 transcribe() 時にモデルを確認（必要なら自動ダウンロード）してパイプラインを構築する。
    """

    def __init__(self, model_dir: Path | None = None):
        self._model_dir = Path(model_dir) if model_dir is not None else resolve_model_dir()
        self._pipeline = None

    def _ensure_pipeline(self):
        if self._pipeline is not None:
            return
        model_dir = ensure_model_download(self._model_dir)
        onnx_dir = model_dir / "onnx_models"

        # onnx_inference.py は相対 import をしないため sys.path へ追加する。
        # モデルはセントラルキャッシュにある可能性があるため、解決後の model_dir を使う。
        if str(model_dir) not in sys.path:
            sys.path.insert(0, str(model_dir))
        try:
            from onnx_inference import OnnxAsrPipeline  # noqa: PLC0415, E402
        except ImportError as exc:
            raise ImportError(
                f"onnx_inference.py を {model_dir} から import できません。"
                "モデルのダウンロードが不完全か、ディレクトリが壊れている可能性があります。"
                "ダウンロード先を削除して再試行してください。"
            ) from exc

        # HF リポジトリでは tokenizer.json はリポジトリ直下にあるが、
        # onnx_inference.py は --onnx-dir 内を探すため、無ければコピーして保険をかける。
        if not (onnx_dir / "tokenizer.json").exists():
            repo_tokenizer = model_dir / "tokenizer.json"
            if repo_tokenizer.exists():
                onnx_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(repo_tokenizer), str(onnx_dir / "tokenizer.json"))

        self._pipeline = OnnxAsrPipeline(onnx_dir=str(onnx_dir), num_threads=0, quantize="int8")

    def transcribe(self, audio_path: str, language: str | None = None) -> dict:
        self._ensure_pipeline()
        return self._pipeline.transcribe(audio_path, language=language, chunk_sec=30)


class WhisperEngine:
    """openai-whisper small（CPU torch）を遅延ロードするエンジン。"""

    _LANG_MAP = {"Chinese": "zh", "Japanese": "ja", "English": "en"}

    def __init__(self) -> None:
        self._model = None

    def _ensure_model(self):
        if self._model is not None:
            return
        try:
            import whisper
        except ImportError as exc:
            raise ImportError(
                "openai-whisper / torch が導入されていません。"
                "README に従って pip install openai-whisper と CPU 版 torch を導入してください。"
            ) from exc
        self._model = whisper.load_model("small")

    def _lang_code(self, language: str | None) -> str | None:
        if not language:
            return None
        return self._LANG_MAP.get(language, language)

    def transcribe(self, audio_path: str, language: str | None = None) -> dict:
        self._ensure_model()
        result = self._model.transcribe(audio_path, language=self._lang_code(language))
        return {"text": result.get("text", "").strip()}
