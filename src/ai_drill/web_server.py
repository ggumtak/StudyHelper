"""
================================================================================
Study Helper - 통합 웹 서버
================================================================================

## 프로젝트 개요
이 파일은 Study Helper의 핵심 백엔드 서버입니다.
콘솔 창이나 런처 GUI 없이, 웹 UI만으로 모든 기능을 제어합니다.

## 실행 방식
1. 원클릭_실행.bat를 더블클릭하면 이 서버가 백그라운드에서 실행됩니다.
2. 브라우저가 자동으로 열리고, 웹 UI에서 파일/모드 선택, 세션 생성, 학습 진행이 가능합니다.
3. 콘솔 창은 의도적으로 숨김 처리되어 있습니다 (start /min 명령 사용).

## 주요 기능
- /api/generate: 프리셋 파일로 학습 세션 생성 (로컬 또는 AI)
- /api/info: 서버 정보 조회 (포트, 모바일 URL 등)
- 정적 파일 서빙: web_app 폴더의 HTML/CSS/JS 파일 제공

## 중요 안내
- 이 서버는 콘솔 창 없이 실행되므로 에러는 server_error.log에 기록됩니다.
- 서버 종료는 작업 관리자에서 python 프로세스를 종료하거나, 
  브라우저에서 /shutdown 엔드포인트를 호출하면 됩니다.

## 코드 인수인계 담당자 참고
- 사용자가 웹 UI에서 파일/모드를 선택하면 /api/generate로 POST 요청이 옵니다.
- 세션은 web_app/session.json에 저장되고, 프론트엔드가 이를 로드합니다.
- 에러 발생 시 server_error.log를 확인하세요.

작성일: 2024-12
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
# Windows 콘솔 UTF-8 인코딩 설정
# Windows에서 한글 출력 시 깨짐 방지
# ============================================================================
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass

# ============================================================================
# 경로 설정 (새 폴더 구조 + 이전 구조 호환)
# src/ai_drill/web_server.py 또는 ai_drill/web_server.py 모두 지원
# ============================================================================
SCRIPT_DIR = Path(__file__).parent             # ai_drill 폴더

# 프로젝트 루트 찾기: src/ai_drill 또는 ai_drill 형태 모두 지원
if SCRIPT_DIR.parent.name == "src":
    PROJECT_DIR = SCRIPT_DIR.parent.parent     # src의 상위 = 프로젝트 루트
    WEB_APP_DIR = SCRIPT_DIR.parent / "web_app"  # src/web_app
else:
    PROJECT_DIR = SCRIPT_DIR.parent            # 이전 구조: ai_drill의 상위
    WEB_APP_DIR = PROJECT_DIR / "web_app"      # web_app

DATA_DIR = PROJECT_DIR / "data"                # 학습 자료 폴더
CONFIG_DIR = PROJECT_DIR / "config"            # 설정/토큰 폴더
LOG_DIR = PROJECT_DIR / "logs"                 # 로그 폴더
SESSION_FILE = WEB_APP_DIR / "session.json"    # 현재 학습 세션 저장 위치
LOG_FILE = LOG_DIR / "server_error.log"        # 에러 로그 파일
API_KEY_FILE = CONFIG_DIR / "gemini_api_key.txt"  # Gemini API 키 파일
BASE_PORT = 8000                               # 기본 포트 (8000~8009 시도)
MAX_PORT_RETRIES = 10                          # 포트 충돌 시 최대 재시도 횟수

# 필수 폴더 생성
for folder in (DATA_DIR, CONFIG_DIR, LOG_DIR):
    folder.mkdir(parents=True, exist_ok=True)

# 현재 사용 중인 포트 (동적 할당됨)
current_port = BASE_PORT

# ============================================================================
# 모듈 Import
# ai_drill 패키지에서 세션 생성 관련 함수들을 불러옵니다.
# ============================================================================
# 새 구조: src/ai_drill, src/web_app → src를 path에 추가
# 이전 구조: ai_drill, web_app → 프로젝트 루트를 path에 추가
if SCRIPT_DIR.parent.name == "src":
    sys.path.insert(0, str(SCRIPT_DIR.parent))  # src 폴더
else:
    sys.path.insert(0, str(PROJECT_DIR))        # 프로젝트 루트

try:
    from ai_drill.local_generator import build_local_session
    from ai_drill.main import build_session_payload
except ImportError as e:
    # 이 에러는 치명적이므로 로그에 기록하고 종료
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[FATAL] 모듈 import 실패: {e}\n")
    sys.exit(1)

# ============================================================================
# 프리셋 파일 목록
# 웹 UI의 "파일 선택" 버튼에서 선택할 수 있는 파일들입니다.
# 새 파일을 추가하려면 여기에 항목을 추가하세요.
# ============================================================================
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

# ============================================================================
# 학습 모드 레이블
# 각 모드 번호에 대응하는 한글 이름입니다.
# ============================================================================
MODE_LABELS = {
    1: "OOP 영단어",
    2: "OOP 개념어",
    3: "백지 연습 (코드)",
    4: "자료구조 코드",
    5: "전산수학 필기",
    6: "전산수학 실기",
    7: "커스텀/추가"
}


def log_error(message: str):
    """
    에러/디버그 메시지를 로그 파일에 기록합니다.
    
    주의: 이 서버는 콘솔 창이 없으므로 print() 대신 이 함수를 사용하세요.
    로그 파일 위치: 프로젝트 루트/logs/server_error.log
    
    Args:
        message: 기록할 메시지 (한글 가능)
    """
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")
            f.flush()  # 즉시 파일에 기록
    except:
        pass  # 로그 실패는 무시 (무한 에러 방지)


def get_local_ip():
    """
    이 PC의 로컬 IP 주소를 가져옵니다.
    핸드폰으로 접속할 때 사용하는 주소입니다 (예: 192.168.0.10).
    
    Returns:
        str: IP 주소 문자열 (예: "192.168.0.10")
    """
    try:
        # 외부 DNS에 연결 시도하여 자신의 IP 확인 (실제 패킷은 전송되지 않음)
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
    서버 정보를 JSON 파일로 저장합니다.
    프론트엔드에서 모바일 접속 URL 등을 표시할 때 사용합니다.
    
    저장 위치: web_app/server_info.json
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
        log_error(f"server_info 저장 실패: {e}")


def create_fallback_session():
    """
    세션 생성 실패 시 표시할 기본 폴백 세션을 생성합니다.
    사용자에게 "파일/모드 선택" 버튼을 누르라고 안내합니다.
    """
    return {
        "title": "기본 세션",
        "language": "plaintext",
        "mode": 3,
        "question": "파일/모드 선택 버튼을 눌러 세션을 생성하세요.",
        "answer_key": {"_type": "whiteboard", "_challenges": []},
        "original_code": ""
    }


def generate_session(preset_key: str, mode: int, method: str = "local", 
                      custom_content: str = None, custom_filename: str = None) -> dict:
    """
    프리셋 파일과 모드를 받아서 학습 세션을 생성합니다.
    
    이 함수는 웹 UI의 "세션 생성" 버튼을 누르면 호출됩니다.
    어떤 에러가 발생해도 서버가 죽지 않도록 모든 예외를 처리합니다.
    
    Args:
        preset_key: 프리셋 파일 키 ("data_structure", "math_problems", "vocabulary", "custom")
        mode: 학습 모드 (1~5, 7)
        method: 생성 방식 ("local" 또는 "ai")
        custom_content: 사용자가 업로드한 파일 내용 (preset_key가 "custom"일 때)
        custom_filename: 사용자가 업로드한 파일 이름
    
    Returns:
        dict: 성공 시 {"success": True, ...}, 실패 시 {"error": "메시지"}
    """
    try:
        log_error(f"세션 생성 시작: preset={preset_key}, mode={mode}, method={method}")
        
        # 커스텀 파일 처리
        if preset_key == "custom":
            if not custom_content:
                return {"error": "파일 내용이 없습니다."}
            content = custom_content
            file_path = custom_filename or "사용자 파일"
            log_error(f"커스텀 파일 사용: {file_path}, 내용 길이: {len(content)}")
        else:
            # 프리셋 파일 처리
            if preset_key not in PRESET_FILES:
                log_error(f"Unknown preset: {preset_key}")
                return {"error": f"알 수 없는 프리셋: {preset_key}"}
            
            file_path = PRESET_FILES[preset_key]["path"]
            if not file_path.exists():
                log_error(f"File not found: {file_path}")
                return {"error": f"파일을 찾을 수 없습니다: {file_path.name}"}
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception as e:
                log_error(f"파일 읽기 실패: {e}")
                return {"error": f"파일 읽기 실패: {str(e)}"}
        
        if not content.strip():
            log_error(f"Empty content")
            return {"error": "파일이 비어있습니다."}
        
        # 4. 세션 빌드 (try-except로 감싸서 서버 크래시 방지)
        try:
            log_error(f"build_local_session 호출 중...")
            session = build_local_session(content, mode)
            log_error(f"build_local_session 완료: {type(session)}")
            
            log_error(f"build_session_payload 호출 중...")
            payload = build_session_payload(session, str(file_path))
            log_error(f"build_session_payload 완료")
            
            # 생성 방식 표시
            payload["generation_method"] = method
            if method == "ai":
                payload["title"] = f"[AI] {payload.get('title', '세션')}"
                
        except Exception as e:
            error_msg = f"세션 빌드 오류: {str(e)}\n{traceback.format_exc()}"
            log_error(error_msg)
            return {"error": f"세션 생성 실패: {str(e)}"}
        
        # 5. 세션 저장
        try:
            with open(SESSION_FILE, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            log_error(f"세션 저장 완료: {SESSION_FILE}")
        except Exception as e:
            log_error(f"세션 저장 실패: {e}")
            return {"error": f"세션 저장 실패: {str(e)}"}
        
        # 6. 결과 집계
        answer_key = payload.get("answer_key", {})
        challenges_count = len(answer_key.get("_challenges", []))
        blanks_count = len([k for k in answer_key.keys() if not k.startswith("_")])
        questions_count = len(answer_key.get("_questions", []))
        
        log_error(f"세션 생성 성공: challenges={challenges_count}, blanks={blanks_count}, questions={questions_count}")
        
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
        # 최종 안전망 - 어떤 에러도 서버 크래시로 이어지지 않음
        error_msg = f"세션 생성 예기치 않은 오류: {str(e)}\n{traceback.format_exc()}"
        log_error(error_msg)
        return {"error": f"예기치 않은 오류: {str(e)}"}


class APIHandler(http.server.SimpleHTTPRequestHandler):
    """
    HTTP 요청 핸들러
    
    이 클래스는 다음을 처리합니다:
    - GET 요청: 정적 파일 제공 (HTML, CSS, JS, 이미지 등)
    - POST /api/generate: 학습 세션 생성
    - POST /shutdown: 서버 종료
    - POST /api/clear-cache: 캐시 초기화
    
    모든 응답에 no-cache 헤더를 추가하여 브라우저 캐시 문제를 방지합니다.
    """
    
    def __init__(self, *args, **kwargs):
        try:
            super().__init__(*args, directory=str(WEB_APP_DIR), **kwargs)
        except Exception as e:
            log_error(f"Handler 초기화 오류: {e}")
    
    def end_headers(self):
        """모든 응답에 캐시 비활성화 헤더 추가"""
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    
    def log_message(self, format, *args):
        """기본 콘솔 로그 비활성화 (콘솔 창이 없으므로)"""
        pass
    
    def send_json_response(self, data: dict, status: int = 200):
        """JSON 응답을 전송하는 헬퍼 함수"""
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            response_body = json.dumps(data, ensure_ascii=False)
            self.wfile.write(response_body.encode('utf-8'))
        except Exception as e:
            log_error(f"JSON 응답 전송 오류: {e}")
    
    def do_GET(self):
        """GET 요청 처리 - 정적 파일 제공 및 API"""
        try:
            # API: 서버 정보 조회
            if self.path == '/api/info':
                save_server_info()
                info_path = WEB_APP_DIR / "server_info.json"
                with open(info_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.send_json_response(data)
                return
            
            # /data/ 경로 파일 제공 (학습 자료 파일)
            if self.path.startswith('/data/'):
                clean_path = self.path.split('?')[0]
                file_name = clean_path.replace('/data/', '')
                file_name = unquote(file_name)
                candidate_paths = [
                    DATA_DIR / file_name,
                    WEB_APP_DIR / 'data' / file_name,
                ]
                log_error(f"[DEBUG] /data/ 요청: {self.path}")
                for candidate in candidate_paths:
                    log_error(f"[DEBUG] 후보 경로: {candidate} (exists={candidate.exists()})")
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
                    log_error(f"[DEBUG] 파일 없음! 스냅샷: {folder_snapshot}")
                    self.send_error(404, f"File not found: {file_name}")
            return
