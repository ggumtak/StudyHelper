"""
================================================================================
Study Helper - ?�합 ???�버
================================================================================

## ?�로?�트 개요
???�일?� Study Helper???�심 백엔???�버?�니??
콘솔 창이???�처 GUI ?�이, ??UI만으�?모든 기능???�어?�니??

## ?�행 방식
1. ?�클�??�행.bat�??�블?�릭?�면 ???�버가 백그?�운?�에???�행?�니??
2. 브라?��?가 ?�동?�로 ?�리�? ??UI?�서 ?�일/모드 ?�택, ?�션 ?�성, ?�습 진행??가?�합?�다.
3. 콘솔 창�? ?�도?�으�??��? 처리?�어 ?�습?�다 (start /min 명령 ?�용).

## 주요 기능
- /api/generate: ?�리???�일�??�습 ?�션 ?�성 (로컬 ?�는 AI)
- /api/info: ?�버 ?�보 조회 (?�트, 모바??URL ??
- ?�적 ?�일 ?�빙: web_app ?�더??HTML/CSS/JS ?�일 ?�공

## 중요 ?�내
- ???�버??콘솔 �??�이 ?�행?��?�??�러??server_error.log??기록?�니??
- ?�버 종료???�업 관리자?�서 python ?�로?�스�?종료?�거?? 
  브라?��??�서 /shutdown ?�드?�인?��? ?�출?�면 ?�니??

## 코드 ?�수?�계 ?�당??참고
- ?�용?��? ??UI?�서 ?�일/모드�??�택?�면 /api/generate�?POST ?�청???�니??
- ?�션?� web_app/session.json???�?�되�? ?�론?�엔?��? ?��? 로드?�니??
- ?�러 발생 ??server_error.log�??�인?�세??

?�성?? 2024-12
================================================================================
"""
import os
import sys
import json
import socket
import threading
import webbrowser
import time
import http.server
import socketserver
import traceback
from pathlib import Path
from datetime import datetime
from urllib.parse import unquote

# ============================================================================
# Windows 콘솔 UTF-8 ?�코???�정
# Windows?�서 ?��? 출력 ??깨짐 방�?
# ============================================================================
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass

# ============================================================================
# 경로 ?�정 (???�더 구조 + ?�전 구조 ?�환)
# src/ai_drill/web_server.py ?�는 ai_drill/web_server.py 모두 지??
# ============================================================================
SCRIPT_DIR = Path(__file__).parent             # ai_drill ?�더

# ?�로?�트 루트 찾기: src/ai_drill ?�는 ai_drill ?�태 모두 지??
if SCRIPT_DIR.parent.name == "src":
    PROJECT_DIR = SCRIPT_DIR.parent.parent     # src???�위 = ?�로?�트 루트
    WEB_APP_DIR = SCRIPT_DIR.parent / "web_app"  # src/web_app
else:
    PROJECT_DIR = SCRIPT_DIR.parent            # ?�전 구조: ai_drill???�위
    WEB_APP_DIR = PROJECT_DIR / "web_app"      # web_app

DATA_DIR = PROJECT_DIR / "data"                # ?�습 ?�료 ?�더
CONFIG_DIR = PROJECT_DIR / "config"            # ?�정/?�큰 ?�더
LOG_DIR = PROJECT_DIR / "logs"                 # 로그 ?�더
SESSION_FILE = WEB_APP_DIR / "session.json"    # ?�재 ?�습 ?�션 ?�???�치
LOG_FILE = LOG_DIR / "server_error.log"        # ?�러 로그 ?�일
API_KEY_FILE = CONFIG_DIR / "gemini_api_key.txt"  # Gemini API ???�일
BASE_PORT = 8000                               # 기본 ?�트 (8000~8009 ?�도)
MAX_PORT_RETRIES = 10                          # ?�트 충돌 ??최�? ?�시???�수

# ?�수 ?�더 ?�성
for folder in (DATA_DIR, CONFIG_DIR, LOG_DIR):
    folder.mkdir(parents=True, exist_ok=True)

# ?�재 ?�용 중인 ?�트 (?�적 ?�당??
current_port = BASE_PORT

