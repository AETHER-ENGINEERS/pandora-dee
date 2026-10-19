#!/usr/bin/env bash
# Jade Vector: build Vector's vector-agent (patched for Jade) and run the bridge as a service.
# macOS (launchd) and Linux (systemd --user). Re-run any time: it updates in place.
#
#   ./setup.sh            build + install + start the service
#   ./setup.sh --no-service   build + install only (run ./run.sh yourself)
#   ./setup.sh --uninstall    stop and remove the service (keeps ~/.jade-vector)
set -euo pipefail

VECTOR_REPO="${VECTOR_REPO:-https://github.com/VectorPrivacy/Vector.git}"
VECTOR_REF="${VECTOR_REF:-44fdb873464a99d8256ecdce7a1cfd1ddc2b45c4}"   # the commit the Jade patch was written against (widescreen branch)
HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${JADE_VECTOR_HOME:-$HOME/.jade-vector}"
PORT="${JADE_VECTOR_PORT:-8787}"
OS="$(uname -s)"
say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

uninstall() {
  if [ "$OS" = Darwin ]; then
    launchctl unload "$HOME/Library/LaunchAgents/io.jadevault.vector.plist" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/io.jadevault.vector.plist"
  else
    systemctl --user disable --now jade-vector.service 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/jade-vector.service"; systemctl --user daemon-reload 2>/dev/null || true
  fi
  say "Service removed. Your bot key and data are still in $HOME_DIR."
}
[ "${1:-}" = --uninstall ] && { uninstall; exit 0; }

# ---- prerequisites ----
need_pkgs=()
command -v git >/dev/null || need_pkgs+=(git)
command -v python3 >/dev/null || need_pkgs+=(python3)
if [ "$OS" = Darwin ]; then
  xcode-select -p >/dev/null 2>&1 || { say "Installing the Xcode command line tools (a window will open)…"; xcode-select --install || true; die "Finish the Xcode tools install, then run ./setup.sh again."; }
  [ ${#need_pkgs[@]} -eq 0 ] || die "Missing: ${need_pkgs[*]} (install with Homebrew: brew install ${need_pkgs[*]})"
elif [ "$OS" = Linux ]; then
  command -v cc >/dev/null || need_pkgs+=(build-essential)
  command -v clang >/dev/null || need_pkgs+=(clang libclang-dev)
  command -v pkg-config >/dev/null || need_pkgs+=(pkg-config)
  if [ ${#need_pkgs[@]} -gt 0 ]; then
    if command -v apt-get >/dev/null; then say "Installing ${need_pkgs[*]} (sudo)…"; sudo apt-get update && sudo apt-get install -y "${need_pkgs[@]}" ca-certificates curl
    elif command -v dnf >/dev/null; then say "Installing build tools (sudo)…"; sudo dnf install -y gcc gcc-c++ make clang clang-devel pkgconf-pkg-config git python3 curl
    elif command -v pacman >/dev/null; then say "Installing build tools (sudo)…"; sudo pacman -S --needed --noconfirm base-devel clang pkgconf git python curl
    else die "Install a C compiler, clang, pkg-config, git and python3, then run again."; fi
  fi
else
  die "Unsupported system $OS. Use the Docker variant (see README.md)."
fi
if ! command -v cargo >/dev/null; then
  [ -x "$HOME/.cargo/bin/cargo" ] && export PATH="$HOME/.cargo/bin:$PATH"
fi
if ! command -v cargo >/dev/null; then
  say "Installing Rust (rustup)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  export PATH="$HOME/.cargo/bin:$PATH"
fi

# ---- source + patch + build ----
mkdir -p "$HOME_DIR/bin" "$HOME_DIR/src"
SRC="$HOME_DIR/src/Vector"
if [ ! -d "$SRC/.git" ]; then
  say "Fetching Vector…"; git clone --filter=blob:none "$VECTOR_REPO" "$SRC"
fi
git -C "$SRC" fetch --quiet origin "$VECTOR_REF" 2>/dev/null || git -C "$SRC" fetch --quiet origin
git -C "$SRC" checkout --quiet --force "$VECTOR_REF"
git -C "$SRC" clean -fdq crates/vector-agent
say "Adding Jade's tools to vector-agent…"
python3 "$HERE/patch_vector_agent.py" "$SRC/crates/vector-agent"
say "Building vector-agent (the first build takes a while)…"
( cd "$SRC/crates" && cargo build --release -p vector-agent )
install -m 755 "$SRC/crates/target/release/vector-agent" "$HOME_DIR/bin/vector-agent"
install -m 755 "$HERE/jade_vector_bridge.py" "$HOME_DIR/bin/jade_vector_bridge.py"
cat > "$HOME_DIR/run.sh" <<RUN
#!/usr/bin/env bash
export JADE_VECTOR_HOME="$HOME_DIR"
exec python3 "$HOME_DIR/bin/jade_vector_bridge.py" --agent "$HOME_DIR/bin/vector-agent" --port "\${JADE_VECTOR_PORT:-$PORT}" "\$@"
RUN
chmod 755 "$HOME_DIR/run.sh"
TOKEN="$(JADE_VECTOR_HOME="$HOME_DIR" python3 "$HOME_DIR/bin/jade_vector_bridge.py" --print-token)"

# ---- service ----
if [ "${1:-}" != --no-service ]; then
  if [ "$OS" = Darwin ]; then
    PL="$HOME/Library/LaunchAgents/io.jadevault.vector.plist"; mkdir -p "$(dirname "$PL")"
    cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.jadevault.vector</string>
  <key>ProgramArguments</key><array><string>$HOME_DIR/run.sh</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$HOME_DIR/bridge.log</string>
  <key>StandardOutPath</key><string>$HOME_DIR/bridge.log</string>
</dict></plist>
PLIST
    launchctl unload "$PL" 2>/dev/null || true; launchctl load "$PL"
    say "Running as a launchd service (log: $HOME_DIR/bridge.log)."
  else
    UNIT="$HOME/.config/systemd/user/jade-vector.service"; mkdir -p "$(dirname "$UNIT")"
    cat > "$UNIT" <<UNITF
[Unit]
Description=Jade Vector bridge (Vector messenger for Jade Vault)
After=network-online.target

[Service]
ExecStart=$HOME_DIR/run.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNITF
    systemctl --user daemon-reload && systemctl --user enable --now jade-vector.service
    loginctl enable-linger "$USER" 2>/dev/null || true
    say "Running as a systemd user service (journalctl --user -u jade-vector -f)."
  fi
fi

IP="$( (ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}') || true)"
echo
say "Done. In Jade Vault → Config → Vector messenger:"
echo "    Bridge URL:   http://${IP:-THIS-COMPUTER-IP}:$PORT/mcp"
echo "    Bridge token: $TOKEN"
echo "    The bot's key is in $HOME_DIR/nsec (back it up; anyone with it can read and send as the bot)."
