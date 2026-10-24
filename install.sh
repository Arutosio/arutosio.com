#!/usr/bin/env bash
# arutosio.com — one-command installer for arutosiod.
#
#   curl -fsSL https://arutosio.com/install.sh | bash
#
# Downloads the latest signed release bundle, verifies its Ed25519 signature
# and SHA-256, installs the daemon + site under ~/.arutosio and starts a
# per-user service. No root, no checkout, no Go toolchain.
set -euo pipefail

REPO="Arutosio/arutosio.com"
PREFIX="${ARUTOSIO_HOME:-$HOME/.arutosio}"
PORT="${ARUTOSIO_PORT:-7777}"
NO_SERVICE=0
VERSION="latest"

usage() {
    cat <<'EOF'
Usage: install.sh [--port PORT] [--prefix DIR] [--version TAG] [--no-service]

  --port PORT       loopback port (default 7777)
  --prefix DIR      install/data directory (default ~/.arutosio)
  --version TAG     release tag to install (default: latest)
  --no-service      start in the background instead of systemd --user
EOF
}

die() {
    echo "error: $*" >&2
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        --port) PORT="${2:?missing port}"; shift 2 ;;
        --prefix) PREFIX="${2:?missing directory}"; shift 2 ;;
        --version) VERSION="${2:?missing tag}"; shift 2 ;;
        --no-service) NO_SERVICE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown argument: $1 (see --help)" ;;
    esac
done

[ -n "${HOME:-}" ] || die "HOME is not set"
[ "$(id -u)" -ne 0 ] || die "run this as your normal user, not root"
[ "$(uname -s)" = "Linux" ] || die "arutosiod runs on Linux only"

case "$(uname -m)" in
    x86_64|amd64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    armv7l|armv7|armhf) ARCH=armv7 ;;
    *) die "unsupported architecture: $(uname -m) (need x86_64, aarch64 or armv7)" ;;
esac

case "$PORT" in
    ''|*[!0-9]*) die "invalid port: $PORT" ;;
esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "invalid port: $PORT"

case "$VERSION" in
    latest|v[0-9]*) ;;
    *) die "invalid version tag: $VERSION" ;;
esac

# ── Dependencies: report, never install ──────────────────────────────
missing=""
need() { command -v "$1" >/dev/null 2>&1 || missing="$missing $1"; }
need curl
need tar
need gzip
need openssl
need awk
need sed
need grep
need mktemp
need uname
need id
need cat
need cp
need mv
need chmod
need mkdir
need rm
need tail
need sleep
need nohup
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    missing="$missing sha256sum"
fi
if [ -n "$missing" ]; then
    printf '%s\n' \
        "Missing required commands:$missing" \
        "" \
        "Install them with your package manager, then run the command again:" \
        "  Debian/Ubuntu   sudo apt install curl tar gzip openssl coreutils gawk" \
        "  Fedora          sudo dnf install curl tar gzip openssl coreutils gawk" \
        "  Arch            sudo pacman -S curl tar gzip openssl coreutils gawk" \
        "  Alpine          sudo apk add curl tar gzip openssl coreutils gawk" \
        "" \
        "arutosiod is a Linux binary (amd64, arm64, armv7). Nothing was installed." >&2
    exit 1
fi

# ── Resolve paths ────────────────────────────────────────────────────
case "$PREFIX" in
    "~") PREFIX="$HOME" ;;
    "~/"*) PREFIX="$HOME/${PREFIX#"~/"}" ;;
esac
mkdir -p "$PREFIX" || die "cannot create $PREFIX"
PREFIX="$(cd "$PREFIX" && pwd)"
chmod 700 "$PREFIX" 2>/dev/null || true

HAVE_SYSTEMD=0
if [ "$NO_SERVICE" -eq 0 ] && command -v systemctl >/dev/null 2>&1; then
    if systemctl --user show-environment >/dev/null 2>&1; then
        HAVE_SYSTEMD=1
    fi
fi

# ── Stop the previous instance ───────────────────────────────────────
if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet arutosiod 2>/dev/null; then
    echo "Stopping the existing arutosiod service…"
    systemctl --user stop arutosiod || true
fi
if [ -f "$PREFIX/arutosiod.pid" ]; then
    OLD_PID="$(cat "$PREFIX/arutosiod.pid" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Stopping arutosiod (pid $OLD_PID)…"
        kill "$OLD_PID" 2>/dev/null || true
        i=0
        while kill -0 "$OLD_PID" 2>/dev/null && [ "$i" -lt 20 ]; do
            sleep 0.25
            i=$((i + 1))
        done
    fi
    rm -f "$PREFIX/arutosiod.pid"
fi

i=0
while [ "$i" -lt 20 ]; do
    if ! curl -fsS --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
        break
    fi
    sleep 0.25
    i=$((i + 1))
done
if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    die "port $PORT is already in use; stop the other process or choose --port"
fi

# ── Download the signed release ──────────────────────────────────────
TMP="$(mktemp -d "${TMPDIR:-/tmp}/arutosio-install.XXXXXX")" || die "cannot create a temporary directory"
trap 'rm -rf "$TMP"' EXIT

ASSET="arutosio-linux-$ARCH.tar.gz"
if [ "$VERSION" = "latest" ]; then
    BASE="https://github.com/$REPO/releases/latest/download"
else
    BASE="https://github.com/$REPO/releases/download/$VERSION"
fi

echo "Downloading $ASSET…"
curl -fL --retry 3 --retry-delay 2 --connect-timeout 15 --progress-bar \
    -o "$TMP/$ASSET" "$BASE/$ASSET" || die "download failed: $BASE/$ASSET"
