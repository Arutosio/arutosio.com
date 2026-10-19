# Tavern

Tavern is the bundled anonymous peer-to-peer chat. It's a default
package that ships both as a full app window and as a compact
[widget](./widgets.md). It has no backend: messages travel directly
between browsers over WebRTC, signaled through public BitTorrent
trackers via [Trystero](https://github.com/dmotz/trystero).

Think of it as a static-site-friendly common room — drop into a named
room, see who else is listening, send text. No accounts, no servers,
no sign-up, no logs on anyone's database.

See also:

- [Widgets](./widgets.md) — the widget role + its UI contract
- [Packages](./packages.md) — manifest schema
- [Architecture](./architecture.md) — host-side sandbox & registry

---

## What ships

- `defaultPackages/tavern/manifest.json` — roles `["app", "widget"]`,
  `unmountOnClose: true`
- `ui.js` — full app (sidebar + multi-room chat pane + setup flow)
- `widget.js` — compact pinned version (single active room)
- `chat.js` — shared `TavernChat` class (bundled into both entries by
  the iframe mini-bundler)
- `style.css` — shared tavern palette (dark + light)
- `trystero.torrent.min.js` — self-contained Trystero bundle
  (torrent strategy; jsdelivr `+esm` build, wrapped in an IIFE +
  namespace helper so `globalThis.__trystero.torrent.joinRoom` is
  reachable after the host strips ESM exports)

---

## User experience

### First join

Opening Tavern lands on a setup screen:

1. Pick a **nickname** (auto-generated if empty — `WanderingMage42` style)
2. Pick a **room** (any string — people who pick the same string meet)
3. Optional **password** — only peers using the exact same password land
   in the same swarm (Trystero namespaces the room internally by
   password, so `public` + `"secret"` is a different swarm from `public`
   with no password)
4. Click **Enter the tavern**

Nick + room + password are persisted in `ctx.storage` so the setup
screen is prefilled on reopen.

### Main view

After entering, the layout is:

```
┌────────── sidebar ──────────┬──────────── chat pane ───────────┐
│ Rooms         ⚙             │ # public     •                   │
│ ────────────                │ ─────────────────────────────── │
│ 🔒 # taverna      2  🟢  ×  │ Mage42: hello                    │
│    # arena          🔴  ×   │ Druid7: ciao                     │
│    # public         🟢  ×   │ → Rogue9 entered the tavern      │
│                             │                                  │
│ + add room                  │ [ Speak your piece…  ][ Send ]  │
│ password (optional)         │                                  │
└─────────────────────────────┴──────────────────────────────────┘
```

- **Row** = bookmarked room. Click the label to switch view.
- **🔒 lock icon** = this room has a password saved for it.
- **Peer-count badge** on green rows = live swarm head count. Click it
  to open the peer popover (nicks + "connected N minutes ago" + per-peer
  mute button).
- **Connection dot** = traffic light per row:
    - 🟢 green = this room is a live Trystero swarm right now
    - 🔴 red   = user explicitly disconnected from this room
    - ⚫ grey  = idle (never connected this session, or switched away)
- **× close** = remove the bookmark (tears the connection down if the
  row is live).

Compose form sends on whichever room is currently being viewed. Clicking
a row only switches the log view — connection is untouched. Clicking
the dot is the sole way to connect / disconnect a row.

### Multi-room

Every row can hold its own live Trystero connection at the same time.
Internally, `ui.js` keeps a `chats = Map<roomName, TavernChat>` with one
entry per connected room. Messages arriving on a non-viewed room are
buffered into a per-room log cache so switching back restores the
history you missed.

Send goes out on the viewed room only. If the viewed room isn't live,
the compose surface prints a gentle warning: "Not connected to this
room. Click the dot to connect."

### Preferences popover

Gear icon in the sidebar header opens:

- Sidebar position (left / right)
- Active strategy (informational — only `torrent` ships today)
- Show / hide activity messages (join / leave / moved / warnings)
- Your identity: nick + first 16 chars of the public-key thumbprint

### Widget

Settings → 🪄 Widgets → Tavern toggles the compact pinned view. The
widget runs a single TavernChat on the same stored `room` / `password`.
While the widget is alive it writes a heartbeat timestamp into
`ctx.storage._widgetAlive` every 8 seconds; the full app checks that
flag on unmount to decide whether to broadcast a `presence:leave` —
if the widget is still listening on the same room, closing the app
doesn't tell the swarm the user is gone.

---

## Security model

Tavern takes "anonymous" seriously but the transport is inherently
public. This section documents what the implementation guarantees and
what it can't.

### Identity

Every peer generates an **ECDSA P-256 keypair** the first time they
open Tavern. Both halves live in `ctx.storage._keyPair` (JSON Web Key
format) — the private half never leaves the browser, the public half
is the peer's identity. A SHA-256 thumbprint (RFC 7638 canonical form)
derives a stable short string used for:

- **Display color**: each peer's color is derived from the thumbprint,
  not from their nickname. Two peers sharing a nick still render in
  distinct colors so the audience can tell them apart.
- **Persistent blocklist**: muting a peer stores their thumbprint in
  `ctx.storage._blockedKeys`. Even if they reconnect with a different
  peerId they remain muted.
- **Identity lock**: once a peerId has been seen announcing with
  thumbprint X, any later presence from the same peerId with a
  different thumbprint is rejected and surfaced as a spoof attempt.

### Signed presence + messages

Every presence announcement and every chat message carries an ECDSA
signature over its canonical JSON (keys sorted alphabetically so both
ends serialize the same bytes). Presence on `join` also carries the
sender's public JWK, so the receiver can import it and verify every
subsequent message from that peerId:

- Messages whose signature doesn't verify are dropped silently.
- Messages arriving before the sender's presence:join (so no public
  key on file) are dropped silently.
