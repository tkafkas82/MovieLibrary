#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# Movie Library — macOS launcher (double-click me).
#
# First run: right-click (Control-click) this file → Open → Open, to clear
# Apple's "unidentified developer" warning. After that, a normal double-click
# works. It downloads the correct helper for your Mac (Apple Silicon or Intel),
# keeps it up to date, and starts it. Leave the window open while you watch.
# ─────────────────────────────────────────────────────────────────────────
REPO="tkafkas82/MovieLibrary"
DIR="$HOME/.movielibrary"
mkdir -p "$DIR"

# Stop any previous helper first, so the new one can bind the port (and so an
# update actually takes effect instead of the old process staying alive).
pkill -f "movielibrary-helper-macos" 2>/dev/null || true
sleep 1

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  *)     ARCH="x64" ;;
esac
BIN="$DIR/movielibrary-helper-macos-$ARCH"
URL="https://github.com/$REPO/releases/latest/download/movielibrary-helper-macos-$ARCH"

# Auto-update: compare the installed version to the latest release tag.
LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
          | grep -m1 '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
CURRENT=$(cat "$DIR/version" 2>/dev/null || echo "")

if [ ! -x "$BIN" ] || { [ -n "$LATEST" ] && [ "$LATEST" != "$CURRENT" ]; }; then
  echo "Downloading the Movie Library helper ${LATEST:-(latest)} for your Mac…"
  if curl -fL "$URL" -o "$BIN"; then
    chmod +x "$BIN"
    xattr -dr com.apple.quarantine "$BIN" 2>/dev/null || true
    [ -n "$LATEST" ] && echo "$LATEST" > "$DIR/version"
  else
    echo "Download failed. Check your internet connection and try again."
    [ -x "$BIN" ] || { echo "Press any key to close."; read -r -n 1; exit 1; }
  fi
fi

echo ""
echo "  🎬  Movie Library helper is starting."
echo "      Leave this window open, then open your Movie Library site in your browser."
echo "      (Close this window to stop the helper.)"
echo ""
"$BIN"
