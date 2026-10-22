#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
voice_home="${YEDU_VOICE_HOME:-$PWD/.local-data/voice}"
export YEDU_VOICE_HOME="$voice_home"
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=4
exec "$voice_home/.venv/bin/python" local-voice/launch.py "$@"
