"""
auth_token.py
═══════════════════════════════════════════════════════════════
Twitter/X Auth Token Fetcher — Batch Mode
Extracts auth_token, ct0, and twid for multiple accounts.

Flow per account:
  1. Pick proxy from proxy.txt pool (or fallback dynamic PROXY_RAW)
  2. Get real outgoing IP of that proxy
  3. Generate Castle token with proxy IP injected (Node.js engine)
  4. GET  x.com/i/jf/onboarding/web  → guest_token
  5. POST begin_login (username + $castle_token) → session_token
  6. POST login_enter_password → auth_token cookie (or 2FA)
  7. Handle 2FA (TOTP via pyotp)
  8. Save auth_token, ct0, twid to results.txt and token.txt

Input:   accounts.txt  — one account per line:
           username:password
           username:password:email:email_pass
           username:password:email:email_pass:totp_secret

Output:  token.txt      — auth tokens (one per line)
         results.txt    — full results (username | auth_token | ct0 | twid)
         auth_results.json — JSON array of all results
"""

import os
import re
import sys
import uuid
import time
import json
import secrets
import logging
import threading
import subprocess
from pathlib import Path

from curl_cffi import requests

# ─── Stdout/stderr → also written to log.txt ──────────────────────────────────
_LOG_FILE = Path(__file__).parent / "log.txt"
_LOG_FILE.write_text("")  # reset on start

class _Tee:
    def __init__(self, path, stream):
        self._f = open(path, "a", encoding="utf-8", buffering=1)
        self._s = stream
    def write(self, d):
        self._s.write(d)
        try: self._f.write(d)
        except: pass
    def flush(self):
        self._s.flush()
        try: self._f.flush()
        except: pass
    def reconfigure(self, **kw): pass

sys.stdout = _Tee(_LOG_FILE, sys.stdout)
sys.stderr = _Tee(_LOG_FILE, sys.stderr)

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)-5s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stderr)],
)
log = logging.getLogger(__name__)

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE          = Path(__file__).parent
ACCOUNTS_FILE = BASE / "accounts.txt"
RESULTS_FILE  = BASE / "results.txt"
TOKEN_FILE    = BASE / "token.txt"
JSON_FILE     = BASE / "auth_results.json"
PROXY_FILE    = BASE / "proxy.txt"
CASTLE_ENGINE = BASE / "castle_engine_final.js"
CASTLE_SDK    = BASE / "castle_cdn_sdk.js"

# ─── Twitter constants ────────────────────────────────────────────────────────
BEARER = (
    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs"
    "%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
)
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/150.0.0.0 Safari/537.36"
)
SEC_UA   = '"Google Chrome";v="150", "Not_A Brand";v="8", "Chromium";v="150"'
IMPERSONATE = "chrome150"

# ─── Proxy configuration ──────────────────────────────────────────────────────
# ProxyHat — GB Mobile Sticky 10min High Quality
# Format:  host:port:base_user:password
# The engine appends -sid-{SID}-ttl-10m-filter-high to the username
PROXY_RAW = "gate.proxyhat.com:8080:ab9616a7551z5-country-gb-type-mobile:ul4xo1lmm5InyFcMxwOg"

# ─── Concurrency ──────────────────────────────────────────────────────────────
THREADS     = 1   # Keep at 1 to avoid burning accounts
MAX_RETRIES = 2   # Retries for proxy/network errors only
RETRY_SLEEP = 4   # Seconds between retries

# ─── Error categories ─────────────────────────────────────────────────────────
NOT_RETRYABLE = ("LOGIN_LIMITED", "WRONG_PASSWORD", "ACCOUNT_SUSPENDED",
                 "ACCOUNT_NOT_FOUND", "BAD_CREDENTIALS")


# ══════════════════════════════════════════════════════════════════════════════
#  PROXY POOL
# ══════════════════════════════════════════════════════════════════════════════

