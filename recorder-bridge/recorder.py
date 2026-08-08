import os
import threading
import tempfile
import uuid
import wave
from typing import Optional

import numpy as np
import sounddevice as sd

import config


class Recorder:
    """Records mic audio to 16kHz mono WAV. start/stop controlled."""

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
            path = os.path.join(out_dir, f"{name}.wav")
            audio = np.concatenate(self._frames, axis=0) if self._frames else np.zeros((0, 1), dtype=np.int16)
            with wave.open(path, "wb") as wf:
                wf.setnchannels(config.CHANNELS)
                wf.setsampwidth(2)
                wf.setframerate(config.SAMPLE_RATE)
                wf.writeframes(audio.tobytes())
            duration = (len(audio) / config.SAMPLE_RATE) if len(audio) else 0.0
            self._session_id = None
            self._out_dir_override = None
            self._file_name = None
            return {"wavPath": path, "durationSec": round(float(duration), 3)}
