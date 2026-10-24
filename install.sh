#!/usr/bin/env bash
# arutosio.com — one-command installer for arutosiod.
#
#   curl -fsSL https://arutosio.com/install.sh | bash
#
# Downloads the latest signed release bundle, verifies its Ed25519 signature
# and SHA-256, installs the daemon + site under ~/.arutosio, asks whether to
# expose it on the LAN, and starts a per-user service. No root, no checkout,
# no Go toolchain.
set -euo pipefail

REPO="Arutosio/arutosio.com"
PREFIX="${ARUTOSIO_HOME:-$HOME/.arutosio}"
PORT="${ARUTOSIO_PORT:-7777}"
NO_SERVICE=0
VERSION="latest"
LAN=""
OPEN_FIREWALL=""
NO_FIREWALL=0
ASSUME_YES=0

usage() {
    cat <<'EOF'
Usage: install.sh [options]

  --port PORT        loopback/LAN port (default 7777)
  --prefix DIR       install/data directory (default ~/.arutosio)
  --version TAG      release tag to install (default: latest)
  --lan              expose arutosiod on the LAN (0.0.0.0)
  --no-lan           keep it on 127.0.0.1 (default when --yes is used)
  --open-firewall    open the port in ufw/firewalld (asks for sudo)
  --no-firewall      never touch the firewall
  --no-service       start in the background instead of systemd --user
  --yes              non-interactive; use flags/defaults for every choice

Without --yes the script asks for confirmation and for LAN/firewall access.
EOF
}

die() {
    echo "error: $*" >&2
    exit 1
}

warn() {
    echo "warning: $*" >&2
}

ask_yes_no() {
    # $1 prompt, $2 default (y/n)
    local prompt="$1" default="$2" answer=""
    if [ "$ASSUME_YES" -eq 1 ]; then
        return 0
    fi
    if [ "$TTY_AVAILABLE" -ne 1 ]; then
        return 1
    fi
    if [ "$default" = "y" ]; then
        prompt="$prompt [Y/n] "
    else
        prompt="$prompt [y/N] "
    fi
    printf '%s' "$prompt" > /dev/tty
    IFS= read -r answer < /dev/tty || answer=""
    answer="${answer,,}"
    case "$answer" in
        "") [ "$default" = "y" ] ;;
        y|yes|s|si|sì) return 0 ;;
        *) return 1 ;;
    esac
}

while [ $# -gt 0 ]; do
    case "$1" in
        --port) PORT="${2:?missing port}"; shift 2 ;;
        --prefix) PREFIX="${2:?missing directory}"; shift 2 ;;
        --version) VERSION="${2:?missing tag}"; shift 2 ;;
        --lan) LAN=1; shift ;;
        --no-lan) LAN=0; shift ;;
        --open-firewall) OPEN_FIREWALL=1; shift ;;
        --no-firewall) OPEN_FIREWALL=0; NO_FIREWALL=1; shift ;;
        --no-service) NO_SERVICE=1; shift ;;
        --yes) ASSUME_YES=1; shift ;;
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

TTY_AVAILABLE=0
if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    TTY_AVAILABLE=1
fi
if [ "$ASSUME_YES" -eq 0 ] && [ "$TTY_AVAILABLE" -ne 1 ]; then
    die "no terminal available for confirmation; re-run with --yes (and --lan/--no-lan)"
fi

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
need head
need tr
need readlink
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

if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet arutosiod 2>/dev/null; then
    echo "Stopping the existing arutosiod service…"
    systemctl --user stop arutosiod || true
fi
if [ "$NO_SERVICE" -eq 1 ] && command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable arutosiod.service >/dev/null 2>&1 || true
fi
if [ -f "$PREFIX/arutosiod.pid" ]; then
    OLD_PID="$(cat "$PREFIX/arutosiod.pid" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        OLD_EXE="$(readlink -f "/proc/$OLD_PID/exe" 2>/dev/null || true)"
        if [ "$OLD_EXE" = "$PREFIX/bin/arutosiod" ]; then
            echo "Stopping arutosiod (pid $OLD_PID)…"
            kill "$OLD_PID" 2>/dev/null || true
            i=0
            while kill -0 "$OLD_PID" 2>/dev/null && [ "$i" -lt 20 ]; do
                sleep 0.25
                i=$((i + 1))
            done
        else
            warn "pid $OLD_PID does not belong to $PREFIX/bin/arutosiod; not killing it"
        fi
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
curl -fL --retry 3 --retry-delay 2 --connect-timeout 15 --progress-bar --max-filesize 67108864 \
    -o "$TMP/$ASSET" "$BASE/$ASSET" || die "download failed: $BASE/$ASSET"