class ProxyPool:
    """
    Thread-safe proxy pool. Reads from proxy.txt (one proxy per line).
    Proxies are consumed after use (removed from file).
    Falls back to dynamic PROXY_RAW if pool is empty.
    """

    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.Lock()
        self._proxies = self._load()

    def _load(self):
        if not self._path.exists():
            return []
        lines = [l.strip() for l in self._path.read_text(encoding="utf-8").splitlines() if l.strip()]
        return lines

    def _parse(self, raw: str) -> dict | None:
        """
        Parse a proxy string into a curl_cffi proxies dict.
        Supports:
          http://user:pass@host:port
          host:port:user:pass
        """
        raw = raw.strip()
        if raw.startswith("http://") or raw.startswith("https://"):
            return {"http": raw, "https": raw}
        parts = raw.split(":")
        if len(parts) == 4:
            host, port, user, pwd = parts
            sid = secrets.token_hex(5)
            if "proxyhat" in host.lower():
                # ProxyHat: insert sticky session + quality filter
                if "-sid-" in user:
                    user = re.sub(r"-sid-[a-zA-Z0-9]+-ttl-[^$]*", f"-sid-{sid}-ttl-10m-filter-high", user)
                else:
                    user = f"{user}-sid-{sid}-ttl-10m-filter-high"
            elif "nodemaven" in host.lower():
                if "-sid-" not in user:
                    user = f"{user}-sid-{sid}"
                else:
                    user = re.sub(r"-sid-[a-zA-Z0-9]+", f"-sid-{sid}", user)
            url = f"http://{user}:{pwd}@{host}:{port}"
            return {"http": url, "https": url}
        return None

    def get(self) -> dict | None:
        """Pop a random proxy from the pool and remove it from the file."""
        with self._lock:
            if not self._proxies:
                self._proxies = self._load()
            if not self._proxies:
                return None
            import random
            idx = random.randrange(len(self._proxies))
            raw = self._proxies.pop(idx)
            # Persist remaining proxies
            self._path.write_text("\n".join(self._proxies) + ("\n" if self._proxies else ""), encoding="utf-8")
            return self._parse(raw)

    def build_dynamic(self) -> dict | None:
        """Build a fresh dynamic proxy from PROXY_RAW (new session ID)."""
        return self._parse(PROXY_RAW) if PROXY_RAW else None

    def count(self) -> int:
        with self._lock:
            return len(self._proxies)


proxy_pool = ProxyPool(PROXY_FILE)


# ══════════════════════════════════════════════════════════════════════════════
#  CASTLE TOKEN GENERATION
# ══════════════════════════════════════════════════════════════════════════════

def get_proxy_ip(proxies: dict) -> str | None:
    """Get the real outgoing IP of a proxy (tries multiple services)."""
    services = [
        "https://checkip.amazonaws.com",
        "https://4.ident.me",
        "https://icanhazip.com",
    ]
    for svc in services:
        try:
            r = requests.get(svc, proxies=proxies, timeout=8, impersonate=IMPERSONATE)
            ip = r.text.strip()
            if re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", ip):
                return ip
        except Exception:
            continue
    return None


def get_castle_token(proxies: dict | None = None) -> str:
    """
    Generate a Castle token via our Node.js jsdom engine.
    Injects the proxy's real outgoing IP into the WebRTC fingerprint
    so the castle token IP matches the login request IP.
    """
    if not CASTLE_ENGINE.exists() or not CASTLE_SDK.exists():
        raise RuntimeError("Castle engine or SDK file not found.")

    proxy_ip = None
    if proxies:
        proxy_ip = get_proxy_ip(proxies)
        if proxy_ip:
            log.info(f"    Castle: proxy IP = {proxy_ip}")
        else:
            log.warning("    Castle: could not get proxy IP, using random")

    cmd = ["node", str(CASTLE_ENGINE), "1", "--stdout"]
    if proxy_ip:
        cmd.append(f"--ip={proxy_ip}")

    for attempt in range(3):
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True,
                timeout=30, cwd=str(BASE),
            )
            lines = [l.strip() for l in result.stdout.splitlines() if l.strip()]
            token = lines[0] if lines else ""
            if token and len(token) > 50:
                log.info(f"    Castle token OK ({len(token)} chars)")
                return token
            log.warning(f"    Castle engine returned empty token (attempt {attempt+1})")
        except Exception as e:
            log.warning(f"    Castle engine error (attempt {attempt+1}): {e}")
        time.sleep(1)

    raise RuntimeError("Failed to generate Castle token after 3 attempts.")


