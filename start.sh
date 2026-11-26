#!/bin/sh
# Starts the radio console, the page you use at http://localhost:9700.
# Stop it with Ctrl-C.
#
# Something has to talk to the radio on the page's behalf. BACKEND chooses:
#   direct   the console logs in to the radio itself (the default)
#   wfweb    start wfweb and go through it
#
# The radio's address and login, and BACKEND, live in radio.conf next to this
# script. Set NO_OPEN=1 to skip opening the browser.

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
CONF="$HERE/radio.conf"
STARTED_WFWEB=""

if [ ! -f "$CONF" ]; then
  echo "Missing $CONF." >&2
  echo "Copy radio.conf.example to radio.conf and fill in your radio's address and login." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org and run this again." >&2
  exit 1
fi
# A BACKEND given on the command line wins over the one in radio.conf.
BACKEND_ASKED="${BACKEND:-}"
. "$CONF"
BACKEND="${BACKEND_ASKED:-${BACKEND:-direct}}"
export BACKEND
WFWEB_DIR="${WFWEB_DIR:-$HERE/wfweb/wfweb-macos-arm64}"
PORT="${PORT:-9700}"

cleanup() {
  if [ -n "$STARTED_WFWEB" ]; then
    kill "$STARTED_WFWEB" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [ "$BACKEND" = "direct" ]; then
  if pgrep -x wfweb >/dev/null; then
    echo "wfweb is running and holds the radio's only network connection." >&2
    echo "Stop it first (pkill -x wfweb), then run this again." >&2
    exit 1
  fi
elif pgrep -x wfweb >/dev/null; then
  echo "wfweb is already running, using it."
elif [ ! -x "$WFWEB_DIR/wfweb" ]; then
  echo "BACKEND is wfweb, but there is no wfweb program in $WFWEB_DIR." >&2
  echo "Download it (see the README) or set WFWEB_DIR in radio.conf." >&2
  echo "To connect without wfweb, set BACKEND=direct in radio.conf." >&2
  exit 1
else
  echo "Starting wfweb for the radio at $RADIO_IP ..."
  mkdir -p "$HERE/wfweb"
  (
    cd "$WFWEB_DIR"
    exec ./wfweb --lan "$RADIO_IP" --lan-user "$RADIO_USER" --lan-pass "$RADIO_PASS" \
      --no-tui --logfile "$HERE/wfweb/wfweb.log"
  ) >/dev/null 2>&1 &
  STARTED_WFWEB=$!
fi

if [ "${NO_OPEN:-}" != "1" ]; then
  if command -v open >/dev/null 2>&1; then
    (sleep 2 && open "http://localhost:$PORT") &
  elif command -v xdg-open >/dev/null 2>&1; then
    (sleep 2 && xdg-open "http://localhost:$PORT") >/dev/null 2>&1 &
  fi
fi

node "$HERE/console/server.js"
