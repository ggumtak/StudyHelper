"""
Study Helper - release patcher/downloader.

Workflow:
1) Download the release asset (zip/exe) from the provided URL.
2) Verify checksum (sha256) when provided.
3) Extract into a temp folder (zip) or use the file directly (exe).
4) Ensure target processes are not running, then replace files atomically
   (old files renamed to *.bak, new files staged as *.new then swapped).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterable

try:
    from ai_drill.version import PATCHER_VERSION
except Exception:  # pragma: no cover - fallback for development
    PATCHER_VERSION = "0.0.0"


def resolve_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def download_file(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "StudyHelper-Patcher"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(dest, "wb") as fh:
        shutil.copyfileobj(resp, fh)
    return dest


def checksum(path: Path) -> str:
    sha = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def verify_checksum(path: Path, expected: str) -> bool:
    if not expected:
        return True
    try:
        return checksum(path).lower() == expected.lower()
    except Exception:
        return False


def is_process_running(name: str) -> bool:
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        if os.name == "nt":
            output = subprocess.check_output(["tasklist"], creationflags=creationflags)
        else:
            output = subprocess.check_output(["ps", "aux"], creationflags=creationflags)
        return name.lower() in output.decode("utf-8", errors="ignore").lower()
    except Exception:
        return False


def stage_file(src: Path, dest: Path):
    tmp_dest = dest.with_suffix(dest.suffix + ".new")
    tmp_dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, tmp_dest)
    backup = dest.with_suffix(dest.suffix + ".bak")

    if dest.exists():
        try:
            if backup.exists():
                if backup.is_dir():
                    shutil.rmtree(backup, ignore_errors=True)
                else:
                    backup.unlink(missing_ok=True)
        except Exception:
            pass
        try:
            dest.rename(backup)
        except Exception:
            # If rename fails, attempt to remove existing backup and continue
            try:
                if backup.exists():
                    backup.unlink()
                dest.rename(backup)
            except Exception:
                pass
    tmp_dest.replace(dest)


def stage_directory(src: Path, dest: Path):
    tmp_dest = dest.with_name(dest.name + ".new")
    if tmp_dest.exists():
        shutil.rmtree(tmp_dest, ignore_errors=True)
    shutil.copytree(src, tmp_dest, dirs_exist_ok=True)

    backup = dest.with_name(dest.name + ".bak")
    if dest.exists():
        if backup.exists():
            shutil.rmtree(backup, ignore_errors=True)
        dest.rename(backup)
    tmp_dest.replace(dest)


def copy_tree(source_root: Path, target_root: Path):
    for item in source_root.iterdir():
        target_path = target_root / item.name
        if item.is_dir():
            stage_directory(item, target_path)
        else:
            stage_file(item, target_path)


def extract_if_needed(archive_path: Path) -> Path:
    if archive_path.suffix.lower() != ".zip":
        return archive_path

    temp_dir = Path(tempfile.mkdtemp(prefix="studyhelper_patch_"))
    with zipfile.ZipFile(archive_path, "r") as zf:
        zf.extractall(temp_dir)
    return temp_dir


def find_payload_items(extracted_path: Path) -> Iterable[Path]:
    if extracted_path.is_file():
        return [extracted_path]

    # Prefer flat structure (zip root)
    items = list(extracted_path.iterdir())
    if len(items) == 1 and items[0].is_dir():
        # Unwrap single top-level directory for convenience
        return items[0].iterdir()
    return items


def main() -> int:
    parser = argparse.ArgumentParser(description="Study Helper patcher/downloader")
    parser.add_argument("--asset-url", required=True, help="URL to zip/exe asset")
    parser.add_argument("--checksum", default="", help="sha256 checksum of the asset")
    parser.add_argument("--target", default="StudyHelper.exe", help="Main executable name to replace")
    parser.add_argument("--install-dir", default="", help="Install directory (defaults to current/exe dir)")
    parser.add_argument("--version", default="", help="Version being installed (informational)")
    args = parser.parse_args()

    base_dir = Path(args.install_dir) if args.install_dir else resolve_base_dir()
    asset_url = args.asset_url
    target_name = args.target

    print(f"[Patcher] v{PATCHER_VERSION} -> installing to {base_dir}")
    print(f"[Patcher] Fetching asset: {asset_url}")

    tmp_download = Path(tempfile.mkdtemp(prefix="studyhelper_dl_")) / Path(asset_url).name
    try:
        download_file(asset_url, tmp_download)
    except urllib.error.HTTPError as exc:
        print(f"[Patcher] Download failed (HTTP {exc.code})")
        return 1
    except Exception as exc:
        print(f"[Patcher] Download failed: {exc}")
        return 1

    if not verify_checksum(tmp_download, args.checksum):
        print("[Patcher] Checksum mismatch; aborting")
        return 1

    payload_root = extract_if_needed(tmp_download)

    # Simple running-process check
    if is_process_running(target_name):
        print(f"[Patcher] Detected running {target_name}. Close it and retry.")
        return 1

    try:
        items = list(find_payload_items(payload_root))
        if not items:
            print("[Patcher] No files found in payload")
            return 1

        for item in items:
            if item.is_dir():
                copy_tree(item, base_dir / item.name)
            else:
                dest = base_dir / item.name
                stage_file(item, dest)

        # Record installed version for launcher bookkeeping
        version_record = {"version": args.version or "", "installed_at": time.time()}
        try:
            (base_dir / "installed_version.json").write_text(
                json.dumps(version_record, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except Exception:
            pass

        print("[Patcher] Update complete")
        return 0
    finally:
        try:
            if payload_root.is_dir() and payload_root.name.startswith("studyhelper_patch_"):
                shutil.rmtree(payload_root, ignore_errors=True)
            if tmp_download.exists():
                tmp_download.unlink()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
