# Packages — Apps & Commands

aruta.sh can be extended at runtime by anyone. Users drop a `.zip` on the desktop, confirm the install, and a new app or command is permanently available until uninstalled. No build pipeline, no server, no dev tooling required — just an editor and a zip utility.

This doc covers **how to build your own package**. See also:

- [`ctx` API reference](./ctx-api.md)
- [Permissions](./permissions.md)
- [Examples](./examples.md)
- [Architecture](./architecture.md) (internals)

---

## Three kinds of package

| Type | Runs in | Has UI | Typical use |
|---|---|---|---|
| **app** | `<iframe sandbox="allow-scripts allow-modals">` inside an OS window | yes | games, tools, mini-apps |
| **command** | main thread, invoked from the Terminal | no | shell utilities, automations |
| **widget** | `<iframe>` in a compact floating `.widget-frame` | yes, compact | chat presence, clocks, glanceable status — see [widgets.md](./widgets.md) |

All share the same zip format and the same `ctx` API. A single package
can declare more than one role (see the [Multi-role](#multi-role-packages)
section below).

---

## Zip layout

```
mypackage.zip
├── manifest.json     ← required
├── index.js          ← required (entry module)
├── style.css         ← optional (apps only — auto-injected into the iframe)
└── assets/           ← optional (images, audio, json, …)
```

The zip **must** contain `manifest.json` and the entry module at its root (not nested in a folder). If you zip a folder on Windows, make sure you zip the *contents* of the folder, not the folder itself.

---

## `manifest.json`

```json
{
    "type": "app",
    "id": "snake-game",
    "name": "Snake",
    "icon": "🐍",
    "version": "1.0.0",
    "author": "Your Name",
    "entry": "index.js",
    "permissions": ["storage", "notifications"]
}
```

| Field | Required | Rules | Notes |
|---|---|---|---|
| `type` | ◐ | `"app"` \| `"command"` | legacy — still accepted. Modern manifests declare `roles` instead. |
| `roles` | ◐ | `string[]` from `"app"`, `"command"`, `"widget"` | modern replacement for `type`. At least one of `type` or `roles` must be present. A package can declare multiple roles to ship a hybrid app + CLI, or a widget alongside a full app. `"widget"` requires SDK 2+. |
| `entries` | — | `{ [role]: filename }` | optional per-role entry override. Keys must be a subset of `roles`. Falls back to `entry` / `index.js`. |
| `commandAlias` | — | string | short name the terminal uses for this command (e.g. `"pkg"` for a package id like `"packagestore"`). Only meaningful when `roles` includes `"command"`. The aliases `pkg`, `roll`, `fortune` are **reserved** for their bundled-hybrid owners (`packagestore`, `dice-roller`, `oracle`) — any other package claiming them is rejected at install. Non-reserved collisions log a warning and the newer manifest wins. |
| `id` | ✅ | `^[a-z0-9][a-z0-9_-]{1,40}$` | must be unique; reinstalling overwrites |
| `name` | ✅ | non-empty string | display name in Start menu / Terminal |
| `icon` | — | string | emoji or any single glyph |
| `version` | ✅ | non-empty string | free-form (`"1.0.0"`, `"2025-01-beta"`, …) |
| `author` | — | string | free-form |
| `entry` | — | path inside zip | defaults to `index.js`. Shared fallback when `entries` is omitted. |
| `permissions` | — | string[] | must be strings from the known-permission set in `sandbox.js:PERM_REQUIRED` — unknown values reject at install time. Still gated at runtime regardless of declaration. |
| `allowOrigin` | — | boolean | opt-in: relax the iframe sandbox to `allow-scripts allow-same-origin allow-modals`. Required for `showDirectoryPicker` / FS Access API. See below. |
| `unmountOnClose` | — | boolean | opt-in: clicking × on the window tears the iframe down via `sandbox.unmount(id)` in addition to hiding it. Use for apps that hold background state you DON'T want lingering after close — most notably live network connections (Tavern's Trystero swarms, any WebSocket / SharedWorker app). Default `false` (iframe stays in memory so state survives close/reopen). |
| `widget` | — | object | Optional widget sizing + initial anchor hints. Only valid when `roles` includes `"widget"`. Full schema: [widgets.md](./widgets.md#manifest-additions). |
| `category` | — | string | one of `info`, `games`, `tools`, `creativity`, `system`, `other`. Unknown values log a warning and fall back to `other`. |
| `sdk` / `minSdk` | — | integer (default `1`) | minimum host SDK version this package expects. Install is **rejected** if the host SDK is older. See "SDK versioning" below. |

Declared `permissions` are shown in the install modal so users know upfront what the package *might* ask for. It's not a grant — every capability is still prompted the first time it's actually used (iOS-style).

---

## Writing an **app**

ES module, default export an object with a `mount` function:

```js
export default {
    async mount(root, ctx) {
        // `root` is a <div> that fills the window — it's yours.
        root.innerHTML = `
            <style> h1 { color: gold; } </style>
            <h1>Hello, ${ctx.appId}!</h1>
            <button id="go">Save</button>
        `;

        root.querySelector('#go').addEventListener('click', async () => {
            await ctx.storage.set('clicked', Date.now());
            await ctx.toast('Saved!', 'success');
        });
    },

    unmount() {
        // Optional. Most apps don't need this — the whole iframe
        // is torn down when the window closes.
    }
};
```

### Sizing and layout

The host does **not** force a size on your app. You get an iframe filling the window — if the window is resized, your CSS (or `ResizeObserver`) must react. See `packages/arcane-snake` for a working pattern: the canvas listens on its container and snaps to a grid multiple.

### CSS

If your zip contains a top-level `style.css`, it's auto-injected into the iframe's `<head>`. For more files, import them yourself:

```js
async mount(root, ctx) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ctx.asset('styles/extra.css');
    document.head.appendChild(link);
}
```

### Assets

Use `ctx.asset(path)` to get a blob URL you can drop into `<img src>`, `<audio src>`, `fetch()`, etc.

```js
const img = new Image();
img.src = ctx.asset('assets/dragon.png');
root.appendChild(img);
```

---

## Writing a **command**

```js
export default {
    async run(args, ctx) {
        const name = args[0] || 'wanderer';
        await ctx.print('Hello, ' + name + '!');
        await ctx.toast('Greeted ' + name, 'success');
    }
};
```

- `args` is a string array, already tokenized (quoted strings are respected: `greet "Stefano Aruta"` → `args[0] === 'Stefano Aruta'`).
- Commands are invoked from the Terminal as `<id> [args...]` — or as `<commandAlias> [args...]` when the manifest declares one.
- `run()` can be async; the terminal waits for completion before showing the next prompt.
- Built-in command names (`help`, `clear`, `install`, …) take precedence and cannot be shadowed.

---

## Multi-role packages

A single package can declare **more than one role** by listing them in `roles`. Today the supported roles are `"app"` (windowed app in the desktop), `"command"` (CLI entry reachable from the Terminal), and `"widget"` (compact draggable floating frame — see [widgets.md](./widgets.md)). The hybrid case — a package that ships multiple surfaces against the same id, storage, and permissions — is what the bundled **Package Manager** uses:

```json
{
    "id": "packagestore",
    "name": "Package Manager",
    "icon": "📦",
    "version": "2.0.0",
    "minSdk": 2,
    "roles": ["app", "command"],
    "entries": { "app": "ui.js", "command": "cli.js" },
    "commandAlias": "pkg",
    "category": "system",
    "permissions": ["fetch", "storage", "notifications", "install", "terminal"]
}
```

Key points:

- `roles` is the modern schema. Legacy manifests using `type: "app" | "command"` keep working forever — at boot they are normalized into `roles: [type]`, so every downstream check reads `roles.includes(...)`.
- `entries.<role>` lets each role point at its own source file. Useful because app code runs inside a sandboxed iframe while command code runs on the host thread — mixing both into one file works but is fragile.
- `commandAlias` separates the **package id** (technical, unique across the registry) from the **terminal verb** the user types. `packagestore` is the id; `pkg` is what you type.
- Storage is shared: both roles open the same `aruta_app_<id>` IndexedDB, so settings persisted by the app show up in the CLI and vice versa.
- Permissions are the union of everything either role needs. A hybrid package that calls `ctx.print` from its CLI must still declare `"terminal"` in `permissions`.
- Hybrid packages require `minSdk: 2`. Older hosts reject install up-front instead of running half the package.

### Bundled hybrids

The default package set ships four hybrids so the Start-menu app and the Terminal verb / widget stay in sync by construction:

- `packagestore` + `pkg` — Package Manager (app) with the `pkg` CLI (alias).
- `dice-roller` + `roll` — visual Dice Roller (app) with the `roll` CLI (alias).
- `oracle` + `fortune` — Oracle (app) with the `fortune` CLI (alias).
- `tavern` (app + widget) — anonymous P2P chat window + compact pinned widget sharing identity and bookmarks. See [tavern.md](./tavern.md).

On boot, the defaults loader also **prunes orphan defaults** — any installed manifest still tagged `_origin: "default"` whose id no longer appears in `defaults.json` is uninstalled automatically (unless the user explicitly blacklisted it by uninstalling it manually). User-installed packages (`_origin: "user"`) are never touched, even if they share an id with a removed default.

---

## Packaging & installing

### Create the zip

Zip **the contents** of your package folder, not the folder:

```bash
# inside mypackage/
zip -r ../mypackage.zip .
```

Windows PowerShell:

```powershell
Compress-Archive -Path .\mypackage\* -DestinationPath .\mypackage.zip
```

### Install

Four ways, all equivalent:

1. **Drag & drop** the `.zip` anywhere on the desktop.
2. **Terminal** → `install` → pick the file.
3. **Settings → 🔐 Permissions → Install package**.
4. **📦 Package Store** — browse & install from a remote repo, or sideload a `.zip` URL.

All trigger the install confirmation modal, which shows the manifest details and declared permissions.

Reinstalling an existing `id` replaces the package (update flow).

---

## Managing installed packages

Install, update and uninstall all flow through the **📦 Package Store** (System category) or the **`pkg`** CLI. Settings → 🔐 Permissions manages only per-app permission grants.

- **📦 Package Store → Installed** — a single unified view for every installed package *and* every uninstalled default. Filter chips (`All` / `User` / `Defaults` / `Updates`) scope what's shown; each row carries the right action for its state (Uninstall, Update, or Reinstall-default).
- **Settings → 🔐 Permissions** — per-permission toggles for each installed app/command. No install/uninstall UI here; use the Package Store.
- **Terminal built-ins:**
    - `apps` — list installed apps
    - `commands` — list installed commands
    - `permissions <id>` — show an app's current grants
    - `uninstall <id>` — remove a package
    - `pkg` — apt-style frontend (see below)
- **Wipe Settings Only** (Settings → Reset) preserves packages & permissions.
- **Wipe All** erases everything, including packages.

---

## Debugging

- Errors during `mount()` are caught and shown in the app window as a red stack trace. The host also logs them to the browser console.
- `console.log` / `console.error` inside an app go to the main DevTools console (iframe shares the console).
- `ctx.storage` persists in a dedicated IndexedDB named `aruta_app_<id>` — you can inspect it in DevTools → Application → IndexedDB.

---

## Host-level behaviors apps can rely on

- The host respects `prefers-reduced-motion` (parallax, click spells, circle rotation turn off) and sets `.is-reduced-motion` on `<html>` so your own CSS can follow suit: `@media (prefers-reduced-motion: reduce) { … }` works inside your sandbox too.
- `<html>` also carries `.is-mobile` and `.is-touch` classes synced with the viewport / pointer type. Useful from inside your app when you want to match the host's layout decisions.
- Keyboard focus shows a consistent gold outline on all interactive elements. If you add buttons in your app, simply leaving `:focus-visible` to the browser default is fine — the host style cascade doesn't reach inside your sandboxed iframe, but the convention is worth matching for visual parity.

## `manifest.allowOrigin`

Apps run in `<iframe sandbox="allow-scripts allow-modals">` — opaque origin, fully isolated, but with `prompt`/`alert`/`confirm` enabled (browsers block modals in sandboxed iframes by default). A handful of browser APIs refuse to run in a null-origin frame; the most notable is the **File System Access API** (`showDirectoryPicker`, `showOpenFilePicker`, etc.), which the bundled `grimoire` app uses to open real folders on disk.

Set `"allowOrigin": true` in your manifest to widen the sandbox to `allow-scripts allow-same-origin allow-modals`. The host shows this flag in the install modal so users can decide whether to trust the package with shared-origin access.

```json
{
    "type": "app",
    "id": "myeditor",
    "name": "My Editor",
    "entry": "index.js",
    "permissions": ["storage", "notifications"],
    "allowOrigin": true
}
```

When the flag is on:
- The iframe shares the host's origin → it can access `localStorage`, reach `window.parent`, and use APIs that demand a non-opaque origin.
- The `ctx` permission gate still applies for documented capabilities — `allowOrigin` doesn't grant any `ctx.*` method automatically.

Use only when you actually need it. The bundled `grimoire` package is the canonical example.

## SDK versioning

The host tells every app its SDK version at init time via `ctx.sdkVersion` (integer). The current host SDK is **1**.

- Default — apps don't need to do anything. Omit `sdk` and you'll be treated as a v1 package.
- **Pinning** — set `"sdk": N` in your manifest to declare the minimum host contract you expect. If the host is older than `N`, it logs a warning to the console but still mounts your app (so older hosts can at least try to run newer packages — they'll just hit missing surfaces).
- **Branching** — inside your code, `ctx.sdkVersion` lets you feature-detect host capabilities without sniffing globals:

    ```js
    async mount(root, ctx) {
        if (ctx.sdkVersion >= 2) {
            // use newer ctx.* surface
        } else {
            // fallback for older hosts
        }
    }
    ```

Versions are bumped by the host **only on breaking changes** to the `ctx` contract or init payload. Purely additive surfaces don't bump the number.

## Theme contract

Every app iframe receives the host's current theme automatically:

1. **At mount** — the `init` payload includes `theme: 'light' | 'dark'`. The bootstrap writes it to the iframe's `<html data-theme="...">` *before* your `style.css` loads, so your first paint matches the host.
2. **On change** — when the user toggles the theme (or the OS theme flips while follow-OS is active), the host postMessages every mounted iframe and the bootstrap re-applies `data-theme`.

You don't need any permission for this. To style for both themes:

```css
:root { color: #e8e2d4; background: #1a1206; }
:root[data-theme="light"] { color: #2a1f10; background: #f7efe0; }
```

If you want to *read* the current theme programmatically or *change* it, use `ctx.theme.get()` / `ctx.theme.set()` — both gated by the `theme` permission. See [ctx-api.md](./ctx-api.md#theme--requires-theme).

## Limitations

- Package files are stored as Blobs — very large packages (hundreds of MB) are possible but not recommended.
- Dynamic `import()` inside the iframe requires correct MIME types; the installer sets them when unpacking — you don't need to do anything special.
- You can't call host `window`/`document` directly from an app (it's a different origin). Use `ctx` for everything.
- Commands *do* run in the main thread and have access to global JS, but you should still use `ctx` — capabilities go through the permission gate there too.

---

## Repository format (Package Store)

The bundled **Package Store** app (System category) and the **`pkg`** CLI command both install packages from user-added *repositories*. A repository is just a JSON file at a stable URL that lists packages and where to download each `.zip`. The repository **list itself** is a system concern: it lives in `localStorage.aruta_repos` and is exposed via `window.repos` (host) / `ctx.repos.*` (apps + commands, gated by the `install` permission). Package Store no longer owns the list privately — any package with `install` can read or mutate it.

### Schema

```json
{
    "name": "Official Aruta Packages",
    "description": "Curated bundle by Aruta",
    "packages": [
        {
            "id": "neat-app",
            "name": "Neat App",
            "icon": "🌟",
            "version": "1.2.0",
            "type": "app",
            "category": "tools",
            "author": "someone",
            "description": "One-liner pitch.",
            "url": "neat-app-1.2.0.zip",
            "homepage": "https://example.com/neat-app",
            "permissions": ["fetch"],
            "allowOrigin": false,
            "size": 12345
        }
    ]
}
```

### Field rules

| Field | Required | Notes |
|---|---|---|
| `name` | — | Repository display name |
| `description` | — | Free-form; shown to users |
| `packages` | ✅ | Array of package entries |
| `packages[].id` | ✅ | Matches the install `id` the zip's `manifest.json` declares |
| `packages[].name` | ✅ | Display name |
| `packages[].version` | ✅ | Compared against installed version to flag updates |
| `packages[].url` | ✅ | `.zip` location; **may be relative** to the repo JSON URL |
| Everything else | — | Purely informational — the authoritative manifest is the one inside the `.zip` |

### Hosting

- **GitHub raw** — put `index.json` and the `.zip` files at the root of a repo (or any subfolder), then point users at `https://raw.githubusercontent.com/<user>/<repo>/<branch>/<path>/index.json`. Relative `url`s resolve automatically. The bundled example repo lives in this source tree at `packages/index.json` and is served via `https://raw.githubusercontent.com/Arutosio/aruta.sh/master/packages/index.json`.
- **Any static host** (S3, Netlify, a plain `www` folder) works — just serve the JSON with `Content-Type: application/json` and the zips with whatever type (the installer reads bytes, not headers).
- Respect `ETag` / `Last-Modified` if you can: the Package Store sends `If-None-Match` on refresh for lightweight update checks.

### Trust model

The repo index is advisory. The *real* manifest lives inside the `.zip` and goes through the existing install-confirm modal — declared vs. actual permissions cannot be silently swapped. A rogue repo can only propose installs; the user still approves each one.

---

## CLI: `pkg` command

The `pkg` default command is an apt-style frontend over the system repos module. It runs in the Terminal and supports:

| Subcommand | Purpose |
|---|---|
| `pkg list` | List installed packages (id, name, version, type) |
| `pkg search <query>` | Search every enabled repo for packages whose id/name/description matches |
| `pkg install <id\|url>` | Install by package id (newest version across enabled repos) or by direct `.zip` URL |
| `pkg update [<id>]` | Upgrade all installed packages (or one by id) to the newest version found in any enabled repo |
| `pkg remove <id>` | Uninstall a package |
| `pkg repo list` | List configured repositories |
| `pkg repo add <url>` | Add a repository (http/https) |
| `pkg repo remove <url>` | Remove a repository |
| `pkg repo refresh [<url>]` | Re-fetch one or all enabled repositories |
| `pkg help` | Show usage |

Every install still surfaces the standard install-confirm modal — `pkg` does not bypass it.
