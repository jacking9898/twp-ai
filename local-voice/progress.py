# SPDX-License-Identifier: MPL-2.0
"""Small, text-free startup state shared with the native messaging helper."""
import json
import os
import time
from pathlib import Path


def write_progress(home, stage, message):
    home = Path(home)
    home.mkdir(parents=True, exist_ok=True)
    data = {"stage": stage, "message": message, "at": time.time(), "pid": os.getpid()}
    temporary = home / ("progress-%s.tmp" % os.getpid())
    temporary.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    temporary.replace(home / "progress.json")
