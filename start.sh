#!/usr/bin/env bash
# ---- MKV Movie Library helper launcher (macOS / Linux) ----
# First run installs dependencies (only Express). Then starts the local helper
# (disk scanning + IMDb + open/reveal) and opens the library in your browser.
#
# Two ways to use it:
#   * open the local URL this opens (works fully offline, any browser), OR
#   * leave this running and open your hosted (Vercel) UI in Chrome/Edge —
#     it will connect to this helper automatically.
#
# Usage: ./start.sh [port]      (default port 4700)

set -e
cd "$(dirname "$0")"

PORT="${1:-4700}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed or not on PATH. Install Node 18+ from https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi

URL="http://localhost:$PORT"
echo "Starting MKV Movie Library helper on $URL"
echo "(Leave this window open. Press Ctrl+C to stop the helper.)"

# The server opens your browser itself when a local UI is present.
PORT="$PORT" node server.js
