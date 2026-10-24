# arutosiod — local daemon

Local daemon for Arutosio OS. It serves the static site, a filesystem API, a
server-side profile/session store and a real PTY over WebSocket. Loopback only
by default; every API call needs a session cookie or the access token.

## Install on this machine

One command, no checkout and no Go toolchain:

```bash
curl -fsSL https://arutosio.com/install.sh | bash
```

The bootstrap downloads the latest signed release, verifies the Ed25519
signature on `checksums.txt` and the SHA-256 of the bundle, then:

- installs the binary in `~/.arutosio/bin/arutosiod`;
- installs the site in `~/.arutosio/current/web`;
- creates and enables a systemd **user** unit when available, otherwise
  starts a background process and writes `~/.arutosio/arutosiod.log`;
- keeps `token`, `profile`, `trash` and `sessions.json` across re-installs;
- prints the local URL, the token, and the SSH tunnel command.

It never installs packages. If `curl`, `tar`, `gzip`, `openssl`, `coreutils`
or `gawk` are missing it prints the package-manager command and stops.

Options: `--port PORT`, `--prefix DIR`, `--version TAG`, `--no-service`.

From a checkout (development only):

```bash
cd server
./install.sh
```

This builds the binary if Go is available and copies the current site; it
accepts the same `--port`/`--prefix`/`--no-service` options.

For boot without an interactive login:

```bash
sudo loginctl enable-linger "$USER"
```

Logs:

```bash
journalctl --user -u arutosiod -f
```

## Run from a checkout

```bash
cd server
go run . -web .. -root "$HOME" -data "$HOME/.arutosio"
```

If a local prebuilt binary is present (it is git-ignored):

```bash
cd server
./arutosiod -web .. -root "$HOME" -data "$HOME/.arutosio"
```

Open the URL printed at startup. The token is persisted in
`~/.arutosio/token` (mode 0600) when `-token` is not passed.

## Access from another machine

Use an SSH local forward; do not expose the port:

```bash
ssh -N -L 7777:127.0.0.1:7777 user@host
```

Then open `http://localhost:7777/?token=...` on the local machine.
`localhost` is a secure context, so clipboard, service workers and PWA
install work, and the traffic is encrypted by SSH.

This is the supported remote path. No Tailscale, Cloudflare Tunnel or other
third-party tunnel is used.

## What it does

- **Auth**: one-time token → HttpOnly `SameSite=Strict` session cookie +
  `X-Arutosio-CSRF` on mutations. Bearer/query token still works for curl and
  scripts. Login attempts are rate-limited.
- **Files**: list, stat, read, download (Range), write with `If-Match`/ETag,
  upload, mkdir, rename, trash. Symlinks are resolved and cannot escape
  `-root`.
- **Profile**: per-machine `localStorage` snapshot, per-app KV (Grimoire
  workspace, Tavern logs, …), appearance binaries and window sessions under
  `~/.arutosio/profile`.
- **Export**: `GET /api/profile/export` returns a zip of the server profile.
- **Terminal**: real PTY (`$SHELL -l`), resize, exit code, xterm.js at `/term`.
  Sessions are kept after the browser disconnects: reconnecting attaches to the
  same shell and replays up to 512 KB of recent output. Detached sessions are
  killed after `-term-idle` (default 24h). They do not survive an `arutosiod`
  restart.
- **System app**: overview (host, load, memory, disk, profile, trash, terminal
  sessions), process list with kill, user services with start/stop/restart,
  terminal session list with kill, and trash list/restore/empty. Process and
  service actions require the authenticated cookie + CSRF; `arutosiod.service`
  is protected from self-restart.
- **Updates**: checks `-update-url` (the GitHub latest-release feed by default)
  every six hours. System › Updates shows current/latest version and release
  notes. **Update now** downloads `arutosio-linux-<arch>.tar.gz`, verifies the
  Ed25519 signature on `checksums.txt` and the bundle SHA-256, replaces the
  binary and — for an installer-managed `-web` — the site snapshot, then
  re-execs. Sessions are persisted in
  `~/.arutosio/sessions.json` (mode 0600) so the browser stays signed in
  across the restart. The previous binary/site stay as `*.old`, and
  **Roll back** restores them. Set `-update-url ""` to disable checks.
