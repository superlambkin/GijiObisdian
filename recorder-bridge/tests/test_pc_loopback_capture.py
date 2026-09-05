"""pc_loopback_capture のレベル計算・--monitor モードのテスト。"""
import contextlib
import json
import threading

import numpy as np

import pc_loopback_capture as m


# ---- compute_level（純関数） ----

def test_compute_level_sine():
    """振幅 0.5 の正弦波 → rms≈0.354・peak=0.5"""
    t = np.linspace(0, 1, 1600, endpoint=False)
    data = (0.5 * np.sin(2 * np.pi * 440 * t)).reshape(-1, 1)
    level = m.compute_level(data)
    assert abs(level["rms"] - 0.5 / np.sqrt(2)) < 0.001
    assert abs(level["peak"] - 0.5) < 0.001


def test_compute_level_silence():
    level = m.compute_level(np.zeros((1600, 2), dtype=np.float32))
    assert level["rms"] == 0.0
    assert level["peak"] == 0.0


def test_compute_level_empty():
    level = m.compute_level(np.zeros((0, 2), dtype=np.float32))
    assert level["rms"] == 0.0
    assert level["peak"] == 0.0


# ---- parse_args ----

def test_parse_args_legacy_format():
    """従来形式（out_path + speaker_id）は互換維持"""
    args = m.parse_args(["C:/out.wav", "dev123"])
    assert args.out_path == "C:/out.wav"
    assert args.speaker_id == "dev123"
    assert args.monitor is False


def test_parse_args_monitor_flag():
    args = m.parse_args(["C:/mon.wav", "--monitor"])
    assert args.out_path == "C:/mon.wav"
    assert args.speaker_id is None
    assert args.monitor is True


# ---- --monitor モード ----

class _FakeRec:
    """2 回 record したら停止イベントをセットするフェイクレコーダ。"""

    def __init__(self, ev: threading.Event):
        self.ev = ev
        self.calls = 0

    def record(self, numframes: int):
        self.calls += 1
        if self.calls >= 2:
            self.ev.set()
        return np.full((numframes, 2), 0.25, dtype=np.float32)


class _FakeSpk:
    def __init__(self, ev: threading.Event):
        self.ev = ev

    def recorder(self, samplerate, channels):
        return contextlib.nullcontext(_FakeRec(self.ev))


def test_capture_monitor_emits_level_and_skips_wav(tmp_path, capsys, monkeypatch):
    """--monitor は WAV を書かずレベル JSON 行を出す"""
    ev = threading.Event()
    monkeypatch.setattr(m.sc, "get_microphone", lambda *a, **k: _FakeSpk(ev))

    def _boom(*a, **k):  # wave.open が呼ばれたら失敗
        raise AssertionError("monitor モードで WAV を書き出した")

    monkeypatch.setattr(m.wave, "open", _boom)

    m._capture(str(tmp_path / "ignored.wav"), None, ev, monitor=True)

    lines = [l for l in capsys.readouterr().out.splitlines() if l.strip()]
    assert len(lines) >= 2
    for line in lines:
        obj = json.loads(line)
        assert obj["type"] == "level"
        assert isinstance(obj["rms"], float)
        assert isinstance(obj["peak"], float)
        assert abs(obj["rms"] - 0.25) < 0.001
        assert abs(obj["peak"] - 0.25) < 0.001


def test_capture_normal_mode_does_not_emit_level(tmp_path, capsys, monkeypatch):
    """従来モード（monitor=False）ではレベル行を出さない（stdout 契約を壊さない）"""
    ev = threading.Event()
    monkeypatch.setattr(m.sc, "get_microphone", lambda *a, **k: _FakeSpk(ev))

    written = {}

    class _FakeWave:
        def __init__(self):
            self._frames = []

        def setnchannels(self, n):
            written["ch"] = n

        def setsampwidth(self, w):
            written["w"] = w

        def setframerate(self, r):
            written["r"] = r

        def writeframes(self, b):
            written["bytes"] = len(b)

    ctx = contextlib.nullcontext(_FakeWave())
    monkeypatch.setattr(m.wave, "open", lambda *a, **k: ctx)

    m._capture(str(tmp_path / "out.wav"), None, ev, monitor=False)

    assert capsys.readouterr().out.strip() == ""
    assert written["bytes"] > 0


# ---- スピーカー ID 解決のフォールバック ----

def test_resolve_speaker_falls_back_to_default_on_unknown_id(capsys, monkeypatch):
    """Chromium 形式の ID など解決できない ID は既定スピーカーへフォールバックする"""
    resolved = {}

    class _FakeDev:
        id = "default-dev"

    def _fake_get(id_or_name, include_loopback=False):
        if id_or_name == "default-dev":
            dev = _FakeDev()
            resolved["id"] = id_or_name
            return dev
        raise ValueError(f"no device with id {id_or_name}")

    monkeypatch.setattr(m.sc, "get_microphone", _fake_get)
    monkeypatch.setattr(m.sc, "default_speaker", lambda: _FakeDev())

    dev = m._resolve_speaker("04fd46ab8389")  # 解決できない ID（Chromium ハッシュ相当）
    assert resolved["id"] == "default-dev"
    err = capsys.readouterr().err
    assert "PC_LOOPBACK_WARN" in err


def test_resolve_speaker_uses_given_id_when_resolvable(capsys, monkeypatch):
    """解決できる ID はそのまま使う（フォールバックしない）"""

    class _FakeDev:
        id = "target-dev"

    def _fake_get(id_or_name, include_loopback=False):
        assert id_or_name == "target-dev"
        assert include_loopback is True
        return _FakeDev()

    monkeypatch.setattr(m.sc, "get_microphone", _fake_get)

    dev = m._resolve_speaker("target-dev")
    assert dev.id == "target-dev"
    assert capsys.readouterr().err == ""


def test_resolve_speaker_none_uses_default(monkeypatch):
    class _FakeDev:
        id = "default-dev"

    monkeypatch.setattr(m.sc, "get_microphone", lambda id_or_name, include_loopback=False: _FakeDev())
    monkeypatch.setattr(m.sc, "default_speaker", lambda: _FakeDev())
    dev = m._resolve_speaker(None)
    assert dev.id == "default-dev"