for f in checksums.txt checksums.txt.sig; do
    curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 15 \
        -o "$TMP/$f" "$BASE/$f" || die "download failed: $BASE/$f"
done

cat > "$TMP/pub.pem" <<'PEM'
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAvxn7YDRCjqAzlfOLy1Lhz9Gl8qFtsngPSdMlKUv8Oi0=
-----END PUBLIC KEY-----
PEM

echo "Verifying release signature…"
openssl base64 -d -A -in "$TMP/checksums.txt.sig" -out "$TMP/checksums.sig" 2>/dev/null \
    || die "invalid signature file"
if ! openssl pkeyutl -verify -pubin -inkey "$TMP/pub.pem" -rawin \
    -in "$TMP/checksums.txt" -sigfile "$TMP/checksums.sig" >/dev/null 2>&1; then
    die "signature verification failed (OpenSSL 1.1.1+ with Ed25519 is required)"
fi

awk -v name="$ASSET" '$2 == name && length($1) == 64 { print; found=1 } END { exit !found }' \
    "$TMP/checksums.txt" > "$TMP/bundle.sha256" \
    || die "checksums.txt does not list $ASSET"
if command -v sha256sum >/dev/null 2>&1; then
    (cd "$TMP" && sha256sum -c bundle.sha256) || die "bundle checksum mismatch"
else
    (cd "$TMP" && shasum -a 256 -c bundle.sha256) || die "bundle checksum mismatch"
fi

echo "Extracting…"
mkdir -p "$TMP/bundle"
tar -xzf "$TMP/$ASSET" -C "$TMP/bundle" || die "cannot extract $ASSET"
[ -x "$TMP/bundle/arutosiod" ] || die "bundle has no arutosiod binary"
[ -f "$TMP/bundle/web/index.html" ] || die "bundle has no web root"
NEW_VERSION="$("$TMP/bundle/arutosiod" -version 2>/dev/null || true)"
[ -n "$NEW_VERSION" ] || die "the downloaded binary does not run on this machine"

# ── Install (data is preserved) ──────────────────────────────────────
echo "Installing arutosiod $NEW_VERSION in $PREFIX…"
mkdir -p "$PREFIX/bin" "$PREFIX/current"
cp -f "$TMP/bundle/arutosiod" "$PREFIX/bin/arutosiod.new"
chmod 755 "$PREFIX/bin/arutosiod.new"
mv -f "$PREFIX/bin/arutosiod.new" "$PREFIX/bin/arutosiod"

rm -rf "$PREFIX/current/web.new"
cp -a "$TMP/bundle/web" "$PREFIX/current/web.new"
if [ -d "$PREFIX/current/web" ]; then
    rm -rf "$PREFIX/current/web.old"
    mv "$PREFIX/current/web" "$PREFIX/current/web.old"
fi
mv "$PREFIX/current/web.new" "$PREFIX/current/web"
rm -rf "$PREFIX/current/web.old"
rm -f "$PREFIX/bin/arutosiod.old"

# ── Start ────────────────────────────────────────────────────────────
SERVICE_OK=0
if [ "$HAVE_SYSTEMD" -eq 1 ]; then
    UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/arutosiod.service" <<EOF
[Unit]
Description=Arutosio OS daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="$PREFIX/bin/arutosiod" -listen 127.0.0.1:$PORT -web "$PREFIX/current/web" -root %h -data "$PREFIX"
Restart=on-failure
RestartSec=2
WorkingDirectory=%h

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload || true
    if systemctl --user enable --now arutosiod.service; then
        SERVICE_OK=1
    else
        echo "systemd user service failed; falling back to a background process." >&2
        systemctl --user disable arutosiod.service >/dev/null 2>&1 || true
        systemctl --user reset-failed arutosiod.service >/dev/null 2>&1 || true
    fi
fi

if [ "$SERVICE_OK" -eq 0 ]; then
    nohup "$PREFIX/bin/arutosiod" \
        -listen "127.0.0.1:$PORT" \
        -web "$PREFIX/current/web" \
        -root "$HOME" \
        -data "$PREFIX" \
        >"$PREFIX/arutosiod.log" 2>&1 &
    echo $! > "$PREFIX/arutosiod.pid"
fi

i=0
while [ "$i" -lt 60 ]; do
    if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
        break
    fi
    sleep 0.25
    i=$((i + 1))
done
if ! curl -fsS --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "arutosiod did not start." >&2
    if [ "$SERVICE_OK" -eq 1 ]; then
        echo "Logs: journalctl --user -u arutosiod -n 50" >&2
    else
        echo "Logs: $PREFIX/arutosiod.log" >&2
        tail -n 20 "$PREFIX/arutosiod.log" 2>/dev/null >&2 || true
    fi
    exit 1
fi

i=0
while [ ! -s "$PREFIX/token" ] && [ "$i" -lt 40 ]; do
    sleep 0.25
    i=$((i + 1))
done
TOKEN="$(cat "$PREFIX/token" 2>/dev/null || true)"

echo
echo "arutosiod $NEW_VERSION installed."
echo "  data:   $PREFIX"
echo "  site:   http://localhost:$PORT/"
if [ -n "$TOKEN" ]; then
    echo "  open:   http://localhost:$PORT/?token=$TOKEN"
else
    echo "  token:  $PREFIX/token"
fi
echo "  tunnel: ssh -N -L $PORT:127.0.0.1:$PORT $(id -un)@<this-host>"
if [ "$SERVICE_OK" -eq 1 ]; then
    echo "  logs:   journalctl --user -u arutosiod -f"
    echo
    echo "Optional: keep it running after logout with"
    echo "  sudo loginctl enable-linger $(id -un)"
else
    echo "  logs:   $PREFIX/arutosiod.log"
fi
