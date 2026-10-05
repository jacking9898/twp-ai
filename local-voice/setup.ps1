# SPDX-License-Identifier: MPL-2.0
param([string]$Python = 'python', [string]$ReferenceAudio, [string]$ReferenceText)
$ErrorActionPreference = 'Stop'
$voiceHome = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.local-data/voice'))
New-Item -ItemType Directory -Force -Path $voiceHome | Out-Null
function Run-Native([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed ($LASTEXITCODE)" }
}
$runtime = Join-Path $voiceHome '.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $runtime)) { Run-Native $Python @('-m', 'venv', (Join-Path $voiceHome '.venv')) }
Run-Native $runtime @('-c', 'import sys; assert (3,11) <= sys.version_info[:2] <= (3,12), "Use Python 3.11 or 3.12"')
if (Get-Command uv -ErrorAction SilentlyContinue) {
    Run-Native 'uv' @('pip','install','--python',$runtime,'torch>=2.7,<2.12','torchaudio>=2.7,<2.12','--index-url','https://download.pytorch.org/whl/cu128')
    Run-Native 'uv' @('pip','install','--python',$runtime,'-r',(Join-Path $PSScriptRoot 'requirements.txt'))
} else {
    Run-Native $runtime @('-m','pip','install','torch>=2.7,<2.12','torchaudio>=2.7,<2.12','--index-url','https://download.pytorch.org/whl/cu128')
    Run-Native $runtime @('-m','pip','install','-r',(Join-Path $PSScriptRoot 'requirements.txt'))
}
if (!(Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'Install ffmpeg and add ffmpeg.exe to PATH.' }
Run-Native $runtime @((Join-Path $PSScriptRoot 'download_source.py'))
Run-Native $runtime @((Join-Path $PSScriptRoot 'download_models.py'))
Run-Native $runtime @((Join-Path $PSScriptRoot 'download_aux.py'))
if ($ReferenceAudio) {
    if (!$ReferenceText) { throw 'ReferenceText is required with ReferenceAudio (Chinese, 3-10 seconds).' }
    Copy-Item -LiteralPath $ReferenceAudio -Destination (Join-Path $voiceHome 'reference.wav')
    [IO.File]::WriteAllText((Join-Path $voiceHome 'reference.txt'), $ReferenceText, [Text.UTF8Encoding]::new($false))
} elseif (!(Test-Path -LiteralPath (Join-Path $voiceHome 'reference.wav'))) {
    Run-Native $runtime @((Join-Path $PSScriptRoot 'download_reference.py'))
}
if (!(Test-Path -LiteralPath (Join-Path $voiceHome 'probe-en.wav'))) {
    Run-Native 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'create_reference.ps1'),'-ProbeOnly')
}
Run-Native $runtime @((Join-Path $PSScriptRoot 'smoke.py'))
Write-Host 'Local dubbing ready. Run local-voice/start.ps1 and enable local dubbing in the video menu.'
