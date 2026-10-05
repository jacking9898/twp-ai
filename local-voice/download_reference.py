# SPDX-License-Identifier: MPL-2.0
"""Install a pinned, natural Chinese prompt from the official CosyVoice demo."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import urllib.request

REVISION = "074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc"
BASE = f"https://raw.githubusercontent.com/QwenAudio/CosyVoice/{REVISION}"
SHA256 = "c7b31d6dbe7cc6a716dded00550db5b50940bf209e424e4ad207b12e657c8ff6"
PROMPT = "希望你以后能够做的比我还好呦。"
OLD_PROMPT = "你好，欢迎使用本地视频配音。让我们一起学习新的知识。"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--upgrade-default", action="store_true")
    args = parser.parse_args()
    root = Path(os.environ.get("YEDU_VOICE_HOME", Path(__file__).resolve().parents[1] / ".local-data/voice"))
    root.mkdir(parents=True, exist_ok=True)
    reference, transcript = root / "reference.wav", root / "reference.txt"
    if reference.exists():
        if not args.upgrade_default or not transcript.exists() or transcript.read_text(encoding="utf-8").strip() != OLD_PROMPT:
            print("Preserving existing reference voice.")
            return
    cache = root / "natural-reference.wav"
    data = cache.read_bytes() if cache.exists() else urllib.request.urlopen(BASE + "/asset/zero_shot_prompt.wav", timeout=60).read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError("Reference checksum mismatch")
    import soundfile
    audio, rate = soundfile.read(io.BytesIO(data), dtype="float32")
    if audio.ndim != 1 or not 3 <= len(audio) / rate <= 10:
        raise ValueError("Expected a 3–10 second mono reference")
    license_data = urllib.request.urlopen(BASE + "/LICENSE", timeout=30).read()
    if reference.exists():
        backup = root / "reference-windows-backup.wav"
        if not backup.exists():
            backup.write_bytes(reference.read_bytes())
            (root / "reference-windows-backup.txt").write_bytes(transcript.read_bytes())
    cache.write_bytes(data)
    (root / "reference-source-LICENSE.txt").write_bytes(license_data)
    soundfile.write(reference, audio, rate, subtype="PCM_16")
    transcript.write_text(PROMPT, encoding="utf-8")
    (root / "reference-source.json").write_text(json.dumps({
        "source": BASE + "/asset/zero_shot_prompt.wav", "revision": REVISION,
        "sha256": SHA256, "license": "Apache-2.0", "prompt": PROMPT,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Installed natural Chinese demo reference (3.48 seconds). Restart the model service.")


if __name__ == "__main__":
    main()
