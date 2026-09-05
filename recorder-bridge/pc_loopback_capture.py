"""PC 音声（WASAPI ループバック）を単体で WAV ファイルへキャプチャするスクリプト。

直接録音（DirectRecorder）が PC 音声を取得するための補助プロセスとして使う。
- 引数: <出力WAVパス> [スピーカーデバイスID] [--monitor]
- 終了: SIGTERM / SIGINT / stdin が閉じられるまでループバックを録音し、終了時に WAV を書き出す
- --monitor: WAV を書き出さず、0.1 秒ごとの入力レベルを stdout に JSON 行で出力する
  （入力テスト用。行形式: {"type": "level", "rms": ..., "peak": ...}）
"""
import argparse
import json
import signal
import sys
import threading
import wave

import numpy as np
import soundcard as sc

import config


def compute_level(data: np.ndarray) -> dict:
    """float 音声フレーム（-1..1 正規化）から RMS と peak を計算する。"""
    if data.size == 0:
        return {"rms": 0.0, "peak": 0.0}
    rms = float(np.sqrt(np.mean(np.square(data))))
    peak = float(np.max(np.abs(data)))
    return {"rms": round(rms, 4), "peak": round(peak, 4)}


def _emit_level(pcm_float: np.ndarray) -> None:
    """現在チャンクのレベルを stdout へ 1 行 JSON で出力する（flush 必須）。"""
    print(json.dumps({"type": "level", **compute_level(pcm_float)}), flush=True)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="WASAPI ループバック PC 音声キャプチャ")
    parser.add_argument("out_path", nargs="?", default="pc_loopback.wav")
    parser.add_argument("speaker_id", nargs="?", default=None)
    parser.add_argument(
        "--monitor", action="store_true",
        help="WAV を書き出さず、入力レベルを stdout に出力し続ける（入力テスト用）",
    )
    return parser.parse_args(argv)


def _resolve_speaker(speaker_id: str | None):
    """スピーカー（ループバック）デバイスを解決する。

    設定画面で選んだ ID は Chromium 形式のハッシュの可能性があり、soundcard は
    Windows の MMDevice ID しか解決できない。解決できない ID が渡された場合は
    既定スピーカーへフォールバックし、stderr に警告を出す（v0.15.1）。
    """
    if speaker_id:
        try:
            return sc.get_microphone(speaker_id, include_loopback=True)
        except Exception as e:  # noqa: BLE001 — 解決できない ID は既定へフォールバック
            print(
                f"PC_LOOPBACK_WARN: speaker id not found, fallback to default ({e})",
                file=sys.stderr,
                flush=True,
            )
    return sc.get_microphone(sc.default_speaker().id, include_loopback=True)


def _capture(out_path: str, speaker_id: str | None, stop_event: threading.Event,
             monitor: bool = False) -> None:
    """スピーカー（ループバック）を録音する。monitor 時は WAV を書き出さない。"""
    spk = _resolve_speaker(speaker_id)

    frames: list[np.ndarray] = []
    # 0.1 秒 / チャンク（16kHz）
    with spk.recorder(samplerate=config.SAMPLE_RATE, channels=config.CHANNELS) as rec:
        while not stop_event.is_set():
            data = rec.record(numframes=1600)
            # v0.15.1: 録音モードでもレベルを出す（ステータスバーのメーター表示のため）
            _emit_level(data)
            pcm = (data * 32767).clip(-32768, 32767).astype(np.int16)
            frames.append(pcm)

    if monitor:
        return

    audio = (
        np.concatenate(frames, axis=0).astype(np.int16)
        if frames
        else np.zeros((0, config.CHANNELS), dtype=np.int16)
    )
    with wave.open(out_path, "wb") as wf:
        wf.setnchannels(config.CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(config.SAMPLE_RATE)
        wf.writeframes(audio.tobytes())


def main() -> int:
    args = parse_args(sys.argv[1:])

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
        _capture(args.out_path, args.speaker_id, stop_event, monitor=args.monitor)
    except Exception as e:  # noqa: BLE001 — プロセス終了コードで異常を伝える
        print(f"PC_LOOPBACK_ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
