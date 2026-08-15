"""Reproduction Step C: 10 秒录音振幅测试。
Test 1: default_microphone (Intel Smart Sound 阵列)
Test 2: 蓝牙耳机 JM19 麦克风（如果存在）

请在开始测试前，先对着你准备测试的麦克风说话 10 秒。
脚本结束后会输出每个测试的 max/mean 振幅。
"""
import sys
import numpy as np
import soundcard as sc

SR = 16000
SECONDS = 10
CHUNK = 1600  # same as Recorder.CHUNK_SAMPLES


def measure(mic, label: str) -> dict:
    print(f"\n--- {label} ---")
    print(f"  mic.name = {mic.name!r}")
    print(f"  mic.id   = {mic.id!r}")
    print(f"  recording {SECONDS}s @ {SR}Hz, please SPEAK NOW...")
    sys.stdout.flush()
    chunks = []
    try:
        with mic.recorder(samplerate=SR, channels=1) as rec:
            frames_needed = SR * SECONDS
            got = 0
            while got < frames_needed:
                n = min(CHUNK, frames_needed - got)
                data = rec.record(numframes=n)
                chunks.append(data)
                got += len(data)
    except Exception as e:
        print(f"  ERROR: {e!r}")
        return {"label": label, "error": repr(e)}

    audio = np.concatenate(chunks, axis=0)
    max_abs = float(np.max(np.abs(audio))) if len(audio) else 0.0
    mean_abs = float(np.mean(np.abs(audio))) if len(audio) else 0.0
    rms = float(np.sqrt(np.mean(audio.astype(np.float32) ** 2))) if len(audio) else 0.0
    silent = max_abs < 0.01
    print(f"  frames    = {len(audio)}")
    print(f"  max_abs   = {max_abs:.6f}")
    print(f"  mean_abs  = {mean_abs:.6f}")
    print(f"  rms       = {rms:.6f}")
    print(f"  verdict   = {'🔇 SILENT (likely root cause!)' if silent else '🔊 HAS AUDIO'}")
    sys.stdout.flush()
    return {
        "label": label,
        "mic_name": mic.name,
        "max_abs": max_abs,
        "mean_abs": mean_abs,
        "rms": rms,
        "silent": silent,
    }


def main():
    print("=== Step C: 10-second recording amplitude test ===")
    print("Two tests will run sequentially. Please speak for ~10s at each test.\n")

    # Test 1: default microphone
    dm = sc.default_microphone()
    r1 = measure(dm, "Test 1: default_microphone (what GijiObsidian currently uses)")

    # Test 2: find and test the BT mic
    bt_mic = None
    for m in sc.all_microphones():
        if "JM19" in m.name or "蓝牙" in m.name or "Bluetooth" in m.name.lower() or "Hands-Free" in m.name:
            bt_mic = m
            break

    if bt_mic is None:
        print("\n--- Test 2: SKIPPED (no Bluetooth mic detected) ---")
        r2 = None
    else:
        r2 = measure(bt_mic, "Test 2: Bluetooth mic (JM19)")

    print("\n=== SUMMARY ===")
    for r in (r1, r2):
        if r is None:
            continue
        print(
            f"  [{r['label']}]  silent={r.get('silent')}  "
            f"max={r.get('max_abs', 0):.6f}  mean={r.get('mean_abs', 0):.6f}"
        )


if __name__ == "__main__":
    main()
