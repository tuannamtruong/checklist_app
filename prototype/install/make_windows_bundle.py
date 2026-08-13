#!/usr/bin/env python3
"""Build a self-contained Windows launcher for the sync prototype.

Stages an official Python embeddable distribution (no installer, no pip, no
admin rights) into a folder on the Windows side, generates an icon, and creates
a desktop shortcut that runs serve.py with pythonw.exe -- no console window.

    python3 make_windows_bundle.py --folder "C:\\Users\\Nam\\Dropbox\\checklist"

Runs from WSL or from native Windows. Python 3 stdlib only.

No .exe is produced, deliberately. A shortcut to Microsoft's own signed
pythonw.exe raises no SmartScreen warning; an unsigned executable does.

The prototype is NOT copied to the Windows side. The shortcut points at
serve.py where it already lives, so there is one copy of the code and git keeps
working. Under WSL that means the shortcut reaches it over \\\\wsl.localhost.
"""

from __future__ import annotations

import argparse
import os
import re
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
import zlib
from pathlib import Path

PYTHON_VERSION = "3.12.10"
DEFAULT_TARGET = r"C:\Tools\ChecklistProto"
APP_NAME = "Checklist Sync"
PORT = 38531

PROTOTYPE = Path(__file__).resolve().parent.parent
CACHE_DIR = PROTOTYPE / ".build-cache"

IS_WINDOWS = os.name == "nt"


def _is_wsl() -> bool:
    if IS_WINDOWS:
        return False
    try:
        return "microsoft" in Path("/proc/version").read_text().lower()
    except OSError:
        return False


IS_WSL = _is_wsl()


# --- Path translation between the WSL and Windows views of the filesystem ---


def to_windows_path(path: Path) -> str:
    """Windows spelling of a path we can see locally."""
    path = path.resolve()
    if IS_WINDOWS:
        return str(path)
    parts = path.parts  # ('/', 'mnt', 'c', ...)
    if len(parts) >= 3 and parts[1] == "mnt" and len(parts[2]) == 1:
        drive = parts[2].upper()
        rest = "\\".join(parts[3:])
        return f"{drive}:\\{rest}" if rest else f"{drive}:\\"
    # Native WSL filesystem: reachable from Windows over the 9p bridge.
    distro = os.environ.get("WSL_DISTRO_NAME", "Ubuntu")
    return "\\\\wsl.localhost\\" + distro + "\\" + "\\".join(parts[1:])


def to_local_path(win: str) -> Path:
    """Local path for a Windows path, so we can write to it from here."""
    if IS_WINDOWS:
        return Path(win)
    m = re.match(r"^([A-Za-z]):[\\/](.*)$", win)
    if not m:
        raise SystemExit(
            f"expected a drive-letter path like {DEFAULT_TARGET!r}, got {win!r}"
        )
    return Path("/mnt") / m.group(1).lower() / m.group(2).replace("\\", "/")


# --- Icon: supersampled draw -> PNG -> .ico, all stdlib -------------------
#
# Windows Vista and later accept PNG-compressed entries inside an .ico, which
# is far less code than hand-rolling a BMP with its upside-down rows and
# separate AND mask.

BG = (0x2F, 0x5C, 0xD6, 0xFF)
FG = (0xFF, 0xFF, 0xFF, 0xFF)
SIZES = (16, 32, 48, 64, 128, 256)
SS = 4  # supersampling factor; the only antialiasing there is


def _rounded_box(x: float, y: float, size: float, inset: float, radius: float) -> bool:
    lo, hi = inset, size - inset
    if not (lo <= x <= hi and lo <= y <= hi):
        return False
    cx = min(max(x, lo + radius), hi - radius)
    cy = min(max(y, lo + radius), hi - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2


def _near_segment(px, py, ax, ay, bx, by, half) -> bool:
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    t = 0.0 if length == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length))
    qx, qy = ax + t * dx, ay + t * dy
    return (px - qx) ** 2 + (py - qy) ** 2 <= half**2


