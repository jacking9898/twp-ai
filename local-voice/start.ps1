# SPDX-License-Identifier: MPL-2.0
param([switch]$Foreground)
$ErrorActionPreference = 'Stop'
$voiceHome = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.local-data/voice'))
$runtime = Join-Path $voiceHome '.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $runtime)) { throw 'Run local-voice/setup.ps1 first (Python 3.11 / 3.12 + NVIDIA GPU required).' }
$env:YEDU_VOICE_HOME = $voiceHome
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
$env:HF_HUB_DISABLE_TELEMETRY = '1'
$env:NLTK_DATA = Join-Path $voiceHome 'nltk_data'
$env:PYTHONUTF8 = '1'
$launchArgs = @((Join-Path $PSScriptRoot 'launch.py'))
if ($Foreground) { $launchArgs += '--foreground' }
& $runtime @launchArgs
if ($LASTEXITCODE -ne 0) { throw "Local service exited ($LASTEXITCODE)" }
