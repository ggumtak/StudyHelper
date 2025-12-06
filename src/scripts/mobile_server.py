"""
Mobile-friendly launcher for Study Helper.
- Binds to 0.0.0.0 so same-Wi-Fi devices (phones/tablets) can open the web UI.
- Skips auto-opening a browser (Termux/Pydroid-safe).

Usage (Termux/Pydroid/Android):
  python scripts/mobile_server.py --port 8000
Then on the phone, open: http://<PHONE_IP>:8000
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Ensure src is on the path
ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from ai_drill import web_server  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Run Study Helper server for mobile access.")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on (default: 8000)")
    args = parser.parse_args()

    # Prevent auto browser open on Termux/Pydroid
    os.environ.setdefault("SKIP_AUTO_BROWSER_OPEN", "1")

    # Use requested port only
    web_server.BASE_PORT = args.port
    web_server.MAX_PORT_RETRIES = 1

    # Save server info + build default session
    web_server.save_server_info(args.port)
    try:
        result = web_server.generate_session("oop_vocab", 7)
        if not result.get("success"):
            print(f"[WARN] Default session generation failed: {result.get('error')}")
    except Exception as exc:  # pragma: no cover - safety net
        print(f"[WARN] Default session generation failed: {exc}")

    local_ip = web_server.get_local_ip()
    print(f"Mobile server starting on http://{local_ip}:{args.port} (bind=0.0.0.0)")
    print("Connect from devices on the same Wi-Fi/hotspot using the above address.")

    web_server.start_server(args.port)


if __name__ == "__main__":
    main()
