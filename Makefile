# The app.
#
#   make dev               the app on 127.0.0.1:38531, hot reload
#   make build             production bundle -> dist/
#
# `make help` lists the rest.

.PHONY: help install dev build preview test check verify seed ui-smoke docs clean \
        stop port-check win-port-note win-port-stop windows apk apk-clean
.DEFAULT_GOAL := help

# Port 38531 is this project's, pinned in vite.config.ts for dev and preview
# alike. strictPort is deliberate — the http-folder adapter's origin has to be
# the same in development as in the bundle — so a leftover server is a hard
# failure rather than a silent move to another port. Hence port-check and stop.
PORT ?= 38531

# The PIDs listening on $(PORT), or empty. Both branches are read-only, and ss
# covers a machine without lsof. Used inside recipes, so the $$ is make's.
PORT_PIDS = $$(lsof -ti tcp:$(PORT) -sTCP:LISTEN 2>/dev/null || \
	ss -lptnH "sport = :$(PORT)" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2)

# Playwright lives outside the project on this machine, so seed and ui-smoke
# need it on NODE_PATH. Override if it moves.
PLAYWRIGHT_MODULES ?= /home/nam/.npm/_npx/e41f203b7505f1fb/node_modules

# printf, not echo: /bin/sh here is dash, whose echo eats backslash escapes.
help:
	@printf '%s\n' \
	  "  make dev           - dev server on 127.0.0.1:$(PORT), hot reload" \
	  "  make build         - production bundle -> dist/" \
	  "  make preview       - build, then serve dist/ on 127.0.0.1:$(PORT)" \
	  "  make test          - vitest over src/**/*.test.ts" \
	  "  make check         - svelte-check, strict TypeScript" \
	  "  make verify        - check + test + ui-smoke + docs, in that order" \
	  "  make seed          - the app in a window with a small tree in it" \
	  "  make ui-smoke      - the built app in Chromium; shots -> ui-smoke/" \
	  "  make docs          - docs reflowed to 120 columns (--check)" \
	  "" \
	  "  packaging - architecture.md §7; both take dist/ as input, output -> bundles/" \
	  "  make windows       - checklist-windows.zip: web assets, the helper, a shortcut" \
	  "  make apk           - checklist.apk, built in Docker" \
	  "  make apk-clean     - drop the Android build output and the Gradle cache" \
	  "" \
	  "  make stop          - free port $(PORT): kill whatever is listening on it" \
	  "  make win-port-stop - WSL: close the Checklist helper on the Windows side" \
	  "  make install       - npm ci" \
	  "  make clean         - remove dist/, ui-smoke/ and bundles/"

# Deliberately not a prerequisite of anything: `npm ci` throws node_modules away
# and takes a minute, which is not what `make dev` should do to a working tree.
install:
	npm ci

# Every target below that binds the port runs this first, so an orphaned server
# — usually one a seed or ui-smoke run left behind — is named here rather than
# reaching you as vite's bare "Port 38531 is already in use".
port-check: win-port-note
	@pids=$(PORT_PIDS); \
	if [ -n "$$pids" ]; then \
	  printf 'port %s is already taken, and vite pins it:\n' '$(PORT)'; \
	  for pid in $$pids; do ps -o pid=,etime=,args= -p $$pid | sed 's/^/  /'; done; \
	  printf 'free it with: make stop\n'; \
	  exit 1; \
	fi

# The Windows half of the port, which lsof and ss cannot see — scripts/win-port.sh
# says why. `note` only names a holder; `stop` closes our own helper and names
# anything else. Both are silent and successful off WSL, so every target below
# can depend on them unconditionally.
win-port-note:
	@PORT=$(PORT) sh scripts/win-port.sh note

win-port-stop:
	@PORT=$(PORT) sh scripts/win-port.sh stop

# SIGTERM first, and only then SIGKILL: a vite preview holding the port has
# nothing unsaved, but the same target will happily be pointed at a dev server.
stop: win-port-note
	@pids=$(PORT_PIDS); \
	if [ -z "$$pids" ]; then printf 'port %s is already free\n' '$(PORT)'; exit 0; fi; \
	for pid in $$pids; do \
	  ps -o pid=,args= -p $$pid | sed 's/^/stopping /'; \
	  kill $$pid 2>/dev/null || true; \
	done; \
	for i in 1 2 3 4 5 6 7 8 9 10; do \
	  sleep 0.5; \
	  if [ -z "$(PORT_PIDS)" ]; then break; fi; \
	done; \
	pids=$(PORT_PIDS); \
	if [ -n "$$pids" ]; then \
	  printf 'still listening after 5s, sending SIGKILL\n'; \
	  for pid in $$pids; do kill -9 $$pid 2>/dev/null || true; done; \
	  sleep 1; \
	fi; \
	pids=$(PORT_PIDS); \
	if [ -n "$$pids" ]; then printf 'port %s is still taken by: %s\n' '$(PORT)' "$$pids"; exit 1; fi; \
	printf 'port %s is free\n' '$(PORT)'

# win-port-stop first, and only then port-check: the Windows listener has to be
# gone before vite binds, or WSL's forwarder never takes the port over on the
# Windows side and the browser there keeps being served the bundle. Closing it is
# `dev` alone — `preview` and `ui-smoke` are watched from inside WSL, and the app
# on the Windows taskbar is not theirs to shut.
dev: win-port-stop port-check
	npm run dev

build:
	npm run build

# vite preview serves dist/, so build first or you preview the last build.
preview: build port-check
	npm run preview

test:
	npm test

check:
	npm run check

# seed and ui-smoke start a preview server of their own, so they want the port
# as much as dev does.
seed: port-check
	NODE_PATH=$(PLAYWRIGHT_MODULES) npm run seed

ui-smoke: port-check
	NODE_PATH=$(PLAYWRIGHT_MODULES) npm run ui-smoke

docs:
	npm run docs:check

# Cheapest first: a type error should not wait on a browser.
verify: check test ui-smoke docs

# --- packaging — architecture.md §7 ------------------------------------------
#
# Both bundles take dist/ as input rather than building their own, so the phone
# and the laptop cannot drift: there is one web build and it is copied in.

# The embeddable Python is downloaded once and cached in .build-cache/. Set
# PYTHON_EMBED=skip for a machine that already has Python and wants the assets.
PYTHON_EMBED ?= include

windows: build
ifeq ($(PYTHON_EMBED),skip)
	python3 scripts/build-windows.py --no-python
else
	python3 scripts/build-windows.py
endif

# Docker holds the JDK and the Android SDK, so the host keeps neither.
apk: build
	scripts/build-apk.sh

apk-clean:
	scripts/build-apk.sh clean

clean:
	rm -rf dist ui-smoke bundles
