#!/usr/bin/env python3
"""Serve the app to THIS device's own browser, and hand it the shared folder.

    python3 serve.py --folder ~/Dropbox/checklist
    python3 serve.py --folder "C:\\Users\\Nam\\Dropbox\\checklist" --port 36637

Python 3 stdlib only. No pip, ever -- that is what lets the Windows launcher
stage an embeddable Python and run this with no installer (docs/platforms.md
§3.1).

It binds 127.0.0.1 on purpose: no other device can reach it, and no device ever
syncs *through* it. Two devices could run different helpers, or none, and still
converge -- the only thing they share is the folder.

Two reasons this process exists at all:

  1. Browsers refuse both ES modules and the File System Access API on file://.
     A secure context means https:// or http://localhost.
  2. Firefox and Safari have no File System Access API and are not getting one,
     so on those the folder must be handed over by something already trusted
     with it.

The folder API deliberately mirrors `RemoteStore` in src/sync/remote-store.ts
-- list/read/write/remove over *paths*, returning FileMeta -- rather than the
flat three-method shape the prototype needs today. Writing it to the smaller
interface would buy a rewrite the moment the op log arrives.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs

APP_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PORT = 5175

MIME = {
    ".html": "text/html; charset=utf-8",
    # .mjs is the one that matters: a module script served as anything but a
    # JavaScript type is refused outright, and the app fails to boot.
    ".mjs": "text/javascript; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

# Path segments the folder API will accept. Deliberately narrow: it has to
# cover today's `checklist.<device>.json` and the op log's
# `ops/<deviceId>/<seq>.jsonl`, and nothing else.
SEGMENT = re.compile(r"^[A-Za-z0-9._-]{1,80}$")

SERVER: ThreadingHTTPServer | None = None


# --------------------------------------------------------------- the folder


class FolderError(Exception):
    """Rejected before touching the disk. Carries the HTTP status to return."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class Folder:
    """list / read / write / remove over one directory tree.

    Every path is relative and validated segment by segment. The resolved
    result is then checked to be inside the root, which catches anything the
    segment rules missed -- a symlink pointing out of the tree, most of all.
    """

    def __init__(self, root: Path):
        self.root = root.resolve()

    def resolve(self, rel: str) -> Path:
        if not rel or rel.startswith("/") or "\\" in rel:
            raise FolderError(400, f"bad path: {rel!r}")
        parts = rel.split("/")
        if not all(SEGMENT.match(p) and p not in (".", "..") for p in parts):
            raise FolderError(400, f"bad path: {rel!r}")

        target = (self.root / rel).resolve()
        # `resolve()` follows symlinks, so this rejects a link out of the tree
        # as well as any traversal the segment check let through.
        if target != self.root and self.root not in target.parents:
            raise FolderError(400, f"outside the folder: {rel!r}")
        return target

    def meta(self, path: Path) -> dict:
        st = path.stat()
        return {
            "path": path.relative_to(self.root).as_posix(),
            "size": st.st_size,
            # Opaque by contract: compared, never parsed. mtime alone is too
            # coarse -- a write within the same nanosecond tick that changes
            # length still has to look different.
            "rev": f"{st.st_mtime_ns}-{st.st_size}",
            "modified": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
        }

    def list(self, prefix: str = "") -> list[dict]:
        if not self.root.exists():
            return []
        out = []
        for path in sorted(self.root.rglob("*")):
            if not path.is_file() or path.name.startswith("."):
                continue
            rel = path.relative_to(self.root).as_posix()
            if rel.startswith(prefix):
                out.append(self.meta(path))
        return out

    def read(self, rel: str) -> bytes | None:
        path = self.resolve(rel)
        try:
            return path.read_bytes()
        except (FileNotFoundError, IsADirectoryError):
            return None
        except OSError:
            # Mid-download from the sync client reads as an error. One skipped
            # cycle; the next poll picks it up whole.
            return None

    def write(self, rel: str, data: bytes) -> dict:
        path = self.resolve(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write-then-rename. A sync client watching the folder must never see a
        # half-written file and upload it; os.replace is atomic on both POSIX
        # and Windows.
        tmp = path.with_name(f".{path.name}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)
        return self.meta(path)

    def remove(self, rel: str) -> None:
        path = self.resolve(rel)
        try:
            path.unlink()
        except FileNotFoundError:
            pass  # removing what is not there is the state the caller wanted


# -------------------------------------------------------------- the handler


class Handler(BaseHTTPRequestHandler):
    server_version = "checklist-helper"
    folder: Folder | None = None
    folder_arg: str | None = None

    def log_message(self, fmt, *args):  # noqa: A003 - stdlib signature
        if VERBOSE:
            super().log_message(fmt, *args)

    # -- replies

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

    # -- guards

    def _same_origin(self) -> bool:
        """Reject folder calls from any page that is not the one we served.

        PUT and DELETE are already blocked cross-origin -- they are preflighted
        and we answer no preflight. GET is not, so without this any page in the
        browser could probe the folder. It could not *read* the reply without
        CORS, but there is no reason to answer at all.
        """
        origin = self.headers.get("Origin")
        if origin is None:
            return True  # same-origin GETs and non-browser callers send none
        host = self.headers.get("Host", "")
        return urlparse(origin).netloc == host

    def _folder(self) -> Folder:
        if Handler.folder is None:
            raise FolderError(409, "no folder configured; start with --folder <dir>")
        return Handler.folder

    # -- routes

    def _route(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path.startswith("/folder/") or path == "/api/quit":
            if not self._same_origin():
                return self._json(403, {"error": "cross-origin request refused"})

        try:
            if path == "/folder/info":
                return self._info()
            if path == "/folder/list":
                prefix = parse_qs(parsed.query).get("prefix", [""])[0]
                return self._json(200, self._folder().list(prefix))
            if path.startswith("/folder/file/"):
                return self._file(path[len("/folder/file/"):])
            if path == "/api/quit":
                return self._quit()
        except FolderError as err:
            return self._json(err.status, {"error": str(err)})
        except OSError as err:
            return self._json(500, {"error": str(err)})

        return self._static(path)

    def _info(self) -> None:
        if Handler.folder is None:
            return self._json(200, {"configured": False})
        root = Handler.folder.root
        self._json(200, {
            "configured": True,
            "name": root.name,
            "path": Handler.folder_arg or str(root),
            "exists": root.exists(),
        })

    def _file(self, rel: str) -> None:
        folder = self._folder()

        if self.command in ("GET", "HEAD"):
            data = folder.read(rel)
            if data is None:
                return self._json(404, {"error": "not found"})
            meta = folder.meta(folder.resolve(rel))
            return self._send(200, "application/octet-stream", data, {"ETag": meta["rev"]})

        if self.command == "PUT":
            length = int(self.headers.get("Content-Length") or 0)
            data = self.rfile.read(length) if length else b""
            return self._json(200, folder.write(rel, data))

        if self.command == "DELETE":
            folder.remove(rel)
            return self._json(200, {"ok": True})

        self._json(405, {"error": "method not allowed"})

    def _quit(self) -> None:
        if self.command != "POST":
            return self._json(405, {"error": "method not allowed"})
        self._json(200, {"ok": True})
        # shutdown() blocks until serve_forever() returns, and serve_forever is
        # what is waiting on this very request. It has to happen elsewhere.
        if SERVER is not None:
            threading.Thread(target=SERVER.shutdown, daemon=True).start()

    def _static(self, path: str) -> None:
        rel = "public/index.html" if path == "/" else path.lstrip("/")
        target = (APP_ROOT / rel).resolve()
        if APP_ROOT not in target.parents or not target.is_file():
            return self._json(404, {"error": "not found"})
        ctype = MIME.get(target.suffix, "application/octet-stream")
        self._send(200, ctype, target.read_bytes())

    do_GET = do_HEAD = do_PUT = do_POST = do_DELETE = _route


# ------------------------------------------------------------------ startup


VERBOSE = False


def already_running(port: int) -> bool:
    """True if something is already listening. Double-clicking the launcher a
    second time should reopen the app, not die on 'address already in use'."""
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
    # success while gio prints a failure -- so the fallback below would never
    # run. Hand the URL to Windows directly instead.
    if not is_wsl() and webbrowser.open(url):
        return
    for cmd in (["wslview", url], ["explorer.exe", url], ["xdg-open", url]):
        try:
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except OSError:
            continue


def windows_path_to_local(value: str) -> str:
    """Accept C:\\Users\\... even when running under WSL, so the shortcut and
    the shell can be given the same argument."""
    match = re.match(r"^([A-Za-z]):[\\/](.*)$", value)
    if match and os.name != "nt":
        return f"/mnt/{match.group(1).lower()}/" + match.group(2).replace("\\", "/")
    return value


def main(argv: list[str] | None = None) -> int:
    global SERVER, VERBOSE

    parser = argparse.ArgumentParser(description="Checklist sync helper")
    parser.add_argument("--folder", help="the shared folder your sync client keeps")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    VERBOSE = args.verbose
    url = f"http://localhost:{args.port}/"

    if already_running(args.port):
        print(f"already running: {url}")
        if not args.no_browser:
            open_browser(url)
        return 0

    if args.folder:
        root = Path(windows_path_to_local(args.folder)).expanduser()
        root.mkdir(parents=True, exist_ok=True)
        Handler.folder = Folder(root)
        Handler.folder_arg = str(root)

    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as exc:  # lost the race, or the port belongs to something else
        print(f"cannot bind port {args.port}: {exc}", file=sys.stderr)
        return 1
    SERVER = server

    # flush: stdout is block-buffered when it is a pipe, so a launcher or a
    # test waiting on this banner would otherwise wait forever.
    print(f"checklist helper: {url}  (this device only)", flush=True)
    if Handler.folder:
        print(f"  folder: {Handler.folder.root}   works in any browser", flush=True)
    else:
        print("  no --folder: Chrome/Edge can pick one in the page; Firefox/Safari cannot", flush=True)

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