for f in checksums.txt checksums.txt.sig; do
    curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 15 --max-filesize 1048576 \
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

OLD_VERSION=""
if [ -x "$PREFIX/bin/arutosiod" ]; then
    OLD_VERSION="$("$PREFIX/bin/arutosiod" -version 2>/dev/null || true)"
fi

# ── Choices ──────────────────────────────────────────────────────────
if [ -z "$LAN" ]; then
    if [ "$ASSUME_YES" -eq 1 ]; then
        LAN=0
    elif ask_yes_no "Expose arutosiod on the LAN? Traffic is HTTP, use only on a trusted network." n; then
        LAN=1
    else
        LAN=0
    fi
fi
if [ "$LAN" -eq 1 ]; then
    LISTEN="0.0.0.0:$PORT"
else
    LISTEN="127.0.0.1:$PORT"
fi

FW_BACKEND="none"
FW_ACTIVE=0
FW_ALLOWED=0
detect_firewall() {
    if command -v ufw >/dev/null 2>&1; then
        if ufw status 2>/dev/null | grep -q '^Status: active' || systemctl is-active --quiet ufw 2>/dev/null; then
            FW_BACKEND=ufw
            FW_ACTIVE=1
            if ufw status 2>/dev/null | grep -Eq "^${PORT}/tcp[[:space:]]+ALLOW"; then
                FW_ALLOWED=1
            fi
            return
        fi
    fi
    if command -v firewall-cmd >/dev/null 2>&1; then
        if firewall-cmd --state 2>/dev/null | grep -q running || systemctl is-active --quiet firewalld 2>/dev/null; then
            FW_BACKEND=firewalld
            FW_ACTIVE=1
            if firewall-cmd --query-port="${PORT}/tcp" >/dev/null 2>&1; then
                FW_ALLOWED=1
            fi
            return
        fi
    fi
}

if [ "$LAN" -eq 1 ]; then
    detect_firewall
    if [ "$FW_BACKEND" = "ufw" ] || [ "$FW_BACKEND" = "firewalld" ]; then
        if [ -z "$OPEN_FIREWALL" ]; then
            if [ "$NO_FIREWALL" -eq 1 ] || [ "$ASSUME_YES" -eq 1 ]; then
                OPEN_FIREWALL=0
            elif ask_yes_no "Open port $PORT/tcp in $FW_BACKEND?" n; then
                OPEN_FIREWALL=1
            else
                OPEN_FIREWALL=0
            fi
        fi
    else
        OPEN_FIREWALL=0
    fi
fi

SERVICE_LABEL="background"
[ "$HAVE_SYSTEMD" -eq 1 ] && SERVICE_LABEL="systemd user unit"

echo
echo "arutosiod $NEW_VERSION"
if [ -n "$OLD_VERSION" ] && [ "$OLD_VERSION" != "$NEW_VERSION" ]; then
    echo "  upgrade:  $OLD_VERSION → $NEW_VERSION"
fi
echo "  prefix:   $PREFIX"
echo "  port:     $PORT"
echo "  access:   $([ "$LAN" -eq 1 ] && echo "LAN (0.0.0.0)" || echo "local only (127.0.0.1)")"
echo "  service:  $SERVICE_LABEL"
if [ "$OPEN_FIREWALL" = "1" ] && [ "$LAN" -ne 1 ]; then
    warn "--open-firewall ignored without --lan"
fi
if [ "$LAN" -eq 1 ]; then
    if [ "$OPEN_FIREWALL" -eq 1 ]; then
        echo "  firewall: open $PORT/tcp in $FW_BACKEND (sudo)"
    elif [ "$FW_BACKEND" = "ufw" ] || [ "$FW_BACKEND" = "firewalld" ]; then
        echo "  firewall: left unchanged; open $PORT/tcp manually if needed"
    else
        echo "  firewall: no ufw/firewalld detected"
    fi
fi
echo
if ! ask_yes_no "Proceed?" y; then
    echo "cancelled; nothing was installed"
    exit 0
fi

