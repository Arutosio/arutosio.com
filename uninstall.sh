#!/usr/bin/env bash
# arutosio.com — one-command uninstaller for arutosiod.
#
#   curl -fsSL https://arutosio.com/uninstall.sh | bash
#
# Stops the service, removes the unit/binary/site and the firewall rule the
# installer added, and removes the ~/.local/bin symlink. Data is kept unless
# --purge is passed. Works on old installs that predate the arutosiod CLI.
set -euo pipefail

PREFIX="${ARUTOSIO_HOME:-$HOME/.arutosio}"
PURGE=0
ASSUME_YES=0

usage() {
    cat <<'EOF'
Usage: uninstall.sh [--prefix DIR] [--purge] [--yes]

  --prefix DIR   install/data directory (default ~/.arutosio)
  --purge        also delete token, profile, trash and remaining data
  --yes          do not ask for confirmation
EOF
}

die() { echo "error: $*" >&2; exit 1; }
warn() { echo "warning: $*" >&2; }

ask_yes_no() {
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
        --prefix) PREFIX="${2:?missing directory}"; shift 2 ;;
        --purge) PURGE=1; shift ;;
        --yes) ASSUME_YES=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown argument: $1 (see --help)" ;;
    esac
done

[ -n "${HOME:-}" ] || die "HOME is not set"
[ "$(id -u)" -ne 0 ] || die "run this as your normal user, not root"
for cmd in readlink ps sed grep; do
    command -v "$cmd" >/dev/null 2>&1 || die "missing required command: $cmd"
done

case "$PREFIX" in
    "~") PREFIX="$HOME" ;;
    "~/"*) PREFIX="$HOME/${PREFIX#"~/"}" ;;
esac

TTY_AVAILABLE=0
if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    TTY_AVAILABLE=1
fi
if [ "$ASSUME_YES" -eq 0 ] && [ "$TTY_AVAILABLE" -ne 1 ]; then
    die "no terminal available for confirmation; re-run with --yes"
fi

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/arutosiod.service"
LINK="${XDG_BIN_HOME:-$HOME/.local/bin}/arutosiod"

if [ ! -d "$PREFIX" ] && [ ! -f "$UNIT" ]; then
    echo "arutosiod is not installed in $PREFIX"
    exit 0
fi

if ! ask_yes_no "Uninstall arutosiod from $PREFIX?" n; then
    echo "cancelled"
    exit 0
fi

# ── Stop systemd or the background process ───────────────────────────
if command -v systemctl >/dev/null 2>&1; then
    if systemctl --user is-active --quiet arutosiod 2>/dev/null; then
        systemctl --user disable --now arutosiod >/dev/null 2>&1 || \
            systemctl --user stop arutosiod >/dev/null 2>&1 || true
    fi
fi

INSTALLED_EXE="$PREFIX/bin/arutosiod"
if [ -f "$PREFIX/arutosiod.pid" ]; then
    OLD_PID="$(cat "$PREFIX/arutosiod.pid" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        OLD_EXE="$(readlink -f "/proc/$OLD_PID/exe" 2>/dev/null || true)"
        if [ "$OLD_EXE" = "$INSTALLED_EXE" ]; then
            kill "$OLD_PID" 2>/dev/null || true
            i=0
            while kill -0 "$OLD_PID" 2>/dev/null && [ "$i" -lt 20 ]; do
                sleep 0.25
                i=$((i + 1))
            done
            if kill -0 "$OLD_PID" 2>/dev/null; then
                kill -9 "$OLD_PID" 2>/dev/null || true
            fi
        else
            warn "pid $OLD_PID does not belong to $INSTALLED_EXE; not killing it"
        fi
    fi
    rm -f "$PREFIX/arutosiod.pid"
fi

# Old installs may not have a pidfile: match the executable, never a shell
# whose command line merely contains the path.
for pid in $(ps -eo pid= 2>/dev/null); do
    [ "$pid" = "$$" ] && continue
    exe="$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)"
    if [ "$exe" = "$INSTALLED_EXE" ]; then
        kill "$pid" 2>/dev/null || true
    fi
done

# ── Remove the unit only if it points at this install ────────────────
if [ -f "$UNIT" ]; then
    if grep -Fq "$PREFIX" "$UNIT"; then
        rm -f "$UNIT"
        if command -v systemctl >/dev/null 2>&1; then
            systemctl --user daemon-reload >/dev/null 2>&1 || true
        fi
    else
        warn "$UNIT does not point to $PREFIX; leaving it in place"
    fi
fi

# ── Close the firewall rule recorded by the installer ────────────────
if [ -f "$PREFIX/firewall.json" ]; then
    FW_BACKEND="$(sed -n 's/.*"backend": "\([^"]*\)".*/\1/p' "$PREFIX/firewall.json" | head -n1)"
    FW_RULE="$(sed -n 's/.*"rule": "\([^"]*\)".*/\1/p' "$PREFIX/firewall.json" | head -n1)"
    FW_ADDED="$(sed -n 's/.*"added": \(true\|false\).*/\1/p' "$PREFIX/firewall.json" | head -n1)"
    if [ "$FW_ADDED" = "true" ] && [ -n "$FW_RULE" ]; then
        case "$FW_BACKEND" in
            ufw)
                if sudo ufw delete allow "$FW_RULE"; then
                    echo "firewall: closed $FW_RULE in ufw"
                    rm -f "$PREFIX/firewall.json"
                else
                    warn "could not close $FW_RULE; run: sudo ufw delete allow $FW_RULE"
                fi
                ;;
            firewalld)
                if sudo firewall-cmd --permanent --remove-port="$FW_RULE" && sudo firewall-cmd --reload; then
                    echo "firewall: closed $FW_RULE in firewalld"
                    rm -f "$PREFIX/firewall.json"
                else
                    warn "could not close $FW_RULE; run: sudo firewall-cmd --permanent --remove-port=$FW_RULE && sudo firewall-cmd --reload"
                fi
                ;;
            *)
                warn "unknown firewall backend $FW_BACKEND; close $FW_RULE manually"
                ;;
        esac
    fi
fi

# ── Remove the PATH symlink when it points here ──────────────────────
if [ -L "$LINK" ]; then
    TARGET="$(readlink "$LINK" 2>/dev/null || true)"
    RESOLVED="$(readlink -f "$LINK" 2>/dev/null || true)"
    INSTALLED="$PREFIX/bin/arutosiod"
    if [ "$TARGET" = "$INSTALLED" ] || [ "$RESOLVED" = "$INSTALLED" ]; then
        rm -f "$LINK"
    fi
fi

# ── Remove install files; keep user data unless --purge ──────────────
rm -f "$PREFIX/bin/arutosiod" "$PREFIX/bin/arutosiod.old" \
      "$PREFIX/bin/arutosiod.rollback" "$PREFIX/bin/arutosiod.new"
rmdir "$PREFIX/bin" 2>/dev/null || true
rm -rf "$PREFIX/current"
rm -f "$PREFIX/config.json" "$PREFIX/runtime.json" "$PREFIX/firewall.json" \
      "$PREFIX/arutosiod.log" "$PREFIX/arutosiod.pid"

if [ "$PURGE" -eq 1 ]; then
    if ! ask_yes_no "Delete token, profile, trash and all remaining data in $PREFIX?" n; then
        echo "arutosiod uninstalled; data kept in $PREFIX"
        exit 0
    fi
    rm -rf "$PREFIX"
    echo "arutosiod uninstalled; $PREFIX removed"
else
    echo "arutosiod uninstalled; data kept in $PREFIX"
    echo "Delete it too with: $0 --purge"
fi
