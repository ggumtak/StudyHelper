"""
Study Helper - Backend Server

English-only strings to avoid encoding issues.
"""

from __future__ import annotations

import atexit
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
import traceback
import http.server
import socketserver
import webbrowser
import json as json_lib
import platform
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

# Prefer external source tree beside the executable when bundled (hybrid mode)
INSTALL_BASE = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[2]
EXTERNAL_SRC = Path(os.getenv("STUDYHELPER_SRC_DIR", INSTALL_BASE / "src"))
if EXTERNAL_SRC.exists() and str(EXTERNAL_SRC) not in sys.path:
    sys.path.insert(0, str(EXTERNAL_SRC))

from ai_drill.local_generator import build_local_session
from ai_drill.main import build_session_payload
from ai_drill.llm_client import LLMClient
from ai_drill.quiz_parser import parse_response
from ai_drill.version import APP_VERSION
from ai_drill.tray_icon import TrayController

# Paths & runtime preparation
RUNTIME_DIR = Path(os.getenv("STUDYHELPER_RUNTIME_DIR", Path(tempfile.gettempdir()) / "studyhelper"))


def _is_frozen() -> bool:
    return getattr(sys, "frozen", False)


def _bundle_root() -> Path:
    if _is_frozen():
        exe_dir = Path(sys.executable).resolve().parent
        external_root = Path(os.getenv("STUDYHELPER_EXTERNAL_ROOT", exe_dir))
        if (external_root / "src").exists() or (external_root / "web_app").exists():
            return external_root
        return Path(getattr(sys, "_MEIPASS", exe_dir))
    return Path(__file__).resolve().parents[2]


def _resolve_source_dir(root: Path, name: str) -> Path | None:
    """
    Find the best-matching source directory for assets (web_app/data/config),
    preferring root-level folders, then src/<name>.
    """
    candidates = [root / name, root / "src" / name]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _prepare_runtime_root() -> Path:
    """
    When running as a bundled exe, copy static assets to a writable temp dir
    so the server can persist session/log/config files.
    """
    runtime_root = RUNTIME_DIR
    clean_runtime = os.getenv("STUDYHELPER_CLEAN_RUNTIME") == "1"
    keep_runtime = os.getenv("STUDYHELPER_KEEP_RUNTIME") == "1"

    if clean_runtime:
        shutil.rmtree(runtime_root, ignore_errors=True)
    runtime_root.mkdir(parents=True, exist_ok=True)

    source_root = _bundle_root()
    for name in ("web_app", "data", "config"):
        src = _resolve_source_dir(source_root, name)
        dest = runtime_root / name
        if not src:
            continue
        if name == "config" and dest.exists():
            for item in src.rglob("*"):
                rel = item.relative_to(src)
                target = dest / rel
                if item.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    if not target.exists():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(item, target)
        else:
            shutil.copytree(src, dest, dirs_exist_ok=True)
    (runtime_root / "logs").mkdir(parents=True, exist_ok=True)
    os.environ["STUDYHELPER_RUNTIME_DIR"] = str(runtime_root)

    if clean_runtime and not keep_runtime:
        atexit.register(lambda: shutil.rmtree(runtime_root, ignore_errors=True))
    return runtime_root


if _is_frozen():
    PROJECT_DIR = _prepare_runtime_root()
else:
    PROJECT_DIR = Path(__file__).resolve().parents[2]


def _read_version_from_disk() -> str:
    candidates = [
        _bundle_root() / "version.json",
        _bundle_root() / "web_app" / "version.json",
    ]
    for path in candidates:
        try:
            if path.exists():
                data = json.loads(path.read_text(encoding="utf-8"))
                version = data.get("core_version") or data.get("version")
                if version:
                    return str(version)
        except Exception:
            continue
    return APP_VERSION


VERSION_FROM_FILE = _read_version_from_disk()

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
port_attempts: list[int] = []

# Ensure folders exist
for folder in (DATA_DIR, CONFIG_DIR, LOG_DIR):
    folder.mkdir(parents=True, exist_ok=True)

# Preset files
PRESET_FILES = {
    "oop_vocab": {
        "name": "1_OOP_Vocabulary.txt",
        "path": DATA_DIR / "1_OOP_Vocabulary.txt",
    },
    "oop_concept": {
        "name": "2_OOP_Concepts.txt",
        "path": DATA_DIR / "2_OOP_Concepts.txt",
    },
    "oop_code": {
        "name": "3_OOP_Code_Blanks.txt",
        "path": DATA_DIR / "3_OOP_Code_Blanks.txt",
    },
    "data_structure": {
        "name": "4_Data_Structure_Code.txt",
        "path": DATA_DIR / "4_Data_Structure_Code.txt",
    },
    "math_theory": {
        "name": "5_Computational_Math_Theory.txt",
        "path": DATA_DIR / "5_Computational_Math_Theory.txt",
    },
    "math_practice": {
        "name": "6_Computational_Math_Practice.txt",
        "path": DATA_DIR / "6_Computational_Math_Practice.txt",
    },
}

