# SPDX-License-Identifier: MPL-2.0
"""Loopback-only English → Chinese dubbing service, run with start.ps1."""
import asyncio
import base64
import binascii
import os
import secrets
import time
import hashlib
import io
import platform
import tempfile
from contextlib import asynccontextmanager
from collections import OrderedDict
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from engine import LocalEngine, decode_pcm
from voice_profiles import VoiceProfiles

ROOT = Path(os.environ.get("YEDU_VOICE_HOME", Path(__file__).resolve().parents[1] / ".local-data/voice"))
MAX_BODY = 600_000


def default_engine():
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        from mac_engine import MacEngine
        return MacEngine(ROOT)
    return LocalEngine(ROOT)


def create_app(engine=None, profile_root=None):
    engine = engine or default_engine()
    profiles = VoiceProfiles(profile_root or getattr(engine, "root", ROOT))
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    sessions = OrderedDict()
    cache = OrderedDict()
    inference = asyncio.Lock()
    streams = OrderedDict()
    speech_tickets = OrderedDict()
    queued = 0

    @asynccontextmanager
    async def live_slot():
        nonlocal queued
        if queued >= 3:
            raise HTTPException(429, "本地模型正在处理，请稍后重试")
        queued += 1
        try:
            try:
                await asyncio.wait_for(inference.acquire(), timeout=10)
            except TimeoutError:
                raise HTTPException(429, "本地模型正在处理，请稍后重试")
        finally:
            queued -= 1
        try:
            yield
        finally:
            inference.release()

    @app.middleware("http")
    async def guard(request, call_next):
        # Never accept arbitrary website origins, redirects, or DNS rebinding.
        host = request.headers.get("host", "").split(":")[0]
        origin = request.headers.get("origin", "")
        if host not in ("127.0.0.1", "localhost") or (origin and not origin.startswith(("chrome-extension://", "moz-extension://"))):
            return JSONResponse({"detail": "只允许本机扩展访问"}, status_code=403)
        if request.method != "POST" or request.headers.get("x-yedu-voice") != "1":
            return JSONResponse({"detail": "需要扩展请求头"}, status_code=403)
        try:
            if int(request.headers.get("content-length", "0")) > MAX_BODY:
                return JSONResponse({"detail": "请求过大"}, status_code=413)
        except ValueError:
            return JSONResponse({"detail": "无效长度"}, status_code=400)
        return await call_next(request)

    async def body(request, auth=True):
        raw = bytearray()
        async for part in request.stream():
            raw.extend(part)
            if len(raw) > MAX_BODY:
                raise HTTPException(413, "请求过大")
        if auth:
            token = request.headers.get("authorization", "").removeprefix("Bearer ")
            if sessions.get(token, 0) < time.monotonic():
                raise HTTPException(401, "连接已过期，请重新连接本地服务")
        import json
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeError):
            raise HTTPException(400, "无效 JSON")
        if not isinstance(value, dict):
            raise HTTPException(400, "无效请求")
        return value

    @app.post("/status")
    async def service_status(request: Request):
        await body(request, False)
        missing = engine.missing()
        return {"state": "error" if missing else "ready", "model": getattr(engine, "model_label", "local-voice"),
                "message": "模型文件不完整" if missing else "模型已就绪"}

    @app.post("/session")
    async def session(request: Request):
        await body(request, False)
        missing = engine.missing()
        if missing:
            raise HTTPException(503, "请先运行 setup.ps1；缺少：" + ", ".join(missing))
        token = secrets.token_urlsafe(32)
        sessions[token] = time.monotonic() + 24 * 3600
        while len(sessions) > 64:
            sessions.popitem(last=False)
        return {"token": token, "model": getattr(engine, "model_label", "local-voice"), "target": "zh-CN", "capabilities": ["live-reference", "timings", "external-translation"]}

    def dub(text, language, profile_id="", live_reference=None, context=""):
        if not isinstance(profile_id, str):
            raise ValueError("无效人物音色")
        reference = profiles.get(profile_id) if profile_id else live_reference
        voice_key = profile_id or (reference or {}).get("key", "")
        key = (text, language, voice_key, context)
        if key in cache:
            cache.move_to_end(key)
            return cache[key]
        if language.lower().startswith("zh"):
            translated = text
        else:
            translated = engine.translate(text, language, context=context) if context else engine.translate(text, language)
        audio, duration = engine.synthesize(translated, reference) if reference else engine.synthesize(translated)
        if len(audio) > 4_000_000:
            raise ValueError("合成音频过长，请缩短字幕")
        result = {"text": text, "translated": translated, "audio": base64.b64encode(audio).decode(), "duration": duration, "voiceProfileId": profile_id}
        cache[key] = result
        # Cache only in RAM; bound by bytes as well as count.
        while len(cache) > 64 or sum(len(row["audio"]) for row in cache.values()) > 32_000_000:
            cache.popitem(last=False)
        return result

    def live_dub(text, profile_id, state, context="", language="en"):
        reference = state.get("reference")
        if profile_id or not reference:
            return dub(text, language, profile_id, context=context)
        # Source speech is temporary: never silently create a saved voice profile.
        with tempfile.TemporaryDirectory(prefix="yedu-voice-") as folder:
            path = Path(folder) / "reference.wav"
            path.write_bytes(reference["audio"])
            return dub(text, language, "", {"path": str(path), "text": reference["text"],
                "language": "en", "key": reference["key"]}, context=context)

    def reference_audio(data):
        try:
            encoded = data.get("audio")
            if not isinstance(encoded, str) or len(encoded) > 430_000:
                raise ValueError()
            return base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(400, "无效参考音频")

    @app.post("/profiles/list")
    async def list_profiles(request: Request):
        await body(request)
        return {"profiles": profiles.list()}

    @app.post("/profiles/create")
    async def create_profile(request: Request):
        data = await body(request)
        try:
            return {"profile": profiles.create(data.get("name"), reference_audio(data), data.get("text"), data.get("language"))}
        except (ValueError, wave.Error, EOFError) as error:
            raise HTTPException(400, str(error))

    @app.post("/reference-text")
    async def reference_text(request: Request):
        data = await body(request)
        if inference.locked():
            raise HTTPException(429, "本地模型正在处理，请结束配音后重试采集")
        async with inference:
            try:
                text = await asyncio.to_thread(engine.recognize, reference_audio(data))
                return {"text": text}
            except (ValueError, RuntimeError, OSError, wave.Error, EOFError) as error:
                raise HTTPException(400, str(error)[:250])

    @app.post("/dub")
    async def synthesize(request: Request):
        data = await body(request)
        text, language = data.get("text"), data.get("language", "en")
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500 or language not in ("en", "auto", "zh", "zh-CN", "zh-TW"):
            raise HTTPException(400, "需要不超过 500 字的英语或中文字幕")
        if inference.locked():
            raise HTTPException(429, "本地模型正在处理另一请求，请稍后重试")
        async with inference:
            try:
                return await asyncio.to_thread(dub, text.strip(), language, data.get("voiceProfileId", ""))
            except (ValueError, RuntimeError, OSError, ImportError) as error:
                raise HTTPException(503, "本地配音失败：" + str(error)[:250])

    @app.post("/speak")
    async def speak_translation(request: Request):
        data = await body(request)
        ticket, text = data.get("ticket"), data.get("translated")
        if not isinstance(ticket, str) or not isinstance(text, str) or not 1 <= len(text.strip()) <= 500:
            raise HTTPException(400, "无效中文配音请求")
        item = speech_tickets.get(ticket)
        if not item or item["token"] != request.headers.get("authorization", "") or time.monotonic() - item["at"] > 60:
            raise HTTPException(400, "原声片段已过期，请继续播放重新采集")
        speech_tickets.pop(ticket)
        async with live_slot():
            start = time.perf_counter()
            try:
                result = await asyncio.to_thread(live_dub, text.strip(), item["profile"], item["state"], language="zh")
                return {**result, "text": item["text"], "voiceSource": item["voiceSource"],
                        "timings": {"speech": round(time.perf_counter() - start, 3)}}
            except (ValueError, RuntimeError, OSError, ImportError) as error:
                raise HTTPException(503, "本地配音失败：" + str(error)[:250])

    @app.post("/recognize-dub")
    async def recognize(request: Request):
        data = await body(request)
        stream_id = data.get("streamId", "")
        if not isinstance(stream_id, str) or len(stream_id) > 80 or (stream_id and not all(c.isalnum() or c in "_-" for c in stream_id)):
            raise HTTPException(400, "无效音频会话")
        if not isinstance(data.get("autoVoice", False), bool) or (data.get("autoVoice") and not stream_id):
            raise HTTPException(400, "原声音色需要独立音频会话")
        try:
            encoded = data.get("audio")
            if not isinstance(encoded, str) or len(encoded) > 520_000:
                raise ValueError()
            audio = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(400, "无效音频")
        if not isinstance(data.get("recognizeOnly", False), bool):
            raise HTTPException(400, "无效识别模式")
        async with live_slot():
            def process():
                started = time.perf_counter()
                samples = decode_pcm(audio)
                token = request.headers.get("authorization", "")
                key = (token, stream_id)
                now = time.monotonic()
                for old in list(streams):
                    if now - streams[old]["updated"] > 300:
                        del streams[old]
                state = streams.pop(key, {"prompt": "", "parts": [], "texts": [], "samples": 0})
                state["updated"] = now
                if stream_id:
                    streams[key] = state
                    while len(streams) > 16:
                        streams.popitem(last=False)
                preceding = state["prompt"]
                text = engine.recognize(audio, prompt=preceding) if stream_id else engine.recognize(audio)
                recognized = time.perf_counter()
                if text:
                    state["prompt"] = (state["prompt"] + " " + text)[-240:]
                auto_voice = data.get("autoVoice", False) and not data.get("voiceProfileId")
                if text and auto_voice and not state.get("reference") and float((samples ** 2).mean()) >= .00001:
                    state["parts"].append(samples)
                    state["texts"].append(text)
                    state["samples"] += len(samples)
                    if state["samples"] >= 3 * 16000:
                        import numpy as np
                        joined = np.concatenate(state["parts"])
                        output = io.BytesIO()
                        with wave.open(output, "wb") as wav:
                            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
                            wav.writeframes((joined * 32768).clip(-32768, 32767).astype("<i2").tobytes())
                        reference = output.getvalue()
                        state["reference"] = {"audio": reference, "text": " ".join(state["texts"]),
                            "key": hashlib.sha256(reference).hexdigest()}
                        state["parts"] = []; state["texts"] = []
                if data.get("recognizeOnly"):
                    voice_source = "speaker" if auto_voice and state.get("reference") else "profile" if data.get("voiceProfileId") else "default"
                    ticket = ""
                    if text and not (auto_voice and not state.get("reference")):
                        ticket = secrets.token_urlsafe(24)
                        for old in list(speech_tickets):
                            if time.monotonic() - speech_tickets[old]["at"] > 60:
                                del speech_tickets[old]
                        speech_tickets[ticket] = {"at": time.monotonic(), "token": token, "text": text,
                            "profile": data.get("voiceProfileId", ""), "state": {"reference": state.get("reference")} if auto_voice else {}, "voiceSource": voice_source}
                        while len(speech_tickets) > 64:
                            speech_tickets.popitem(last=False)
                    return {"text": text, "context": preceding, "ticket": ticket, "translated": "", "audio": "", "duration": 0,
                        "preparingVoice": bool(text and auto_voice and not state.get("reference")), "voiceSource": voice_source,
                        "timings": {"recognition": round(recognized - started, 3)}, "sourceDuration": round(len(samples) / 16000, 3)}
                if not text:
                    result = {"text": "", "translated": "", "audio": "", "duration": 0}
                elif auto_voice and not state.get("reference"):
                    result = {"text": text, "translated": engine.translate(text, "en"), "audio": "", "duration": 0, "preparingVoice": True}
                else:
                    result = live_dub(text, data.get("voiceProfileId", ""), state if auto_voice else {}, context=preceding)
                finished = time.perf_counter()
                return {**result, "voiceSource": "speaker" if auto_voice and state.get("reference") else "profile" if data.get("voiceProfileId") else "default",
                    "timings": {"recognition": round(recognized - started, 3), "translationAndSpeech": round(finished - recognized, 3),
                        "total": round(finished - started, 3)}, "sourceDuration": round(len(samples) / 16000, 3)}
            try:
                return await asyncio.to_thread(process)
            except (ValueError, RuntimeError, OSError, ImportError, wave.Error, EOFError) as error:
                raise HTTPException(503, "本地识别失败：" + str(error)[:250])
    return app


import wave
app = create_app()
if __name__ == "__main__":
    import uvicorn
    from progress import write_progress
    engine = default_engine()
    if engine.missing():
        write_progress(ROOT, "error", "模型文件不完整，请先完成本地模型安装")
        raise SystemExit("Run setup.ps1 first. Missing: " + ", ".join(engine.missing()))
    print("Loading local models; the extension can connect after startup completes.", flush=True)
    try:
        engine.warmup(lambda stage, message: write_progress(ROOT, stage, message))
    except Exception:
        write_progress(ROOT, "error", "模型加载失败，请检查本地模型安装与可用内存")
        raise
    app = create_app(engine)
    uvicorn.run(app, host="127.0.0.1", port=8765, access_log=False)
