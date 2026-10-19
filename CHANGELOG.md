# Changelog

Keep-a-Changelog style. Site-level and bundled-package version history
go here — the most recent first.

The site itself is a static site (no build), so "version" references are
either git commit SHAs or the `version` field inside a package's
`manifest.json`.

## Site

### 2026-04 — Widget system + Tavern

- **Widget role** added as a third manifest role alongside `app` +
  `command`. New `widget` manifest block (`defaultWidth/Height`,
  `minWidth/Height`, `defaultAnchor`), new `entries.widget` entry
  path, new Settings → Widgets tab to enable/disable per package.
  Positions persist via `localStorage.aruta_widgets` and sync through
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
  unmount cleanup in snake / grimoire / ultima-aruta.

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
- `ultima-aruta` — storage error logging (previously swallowed),
  misc movement system fixes.
- `packagestore` — responsive sidebar breakpoints for mobile.

---

## Format notes

This file is kept terse on purpose. For the commit-level diff, use
`git log` / `git log -- path/to/file`. Version bumps inside a
package's `manifest.json` also force a fresh reinstall through
`defaults.bootstrap` — the user's IndexedDB copy gets rewritten on
next boot.
