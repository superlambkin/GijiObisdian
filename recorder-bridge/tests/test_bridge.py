import os
import wave
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_cors_headers_present_for_obsidian_origin():
    """Obsidian プラグイン（Origin: app://obsidian.md）からの fetch を許可する"""
    r = client.get("/health", headers={"Origin": "app://obsidian.md"})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "*"


def test_record_start_and_stop_produces_mp3(tmp_path, monkeypatch):
    monkeypatch.setattr("config.TMP_DIR", str(tmp_path))
    # start
    r = client.post("/record/start", json={"format": "wav"})
    assert r.status_code == 200
    sid = r.json()["sessionId"]
    assert r.json()["recording"] is True
    # stop (uses a short silent recording injected by test double)
    r = client.post("/record/stop", json={"sessionId": sid})
    assert r.status_code == 200
    body = r.json()
    assert "warning" not in body  # MP3 変換成功（ffmpeg が必要）
    paths = body["audioPaths"]
    assert len(paths) == 1
    assert paths[0].endswith(".mp3")
    assert body["durationSec"] >= 0
    # MP3 マジックバイト確認（ID3 または 0xFF 同期）
    with open(paths[0], "rb") as f:
        head = f.read(3)
    assert head[:3] == b"ID3" or head[0] == 0xFF


def test_stop_unknown_session_errors():
    r = client.post("/record/stop", json={"sessionId": "nope"})
    assert r.status_code == 404


def test_record_start_with_custom_outdir_and_filename(tmp_path, monkeypatch):
    """プラグインの「録音ファイルの保存場所」「録音ファイル名」設定が MP3 保存先に反映される"""
    monkeypatch.setattr("config.TMP_DIR", str(tmp_path / "default_tmp"))
    out_dir = tmp_path / "custom_rec"
    r = client.post(
        "/record/start",
        json={"format": "wav", "outDir": str(out_dir), "fileName": "録音_2026-08-09_06-30-15"},
    )
    assert r.status_code == 200
    sid = r.json()["sessionId"]
    r = client.post("/record/stop", json={"sessionId": sid})
    assert r.status_code == 200
    body = r.json()
    assert body["audioPaths"][0].startswith(str(out_dir))
    assert body["audioPaths"][0].endswith("録音_2026-08-09_06-30-15.mp3")


def test_long_recording_is_split_into_segments(tmp_path, monkeypatch):
    """24MB（64kbps 換算）を超える録音は分割して保存される（テストでは閾値を縮小）"""
    import numpy as np
    import recorder as recorder_mod
    from main import _recorder

    monkeypatch.setattr("config.TMP_DIR", str(tmp_path))
    # 0.1 秒（1600 サンプル）で分割されるよう閾値を縮小
    monkeypatch.setattr(recorder_mod, "MAX_SEGMENT_SAMPLES", 1600)

    r = client.post("/record/start", json={"format": "wav"})
    sid = r.json()["sessionId"]
    # 実マイクの録音フレームを 0.3 秒分の無音に差し替えて分割を確実にする
    # (soundcard 仕様に合わせてキーでアクセス)
    _recorder._frames["mic"] = [np.zeros((1600 * 3, 1), dtype=np.int16)]
    r = client.post("/record/stop", json={"sessionId": sid})
    assert r.status_code == 200
    body = r.json()
    assert len(body["audioPaths"]) == 3  # 3 セグメントに分割
    for p in body["audioPaths"]:
        assert p.endswith(".mp3")
    assert body["audioPaths"][0].endswith("-1.mp3")


