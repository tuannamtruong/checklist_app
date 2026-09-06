#!/bin/sh
# The Windows half of 127.0.0.1:38531, which WSL cannot see.
#
#   scripts/win-port.sh note   name a Windows process holding the port
#   scripts/win-port.sh stop   close ours, name anything else
#
# Under WSL the two halves of 127.0.0.1 are two namespaces. The Windows bundle's
# serve.py can hold the port on the Windows side while vite binds it here — both
# succeed — and a browser on Windows is then served whatever `make windows` last
# staged into that bundle's web/, never this server. lsof and ss cannot see
# across, so this asks Windows instead.
#
# Only our own helper is ever closed, and it is identified by its command line
# rather than by its image name: pythonw.exe is any number of other programs.
# Anything else on the port is named and left alone.
#
# Silent and successful anywhere that is not WSL, so a Makefile can depend on it
# unconditionally.
set -eu

MODE="${1:-note}"
PORT="${PORT:-38531}"

grep -qi microsoft /proc/version 2>/dev/null || exit 0
command -v netstat.exe >/dev/null 2>&1 || exit 0

# A listening socket, matched by its 0.0.0.0:0 peer: the status column is
# localised, so the word for "listening" is not something to match on.
win_pids() {
  netstat.exe -ano 2>/dev/null | tr -d '\r' |
    awk -v port=":$PORT" '$1 == "TCP" && index($2, port) == length($2) - length(port) + 1 &&
      $3 == "0.0.0.0:0" { print $5 }' | sort -u
}

# pid|name|command line, one line per pid, in a single PowerShell start-up.
describe() {
  filter=""
  for pid in $1; do
    [ -n "$filter" ] && filter="$filter or "
    filter="${filter}ProcessId=$pid"
  done
  [ -n "$filter" ] || return 0
  powershell.exe -NoProfile -NonInteractive -Command \
    "Get-CimInstance Win32_Process -Filter '$filter' | ForEach-Object { \$_.ProcessId.ToString() + '|' + \$_.Name + '|' + \$_.CommandLine }" \
    2>/dev/null | tr -d '\r'
}

pids=$(win_pids)
[ -n "$pids" ] || exit 0

# wslrelay.exe is this very server's forwarder onto the Windows side, so it is
# never a clash with it.
rows=$(describe "$pids" | grep -v '|wslrelay\.exe|' | grep -v '|wslhost\.exe|' || true)
[ -n "$rows" ] || exit 0

# printf, not echo: /bin/sh here is dash, and a Windows path is full of
# backslash escapes — `\c` in `...\checklist-windows\...` ends echo's output
# outright, which is a whole holder silently unreported.
printf '%s\n' "$rows" | while IFS='|' read -r pid name cmd; do
  [ -n "$pid" ] || continue
  case "$cmd" in
    *serve.py*[Cc]hecklist* | *[Cc]hecklist*serve.py*)
      if [ "$MODE" = stop ]; then
        taskkill.exe /PID "$pid" /F >/dev/null 2>&1 || true
        printf 'closed the Checklist helper on the Windows side (%s, PID %s)\n' "$name" "$pid"
      else
        printf 'note: the Checklist helper (%s, PID %s) holds 127.0.0.1:%s on the Windows side.\n' "$name" "$pid" "$PORT"
        printf '  A browser on Windows is served by that, not by this server. `make dev` closes it;\n'
        printf '  `make preview` and `make ui-smoke` leave it alone.\n'
      fi
      ;;
    *)
      printf 'note: %s (PID %s) holds 127.0.0.1:%s on the Windows side, and is not ours to close.\n' \
        "$name" "$pid" "$PORT"
      printf '  A browser on Windows is served by that, not by this server.\n'
      ;;
  esac
done

# The relay only takes the port over once Windows has released it, and vite is
# started the moment this returns.
if [ "$MODE" = stop ]; then
  i=0
  while [ "$i" -lt 20 ]; do
    still=$(describe "$(win_pids)" | grep -v '|wslrelay\.exe|' | grep -v '|wslhost\.exe|' || true)
    [ -n "$still" ] || break
    sleep 0.25
    i=$((i + 1))
  done
fi
exit 0
