# SPDX-License-Identifier: MPL-2.0
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import native_host
from install_bridge import discover_ids, install


class NativeHostTests(unittest.TestCase):
    def test_only_fixed_actions_and_no_extra_arguments(self):
        for value in ({"action": "exec"}, {"action": "start", "command": "anything"}, [], {}):
            with self.assertRaises(ValueError):
                native_host.handle(value)

    def test_ready_probe_does_not_expose_session_token(self):
        with patch.object(native_host, "probe", return_value="test model"):
            self.assertEqual(native_host.status(), {"state": "ready", "message": "模型已就绪", "model": "test model"})

    def test_stale_pid_cannot_kill_unrelated_process(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "launcher.pid").write_text("12345")
            with patch.object(native_host, "HOME", Path(folder)), patch.object(native_host, "probe", return_value=None), \
                 patch.object(native_host.subprocess, "check_output", return_value="/usr/bin/python3 /other/server.py"), \
                 patch.object(native_host.os, "kill") as kill:
                result = native_host.handle({"action": "stop"})
                self.assertEqual(result["state"], "stopped")
                kill.assert_not_called()

    def test_duplicate_start_does_not_launch_another_server(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(native_host, "HOME", Path(folder)), patch.object(native_host, "status", return_value={"state": "starting"}), \
                 patch.object(native_host.subprocess, "Popen") as spawn:
                native_host.handle({"action": "start"})
                spawn.assert_not_called()

    def test_macos_framework_executable_is_recognized_with_exact_script(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "launcher.pid").write_text("12345")
            command = str(Path(sys.base_prefix, "Resources/Python.app/Contents/MacOS/Python")) + " -u " + str(native_host.ROOT / "local-voice/server.py")
            with patch.object(native_host, "HOME", Path(folder)), patch.object(native_host.subprocess, "check_output", return_value=command):
                self.assertEqual(native_host.owned_pid("launcher.pid", "server.py"), 12345)

    def test_native_protocol_returns_one_framed_json_without_logs(self):
        raw = json.dumps({"action": "status"}).encode()
        stdin = type("Input", (), {"buffer": io.BytesIO(struct.pack("=I", len(raw)) + raw)})()
        stdout = type("Output", (), {"buffer": io.BytesIO()})()
        with patch.object(sys, "stdin", stdin), patch.object(sys, "stdout", stdout), patch.object(native_host, "status", return_value={"state": "ready"}):
            native_host.main()
        output = stdout.buffer.getvalue()
        self.assertEqual(struct.unpack("=I", output[:4])[0], len(output) - 4)
        self.assertEqual(json.loads(output[4:]), {"ok": True, "state": "ready"})

    def test_installer_discovers_only_this_project_and_restricts_origin(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder, "project with spaces"); root.mkdir()
            interpreter = root / ".local-data/voice/.venv/bin/python"
            interpreter.parent.mkdir(parents=True); interpreter.write_text("")
            browser = Path(folder, "browser"); (browser / "Default").mkdir(parents=True)
            extension_id = "a" * 32
            (browser / "Default/Preferences").write_text(json.dumps({"extensions": {"settings": {
                extension_id: {"path": str(root / "src")}, "b" * 32: {"path": "/other/extension"}}}}))
            with patch("install_bridge.ROOT", root):
                self.assertEqual(discover_ids(browser), {extension_id})
                manifest = install(browser, [])
            data = json.loads(manifest.read_text())
            self.assertEqual(data["allowed_origins"], ["chrome-extension://" + extension_id + "/"])
            self.assertIn("'", Path(data["path"]).read_text())


if __name__ == "__main__":
    unittest.main()
