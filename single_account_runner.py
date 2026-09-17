import sys
import json
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from auth_token import login, proxy_pool

def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--totp", default=None)
    parser.add_argument("--proxy", default=None)
    args = parser.parse_args()

    if args.proxy:
        parsed = proxy_pool._parse(args.proxy)
        if parsed:
            proxy_pool._proxies.insert(0, args.proxy)

    result_payload = {}
    try:
        res = login(args.username, args.password, args.totp)
        result_payload = {
            "success": True,
            "auth_token": res.get("auth_token", ""),
            "ct0": res.get("ct0", ""),
            "twid": res.get("twid", ""),
            "error": None
        }
    except Exception as e:
        result_payload = {
            "success": False,
            "auth_token": None,
            "ct0": None,
            "twid": None,
            "error": str(e)
        }

    sys.stdout.write(f"\n__RESULT_JSON__:{json.dumps(result_payload)}\n")
    sys.stdout.flush()

if __name__ == "__main__":
    run()