# ── Install (data is preserved) ──────────────────────────────────────
echo "Installing arutosiod $NEW_VERSION in $PREFIX…"
mkdir -p "$PREFIX/bin" "$PREFIX/current"
cp -f "$TMP/bundle/arutosiod" "$PREFIX/bin/arutosiod.new"
chmod 755 "$PREFIX/bin/arutosiod.new"
mv -f "$PREFIX/bin/arutosiod.new" "$PREFIX/bin/arutosiod"

LOCAL_BIN="${XDG_BIN_HOME:-$HOME/.local/bin}"
PATH_NOTE=0
CLI_CMD="$PREFIX/bin/arutosiod"
if mkdir -p "$LOCAL_BIN" 2>/dev/null && ln -sfn "$PREFIX/bin/arutosiod" "$LOCAL_BIN/arutosiod" 2>/dev/null; then
    CLI_CMD="$LOCAL_BIN/arutosiod"
    if ! printf '%s' ":$PATH:" | grep -Fq ":$LOCAL_BIN:"; then
        PATH_NOTE=1
    fi
else
    warn "could not create the $LOCAL_BIN/arutosiod symlink"
fi

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
ExecStart="$PREFIX/bin/arutosiod" -listen "$LISTEN" -web "$PREFIX/current/web" -root %h -data "$PREFIX"
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
        -listen "$LISTEN" \
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

# ── Firewall ─────────────────────────────────────────────────────────
write_firewall_record() {
    local backend="$1" rule="$2" port="$3"
    {
        printf '{\n'
        printf '  "backend": "%s",\n' "$backend"
        printf '  "rule": "%s",\n' "$rule"
        printf '  "port": %s,\n' "$port"
        printf '  "added": true\n'
        printf '}\n'
    } > "$PREFIX/firewall.json.tmp"
    chmod 600 "$PREFIX/firewall.json.tmp"
    mv -f "$PREFIX/firewall.json.tmp" "$PREFIX/firewall.json"
}

close_old_firewall() {
    [ -f "$PREFIX/firewall.json" ] || return 0
    local old_backend old_rule old_port old_added
    old_backend="$(sed -n 's/.*"backend": "\([^"]*\)".*/\1/p' "$PREFIX/firewall.json" | head -n1)"
    old_rule="$(sed -n 's/.*"rule": "\([^"]*\)".*/\1/p' "$PREFIX/firewall.json" | head -n1)"
    old_port="$(sed -n 's/.*"port": \([0-9]*\).*/\1/p' "$PREFIX/firewall.json" | head -n1)"
    old_added="$(sed -n 's/.*"added": \(true\|false\).*/\1/p' "$PREFIX/firewall.json" | head -n1)"
    [ "$old_added" = "true" ] || return 0
    [ "$old_port" = "$PORT" ] && return 0
    case "$old_backend" in
        ufw) sudo ufw delete allow "$old_rule" ;;
        firewalld) sudo firewall-cmd --permanent --remove-port="$old_rule" && sudo firewall-cmd --reload ;;
        *) return 0 ;;
    esac || { warn "could not close $old_rule on port $old_port"; return 0; }
    rm -f "$PREFIX/firewall.json"
}

open_firewall() {
    [ "$LAN" -eq 1 ] || return 0
    if [ "$NO_FIREWALL" -eq 1 ] || [ "$OPEN_FIREWALL" -ne 1 ]; then
        case "$FW_BACKEND" in
            ufw) echo "firewall: open it manually with: sudo ufw allow $PORT/tcp" ;;
            firewalld) echo "firewall: open it manually with: sudo firewall-cmd --permanent --add-port=$PORT/tcp && sudo firewall-cmd --reload" ;;
            *) echo "firewall: no ufw/firewalld detected; check your router if the LAN URL is unreachable" ;;
        esac
        return 0
    fi
    close_old_firewall
    case "$FW_BACKEND" in
        ufw)
            if sudo ufw status 2>/dev/null | grep -Eq "^${PORT}/tcp[[:space:]]+ALLOW"; then
                echo "firewall: ufw already allows $PORT/tcp"
                return 0
            fi
            if sudo ufw allow "$PORT/tcp"; then
                write_firewall_record ufw "$PORT/tcp" "$PORT"
                echo "firewall: opened $PORT/tcp in ufw"
                return 0
            fi
            ;;
        firewalld)
            if firewall-cmd --query-port="$PORT/tcp" >/dev/null 2>&1; then
                echo "firewall: firewalld already allows $PORT/tcp"
                return 0
            fi
            if sudo firewall-cmd --permanent --add-port="$PORT/tcp" && sudo firewall-cmd --reload; then
                write_firewall_record firewalld "$PORT/tcp" "$PORT"
                echo "firewall: opened $PORT/tcp in firewalld"
                return 0
            fi
            ;;
        none)
            echo "firewall: no ufw/firewalld detected"
            return 0
            ;;
    esac
    warn "could not open $PORT/tcp; open it manually"
    return 1
}

