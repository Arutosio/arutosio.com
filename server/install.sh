#!/bin/sh
# Development installer: build arutosiod from this checkout.
# Normal users should run the one-command installer instead:
#   curl -fsSL https://arutosio.com/install.sh | bash
# No sudo by default; the service is a systemd user unit when available.
set -eu

PORT="${ARUTOSIO_PORT:-7777}"
PREFIX="${ARUTOSIO_HOME:-$HOME/.arutosio}"
NO_SERVICE=0

usage() {
    cat <<'EOF'
Usage: ./install.sh [--port PORT] [--prefix DIR] [--no-service]

  --port PORT       loopback port (default 7777)
  --prefix DIR      data/install root (default ~/.arutosio)
  --no-service      start in the background instead of systemd --user
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --port) PORT="${2:-}"; shift 2 ;;
        --prefix) PREFIX="${2:-}"; shift 2 ;;
        --no-service) NO_SERVICE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

case "$PORT" in
    ''|*[!0-9]*) echo "invalid port: $PORT" >&2; exit 2 ;;
esac

SRC_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SERVER_DIR="$SRC_DIR/server"
BIN="$SERVER_DIR/arutosiod"

if [ ! -x "$BIN" ]; then
    if command -v go >/dev/null 2>&1; then
        echo "building arutosiod…"
        (cd "$SERVER_DIR" && go build -o arutosiod .)
    else
        echo "arutosiod is missing and Go is not installed." >&2
        echo "Build it with: cd server && go build -o arutosiod ." >&2
        exit 1
    fi
fi

if [ "$(id -u)" -eq 0 ]; then
    echo "Run this as your normal user, not root: the daemon keeps your files." >&2
    exit 1
fi

mkdir -p "$PREFIX/bin" "$PREFIX/current"
chmod 700 "$PREFIX" 2>/dev/null || true

# Stop the previous instance before replacing the binary/web root.
if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet arutosiod 2>/dev/null; then
    systemctl --user stop arutosiod || true
fi
if [ -f "$PREFIX/arutosiod.pid" ]; then
    OLD_PID="$(cat "$PREFIX/arutosiod.pid" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        kill "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$PREFIX/arutosiod.pid"
fi

cp "$BIN" "$PREFIX/bin/arutosiod.new"
chmod 755 "$PREFIX/bin/arutosiod.new"
mv "$PREFIX/bin/arutosiod.new" "$PREFIX/bin/arutosiod"

rm -rf "$PREFIX/current/web"
mkdir -p "$PREFIX/current/web"
tar -C "$SRC_DIR" \
    --exclude=.git \
    --exclude=server \
    --exclude=node_modules \
    --exclude='__test_*' \
    -cf - . | tar -C "$PREFIX/current/web" -xf -

SERVICE_OK=0
if [ "$NO_SERVICE" -eq 0 ] && command -v systemctl >/dev/null 2>&1; then
    if systemctl --user show-environment >/dev/null 2>&1; then
        UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
        mkdir -p "$UNIT_DIR"
        cat > "$UNIT_DIR/arutosiod.service" <<EOF
[Unit]
Description=Arutosio OS daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$PREFIX/bin/arutosiod -listen 127.0.0.1:$PORT -web $PREFIX/current/web -root %h -data $PREFIX
Restart=on-failure
RestartSec=2
WorkingDirectory=%h

[Install]
WantedBy=default.target
EOF
        systemctl --user daemon-reload
        systemctl --user enable --now arutosiod.service
        SERVICE_OK=1
        loginctl enable-linger "$USER" 2>/dev/null || \
            echo "For boot without login: sudo loginctl enable-linger $USER"
    fi
fi

if [ "$SERVICE_OK" -eq 0 ]; then
    echo "Starting arutosiod in the background (no user systemd)."
    nohup "$PREFIX/bin/arutosiod" \
        -listen "127.0.0.1:$PORT" \
        -web "$PREFIX/current/web" \
        -root "$HOME" \
        -data "$PREFIX" \
        >"$PREFIX/arutosiod.log" 2>&1 &
    echo $! > "$PREFIX/arutosiod.pid"
fi

i=0
while [ ! -s "$PREFIX/token" ] && [ "$i" -lt 20 ]; do
    sleep 0.25
    i=$((i + 1))
done
TOKEN="$(cat "$PREFIX/token" 2>/dev/null || true)"

echo
echo "arutosiod installed"
echo "  prefix: $PREFIX"
echo "  web:    $PREFIX/current/web"
if [ -n "$TOKEN" ]; then
    echo "  open:   http://localhost:$PORT/?token=$TOKEN"
    echo "  term:   http://localhost:$PORT/term?token=$TOKEN"
else
    echo "  open:   http://localhost:$PORT/ (token in $PREFIX/token or the journal)"
fi
echo "  tunnel: ssh -N -L $PORT:127.0.0.1:$PORT $(id -un)@<this-host>"
if [ "$SERVICE_OK" -eq 1 ]; then
    echo "  logs:   journalctl --user -u arutosiod -f"
else
    echo "  logs:   $PREFIX/arutosiod.log"
fi
