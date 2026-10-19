# `ctx` API Reference

Every app and command receives a `ctx` object. All protected methods are async and trigger a runtime permission prompt the first time they're called. If the user denies a permission, a protected method resolves to `null` / `false` (or throws `permission_denied:<perm>` for `fetch` / `clipboard`).

---

## Meta

### `ctx.appId: string`
Your package id (the one from `manifest.json`).

### `ctx.sdkVersion: number`
Integer host SDK version (currently `2`). Apps can branch on this to feature-detect newer host surfaces without sniffing globals. A package can pin a minimum via `manifest.minSdk` / `manifest.sdk`; install is rejected if the host is older. `ctx.sdkVersion >= 2` means the host supports hybrid packages — manifests with `roles: ["app", "command"]`, per-role `entries`, and `commandAlias`. See [SDK versioning](./packages.md#sdk-versioning) and [multi-role packages](./packages.md#multi-role-packages).

### `ctx.asset(path: string): string | null`
Returns a blob URL for a file inside your zip. Useful for `<img src>`, `<audio src>`, etc. If `path` starts with `assets/` the leading segment can be omitted:

```js
ctx.asset('assets/dragon.png');  // same blob URL
ctx.asset('dragon.png');         // as this
```

Returns `null` if the file doesn't exist.

### `ctx.i18n(key: string): string`
Look up a translation from the host's i18n table (in the current UI language). Falls back to the key itself if missing. No permission needed.

### `ctx.permission.request(perm: string): Promise<boolean>`
Explicitly request a permission ahead of time. Same prompt as the runtime gate. Returns the user's decision.

---

## Terminal — requires `terminal`

### `ctx.print(text: string): Promise<void>`
Write a line to the Terminal output.

### `ctx.clear(): Promise<void>`
Clear the Terminal screen.

---

## Notifications — requires `notifications`

### `ctx.toast(msg: string, type?: 'info'|'success'|'warning'|'error'): Promise<void>`
Show a themed toast on the host UI.

---

## Windows — requires `windows`

### `ctx.openWindow(id: string): Promise<void>`
Open any installed window by id (including built-in ones like `about`, `settings`).

### `ctx.closeWindow(id: string): Promise<void>`
Close a window.

---

## Storage — requires `storage`

Per-app key-value store backed by IndexedDB `aruta_app_<your_id>`. Values go through structured clone — objects, arrays, `Blob`s, `ArrayBuffer`s all work.

### `ctx.storage.get(key: string): Promise<any | null>`
### `ctx.storage.set(key: string, value: any): Promise<boolean>`
### `ctx.storage.remove(key: string): Promise<boolean>`

```js
await ctx.storage.set('config', { volume: 0.7, difficulty: 'hard' });
const cfg = await ctx.storage.get('config');
```

---

## Network — requires `fetch`

### `ctx.fetch(url: string, opts?: RequestInit): Promise<Response>`

For apps (iframe) — returns a Response-like object with `.ok`, `.status`, `.text()`, `.json()`. Payloads are serialized across the sandbox boundary.

For commands (main thread) — returns the real `fetch` Response, so streaming / `response.body` work.

Denied → throws `permission_denied:fetch`.

---

## Theme — requires `theme`

### `ctx.theme.get(): Promise<'dark' | 'light'>`
### `ctx.theme.set(theme: 'dark' | 'light'): Promise<void>`

> **Automatic propagation (no permission needed):** the host always pushes the active theme to your iframe — once via the `init` payload before your CSS loads, and again every time the user (or the OS, when follow-OS mode is on) flips it. The bootstrap writes it onto your iframe's `<html data-theme="...">`, so a `:root[data-theme="light"] { … }` rule in your `style.css` is all you need to react. The `ctx.theme.*` permission only matters if you want to *read the value in JS* or *change* the host theme from your app. See [packages.md → Theme contract](./packages.md#theme-contract).

---

## Clipboard — requires `clipboard`

### `ctx.clipboard.read(): Promise<string | null>`
### `ctx.clipboard.write(text: string): Promise<boolean>`

Note: browsers may additionally require a user gesture; call these from an event handler.

---

## Failure model

```js
const data = await ctx.storage.get('foo');
if (data == null) {
    // Either the key doesn't exist, OR the user denied storage.
    // Both are safe to treat as "no data" for most apps.
}
```

To distinguish genuine denial from "no such key":

```js
const allowed = await ctx.permission.request('storage');
if (!allowed) { /* user said no */ }
```

---

## Packages & repos — requires `install`

### `ctx.installZip(blob: Blob, opts?: { filename?: string }): Promise<{id,name,version,type} | null>`
Submit a `.zip` to the host installer. Always shows the install-confirm modal — denial / cancel resolves to `null`.

### `ctx.listInstalled(): Promise<Array<{id, name, version, type}>>`
Snapshot every installed package.

### `ctx.repos.list(): Promise<Array<Repo>>`
Snapshot of the system repository list. Each entry: `{ url, name, description, enabled, addedAt, lastFetched, etag, cachedIndex }`.

### `ctx.repos.add(url: string, opts?: { name?, description?, enabled? }): Promise<Repo>`
Add a repo. URL must be `http(s)://`. Throws on duplicates.

### `ctx.repos.remove(url: string): Promise<boolean>`
### `ctx.repos.setEnabled(url: string, enabled: boolean): Promise<boolean>`
### `ctx.repos.update(url: string, patch: Partial<Repo>): Promise<Repo | null>`
Whitelisted fields: `name`, `description`, `enabled`, `lastFetched`, `etag`, `cachedIndex`, `lastError`, `displayName`.

> The repo list lives at the host level (`localStorage.aruta_repos`) and is shared between Package Store, the `pkg` CLI, and any future package that holds the `install` permission.

### `ctx.defaults.list(): Promise<Array<{id, name, icon, version, installed, blacklisted}>>`
Snapshot every package shipped in `defaultPackages/defaults.json` with its current state — `installed` (present in the registry) and `blacklisted` (the user has uninstalled it, so the boot path will skip it on next reload).

### `ctx.defaults.restore(id: string): Promise<{id,name,version,type,roles} | null>`
Reinstall a default package the user previously uninstalled. Removes the id from the blacklist and runs the bundled installer. Throws `not_a_default:<id>` if the id isn't in `defaults.json`.

---

### `ctx.install.listFiles(appId: string): Promise<Array<{path, size, mime}>>`
Enumerate the files of an installed package. Returns `[]` if the id isn't installed.

### `ctx.install.readFile(appId: string, path: string): Promise<{bytes: Uint8Array, mime: string}>`
Read a single file from an installed package's zip. Throws `not_found` if absent.

---

## Profile folder — requires `profile-fs`

Browse and mutate the FS Access folder the user linked via **Settings → Profile**. Writes go through the same DiskBackend that powers profile sync. Fails with `profile_not_linked` when no folder is connected.

### `ctx.profile.isLinked(): Promise<boolean>`

### `ctx.profile.list(path: string): Promise<Array<{name, kind: 'file'|'dir', size?: number}>>`

### `ctx.profile.read(path: string): Promise<{bytes: Uint8Array, mime: string}>`

### `ctx.profile.write(path: string, bytes: Uint8Array|string, mime?: string): Promise<void>`

### `ctx.profile.remove(path: string): Promise<void>`

---

## Handoff — requires `windows`

### `ctx.handoff(appId: string, payload: any): Promise<boolean>`
Pass a small JSON-serializable payload to another installed app and open its window. The host writes the payload to `localStorage.aruta_handoff_<appId>` and calls `openWindow(appId)`. The target app is expected to consume and clear the key on mount.

Payload cap: ~2 MB (throws `payload_too_large`). Target must be installed (throws `target_not_installed`).

Today the only documented consumer is **Grimoire**, which accepts `{ type: 'file', name, content, mime }` and injects the file into the user's virtual workspace.

---

## Context menu — no permission

### `ctx.contextMenu.show({ x, y, items }): Promise<string | null>`
Open a host-rendered context menu. Coordinates are iframe-local (`ev.clientX` / `ev.clientY` of the triggering event); the host translates them to the viewport and can extend the menu beyond your window's bounds.

`items` is an array of `{ id, label, icon?, danger?, disabled?, separator? }`. Items with `separator: true` render as dividers.

Returns the chosen item's `id` as a string, or `null` if the user dismissed the menu (click outside, Escape, scroll, blur). No permission required — it's pure UI surface.

> The browser's native right-click menu is suppressed inside app iframes (except on `<input>`, `<textarea>`, and `contenteditable` elements), so calling `ctx.contextMenu.show` is the expected replacement. Always `ev.preventDefault()` on your `contextmenu` listener before awaiting the call.

```js
el.addEventListener('contextmenu', async (ev) => {
    ev.preventDefault();
    const choice = await ctx.contextMenu.show({
        x: ev.clientX, y: ev.clientY,
        items: [
            { id: 'rename', label: 'Rename', icon: '✎' },
            { separator: true },
            { id: 'delete', label: 'Delete', icon: '🗑', danger: true },
        ],
    });
    if (choice === 'delete') { /* ... */ }
});
```

---

## What's NOT in `ctx`

Intentional omissions (to keep the surface small — you can still do these yourself inside your iframe / worker):

- DOM primitives (`document`, `window`) — use them directly inside your app
- Timers (`setTimeout`, `requestAnimationFrame`) — standard browser APIs
- Canvas / WebGL / Web Audio — standard browser APIs
- Web Workers — allowed inside the iframe sandbox

If you need a new host capability, see [architecture.md](./architecture.md) for how to add one.
