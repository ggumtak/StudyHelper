"""
Study Helper - Backend Server (clean UTF-8)
"""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import traceback
import http.server
import socketserver
import webbrowser
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

from ai_drill.local_generator import build_local_session
from ai_drill.main import build_session_payload
from ai_drill.llm_client import LLMClient
from ai_drill.quiz_parser import parse_response

# Paths
SCRIPT_DIR = Path(__file__).parent
if SCRIPT_DIR.parent.name == "src":
    PROJECT_DIR = SCRIPT_DIR.parent.parent
    WEB_APP_DIR = SCRIPT_DIR.parent / "web_app"
else:
    PROJECT_DIR = SCRIPT_DIR.parent
    WEB_APP_DIR = PROJECT_DIR / "web_app"

DATA_DIR = PROJECT_DIR / "data"
CONFIG_DIR = PROJECT_DIR / "config"
LOG_DIR = PROJECT_DIR / "logs"
SESSION_FILE = WEB_APP_DIR / "session.json"
LOG_FILE = LOG_DIR / "server_error.log"
API_KEY_FILE = CONFIG_DIR / "gemini_api_key.txt"

BASE_PORT = 3000
MAX_PORT_RETRIES = 50  # Try ports 3000-3049
current_port = BASE_PORT

# Ensure folders exist
for folder in (DATA_DIR, CONFIG_DIR, LOG_DIR):
    folder.mkdir(parents=True, exist_ok=True)

# Preset files (English names with legacy fallbacks)
PRESET_FILES = {
    "oop_vocab": {
        "name": "1_OOP_Vocabulary.txt",
        "path": DATA_DIR / "1_OOP_Vocabulary.txt",
        "legacy": [DATA_DIR / "1_OOP_영단어.txt"],
    },
    "oop_concept": {
        "name": "2_OOP_Concepts.txt",
        "path": DATA_DIR / "2_OOP_Concepts.txt",
        "legacy": [DATA_DIR / "2_OOP_개념어.txt"],
    },
    "oop_code": {
        "name": "3_OOP_Code_Blanks.txt",
        "path": DATA_DIR / "3_OOP_Code_Blanks.txt",
        "legacy": [DATA_DIR / "3_OOP_코드빈칸.txt", DATA_DIR / "CSharp_코드문제.txt"],
    },
    "data_structure": {
        "name": "4_Data_Structure_Code.txt",
        "path": DATA_DIR / "4_Data_Structure_Code.txt",
        "legacy": [DATA_DIR / "4_자료구조_코드.txt"],
    },
    "math_theory": {
        "name": "5_Computational_Math_Theory.txt",
        "path": DATA_DIR / "5_Computational_Math_Theory.txt",
        "legacy": [DATA_DIR / "5_전산수학_필기.txt"],
    },
    "math_practice": {
        "name": "6_Computational_Math_Practice.txt",
        "path": DATA_DIR / "6_Computational_Math_Practice.txt",
        "legacy": [DATA_DIR / "6_전산수학_실기.txt"],
    },
}

MODE_LABELS = {
    1: "OOP 빈칸 채우기",
    2: "OOP 개념어",
    3: "OOP 코드 빈칸",
    4: "자료구조 코드",
    5: "전산수학 필기",
    6: "전산수학 실기",
    7: "커스텀/추가",
}


def log_error(message: str):
    """Append message to server_error.log with timestamp."""
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")
            f.flush()
    except Exception:
        pass


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            hostname = socket.gethostname()
            return socket.gethostbyname(hostname)
        except Exception:
            return "127.0.0.1"


def load_api_key_from_file() -> str | None:
    try:
        if API_KEY_FILE.exists():
            key = API_KEY_FILE.read_text(encoding="utf-8").strip()
            return key or None
    except Exception as exc:
        log_error(f"API key read failed: {exc}")
    return None


def save_server_info(port: int | None = None):
    global current_port
    if port:
        current_port = port

    local_ip = get_local_ip()
    info = {
        "local_ip": local_ip,
        "port": current_port,
        "mobile_url": f"http://{local_ip}:{current_port}",
        "presets": {k: v["name"] for k, v in PRESET_FILES.items()},
        "modes": MODE_LABELS,
    }
    try:
        info_path = WEB_APP_DIR / "server_info.json"
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log_error(f"server_info save failed: {e}")