# ══════════════════════════════════════════════════════════════════════════════
#  JetFuel BINARY PARSER  (Twitter's custom binary wire format)
# ══════════════════════════════════════════════════════════════════════════════

def extract_jf_strings(raw: bytes) -> list[str]:
    """Extract human-readable strings from a JetFuel binary response."""
    out, i = [], 0
    while i < len(raw) - 2:
        b = raw[i]
        if 4 <= b <= 200:
            chunk = raw[i+1 : i+1+b]
            try:
                s = chunk.decode("utf-8")
                if s.isprintable() and len(s) >= 4:
                    out.append(s)
            except Exception:
                pass
        i += 1
    return out


def find_session_token(raw: bytes) -> str | None:
    """Find a UUID session_token in binary JetFuel response."""
    pattern = re.compile(
        rb"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        re.IGNORECASE,
    )
    m = pattern.search(raw)
    return m.group(0).decode("ascii") if m else None


def find_all_uuids(raw: bytes) -> list[str]:
    """Find all UUIDs in binary JetFuel response."""
    return [
        m.group(0).decode("ascii")
        for m in re.finditer(
            rb"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            raw, re.IGNORECASE,
        )
    ]


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN LOGIN FLOW
# ══════════════════════════════════════════════════════════════════════════════

def login(username: str, password: str, totp_secret: str | None = None) -> dict:
    """
    Full login flow for one account.
    Returns dict with auth_token, ct0, twid.
    Raises RuntimeError with error code prefix (e.g. "LOGIN_LIMITED — ...").
    """
    # ── 1. Pick proxy ──────────────────────────────────────────────────────────
    proxies = proxy_pool.get() or proxy_pool.build_dynamic()
    if proxies:
        log.info(f"    Proxy: {list(proxies.values())[0][:70]}")
    else:
        log.warning("    No proxy — running direct (risky)")

    # ── 2. Generate Castle token (with proxy IP fingerprint) ──────────────────
    log.info("[2] Generating Castle token (Node.js engine)...")
    castle_token = get_castle_token(proxies=proxies)
    cuid = str(uuid.uuid4())

    # ── 3. Open session ────────────────────────────────────────────────────────
    session = requests.Session(impersonate=IMPERSONATE, proxies=proxies)
    session.headers.update({
        "User-Agent":          UA,
        "Accept-Language":     "en-US,en;q=0.9",
        "sec-ch-ua":           SEC_UA,
        "sec-ch-ua-mobile":    "?0",
        "sec-ch-ua-platform":  '"Windows"',
    })

    # ── 4. Get guest token ─────────────────────────────────────────────────────
    log.info("[1] Fetching guest session & cookies...")
    guest_token = None

    for attempt in range(3):
        try:
            r = session.get("https://x.com/i/jf/onboarding/web", timeout=20)
            m = re.search(r"gt=([0-9]+);", r.text)
            guest_token = m.group(1) if m else session.cookies.get("gt")
            if guest_token:
                break
        except Exception as e:
            log.warning(f"    Step 1 attempt {attempt+1} failed: {e}")
            time.sleep(2)

    if not guest_token:
        # API fallback
        try:
            r2 = session.post(
                "https://api.x.com/1.1/guest/activate.json",
                headers={"authorization": BEARER}, timeout=15,
            )
            guest_token = r2.json().get("guest_token")
        except Exception:
            pass

    if not guest_token:
        raise RuntimeError("ERROR — Failed to obtain guest_token")

    session.cookies.set("gt",     str(guest_token), domain=".x.com")
    session.cookies.set("__cuid", cuid,             domain=".x.com")
    log.info(f"    Guest token: {guest_token}")

    # ── 5. JetFuel headers ─────────────────────────────────────────────────────
    jf = {
        "accept":                   "*/*",
        "accept-language":          "en",
        "authorization":            BEARER,
        "content-type":             "application/x-www-form-urlencoded",
        "origin":                   "https://x.com",
        "priority":                 "u=1, i",
        "referer":                  "https://x.com/",
        "sec-ch-ua":                SEC_UA,
        "sec-ch-ua-mobile":         "?0",
        "sec-ch-ua-platform":       '"Windows"',
        "sec-fetch-dest":           "empty",
        "sec-fetch-mode":           "cors",
        "sec-fetch-site":           "same-site",
        "user-agent":               UA,
        "x-guest-token":            str(guest_token),
        "x-jf-client-theme":       "light",
        "x-jf-v":                   "JP-5",
        "x-twitter-active-user":   "yes",
        "x-twitter-client-language": "en",
    }

    # ── 6. begin_login ─────────────────────────────────────────────────────────
    log.info(f"[3] begin_login for '{username}'...")
    r_begin = session.post(
        "https://jf.x.com/onboarding/web/actions/begin_login",
        headers=jf,
        data={"username_or_email": username, "$castle_token": castle_token},
        timeout=25,
    )
    log.info(f"    begin_login status: {r_begin.status_code}")

    begin_str  = extract_jf_strings(r_begin.content)
    begin_text = " ".join(begin_str).lower()
    log.info(f"    begin_login strings: {[s for s in begin_str if len(s)>3][:6]}")

    if "temporarily limited" in begin_text or "try again later" in begin_text:
        raise RuntimeError("LOGIN_LIMITED — temporarily limited by Twitter")
    if "couldn't find" in begin_text or "not found" in begin_text or "no account" in begin_text:
        raise RuntimeError("ACCOUNT_NOT_FOUND — username does not exist")
    if "castle" in begin_text or "verification" in begin_text:
        raise RuntimeError("CASTLE_REJECTED — castle token rejected")
    if r_begin.status_code == 429 or "too many" in begin_text:
        raise RuntimeError("RATE_LIMITED — too many requests")

    session_token = find_session_token(r_begin.content)
    if not session_token:
        detail = " ".join(s for s in begin_str if len(s) > 3) or "no session_token"
        raise RuntimeError(f"LOGIN_FAILED — {detail}")
    log.info(f"    session_token: {session_token}")

    # ── 7. login_enter_password ────────────────────────────────────────────────
    log.info("[4] login_enter_password...")
    r_pw = session.post(
        "https://jf.x.com/onboarding/web/actions/login_enter_password",
        headers=jf,
        data={
            "username":      username,
            "password":      password,
            "session_token": session_token,
            "$castle_token": castle_token,
        },
        timeout=25,
    )
    log.info(f"    login_enter_password status: {r_pw.status_code}")

    pw_str  = extract_jf_strings(r_pw.content)
    pw_text = " ".join(pw_str).lower()
    log.info(f"    pw strings: {[s for s in pw_str if len(s)>3][:8]}")

    if "wrong password" in pw_text or "incorrect password" in pw_text or "password was incorrect" in pw_text:
        raise RuntimeError("WRONG_PASSWORD — password is incorrect")
    if "suspended" in pw_text or "locked" in pw_text:
        raise RuntimeError("ACCOUNT_SUSPENDED — account is suspended")
    if "not allowed to log in" in pw_text:
        raise RuntimeError("LOGIN_NOT_ALLOWED — login blocked by Twitter")
    if "too many" in pw_text or "try again in a few" in pw_text:
        raise RuntimeError("RATE_LIMITED — too many login attempts")

    # ── 8. 2FA (TOTP) ─────────────────────────────────────────────────────────
    needs_2fa = (
        "two_factor" in pw_text
        or "totp" in pw_text
        or "prelude_dispatch_id" in pw_text
        or "from_prelude_gate" in pw_text
    )

    if needs_2fa:
        log.info("[4.5] 2FA detected — submitting TOTP...")

        if not totp_secret:
            raise RuntimeError("2FA_REQUIRED — account requires 2FA but no TOTP secret provided")

        # Get 6-digit TOTP code
        try:
            import pyotp
            code = pyotp.TOTP(totp_secret.strip().replace(" ", "")).now()
        except Exception as e:
            raise RuntimeError(f"2FA_ERROR — pyotp failed: {e}")

        # Find prelude UUID
        all_uuids  = find_all_uuids(r_pw.content)
        prelude_id = next((u for u in all_uuids if u.lower() != session_token.lower()), None) or session_token
        log.info(f"    prelude_dispatch_id: {prelude_id}")

        # begin_two_factor_auth
        r_2fa_begin = session.post(
            "https://jf.x.com/onboarding/web/actions/begin_two_factor_auth",
            headers=jf,
            data={"prelude_dispatch_id": prelude_id, "session_token": session_token, "$castle_token": castle_token},
            timeout=20,
        )
        log.info(f"    begin_2fa status: {r_2fa_begin.status_code}")
        twofactor_token = find_session_token(r_2fa_begin.content) or session_token

        # two_factor_login_verification
        r_verify = session.post(
            "https://jf.x.com/onboarding/web/actions/two_factor_login_verification",
            headers=jf,
            data={
                "two_factor_auth_code": code,
                "session_token":        twofactor_token,
                "$castle_token":        castle_token,
            },
            timeout=20,
        )
        log.info(f"    2FA verify status: {r_verify.status_code}")
        verify_str  = extract_jf_strings(r_verify.content)
        verify_text = " ".join(verify_str).lower()
        log.info(f"    2FA strings: {[s for s in verify_str if len(s)>3][:6]}")

        if "incorrect" in verify_text or "invalid" in verify_text:
            raise RuntimeError("2FA_WRONG — incorrect TOTP code")

    # ── 9. Extract auth token from cookie ─────────────────────────────────────
    log.info("[5] Extracting auth_token from cookies...")

    # Try getting cookies from x.com home page
    try:
        session.get("https://x.com/home", timeout=15)
    except Exception:
        pass

    auth_token = session.cookies.get("auth_token", domain=".x.com") or session.cookies.get("auth_token")
    ct0        = session.cookies.get("ct0",        domain=".x.com") or session.cookies.get("ct0")
    twid       = session.cookies.get("twid",       domain=".x.com") or session.cookies.get("twid")

    if not auth_token:
        raise RuntimeError("NO_AUTH_TOKEN — login succeeded but no auth_token cookie set")

    return {"auth_token": auth_token, "ct0": ct0 or "", "twid": twid or ""}


