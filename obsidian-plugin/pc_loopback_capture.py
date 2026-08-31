"""PC 音声（WASAPI ループバック）を単体で WAV ファイルへキャプチャするスクリプト。

直接録音（DirectRecorder）が PC 音声を取得するための補助プロセスとして使う。
- 引数: <出力WAVパス> [スピーカーデバイスID]
- 終了: SIGTERM / SIGINT / stdin が閉じられるまでループバックを録音し、終了時に WAV を書き出す
"""
import signal
import sys
import threading
import wave

import numpy as np
import soundcard as sc

# import config  → 削除し、下記を直接定義
SAMPLE_RATE = 16000
CHANNELS = 1
# 以降同梱。numpy / soundcard はユーザー環境に pip install が必要（起動失敗時に案内）


def _capture(out_path: str, speaker_id: str | None, stop_event: threading.Event) -> None:
    """スピーカー（ループバック）を録音して WAV に書き出す。"""
    if speaker_id:
        spk = sc.get_microphone(speaker_id, include_loopback=True)
    else:
        spk = sc.get_microphone(sc.default_speaker().id, include_loopback=True)

    frames: list[np.ndarray] = []
    # 0.1 秒 / チャンク（16kHz）
    with spk.recorder(samplerate=SAMPLE_RATE, channels=CHANNELS) as rec:
        while not stop_event.is_set():
            data = rec.record(numframes=1600)
            pcm = (data * 32767).clip(-32768, 32767).astype(np.int16)
            frames.append(pcm)

    audio = (
        np.concatenate(frames, axis=0).astype(np.int16)
        if frames
        else np.zeros((0, CHANNELS), dtype=np.int16)
    )
    with wave.open(out_path, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio.tobytes())


def main() -> int:
    out_path = sys.argv[1] if len(sys.argv) > 1 else "pc_loopback.wav"
    speaker_id = sys.argv[2] if len(sys.argv) > 2 else None

    stop_event = threading.Event()

    def _handler(signum, frame):
        stop_event.set()

    signal.signal(signal.SIGTERM, _handler)
    signal.signal(signal.SIGINT, _handler)

    # stdin が閉じられたら（親プロセスが消えたら）終了する監視スレッド
    def _stdin_watch():
        try:
            sys.stdin.read()
        except Exception:
            pass
        finally:
            stop_event.set()

    watcher = threading.Thread(target=_stdin_watch, daemon=True)
    watcher.start()

    try:
        _capture(out_path, speaker_id, stop_event)
    except Exception as e:  # noqa: BLE001 — プロセス終了コードで異常を伝える
        print(f"PC_LOOPBACK_ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
