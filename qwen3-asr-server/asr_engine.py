"""Daumee/Qwen3-ASR-0.6B-ONNX-CPU の OnnxAsrPipeline をラップするエンジン。"""
import shutil
import sys
from pathlib import Path

_MODEL_DIR = Path(__file__).parent / "model"
_ONNX_DIR = _MODEL_DIR / "onnx_models"

# onnx_inference.py は相対 import をしないため sys.path へ追加する
sys.path.insert(0, str(_MODEL_DIR))

try:
    from onnx_inference import OnnxAsrPipeline  # noqa: E402
except ImportError:
    # model/ 未ダウンロード時（fresh clone）でも import 自体は成功させ、
    # 利用時に分かりやすいエラーを出す（テストは SKIP される）。
    OnnxAsrPipeline = None  # type: ignore[assignment]


class AsrEngine:
    def __init__(self, model_dir: Path = _MODEL_DIR, onnx_dir: Path = _ONNX_DIR):
        if OnnxAsrPipeline is None:
            raise ImportError(
                "model/ がありません。README に従って Hugging Face から"
                " Daumee/Qwen3-ASR-0.6B-ONNX-CPU を model/ にダウンロードしてください。"
            )
        onnx_dir = Path(onnx_dir)
        # HF リポジトリでは tokenizer.json はリポジトリ直下にあるが、
        # onnx_inference.py は --onnx-dir 内を探すため、無ければコピーして保険をかける。
        if not (onnx_dir / "tokenizer.json").exists():
            repo_tokenizer = Path(model_dir) / "tokenizer.json"
            if repo_tokenizer.exists():
                onnx_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(repo_tokenizer), str(onnx_dir / "tokenizer.json"))
        self._pipeline = OnnxAsrPipeline(onnx_dir=str(onnx_dir), num_threads=0, quantize="int8")

    def transcribe(self, audio_path: str, language: str | None = None) -> dict:
        return self._pipeline.transcribe(audio_path, language=language, chunk_sec=30)
