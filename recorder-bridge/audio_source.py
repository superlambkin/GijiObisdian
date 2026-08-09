"""Audio source selection for the recorder bridge.

Uses the `soundcard` library for WASAPI loopback support on Windows.
soundcard provides a blocking `Microphone.record()` API (no callbacks),
so the recorder spawns one thread per source to capture frames.
"""
from enum import Enum
from typing import List, Optional

import numpy as np


class AudioSource(str, Enum):
    MIC = "mic"
    PC_LOOPBACK = "pcLoopback"
    MIX = "mix"


def list_available_sources() -> List[str]:
    """Available source identifiers.

    - `mic` always available.
    - `pcLoopback` and `mix` require WASAPI loopback (Windows). They are
      only advertised when a default speaker can be probed.
    """
    sources = [AudioSource.MIC.value]
    try:
        import soundcard as sc  # noqa: F401
        sc.default_speaker()  # probe — raises if no speaker / non-Windows
        sources.append(AudioSource.PC_LOOPBACK.value)
        sources.append(AudioSource.MIX.value)
    except Exception:
        pass  # No speaker probe → loopback unavailable
    return sources


def mix_pcm(
    mic_frames: Optional[List[np.ndarray]],
    pc_frames: Optional[List[np.ndarray]],
    channels: int,
) -> np.ndarray:
    """2 系列の PCM をミックス。None/empty は pass-through、もう一方は平均しない。

    - mic only: return mic as-is (no halving)
    - pc  only: return pc  as-is (no halving)
    - both:     average element-wise (int32 promotion for clipping protection)
    - both None/empty: return empty int16 array of shape (0, channels)
    """
    mic_concat = (
        np.concatenate(mic_frames, axis=0).astype(np.int16)
        if mic_frames
        else None
    )
    pc_concat = (
        np.concatenate(pc_frames, axis=0).astype(np.int16)
        if pc_frames
        else None
    )

    if mic_concat is None and pc_concat is None:
        return np.zeros((0, channels), dtype=np.int16)
    if pc_concat is None:
        return mic_concat
    if mic_concat is None:
        return pc_concat

    # pass-through semantics: where ONLY one source has data, return that
    # source unchanged (no halving against zero). Where both sources have
    # data, average with int32 promotion for clipping protection.
    n = max(len(mic_concat), len(pc_concat))
    mic_padded = np.zeros((n, channels), dtype=np.int16)
    pc_padded = np.zeros((n, channels), dtype=np.int16)
    mic_padded[: len(mic_concat)] = mic_concat
    pc_padded[: len(pc_concat)] = pc_concat
    has_mic = np.zeros((n, channels), dtype=bool)
    has_pc = np.zeros((n, channels), dtype=bool)
    has_mic[: len(mic_concat)] = True
    has_pc[: len(pc_concat)] = True

    mixed = np.zeros((n, channels), dtype=np.int16)
    both = has_mic & has_pc
    only_mic = has_mic & ~has_pc
    only_pc = has_pc & ~has_mic

    if both.any():
        mixed[both] = (
            (mic_padded[both].astype(np.int32) + pc_padded[both].astype(np.int32)) // 2
        ).astype(np.int16)
    if only_mic.any():
        mixed[only_mic] = mic_padded[only_mic]
    if only_pc.any():
        mixed[only_pc] = pc_padded[only_pc]
    return mixed