- **Static site**: serves the Arutosio site; blocks dotfiles and `/server/`.

## Security

- Binds `127.0.0.1:7777` by default. Do not use `0.0.0.0` without a TLS
  reverse proxy and a real auth layer.
- The token is an SSH-equivalent secret: anyone with it gets a shell.
- `-root` limits the **Files API only**; the PTY is a full user shell and can
  `cd` anywhere the user can.
- Filesystem listing resolves symlinks and rejects paths outside `-root`.
- In local mode the site forces every package iframe to an opaque origin, so
  apps cannot read the session cookie or the host token. Machine access goes
  through `ctx.fs` and the host permission prompt.
- The `fs.read`, `fs.write` and `fs.delete` permissions are **never**
  auto-granted, even for bundled apps.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | public version/capabilities probe |
| `GET /api/session` | current session + CSRF |
| `POST /api/auth/login` | token → cookie |
| `POST /api/auth/logout` | drop the session |
| `GET /api/fs/roots` | allowed roots |
| `GET /api/fs/list` / `stat` | metadata |
| `GET /api/fs/read` / `download` | content / attachment |
| `PUT /api/fs/write` | atomic write, ETag preconditions |
| `POST /api/fs/upload` | streamed upload |
| `POST /api/fs/mkdir` / `rename` / `delete` | tree operations |
| `GET/PUT /api/profile/localStorage` | shared settings snapshot |
| `GET/PUT /api/profile/apps/<id>` | per-app KV |
| `GET/PUT /api/profile/session/<device>` | window layout per device |
| `GET/PUT /api/profile/appearance/<key>` | custom background/portrait bytes |
| `GET /api/profile/export` | profile zip |
| `GET /api/system/info` | host, CPU, memory, disk, profile/trash size |
| `GET /api/system/processes` | top processes by CPU |
| `POST /api/system/kill` | SIGTERM a process |
| `GET /api/system/services` | user systemd units |
| `POST /api/system/service` | start/stop/restart a user unit |
| `GET /api/system/trash` | trash size |
| `GET /api/system/trash/list` | recoverable trash entries |
| `POST /api/system/trash/restore` | restore an entry to its original path |
| `POST /api/system/trash/empty` | empty the trash |
| `GET /api/system/terms` | attached/detached terminal sessions |
| `POST /api/system/terms/kill` | kill a terminal session |
| `GET /api/update` | current/latest version, notes, apply/rollback capability |
| `POST /api/update/apply` | download, verify and restart into the new build |
| `POST /api/update/rollback` | restart into the previous saved build |
| `GET /ws/term` | PTY WebSocket (`session=` to attach) |
| `GET /term` | embedded xterm.js page |

## Flags

| Flag | Default | Purpose |
|---|---|---|
| `-listen` | `127.0.0.1:7777` | bind address |
| `-web` | `..` | static site root |
| `-root` | `$HOME` | filesystem API root |
| `-data` | `~/.arutosio` | token, profile, sessions, trash |
| `-token` | from data dir | override the access token |
| `-term-idle` | `24h` | kill detached PTYs after this idle time (`0` = never) |
| `-update-url` | GitHub latest release | release feed; `""` disables checks |
| `-update-pubkey` | embedded key | hex Ed25519 key for release checksums; `""` disables signatures |
| `-version` | — | print the version and exit |

## Release signing

Bundles are signed with Ed25519 before they are published:

1. Generate a keypair outside the repository:

   ```bash
   cd server
   go run ./cmd/gen-key ~/.arutosio/release-signing.key
   ```

2. Put the printed public key in `server/sign.go` (`embeddedUpdatePubkey`) —
   or pass it to the daemon with `-update-pubkey`.
3. Store the private seed as the repository secret used by the release
   workflow:

   ```bash
   gh secret set ARUTOSIO_SIGNING_KEY < ~/.arutosio/release-signing.key
   ```

`release.yml` writes `checksums.txt`, signs it into `checksums.txt.sig` and
publishes both with the bundles. The daemon refuses a release whose signature
is missing or invalid. To rotate the key, generate a new pair, update the
embedded public key and the secret, then publish a release.

## Still missing

- Windows/macOS packaging.
