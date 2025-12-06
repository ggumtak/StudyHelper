"""
Mobile-friendly launcher for Study Helper.
- Binds to 0.0.0.0 so same-Wi-Fi devices (phones/tablets) can open the web UI.
- Skips auto-opening a browser (Termux/Pydroid-safe).

Usage (Termux/Pydroid/Android):
  python scripts/mobile_server.py --port 8000
Then on the phone, open: http://<폰 IP>:8000
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

    # Termux/Pydroid에서 브라우저 자동 실행 방지
    os.environ.setdefault("SKIP_AUTO_BROWSER_OPEN", "1")

    # 요청된 포트 고정 사용
    web_server.BASE_PORT = args.port
    web_server.MAX_PORT_RETRIES = 1

    # 서버 정보 저장 + 기본 세션 생성
    web_server.save_server_info(args.port)
    try:
        result = web_server.generate_session("oop_vocab", 7)
        if not result.get("success"):
            print(f"[WARN] 기본 세션 생성 실패: {result.get('error')}")
    except Exception as exc:  # pragma: no cover - 안전망
        print(f"[WARN] 기본 세션 생성 실패: {exc}")

    local_ip = web_server.get_local_ip()
    print(f"Mobile server starting on http://{local_ip}:{args.port} (bind=0.0.0.0)")
    print("같은 Wi-Fi/핫스팟 기기에서 위 주소로 접속하세요.")

    web_server.start_server(args.port)


if __name__ == "__main__":
    main()
