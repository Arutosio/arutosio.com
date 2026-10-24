# Arutosio

**arutosio.com is the personal website of Arutosio** — a portfolio, a
playground and a working browser-based desktop, all in one. It is not a SaaS,
a product or a template: it is one person's home on the web, built as an
operating system you can open in a tab.

The site has two lives:

- **hosted on [arutosio.com](https://arutosio.com)** it is the public,
  browser-local showcase: apps, games, notes and settings live in the browser.
- **served by `arutosiod` on your own machine** it becomes a real local
  desktop: Files browses your directories, Grimoire saves real files, the
  Terminal is a real shell and System manages the machine.

> ⚠️ **This is proprietary personal work, not an open-source template.**
> See [Copyright & Rights](#copyright--rights) below before touching anything.

## What it is for

- **A personal homepage.** Projects, interests, links, a CV-like overview and
  the small experiments that do not deserve a separate site.
- **A showcase.** The desktop shell itself is the demo: windows, a package
  system, a sandbox for apps, games and widgets.
- **A playground.** New UI ideas, package APIs and local-first features are
  built and tested here first.
- **A real dashboard, if you want one.** Install the optional Go daemon and
  the same page manages files, processes, services and terminals on the
  machine that serves it — including over an SSH tunnel from another device.

It is a personal site, not a hosted service: there is no account, no cloud
sync and no telemetry. Hosted mode stores everything in your browser; local
mode stores everything on your machine.

## What you can do

- **Desktop shell** — draggable, resizable, stackable windows, taskbar, start
  menu with search, widgets, multiple themes, time-of-day wallpapers and five
  UI languages.
- **Files** — browse the virtual profile in hosted mode, or the real
  filesystem in local mode, with upload, rename, trash and restore.
- **Grimoire** — a writing/notes editor. In local mode it opens and saves real
  files with conflict detection and restore.
- **Terminal** — a virtual command shell in hosted mode, a real PTY in local
  mode. Sessions survive page reloads and replay recent output.
- **System** — local mode only: host/CPU/memory/disk overview, processes with
  kill, user systemd services, terminal sessions, trash, updates and rollback.
- **Packages** — install `.zip` apps and commands, or use the bundled ones:
  Files, Grimoire, Tavern (P2P chat), Ultima Arutosio, Snake, Arcane Duel,
  GBA link, dice, oracle, timer, QR and more.
- **Personal profile** — settings, app data, appearance and per-device window
  layouts. Export/import a `.zip`, or link a portable folder.
- **Local machine control** — the optional daemon exposes a confined
  filesystem API, a profile store, a PTY WebSocket and a system API. It is
  loopback-only and meant to be reached through `ssh -L`.
- **Self-update** — the local daemon checks the release feed, shows a toast,
  installs a signed bundle from **System › Updates** and can roll back.

## Two modes

| | Hosted (`arutosio.com`) | Local (`arutosiod`) |
|---|---|---|
| Storage | browser (localStorage/IndexedDB) | machine (`~/.arutosio`) |
| Files | virtual / portable profile | real filesystem |
| Terminal | virtual shell | real shell (PTY) |
| System app | not connected | processes, services, trash |
| Install | none | per-user Go daemon |
| Platform | any modern browser | Linux amd64/arm64/armv7 |

The public site always works without installing anything. Local mode is
optional and per-user; it needs no root and binds to `127.0.0.1` by default.

## Run

Hosted mode (the public site) is just static files:

```bash
python3 -m http.server 8080
open http://localhost:8080
```

Local mode (real files and shell on this machine) with one command:

```bash
curl -fsSL https://arutosio.com/install.sh | bash
```

The script downloads the latest signed release, verifies the Ed25519
signature and SHA-256, installs the daemon and site under `~/.arutosio`, and
starts a systemd user service (or a background process). It needs no root and
no checkout. If a dependency is missing (`curl`, `tar`, `gzip`, `openssl`,
`coreutils`, `gawk`) it prints the package-manager command and stops without
installing anything.

The installer asks for confirmation, whether to expose the daemon on the LAN,
and whether to open the port in `ufw`/`firewalld`. Use `--yes` for a
non-interactive install. Useful options: `--port 7777`, `--prefix DIR`,
`--version v0.5.1`, `--lan`, `--open-firewall`, `--no-firewall`,
`--no-service`.

It links `~/.local/bin/arutosiod` to the installed binary. If that directory
is not in `PATH`, the installer prints the line to add it (`fish_add_path
~/.local/bin`, or `export PATH="$HOME/.local/bin:$PATH"` for bash/zsh).

From a checkout (development only):

```bash
cd server
./install.sh          # build from this checkout
# or run without installing:
./arutosiod -web .. -root "$HOME" -data "$HOME/.arutosio"
```

Open the URL printed at startup. To use it from another device, keep it on
loopback and forward the port over SSH:

```bash
ssh -N -L 7777:127.0.0.1:7777 user@host
```

See [`server/README.md`](./server/README.md) for the daemon, security model
and API.

## Stack

- **Static site** — vanilla HTML, CSS and JavaScript. No build step.
- **IndexedDB + localStorage** — packages, app data, settings, sessions.
- **Go daemon (`server/`)** — optional local mode: static host, filesystem
  API, server-side profile/session, PTY over WebSocket.
- **xterm.js** — real terminal rendering for local mode.
- **Package sandbox** — iframe `ctx` bridge, permissions, zip installer.

## Local mode

`JavaScript/local.js` probes `/api/health`. When the site is served by
`arutosiod`, settings and app data live on the machine, Files browses real
directories, Grimoire edits real files, the Terminal is a real persistent PTY
and the System app manages processes, user services, terminal sessions and
trash. When the site is hosted on GitHub Pages, everything stays browser-local
as before.

By default the daemon listens only on `127.0.0.1`; reach it through an SSH
tunnel. To use it from another machine on the same network, enable LAN mode:

```bash
arutosiod lan on
```

This binds `0.0.0.0`, offers to open the port in `ufw`/`firewalld`, and prints
the LAN URLs. LAN traffic is plain HTTP, so use it only on a trusted network;
SSH remains the recommended path over untrusted networks.

If `http://<host>:7777` does not open from another device, run
`arutosiod status`: it shows whether LAN mode is enabled, which port is bound,
and the firewall state. Use the IP printed by `arutosiod url --lan` if the
hostname does not resolve (`<host>.local` works on networks with mDNS), and
make sure both devices are on the same network.

### Manage the daemon

```bash
arutosiod status          # service, health, paths, port, firewall, LAN URLs
arutosiod start
arutosiod stop
arutosiod restart
arutosiod logs -f
arutosiod url --lan --token
arutosiod doctor
arutosiod lan on|off
arutosiod update [--check]
arutosiod rollback
arutosiod uninstall [--purge]
```

`status` also has `--json`. `uninstall` stops the service, removes the binary
and site, and closes the firewall rule it added; the token/profile/trash are
kept unless you pass `--purge`. The same data directory is shared with the
installer, so re-installing after an uninstall keeps your data.

If you installed a version that predates the `arutosiod` CLI, use the
standalone uninstaller instead — it works on the old layout too:

```bash
curl -fsSL https://arutosio.com/uninstall.sh | bash
```

You do not need to uninstall before upgrading: re-running the installer stops
the old service, replaces the binary and site, and keeps the data. The
standalone uninstaller is for a clean removal (`--purge` to delete the data
too). It also removes the `~/.local/bin/arutosiod` link and closes the
firewall rule the installer added.

### Updates

`arutosiod` checks the GitHub release feed every six hours. When a newer
release exists, the UI shows a toast and **System › Updates** offers
**Update now**: the daemon downloads the bundle for its architecture (daemon
plus site snapshot), verifies the Ed25519 signature on `checksums.txt`, checks
the SHA-256 of the bundle, replaces both and restarts. Login sessions survive
the restart, and the previous build is kept so **System › Updates** can roll
back to it.

Releases are built by [`.github/workflows/release.yml`](./.github/workflows/release.yml)
when a `v*` tag is pushed:

```bash
git tag v0.5.1
git push origin v0.5.1
```

Disable checks with `-update-url ""`, or point them at a mirror returning the
same JSON shape as GitHub's latest-release endpoint. The signing key lives
outside the repository and is supplied to CI as `ARUTOSIO_SIGNING_KEY`; the
matching public key is embedded in the daemon.

## Project layout

```
install.sh          # one-command installer (served at arutosio.com/install.sh)
index.html          # OS shell
JavaScript/         # window manager, settings, terminal, sandbox, profile, local mode
Style/              # desktop, windows, terminal and section styling
defaultPackages/    # bundled apps and commands (Files, Grimoire, Terminal, …)
packages/           # example package repository
Backgrounds/        # time-of-day wallpaper clips
Images/  Brand/     # portraits, icons, social images
docs/               # architecture, ctx API, packages, profile, permissions
server/             # optional Go daemon for local mode
```

More documentation:

- [`docs/architecture.md`](./docs/architecture.md) — how the shell, windows,
  sandbox and local mode fit together
- [`docs/packages.md`](./docs/packages.md) — manifest, entries, commands,
  widgets
- [`docs/ctx-api.md`](./docs/ctx-api.md) — the API available to packages
- [`docs/permissions.md`](./docs/permissions.md) — permission model
- [`docs/profile.md`](./docs/profile.md) — browser and machine profiles
- [`docs/widgets.md`](./docs/widgets.md) — desktop widgets
- [`docs/tavern.md`](./docs/tavern.md) — the P2P chat app

## Privacy & security

Hosted mode does not send app data anywhere: packages run in a sandboxed
iframe and the profile stays in the browser. Local mode is a full shell for
the user who installs it; treat the access token like an SSH credential. The
daemon binds to loopback, checks the session cookie and CSRF on mutations,
confines the Files API to `-root`, and forces package iframes to an opaque
origin. No Tailscale, Cloudflare Tunnel or other relay is used.

## Wallpaper

Four `.webm` clips rotate by hour of day (dawn / noon / sunset / night).
Files live in `Backgrounds/`.

## Copyright & Rights

**© 2020–2026 Arutosio. All rights reserved.**

This repository contains the source code, design, copy, configuration and
assets that make up the personal portfolio site of **Arutosio**. It is
published publicly on GitHub for transparency and as a showcase — **not**
as an open-source template, starter, or reusable boilerplate.

### What is NOT allowed (without prior written permission)

- Cloning, forking, copying or mirroring this repository to publish or
  host a site that reproduces the whole or any substantial part of it
- Copying the design, layout, window manager mechanic, phase-bound window
  system, copy, or brand identity into another project (commercial or
  personal) in a recognisable way
- Reusing the source code — in whole or in part — in any public or
  private project
- Training machine-learning models on the content of this repository
- Deploying this site (or a derivative) to any domain other than the ones
  owned by the copyright holder
- Removing or altering these copyright and license notices

### What IS allowed

- Reading the code privately for personal study / curiosity
- Referencing the repository in articles, tutorials, or reviews with an
  appropriate credit and link
- Reporting bugs, opening issues, and sending pull requests **to this
  repository** (contributions become subject to the same terms)

### Third-party assets

Some media shown inside the site (notably the background video clips
under `Backgrounds/`) are short excerpts from animated works whose
copyright belongs to their respective owners. They are included for a
personal, non-commercial homage use. If you represent a rights holder
and want these removed, please open an issue.

Bundled third-party libraries (xterm.js, highlight.js, Font Awesome,
JSZip, Trystero, …) remain covered by their respective upstream licenses.

### Contact

For licensing inquiries, permission requests, or takedown notices,
reach out via [GitHub issues](https://github.com/Arutosio) or the
channels linked inside the site.

See the full license text in [`LICENSE`](./LICENSE).
