# SPDX-License-Identifier: MPL-2.0
import base64
import io
import unittest
import wave
import tempfile
import math
import struct
from fastapi.testclient import TestClient
from server import create_app
from engine import decode_pcm


class FakeEngine:
    def __init__(self):
        self.calls = 0
    def missing(self):
        return []
    def translate(self, text, language):
        self.calls += 1
        return "你好"
    def synthesize(self, text, reference=None):
        self.reference = reference
        return b"test-wav", 1.0
    def recognize(self, audio):
        decode_pcm(audio)
        return "Hello"


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = FakeEngine()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.client = TestClient(create_app(self.engine, self.directory.name), base_url="http://127.0.0.1:8765")
        self.headers = {"X-Yedu-Voice": "1", "Origin": "chrome-extension://test"}
        token = self.client.post("/session", json={}, headers=self.headers).json()["token"]
        self.headers["Authorization"] = "Bearer " + token

    def test_dub_cached_in_memory(self):
        for _ in range(2):
            response = self.client.post("/dub", json={"text": "Hello", "language": "en"}, headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(base64.b64decode(response.json()["audio"]), b"test-wav")
        self.assertEqual(self.engine.calls, 1)

    def test_website_origin_and_rebinding_rejected(self):
        for update in ({"Origin": "https://www.youtube.com"}, {"Host": "attacker.example"}, {"X-Yedu-Voice": "0"}):
            response = self.client.post("/session", json={}, headers={**self.headers, **update})
            self.assertEqual(response.status_code, 403)
            self.assertNotIn("access-control-allow-origin", response.headers)
        self.assertEqual(self.client.options("/session", headers=self.headers).status_code, 403)

    def test_auth_limits_and_language(self):
        self.assertEqual(self.client.post("/dub", json={"text": "Hello"}, headers={**self.headers, "Authorization": "Bearer nope"}).status_code, 401)
        for data in ({"text": "x" * 501}, {"text": "Hello", "language": "ja"}, {"text": 123}, {}):
            self.assertEqual(self.client.post("/dub", json=data, headers=self.headers).status_code, 400)
        self.assertEqual(self.client.post("/dub", content=b"x" * 600001, headers=self.headers).status_code, 413)

    def test_pcm_recognition_and_invalid_audio(self):
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(b"\0" * 16000)
        response = self.client.post("/recognize-dub", json={"audio": base64.b64encode(output.getvalue()).decode()}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "Hello")
        self.assertEqual(self.client.post("/recognize-dub", json={"audio": "!invalid"}, headers=self.headers).status_code, 400)
        self.assertEqual(self.client.post("/recognize-dub", json={"audio": "YWJj"}, headers=self.headers).status_code, 503)

    def reference(self, seconds=4, silent=False):
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes(b"".join(struct.pack("<h", 0 if silent else int(math.sin(i * .2) * 5000)) for i in range(int(seconds * 16000))))
        return base64.b64encode(output.getvalue()).decode()

    def test_saved_voices_persist_and_do_not_share_default_voice_cache(self):
        data = {"name": "Bob 英语", "audio": self.reference(), "text": "Hello everyone", "language": "en"}
        response = self.client.post("/profiles/create", json=data, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        profile = response.json()["profile"]
        self.assertEqual(profile["duration"], 4)
        self.assertNotIn("path", profile)
        restarted = TestClient(create_app(self.engine, self.directory.name), base_url="http://127.0.0.1:8765")
        headers = {"X-Yedu-Voice": "1"}
        headers["Authorization"] = "Bearer " + restarted.post("/session", json={}, headers=headers).json()["token"]
        self.assertEqual(restarted.post("/profiles/list", json={}, headers=headers).json()["profiles"], [profile])
        for voice in ("", profile["id"], profile["id"]):
            response = self.client.post("/dub", json={"text": "Hello", "language": "en", "voiceProfileId": voice}, headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["voiceProfileId"], voice)
        self.assertEqual(self.engine.calls, 2)
        self.assertEqual(self.engine.reference["language"], "en")
        self.assertEqual(self.engine.reference["text"], "Hello everyone")

    def test_reference_validation_and_no_user_paths(self):
        audio = self.reference()
        for update in ({"audio": self.reference(1)}, {"audio": self.reference(silent=True)}, {"language": "ja"}, {"text": ""}, {"name": ""}):
            data = {"name": "Bob", "audio": audio, "text": "Hello", "language": "en", **update}
            self.assertEqual(self.client.post("/profiles/create", json=data, headers=self.headers).status_code, 400)
        response = self.client.post("/reference-text", json={"audio": audio}, headers=self.headers)
        self.assertEqual(response.json()["text"], "Hello")
        for value in ("../../reference", {}, "f" * 32):
            self.assertEqual(self.client.post("/dub", json={"text": "Hello", "voiceProfileId": value}, headers=self.headers).status_code, 503)


if __name__ == "__main__":
    unittest.main()