open_firewall || true

# ── Config ───────────────────────────────────────────────────────────
json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_config() {
    local service="$1"
    local tmp="$PREFIX/config.json.tmp"
    {
        printf '{\n'
        printf '  "version": "%s",\n' "$(json_escape "$NEW_VERSION")"
        printf '  "listen": "%s",\n' "$(json_escape "$LISTEN")"
        printf '  "binary": "%s",\n' "$(json_escape "$PREFIX/bin/arutosiod")"
        printf '  "root": "%s",\n' "$(json_escape "$HOME")"
        printf '  "data": "%s",\n' "$(json_escape "$PREFIX")"
        printf '  "web": "%s",\n' "$(json_escape "$PREFIX/current/web")"
        printf '  "service": "%s"\n' "$service"
        printf '}\n'
    } > "$tmp"
    chmod 600 "$tmp"
    mv -f "$tmp" "$PREFIX/config.json"
}

if [ "$SERVICE_OK" -eq 1 ]; then
    write_config "systemd"
else
    write_config "background"
fi

i=0
while [ ! -s "$PREFIX/token" ] && [ "$i" -lt 40 ]; do
    sleep 0.25
    i=$((i + 1))
done
TOKEN="$(cat "$PREFIX/token" 2>/dev/null || true)"

# ── Report ───────────────────────────────────────────────────────────
echo
echo "arutosiod $NEW_VERSION installed."
echo "  data:   $PREFIX"
if [ -n "$TOKEN" ]; then
    echo "  local:  http://localhost:$PORT/?token=$TOKEN"
else
    echo "  local:  http://localhost:$PORT/ (token in $PREFIX/token)"
fi

if [ "$LAN" -eq 1 ]; then
    LAN_IPS=""
    if command -v ip >/dev/null 2>&1; then
        LAN_IPS="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|veth|br-|virbr|tailscale|zt|wg)/ { split($4,a,"/"); print a[1] }')"
    elif command -v hostname >/dev/null 2>&1; then
        LAN_IPS="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)"
    fi
    if [ -n "$LAN_IPS" ]; then
        FIRST=""
        for ip in $LAN_IPS; do
            if [ -n "$TOKEN" ]; then
                echo "  LAN:    http://$ip:$PORT/?token=$TOKEN"
            else
                echo "  LAN:    http://$ip:$PORT/"
            fi
            [ -n "$FIRST" ] || FIRST="$ip"
        done
        if [ -n "$FIRST" ]; then
            if ! curl -fsS --max-time 2 "http://$FIRST:$PORT/api/health" >/dev/null 2>&1; then
                warn "LAN URL did not answer from this machine; check the firewall or router"
            fi
        fi
    else
        warn "LAN enabled but no IPv4 address was found"
    fi
    echo "  note:   LAN access is HTTP; use only on a trusted network"
fi

echo "  tunnel: ssh -N -L $PORT:127.0.0.1:$PORT $(id -un)@<this-host>"
if [ "$PATH_NOTE" -eq 1 ]; then
    echo "  cli:    $CLI_CMD"
    echo "          add $LOCAL_BIN to PATH:"
    echo "            fish:     fish_add_path $LOCAL_BIN"
    echo "            bash/zsh: export PATH=\"$LOCAL_BIN:\$PATH\""
elif [ "$CLI_CMD" = "$LOCAL_BIN/arutosiod" ]; then
    echo "  cli:    arutosiod status"
else
    echo "  cli:    $CLI_CMD"
fi
if [ "$SERVICE_OK" -eq 1 ]; then
    echo "  logs:   journalctl --user -u arutosiod -f"
    echo
    echo "Optional: keep it running after logout with"
    echo "  sudo loginctl enable-linger $(id -un)"
else
    echo "  logs:   $PREFIX/arutosiod.log"
fi
