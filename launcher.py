import os
import re
import sys
import time
import urllib.request
import webbrowser
import subprocess
from pathlib import Path

BASE = Path(__file__).parent

def main():
    server_proc = subprocess.Popen(
        [sys.executable, str(BASE / "server.py")],
        cwd=str(BASE),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    
    server_ready = False
    for _ in range(30):
        try:
            with urllib.request.urlopen("http://localhost:8000/health", timeout=1) as r:
                if r.status == 200:
                    server_ready = True
                    break
        except Exception:
            time.sleep(0.5)
            
    if not server_ready:
        print("[ERROR] Failed to start local API server.")
        server_proc.terminate()
        return

    cf_proc = subprocess.Popen(
        [
            str(BASE / "cloudflared.exe"),
            "tunnel",
            "--protocol", "http2",
            "--url", "http://localhost:8000"
        ],
        cwd=str(BASE),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace"
    )

    tunnel_url = None
    
    for line in iter(cf_proc.stdout.readline, ""):
        if not tunnel_url:
            m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
            if m:
                tunnel_url = m.group(0)
                print(f"[+] Tunnel URL generated: {tunnel_url}")
                print("[*] Connecting to Cloudflare Edge...")
        
        if "Registered tunnel connection" in line or "connIndex=0" in line:
            break
            
    if not tunnel_url:
        print("[ERROR] Could not obtain Cloudflare tunnel URL.")
        cf_proc.terminate()
        server_proc.terminate()
        return

    print("[*] Verifying tunnel connectivity...")
    for _ in range(20):
        try:
            req = urllib.request.Request(
                f"{tunnel_url}/health",
                headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(req, timeout=3) as res:
                if res.status == 200:
                    break
        except Exception:
            time.sleep(1)

    os.system("cls" if os.name == "nt" else "clear")

    swagger_url = f"{tunnel_url}/docs"
    banner = f"""
================================================================================
                    Castle Token API - ONLINE & READY
================================================================================

  [+] Swagger UI (Public):
      {swagger_url}

  [+] Swagger UI (Local):
      http://localhost:8000/docs

  [+] Castle Token Endpoint:
      POST {tunnel_url}/android/twitter/castle
      Header: Content-Type: application/json
      Body:   {{"ip": "1.1.1.1"}}

  [+] Twitter Auth Endpoint:
      POST {tunnel_url}/api/TwitterAuth/authenticate

  [+] Server Stats:
      GET {tunnel_url}/stats

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
            if server_proc.poll() is not None or cf_proc.poll() is not None:
                break
    except KeyboardInterrupt:
        pass
    finally:
        cf_proc.terminate()
        server_proc.terminate()

if __name__ == "__main__":
    main()
