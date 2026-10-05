# SPDX-License-Identifier: MPL-2.0
"""Pinned weights; ModelScope large files must match primary HF SHA-256 hashes."""
import fnmatch
import hashlib
import json
import urllib.error
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1] / ".local-data/voice"
manifest = root / "model-revisions.json"
revisions = json.loads(manifest.read_text()) if manifest.exists() else {}
defaults = {
    "Systran/faster-whisper-small.en": "d1d751a5f8271d482d14ca55d9e2deeebbae577f",
    "Helsinki-NLP/opus-mt-en-zh": "408d9bc410a388e1d9aef112a2daba955b945255",
    "lj1995/GPT-SoVITS": "336b2ec4e8d4ac74740798dd40af44e74659ecaf",
}
models = [
    ("Systran/faster-whisper-small.en", "systran/faster-whisper-small.en", "", root / "asr", ["model.bin", "*.json", "vocabulary.*"]),
    ("Helsinki-NLP/opus-mt-en-zh", "Helsinki-NLP/opus-mt-en-zh", "", root / "translation", ["pytorch_model.bin", "*.json", "*.spm"]),
    ("lj1995/GPT-SoVITS", "XXXXRT/GPT-SoVITS-Pretrained", "pretrained_models/", root / "GPT-SoVITS/GPT_SoVITS/pretrained_models", [
        "chinese-hubert-base/*", "chinese-roberta-wwm-ext-large/*", "s1v3.ckpt",
        "v2Pro/s2Gv2Pro.pth", "sv/pretrained_eres2netv2w24s4ep4.ckpt"]),
]
for repo, mirror, prefix, destination, patterns in models:
    suffix = "/revision/" + revisions.get(repo, defaults[repo])
    info = json.load(urllib.request.urlopen(f"https://huggingface.co/api/models/{repo}{suffix}?blobs=true", timeout=25))
    revision = info["sha"]
    revisions[repo] = revision
    manifest.write_text(json.dumps(revisions, indent=2) + "\n", encoding="utf-8")
    for row in info["siblings"]:
        name = row["rfilename"]
        if not any(fnmatch.fnmatch(name, pattern) for pattern in patterns) or name.endswith((".safetensors", ".h5", ".msgpack")):
            continue
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = row.get("lfs", {}).get("sha256")
        if target.exists() and (not digest or hashlib.file_digest(target.open("rb"), "sha256").hexdigest() == digest):
            continue
        primary = f"https://huggingface.co/{repo}/resolve/{revision}/{name}"
        url = f"https://www.modelscope.cn/models/{mirror}/resolve/master/{prefix}{name}" if digest else primary
        temporary = target.with_suffix(target.suffix + ".part")
        try:
            response = urllib.request.urlopen(url, timeout=60)
        except (urllib.error.URLError, TimeoutError):
            if url == primary:
                raise
            response = urllib.request.urlopen(primary, timeout=30)
        with response, temporary.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        if digest and hashlib.file_digest(temporary.open("rb"), "sha256").hexdigest() != digest:
            raise ValueError("Model checksum mismatch: " + name)
        temporary.replace(target)
        print("Downloaded and verified:", repo, name, flush=True)
