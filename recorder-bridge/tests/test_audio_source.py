import numpy as np

from audio_source import AudioSource, mix_pcm, list_available_sources


def test_audio_source_enum_values():
    assert AudioSource.MIC.value == "mic"
    assert AudioSource.PC_LOOPBACK.value == "pcLoopback"
    assert AudioSource.MIX.value == "mix"


def test_audio_source_from_string():
    assert AudioSource("mic") == AudioSource.MIC
    assert AudioSource("pcLoopback") == AudioSource.PC_LOOPBACK
    assert AudioSource("mix") == AudioSource.MIX


def test_mix_pcm_both_empty():
    """両方 None / 空 → 空 int16 配列 (0, channels)"""
    mixed = mix_pcm(None, None, channels=1)
    assert mixed.shape == (0, 1)
    assert mixed.dtype == np.int16


def test_mix_pcm_only_mic_passthrough():
    """mic のみ：halving しない、pass-through"""
    mic = [np.array([[100], [200], [300]], dtype=np.int16)]
    mixed = mix_pcm(mic, None, channels=1)
    assert mixed.shape == (3, 1)
    assert mixed[0, 0] == 100
    assert mixed[2, 0] == 300


def test_mix_pcm_only_pc_passthrough():
    """pc のみ：halving しない、pass-through"""
    pc = [np.array([[500], [600]], dtype=np.int16)]
    mixed = mix_pcm(None, pc, channels=1)
    assert mixed.shape == (2, 1)
    assert mixed[0, 0] == 500
    assert mixed[1, 0] == 600


def test_mix_pcm_both_same_length_averages():
    """同長：要素ごとに平均"""
    mic = [np.array([[1000], [2000]], dtype=np.int16)]
    pc = [np.array([[2000], [4000]], dtype=np.int16)]
    mixed = mix_pcm(mic, pc, channels=1)
    assert mixed[0, 0] == 1500  # (1000+2000)/2
    assert mixed[1, 0] == 3000  # (2000+4000)/2


def test_mix_pcm_different_length_pads_with_zero():
    """長さ違い：短い方を 0 パディング"""
    mic = [np.array([[100], [200], [300], [400]], dtype=np.int16)]
    pc = [np.array([[10], [20]], dtype=np.int16)]
    mixed = mix_pcm(mic, pc, channels=1)
    assert mixed.shape == (4, 1)
    assert mixed[0, 0] == 55  # (100+10)/2
    assert mixed[2, 0] == 300  # mic only
    assert mixed[3, 0] == 400


def test_list_available_sources_includes_mic():
    """list_available_sources は少なくとも 'mic' を含む"""
    sources = list_available_sources()
    assert "mic" in sources
