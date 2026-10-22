#!/bin/bash
# Installs a per-user LaunchAgent that starts Switchyard at login and restarts it if it exits.
# Remove it with:
#   launchctl bootout "gui/$(id -u)/dev.switchyard.server"
#   rm ~/Library/LaunchAgents/dev.switchyard.server.plist
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
node_bin="$(command -v node)"
label="dev.switchyard.server"
plist="$HOME/Library/LaunchAgents/$label.plist"
logs="$HOME/Library/Logs/Switchyard"
if [ ! -f "$repo/ui/.next-build/BUILD_ID" ]; then
  echo 'Production build missing. Run "npm ci" and "npm run build" in the repository root first.' >&2
  exit 1
fi
mkdir -p "$HOME/Library/LaunchAgents" "$logs"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$repo/ui/scripts/run-next.mjs</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>$repo/ui</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$logs/server.log</string>
  <key>StandardErrorPath</key><string>$logs/server-error.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Installed: $label (http://127.0.0.1:3010/)"
