# SPDX-License-Identifier: MPL-2.0
"""Lazy local inference. No model downloads or remote calls during serving."""
import io
import contextlib
import os
import sys
import wave
from unittest.mock import patch
from pathlib import Path


def decode_pcm(encoded: bytes):
    import numpy as np
    with wave.open(io.BytesIO(encoded), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 16000):
            raise ValueError("音频必须是 16 kHz 单声道 PCM16 WAV")
        if not 1600 <= wav.getnframes() <= 16000 * 12:
            raise ValueError("音频长度必须在 0.1–12 秒之间")
        return np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype("float32") / 32768


class LocalEngine:
    def __init__(self, root: Path):
        self.root = root.resolve()
        os.environ["NLTK_DATA"] = str(self.root / "nltk_data")
        self.asr = self.translator = self.tokenizer = self.tts = None
        self.output_sink = open(os.devnull, "w")

    def missing(self):
        files = ["asr/model.bin", "translation/pytorch_model.bin", "reference.wav",
                 "reference.txt", "GPT-SoVITS/GPT_SoVITS/TTS_infer_pack/TTS.py",
                 "GPT-SoVITS/GPT_SoVITS/pretrained_models/s1v3.ckpt",
                 "GPT-SoVITS/GPT_SoVITS/pretrained_models/v2Pro/s2Gv2Pro.pth",
                 "GPT-SoVITS/GPT_SoVITS/pretrained_models/chinese-hubert-base/pytorch_model.bin",
                 "GPT-SoVITS/GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large/pytorch_model.bin",
                 "GPT-SoVITS/GPT_SoVITS/pretrained_models/sv/pretrained_eres2netv2w24s4ep4.ckpt"]
        if not any((self.root / "GPT-SoVITS/GPT_SoVITS/text/G2PWModel" / name).is_file() for name in ("g2pW.onnx", "g2pw.onnx")):
            files.append("GPT-SoVITS/GPT_SoVITS/text/G2PWModel/g2pW.onnx")
        return [name for name in files if not (self.root / name).is_file()]

    def translate(self, text, language="en"):
        if language.lower().startswith("zh"):
            return text
        if language not in ("en", "auto"):
            raise ValueError("本地配音第一版支持英语 → 简体中文；中文字幕可直接配音")
        if self.translator is None:
            from transformers import MarianMTModel, MarianTokenizer
            path = str(self.root / "translation")
            self.tokenizer = MarianTokenizer.from_pretrained(path, local_files_only=True)
            self.translator = MarianMTModel.from_pretrained(path, local_files_only=True).eval()
        import torch
        batch = self.tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
        with torch.inference_mode():
            result = self.translator.generate(**batch, max_new_tokens=256)
        return self.tokenizer.decode(result[0], skip_special_tokens=True)

    def recognize(self, audio):
        if self.asr is None:
            import torch
            if os.name == "nt":
                self.cuda_dlls = os.add_dll_directory(str(Path(torch.__file__).parent / "lib"))
            from faster_whisper import WhisperModel
            self.asr = WhisperModel(str(self.root / "asr"), device="cuda", compute_type="int8_float16")
        segments, _ = self.asr.transcribe(decode_pcm(audio), language="en", beam_size=1,
                                          vad_filter=True, condition_on_previous_text=False)
        return " ".join(row.text.strip() for row in segments).strip()

    def synthesize(self, text):
        # Upstream prints normalized input text during inference. Suppress it
        # so the local server does not log users' subtitle contents.
        with contextlib.redirect_stdout(self.output_sink), contextlib.redirect_stderr(self.output_sink), patch("torchaudio.load", self._load_wave):
            return self._synthesize(text)

    @staticmethod
    def _load_wave(path, *args, **kwargs):
        # Current torchaudio delegates load() to TorchCodec. Our sole input is
        # a local reference WAV, for which libsndfile avoids an extra codec stack.
        import soundfile
        import torch
        samples, rate = soundfile.read(path, dtype="float32", always_2d=True)
        return torch.from_numpy(samples.T.copy()), rate

    def warmup(self):
        self.synthesize(self.translate("Welcome to local video dubbing."))
        silent = io.BytesIO()
        with wave.open(silent, "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes(b"\0" * 16000 * 2)
        self.recognize(silent.getvalue())

    def _synthesize(self, text):
        if self.tts is None:
            # Upstream uses relative paths for auxiliary speaker/language models.
            repo = self.root / "GPT-SoVITS"
            os.chdir(repo)
            sys.path[:0] = [str(repo), str(repo / "GPT_SoVITS")]
            from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config
            import fast_langdetect
            # Restrict language detection to its bundled model, even when the
            # upstream splitter requests high-memory detection. No live fetch.
            fast_langdetect.infer._default_detector = fast_langdetect.infer.LangDetector(
                fast_langdetect.infer.LangDetectConfig(custom_model_path=str(fast_langdetect.infer._LOCAL_SMALL_MODEL_PATH)))
            models = repo / "GPT_SoVITS/pretrained_models"
            config = TTS_Config({"custom": {
                "device": "cuda", "is_half": True, "version": "v2Pro",
                "t2s_weights_path": str(models / "s1v3.ckpt"),
                "vits_weights_path": str(models / "v2Pro/s2Gv2Pro.pth"),
                "bert_base_path": str(models / "chinese-roberta-wwm-ext-large"),
                "cnhuhbert_base_path": str(models / "chinese-hubert-base"),
            }})
            self.tts = TTS(config)
        import numpy as np
        parts = []
        rate = 32000
        for rate, audio in self.tts.run({
            "text": text, "text_lang": "zh", "ref_audio_path": str(self.root / "reference.wav"),
            "prompt_text": (self.root / "reference.txt").read_text(encoding="utf-8").strip(),
            "prompt_lang": "zh", "text_split_method": "cut5", "batch_size": 1,
            "split_bucket": False, "return_fragment": False, "parallel_infer": False,
            "streaming_mode": False, "seed": 42, "fragment_interval": 0.12,
        }):
            parts.append(audio)
        samples = np.concatenate(parts) if parts else np.zeros(0, dtype="int16")
        if not len(samples):
            raise ValueError("配音模型未生成音频")
        if samples.dtype != np.int16:
            samples = (np.clip(samples, -1, 1) * 32767).astype("int16")
        # Remove model padding but retain a short natural lead/tail. Apply a
        # 5 ms fade to avoid clicks at phrase boundaries.
        magnitude = np.abs(samples.astype("float32"))
        audible = np.flatnonzero(magnitude > max(128, float(magnitude.max()) * 0.01))
        if len(audible):
            margin = int(rate * 0.08)
            samples = samples[max(0, audible[0] - margin):min(len(samples), audible[-1] + margin + 1)].copy()
        fade = min(int(rate * 0.005), len(samples) // 2)
        if fade:
            samples[:fade] = (samples[:fade] * np.linspace(0, 1, fade)).astype("int16")
            samples[-fade:] = (samples[-fade:] * np.linspace(1, 0, fade)).astype("int16")
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(samples.astype("<i2").tobytes())
        return output.getvalue(), len(samples) / rate
