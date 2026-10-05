# SPDX-License-Identifier: MPL-2.0
# Run using Windows PowerShell 5.1 for the built-in .NET Framework speech API.
param([switch]$ProbeOnly)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$voiceHome = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.local-data/voice'))
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    if (!$ProbeOnly) {
    $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
    if (!$voice) { throw 'No Chinese Windows voice; provide ReferenceAudio and ReferenceText to setup.ps1.' }
    $synth.SelectVoice($voice.VoiceInfo.Name)
    $synth.Rate = -1
    $prompt = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'default-reference.txt') -Encoding UTF8 -Raw).Trim()
    $synth.SetOutputToWaveFile((Join-Path $voiceHome 'reference.wav'))
    $synth.Speak($prompt)
    [IO.File]::WriteAllText((Join-Path $voiceHome 'reference.txt'), $prompt, [Text.UTF8Encoding]::new($false))
    }
    $english = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'en-US' } | Select-Object -First 1
    if ($english) {
        $synth.SelectVoice($english.VoiceInfo.Name)
        $synth.Rate = 0
        $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
        $synth.SetOutputToWaveFile((Join-Path $voiceHome 'probe-en.wav'), $format)
        $synth.Speak('Hello. Today we will learn about machine learning.')
    }
} finally { $synth.Dispose() }