def test_mix_recording_echoes_audio_source(tmp_path, monkeypatch):
    """mix モード: audioSource が start/stop のレスポンスに反映され MP3 が生成される"""
    import numpy as np
    from main import _recorder

    monkeypatch.setattr("config.TMP_DIR", str(tmp_path))

    r = client.post("/record/start", json={"format": "wav", "audioSource": "mix"})
    assert r.status_code == 200
    assert r.json()["audioSource"] == "mix"
    sid = r.json()["sessionId"]
    # 両ソースのフレームを差し替えてミックス経路を確実に通す
    _recorder._frames["mic"] = [np.full((1600, 1), 1000, dtype=np.int16)]
    _recorder._frames["pc"] = [np.full((1600, 1), 2000, dtype=np.int16)]
    r = client.post("/record/stop", json={"sessionId": sid})
    assert r.status_code == 200
    body = r.json()
    assert body["audioSource"] == "mix"
    assert body["audioPaths"][0].endswith(".mp3")


def test_invalid_audio_source_rejected(tmp_path, monkeypatch):
    """不正な audioSource は 500 audio_source_failed（状態は残らない）"""
    monkeypatch.setattr("config.TMP_DIR", str(tmp_path))
    r = client.post("/record/start", json={"format": "wav", "audioSource": "bogus"})
    assert r.status_code == 500
    assert "audio_source_failed" in r.json()["detail"]


def test_start_probe_failure_leaves_clean_state(tmp_path, monkeypatch):
    """スピーカー無しで mix が 500 → 状態汚染なく次の mic 録音が開始できる"""
    import soundcard as sc

    monkeypatch.setattr("config.TMP_DIR", str(tmp_path))
    monkeypatch.setattr(
        sc, "default_speaker", lambda: (_ for _ in ()).throw(RuntimeError("no speaker"))
    )
    r = client.post("/record/start", json={"format": "wav", "audioSource": "mix"})
    assert r.status_code == 500
    assert "audio_source_failed" in r.json()["detail"]
    # 状態が汚染されていなければ、直後の mic 録音は 409 にならず開始できる
    r = client.post("/record/start", json={"format": "wav", "audioSource": "mic"})
    assert r.status_code == 200
    sid = r.json()["sessionId"]
    r = client.post("/record/stop", json={"sessionId": sid})
    assert r.status_code == 200


def test_stop_io_failure_resets_session(tmp_path, monkeypatch):
    """stop 中の I/O 例外は 500 stop_failed → セッションはリセットされ次の録音が可能"""
    from main import _recorder

    monkeypatch.setattr("config.TMP_DIR", str(tmp_path))
    monkeypatch.setattr(
        _recorder, "_save_mp3_segments", lambda *a, **k: (_ for _ in ()).throw(OSError("disk full"))
    )
    monkeypatch.setattr(
        _recorder, "_write_wav", lambda *a, **k: (_ for _ in ()).throw(OSError("disk full"))
    )
    r = client.post("/record/start", json={"format": "wav"})
    sid = r.json()["sessionId"]
    r = client.post("/record/stop", json={"sessionId": sid})
    assert r.status_code == 500
    assert "stop_failed" in r.json()["detail"]
    # セッションがリセットされているので、同じ sid は 404、新規 start は 200
    r = client.post("/record/stop", json={"sessionId": sid})
    assert r.status_code == 404
    monkeypatch.undo()  # 本物の保存処理に戻してから正常系を確認
    r = client.post("/record/start", json={"format": "wav"})
    assert r.status_code == 200
    sid2 = r.json()["sessionId"]
    r = client.post("/record/stop", json={"sessionId": sid2})
    assert r.status_code == 200


def test_capture_errors_surfaced_in_stop_result(tmp_path, monkeypatch):
    """録音スレッドで発生したデバイスエラーは stop レスポンスの captureErrors に載る"""
    from main import _recorder

    monkeypatch.setattr("config.TMP_DIR", str(tmp_path))
    r = client.post("/record/start", json={"format": "wav", "audioSource": "mix"})
    sid = r.json()["sessionId"]
    # スレッドのエラー収集を模倣（実ハードの切断はテストで再現できないため直接注入）
    _recorder._capture_errors["pc"] = "device disconnected"
    r = client.post("/record/stop", json={"sessionId": sid})
    assert r.status_code == 200
    assert r.json()["captureErrors"] == {"pc": "device disconnected"}
