# SPDX-License-Identifier: MPL-2.0
"""One-time per-user native host registration for the installed local service."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import sys

NAME = "com.yedu.local_voice"
ROOT = Path(__file__).resolve().parents[1]


def discover_ids(browser_root):
    ids = set()
    paths = {str(ROOT / "src"), str(ROOT / "build/TWP_AI_0.1.0_Chromium_MV3")}
    for profile in browser_root.glob("*"):
        if not profile.is_dir() or profile.name == "NativeMessagingHosts":
            continue
        for name in ("Preferences", "Secure Preferences"):
            try:
                entries = json.loads((profile / name).read_text()).get("extensions", {}).get("settings", {})
                for key, value in entries.items():
                    if value.get("path") in paths and re.fullmatch("[a-p]{32}", key):
                        ids.add(key)
            except (OSError, ValueError):
                pass
    return ids


def install(browser_root, extension_ids):
    ids = set(extension_ids) | discover_ids(browser_root)
    if not ids or any(not re.fullmatch("[a-p]{32}", value) for value in ids):
        raise ValueError("请先在 Chrome 中加载页渡扩展，再双击安装。模型服务页面会显示扩展 ID。")
    voice_home = Path(os.environ.get("YEDU_VOICE_HOME", ROOT / ".local-data/voice"))
    interpreter = voice_home / ".venv/bin/python"
    if not interpreter.is_file():
        raise ValueError("请先安装本地语音模型。")
    host = voice_home / "native-host"
    host.parent.mkdir(parents=True, exist_ok=True)
    host.write_text("#!/bin/sh\nexport YEDU_VOICE_HOME=" + shlex.quote(str(voice_home)) + "\nexec " + shlex.quote(str(interpreter)) + " " + shlex.quote(str(ROOT / "local-voice/native_host.py")) + ' "$@"\n')
    host.chmod(0o700)
    folder = browser_root / "NativeMessagingHosts"
    folder.mkdir(parents=True, exist_ok=True)
    manifest = folder / (NAME + ".json")
    if manifest.exists():
        old = json.loads(manifest.read_text())
        if old.get("path") != str(host):
            raise ValueError("已存在另一个安装位置的页渡连接组件，请先移除旧组件。")
        ids.update(origin.removeprefix("chrome-extension://").removesuffix("/") for origin in old.get("allowed_origins", []))
        if any(not re.fullmatch("[a-p]{32}", value) for value in ids):
            raise ValueError("旧连接组件的扩展 ID 无效。")
    manifest.write_text(json.dumps({"name": NAME, "description": "Yedu local voice model launcher", "path": str(host),
        "type": "stdio", "allowed_origins": ["chrome-extension://" + value + "/" for value in sorted(ids)]}, indent=2))
    print("本地连接已安装。返回模型服务页面，点击重新检测；以后开启视频语音翻译即可自动启动模型。")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--extension-id", action="append", default=[])
    parser.add_argument("--browser-root", type=Path, default=Path.home() / "Library/Application Support/Google/Chrome")
    args = parser.parse_args()
    try:
        if sys.platform != "darwin":
            raise ValueError("当前自动启动连接组件支持 macOS Chrome。")
        install(args.browser_root, args.extension_id)
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
