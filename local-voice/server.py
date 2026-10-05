# SPDX-License-Identifier: MPL-2.0
"""Loopback-only English → Chinese dubbing service, run with start.ps1."""
import asyncio
import base64
import binascii
import os
import secrets
import time
from collections import OrderedDict
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from engine import LocalEngine

ROOT = Path(os.environ.get("YEDU_VOICE_HOME", Path(__file__).resolve().parents[1] / ".local-data/voice"))
MAX_BODY = 600_000


def create_app(engine=None):
    engine = engine or LocalEngine(ROOT)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    sessions = OrderedDict()
    cache = OrderedDict()
    inference = asyncio.Lock()

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
        return {"token": token, "model": "small.en · OPUS-MT en-zh · GPT-SoVITS v2Pro", "target": "zh-CN"}

    def dub(text, language):
        key = (text, language)
        if key in cache:
            cache.move_to_end(key)
            return cache[key]
        translated = engine.translate(text, language)
        audio, duration = engine.synthesize(translated)
        if len(audio) > 4_000_000:
            raise ValueError("合成音频过长，请缩短字幕")
        result = {"text": text, "translated": translated, "audio": base64.b64encode(audio).decode(), "duration": duration}
        cache[key] = result
        # Cache only in RAM; bound by bytes as well as count.
        while len(cache) > 64 or sum(len(row["audio"]) for row in cache.values()) > 32_000_000:
            cache.popitem(last=False)
        return result

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
                return await asyncio.to_thread(dub, text.strip(), language)
            except (ValueError, RuntimeError, OSError, ImportError) as error:
                raise HTTPException(503, "本地配音失败：" + str(error)[:250])

    @app.post("/recognize-dub")
    async def recognize(request: Request):
        data = await body(request)
        try:
            encoded = data.get("audio")
            if not isinstance(encoded, str) or len(encoded) > 520_000:
                raise ValueError()
            audio = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(400, "无效音频")
        if inference.locked():
            raise HTTPException(429, "本地模型正在处理另一请求，请稍后重试")
        async with inference:
            def process():
                text = engine.recognize(audio)
                return dub(text, "en") if text else {"text": "", "translated": "", "audio": "", "duration": 0}
            try:
                return await asyncio.to_thread(process)
            except (ValueError, RuntimeError, OSError, ImportError, wave.Error, EOFError) as error:
                raise HTTPException(503, "本地识别失败：" + str(error)[:250])
    return app


import wave
app = create_app()
if __name__ == "__main__":
    import uvicorn
    engine = LocalEngine(ROOT)
    if engine.missing():
        raise SystemExit("Run setup.ps1 first. Missing: " + ", ".join(engine.missing()))
    print("Loading local models; the extension can connect after startup completes.", flush=True)
    engine.warmup()
    app = create_app(engine)
    uvicorn.run(app, host="127.0.0.1", port=8765, access_log=False)
