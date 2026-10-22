# SPDX-License-Identifier: MPL-2.0
"""Restricted native messaging helper. No shell, arbitrary paths or commands."""
import json
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import time
from launch import probe

ROOT = Path(__file__).resolve().parents[1]
HOME = Path(os.environ.get("YEDU_VOICE_HOME", ROOT / ".local-data/voice"))


def owned_pid(filename, script):
    try:
        pid = int((HOME / filename).read_text())
        if pid < 2:
            return None
        command = subprocess.check_output(["/bin/ps", "-p", str(pid), "-o", "command="], text=True, stderr=subprocess.DEVNULL).strip()
        # Verify both the installed interpreter and exact project script before
        # signalling anything; a stale PID alone never grants ownership.
        import shlex
        args = shlex.split(command)
        interpreters = {Path(sys.executable).resolve(), Path(sys.base_prefix, "Resources/Python.app/Contents/MacOS/Python").resolve()}
        if args and Path(args[0]).resolve() in interpreters and str(ROOT / "local-voice" / script) in args:
            return pid
    except (ValueError, OSError, subprocess.SubprocessError):
        pass
    return None


def status():
    try:
        model = probe()
        if model:
            return {"state": "ready", "message": "模型已就绪", "model": model}
    except RuntimeError as error:
        return {"state": "error", "message": str(error)}
    pid = owned_pid("launcher.pid", "server.py") or owned_pid("bridge-launcher.pid", "launch.py")
    if pid:
        try:
            progress = json.loads((HOME / "progress.json").read_text())
            if time.time() - progress["at"] < 240:
                return {"state": "starting", "message": progress["message"], "stage": progress["stage"]}
        except (OSError, ValueError, KeyError, TypeError):
            pass
        return {"state": "starting", "message": "正在启动本地模型…"}
    try:
        progress = json.loads((HOME / "progress.json").read_text())
        if progress.get("stage") == "error" and time.time() - progress["at"] < 240:
            return {"state": "error", "message": progress["message"]}
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return {"state": "stopped", "message": "模型服务未启动"}


def handle(message):
    if not isinstance(message, dict) or set(message) != {"action"}:
        raise ValueError("无效的本地服务操作")
    action = message["action"]
    if action == "status":
        return status()
    if action == "start":
        HOME.mkdir(parents=True, exist_ok=True)
        # Separate from launch.py's startup lock. Prevent rapid clicks from
        # spawning duplicate launchers before the first process writes its PID.
        import fcntl
        with (HOME / "bridge.lock").open("a+b") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            current = status()
            if current["state"] in ("ready", "starting"):
                return current
            env = {**os.environ, "YEDU_VOICE_HOME": str(HOME), "HF_HUB_OFFLINE": "1",
                   "TRANSFORMERS_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false", "OMP_NUM_THREADS": "4"}
            with (HOME / "bridge.log").open("w") as log:
                process = subprocess.Popen([sys.executable, "-u", str(ROOT / "local-voice/launch.py")],
                    cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
            (HOME / "bridge-launcher.pid").write_text(str(process.pid))
            return {"state": "starting", "message": "正在启动并加载本地模型…"}
    if action == "stop":
        import fcntl
        HOME.mkdir(parents=True, exist_ok=True)
        with (HOME / "bridge.lock").open("a+b") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            # Stop a pending launcher first, so it cannot start a new server after
            # the stop button has returned.
            launcher = owned_pid("bridge-launcher.pid", "launch.py")
            if launcher:
                os.kill(launcher, signal.SIGTERM)
            pid = owned_pid("launcher.pid", "server.py")
            if pid:
                os.kill(pid, signal.SIGTERM)
                for _ in range(50):
                    if not owned_pid("launcher.pid", "server.py"):
                        break
                    time.sleep(.1)
                else:
                    return {"state": "error", "message": "服务正在退出，请稍后重新检测"}
            elif status()["state"] == "ready":
                return {"state": "error", "message": "该服务不是本组件启动的，无法安全停止"}
            from progress import write_progress
            write_progress(HOME, "stopped", "模型服务已停止")
            return {"state": "stopped", "message": "模型服务已停止，内存已释放"}
    raise ValueError("不支持的本地服务操作")


def main():
    # Chrome validates allowed_origins using the installed host manifest.
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        return
    size, = struct.unpack("=I", header)
    if size > 1024:
        raise ValueError("本地操作消息过大")
    raw = sys.stdin.buffer.read(size)
    if len(raw) != size:
        raise ValueError("本地操作消息不完整")
    try:
        result = {"ok": True, **handle(json.loads(raw))}
    except (ValueError, OSError, RuntimeError) as error:
        result = {"ok": False, "state": "error", "message": str(error)[:300]}
    output = json.dumps(result, ensure_ascii=False).encode()
    sys.stdout.buffer.write(struct.pack("=I", len(output)) + output)
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
