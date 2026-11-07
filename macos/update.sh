#!/usr/bin/env bash
set -e

# Ensure complete PATH across Homebrew, Node, and developer tools when launched from macOS GUI
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -n 1)/bin:$HOME/.fnm/current/bin:$HOME/.volta/bin:$PATH"

# Fallback path discovery if npm is still not resolved
if ! command -v npm >/dev/null 2>&1; then
    for candidate in /opt/homebrew/bin /usr/local/bin /usr/bin; do
        if [ -x "$candidate/npm" ]; then
            export PATH="$candidate:$PATH"
            break
        fi
    done
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "=== UpBeat macOS Self-Updater ==="
echo "Updating workspace at $DIR..."

# Fetch latest commits from GitHub
if [ -d ".git" ]; then
    echo "Pulling latest code from GitHub..."
    git pull origin main || echo "Git pull completed or already up-to-date"
fi

# Rebuild frontend
if [ -d "frontend" ]; then
    echo "Building latest frontend assets..."
    cd frontend
    npm run build
    cd "$DIR"
fi

# Recompile native macOS Swift binary
echo "Recompiling native macOS app..."
swiftc -O -target arm64-apple-macos12.0 "$DIR/macos/UpBeatApp.swift" -o "$DIR/UpBeat.app/Contents/MacOS/UpBeat" -framework Cocoa -framework WebKit -framework Speech -framework AVFoundation
cp "$DIR/macos/UpBeat.icns" "$DIR/UpBeat.app/Contents/Resources/AppIcon.icns" 2>/dev/null || true
cp "$DIR/macos/Info.plist" "$DIR/UpBeat.app/Contents/Info.plist" 2>/dev/null || true

# Copy to /Applications if installed there
if [ -d "/Applications/UpBeat.app" ]; then
    echo "Updating /Applications/UpBeat.app..."
    rsync -a --delete "$DIR/UpBeat.app/" "/Applications/UpBeat.app/"
fi

echo "=== Update Complete ==="
