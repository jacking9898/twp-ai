# SPDX-License-Identifier: MPL-2.0
"""Named reference voices, stored only under the local model directory."""
import io
import json
import re
import uuid
import wave
from pathlib import Path
from engine import decode_pcm


class VoiceProfiles:
    def __init__(self, root):
        self.root = Path(root) / "profiles"

    def get(self, profile_id):
        if not isinstance(profile_id, str) or not re.fullmatch(r"[a-f0-9]{32}", profile_id):
            raise ValueError("无效人物音色")
        folder = self.root / profile_id
        try:
            data = json.loads((folder / "profile.json").read_text(encoding="utf-8"))
            if data["id"] != profile_id or data["language"] not in ("en", "zh") or not (folder / "reference.wav").is_file():
                raise ValueError()
            return {**data, "path": str(folder / "reference.wav")}
        except (OSError, KeyError, ValueError):
            raise ValueError("人物音色不存在，请刷新音色列表")

    def list(self):
        rows = []
        for folder in sorted(self.root.glob("*")):
            try:
                data = self.get(folder.name)
                rows.append({key: data[key] for key in ("id", "name", "language", "duration")})
            except ValueError:
                continue
        return rows

    def create(self, name, audio, text, language):
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise ValueError("请填写不超过 80 字的人物或系列名称")
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500 or language not in ("en", "zh"):
            raise ValueError("请核对参考原声的文字和语言")
        samples = decode_pcm(audio)
        if not 3 * 16000 <= len(samples) <= 10 * 16000:
            raise ValueError("参考原声需要 3–10 秒")
        if float((samples ** 2).mean()) < 0.00001:
            raise ValueError("参考原声太轻或没有声音，请重新采集")
        if len(self.list()) >= 50:
            raise ValueError("最多保存 50 个人物音色")
        profile_id = uuid.uuid4().hex
        folder = self.root / profile_id
        folder.mkdir(parents=True)
        # Keep only normalized PCM, never caller-provided filenames or paths.
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes((samples * 32768).clip(-32768, 32767).astype("<i2").tobytes())
        (folder / "reference.wav").write_bytes(output.getvalue())
        data = {"id": profile_id, "name": name.strip(), "text": text.strip(), "language": language, "duration": len(samples) / 16000}
        temporary = folder / "profile.tmp"
        temporary.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        temporary.replace(folder / "profile.json")
        return {key: data[key] for key in ("id", "name", "language", "duration")}
