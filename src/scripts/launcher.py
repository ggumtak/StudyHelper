"""
Study Helper - GUI launcher and updater.

- Auto update via git when a repository is present.
- Fallback updater that downloads the packaged StudyHelper.exe when git is missing.
- Python environment check/installer.
- Starts backend server + optional ngrok, then opens the browser.

All UI text is English only to avoid encoding issues.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
import tkinter as tk
from tkinter import messagebox

# GitHub repository info
GITHUB_REPO = "ggumtak/StudyHelper"
GITHUB_RAW_URL = f"https://raw.githubusercontent.com/{GITHUB_REPO}/main"
LATEST_EXE_URL = f"{GITHUB_RAW_URL}/dist/StudyHelper.exe"


# ---------------------------------------------------------------------------
# Update helpers
# ---------------------------------------------------------------------------
def is_git_available() -> bool:
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        subprocess.run(
            ["git", "--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            creationflags=creationflags,
        )
        return True
    except Exception:
        return False


def is_git_repo(project_root: Path) -> bool:
    return (project_root / ".git").exists()


def git_pull_latest(project_root: Path, splash: "Splash | None") -> bool:
    """Return True if git pull ran (success or not needed)."""
    if not is_git_available() or not is_git_repo(project_root):
        return False

    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    if splash:
        splash.set_status("Checking for updates (git)...")
        splash.set_sub("Fetching latest commits")

    try:
        subprocess.run(
            ["git", "fetch", "--quiet"],
            cwd=project_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=creationflags,
            timeout=30,
        )

        status = subprocess.run(
            ["git", "status", "-uno"],
            cwd=project_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=creationflags,
            text=True,
        )
        output = status.stdout.lower()
        behind = "behind" in output
        if behind:
            if splash:
                splash.set_status("Downloading updates...")
                splash.set_sub("Applying git pull")
            pull = subprocess.run(
                ["git", "pull", "--ff-only"],
                cwd=project_root,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=creationflags,
                text=True,
                timeout=60,
            )
            if pull.returncode == 0:
                if splash:
                    splash.set_status("Updated to latest code")
                    splash.set_sub("Restart if files were replaced")
                time.sleep(1)
            else:
                if splash:
                    splash.set_sub("Git pull failed; continuing with local copy")
        else:
            if splash:
                splash.set_sub("Already up to date")
        return True
    except subprocess.TimeoutExpired:
        if splash:
            splash.set_sub("Git check timed out; continuing")
        return True
    except Exception as exc:
        if splash:
            splash.set_sub(f"Git check failed: {str(exc)[:40]}")
        return True


def download_latest_exe(exe_dir: Path, splash: "Splash | None") -> Path | None:
    """
    Download latest packaged StudyHelper.exe into exe_dir.
    We do NOT overwrite the running executable; instead we drop StudyHelper.new.exe.
    """
    target = exe_dir / "StudyHelper.new.exe"
    tmp_path = target.with_suffix(".download")
    if splash:
        splash.set_status("Downloading latest build...")
        splash.set_sub("Fetching StudyHelper.exe from GitHub")
    try:
        req = urllib.request.Request(LATEST_EXE_URL, headers={"User-Agent": "StudyHelper-Updater"})
        with urllib.request.urlopen(req, timeout=60) as resp, open(tmp_path, "wb") as f:
            shutil.copyfileobj(resp, f)
        tmp_path.replace(target)
        return target
    except urllib.error.HTTPError as exc:
        if splash:
            splash.set_sub(f"Download failed (HTTP {exc.code})")
    except Exception as exc:
        if splash:
            splash.set_sub(f"Download failed: {str(exc)[:40]}")
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass
    return None


def ensure_latest_build(project_root: Path, splash: "Splash | None"):
    """
    Try git first. If not a git repo and running from EXE, download latest StudyHelper.exe.
    """
    exe_dir = resolve_base_dir()
    running_from_exe = getattr(sys, "frozen", False)
    if git_pull_latest(project_root, splash):
        return

    # Git not available or not a repo; attempt binary download if running packaged.
    if running_from_exe:
        new_exe = download_latest_exe(exe_dir, splash)
        if new_exe and splash:
            splash.set_status("New build downloaded")
            splash.set_sub(f"Use {new_exe.name} next time")
            messagebox.showinfo(
                "Update ready",
                f"A newer StudyHelper.exe was downloaded to:\n{new_exe}\n"
                "Close this app and launch the new file to update.",
            )


# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------
def resolve_base_dir() -> Path:
    if getattr(sys, "frozen", False):  # PyInstaller executable
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def find_project_root(base_dir: Path) -> Path | None:
    # Expected layouts: <root>/src/ai_drill/web_server.py or <root>/ai_drill/web_server.py
    for candidate in (base_dir, base_dir.parent):
        if (candidate / "src" / "ai_drill" / "web_server.py").exists():
            return candidate
        if (candidate / "ai_drill" / "web_server.py").exists():
            return candidate
    return None


def find_python_cmd() -> str | None:
    """Find Python command - tries multiple methods including common install paths."""
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

    for cmd in ("py -3.11", "py -3", "python", "python3"):
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

    if os.name == "nt":
        common_paths = [
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Python311" / "python.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Python310" / "python.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Python39" / "python.exe",
            Path("C:/Python311/python.exe"),
            Path("C:/Python310/python.exe"),
            Path("C:/Program Files/Python311/python.exe"),
            Path("C:/Program Files/Python310/python.exe"),
        ]
        for python_path in common_paths:
            if python_path.exists():
                try:
                    subprocess.run(
                        [str(python_path), "--version"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        check=True,
                        creationflags=creationflags,
                    )
                    return str(python_path)
                except Exception:
                    continue

    return None


def run_python_installer(installer_path: Path) -> bool:
    if not installer_path.exists():
        return False
    try:
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


# ---------------------------------------------------------------------------
# UI helpers
# ---------------------------------------------------------------------------
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
                text="Study Helper",
                font=("Segoe UI Semibold", 18),
                fg="#a5f3fc",
                bg="#0f1115",
            )
            self.img_label.pack(pady=(30, 10))

        self.label = tk.Label(self.root, text="Starting up...", font=("Segoe UI", 11), fg="#cdd5e0", bg="#0f1115")
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


def prompt_api_key(config_dir: Path) -> str | None:
    """Prompt user for API key. Returns key or None."""
    result: dict[str, str | None | bool] = {"key": None, "skipped": False}
    dialog = tk.Tk()
    dialog.title("Gemini API Key")
    dialog.geometry("450x220")
    dialog.resizable(False, False)
    dialog.configure(bg="#0f1115")
    dialog.attributes("-topmost", True)

    tk.Label(
        dialog,
        text="Enter your Gemini API key (optional for AI features)",
        font=("Segoe UI Semibold", 12),
        fg="#a5f3fc",
        bg="#0f1115",
        wraplength=420,
    ).pack(pady=(20, 8))

    tk.Label(
        dialog,
        text="If you skip, the app will run in local-only mode.",
        font=("Segoe UI", 10),
        fg="#8aa0b9",
        bg="#0f1115",
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
        result["skipped"] = True
        dialog.destroy()

    tk.Button(
        btn_frame,
        text="Save",
        command=on_save,
        font=("Segoe UI", 10),
        bg="#22c55e",
        fg="white",
        width=10,
        cursor="hand2",
    ).pack(side="left", padx=10)

    tk.Button(
        btn_frame,
        text="Skip (local mode)",
        command=on_skip,
        font=("Segoe UI", 10),
        bg="#64748b",
        fg="white",
        width=14,
        cursor="hand2",
    ).pack(side="left", padx=10)

    entry.bind("<Return>", lambda _e: on_save())
    dialog.bind("<Escape>", lambda _e: on_skip())

    dialog.mainloop()
    return result["key"]


# ---------------------------------------------------------------------------
# Server helpers
# ---------------------------------------------------------------------------
def start_ngrok(project_root: Path, env: dict[str, str], token: str | None):
    ngrok_path = project_root / "ngrok.exe"
    if not ngrok_path.exists():
        return None

    cmd = [str(ngrok_path), "http", "3000", "--log=stdout"]
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


def read_server_port(project_root: Path) -> int:
    server_info_path = project_root / "src" / "web_app" / "server_info.json"
    if not server_info_path.exists():
        server_info_path = project_root / "web_app" / "server_info.json"
    try:
        info = json.loads(server_info_path.read_text(encoding="utf-8"))
        return int(info.get("port", 3000))
    except Exception:
        return 3000


def start_server(project_root: Path, python_cmd: str, env: dict[str, str]):
    server_script = project_root / "src" / "ai_drill" / "web_server.py"
    if not server_script.exists():
        server_script = project_root / "ai_drill" / "web_server.py"

    src_dir = project_root / "src"
    if src_dir.exists():
        existing_pythonpath = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{src_dir}{os.pathsep}{existing_pythonpath}" if existing_pythonpath else str(src_dir)

    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    return subprocess.Popen(
        python_cmd.split() + [str(server_script)],
        cwd=project_root,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
        creationflags=creationflags,
    )


def update_ngrok_url(project_root: Path):
    ngrok_log = project_root / "logs" / "ngrok.log"
    if not ngrok_log.exists():
        return
    try:
        import re

        time.sleep(2)
        log_content = ngrok_log.read_text(encoding="utf-8", errors="replace")
        match = re.search(r"url=(https://[^\s\"]+\.ngrok-free\.app)", log_content)
        if not match:
            return
        ngrok_url = match.group(1)
        server_info_path = project_root / "src" / "web_app" / "server_info.json"
        if not server_info_path.exists():
            server_info_path = project_root / "web_app" / "server_info.json"
        if server_info_path.exists():
            info = json.loads(server_info_path.read_text(encoding="utf-8"))
            info["ngrok_url"] = ngrok_url
            server_info_path.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        return


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    exe_dir = resolve_base_dir()
    project_root = find_project_root(exe_dir)
    if not project_root:
        messagebox.showerror(
            "Error",
            "Project root not found. Please run StudyHelper.exe from the project folder.",
        )
        return 1

    splash = Splash(project_root)
    splash.set_status("Starting...")
    ensure_latest_build(project_root, splash)

    splash.set_status("Checking Python...")
    python_cmd = find_python_cmd()
    if not python_cmd:
        splash.set_status("Python missing")
        installer = project_root / "installers" / "python-3.11.9-amd64.exe"
        splash.set_sub("Trying bundled installer")
        if run_python_installer(installer):
            splash.set_status("Python installed, re-checking...")
            python_cmd = find_python_cmd()
    if not python_cmd:
        splash.set_status("Python not found")
        splash.set_sub("Install Python 3.11 and try again")
        time.sleep(3)
        splash.close()
        return 1

    env = dict(os.environ)
    env["SKIP_AUTO_BROWSER_OPEN"] = "1"
    config_dir = project_root / "config"
    logs_dir = project_root / "logs"
    for folder in (config_dir, logs_dir):
        folder.mkdir(parents=True, exist_ok=True)

    key_file = config_dir / "gemini_api_key.txt"
    if key_file.exists():
        try:
            env["GEMINI_API_KEY"] = key_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    else:
        splash.close()
        key = prompt_api_key(config_dir)
        if key:
            env["GEMINI_API_KEY"] = key
        splash = Splash(project_root)
        splash.set_status("Starting server...")

    ngrok_token = load_ngrok_token(project_root, env)

    try:
        server_proc = start_server(project_root, python_cmd, env)
    except Exception:
        splash.set_status("Server failed to start")
        splash.set_sub("Check Python installation")
        time.sleep(2)
        splash.close()
        return 1

    splash.set_sub("Launching ngrok (if available)")
    ngrok_proc = start_ngrok(project_root, env, ngrok_token)

    def finalize():
        time.sleep(1.5)
        update_ngrok_url(project_root)
        port = read_server_port(project_root)
        webbrowser.open(f"http://localhost:{port}")
        splash.close()
        try:
            server_proc.wait()
        except KeyboardInterrupt:
            pass
        finally:
            for proc in (ngrok_proc, server_proc):
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
