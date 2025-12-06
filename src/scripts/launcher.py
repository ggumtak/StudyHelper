"""
Study Helper - GUI Launcher
단일 실행 파일로 모든 것을 처리합니다.
- GitHub 자동 업데이트 (git pull)
- Python 자동 설치
- 의존성 설치
- 서버 시작
- 브라우저 자동 열기
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
import tkinter as tk
from tkinter import messagebox

# GitHub repository info
GITHUB_REPO = "ggumtak/StudyHelper"
GITHUB_RAW_URL = f"https://raw.githubusercontent.com/{GITHUB_REPO}/main"


def check_and_update_from_github(project_root: Path, splash=None) -> bool:
    """
    GitHub에서 최신 버전을 확인하고 업데이트합니다.
    git이 설치되어 있으면 git pull을 실행합니다.
    Returns True if update was successful or not needed.
    """
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    
    # Check if git is available
    try:
        subprocess.run(
            ["git", "--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            creationflags=creationflags,
        )
    except Exception:
        # Git not installed, skip update check
        if splash:
            splash.set_sub("Git 없음 - 업데이트 스킵")
        return True
    
    # Check if this is a git repository
    git_dir = project_root / ".git"
    if not git_dir.exists():
        if splash:
            splash.set_sub("Git 저장소 아님 - 스킵")
        return True
    
    if splash:
        splash.set_status("🔄 업데이트 확인 중...")
        splash.set_sub("GitHub에서 최신 버전 확인")
    
    try:
        # Fetch latest changes
        result = subprocess.run(
            ["git", "fetch", "--quiet"],
            cwd=project_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=creationflags,
            timeout=30,  # 30 second timeout
        )
        
        # Check if there are updates
        result = subprocess.run(
            ["git", "status", "-uno"],
            cwd=project_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=creationflags,
            text=True,
        )
        
        output = result.stdout.lower()
        if "behind" in output or "뒤처" in output:
            # There are updates available
            if splash:
                splash.set_status("⬇️ 업데이트 다운로드 중...")
                splash.set_sub("최신 파일 가져오는 중...")
            
            # Pull latest changes
            pull_result = subprocess.run(
                ["git", "pull", "--ff-only"],
                cwd=project_root,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=creationflags,
                text=True,
                timeout=60,  # 60 second timeout for pull
            )
            
            if pull_result.returncode == 0:
                if splash:
                    splash.set_status("✅ 업데이트 완료!")
                    splash.set_sub("최신 버전으로 업데이트됨")
                time.sleep(1)
                return True
            else:
                # Pull failed (maybe local changes conflict)
                if splash:
                    splash.set_sub("업데이트 실패 - 로컬 변경사항 충돌 가능")
                return True  # Continue anyway
        else:
            # Already up to date
            if splash:
                splash.set_sub("✓ 이미 최신 버전")
            return True
            
    except subprocess.TimeoutExpired:
        if splash:
            splash.set_sub("네트워크 타임아웃 - 오프라인 모드")
        return True
    except Exception as e:
        if splash:
            splash.set_sub(f"업데이트 확인 실패: {str(e)[:30]}")
        return True  # Continue anyway


def resolve_base_dir() -> Path:
    if getattr(sys, "frozen", False):  # PyInstaller executable
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def find_project_root(base_dir: Path) -> Path | None:
    # 새 구조: src/ai_drill/web_server.py
    for cand in (base_dir, base_dir.parent):
        if (cand / "src" / "ai_drill" / "web_server.py").exists():
            return cand
        # 이전 구조 호환
        if (cand / "ai_drill" / "web_server.py").exists():
            return cand
    return None


def find_python_cmd() -> str | None:
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    for cmd in ("py -3.11", "py -3", "python"):
        try:
            subprocess.run(
                cmd.split() + ["--version"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
                creationflags=creationflags,
            )
            return cmd
        except Exception:
            continue
    return None


def run_python_installer(installer_path: Path) -> bool:
    if not installer_path.exists():
        return False
    try:
        # Silent-ish install; may require admin. If blocked, user should run manually.
        subprocess.run(
            [
                str(installer_path),
                "/quiet",
                "InstallAllUsers=0",
                "PrependPath=1",
                "Include_test=0",
            ],
            check=True,
        )
        return True
    except Exception:
        return False


def load_ngrok_token(project_root: Path, env: dict[str, str]) -> str | None:
    if env.get("NGROK_AUTHTOKEN"):
        return env["NGROK_AUTHTOKEN"]
    token_file = project_root / "config" / "ngrok_token.txt"
    if token_file.exists():
        try:
            token = token_file.read_text(encoding="utf-8").strip()
            if token:
                env["NGROK_AUTHTOKEN"] = token
                return token
        except Exception:
            return None
    return None


def start_ngrok(project_root: Path, env: dict[str, str], token: str | None):
    ngrok_path = project_root / "ngrok.exe"
    if not ngrok_path.exists():
        return None

    cmd = [str(ngrok_path), "http", "8000", "--log=stdout"]
    if token:
        cmd += ["--authtoken", token]

    try:
        logs_dir = project_root / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        log_file = open(logs_dir / "ngrok.log", "w", encoding="utf-8", errors="replace")
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        proc = subprocess.Popen(
            cmd,
            cwd=project_root,
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            creationflags=creationflags,
        )
        return proc
    except Exception:
        return None


def show_api_key_dialog(config_dir: Path) -> str | None:
    """
    첫 실행 시 API 키 입력 다이얼로그를 표시합니다.
    """
    result = {"key": None}
    
    dialog = tk.Toplevel()
    dialog.title("Gemini API 키 설정")
    dialog.geometry("450x200")
    dialog.resizable(False, False)
    dialog.configure(bg="#0f1115")
    dialog.attributes("-topmost", True)
    
    # Center the dialog
    dialog.update_idletasks()
    x = (dialog.winfo_screenwidth() - 450) // 2
    y = (dialog.winfo_screenheight() - 200) // 2
    dialog.geometry(f"450x200+{x}+{y}")
    
    tk.Label(
        dialog, text="🔑 Gemini API 키를 입력하세요",
        font=("Segoe UI Semibold", 12), fg="#a5f3fc", bg="#0f1115"
    ).pack(pady=(20, 5))
    
    tk.Label(
        dialog, text="AI 기능을 사용하려면 API 키가 필요합니다.\n스킵하면 로컬 모드로 실행됩니다.",
        font=("Segoe UI", 9), fg="#8aa0b9", bg="#0f1115"
    ).pack(pady=(0, 10))
    
    entry = tk.Entry(dialog, width=50, font=("Consolas", 10), show="*")
    entry.pack(pady=5)
    entry.focus_set()
    
    btn_frame = tk.Frame(dialog, bg="#0f1115")
    btn_frame.pack(pady=15)
    
    def on_save():
        key = entry.get().strip()
        if key:
            try:
                key_file = config_dir / "gemini_api_key.txt"
                key_file.write_text(key, encoding="utf-8")
                result["key"] = key
            except Exception:
                pass
        dialog.destroy()
    
    def on_skip():
        dialog.destroy()
    
    tk.Button(
        btn_frame, text="저장", command=on_save,
        font=("Segoe UI", 10), bg="#22c55e", fg="white",
        width=10, cursor="hand2"
    ).pack(side="left", padx=10)
    
    tk.Button(
        btn_frame, text="스킵 (로컬모드)", command=on_skip,
        font=("Segoe UI", 10), bg="#64748b", fg="white",
        width=12, cursor="hand2"
    ).pack(side="left", padx=10)
    
    entry.bind("<Return>", lambda e: on_save())
    dialog.bind("<Escape>", lambda e: on_skip())
    
    dialog.grab_set()
    dialog.wait_window()
    
    return result["key"]


class Splash:
    def __init__(self, project_root: Path, title: str = "Study Helper"):
        self.root = tk.Tk()
        self.root.title(title)
        self.root.geometry("420x260")
        self.root.resizable(False, False)
        self.root.attributes("-topmost", True)
        self.root.configure(bg="#0f1115")

        splash_img = None
        img_path = project_root / "config" / "loading.png"
        if img_path.exists():
            try:
                splash_img = tk.PhotoImage(file=str(img_path))
            except Exception:
                splash_img = None

        if splash_img:
            self.img_label = tk.Label(self.root, image=splash_img, bg="#0f1115")
            self.img_label.image = splash_img  # prevent GC
            self.img_label.pack(pady=(20, 10))
        else:
            self.img_label = tk.Label(
                self.root,
                text="📚 Study Helper",
                font=("Segoe UI Semibold", 18),
                fg="#a5f3fc",
                bg="#0f1115",
            )
            self.img_label.pack(pady=(30, 10))

        self.label = tk.Label(self.root, text="시작 준비 중...", font=("Segoe UI", 11), fg="#cdd5e0", bg="#0f1115")
        self.label.pack(expand=False, padx=20, pady=(5, 4))
        self.status = tk.Label(self.root, text="", font=("Segoe UI", 9), fg="#8aa0b9", bg="#0f1115")
        self.status.pack(pady=(0, 12))
        self.root.update_idletasks()

    def set_status(self, text: str):
        self.label.config(text=text)
        self.root.update_idletasks()

    def set_sub(self, text: str):
        self.status.config(text=text)
        self.root.update_idletasks()

    def close(self):
        try:
            self.root.destroy()
        except Exception:
            pass


def main() -> int:
    exe_dir = resolve_base_dir()
    project_root = find_project_root(exe_dir)
    if not project_root:
        messagebox.showerror("오류", "프로젝트 파일을 찾을 수 없습니다.\nStudyHelper.exe를 프로젝트 폴더에서 실행하세요.")
        return 1

    splash = Splash(project_root)
    splash.set_status("시작 중...")
    
    # GitHub에서 최신 버전 확인 및 업데이트
    check_and_update_from_github(project_root, splash)
    
    splash.set_status("환경 점검 중...")

    python_cmd = find_python_cmd()
    if not python_cmd:
        splash.set_status("Python 설치 필요")
        installer = project_root / "installers" / "python-3.11.9-amd64.exe"
        splash.set_sub("Python 설치 시도 중...")
        ran = run_python_installer(installer)
        if ran:
            splash.set_status("Python 재확인 중...")
            python_cmd = find_python_cmd()
    if not python_cmd:
        splash.set_status("Python을 찾을 수 없습니다.")
        splash.set_sub("installers/python-3.11.9-amd64.exe를 수동 설치 후 다시 실행하세요.")
        time.sleep(3)
        splash.close()
        return 1

    # Prepare env and paths
    env = dict(os.environ)
    env["SKIP_AUTO_BROWSER_OPEN"] = "1"
    config_dir = project_root / "config"
    logs_dir = project_root / "logs"
    for folder in (config_dir, logs_dir):
        folder.mkdir(parents=True, exist_ok=True)

    # Load tokens
    key_file = config_dir / "gemini_api_key.txt"
    
    # 첫 실행 시 API 키가 없으면 다이얼로그 표시
    if not key_file.exists() or not key_file.read_text(encoding="utf-8").strip():
        splash.close()  # 스플래시 닫고 다이얼로그 표시
        
        api_dialog = tk.Tk()
        api_dialog.title("📚 Study Helper - API 키 설정")
        api_dialog.geometry("450x220")
        api_dialog.resizable(False, False)
        api_dialog.configure(bg="#0f1115")
        api_dialog.attributes("-topmost", True)
        
        # 제목
        tk.Label(api_dialog, text="🔑 Gemini API 키를 입력하세요", 
                 font=("Segoe UI Semibold", 14), fg="#a5f3fc", bg="#0f1115").pack(pady=(20, 5))
        
        tk.Label(api_dialog, text="AI 기능을 사용하려면 API 키가 필요합니다.\n없으면 스킵하여 로컬 모드로 사용할 수 있습니다.", 
                 font=("Segoe UI", 10), fg="#8aa0b9", bg="#0f1115").pack(pady=(0, 15))
        
        # 입력 필드
        api_entry = tk.Entry(api_dialog, width=50, font=("Consolas", 10), 
                             bg="#1a2030", fg="#e0e0e0", insertbackground="#a5f3fc")
        api_entry.pack(pady=5)
        
        result = {"key": None, "skipped": False}
        
        def save_key():
            key = api_entry.get().strip()
            if key:
                try:
                    key_file.write_text(key, encoding="utf-8")
                    result["key"] = key
                except Exception:
                    pass
            api_dialog.destroy()
        
        def skip_key():
            result["skipped"] = True
            api_dialog.destroy()
        
        # 버튼
        btn_frame = tk.Frame(api_dialog, bg="#0f1115")
        btn_frame.pack(pady=15)
        
        tk.Button(btn_frame, text="💾 저장", command=save_key, width=12,
                  font=("Segoe UI", 10), bg="#2d4a3f", fg="white").pack(side=tk.LEFT, padx=5)
        tk.Button(btn_frame, text="⏭️ 스킵 (로컬만)", command=skip_key, width=15,
                  font=("Segoe UI", 10), bg="#4a2d3f", fg="white").pack(side=tk.LEFT, padx=5)
        
        api_dialog.mainloop()
        
        # 다이얼로그 후 스플래시 다시 표시
        splash = Splash(project_root)
        splash.set_status("서버 시작 준비 중...")
        
        if result["key"]:
            env["GEMINI_API_KEY"] = result["key"]
    else:
        # 기존 키 로드
        try:
            env["GEMINI_API_KEY"] = key_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    
    ngrok_token = load_ngrok_token(project_root, env)

    # Start server (새 구조 우선 확인)
    server_script = project_root / "src" / "ai_drill" / "web_server.py"
    if not server_script.exists():
        server_script = project_root / "ai_drill" / "web_server.py"  # 이전 구조 호환
    
    # PYTHONPATH 설정 (src 폴더를 Python 경로에 추가)
    src_dir = project_root / "src"
    if src_dir.exists():
        existing_pythonpath = env.get("PYTHONPATH", "")
        if existing_pythonpath:
            env["PYTHONPATH"] = f"{src_dir}{os.pathsep}{existing_pythonpath}"
        else:
            env["PYTHONPATH"] = str(src_dir)
    
    splash.set_status("서버 실행 중...")
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        server = subprocess.Popen(
            python_cmd.split() + [str(server_script)],
            cwd=project_root,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            creationflags=creationflags,
        )
    except Exception:
        splash.set_status("서버 실행 실패")
        splash.set_sub("Python 및 의존성 확인 후 다시 시도하세요.")
        time.sleep(2)
        splash.close()
        return 1

    # Start ngrok if available
    splash.set_sub("ngrok 확인 중...")
    ngrok_proc = start_ngrok(project_root, env, ngrok_token)

    def finalize():
        time.sleep(1.5)
        
        # Parse ngrok URL from log if available
        if ngrok_proc:
            try:
                time.sleep(2)  # Wait for ngrok to start
                ngrok_log = project_root / "logs" / "ngrok.log"
                if ngrok_log.exists():
                    import re
                    log_content = ngrok_log.read_text(encoding="utf-8", errors="replace")
                    # Look for URL pattern like https://xxxx.ngrok-free.app
                    match = re.search(r'url=(https://[^\s"]+\.ngrok-free\.app)', log_content)
                    if match:
                        ngrok_url = match.group(1)
                        # Update server_info.json with ngrok URL
                        server_info_path = project_root / "src" / "web_app" / "server_info.json"
                        if not server_info_path.exists():
                            server_info_path = project_root / "web_app" / "server_info.json"
                        if server_info_path.exists():
                            import json
                            info = json.loads(server_info_path.read_text(encoding="utf-8"))
                            info["ngrok_url"] = ngrok_url
                            server_info_path.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass
        
        webbrowser.open("http://localhost:8000")
        splash.close()
        try:
            server.wait()
        except KeyboardInterrupt:
            pass
        finally:
            for proc in (ngrok_proc, server):
                if proc:
                    try:
                        proc.terminate()
                    except Exception:
                        pass

    threading.Thread(target=finalize, daemon=True).start()
    splash.root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