# ============================================================================
# 모듈 Import
# ai_drill ?�키지?�서 ?�션 ?�성 관???�수?�을 불러?�니??
# ============================================================================
# ??구조: src/ai_drill, src/web_app ??src�?path??추�?
# ?�전 구조: ai_drill, web_app ???�로?�트 루트�?path??추�?
if SCRIPT_DIR.parent.name == "src":
    sys.path.insert(0, str(SCRIPT_DIR.parent))  # src ?�더
else:
    sys.path.insert(0, str(PROJECT_DIR))        # ?�로?�트 루트

try:
    from ai_drill.local_generator import build_local_session
    from ai_drill.main import build_session_payload
except ImportError as e:
    # ???�러??치명?�이므�?로그??기록?�고 종료
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[FATAL] 모듈 import ?�패: {e}\n")
    sys.exit(1)

# ============================================================================
# ?�리???�일 목록
# ??UI??"?�일 ?�택" 버튼?�서 ?�택?????�는 ?�일?�입?�다.
# ???�일??추�??�려�??�기????��??추�??�세??
# ============================================================================
# ============================================================================
# ?? ?? ?? (???)
# UI?? "?? ?? ??" ???? ???? ?? ?????.
# ?? ??? ??/????? ??? ??? ?????.
PRESET_FILES = {
    "oop_vocab": {
        "name": "1_OOP_영단어.txt",
        "path": DATA_DIR / "1_OOP_영단어.txt"
    },
    "oop_concept": {
        "name": "2_OOP_개념어.txt",
        "path": DATA_DIR / "2_OOP_개념어.txt"
    },
    "oop_code": {
        "name": "3_OOP_코드빈칸.txt",
        "path": DATA_DIR / "3_OOP_코드빈칸.txt"
    },
    "data_structure": {
        "name": "4_자료구조_코드.txt",
        "path": DATA_DIR / "4_자료구조_코드.txt"
    },
    "math_theory": {
        "name": "5_전산수학_필기.txt",
        "path": DATA_DIR / "5_전산수학_필기.txt"
    },
    "math_practice": {
        "name": "6_전산수학_실기.txt",
        "path": DATA_DIR / "6_전산수학_실기.txt"
    }
}
MODE_LABELS = {
    1: "OOP 빈칸 채우기",
    2: "OOP 개념어",
    3: "OOP 코드 빈칸",
    4: "자료구조 코드",
    5: "전산수학 필기",
    6: "전산수학 실기",
    7: "커스텀/추가"
}
def log_error(message: str):
    """
    ?�러/?�버�?메시지�?로그 ?�일??기록?�니??
    
    주의: ???�버??콘솔 창이 ?�으므�?print() ?�?????�수�??�용?�세??
    로그 ?�일 ?�치: ?�로?�트 루트/logs/server_error.log
    
    Args:
        message: 기록??메시지 (?��? 가??
    """
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")
            f.flush()  # 즉시 ?�일??기록
    except:
        pass  # 로그 ?�패??무시 (무한 ?�러 방�?)


def get_local_ip():
    """
    ??PC??로컬 IP 주소�?가?�옵?�다.
    ?�드?�으�??�속?????�용?�는 주소?�니??(?? 192.168.0.10).
    
    Returns:
        str: IP 주소 문자??(?? "192.168.0.10")
    """
    try:
        # ?��? DNS???�결 ?�도?�여 ?�신??IP ?�인 (?�제 ?�킷?� ?�송?��? ?�음)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        try:
            hostname = socket.gethostname()
            return socket.gethostbyname(hostname)
        except:
            return "127.0.0.1"


def save_server_info(port: int = None):
    """
    ?�버 ?�보�?JSON ?�일�??�?�합?�다.
    ?�론?�엔?�에??모바???�속 URL ?�을 ?�시?????�용?�니??
    
    ?�???�치: web_app/server_info.json
    """
    global current_port
    if port:
        current_port = port
    
    local_ip = get_local_ip()
    info = {
        "local_ip": local_ip,
        "port": current_port,
        "mobile_url": f"http://{local_ip}:{current_port}",
        "presets": {k: v["name"] for k, v in PRESET_FILES.items()},
        "modes": MODE_LABELS
    }
    try:
        info_path = WEB_APP_DIR / "server_info.json"
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log_error(f"server_info ?�???�패: {e}")


