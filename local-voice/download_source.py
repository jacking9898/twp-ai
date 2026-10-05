# SPDX-License-Identifier: MPL-2.0
import io
import json
import urllib.request
import zipfile
from pathlib import Path

# Known official source snapshot. Do not execute moving-branch source implicitly.
REVISION = "48b1a0169a28582a8984402f82cf438d3bfa6aca"
root = Path(__file__).resolve().parents[1] / ".local-data/voice"
destination = root / "GPT-SoVITS"
if not (destination / "GPT_SoVITS/TTS_infer_pack/TTS.py").exists():
    data = urllib.request.urlopen(f"https://codeload.github.com/RVC-Boss/GPT-SoVITS/zip/{REVISION}", timeout=90).read()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        prefix = archive.namelist()[0].split("/")[0] + "/"
        for entry in archive.infolist():
            relative = entry.filename.removeprefix(prefix)
            target = (destination / relative).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError("Unsafe archive path")
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(entry))
    (root / "upstream-revision.txt").write_text(REVISION + "\n", encoding="ascii")
print("GPT-SoVITS source ready:", REVISION)
