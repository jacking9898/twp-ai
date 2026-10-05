# SPDX-License-Identifier: MPL-2.0
"""Start an independent Windows service and wait for model readiness."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request


def probe():
    # Localhost must bypass system proxies, including an HTTP_PROXY environment.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(
        "http://127.0.0.1:8765/session", data=b"{}",
        headers={"Content-Type": "application/json", "X-Yedu-Voice": "1"},
    )
    try:
        with opener.open(request, timeout=2) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError("Local service is responding but unavailable; check server.err.log") from error
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return None
    if not isinstance(data.get("token"), str) or not data.get("model"):
        raise RuntimeError("Port 8765 is occupied by an unexpected service")
    return data["model"]


def wait_ready(process, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        model = probe()
        if model:
            return model
        if process.poll() is not None:
            raise RuntimeError("Model service exited; check .local-data/voice/server.err.log")
        time.sleep(1)
    raise RuntimeError("Models are still loading; check server.err.log and retry start.ps1")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--foreground", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    home = Path(os.environ.get("YEDU_VOICE_HOME", root / ".local-data/voice"))
    home.mkdir(parents=True, exist_ok=True)
    # Released automatically on process exit, including an interrupted startup.
    import msvcrt
    with (home / "startup.lock").open("a+b") as lock:
        lock.seek(0)
        if not lock.read(1):
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise RuntimeError("Another launcher is loading models; retry after it finishes")
        model = probe()
        if model:
            print("Already ready at http://127.0.0.1:8765: " + model)
            return
        command = [sys.executable, "-u", str(root / "local-voice/server.py")]
        if args.foreground:
            raise SystemExit(subprocess.call(command, cwd=root))
        flags = (subprocess.CREATE_BREAKAWAY_FROM_JOB | subprocess.DETACHED_PROCESS
                 | subprocess.CREATE_NEW_PROCESS_GROUP)
        with (home / "server.log").open("w") as out, (home / "server.err.log").open("w") as err:
            try:
                process = subprocess.Popen(command, cwd=root, stdin=subprocess.DEVNULL,
                                           stdout=out, stderr=err, creationflags=flags)
            except OSError as error:
                raise RuntimeError("Cannot detach service in this terminal; run start.ps1 -Foreground in a normal PowerShell window") from error
        (home / "launcher.pid").write_text(str(process.pid), encoding="ascii")
        print("Loading models in the background...", flush=True)
        model = wait_ready(process)
        print("Ready at http://127.0.0.1:8765: " + model)
        print("Service remains running after this terminal closes. Logs: " + str(home))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