def _render(size: int) -> bytes:
    """Top-down RGBA bytes for one icon size."""
    big = size * SS
    inset, radius = big * 0.06, big * 0.22
    stroke = big * 0.10
    # A tick, in normalised coordinates.
    ax, ay = big * 0.28, big * 0.52
    bx, by = big * 0.44, big * 0.70
    cx, cy = big * 0.74, big * 0.32

    # Draw supersampled, then average each SS x SS block down to one pixel.
    hi = bytearray(big * big)
    for y in range(big):
        row = y * big
        fy = y + 0.5
        for x in range(big):
            fx = x + 0.5
            if not _rounded_box(fx, fy, big, inset, radius):
                continue
            on_tick = _near_segment(fx, fy, ax, ay, bx, by, stroke / 2) or _near_segment(
                fx, fy, bx, by, cx, cy, stroke / 2
            )
            hi[row + x] = 2 if on_tick else 1

    out = bytearray()
    area = SS * SS
    for y in range(size):
        for x in range(size):
            bg = fg = 0
            for sy in range(y * SS, y * SS + SS):
                base = sy * big
                for sx in range(x * SS, x * SS + SS):
                    v = hi[base + sx]
                    if v == 1:
                        bg += 1
                    elif v == 2:
                        fg += 1
            covered = bg + fg
            if covered == 0:
                out += bytes(4)
                continue
            # Mix the two colours by their share of the covered part, then let
            # total coverage drive alpha -- that is what softens the corners.
            share = fg / covered
            out += bytes(
                (
                    round(BG[i] * (1 - share) + FG[i] * share)
                    for i in range(3)
                )
            ) + bytes((round(255 * covered / area),))
    return bytes(out)


def _png(size: int, rgba: bytes) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw += b"\x00"  # filter: none
        raw += rgba[y * stride : (y + 1) * stride]
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def build_ico() -> bytes:
    images = [_png(s, _render(s)) for s in SIZES]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)
    entries, blob = b"", b""
    for size, data in zip(SIZES, images):
        entries += struct.pack(
            "<BBBBHHII",
            0 if size == 256 else size,  # 0 means 256 in this format
            0 if size == 256 else size,
            0,
            0,
            1,
            32,
            len(data),
            offset,
        )
        blob += data
        offset += len(data)
    return header + entries + blob


# --- Preflight: nothing may be running out of the folder we are about to wipe
#
# Windows locks the DLLs of a loaded process, so re-staging the runtime while
# the app is up fails on python\vcruntime140.dll. Over drvfs that surfaces as a
# bare OSError: [Errno 5], which reads like a broken filesystem rather than
# "the app is open" -- hence this check.

PS_DIRS = (
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0",
    "/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0",
)


def _powershell_available() -> bool:
    return not IS_WSL or any(Path(d, "powershell.exe").exists() for d in PS_DIRS)


def _powershell(script: str, timeout: int = 30) -> str:
    """Run a snippet on the Windows side. Empty string if that did not work."""
    if not _powershell_available():
        return ""
    try:
        res = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-Command",
                # On a localized Windows the error text comes back in the OEM
                # codepage: ask for UTF-8, and never let a stray byte raise here.
                "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " + script,
            ],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return res.stdout if res.returncode == 0 else ""


def running_from(py_dir_win: str) -> list[int]:
    """PIDs of interpreters started from py_dir_win -- those hold the locks."""
    out = _powershell(
        "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe' or Name='python.exe'\""
        ' | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }'
    )
    prefix = py_dir_win.lower().rstrip("\\") + "\\"
    pids = []
    for line in out.splitlines():
        pid, _, exe = line.strip().partition("|")
        if exe.lower().startswith(prefix) and pid.isdigit():
            pids.append(int(pid))
    return pids