MODE_LABELS = {
    1: "OOP fill-in-the-blank",
    2: "OOP concept Q&A",
    3: "OOP code blanks",
    4: "Data structure code",
    5: "Computational math theory",
    6: "Computational math practice",
    7: "Vocabulary",
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


def save_server_info(port: int | None = None, ports_tried: list[int] | None = None):
    global current_port, port_attempts
    if port:
        current_port = port
    if ports_tried:
        port_attempts = ports_tried

    local_ip = get_local_ip()
    info = {
        "local_ip": local_ip,
        "port": current_port,
        "mobile_url": f"http://{local_ip}:{current_port}",
        "presets": {k: v["name"] for k, v in PRESET_FILES.items()},
        "modes": MODE_LABELS,
        "version": VERSION_FROM_FILE,
        "app_version": APP_VERSION,
        "runtime_dir": str(PROJECT_DIR),
        "ports_tried": ports_tried or port_attempts,
    }
    try:
        info_path = WEB_APP_DIR / "server_info.json"
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=True, indent=2)
    except Exception as e:
        log_error(f"server_info save failed: {e}")


def create_fallback_session() -> dict:
    return {
        "title": "Default session",
        "language": "plaintext",
        "mode": 3,
        "question": "Default session placeholder. Choose a file/mode to start.",
        "answer_key": {"_type": "whiteboard", "_challenges": []},
        "original_code": "",
    }


def proxy_gemini_text(api_key: str, prompt: str, system_instruction: str, chat_history: list) -> str:
    """
    Minimal Gemini proxy to keep API key server-side.
    chat_history: list of {role, parts:[{text}]} compatible with previous frontend format.
    """
    try:
        import google.generativeai as genai  # type: ignore
    except ImportError as exc:
        raise RuntimeError("google-generativeai not installed on server") from exc

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.0-flash", system_instruction=system_instruction or None)

    contents = []
    if chat_history and isinstance(chat_history, list):
        contents.extend(chat_history)
    contents.append({"role": "user", "parts": [{"text": prompt}]})

    try:
        response = model.generate_content(contents=contents, generation_config=genai.types.GenerationConfig(temperature=0.2))
        return response.text or ""
    except Exception as exc:
        raise RuntimeError(f"Gemini request failed: {exc}") from exc


def read_preset_content(preset_key: str) -> tuple[str, str]:
    if preset_key not in PRESET_FILES:
        raise ValueError(f"Unknown preset: {preset_key}")
    preset_info = PRESET_FILES[preset_key]
    candidate = preset_info["path"]
    if candidate.exists():
        return candidate.read_text(encoding="utf-8"), str(candidate)
    raise FileNotFoundError(f"Preset file not found: {candidate.name}")


def generate_session(
    preset_key: str,
    mode: int,
    method: str = "local",
    custom_content: str | None = None,
    custom_filename: str | None = None,
    difficulty: int = 2,
) -> dict:
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
                return {"error": "No content provided."}
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
            return {"error": "Content is empty."}

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

        try:
            with open(SESSION_FILE, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=True, indent=2)
        except Exception as e:
            log_error(f"session save failed: {e}")
            return {"error": f"Session save failed: {str(e)}"}

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
        return {"error": f"Unexpected error: {str(e)}"}


class APIHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_APP_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        # Suppress default console logging
        pass

    def send_json_response(self, data: dict, status: int = 200):
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            body = json.dumps(data, ensure_ascii=True)
            self.wfile.write(body.encode("utf-8"))
        except Exception as e:
            log_error(f"JSON response error: {e}")

    def do_GET(self):
        try:
            if self.path == "/api/info":
                save_server_info()
                info_path = WEB_APP_DIR / "server_info.json"
                with open(info_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.send_json_response(data)
                return

            if self.path.startswith("/data/"):
                clean_path = self.path.split("?")[0]
                file_name = unquote(clean_path.replace("/data/", ""))
                candidate_paths = [
                    DATA_DIR / file_name,
                    WEB_APP_DIR / "data" / file_name,
                ]
                file_path = next((p for p in candidate_paths if p.exists() and p.is_file()), None)
                if file_path:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain; charset=utf-8")
                    self.end_headers()
                    with open(file_path, "r", encoding="utf-8") as f:
                        self.wfile.write(f.read().encode("utf-8"))
                else:
                    self.send_error(404, f"File not found: {file_name}")
                return

            super().do_GET()
        except Exception as e:
            log_error(f"GET error: {self.path} - {e}")
            self.send_error(500, str(e))

    def do_POST(self):
        try:
            if self.path == "/api/generate":
                content_length = int(self.headers.get("Content-Length", 0))
                if content_length == 0:
                    self.send_json_response({"error": "empty request"}, 400)
                    return
                post_data = self.rfile.read(content_length).decode("utf-8")
                data = json.loads(post_data)
                preset = data.get("preset", "oop_vocab")
                mode = int(data.get("mode", 7))
                method = data.get("method", "local")
                custom_content = data.get("content")
                custom_filename = data.get("fileName")

                raw_difficulty = data.get("difficulty", 2)
                if isinstance(raw_difficulty, str):
                    difficulty_map = {"easy": 1, "normal": 2, "hard": 3, "extreme": 4}
                    difficulty = difficulty_map.get(raw_difficulty.lower(), 2)
                else:
                    try:
                        difficulty = int(raw_difficulty)
                    except (ValueError, TypeError):
                        difficulty = 2

                result = generate_session(preset, mode, method, custom_content, custom_filename, difficulty)
                self.send_json_response(result)
                return

            if self.path == "/api/gemini-proxy":
                content_length = int(self.headers.get("Content-Length", 0))
                if content_length == 0:
                    self.send_json_response({"error": "empty request"}, 400)
                    return
                post_data = self.rfile.read(content_length).decode("utf-8")
                data = json_lib.loads(post_data)
                prompt = data.get("prompt", "").strip()
                if not prompt:
                    self.send_json_response({"error": "prompt required"}, 400)
                    return

                system_instruction = data.get("systemInstruction") or ""
                chat_history = data.get("chatHistory") or []

                # Load API key
                api_key = os.getenv("GEMINI_API_KEY") or load_api_key_from_file()
                if not api_key:
                    self.send_json_response({"error": "API key not configured on server"}, 400)
                    return

                try:
                    text = proxy_gemini_text(api_key, prompt, system_instruction, chat_history)
                    self.send_json_response({"text": text})
                except Exception as exc:
                    log_error(f"gemini proxy error: {exc}")
                    self.send_json_response({"error": str(exc)}, 500)
                return

            if self.path == "/shutdown":
                self.send_response(200)
                self.end_headers()
                threading.Thread(target=lambda: os._exit(0), daemon=True).start()
                return

            if self.path == "/api/clear-cache":
                self.send_json_response({"success": True})
                return

            if self.path == "/api/save-key":
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length).decode("utf-8")
                data = json.loads(post_data)
                api_key = data.get("api_key", "").strip()
                if api_key:
                    API_KEY_FILE.write_text(api_key, encoding="utf-8")
                    os.environ["GEMINI_API_KEY"] = api_key
                    self.send_json_response({"success": True})
                else:
                    self.send_json_response({"error": "empty"}, 400)
                return

            self.send_error(405)
        except Exception as e:
            log_error(f"POST error: {e}")
            self.send_json_response({"error": str(e)}, 500)


def find_available_port(start_port, max_retries=10):
    attempts: list[int] = []
    for i in range(max_retries):
        port = start_port + i
        attempts.append(port)
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("0.0.0.0", port))
                return port, attempts
        except OSError:
            log_error(f"Port {port} unavailable, trying next")
            continue
    raise RuntimeError(f"No available port in range starting at {start_port}")


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
    global current_port, port_attempts
    log_error("=" * 50)
    log_error("Study Helper server starting...")
    log_error("=" * 50)
    try:
        port, attempts = find_available_port(BASE_PORT, MAX_PORT_RETRIES)
        current_port = port
        port_attempts = attempts
        log_error(f"Port selection attempts: {attempts} -> chosen {port}")
    except RuntimeError as e:
        log_error(f"Fatal: {e}")
        sys.exit(1)

    save_server_info(port, attempts)
    result = generate_session("oop_vocab", 7)
    if not result.get("success"):
        try:
            with open(SESSION_FILE, "w", encoding="utf-8") as f:
                json.dump(create_fallback_session(), f, ensure_ascii=True, indent=2)
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

    tray = None
    if platform.system() == "Windows":
        def _open_ui():
            try:
                webbrowser.open(f"http://localhost:{port}")
            except Exception as exc:
                log_error(f"Tray open failed: {exc}")

        def _exit_app():
            log_error("Tray requested shutdown.")
            os._exit(0)

        try:
            tray = TrayController("StudyHelper", _open_ui, _exit_app, log_error)
            tray.start()
        except Exception as exc:
            log_error(f"Tray init failed: {exc}")

    log_error("Server running...")
    start_server(port)


if __name__ == "__main__":
    main()
