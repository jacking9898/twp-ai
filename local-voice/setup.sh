#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'This installer requires Apple Silicon macOS.' >&2; exit 1
fi
voice_home="${YEDU_VOICE_HOME:-$PWD/.local-data/voice}"
export YEDU_VOICE_HOME="$voice_home"
python_bin="${YEDU_PYTHON:-python3.11}"
"$python_bin" -m venv "$voice_home/.venv"
"$voice_home/.venv/bin/python" -m pip install -r local-voice/requirements-mac.txt
"$voice_home/.venv/bin/python" local-voice/setup_mac.py "$@"
"$voice_home/.venv/bin/python" local-voice/install_bridge.py || printf "请在 Chrome 加载页渡后，双击 local-voice/安装本地连接.command 完成首次连接。\n"
