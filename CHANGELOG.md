# Changelog

Keep-a-Changelog style. Site-level and bundled-package version history
go here — the most recent first.

The site itself is a static site (no build), so "version" references are
either git commit SHAs or the `version` field inside a package's
`manifest.json`.

## Site

### 2026-10 — Files explorer upgrade (`arutosiod` 0.5.7)

- **Files (1.8.0)**
  - Multi-selection: Ctrl/Shift+click, Ctrl+A, Escape to clear; the ⋯/right-click
    menu and drag & drop act on the whole selection, and Delete removes it
    after one confirmation. Folders now open on double-click or Enter, so a
    single click can select them.
  - Keyboard: F2 rename, Del delete, Enter open folder, Backspace up, arrow
    keys move the selection, Alt+←/→ history, type anywhere to filter. Ctrl+C,
    Ctrl+X and Ctrl+V copy, cut and paste, including between sources.
  - Back/forward buttons with per-source history.
  - Favorites: pin the current folder per source from settings and reopen it
    with one click.
  - Grid view with image thumbnails (small/medium/large) and a toolbar toggle.
  - Blank-area context menu: new file, new folder, paste, select all, refresh.
  - Settings now include grid view, thumbnail size and favorites.
  - Virtual folders that do not exist are reported instead of silently
    showing an empty list, so a start folder can fall back per source.
- Toasts are click-through except their close button, so they no longer block
  buttons underneath.

### 2026-10 — Dimmed dotfiles (`arutosiod` 0.5.6)

- **Files (1.7.1)** — hidden files and folders stay dimmed (55% opacity,
  full on hover/selection) when the hidden-files setting shows them, as in
  other file managers.

### 2026-10 — Files settings, menu and cursor fixes (`arutosiod` 0.5.5)

- **Files (1.7.0)** — new settings panel (⚙) with: a preview on/off switch that
  widens the list, hidden-files toggle for dotfiles, a start folder applied
  when switching source, and a "go to path" box for jumping anywhere inside
  the current source (`..` is rejected).
- The row context menu now opens at the pointer and is clamped inside the app
  window instead of spilling over its edge.
- The custom site cursor now follows the pointer inside app frames: the
  sandbox forwards mousemove once per frame and the host offsets it by the
  frame's position. Before, the dot froze at the frame edge and the pointer
  was invisible while over an app.

### 2026-10 — Update fallback fix (`arutosiod` 0.5.4)

- Fixed the rate-limit update fallback: it built
  `releases/download/<version>/` instead of `.../v<version>/`, so a check
  made while the GitHub API was throttled reported a 404 and could not
  install. Added a unit test for the URL.

### 2026-10 — File icons, drag & drop (`arutosiod` 0.5.3)

- **Files (1.6.0)** — colored file-type and folder icons from a curated
  vscode-icons subset (MIT), exact-name/extension/compound-extension mapping,
  filter box and name/size sorting, drag to move files and folders, drop
  files/folders from the OS, drop a file on another source to copy it,
  draggable breadcrumb targets.
- **Grimoire (1.11.0)** — file-type/folder icons in the tree, drop a machine
  file from Files to open it, drop text files from the OS into the current
  virtual/disk workspace, a drop highlight over the editor, and the Preview
  tab renders Markdown (headings, lists, quotes, code, links) with sanitized
  HTML instead of showing its source.
- Icons are bundled in each package with their MIT notice; no CDN calls.
- Committed `tests/e2e.mjs`, which boots a throwaway daemon and checks the
  icon, drag & drop, search and Markdown-preview paths in Chromium.

### 2026-10 — Files/Grimoire stability (`arutosiod` 0.5.2)

- **Files (1.5.0)** — rename/delete for folders, name validation, duplicate
  detection, consistent overwrite prompts on upload, safer rename for profile
  and external folders, stale-preview guard, and immediate flush of the
  virtual workspace on source switch/unmount.
- **Grimoire (1.10.0)** — autosave is flushed before switching file/folder and
  on close/hide; unsaved documents are reused instead of re-read; moving an
  open file remaps its path; conflicts keep the local text and offer a reload;
  directory moves are cycle-guarded; machine files no longer expose broken
  tree actions; the launcher can reopen the saved virtual workspace and warns
  before replacing it.

### 2026-10 — `arutosiod` 0.5.1

- **PATH link** — the installer links `~/.local/bin/arutosiod`; `uninstall`
  removes the link only when it points at that installation.
