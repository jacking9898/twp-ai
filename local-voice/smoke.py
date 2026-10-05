# SPDX-License-Identifier: MPL-2.0
import os
import time
import subprocess
from pathlib import Path
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
from engine import LocalEngine

root = Path(__file__).resolve().parents[1] / ".local-data/voice"
engine = LocalEngine(root)
if engine.missing():
    raise SystemExit("Missing: " + ", ".join(engine.missing()))
import torch
if not torch.cuda.is_available():
    raise SystemExit("CUDA unavailable; install a compatible NVIDIA driver.")
started = time.monotonic()
translated = engine.translate("Hello, welcome to the video. Today we will learn something new.")
audio, duration = engine.synthesize(translated)
(root / "smoke.wav").write_bytes(audio)
# Also load ASR while TTS stays resident to test the actual 8 GB budget.
from faster_whisper import WhisperModel
engine.asr = WhisperModel(str(root / "asr"), device="cuda", compute_type="int8_float16")
import numpy as np
segments, _ = engine.asr.transcribe(np.zeros(16000 * 4, dtype="float32"), language="en", vad_filter=True)
list(segments)
if (root / "probe-en.wav").exists():
    warm = time.monotonic()
    recognized = engine.recognize((root / "probe-en.wav").read_bytes())
    if "learn" not in recognized.lower():
        raise SystemExit("English speech smoke failed: " + recognized)
    print(f"ASR OK: {recognized} | {time.monotonic()-warm:.2f}s")
    warm = time.monotonic()
    second_audio, _ = engine.synthesize(engine.translate(recognized))
    (root / "pipeline-smoke.wav").write_bytes(second_audio)
    print(f"Warm translation + TTS: {time.monotonic()-warm:.2f}s")
print(f"OK: {translated} | {duration:.1f}s WAV | cold start {time.monotonic()-started:.1f}s")
print(f"GPU allocated: {torch.cuda.memory_allocated()/1024**3:.2f} GiB (ASR also loaded)")
subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader"], check=True)