def create_fallback_session() -> dict:
    return {
        "title": "기본 세션",
        "language": "plaintext",
        "mode": 3,
        "question": "기본 세션입니다. 파일/모드를 선택해 세션을 생성하세요.",
        "answer_key": {"_type": "whiteboard", "_challenges": []},
        "original_code": "",
    }


def read_preset_content(preset_key: str) -> tuple[str, str]:
    if preset_key not in PRESET_FILES:
        raise ValueError(f"Unknown preset: {preset_key}")
    preset_info = PRESET_FILES[preset_key]
    candidates = [preset_info["path"]] + preset_info.get("legacy", [])
    for candidate in candidates:
        if candidate.exists():
            return candidate.read_text(encoding="utf-8"), str(candidate)
    tried = ", ".join(str(p.name) for p in candidates)
    raise FileNotFoundError(f"Preset file not found. Tried: {tried}")


def generate_session(preset_key: str, mode: int, method: str = "local",
                     custom_content: str | None = None, custom_filename: str | None = None,
                     difficulty: int = 2) -> dict:
    """
    Build a session using AI or local generator.
    Modes 1 and 6: AI is preferred; if AI fails, fallback to local.
    Mode 3: always local.
    """
    try:
        log_error(f"session build start: preset={preset_key}, mode={mode}, method={method}")

        # Load content
        if preset_key == "custom":
            if not custom_content:
                return {"error": "파일 내용이 비어 있습니다."}
            content = custom_content
            file_path = custom_filename or "custom_input.txt"
        else:
            try:
                content, file_path = read_preset_content(preset_key)
            except Exception as e:
                log_error(str(e))
                return {"error": str(e)}

        if not content.strip():
            log_error("Empty content")
            return {"error": "파일이 비어 있습니다."}

        # Decide AI or local
        force_ai = mode in (1, 6)
        force_local = mode == 3
        requested_ai = method == "ai"
        use_ai = (force_ai or requested_ai) and not force_local

        session = None
        llm_error = None

        if use_ai:
            api_key = os.getenv("GEMINI_API_KEY") or load_api_key_from_file()
            if not api_key:
                llm_error = "API key missing"
            else:
                try:
                    os.environ["GEMINI_API_KEY"] = api_key
                    client = LLMClient(api_key=api_key)
                    response_text = client.generate_drill(content, mode, difficulty)
                    session = parse_response(response_text, mode)
                    log_error("LLM generation succeeded")
                except Exception as e:
                    llm_error = str(e)
                    log_error(f"LLM generation failed: {e}")

        if session is None:
            log_error("Falling back to local generator")
            session = build_local_session(content, mode, difficulty)

        payload = build_session_payload(session, str(file_path))
        payload["generation_method"] = "ai" if use_ai else "local"
        if use_ai:
            payload["title"] = f"[AI] {payload.get('title', 'session')}"
        if llm_error:
            payload["llm_error"] = llm_error
            payload["generator"] = "local_fallback"

        # Save session
        try:
            with open(SESSION_FILE, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log_error(f"session save failed: {e}")
            return {"error": f"세션 저장 실패: {str(e)}"}

        answer_key = payload.get("answer_key", {})
        challenges_count = len(answer_key.get("_challenges", []))
        blanks_count = len([k for k in answer_key.keys() if not k.startswith("_")])
        questions_count = len(answer_key.get("_questions", []))

        log_error(f"session build ok: challenges={challenges_count}, blanks={blanks_count}, questions={questions_count}")
        return {
            "success": True,
            "challenges": challenges_count,
            "blanks": blanks_count,
            "questions": questions_count,
            "mode": mode,
            "preset": preset_key,
            "method": "ai" if use_ai else "local",
        }

    except Exception as e:
        error_msg = f"session build exception: {str(e)}\n{traceback.format_exc()}"
        log_error(error_msg)
        return {"error": f"예기치 못한 오류: {str(e)}"}


class APIHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_APP_DIR), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, format, *args):
        # Suppress default console logging
        pass

    def send_json_response(self, data: dict, status: int = 200):
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            body = json.dumps(data, ensure_ascii=False)
            self.wfile.write(body.encode('utf-8'))
        except Exception as e:
            log_error(f"JSON response error: {e}")

    def do_GET(self):
        try:
            if self.path == '/api/info':
                save_server_info()
                info_path = WEB_APP_DIR / "server_info.json"
                with open(info_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.send_json_response(data)
                return

            if self.path.startswith('/data/'):
                clean_path = self.path.split('?')[0]
                file_name = unquote(clean_path.replace('/data/', ''))
                candidate_paths = [
                    DATA_DIR / file_name,
                    WEB_APP_DIR / 'data' / file_name,
                ]
                file_path = next((p for p in candidate_paths if p.exists() and p.is_file()), None)
                if file_path:
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/plain; charset=utf-8')
                    self.end_headers()
                    with open(file_path, 'r', encoding='utf-8') as f:
                        self.wfile.write(f.read().encode('utf-8'))
                else:
                    self.send_error(404, f"File not found: {file_name}")
                return

            super().do_GET()
        except Exception as e:
            log_error(f"GET error: {self.path} - {e}")
            self.send_error(500, str(e))

    def do_POST(self):
        try:
            if self.path == '/api/generate':
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length == 0:
                    self.send_json_response({"error": "empty request"}, 400)
                    return
                post_data = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(post_data)
                preset = data.get('preset', 'oop_vocab')
                mode = int(data.get('mode', 7))
                method = data.get('method', 'local')
                custom_content = data.get('content')
                custom_filename = data.get('fileName')
                
                # Handle difficulty - can be number or string like 'easy', 'normal', 'hard', 'extreme'
                raw_difficulty = data.get('difficulty', 2)
                if isinstance(raw_difficulty, str):
                    difficulty_map = {'easy': 1, 'normal': 2, 'hard': 3, 'extreme': 4}
                    difficulty = difficulty_map.get(raw_difficulty.lower(), 2)
                else:
                    try:
                        difficulty = int(raw_difficulty)
                    except (ValueError, TypeError):
                        difficulty = 2
                
                result = generate_session(preset, mode, method, custom_content, custom_filename, difficulty)
                self.send_json_response(result)
                return

            if self.path == '/shutdown':
                self.send_response(200)
                self.end_headers()
                threading.Thread(target=lambda: os._exit(0), daemon=True).start()
                return

            if self.path == '/api/clear-cache':
                self.send_json_response({"success": True})
                return

            if self.path == '/api/save-key':
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(post_data)
                api_key = data.get('api_key', '').strip()
                if api_key:
                    API_KEY_FILE.write_text(api_key, encoding='utf-8')
                    os.environ['GEMINI_API_KEY'] = api_key
                    self.send_json_response({"success": True})
                else:
                    self.send_json_response({"error": "empty"}, 400)
                return

            self.send_error(405)
        except Exception as e:
            log_error(f"POST error: {e}")
            self.send_json_response({"error": str(e)}, 500)


def find_available_port(start_port, max_retries=10):
    for i in range(max_retries):
        port = start_port + i
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("0.0.0.0", port))
                return port
        except OSError:
            continue
    raise RuntimeError("No available port")