- **Standalone uninstaller** — `curl -fsSL https://arutosio.com/uninstall.sh
  | bash` removes old pre-CLI installations too: systemd/pidfile, unit,
  binary, site, PATH link and the firewall rule it added. Data is kept unless
  `--purge` is passed.

### 2026-10 — Machine manager CLI (`arutosiod` 0.5.0)

- **`arutosiod` CLI** — `status`, `start`, `stop`, `restart`, `logs`, `url`,
  `token`, `version`, `doctor`, `lan`, `firewall`, `update`, `rollback`,
  `uninstall` and shell completions. `--json` on status/doctor/LAN/update.
  Legacy flags still start the daemon; `serve` is the explicit form.
- **LAN mode** — `arutosiod lan on` binds `0.0.0.0`, prints the LAN URLs,
  detects `ufw`/`firewalld` and asks before opening the port. `lan off`
  restores loopback and closes the rule it added. `status` and `doctor` show
  bind address, LAN URLs, firewall state and service state.
- **Installer prompts** — the one-liner now asks for confirmation, LAN
  exposure and firewall changes. `--yes`, `--lan`, `--open-firewall` and
  `--no-firewall` support automation. The installer writes `config.json` so
  the CLI knows the install paths and port.
- **Clean uninstall** — `arutosiod uninstall` stops the service, removes the
  unit, binary and site, closes the recorded firewall rule, and keeps
  token/profile/trash unless `--purge` is passed.
- **Release fallback** — when the GitHub API is rate-limited, update checks
  fall back to the signed `version.txt`/bundle URLs instead of failing.

### 2026-10 — Local mode (`arutosiod` 0.4.1) + rebrand

- **One-command install** — `curl -fsSL https://arutosio.com/install.sh | bash`
  downloads the latest signed release, verifies its Ed25519 signature and
  SHA-256, installs the daemon and site under `~/.arutosio`, and starts a
  systemd user service (or a background process). It reports missing
  dependencies instead of installing them.
- **Local mode** — the site is served by the machine itself
  (`http://localhost:7777` over an SSH tunnel, no relay). `server/` adds a Go
  single-binary daemon (linux amd64/arm64/armv7) that serves the static site,
  a token→cookie auth flow, CSRF checks, a confined filesystem API with ETag
  and trash, per-machine profile/app-data/appearance storage, per-device
  window sessions and a PTY WebSocket. `server/install.sh` installs it as a
  systemd user unit or with `--no-service`.
- **Files / Grimoire** — in local mode the “This machine” source browses real
  directories; Grimoire opens, saves and restores real files with
  conflict detection.
- **Terminal** — xterm.js connects to a real shell. The daemon keeps the PTY
  after the browser disconnects, so a reload reattaches to the same session
  and replays recent output (512 KB buffer, `-term-idle` 24h).
- **System app** — overview (host, CPU, load, memory, disk, profile/trash
  size), top processes with kill, user systemd units with
  start/stop/restart, terminal sessions with kill, and trash list/restore/
  empty.
- **Updates** — `arutosiod` checks the GitHub release feed every six hours,
  the UI shows a toast when a newer version exists and System › Updates can
  download, checksum-verify and install it in place. Sessions are persisted so
  the browser stays signed in across the restart. `release.yml` publishes the
  three Linux builds and their checksums on every `v*` tag.
- **Rollback** — the previous binary and site snapshot stay as `*.old`;
  System › Updates can restore them without losing the session.
- **Signed releases** — `release.yml` signs `checksums.txt` with Ed25519
  (`ARUTOSIO_SIGNING_KEY`); the daemon embeds the public key and refuses
  bundles with a missing or invalid signature.
- **Profile import in local mode** — importing a `.zip` now pushes settings,
  app data and appearance to the daemon before reloading, so the import is not
  overwritten by the machine profile.
- **Start menu search** — filter apps by name, Enter opens the first match.
- **Rebrand** — every user-visible name, storage key, database name, package
  id and P2P namespace is now Arutosio; `migration.js` moves the previous
  namespace and renamed game data one time.

### 2026-04 — Widget system + Tavern

- **Widget role** added as a third manifest role alongside `app` +
  `command`. New `widget` manifest block (`defaultWidth/Height`,
  `minWidth/Height`, `defaultAnchor`), new `entries.widget` entry
  path, new Settings → Widgets tab to enable/disable per package.
  Positions persist via `localStorage.arutosio_widgets` and sync through
  the portable-profile folder mirror. See [docs/widgets.md](./docs/widgets.md).
