#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
./.local-data/voice/.venv/bin/python local-voice/install_bridge.py
printf '\n按回车关闭此窗口。'
read answer
