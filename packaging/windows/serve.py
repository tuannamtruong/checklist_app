#!/usr/bin/env python3
"""Serve the app to THIS device's own browser, and hand it the shared folder.

    python3 serve.py --folder ~/Dropbox/checklist
    python3 serve.py --folder "C:\\Users\\Nam\\Dropbox\\checklist"

Python 3 stdlib only, and it stays that way: that is what lets the bundle stage
an official embeddable Python and run with no installer, no pip and no admin
rights -- architecture.md 7.1.

It binds 127.0.0.1 on purpose. No other device can reach it and no device ever
syncs *through* it: two devices could run different helpers, or none, and still
converge, because the only thing they share is the folder.

Two reasons this process exists at all:

  1. Browsers refuse both ES modules and a service worker on file://. A secure
     context means https:// or http://localhost, so the page has to be served.
  2. Firefox has no File System Access API and is not getting one, so on that
     browser the folder must be handed over by something already trusted with
     it -- which is the process the user launched.

The folder API is exactly the three methods of architecture.md 4, spelled as
HTTP because that is what a page can call: list, read, write. It is the other
side of src/adapters/http-folder.ts and it grows no fourth method.

/shell/open is beside that API rather than part of it -- architecture.md 4.1. It
opens the folder in the desktop's file manager and starts the cloud client, both
of which are things a page cannot do and neither of which the sync path calls.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

APP_ROOT = Path(__file__).resolve().parent
# The web build, as `make windows` stages it beside this file.
WEB_ROOT = APP_ROOT / "web"
DEFAULT_PORT = 38531

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}

# Path segments the folder API accepts. Deliberately narrow, and wide enough for
# `checklist.<device-id>.ops.jsonl` plus anything the adapter conformance suite
# asks of a folder.
SEGMENT = re.compile(r"^[A-Za-z0-9._-]{1,120}$")

# --------------------------------------------------------------- the shell

# X-15 and X-17 -- architecture.md 4.1. The page may ask for two things beyond
# the folder API: show me the folder, and start the cloud client.
#
# It names a *command*, never a path, and the pattern is the same narrow one the
# folder API uses. The command is resolved on PATH and run with no arguments and
# no shell, so the page can say what to start and can never say where to start it
# from. The one path this endpoint will ever open is the folder, which came from
# --folder on the command line rather than from the page.
COMMAND = re.compile(r"^[A-Za-z0-9._-]{1,40}$")


def open_with_desktop(target: str) -> None:
    """Hand a folder to whatever this desktop opens folders with."""
    if os.name == "nt":
        os.startfile(target)  # type: ignore[attr-defined]  # Windows only
        return
    for cmd in (["xdg-open", target], ["explorer.exe", target], ["open", target]):
        try:
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except OSError:
            continue
    raise FolderError(500, "no file manager on this desktop")


def start_app(command: str) -> None:
    if not COMMAND.match(command):
        raise FolderError(400, f"bad command: {command!r}")
    found = shutil.which(command)
    if found is None:
        # Not an error in the app: the client is simply not installed here, or
        # not on PATH, and the page says so rather than showing a status.
        raise FolderError(404, f"{command} was not found on this device")
    try:
        subprocess.Popen([found], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as exc:
        raise FolderError(500, f"could not start {command}: {exc}") from exc


SERVER: ThreadingHTTPServer | None = None
VERBOSE = False


# --------------------------------------------------------------- the folder


class FolderError(Exception):
    """Rejected before touching the disk. Carries the HTTP status to return."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class Folder:
    """list / read / write over one directory, and nothing else.

    Every name is validated segment by segment, and the resolved result is then
    checked to be inside the root -- which catches what the segment rules miss,
    a symlink pointing out of the tree most of all.
    """

    def __init__(self, root: Path):
        self.root = root.resolve()

    def resolve(self, rel: str) -> Path:
        if not rel or rel.startswith("/") or "\\" in rel:
            raise FolderError(400, f"bad name: {rel!r}")
        parts = rel.split("/")
        if not all(SEGMENT.match(p) and p not in (".", "..") for p in parts):
            raise FolderError(400, f"bad name: {rel!r}")
        target = (self.root / rel).resolve()
        if target != self.root and self.root not in target.parents:
            raise FolderError(400, f"outside the folder: {rel!r}")
        return target

    def list(self, prefix: str = "") -> list[dict]:
        if not self.root.exists():
            return []
        out = []
        for path in sorted(self.root.iterdir()):
            if not path.is_file() or path.name.startswith("."):
                continue
            if path.name.startswith(prefix):
                out.append({"path": path.name})
        return out

    def read(self, rel: str) -> bytes | None:
        path = self.resolve(rel)
        try:
            return path.read_bytes()
        except (FileNotFoundError, IsADirectoryError):
            return None
        except OSError:
            # Mid-download from the provider's client reads as an error here.
            # One skipped cycle; the next poll takes it whole -- S-7.
            return None

    def write(self, rel: str, data: bytes) -> None:
        path = self.resolve(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write-then-rename, which is S-8's half of the bargain on this side: a
        # provider's client watching the folder must never see a partial file
        # and upload it. os.replace is atomic on both POSIX and Windows.
        tmp = path.with_name(f".{path.name}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)


# -------------------------------------------------------------- the handler


class Handler(BaseHTTPRequestHandler):
    server_version = "checklist-helper"
    folder: Folder | None = None

    def log_message(self, fmt, *args):  # noqa: A003 - stdlib signature
        if VERBOSE:
            super().log_message(fmt, *args)

    def _send(self, status: int, ctype: str, body: bytes, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, payload) -> None:
        self._send(status, MIME[".json"], json.dumps(payload).encode())

    def _same_origin(self) -> bool:
        """Refuse folder calls from any page that is not the one we served.

        PUT is already blocked cross-origin -- it is preflighted and we answer
        no preflight. GET is not, so without this any page in the browser could
        probe the folder. It could not read the reply without CORS, but there is
        no reason to answer at all.
        """
        origin = self.headers.get("Origin")
        if origin is None:
            return True  # same-origin GETs and non-browser callers send none
        return urlparse(origin).netloc == self.headers.get("Host", "")

    def _folder(self) -> Folder:
        if Handler.folder is None:
            raise FolderError(409, "no folder configured; start with --folder <dir>")
        return Handler.folder

    def _route(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path.startswith("/folder/") or path.startswith("/shell/") or path == "/api/quit":
            if not self._same_origin():
                return self._json(403, {"error": "cross-origin request refused"})

        try:
            if path == "/folder/info":
                return self._info()
            if path == "/folder/list":
                prefix = parse_qs(parsed.query).get("prefix", [""])[0]
                return self._json(200, self._folder().list(prefix))
            if path.startswith("/folder/file/"):
                return self._file(path[len("/folder/file/") :])
            if path == "/shell/open":
                return self._open()
            if path == "/api/quit":
                return self._quit()
        except FolderError as err:
            return self._json(err.status, {"error": str(err)})
        except OSError as err:
            return self._json(500, {"error": str(err)})

        return self._static(path)

    def _info(self) -> None:
        """The one question startup asks -- architecture.md 4's flowchart."""
        if Handler.folder is None:
            return self._json(200, {"configured": False})
        root = Handler.folder.root
        # The folder's own name, never a path assembled here -- code-standard 1.
        self._json(200, {"configured": True, "name": root.name})

    def _file(self, rel: str) -> None:
        folder = self._folder()

        if self.command in ("GET", "HEAD"):
            data = folder.read(rel)
            if data is None:
                # `null` rather than an error: an absent file is the normal
                # state of a peer this device has not met.
                return self._json(404, {"error": "not found"})
            return self._send(200, "application/octet-stream", data)

        if self.command == "PUT":
            length = int(self.headers.get("Content-Length") or 0)
            folder.write(rel, self.rfile.read(length) if length else b"")
            return self._json(200, {"ok": True})

        self._json(405, {"error": "method not allowed"})

    def _open(self) -> None:
        """X-15 and X-17: the folder, or the cloud client, whichever was asked."""
        if self.command != "POST":
            return self._json(405, {"error": "method not allowed"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            asked = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            raise FolderError(400, "not JSON") from None
        if not isinstance(asked, dict):
            raise FolderError(400, "not an object")

        what = asked.get("what")
        if what == "folder":
            open_with_desktop(str(self._folder().root))
            return self._json(200, {"ok": True})
        if what == "app":
            start_app(str(asked.get("command", "")))
            return self._json(200, {"ok": True})
        raise FolderError(400, f"nothing to open: {what!r}")

    def _quit(self) -> None:
        if self.command != "POST":
            return self._json(405, {"error": "method not allowed"})
        self._json(200, {"ok": True})
        # shutdown() blocks until serve_forever() returns, and serve_forever is
        # what is waiting on this very request. It has to happen elsewhere.
        if SERVER is not None:
            threading.Thread(target=SERVER.shutdown, daemon=True).start()

    def _static(self, path: str) -> None:
        rel = "index.html" if path == "/" else path.lstrip("/")
        target = (WEB_ROOT / rel).resolve()
        if WEB_ROOT not in target.parents or not target.is_file():
            return self._json(404, {"error": "not found"})
        ctype = MIME.get(target.suffix, "application/octet-stream")
        self._send(200, ctype, target.read_bytes())

    do_GET = do_HEAD = do_PUT = do_POST = _route


# ------------------------------------------------------------------ startup


def already_running(port: int) -> bool:
    """Double-clicking the launcher twice should reopen the app, not die."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.25)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def is_wsl() -> bool:
    if os.name == "nt":
        return False
    try:
        return "microsoft" in Path("/proc/version").read_text().lower()
    except OSError:
        return False


def open_browser(url: str) -> None:
    # Under WSL there is no browser on PATH, and webbrowser.open still reports
    # success while the underlying call fails -- so the fallbacks below would
    # never run. Hand the URL to Windows directly instead.
    if not is_wsl() and webbrowser.open(url):
        return
    for cmd in (["wslview", url], ["explorer.exe", url], ["xdg-open", url]):
        try:
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except OSError:
            continue


def windows_path_to_local(value: str) -> str:
    """Accept C:\\Users\\... even under WSL, so the shortcut and the shell can
    be given the same argument."""
    match = re.match(r"^([A-Za-z]):[\\/](.*)$", value)
    if match and os.name != "nt":
        return f"/mnt/{match.group(1).lower()}/" + match.group(2).replace("\\", "/")
    return value


def main(argv: list[str] | None = None) -> int:
    global SERVER, VERBOSE

    parser = argparse.ArgumentParser(description="Checklist helper")
    parser.add_argument("--folder", help="the shared folder your cloud client keeps in sync")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    VERBOSE = args.verbose
    url = f"http://localhost:{args.port}/"

    if not WEB_ROOT.is_dir():
        print(f"no web assets beside this file: expected {WEB_ROOT}", file=sys.stderr)
        return 1

    if already_running(args.port):
        print(f"already running: {url}")
        if not args.no_browser:
            open_browser(url)
        return 0

    if args.folder:
        root = Path(windows_path_to_local(args.folder)).expanduser()
        root.mkdir(parents=True, exist_ok=True)
        Handler.folder = Folder(root)

    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as exc:  # lost the race, or the port belongs to something else
        print(f"cannot bind port {args.port}: {exc}", file=sys.stderr)
        return 1
    SERVER = server

    # flush: stdout is block-buffered when it is a pipe, so a launcher or a test
    # waiting on this banner would otherwise wait forever.
    print(f"checklist: {url}  (this device only)", flush=True)
    if Handler.folder:
        print(f"  folder: {Handler.folder.root.name}   works in any browser", flush=True)
    else:
        print("  no --folder: Chrome and Edge can pick one in the page; Firefox cannot", flush=True)

    if not args.no_browser:
        open_browser(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping")
    server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