- `presence:leave` is verified against the stored key as well, so a
  malicious peer can't forge someone else's departure.

### Anti-replay

Every signed payload carries a `ts` timestamp. Receivers reject
anything more than **5 minutes** away from their local clock. A
trakcer-observing attacker can't re-send a captured message to fool
receivers into thinking the peer is still present.

### Rate limit

Each peer is allowed at most one accepted message every **200 ms**.
Bursts above that are silently dropped — stops a single malicious
peer from flooding the log + renderer.

### Payload validation

Before signature check, every incoming message and presence is
validated strictly:

- All required fields present with the right JS type (`text`, `nick`,
  `color`, `ts` number, `sig` string; presence adds `type`, and
  `join` also needs a `pub` JWK with `kty: EC` + `crv: P-256`)
- Length caps: text ≤ 1000, nick ≤ 32, color ≤ 48
- Color must match the canonical regex for `#hex` / `rgb()` / `rgba()`
  / `hsl()` / `hsla()` (no `url(` / no `;` escape of the style attribute)

Malformed → silent drop. The cost is signature verification never
runs on garbage payloads, so a bad peer can't exhaust crypto by spamming
nonsense.

### Display sanitation

Even after a valid signature, text and nick pass through
`tavernSanitize` before being appended to the log. That strips:

- Bidi override characters (`\u202A-\u202E`, `\u2066-\u2069`) that
  could reverse displayed text — classic phishing display trick
  (`abc@evil.com` rendered as `moc.live@cba`)
- Zero-width spaces and joiners (`\u200B-\u200D`, `\uFEFF`) that can
  make two nicks look identical while having different codepoints
- ASCII control characters (`\u0000-\u001F`, `\u007F`) that can break
  log layout

The signature is checked on the **original** received bytes — so tamper
detection still works — and the sanitized version is what the user
ever sees.

### Muting

Clicking 🔇 next to a peer in the peers popover:

- Adds their peerId to a session-only `blockedPeers` Set
- Adds their thumbprint to the persistent `blockedThumbs` Set
  (`ctx.storage._blockedKeys`)

Both checks run on every inbound message. Clicking 🔊 reverses both.

### unmountOnClose

The Tavern manifest declares `unmountOnClose: true`. Clicking × on the
Tavern window triggers `sandbox.unmount(id)` in addition to hiding the
window — the iframe is destroyed and every live `chats` instance runs
`destroy()` (which announces a signed `presence:leave` to each swarm
unless the widget heartbeat is fresh). Next time the user opens the
window they land on the setup screen with no connection in flight.

Without the flag, the iframe would stay alive in the background after
closing the window — keeping every swarm connected and broadcasting
presence. Not acceptable for a chat app.

---

## Threat model — what is NOT covered

These follow from the design of peer-to-peer browser chat and can't
be mitigated without adding infrastructure the project explicitly
avoids:

1. **IP exposure.** WebRTC exchanges ICE candidates that include the
   peer's public IP. Anyone in the same room sees it. Hiding IP would
   require forcing every connection through a TURN relay, which needs a
   backend + bandwidth budget. Users are warned on the setup screen:
   *"Tavern is peer-to-peer. Your public IP is visible to everyone
   connected. Avoid sharing sensitive info."*
2. **Tracker metadata.** The public BitTorrent trackers (`tracker.
   openwebtorrent.com`, `tracker.webtorrent.dev`, etc.) see that the
   user is signalling for `appId: "aruta-tavern"` + `room: "X"`. They
   do not see message content (that goes direct over WebRTC DTLS, end-
   to-end encrypted by the browser) but they do see who's joining what.
3. **Sybil in public rooms.** A single attacker can generate N keypairs
   and walk into a public room as N distinct identities. Password
   protection mitigates this — the shared secret is the invitation, so
   only people with the password even find the swarm — but public
   rooms have no such gate.
4. **Keystore compromise.** The private key sits in IndexedDB under
   `aruta_app_tavern`. Anyone with physical access to the browser
   profile can read it. The key is marked extractable on purpose
   (so the portable profile `.zip` export can carry it and restore
   the same identity on another device); non-extractable would break
   that flow.

Password-protected rooms are the recommended setting for any
non-public conversation. Combine with a fresh browser profile (so
the keypair is unique to that session) for maximum anonymity.

---

## FAQ

**Why doesn't renaming myself propagate to everyone?**
Other peers have locked your identity to the first nick they saw from
your public key. The nick lock is deliberate — it's what prevents
someone else from hijacking your nick mid-session. Leaving the room
and rejoining re-announces a fresh presence and the new nick takes
effect.

**I'm connected but nobody's here.**
The status line walks through `connecting → searching → still alone`
up to 15 seconds. If the room has no peers online, your message is
still signed and sent but nobody receives it. Tavern warns you once:
"No one else is in this room yet — your message will only reach
travelers who join afterwards."

**Two computers on the same network can't see each other.**
The BitTorrent trackers might be blocked by the network or your
router's NAT is symmetric and refuses to punch through. Try another
network (e.g. phone hotspot) on one of the two as a quick diagnostic.

**Closing the window — does my data linger?**
With `unmountOnClose: true` the iframe tears down on close and every
swarm gets a signed leave announcement. Your identity keypair stays in
storage so the next session is still "you".
