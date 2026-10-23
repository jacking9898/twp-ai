# SPDX-License-Identifier: MPL-2.0
"""Download public weights once, record exact revisions, preserve existing voices."""
import json
import argparse
import os
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

ROOT = Path(os.environ.get("YEDU_VOICE_HOME", Path(__file__).resolve().parents[1] / ".local-data/voice"))
MODELS = {"asr-mlx": "mlx-community/whisper-small.en-mlx",
          "tts-mlx": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit",
          "translation-mlx-4b": "mlx-community/Qwen3-4B-Instruct-2507-4bit"}


def main():
    parser = argparse.ArgumentParser(description="Install local speech models; custom AI handles translation by default.")
    parser.add_argument("--offline-translation", action="store_true", help="Also download the optional Qwen3 offline translation model")
    args = parser.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    record = ROOT / "mac-models.json"
    revisions = json.loads(record.read_text()) if record.exists() else {}
    for folder, repo in MODELS.items():
        if folder.startswith("translation-") and not args.offline_translation:
            continue
        revision = revisions.get(folder, {}).get("revision") or HfApi().model_info(repo).sha
        print("Downloading " + repo + " @ " + revision, flush=True)
        snapshot_download(repo, revision=revision, local_dir=ROOT / folder,
            ignore_patterns=["*.msgpack", "*.h5", "*.ot", "*.onnx", "*.tflite", "rust_model*"], max_workers=2)
        revisions[folder] = {"repo": repo, "revision": revision}
        record.write_text(json.dumps(revisions, indent=2), encoding="utf-8")
    from download_reference import main as reference
    reference()


if __name__ == "__main__":
    main()
