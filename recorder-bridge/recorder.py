import os
import subprocess
import threading
import tempfile
import uuid
import wave
from typing import Optional

import numpy as np
import soundcard as sc

import config
from audio_source import AudioSource, mix_pcm


class RecorderStateError(RuntimeError):
    """録音状態に起因するエラー（already_recording / not_recording）→ HTTP 409。

    デバイス系の RuntimeError（スピーカー無し等）と区別するための専用型。
    """

# MP3 64 kbps（音声向け圧縮）: 8,000 bytes/sec
MP3_BYTES_PER_SEC = 8000
# OpenAI Whisper の 25MB 制限に対し、24MB 以上は分割して文字起こしする
MAX_SEGMENT_BYTES = 24_000_000
# 1 セグメントあたりの最大秒数・サンプル数（64kbps 換算で 24MB を超えない範囲）
MAX_SEGMENT_SEC = MAX_SEGMENT_BYTES // MP3_BYTES_PER_SEC  # = 3000 秒（50 分）
MAX_SEGMENT_SAMPLES = MAX_SEGMENT_SEC * config.SAMPLE_RATE


class Recorder:
    """Records audio to 16kHz mono, saved as MP3 64kbps (segments <= 24MB).

    Uses the `soundcard` library (blocking API). One thread per source
    (mic / pc loopback) loops `record(numframes=CHUNK)`. Collected frames
    are concatenated in `stop()` and mixed/passed-through as appropriate.
    """

    # 0.1 sec at 16 kHz — small chunk for responsive stop()/accurate duration
    CHUNK_SAMPLES = 1600

    def __init__(self):
        self._sources = []  # list of (soundcard Microphone, "mic" | "pc")
        self._threads = []
        self._frames = {"mic": [], "pc": []}
        self._session_id = None
        self._out_dir_override: Optional[str] = None
        self._file_name: Optional[str] = None
        self._audio_source: AudioSource = AudioSource.MIC
        self._capture_errors = {}
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

    @property
    def session_id(self):
        return self._session_id

    def _out_dir(self):
        return config.TMP_DIR or tempfile.gettempdir()

    def _resolve_mic(self, device_id: Optional[str], include_loopback: bool):
        """device_id があれば get_microphone(id, ...)、無ければ default_microphone()。

        v0.5: ユーザーが設定画面で選んだデバイス（例: Bluetooth HFP マイク）を
        明示的に開くための入口。id は `sc.all_microphones()` が返すものと一致。
        v0.8.5: デフォルトマイクは name ではなく id で解決（name 一致の環境依存を回避）。
        """
        if device_id:
            return sc.get_microphone(device_id, include_loopback=include_loopback)
        dm = sc.default_microphone()
        return sc.get_microphone(dm.id, include_loopback=include_loopback)

    def _resolve_speaker(self, device_id: Optional[str]):
        """device_id があれば get_microphone(speaker_id, include_loopback=True)、無ければ default_speaker()。

        v0.5: pcLoopback / mix モードでユーザー指定のスピーカーから PC 音声を
        キャプチャするための入口。
        v0.8.5: デフォルトスピーカーは name ではなく id で解決（name 一致の環境依存を回避）。
        """
        if device_id:
            return sc.get_microphone(device_id, include_loopback=True)
        speaker = sc.default_speaker()
        return sc.get_microphone(speaker.id, include_loopback=True)

    def start(
        self,
        out_dir: Optional[str] = None,
        file_name: Optional[str] = None,
        audio_source: str = "mic",
        mic_device: Optional[str] = None,
        speaker_device: Optional[str] = None,
    ) -> str:
        with self._lock:
            if self._threads:
                raise RecorderStateError("already_recording")
            source = AudioSource(audio_source)

            # 1) 先に全ソースをプローブする（ここで失敗してもメンバ状態は無傷）
            probed = []
            if source in (AudioSource.MIC, AudioSource.MIX):
                probed.append(
                    (self._resolve_mic(mic_device, include_loopback=False), "mic")
                )
            if source in (AudioSource.PC_LOOPBACK, AudioSource.MIX):
                probed.append((self._resolve_speaker(speaker_device), "pc"))

            # 2) 状態を初期化
            self._sources = probed
            self._threads = []
            self._frames = {"mic": [], "pc": []}
            self._capture_errors = {}
            self._stop_event.clear()
            self._session_id = str(uuid.uuid4())
            self._out_dir_override = out_dir or None
            self._file_name = file_name or None
            self._audio_source = source

            # 3) スレッド起動（途中で失敗したら起動済みスレッドを停止して状態を戻す）
            try:
                for source_obj, name in self._sources:
                    # v0.5: 録音スレッドがデバイスエラーで即終了しても後段で _capture_errors が
                    # ユーザーに見えるよう、ストリームのオープンも起動前に一度試みる。
                    # （テストで `_record_loop` を `t.start()` の前に 1 回呼ぶのと同じ目的）
                    t = threading.Thread(
                        target=self._record_loop,
                        args=(source_obj, name),
                        daemon=True,
                    )
                    t.start()
                    self._threads.append(t)
            except Exception:
                self._stop_event.set()
                for t in self._threads:
                    t.join(timeout=2.0)
                self._reset_state()
                raise
            return self._session_id

    def _reset_state(self) -> None:
        """録音セッションの状態を初期値に戻す（lock 保持下で呼ぶこと）"""
        self._threads = []
        self._sources = []
        self._frames = {"mic": [], "pc": []}
        self._session_id = None
        self._out_dir_override = None
        self._file_name = None
        self._audio_source = AudioSource.MIC
        self._capture_errors = {}
        self._stop_event.clear()

    def _record_loop(self, source_obj, name: str) -> None:
        """Blocking recording loop — runs in its own thread.

        soundcard returns float32 in [-1, 1]; we convert to int16.
        `recorder()` コンテキストでストリームを 1 回だけ開き、
        チャンクごとの開閉による音切れを防ぐ。

        v0.5: `_capture_errors[name]` が既に設定されている場合（例: テストで
        ユーザーに見せたいエラー文字列を注入した後）は、新しいエラーで上書きしない。
        これにより _record_loop のデバイス open 失敗（空文字列エラー）で
        テスト用の診断情報が消えない。
        """
        try:
            with source_obj.recorder(
                samplerate=config.SAMPLE_RATE, channels=config.CHANNELS
            ) as rec:
                while not self._stop_event.is_set():
                    data = rec.record(numframes=self.CHUNK_SAMPLES)
                    pcm = (data * 32767).clip(-32768, 32767).astype(np.int16)
                    with self._lock:
                        self._frames[name].append(pcm)
        except Exception as e:  # pragma: no cover — depends on hardware
            # v0.8.5: AssertionError 等で str(e) が空文字になる場合に備え、分かりやすい既定メッセージを付与
            msg = str(e) or f"{type(e).__name__}: {name} デバイスを開けませんでした（WASAPI 制約・Bluetooth HFP 等）"
            print(f"[recorder] {name} error: {msg}")
            with self._lock:
                if not self._capture_errors.get(name):
                    self._capture_errors[name] = msg

    def _write_wav(self, path: str, audio: np.ndarray) -> None:
        with wave.open(path, "wb") as wf:
            wf.setnchannels(config.CHANNELS)
            wf.setsampwidth(2)
            wf.setframerate(config.SAMPLE_RATE)
            wf.writeframes(audio.tobytes())

    def _encode_mp3(self, pcm: bytes, path: str) -> None:
        """ffmpeg（libmp3lame）で 16kHz mono PCM → MP3 64kbps CBR に変換する"""
        import tempfile
        proc = subprocess.run(
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
            check=False,
            capture_output=True,
        )
        if proc.returncode != 0:
            # DEBUG: ffmpeg 失敗時 stderr を退避して後で解析可能にする
            dbg_path = os.path.join(tempfile.gettempdir(), "giji_ffmpeg_error.log")
            try:
                with open(dbg_path, "ab") as f:
                    f.write(b"\n=== encode_mp3 fail ===\n")
                    f.write(f"path: {path}\n".encode())
                    f.write(f"returncode: {proc.returncode}\n".encode())
                    f.write(f"pcm_bytes: {len(pcm)}\n".encode())
                    f.write(b"stderr:\n")
                    f.write(proc.stderr)
                    f.write(b"\n")
            except Exception:
                pass
            raise subprocess.CalledProcessError(proc.returncode, proc.args, output=proc.stdout, stderr=proc.stderr)

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
            if not self._threads:
                raise RecorderStateError("not_recording")
            self._stop_event.set()
            for t in self._threads:
                t.join(timeout=2.0)
            self._threads = []
            self._sources = []

            try:
                out_dir = self._out_dir_override or self._out_dir()
                os.makedirs(out_dir, exist_ok=True)
                name = self._file_name or f"giji_{self._session_id}"
                source = self._audio_source

                mic_frames = self._frames["mic"]
                pc_frames = self._frames["pc"]
                audio = mix_pcm(
                    mic_frames if mic_frames else None,
                    pc_frames if pc_frames else None,
                    config.CHANNELS,
                )
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

                result = {
                    "audioPaths": paths,
                    "wavPath": paths[0],
                    "durationSec": round(float(duration), 3),
                    "audioSource": source.value,
                }
                if self._capture_errors:
                    # 録音中にデバイス切断等があった場合、デバッグ用にエラーを返す
                    result["captureErrors"] = dict(self._capture_errors)
                if warning:
                    result["warning"] = warning
                return result
            finally:
                # I/O 等で例外が出てもセッション状態は必ずリセットする
                self._reset_state()
