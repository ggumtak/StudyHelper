# ai_drill/main.py
import argparse
import json
import os
import re
import sys
import threading
import time
import webbrowser
import http.server
import socketserver
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog
from rich.console import Console

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_APP_DIR = PROJECT_ROOT / "web_app"
SESSION_FILE = WEB_APP_DIR / "session.json"
API_KEY_FILE = PROJECT_ROOT / "gemini_api_key.txt"
PORT = 8000

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ai_drill.llm_client import LLMClient
from ai_drill.local_generator import build_local_session
from ai_drill.quiz_parser import parse_response

console = Console()

def detect_language_from_path(path: str) -> str:
    """Infer language from file extension for UI display."""
    ext = os.path.splitext(path)[1].lower()
    mapping = {
        ".py": "python",
        ".js": "javascript",
        ".ts": "typescript",
        ".java": "java",
        ".c": "c",
        ".cpp": "cpp",
        ".txt": "text",
        ".md": "markdown",
    }
    return mapping.get(ext, "text")

def strip_code_block(text: str) -> str:
    """
    Remove markdown fences and return the first code block if present.
    Also trims stray ```json blocks from LLM responses.
    """
    if not text:
        return ""
    code_match = re.search(r"```(?:\w+)?\s*([\s\S]*?)```", text)
    if code_match:
        return code_match.group(1).strip()
    return text.strip()


def load_api_key_from_file() -> str | None:
    """
    Optional helper to read a locally stored Gemini key so we do not hard-code
    secrets in scripts. Returns None if no file/key is present.
    """
    try:
        if API_KEY_FILE.exists():
            key = API_KEY_FILE.read_text(encoding="utf-8").strip()
            return key or None
    except OSError as exc:
        console.print(f"[yellow]Warning: failed to read API key file: {exc}[/yellow]")
    return None

def normalize_answer_key(answer_key) -> dict:
    """
    Flatten various answer_key shapes that the LLM/local generator may emit.
    Accepts {"answer_key": {...}} or {"1": "..."} etc.
    Preserves special keys starting with _ (like _type, _questions, _blanks)
    """
    if not isinstance(answer_key, dict):
        return {}
    if "answer_key" in answer_key and isinstance(answer_key["answer_key"], dict):
        answer_key = answer_key["answer_key"]
    result = {}
    for k, v in answer_key.items():
        # 특수 키 (_로 시작하는 키)는 그대로 유지
        if str(k).startswith("_"):
            result[k] = v
        else:
            result[str(k)] = v
    return result

def build_session_payload(session, input_file: str) -> dict:
    """Standardize the payload consumed by the web UI."""
    question_clean = strip_code_block(session.question_text)
    answer_clean = strip_code_block(session.answer_text)
    answer_key = normalize_answer_key(session.answer_key)
    return {
        "title": os.path.basename(input_file),
        "mode": session.mode,
        "language": detect_language_from_path(input_file),
        "question": question_clean,
        "question_text": session.question_text,
        "answer": answer_clean,
        "answer_text": session.answer_text,
        "answer_key": answer_key,
        "answer_count": len(answer_key),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

def start_server():
    """Starts a simple HTTP server serving the web_app directory with NO CACHE."""
    
    # 캐시를 완전히 비활성화하는 커스텀 핸들러
    class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=WEB_APP_DIR, **kwargs)
        
        def end_headers(self):
            # 모든 응답에 no-cache 헤더 추가
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            super().end_headers()

        def do_POST(self):
            if self.path == '/shutdown':
                print("Shutting down server via web request...")
                self.send_response(200)
                self.end_headers()
                # 별도 스레드에서 종료 (응답을 보낸 후 종료하기 위해)
                threading.Thread(target=lambda: os._exit(0)).start()
            else:
                # SimpleHTTPRequestHandler는 기본적으로 do_POST가 없으므로 405 반환하거나 무시
                self.send_error(405, "Method Not Allowed")

    socketserver.ThreadingTCPServer.allow_reuse_address = True
    try:
        # 0.0.0.0으로 바인딩하여 네트워크의 다른 기기에서도 접속 가능
        with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
            # 로컬 IP 주소 가져오기
            import socket
            hostname = socket.gethostname()
            try:
                local_ip = socket.gethostbyname(hostname)
            except:
                local_ip = "알 수 없음"
            
            print(f"\n{'='*50}")
            print(f"웹 서버 시작!")
            print(f"{'='*50}")
            print(f"PC에서 접속: http://localhost:{PORT}")
            print(f"📱 핸드폰에서 접속: http://{local_ip}:{PORT}")
            print(f"{'='*50}")
            print(f"(같은 WiFi 네트워크에 연결되어 있어야 합니다)\n")
            httpd.serve_forever()
    except OSError:
        print(f"Port {PORT} is already in use. Assuming server is running.")

