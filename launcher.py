import os
import re
import sys
import time
import urllib.request
import webbrowser
import subprocess
import threading
from pathlib import Path

BASE = Path(__file__).parent

def start_server():
    proc = subprocess.Popen(
        [sys.executable, str(BASE / "server.py")],
        cwd=str(BASE),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    for _ in range(30):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=1) as r:
                if r.status == 200:
                    return proc
        except Exception:
            time.sleep(0.5)
    proc.terminate()
    return None

def start_tunnel():
    try:
        ssh_proc = subprocess.Popen(
            [
                "ssh.exe",
                "-o", "StrictHostKeyChecking=no",
                "-o", "ServerAliveInterval=30",
                "-o", "ServerAliveCountMax=3",
                "-R", "80:127.0.0.1:8000",
                "serveo.net"
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        url = None
        for _ in range(25):
            line = ssh_proc.stdout.readline()
            if not line:
                break
            m = re.search(r"https://[a-zA-Z0-9-]+\.serveousercontent\.com", line)
            if m:
                url = m.group(0)
                break
        if url:
            return ssh_proc, url
        ssh_proc.terminate()
    except Exception:
        pass

    cf_exe = BASE / "cloudflared.exe"
    cf_proc = subprocess.Popen(
        [
            str(cf_exe), "tunnel",
            "--config", "NUL",
            "--edge-ip-version", "4",
            "--protocol", "http2",
            "--url", "http://127.0.0.1:8000"
        ],
        cwd=str(BASE),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace"
    )
    url = None
    for _ in range(30):
        line = cf_proc.stdout.readline()
        if not line:
            break
        m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
        if m:
            url = m.group(0)
            break
    if url:
        return cf_proc, url
    cf_proc.terminate()
    return None, None

def main():
    print("[*] Starting local API server...")
    server_proc = start_server()
    if not server_proc:
        print("[ERROR] Could not start local server on port 8000.")
        return

    print("[*] Establishing secure public HTTPS tunnel...")
    tunnel_proc, public_url = start_tunnel()
    if not tunnel_proc or not public_url:
        print("[ERROR] Failed to establish public tunnel.")
        server_proc.terminate()
        return

    def drain():
        for _ in iter(tunnel_proc.stdout.readline, ""):
            pass
    threading.Thread(target=drain, daemon=True).start()

    os.system("cls" if os.name == "nt" else "clear")

    swagger_url = f"{public_url}/docs"
    banner = f"""
================================================================================
                    Castle Token API - ONLINE & READY
================================================================================

  [+] Swagger UI (Public):
      {swagger_url}

  [+] Swagger UI (Local):
      http://127.0.0.1:8000/docs

  [+] Castle Token Endpoint:
      POST {public_url}/android/twitter/castle
      Header: Content-Type: application/json
      Body:   {{"ip": "1.1.1.1"}}

  [+] Twitter Auth Endpoint:
      POST {public_url}/api/TwitterAuth/authenticate

  [+] Server Stats:
      GET {public_url}/stats

================================================================================
  Opening Swagger UI in your browser automatically...
  Keep this window OPEN while using the API. Press Ctrl+C to stop.
================================================================================
"""
    print(banner)

    try:
        webbrowser.open(swagger_url)
    except Exception:
        pass

    try:
        while True:
            time.sleep(1)
            if server_proc.poll() is not None or tunnel_proc.poll() is not None:
                break
    except KeyboardInterrupt:
        pass
    finally:
        tunnel_proc.terminate()
        server_proc.terminate()

if __name__ == "__main__":
    main()