- **`unmountOnClose` manifest flag** — opt-in teardown on × close so
  apps holding live network state (Tavern) never linger in background.
  Default off; existing apps unaffected.
- **`sandbox.mountWidget` / `unmountWidget`** in `JavaScript/sandbox.js`,
  parallel `_mountedWidgets` Map; `broadcastTheme` + `broadcastInstallChange`
  now cover both apps and widgets.
- **Mini-bundler regex extended** in `IFRAME_BOOT` to strip inline
  `export { ... }` / `export default null` patterns produced by
  Rollup/Terser minified ESM bundles (required for the Trystero build).
- **Accessibility / perf pass** across the site shell: `prefers-reduced-motion`
  global guard, light-theme contrast bump (WCAG AA), touch targets
  ≥ 44 px on coarse pointers, portrait `width/height` to kill CLS,
  `og:image` dimensions, rAF cancel on `desktop.js` ring animation,
  unmount cleanup in snake / grimoire / ultima-arutosio.

## Packages

### tavern

- **2.1.0** — `unmountOnClose: true`; closing the window tears the
  iframe down and signs a `presence:leave` on every live room.
- **2.0.0** — Multi-room. `ui.js` switches from a single `chat`
  instance to a `chats: Map<roomName, TavernChat>`. Each bookmarked
  row can hold its own live Trystero swarm in parallel; row click is
  pure view switch, status dot is pure connection control. Per-room
  log cache lets the user browse history of a room they're not
  connected to.
- **1.7.x** — View/connection split (row click stops toggling
  connection); banner dot mirrors sidebar palette; double-write of
  connect/disconnect notices (source room + current view).
- **1.6.x** — Status-dot trio (green live / red disconnected / grey
  idle); 🔒 lock glyph on password-protected rooms; × / reconnect on
  every row; compact row padding.
- **1.5.0** — Per-room password (`roomPasswords` map). Typing a
  password on an existing row reconnects via the new swarm
  namespace.
- **1.4.x** — Seconds in timestamps (HH:MM:SS); identity-derived
  colors (each peer's color comes from their public-key thumbprint
  so same-nick peers still differ visually); semantic system-message
  palette (info / success / warning / error glyphs + colors).
- **1.3.1** — Send button swapped from `<form submit>` to `<button>`
  + keydown Enter so the iframe sandbox doesn't swallow the submit.
- **1.3.0** — Preferences popover (gear icon in sidebar header):
  sidebar side Left/Right, show-activity-messages toggle, identity
  read-out. Default sidebar side switched to right.
- **1.2.x** — Crypto hardening: ECDSA P-256 keypair per user stored
  in `ctx.storage._keyPair`; every presence + message is signed;
  anti-replay ±5 min; per-peer rate limit 200 ms; persistent peer
  blocklist by public-key thumbprint; strict payload validation;
  display sanitizer (bidi overrides, zero-width chars, control
  chars) + strict color regex.
- **1.2.x** — Tracker list override: switched from the dead
  `tracker.btorrent.xyz` to the current working set
  (`openwebtorrent.com`, `webtorrent.dev`, `files.fm:7073`,
  `ghostchu-services.top`).
- **1.2.x** — MQTT and Nostr strategies dropped — their jsDelivr
  `+esm` bundles kept unresolved external imports that the host
  mini-bundler can't inline. Only `torrent` ships right now.
- **1.1.0** — Signaling strategy picker infra + diagnostic status
  phases (connecting → searching → stuck).
- **1.0.0** — Initial ship: manual join from setup screen,
  per-peer presence announcements, peer count badge + roster
  popover with "connected N minutes ago", muting via per-session
  peerId.

### Other bundled packages

All the bundled default packages received an overflow/responsive pass
around the same period:

- `snake` — theme-aware canvas palette (dark/light), unmount
  cleanup, storage await fix.
- `grimoire` — unmount cleanup (timers, observers).
- `ultima-arutosio` — storage error logging (previously swallowed),
  misc movement system fixes.
- `packagestore` — responsive sidebar breakpoints for mobile.

---

## Format notes

This file is kept terse on purpose. For the commit-level diff, use
`git log` / `git log -- path/to/file`. Version bumps inside a
package's `manifest.json` also force a fresh reinstall through
`defaults.bootstrap` — the user's IndexedDB copy gets rewritten on
next boot.