def launcher():
    """
    GUI to select file and mode, then generate JSON and launch Web UI.
    """
    root = tk.Tk()
    root.title("AI 트레이닝 센터")
    root.geometry("420x420")
    root.configure(bg="#ffffff")
    root.resizable(False, False)
    
    # Styling
    font_title = ("Malgun Gothic", 14, "bold")
    font_desc = ("Malgun Gothic", 9)
    font_btn = ("Malgun Gothic", 10, "bold")
    
    def on_mode_select(mode):
        # Mode 5: OOP 정의 퀴즈는 내장 파일 사용 (파일 선택 필요 없음)
        if mode == 5:
            default_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "default_definitions.txt")
            if os.path.exists(default_file):
                root.destroy()
                run_generation_and_launch(default_file, mode, offline=True)
                return
        
        # 다른 모드는 파일 선택
        filename = filedialog.askopenfilename(
            title=f"모드 {mode} 학습 파일 선택",
            filetypes=[("코드/텍스트 파일", "*.txt;*.py;*.c;*.cpp;*.java;*.js"), ("모든 파일", "*.*")]
        )
        if filename:
            root.destroy()
            run_generation_and_launch(filename, mode, offline=offline_var.get())

    # UI Elements
    tk.Label(root, text="AI 트레이닝 센터", font=font_title, bg="white", fg="#333").pack(pady=(20, 3))
    tk.Label(root, text="모드를 선택하세요", font=font_desc, bg="white", fg="#666").pack(pady=(0, 8))

    offline_var = tk.BooleanVar(value=False)
    tk.Checkbutton(
        root, text="로컬 생성 모드", variable=offline_var,
        bg="white", fg="#444", selectcolor="#f1f5f9", activebackground="white",
        font=("Malgun Gothic", 9)
    ).pack(pady=(0, 8))
    
    btn_frame = tk.Frame(root, bg="white")
    btn_frame.pack(fill="both", expand=True, padx=20)
    
    # 2열 그리드 레이아웃, 짧은 이름
    modes = [
        (1, "1. OOP 빈칸", "#E3F2FD", "#1565C0"),
        (2, "2. 자료구조", "#FFEBEE", "#C62828"),
        (3, "3. 백지복습", "#FFF3E0", "#EF6C00"),
        (4, "4. 모의고사", "#E8F5E9", "#2E7D32"),
        (5, "5. 정의퀴즈 ⭐", "#F3E5F5", "#7B1FA2"),
        (7, "7. 영단어", "#E0F7FA", "#00838F")
    ]
    
    for i, (m_id, m_text, bg_color, fg_color) in enumerate(modes):
        row, col = divmod(i, 2)
        btn = tk.Button(btn_frame, text=m_text, font=font_btn, bg=bg_color, fg=fg_color,
                        relief="flat", activebackground=fg_color, activeforeground="white",
                        command=lambda m=m_id: on_mode_select(m), cursor="hand2")
        btn.grid(row=row, column=col, padx=5, pady=5, sticky="nsew", ipady=12)
    
    # 열 균등 분배
    btn_frame.columnconfigure(0, weight=1)
    btn_frame.columnconfigure(1, weight=1)
    
    # 핸드폰 접속 주소 표시
    import socket
    try:
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        mobile_url = f"http://{local_ip}:{PORT}"
    except:
        mobile_url = "IP 확인 불가"
    
    mobile_frame = tk.Frame(root, bg="#f0f4f8")
    mobile_frame.pack(fill="x", padx=20, pady=(10, 0))
    
    tk.Label(mobile_frame, text="📱 핸드폰 접속:", font=("Malgun Gothic", 9, "bold"), 
             bg="#f0f4f8", fg="#333").pack(side="left", padx=(10, 5))
    
    url_label = tk.Label(mobile_frame, text=mobile_url, font=("Consolas", 10), 
                         bg="#f0f4f8", fg="#1565C0", cursor="hand2")
    url_label.pack(side="left")
    
    # 클릭하면 클립보드에 복사
    def copy_url(event=None):
        root.clipboard_clear()
        root.clipboard_append(mobile_url)
        url_label.config(text=mobile_url + " ✓복사됨!")
        root.after(1500, lambda: url_label.config(text=mobile_url))
    
    url_label.bind("<Button-1>", copy_url)
    
    tk.Label(mobile_frame, text="(클릭하면 복사)", font=("Malgun Gothic", 8), 
             bg="#f0f4f8", fg="#999").pack(side="left", padx=(5, 10))
        
    tk.Label(root, text="Powered by Gemini", font=("Arial", 8), bg="white", fg="#bbb").pack(side="bottom", pady=8)
    
    root.mainloop()





