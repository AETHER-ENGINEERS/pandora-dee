#!/usr/bin/env bash
# Jade Discord: install discord.py into a private virtualenv and run the bridge as a service.
# macOS (launchd) and Linux (systemd --user). Re-run any time: it updates in place.
#
#   ./setup.sh                 install + ask for the bot token + start the service
#   ./setup.sh --no-service    install only (run ./run.sh yourself)
#   ./setup.sh --uninstall     stop and remove the service (keeps ~/.jade-discord)
#   ./setup.sh --archive       also keep every message the bot sees in ~/.jade-discord/archive (see README.md)
#   JADE_DISCORD_HOST=127.0.0.1 ./setup.sh   on a public server: listen on the server itself only
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${JADE_DISCORD_HOME:-$HOME/.jade-discord}"
PORT="${JADE_DISCORD_PORT:-8788}"
HOST="${JADE_DISCORD_HOST:-0.0.0.0}"   # 127.0.0.1 on a public server (a VPS): reach it through SSH or Tailscale
OS="$(uname -s)"
say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

uninstall() {
  if [ "$OS" = Darwin ]; then
    launchctl unload "$HOME/Library/LaunchAgents/io.jadevault.discord.plist" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/io.jadevault.discord.plist"
  else
    systemctl --user disable --now jade-discord.service 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/jade-discord.service"; systemctl --user daemon-reload 2>/dev/null || true
  fi
  say "Service removed. Your tokens are still in $HOME_DIR."
}
[ "${1:-}" = --uninstall ] && { uninstall; exit 0; }
ARCHIVE=""; NO_SERVICE=""
for a in "$@"; do case "$a" in --archive) ARCHIVE="--archive" ;; --no-service) NO_SERVICE=1 ;; esac; done

command -v python3 >/dev/null || die "python3 is missing (Python 3.9 or newer)."
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || die "Python 3.9 or newer is needed."
mkdir -p "$HOME_DIR"; chmod 700 "$HOME_DIR"
say "Installing discord.py into $HOME_DIR/venv …"
python3 -m venv "$HOME_DIR/venv" || die "python3 -m venv failed (on Debian/Ubuntu: sudo apt install python3-venv)."
"$HOME_DIR/venv/bin/pip" install --quiet --upgrade pip
"$HOME_DIR/venv/bin/pip" install --quiet --upgrade -r "$HERE/requirements.txt"
cp "$HERE/jade_discord_bridge.py" "$HOME_DIR/jade_discord_bridge.py"
cat > "$HOME_DIR/run.sh" <<RUN
#!/usr/bin/env bash
exec "$HOME_DIR/venv/bin/python" "$HOME_DIR/jade_discord_bridge.py" --port "$PORT" --host "$HOST" $ARCHIVE "\$@"
RUN
chmod +x "$HOME_DIR/run.sh"

if [ ! -s "$HOME_DIR/bot_token" ] && [ -z "${DISCORD_BOT_TOKEN:-}" ]; then
  say "Create the bot: https://discord.com/developers/applications → New Application → Bot → Reset Token."
  say "Also switch on Message Content Intent (Bot → Privileged Gateway Intents)."
  "$HOME_DIR/venv/bin/python" "$HOME_DIR/jade_discord_bridge.py" --set-token
fi
[ -n "$NO_SERVICE" ] && { say "Done. Start it with: $HOME_DIR/run.sh"; exit 0; }

if [ "$OS" = Darwin ]; then
  PLIST="$HOME/Library/LaunchAgents/io.jadevault.discord.plist"; mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>io.jadevault.discord</string>
<key>ProgramArguments</key><array><string>$HOME_DIR/run.sh</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardErrorPath</key><string>$HOME_DIR/bridge.log</string><key>StandardOutPath</key><string>$HOME_DIR/bridge.log</string>
</dict></plist>
P
  launchctl unload "$PLIST" 2>/dev/null || true; launchctl load "$PLIST"
elif [ "$OS" = Linux ]; then
  UNIT="$HOME/.config/systemd/user/jade-discord.service"; mkdir -p "$(dirname "$UNIT")"
  cat > "$UNIT" <<U
[Unit]
Description=Jade Discord bridge
After=network-online.target
[Service]
ExecStart=$HOME_DIR/run.sh
Restart=always
RestartSec=5
[Install]
WantedBy=default.target
U
  systemctl --user daemon-reload; systemctl --user enable --now jade-discord.service
  loginctl enable-linger "$USER" 2>/dev/null || true
else
  die "Unsupported system $OS. Use the Docker variant (see README.md)."
fi
sleep 2
say "Running on port $PORT.${ARCHIVE:+ Archiving every message into $HOME_DIR/archive.}"
echo
echo "  Bridge URL:   http://$(hostname):$PORT/mcp   (use this computer's LAN or Tailscale address from your phone)"
echo "  Bridge token: $("$HOME_DIR/venv/bin/python" "$HOME_DIR/jade_discord_bridge.py" --print-token)"
echo "  Then: Jade Vault → Config → Discord."
