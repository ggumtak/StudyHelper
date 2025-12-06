"""
Study Helper - thin launcher & updater.

Behaviors:
- If a git repo exists, run a quick git pull (repo-only path).
- Otherwise, read remote version.json and, when newer or missing binaries,
  call StudyHelperPatcher.exe to download/replace the packaged StudyHelper.exe.
- Launch StudyHelper.exe (PyInstaller onefile of src/ai_drill/web_server.py)
  with SKIP_AUTO_BROWSER_OPEN to avoid wrong ports, then open the browser
  using the port written to server_info.json in the temp runtime folder.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any

try:
    import tkinter as tk
    from tkinter import messagebox
except Exception:  # pragma: no cover - headless/CI safety
    tk = None
    messagebox = None

# Ensure local package imports work when running as a script
THIS_FILE = Path(__file__).resolve()
SRC_DIR = THIS_FILE.parents[1]
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

try:
    from ai_drill.version import APP_VERSION, LAUNCHER_VERSION
except Exception:  # pragma: no cover - defensive fallback
    APP_VERSION = "0.0.0"
    LAUNCHER_VERSION = "0.0.0"

VERSION_ENDPOINT = "https://raw.githubusercontent.com/ggumtak/StudyHelper/main/version.json"
TARGET_EXE_NAME = "StudyHelper.exe"
PATCHER_EXE_NAME = "StudyHelperPatcher.exe"
LOCAL_VERSION_FILE = "installed_version.json"
RUNTIME_DIR = Path(os.getenv("STUDYHELPER_RUNTIME_DIR", Path(tempfile.gettempdir()) / "studyhelper"))


# ---------------------------------------------------------------------------
# UI helpers (minimal splash)
# ---------------------------------------------------------------------------
class StatusUI:
    def __init__(self):
        self.root = None
        self.status_label = None
        if tk:
            try:
                self.root = tk.Tk()
                self.root.title("Study Helper Launcher")
                self.root.geometry("420x160")
                self.root.resizable(False, False)
                self.root.attributes("-topmost", True)
                self.root.configure(bg="#0f1115")
                label = tk.Label(
                    self.root,
                    text="Study Helper Launcher",
                    font=("Segoe UI Semibold", 14),
                    fg="#a5f3fc",
                    bg="#0f1115",
                )
                label.pack(pady=(18, 8))
                self.status_label = tk.Label(
                    self.root,
                    text="Starting...",
                    font=("Segoe UI", 11),
                    fg="#cdd5e0",
                    bg="#0f1115",
                )
                self.status_label.pack(pady=(0, 12))
                self.root.update_idletasks()
            except Exception:
                self.root = None

    def set(self, text: str):
        if self.status_label:
            self.status_label.config(text=text)
            self.root.update_idletasks()
        else:
            print(f"[Launcher] {text}")

    def close(self):
        try:
            if self.root:
                self.root.destroy()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Version helpers
# ---------------------------------------------------------------------------
def resolve_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return THIS_FILE.parents[2]


def version_key(value: str) -> tuple[int, ...]:
    parts = []
    for part in str(value).split("."):
        try:
            parts.append(int(part))
        except ValueError:
            parts.append(0)
    return tuple(parts)


def is_git_repo(path: Path) -> bool:
    return (path / ".git").exists()


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


def git_pull(project_root: Path, ui: StatusUI) -> bool:
    """
    Repo-only path: attempt git pull. Returns True if handled (success or failure).
    """
    if not is_git_repo(project_root) or not is_git_available():
        return False

    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    ui.set("Checking updates via git...")
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
        if "behind" in status.stdout.lower():
            ui.set("Updating repo (git pull)...")
            subprocess.run(
                ["git", "pull", "--ff-only"],
                cwd=project_root,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=creationflags,
                text=True,
                timeout=60,
            )
        else:
            ui.set("Repo already up to date")
        return True
    except Exception:
        ui.set("Git update failed; continuing with local copy")
        return True


def fetch_remote_version() -> dict[str, Any] | None:
    req = urllib.request.Request(VERSION_ENDPOINT, headers={"User-Agent": "StudyHelper-Launcher"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict) and "version" in data and "url" in data:
                return data
    except urllib.error.URLError:
        return None
    except Exception:
        return None
    return None


def read_installed_version(base_dir: Path) -> str:
    path = base_dir / LOCAL_VERSION_FILE
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("version"):
                return str(data["version"])
    except Exception:
        pass
    return APP_VERSION


def write_installed_version(base_dir: Path, version: str):
    try:
        path = base_dir / LOCAL_VERSION_FILE
        path.write_text(json.dumps({"version": version}, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Update helpers (Release path)
# ---------------------------------------------------------------------------
def pick_patcher_command(base_dir: Path, remote_info: dict[str, Any]) -> list[str] | None:
    patcher_exe = base_dir / PATCHER_EXE_NAME
    if patcher_exe.exists():
        return [
            str(patcher_exe),
            f"--asset-url={remote_info.get('url', '')}",
            f"--checksum={remote_info.get('checksum', '')}",
            f"--version={remote_info.get('version', '')}",
            f"--target={TARGET_EXE_NAME}",
            f"--install-dir={base_dir}",
        ]

    patcher_py = SRC_DIR / "scripts" / "patcher.py"
    if patcher_py.exists():
        python_cmd = sys.executable
        return [
            python_cmd,
            str(patcher_py),
            f"--asset-url={remote_info.get('url', '')}",
            f"--checksum={remote_info.get('checksum', '')}",
            f"--version={remote_info.get('version', '')}",
            f"--target={TARGET_EXE_NAME}",
            f"--install-dir={base_dir}",
        ]
    return None


def run_patcher(base_dir: Path, remote_info: dict[str, Any], ui: StatusUI) -> bool:
    cmd = pick_patcher_command(base_dir, remote_info)
    if not cmd:
        ui.set("Patcher missing; cannot auto-update")
        return False

    ui.set("Downloading latest release...")
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        result = subprocess.run(
            cmd,
            cwd=base_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            creationflags=creationflags,
        )
        if result.returncode == 0:
            write_installed_version(base_dir, str(remote_info.get("version", APP_VERSION)))
            return True
        ui.set("Patcher failed; launching current build")
        return False
    except Exception:
        ui.set("Patcher error; launching current build")
        return False


def ensure_release(base_dir: Path, ui: StatusUI) -> bool:
    target_exe = base_dir / TARGET_EXE_NAME
    remote = fetch_remote_version()
    installed_version = read_installed_version(base_dir)

    needs_update = not target_exe.exists()
    if remote:
        if version_key(installed_version) < version_key(str(remote.get("version", installed_version))):
            needs_update = True

    if needs_update:
        if not remote:
            ui.set("Release info unavailable; starting local build")
            return target_exe.exists()
        return run_patcher(base_dir, remote, ui)
    return True


# ---------------------------------------------------------------------------
# Launch helpers
# ---------------------------------------------------------------------------
def _server_info_paths(base_dir: Path) -> list[Path]:
    return [
        RUNTIME_DIR / "web_app" / "server_info.json",
        base_dir / "web_app" / "server_info.json",
        base_dir / "src" / "web_app" / "server_info.json",
    ]


def open_browser_with_port(base_dir: Path, timeout: float = 20.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for info_path in _server_info_paths(base_dir):
            if info_path.exists():
                try:
                    data = json.loads(info_path.read_text(encoding="utf-8"))
                    port = data.get("port") or 3000
                    webbrowser.open(f"http://localhost:{port}")
                    return
                except Exception:
                    continue
        time.sleep(0.5)
    # Fallback: last known port or default
    webbrowser.open("http://localhost:3000")


def launch_app(base_dir: Path, ui: StatusUI) -> int:
    target_exe = base_dir / TARGET_EXE_NAME
    env = dict(os.environ)
    env["SKIP_AUTO_BROWSER_OPEN"] = "1"  # launcher handles it using server_info.json
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

    if target_exe.exists():
        ui.set("Starting Study Helper...")
        try:
            proc = subprocess.Popen(
                [str(target_exe)],
                cwd=base_dir,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
            )
            open_browser_with_port(base_dir)
            ui.close()
            return_code = proc.wait()
            return return_code or 0
        except Exception:
            ui.set("Failed to start StudyHelper.exe")
            time.sleep(2)
            return 1

    # Dev fallback (source run)
    server_script = SRC_DIR / "ai_drill" / "web_server.py"
    if server_script.exists():
        ui.set("StudyHelper.exe missing; running from source")
        try:
            proc = subprocess.Popen(
                [sys.executable, str(server_script)],
                cwd=base_dir,
                env=env,
                creationflags=creationflags,
            )
            open_browser_with_port(base_dir)
            ui.close()
            return proc.wait() or 0
        except Exception:
            ui.set("Source launch failed")
            time.sleep(2)
            return 1

    ui.set("No runnable target found")
    time.sleep(2)
    return 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    ui = StatusUI()
    base_dir = resolve_base_dir()
    ui.set(f"Launcher v{LAUNCHER_VERSION} | App v{APP_VERSION}")

    # Repo-only fast path
    git_handled = git_pull(base_dir, ui)
    if (not git_handled) or not (base_dir / TARGET_EXE_NAME).exists():
        ensure_release(base_dir, ui)

    code = launch_app(base_dir, ui)
    ui.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