def create_fallback_session():
    """
    ?�션 ?�성 ?�패 ???�시??기본 ?�백 ?�션???�성?�니??
    ?�용?�에�?"?�일/모드 ?�택" 버튼???�르?�고 ?�내?�니??
    """
    return {
        "title": "기본 ?�션",
        "language": "plaintext",
        "mode": 3,
        "question": "?�일/모드 ?�택 버튼???�러 ?�션???�성?�세??",
        "answer_key": {"_type": "whiteboard", "_challenges": []},
        "original_code": ""
    }


def generate_session(preset_key: str, mode: int, method: str = "local", 
                      custom_content: str = None, custom_filename: str = None) -> dict:
    """
    ?�리???�일�?모드�?받아???�습 ?�션???�성?�니??
    
    ???�수????UI??"?�션 ?�성" 버튼???�르�??�출?�니??
    ?�떤 ?�러가 발생?�도 ?�버가 죽�? ?�도�?모든 ?�외�?처리?�니??
    
    Args:
        preset_key: ?�리???�일 ??("data_structure", "math_problems", "vocabulary", "custom")
        mode: ?�습 모드 (1~5, 7)
        method: ?�성 방식 ("local" ?�는 "ai")
        custom_content: ?�용?��? ?�로?�한 ?�일 ?�용 (preset_key가 "custom"????
        custom_filename: ?�용?��? ?�로?�한 ?�일 ?�름
    
    Returns:
        dict: ?�공 ??{"success": True, ...}, ?�패 ??{"error": "메시지"}
    """
    try:
        log_error(f"?�션 ?�성 ?�작: preset={preset_key}, mode={mode}, method={method}")
        
        # 커스?� ?�일 처리
        if preset_key == "custom":
            if not custom_content:
                return {"error": "?�일 ?�용???�습?�다."}
            content = custom_content
            file_path = custom_filename or "?�용???�일"
            log_error(f"커스?� ?�일 ?�용: {file_path}, ?�용 길이: {len(content)}")
        else:
            # ?�리???�일 처리
            if preset_key not in PRESET_FILES:
                log_error(f"Unknown preset: {preset_key}")
                return {"error": f"?????�는 ?�리?? {preset_key}"}
            
            file_path = PRESET_FILES[preset_key]["path"]
            if not file_path.exists():
                log_error(f"File not found: {file_path}")
                return {"error": f"?�일??찾을 ???�습?�다: {file_path.name}"}
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception as e:
                log_error(f"?�일 ?�기 ?�패: {e}")
                return {"error": f"?�일 ?�기 ?�패: {str(e)}"}
        
        if not content.strip():
            log_error(f"Empty content")
            return {"error": "?�일??비어?�습?�다."}
        
        # 4. ?�션 빌드 (try-except�?감싸???�버 ?�래??방�?)
        try:
            log_error(f"build_local_session ?�출 �?..")
            session = build_local_session(content, mode)
            log_error(f"build_local_session ?�료: {type(session)}")
            
            log_error(f"build_session_payload ?�출 �?..")
            payload = build_session_payload(session, str(file_path))
            log_error(f"build_session_payload ?�료")
            
            # ?�성 방식 ?�시
            payload["generation_method"] = method
            if method == "ai":
                payload["title"] = f"[AI] {payload.get('title', '?�션')}"
                
        except Exception as e:
            error_msg = f"?�션 빌드 ?�류: {str(e)}\n{traceback.format_exc()}"
            log_error(error_msg)
            return {"error": f"?�션 ?�성 ?�패: {str(e)}"}
        
        # 5. ?�션 ?�??
        try:
            with open(SESSION_FILE, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            log_error(f"?�션 ?�???�료: {SESSION_FILE}")
        except Exception as e:
            log_error(f"?�션 ?�???�패: {e}")
            return {"error": f"?�션 ?�???�패: {str(e)}"}
        
        # 6. 결과 집계
        answer_key = payload.get("answer_key", {})
        challenges_count = len(answer_key.get("_challenges", []))
        blanks_count = len([k for k in answer_key.keys() if not k.startswith("_")])
        questions_count = len(answer_key.get("_questions", []))
        
        log_error(f"?�션 ?�성 ?�공: challenges={challenges_count}, blanks={blanks_count}, questions={questions_count}")
        
        return {
            "success": True, 
            "challenges": challenges_count,
            "blanks": blanks_count,
            "questions": questions_count,
            "mode": mode,
            "preset": preset_key,
            "method": method
        }
        
    except Exception as e:
        # 최종 ?�전�?- ?�떤 ?�러???�버 ?�래?�로 ?�어지지 ?�음
        error_msg = f"?�션 ?�성 ?�기�??��? ?�류: {str(e)}\n{traceback.format_exc()}"
        log_error(error_msg)
        return {"error": f"?�기�??��? ?�류: {str(e)}"}


class APIHandler(http.server.SimpleHTTPRequestHandler):
    """
    HTTP ?�청 ?�들??
    
    ???�래?�는 ?�음??처리?�니??
    - GET ?�청: ?�적 ?�일 ?�공 (HTML, CSS, JS, ?��?지 ??
    - POST /api/generate: ?�습 ?�션 ?�성
    - POST /shutdown: ?�버 종료
    - POST /api/clear-cache: 캐시 초기??
    
    모든 ?�답??no-cache ?�더�?추�??�여 브라?��? 캐시 문제�?방�??�니??
    """
    
    def __init__(self, *args, **kwargs):
        try:
            super().__init__(*args, directory=str(WEB_APP_DIR), **kwargs)
        except Exception as e:
            log_error(f"Handler 초기???�류: {e}")
    
    def end_headers(self):
        """모든 ?�답??캐시 비활?�화 ?�더 추�?"""
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    
    def log_message(self, format, *args):
        """기본 콘솔 로그 비활?�화 (콘솔 창이 ?�으므�?"""
        pass
    
    def send_json_response(self, data: dict, status: int = 200):
        """JSON ?�답???�송?�는 ?�퍼 ?�수"""
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            response_body = json.dumps(data, ensure_ascii=False)
            self.wfile.write(response_body.encode('utf-8'))
        except Exception as e:
            log_error(f"JSON ?�답 ?�송 ?�류: {e}")
    
    def do_GET(self):
        """GET ?�청 처리 - ?�적 ?�일 ?�공 �?API"""
        try:
            # API: ?�버 ?�보 조회
            if self.path == '/api/info':
                save_server_info()
                info_path = WEB_APP_DIR / "server_info.json"
                with open(info_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.send_json_response(data)
                return
            
            # /data/ 경로 ?�일 ?�공 (?�습 ?�료 ?�일)
            if self.path.startswith('/data/'):
                clean_path = self.path.split('?')[0]
                file_name = clean_path.replace('/data/', '')
                file_name = unquote(file_name)
                candidate_paths = [
                    DATA_DIR / file_name,
                    WEB_APP_DIR / 'data' / file_name,
                ]
                log_error(f"[DEBUG] /data/ ?�청: {self.path}")
                for candidate in candidate_paths:
                    log_error(f"[DEBUG] ?�보 경로: {candidate} (exists={candidate.exists()})")
                file_path = next((p for p in candidate_paths if p.exists() and p.is_file()), None)
                if file_path:
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/plain; charset=utf-8')
                    self.end_headers()
                    with open(file_path, 'r', encoding='utf-8') as f:
                        self.wfile.write(f.read().encode('utf-8'))
                else:
                    folder_snapshot = []
                    for folder in candidate_paths:
                        parent = folder.parent
                        if parent.exists():
                            folder_snapshot.append(f"{parent}: {list(parent.iterdir())}")
                        else:
                            folder_snapshot.append(f"{parent}: DIR NOT EXISTS")
                    log_error(f"[DEBUG] ?�일 ?�음! ?�냅?? {folder_snapshot}")
                    self.send_error(404, f"File not found: {file_name}")
                return
            
            # ?�적 ?�일 ?�공 (index.html, app.js, style.css ??
            super().do_GET()
        except Exception as e:
            log_error(f"GET 처리 ?�류: {self.path} - {e}")
            self.send_error(500, str(e))
    
    
    def do_POST(self):
        try:
            if self.path == '/api/generate':
                try:
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
                    result = generate_session(preset, mode, method, custom_content, custom_filename)
                    self.send_json_response(result)
                except Exception as e:
                    log_error(f"API generate error: {e}")
                    self.send_json_response({"error": str(e)}, 500)
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
                try:
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
                except Exception as e:
                    self.send_json_response({"error": str(e)}, 500)
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


def start_server(port):
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
            except:
                pass
        threading.Thread(target=open_browser, daemon=True).start()
    log_error("Server running...")
    start_server(port)


if __name__ == "__main__":
    main()
