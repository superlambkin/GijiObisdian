import os
import subprocess
import threading
import tempfile
import uuid
import wave
from typing import Optional

import numpy as np
import sounddevice as sd

import config

# MP3 64 kbps（音声向け圧縮）: 8,000 bytes/sec
MP3_BYTES_PER_SEC = 8000
# OpenAI Whisper の 25MB 制限に対し、24MB 以上は分割して文字起こしする
MAX_SEGMENT_BYTES = 24_000_000
# 1 セグメントあたりの最大秒数・サンプル数（64kbps 換算で 24MB を超えない範囲）
MAX_SEGMENT_SEC = MAX_SEGMENT_BYTES // MP3_BYTES_PER_SEC  # = 3000 秒（50 分）
MAX_SEGMENT_SAMPLES = MAX_SEGMENT_SEC * config.SAMPLE_RATE


class Recorder:
    """Records mic audio to 16kHz mono, saved as MP3 64kbps (segments <= 24MB)."""

    def __init__(self):
        self._stream = None
        self._frames = []
        self._session_id = None
        self._out_dir_override: Optional[str] = None
        self._file_name: Optional[str] = None
        self._lock = threading.Lock()

    @property
    def session_id(self):
        return self._session_id

    def _out_dir(self):
        return config.TMP_DIR or tempfile.gettempdir()

    def start(self, out_dir: Optional[str] = None, file_name: Optional[str] = None) -> str:
        with self._lock:
            if self._stream is not None:
                raise RuntimeError("already_recording")
            self._frames = []
            self._session_id = str(uuid.uuid4())
            self._out_dir_override = out_dir or None
            self._file_name = file_name or None
            self._stream = sd.InputStream(
                samplerate=config.SAMPLE_RATE,
                channels=config.CHANNELS,
                dtype="int16",
                callback=self._on_audio,
            )
            self._stream.start()
            return self._session_id

    def _on_audio(self, indata, frames, time, status):
        with self._lock:
            self._frames.append(indata.copy())

    def _write_wav(self, path: str, audio: np.ndarray) -> None:
        with wave.open(path, "wb") as wf:
            wf.setnchannels(config.CHANNELS)
            wf.setsampwidth(2)
            wf.setframerate(config.SAMPLE_RATE)
            wf.writeframes(audio.tobytes())

    def _encode_mp3(self, pcm: bytes, path: str) -> None:
        """ffmpeg（libmp3lame）で 16kHz mono PCM → MP3 64kbps CBR に変換する"""
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "s16le",
                "-ar", str(config.SAMPLE_RATE),
                "-ac", str(config.CHANNELS),
                "-i", "pipe:0",
                "-codec:a", "libmp3lame",
                "-b:a", "64k",
                "-write_xing", "0",  # Xing ヘッダ無しの真 CBR に（分割を安全にする）
                path,
            ],
            input=pcm,
            check=True,
            capture_output=True,
        )

    def _save_mp3_segments(self, audio: np.ndarray, out_dir: str, name: str) -> list:
        """PCM を 24MB（64kbps 換算）以内の MP3 セグメントに分割して保存し、パス一覧を返す"""
        total = len(audio)
        seg_count = max(1, -(-total // MAX_SEGMENT_SAMPLES))  # ceil
        paths = []
        for i in range(seg_count):
            seg = audio[i * MAX_SEGMENT_SAMPLES : (i + 1) * MAX_SEGMENT_SAMPLES]
            fname = f"{name}.mp3" if seg_count == 1 else f"{name}-{i + 1}.mp3"
            path = os.path.join(out_dir, fname)
            self._encode_mp3(seg.tobytes(), path)
            paths.append(path)
        return paths

    def stop(self) -> dict:
        with self._lock:
            if self._stream is None:
                raise RuntimeError("not_recording")
            self._stream.stop()
            self._stream.close()
            self._stream = None
            out_dir = self._out_dir_override or self._out_dir()
            os.makedirs(out_dir, exist_ok=True)
            name = self._file_name or f"giji_{self._session_id}"
            audio = np.concatenate(self._frames, axis=0) if self._frames else np.zeros((0, 1), dtype=np.int16)
            duration = (len(audio) / config.SAMPLE_RATE) if len(audio) else 0.0

            warning = None
            try:
                paths = self._save_mp3_segments(audio, out_dir, name)
            except Exception:
                # 明示的フォールバック: MP3 変換に失敗した場合は WAV で保存し warning を返す
                warning = "mp3_encode_failed"
                wav_path = os.path.join(out_dir, f"{name}.wav")
                self._write_wav(wav_path, audio)
                paths = [wav_path]

            self._session_id = None
            self._out_dir_override = None
            self._file_name = None
            result = {"audioPaths": paths, "wavPath": paths[0], "durationSec": round(float(duration), 3)}
            if warning:
                result["warning"] = warning
            return result
