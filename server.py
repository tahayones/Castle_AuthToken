import os
import asyncio
from datetime import datetime, timezone
from pathlib import Path

os.environ["NODE_OPTIONS"] = (os.environ.get("NODE_OPTIONS", "") + " --experimental-require-module").strip()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

BASE = Path(__file__).parent
ENGINE = BASE / "castle_engine_final.js"
SDK = BASE / "castle_cdn_sdk.js"
TIMEOUT = int(os.getenv("TIMEOUT", "90"))
_sem = asyncio.Semaphore(int(os.getenv("MAX_PARALLEL", "6")))

_DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE)))
_COUNTER_FILE = _DATA_DIR / "castle_counter.txt"

def _load_count() -> int:
    try:
        return int(_COUNTER_FILE.read_text(encoding="utf-8").strip())
    except Exception:
        return 0

def _save_count(n: int):
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        _COUNTER_FILE.write_text(str(n), encoding="utf-8")
    except Exception:
        pass

_total_generated = _load_count()
_started_at = datetime.now(timezone.utc).isoformat()

app = FastAPI(
    title="Castle Token & Twitter Auth API",
    version="1.0.0",
    description="Generate Twitter Castle tokens and authenticate Twitter accounts.",
    docs_url="/docs",
    openapi_url="/openapi.json",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class CastleRequest(BaseModel):
    ip: str | None = None

class CastleResponse(BaseModel):
    token: str
    length: int

class StatsResponse(BaseModel):
    total_generated: int
    uptime_since: str

class TwitterAuthRequest(BaseModel):
    username: str
    password: str
    totpSecret: str | None = None
    proxy: str | None = None

class TwitterAuthResponse(BaseModel):
    success: bool
    authToken: str | None = None
    ct0: str | None = None
    twid: str | None = None
    errorMessage: str | None = None

def _call_worker(ip: str | None) -> str:
    import json
    import urllib.request
    payload = json.dumps({"ip": ip}).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:8001/android/twitter/castle",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        data = json.loads(res.read().decode("utf-8"))
        token = data.get("token")
        if not token or len(token) < 50:
            raise ValueError("Invalid token from worker")
        return token

async def generate(ip: str | None) -> str:
    async with _sem:
        try:
            return await asyncio.to_thread(_call_worker, ip)
        except Exception:
            pass

        cmd = ["node", str(ENGINE), "1", "--stdout"]
        if ip:
            cmd.append(f"--ip={ip}")
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(BASE),
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT)
            except asyncio.TimeoutError:
                proc.kill()
                raise HTTPException(504, "Timed out")
        except FileNotFoundError:
            raise HTTPException(503, "Service unavailable")

        token = (stdout.decode("utf-8", errors="replace").splitlines() or [""])[0].strip()
        if not token or len(token) < 50:
            err_msg = stderr.decode("utf-8", errors="replace").strip()
            raise HTTPException(500, f"Failed to generate token: {err_msg}")
        return token

def _execute_twitter_login(username: str, password: str, totp: str | None, proxy: str | None):
    from auth_token import login, proxy_pool
    if proxy:
        parsed = proxy_pool._parse(proxy)
        if parsed:
            proxy_pool._proxies.insert(0, proxy)
    return login(username, password, totp)

@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/docs")

@app.get("/swagger", include_in_schema=False)
async def swagger_redirect():
    return RedirectResponse(url="/docs")

@app.get("/stats", response_model=StatsResponse, tags=["Monitoring"])
async def stats():
    return StatsResponse(total_generated=_total_generated, uptime_since=_started_at)

@app.post("/android/twitter/castle", response_model=CastleResponse, tags=["Token Generation"])
async def castle_token(body: CastleRequest):
    global _total_generated
    token = await generate(ip=body.ip)
    _total_generated += 1
    _save_count(_total_generated)
    return CastleResponse(token=token, length=len(token))

@app.post("/api/Castle/generate-token", response_model=CastleResponse, tags=["Token Generation"])
async def castle_token_alias(body: CastleRequest):
    global _total_generated
    token = await generate(ip=body.ip)
    _total_generated += 1
    _save_count(_total_generated)
    return CastleResponse(token=token, length=len(token))

@app.post("/api/TwitterAuth/authenticate", response_model=TwitterAuthResponse, tags=["Authentication"])
async def authenticate(body: TwitterAuthRequest):
    try:
        res = await asyncio.to_thread(
            _execute_twitter_login,
            body.username,
            body.password,
            body.totpSecret,
            body.proxy
        )
        return TwitterAuthResponse(
            success=True,
            authToken=res.get("auth_token"),
            ct0=res.get("ct0"),
            twid=res.get("twid"),
            errorMessage=None
        )
    except Exception as e:
        return TwitterAuthResponse(
            success=False,
            authToken=None,
            ct0=None,
            twid=None,
            errorMessage=str(e)
        )

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