# ══════════════════════════════════════════════════════════════════════════════
#  ACCOUNT PROCESSING & BATCH RUNNER
# ══════════════════════════════════════════════════════════════════════════════

_results_lock   = threading.Lock()
_all_results    = []


def save_result(username: str, result: dict):
    """Append successful result to token.txt and results.txt."""
    with _results_lock:
        line = f"{username} | {result['auth_token']} | {result['ct0']} | {result['twid']}"
        with open(RESULTS_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        with open(TOKEN_FILE, "a", encoding="utf-8") as f:
            f.write(result["auth_token"] + "\n")
        _all_results.append({"username": username, **result, "status": "ok"})
        JSON_FILE.write_text(json.dumps(_all_results, indent=2, ensure_ascii=False), encoding="utf-8")


def save_failure(username: str, error: str):
    """Record a failed account."""
    with _results_lock:
        _all_results.append({"username": username, "status": "fail", "error": error})
        JSON_FILE.write_text(json.dumps(_all_results, indent=2, ensure_ascii=False), encoding="utf-8")


def completed_usernames() -> set[str]:
    """Read already-done usernames from results.txt."""
    done = set()
    if RESULTS_FILE.exists():
        for line in RESULTS_FILE.read_text(encoding="utf-8").splitlines():
            parts = line.split("|")
            if parts:
                done.add(parts[0].strip())
    return done


def process_account(idx: int, total: int, parts: list[str]) -> None:
    """Login a single account with retry logic."""
    username     = parts[0].strip()
    password     = parts[1].strip()
    totp_secret  = parts[4].strip() if len(parts) > 4 else None
    has_2fa      = bool(totp_secret)

    tag = f"[{idx}/{total}]"
    label = f"{username} {'[2FA]' if has_2fa else ''}"
    print(f"\n{tag} >>  Logging in: {label} | Castle token dynamic")

    last_err = ""
    for attempt in range(MAX_RETRIES + 1):
        if attempt > 0:
            print(f"{tag} ~~  {username}  ->  Retry {attempt}/{MAX_RETRIES}: [{last_err[:40]}] (Rotating fresh Proxy IP...)")
            time.sleep(RETRY_SLEEP)

        try:
            result = login(username, password, totp_secret)

            print(f"{tag} OK  {username}")
            print(f"    auth_token = {result['auth_token']}")
            print(f"    ct0        = {result['ct0']}")
            print(f"    twid       = {result['twid']}")
            save_result(username, result)
            return

        except RuntimeError as e:
            err = str(e)
            last_err = err.split(" — ")[0]  # Error code only

            # Non-retryable errors — stop immediately
            if any(err.startswith(code) for code in NOT_RETRYABLE):
                msg = err.split(" — ", 1)[1] if " — " in err else err
                print(f"{tag} !!  {username}  ->  [{last_err}] لن يتم إعادة المحاولة — {msg}")
                save_failure(username, err)
                return

            # Retryable — continue loop
            log.warning(f"Retryable error (attempt {attempt+1}): {err}")

        except Exception as e:
            last_err = "ERROR"
            log.warning(f"Unexpected error (attempt {attempt+1}): {e}")

    # All retries exhausted
    print(f"{tag} !!  {username}  ->  [{last_err}] لن يتم إعادة المحاولة — All retries exhausted")
    save_failure(username, last_err)


# ══════════════════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

def main():
    if not ACCOUNTS_FILE.exists():
        print(f"ERROR: {ACCOUNTS_FILE} not found")
        sys.exit(1)

    # Read accounts
    all_accounts = [
        l.strip().split(":")
        for l in ACCOUNTS_FILE.read_text(encoding="utf-8").splitlines()
        if l.strip() and len(l.strip().split(":")) >= 2
    ]

    done     = completed_usernames()
    pending  = [a for a in all_accounts if a[0].strip() not in done]
    total    = len(all_accounts)
    skipped  = total - len(pending)

    proxy_count = proxy_pool.count()

    print("=" * 60)
    print("  X (Twitter) Auth Token Fetcher  —  BATCH MODE")
    print(f"  Accounts file        : {ACCOUNTS_FILE.name} ({total} total)")
    print(f"  Already completed    : {skipped} accounts (skipping)")
    print(f"  Remaining to process : {len(pending)} accounts")
    print(f"  Proxy pool           : {proxy_count} proxies in {PROXY_FILE.name}" if proxy_count else
          f"  Proxy pool           : empty — using dynamic PROXY_RAW fallback")
    print(f"  Threads              : {THREADS}")
    print("=" * 60)

    if not pending:
        print("  All accounts already completed!")
        return

    fail_counts: dict[str, int] = {}

    if THREADS == 1:
        for idx, parts in enumerate(pending, 1):
            process_account(idx, len(pending), parts)
    else:
        sem = threading.Semaphore(THREADS)
        threads = []
        for idx, parts in enumerate(pending, 1):
            def worker(i=idx, p=parts):
                with sem:
                    process_account(i, len(pending), p)
            t = threading.Thread(target=worker)
            t.start()
            threads.append(t)
        for t in threads:
            t.join()

    # Final summary
    ok   = [r for r in _all_results if r.get("status") == "ok"]
    fail = [r for r in _all_results if r.get("status") == "fail"]

    for r in fail:
        code = r.get("error", "").split(" — ")[0]
        fail_counts[code] = fail_counts.get(code, 0) + 1

    print("\n" + "=" * 60)
    print(f"  DONE  ✓ {len(ok)}/{len(pending)} succeeded  ✗ {len(fail)} failed")
    for code, cnt in fail_counts.items():
        print(f"    {code:<25} x{cnt}")
    print(f"  Results saved to: {RESULTS_FILE}")
    print(f"  Auth tokens in  : {TOKEN_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    main()
