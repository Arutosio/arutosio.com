# Arutosio

Personal site for [Arutosio](https://github.com/Arutosio) built as a browser-based
desktop environment. Draggable, resizable, stackable windows over a time-of-day
wallpaper, a built-in terminal, a package system and an optional local daemon
that gives the OS real files and a real shell.

> ⚠️ **This is proprietary personal work, not an open-source template.**
> See [Copyright & Rights](#copyright--rights) below before touching anything.

## Stack

- **Static site** — vanilla HTML, CSS and JavaScript. No build step.
- **IndexedDB + localStorage** — packages, app data, settings, sessions.
- **Go daemon (`server/`)** — optional local mode: static host, filesystem API,
  server-side profile/session, PTY over WebSocket.
- **xterm.js** — real terminal rendering for local mode.
- **Package sandbox** — iframe `ctx` bridge, permissions, zip installer.

## Run

Hosted mode (the public site) is just static files:

```bash
python3 -m http.server 8080
open http://localhost:8080
```

Local mode (real files and shell on this machine):

```bash
cd server
./install.sh          # per-user systemd service, no sudo
```

or from a checkout without installing:

```bash
cd server
./arutosiod -web .. -root "$HOME" -data "$HOME/.arutosio"
```

See [`server/README.md`](./server/README.md) for the daemon, SSH tunnel,
security model and API.

## Project layout

```
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

## Local mode

`JavaScript/local.js` probes `/api/health`. When the site is served by
`arutosiod`, settings and app data live on the machine, Files browses real
directories, Grimoire edits real files, the Terminal is a real persistent PTY
and the System app manages processes, user services, terminal sessions and
trash. When the site is hosted on GitHub Pages, everything stays browser-local
as before.

### Updates

`arutosiod` checks the GitHub release feed every six hours. When a newer
release exists, the UI shows a toast and **System › Updates** offers
**Update now**: the daemon downloads the bundle for its architecture (daemon
plus site snapshot), verifies the SHA-256 published by GitHub, replaces both
and restarts. Login sessions survive the restart.

Releases are built by [`.github/workflows/release.yml`](./.github/workflows/release.yml)
when a `v*` tag is pushed:

```bash
git tag v0.4.0
git push origin v0.4.0
```

Disable checks with `-update-url ""`, or point them at a mirror returning the
same JSON shape as GitHub's latest-release endpoint.

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
