#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [path-to-binary-or-appimage]" >&2
  exit 2
fi

APP_PATH="${1:-src-tauri/target/release/quicksend}"

if [[ ! -x "$APP_PATH" ]]; then
  echo "Desktop smoke failed: executable not found at '$APP_PATH'" >&2
  exit 1
fi

RUN_ROOT="$(mktemp -d /tmp/quicksend-desktop-smoke-XXXXXX)"
LOG_FILE="$RUN_ROOT/app.log"
CONFIG_DIR="$RUN_ROOT/config"
TMP_DIR="$RUN_ROOT/tmp"
mkdir -p "$CONFIG_DIR" "$TMP_DIR"

cleanup() {
  rm -rf "$RUN_ROOT"
}
trap cleanup EXIT

LAUNCHER=()
if command -v xvfb-run >/dev/null 2>&1; then
  LAUNCHER=(xvfb-run -a)
elif [[ -z "${DISPLAY:-}" ]]; then
  echo "Desktop smoke failed: no DISPLAY and xvfb-run not found." >&2
  echo "Install xvfb (xvfb-run) or run from a graphical session." >&2
  exit 1
fi

set +e
TMPDIR="$TMP_DIR" QUICKSEND_CONFIG_DIR="$CONFIG_DIR" \
  timeout --signal=TERM --kill-after=2s 8s \
  "${LAUNCHER[@]}" "$APP_PATH" >"$LOG_FILE" 2>&1
EXIT_CODE=$?
set -e

if [[ $EXIT_CODE -eq 124 ]]; then
  if rg -n "panic|thread '.*' panicked|Segmentation fault" "$LOG_FILE" >/dev/null 2>&1; then
    echo "Desktop smoke failed: app logged fatal errors before timeout." >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
  echo "Desktop smoke passed: app started and remained alive for 8s."
  exit 0
fi

echo "Desktop smoke failed: app exited early (exit code $EXIT_CODE)." >&2
cat "$LOG_FILE" >&2
exit 1

