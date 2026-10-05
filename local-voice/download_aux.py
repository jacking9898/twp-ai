# SPDX-License-Identifier: MPL-2.0
"""Preload pronunciation/language resources instead of downloading at runtime."""
import hashlib
import json
import urllib.request
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1] / ".local-data/voice"
destination = root / "GPT-SoVITS/GPT_SoVITS/text/G2PWModel"
if not (destination / "g2pW.onnx").exists() and not (destination / "g2pw.onnx").exists():
    downloads = root / "downloads"
    downloads.mkdir(exist_ok=True)
    archive_path = downloads / "G2PWModel_1.1.zip"
    if not archive_path.exists():
        temporary = archive_path.with_suffix(".part")
        with urllib.request.urlopen("https://www.modelscope.cn/models/kamiorinn/g2pw/resolve/master/G2PWModel_1.1.zip", timeout=90) as response, temporary.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        temporary.replace(archive_path)
    with zipfile.ZipFile(archive_path) as archive:
        for entry in archive.infolist():
            relative = entry.filename.split("/", 1)[-1]
            target = (destination / relative).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError("Unsafe model archive path")
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(entry))
    digest = hashlib.file_digest(archive_path.open("rb"), "sha256").hexdigest()
    (root / "g2pw-sha256.txt").write_text(digest + "\n", encoding="ascii")

if __name__ == "__main__":
    # Language detector cache is the same location configured by GPT-SoVITS.
    import fast_langdetect
    detector = fast_langdetect.infer.LangDetector(fast_langdetect.infer.LangDetectConfig(
        cache_dir=root / "GPT-SoVITS/GPT_SoVITS/pretrained_models/fast_langdetect"))
    detector.detect("Hello, welcome to the local video dubbing service.")
    cache = root / "nltk_data"
    for category, name in (("taggers", "averaged_perceptron_tagger"), ("taggers", "averaged_perceptron_tagger_eng"), ("corpora", "cmudict")):
        target = cache / category
        if (target / name).exists():
            continue
        import io
        url = f"https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/{category}/{name}.zip"
        data = urllib.request.urlopen(url, timeout=30).read()
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for entry in archive.infolist():
                path = (target / entry.filename).resolve()
                if not path.is_relative_to(target.resolve()):
                    raise ValueError("Unsafe NLTK archive path")
                if entry.is_dir():
                    path.mkdir(parents=True, exist_ok=True)
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(archive.read(entry))
    print("Pronunciation and language resources ready")