def _quit_request() -> str:
    """POST /api/quit. Empty string on success, else a short reason.

    The request has to leave from the Windows side: the helper binds 127.0.0.1
    there, which under WSL2's NAT networking is not the loopback we see here.
    """
    url = f"http://127.0.0.1:{PORT}/api/quit"
    if IS_WINDOWS:
        try:
            urllib.request.urlopen(
                urllib.request.Request(url, method="POST"), timeout=5
            ).read()
            return ""
        except urllib.error.HTTPError as exc:
            return f"HTTP {exc.code}"
        except OSError as exc:
            return str(exc)
    out = _powershell(
        "try { Invoke-WebRequest -UseBasicParsing -Method POST -TimeoutSec 5 -Uri "
        f"'{url}' | Out-Null; 'ok' }} catch {{ \"fail $($_.Exception.Message)\" }}"
    ).strip()
    if out == "ok":
        return ""
    return out[5:] if out.startswith("fail ") else "could not reach it"


def ensure_not_running(py_dir_win: str) -> None:
    pids = running_from(py_dir_win)
    if not pids:
        return
    listed = ", ".join(str(p) for p in pids)
    print(f"  {APP_NAME} is running from {py_dir_win} (PID {listed}); asking it to quit")
    reason = _quit_request()
    if not reason:
        for _ in range(20):
            time.sleep(0.25)
            if not running_from(py_dir_win):
                print("  stopped")
                return
        reason = "it did not exit"
    pids = running_from(py_dir_win) or pids
    listed = ", ".join(str(p) for p in pids)
    raise SystemExit(
        f"\n{APP_NAME} is running -- quit it first, then re-run.\n"
        f"  Its files are locked, so the runtime cannot be re-staged.\n"
        f"  /api/quit did not work: {reason}\n"
        f"  Try:  taskkill.exe /PID {listed.replace(', ', ' /PID ')} /F"
    )


# --- Embeddable Python -----------------------------------------------------


def fetch_embed_zip(version: str) -> Path:
    url = f"https://www.python.org/ftp/python/{version}/python-{version}-embed-amd64.zip"
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dest = CACHE_DIR / f"python-{version}-embed-amd64.zip"
    if dest.exists() and dest.stat().st_size > 1_000_000:
        print(f"  cached {dest.name} ({dest.stat().st_size // 1024} KB)")
        return dest
    print(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "checklist-proto-build"})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            blob = resp.read()
    except Exception as exc:
        raise SystemExit(f"download failed: {exc}\nFetch it manually and save as: {dest}")
    dest.write_bytes(blob)
    print(f"  saved {dest.name} ({len(blob) // 1024} KB)")
    return dest