def run_generation_and_launch(input_file, mode, offline: bool = False):
    """
    Generates the drill content, saves to session.json, and opens the browser.
    """
    input_path = Path(input_file)
    if not input_path.exists():
        messagebox.showerror("Error", "File not found.")
        return

    content = input_path.read_text(encoding="utf-8")

    client = None
    api_key = None
    if not offline:
        api_key = os.getenv("GEMINI_API_KEY") or load_api_key_from_file()
        if not api_key:
            root = tk.Tk()
            root.withdraw()
            api_key = simpledialog.askstring("API Key Required", "Enter Google Gemini API Key")
            if not api_key:
                return
        os.environ["GEMINI_API_KEY"] = api_key

        try:
            client = LLMClient(api_key=api_key)
        except (ValueError, RuntimeError) as e:
            messagebox.showerror("Error", str(e))
            return

    print("Generating drill content... Please wait.")

    splash = tk.Tk()
    splash.title("Generating...")
    splash.geometry("300x100")
    if offline:
        loading_text = "Building questions locally... (no AI)"
    else:
        loading_text = "Generating questions with AI... Please wait."
    tk.Label(splash, text=loading_text, font=("Malgun Gothic", 10)).pack(expand=True)
    splash.update()

    session = None
    llm_error = None

    # Mode 3 (whiteboard) always uses local generation
    if mode == 3:
        offline = True

    if offline:
        session = build_local_session(content, mode)
    else:
        try:
            response_text = client.generate_drill(content, mode)
            session = parse_response(response_text, mode)
        except Exception as e:
            llm_error = e
            console.print(f"[red]LLM generation failed: {e}[/red]\nFalling back to local generator.")
            session = build_local_session(content, mode)

    if session is None:
        splash.destroy()
        messagebox.showerror("Error", "Failed to create session. Check the file and mode.")
        return

    session_data = build_session_payload(session, str(input_path))
    if llm_error:
        session_data["generator"] = "local_fallback"
        session_data["llm_error"] = str(llm_error)

    WEB_APP_DIR.mkdir(parents=True, exist_ok=True)
    with SESSION_FILE.open("w", encoding="utf-8") as f:
        json.dump(session_data, f, ensure_ascii=False, indent=2)

    splash.destroy()

    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    print(f"Opening browser at http://localhost:{PORT}")
    webbrowser.open(f"http://localhost:{PORT}")

    control_root = tk.Tk()
    control_root.title("AI Server Running")
    control_root.geometry("300x150")
    control_root.configure(bg="white")

    tk.Label(control_root, text="Server is running.", font=("Malgun Gothic", 12, "bold"), bg="white", fg="green").pack(pady=(20, 10))
    tk.Label(control_root, text=f"http://localhost:{PORT}", font=("Malgun Gothic", 10), bg="white").pack(pady=(0, 20))

    def on_close():
        print("Stopping server...")
        control_root.destroy()
        os._exit(0)  # Force exit to kill threads

    tk.Button(control_root, text="Stop Server", command=on_close, bg="#ffcdd2", fg="#c62828", font=("Malgun Gothic", 10)).pack(ipadx=20, ipady=5)

    control_root.protocol("WM_DELETE_WINDOW", on_close)
    control_root.mainloop()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AI Drill Generator")
    parser.add_argument("--file", "-f", dest="input_file", help="입력 파일 경로")
    parser.add_argument("--mode", "-m", type=int, choices=[1, 2, 3, 4, 5, 7], help="학습 모드 (1~5, 7)")
    parser.add_argument("--offline", action="store_true", help="LLM 없이 로컬 제너레이터 사용")
    args, unknown = parser.parse_known_args()

    if args.input_file and args.mode:
        run_generation_and_launch(args.input_file, args.mode, offline=args.offline)
    else:
        launcher()
