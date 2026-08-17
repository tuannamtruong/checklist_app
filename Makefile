# Bundles for the sync prototype, built from this Unix side.
#
#   make proto_all         both of the below, in one command
#   make proto_exe_win     Windows launcher: staged Python + desktop shortcut
#   make proto_android     Android APK, built inside a container
#
# Neither installs a toolchain on this machine: the Windows target downloads an
# embeddable Python and stages it on the Windows side, and the Android target
# does everything inside Docker.

.PHONY: help proto_all proto_exe_win proto_android proto_clean
.DEFAULT_GOAL := help

# The folder your cloud client already syncs. Baked into the Windows shortcut,
# so the app starts pointed at it and never asks.
FOLDER ?= D:\MEGA\Checklist
# Where the staged Python runtime and the icon go on the Windows side.
TARGET ?= C:\Tools\ChecklistProto

# printf, not echo: /bin/sh here is dash, whose echo eats backslash escapes --
# and every path below is a Windows one. `\c` in particular means "stop
# printing", which silently truncates the line at C:\...\checklist.
help:
	@printf '%s\n' \
	  "make proto_all       - both bundles, one command" \
	  "make proto_exe_win   - Windows launcher + desktop shortcut" \
	  "                       FOLDER=$(FOLDER)" \
	  "                       TARGET=$(TARGET)" \
	  "make proto_android   - Android APK -> prototype/android/out/" \
	  "make proto_clean     - remove build output and caches" \
	  "" \
	  "override a path like:" \
	  "  make proto_exe_win FOLDER='C:\\Users\\XXX\\OneDrive\\checklist'"

# Windows first: it is the fast half, and the Android image can take minutes on
# a cold cache. A failure there should not come after a long wait.
proto_all: proto_exe_win proto_android

proto_exe_win:
	python3 prototype/install/make_windows_bundle.py --folder '$(FOLDER)' --target '$(TARGET)'

proto_android:
	prototype/android/build.sh

proto_clean:
	prototype/android/build.sh clean
	rm -rf prototype/.build-cache
	@echo "note: the staged runtime on the Windows side is left alone."
	@echo "      remove it by hand: $(TARGET)"