def install_python(zip_path: Path, py_dir: Path, app_dir_win: str) -> None:
    if py_dir.exists():
        try:
            for p in sorted(py_dir.rglob("*"), reverse=True):
                p.unlink() if p.is_file() else p.rmdir()
            py_dir.rmdir()
        except OSError as exc:
            raise SystemExit(
                f"\ncould not clear {py_dir}: {exc}\n"
                f"  Something has {getattr(exc, 'filename', '?')} open -- close any running\n"
                f"  {APP_NAME}, Explorer window, or terminal sitting in that folder."
            )
    py_dir.mkdir(parents=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(py_dir)

    # An embeddable distro pins sys.path via python3XX._pth and skips site.py.
    # serve.py is stdlib-only today; adding the app dir keeps future local
    # imports working rather than failing mysteriously later.
    for pth in py_dir.glob("python*._pth"):
        text = pth.read_text(encoding="utf-8")
        if app_dir_win not in text:
            pth.write_text(text.rstrip("\n") + "\n" + app_dir_win + "\n", encoding="utf-8")
        print(f"  patched {pth.name}")


# --- Launcher + shortcut ---------------------------------------------------

BAT = """@echo off
rem Generated by prototype/install/make_windows_bundle.py -- do not edit by hand.
rem Fallback launcher, with a console window so errors are visible.
rem The desktop shortcut is the normal way in.
"%~dp0python\\python.exe" "{server}" --folder "{folder}"
pause
"""

PS1 = """$ErrorActionPreference = 'Stop'
$target    = '{pythonw}'
$arguments = '"{server}" --folder "{folder}"'
$icon      = '{icon}'
$workdir   = '{workdir}'
$shell     = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), $workdir)) {{
    $lnk = Join-Path $dir '{name}.lnk'
    $s = $shell.CreateShortcut($lnk)
    $s.TargetPath        = $target
    $s.Arguments         = $arguments
    $s.IconLocation      = $icon
    $s.WorkingDirectory  = $workdir
    $s.Description       = 'Checklist sync prototype - opens in your browser'
    $s.Save()
    Write-Output "  shortcut: $lnk"
}}
"""


def make_shortcuts(ps1_win: str) -> None:
    if not _powershell_available():
        print("  ! powershell.exe not found; skipping shortcut")
        print(f"    run it yourself: powershell -ExecutionPolicy Bypass -File {ps1_win}")
        return
    try:
        res = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1_win],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"  ! could not run powershell ({exc}); skipping shortcut")
        return
    if res.returncode != 0:
        print(f"  ! shortcut creation failed:\n{res.stderr.strip()}")
        return
    print(res.stdout.rstrip())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--folder",
        required=True,
        help=r"the shared folder your cloud client syncs, e.g. C:\Users\You\Dropbox\checklist",
    )
    ap.add_argument("--target", default=DEFAULT_TARGET, help=f"where the runtime goes (default: {DEFAULT_TARGET})")
    ap.add_argument("--python-version", default=PYTHON_VERSION)
    ap.add_argument("--no-shortcut", action="store_true")
    args = ap.parse_args()

    if not (IS_WINDOWS or IS_WSL):
        print("This builds a Windows launcher; run it on Windows or WSL.", file=sys.stderr)
        return 1

    target_win = args.target.rstrip("\\")
    target_local = to_local_path(target_win)
    app_dir_win = to_windows_path(PROTOTYPE)
    server_win = to_windows_path(PROTOTYPE / "install" / "serve.py")
    folder_win = args.folder.rstrip("\\")

    # Fail here rather than at first launch, when the error is a browser tab
    # showing an empty folder and no clue why.
    to_local_path(folder_win)

    print(f"app:    {app_dir_win}")
    print(f"folder: {folder_win}")
    print(f"target: {target_win}")
    if app_dir_win.startswith("\\\\wsl"):
        print("        (code stays in WSL; the shortcut reaches it over \\\\wsl.localhost)")

    target_local.mkdir(parents=True, exist_ok=True)

    print("python runtime:")
    py_dir = target_local / "python"
    if py_dir.exists():
        ensure_not_running(f"{target_win}\\python")
    install_python(fetch_embed_zip(args.python_version), py_dir, app_dir_win)

    icon_local = target_local / "checklist.ico"
    icon_local.write_bytes(build_ico())
    print(f"icon:   {icon_local.name} ({icon_local.stat().st_size // 1024} KB)")

    (target_local / f"{APP_NAME}.bat").write_text(
        BAT.format(server=server_win, folder=folder_win), encoding="utf-8"
    )

    ps1_local = target_local / "make_shortcut.ps1"
    ps1_local.write_text(
        PS1.format(
            pythonw=f"{target_win}\\python\\pythonw.exe",
            server=server_win,
            folder=folder_win,
            icon=f"{target_win}\\checklist.ico",
            workdir=target_win,
            name=APP_NAME,
        ),
        encoding="utf-8",
    )
    if not args.no_shortcut:
        print("shortcuts:")
        make_shortcuts(f"{target_win}\\make_shortcut.ps1")

    print(f"\ndone. Launch '{APP_NAME}' from the desktop; it opens http://localhost:{PORT}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
