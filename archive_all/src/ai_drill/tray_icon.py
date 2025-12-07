"""
System tray helper for StudyHelper (Windows only).

Shows a tray icon while the app is running and lets users exit from the
context menu. Dependencies (pystray, Pillow, pywin32) are optional;
when missing, tray support is silently skipped.
"""

from __future__ import annotations

import os
import sys
import threading
import webbrowser
from pathlib import Path
from typing import Callable, Optional

LogFn = Callable[[str], None]


def _safe_log(log_fn: Optional[LogFn], message: str):
    """Log helper that tolerates missing log function."""
    if log_fn:
        try:
            log_fn(message)
        except Exception:
            pass


def _import_pystray():
    try:
        import pystray
        return pystray
    except Exception:
        return None


def _import_pillow_image():
    try:
        from PIL import Image
        return Image
    except Exception:
        return None


def _find_icon_path() -> Path | None:
    """Search for the tray icon file in common locations."""
    candidates = []

    # _MEIPASS when frozen
    if getattr(sys, "frozen", False):
        candidates.append(Path(getattr(sys, "_MEIPASS", "")) / "assets" / "mushroom_icon.ico")

    # Repo layout when running from source
    current = Path(__file__).resolve()
    candidates.append(current.parents[2] / "src" / "assets" / "mushroom_icon.ico")
    candidates.append(current.parents[2] / "assets" / "mushroom_icon.ico")

    for path in candidates:
        if path.exists():
            return path
    return None


class TrayController:
    """
    Minimal tray controller for Windows notification area.

    - Left click / double click: open browser to the app URL.
    - Right click menu:
        * "열기" -> open browser
        * "작업 끝내기" -> stop tray and terminate the process
    """

    def __init__(
        self,
        label: str,
        open_callback: Callable[[], None],
        exit_callback: Callable[[], None],
        log_fn: Optional[LogFn] = None,
    ):
        self.label = label
        self.open_callback = open_callback
        self.exit_callback = exit_callback
        self.log_fn = log_fn
        self.icon = None
        self.thread: threading.Thread | None = None

    def _load_image(self):
        Image = _import_pillow_image()
        if not Image:
            _safe_log(self.log_fn, "Tray: Pillow not available, skipping tray icon.")
            return None

        icon_path = _find_icon_path()
        if not icon_path:
            _safe_log(self.log_fn, "Tray: icon file not found, skipping tray icon.")
            return None

        try:
            return Image.open(icon_path)
        except Exception as exc:
            _safe_log(self.log_fn, f"Tray: failed to load icon ({exc}), skipping tray.")
            return None

    def _create_icon(self):
        pystray = _import_pystray()
        if not pystray:
            _safe_log(self.log_fn, "Tray: pystray not available, skipping tray icon.")
            return False

        image = self._load_image()
        if not image:
            return False

        menu = pystray.Menu(
            pystray.MenuItem("열기", lambda _: self._open(), default=True),
            pystray.MenuItem("작업 끝내기", lambda _: self._quit()),
        )

        self.icon = pystray.Icon("StudyHelper", image, self.label, menu=menu)
        self.icon.visible = True
        return True

    def _open(self):
        try:
            if self.open_callback:
                self.open_callback()
        except Exception:
            pass

    def _quit(self):
        try:
            if self.icon:
                # Hide tray before exiting.
                self.icon.visible = False
                self.icon.stop()
        except Exception:
            pass

        try:
            if self.exit_callback:
                self.exit_callback()
        except Exception:
            pass

    def start(self):
        if os.name != "nt":
            return
        if not self._create_icon():
            return

        self.thread = threading.Thread(target=self.icon.run, daemon=True)
        self.thread.start()
        _safe_log(self.log_fn, "Tray: icon started.")

    def stop(self):
        try:
            if self.icon:
                self.icon.visible = False
                self.icon.stop()
        except Exception:
            pass