def start_server(port: int):
    global current_port
    current_port = port
    os.chdir(str(WEB_APP_DIR))
    socketserver.ThreadingTCPServer.allow_reuse_address = True

    class SafeAPIHandler(APIHandler):
        def handle(self):
            try:
                super().handle()
            except Exception as e:
                log_error(f"Handler error: {e}")

    try:
        with socketserver.ThreadingTCPServer(("0.0.0.0", port), SafeAPIHandler) as httpd:
            log_error(f"Server running on http://localhost:{port}")
            httpd.serve_forever()
    except Exception as e:
        log_error(f"Server error: {e}")
        time.sleep(2)
        start_server(port)


def main():
    global current_port
    log_error("=" * 50)
    log_error("Study Helper server starting...")
    log_error("=" * 50)
    try:
        port = find_available_port(BASE_PORT, MAX_PORT_RETRIES)
        current_port = port
    except RuntimeError as e:
        log_error(f"Fatal: {e}")
        sys.exit(1)

    save_server_info(port)
    result = generate_session("oop_vocab", 7)
    if not result.get("success"):
        try:
            with open(SESSION_FILE, "w", encoding="utf-8") as f:
                json.dump(create_fallback_session(), f, ensure_ascii=False, indent=2)
        except Exception as e:
            log_error(f"Fallback save failed: {e}")

    if os.getenv("SKIP_AUTO_BROWSER_OPEN") != "1":
        def open_browser():
            time.sleep(0.5)
            try:
                webbrowser.open(f"http://localhost:{port}")
            except Exception:
                pass
        threading.Thread(target=open_browser, daemon=True).start()

    log_error("Server running...")
    start_server(port)


if __name__ == "__main__":
    main()
