# Portable Profile

aruta.sh keeps everything you've configured — preferences, installed packages, per-app data — in browser storage. The **Portable Profile** feature lets you take that whole state with you: sync it to a real folder on disk, or move it between browsers and machines as a `.zip`.

> Implementation: [`JavaScript/profile.js`](../JavaScript/profile.js), wired into Settings by [`JavaScript/os.js`](../JavaScript/os.js) (`initProfileSettings`). Zip codec: [`JavaScript/zip.js`](../JavaScript/zip.js) (STORE-only, no compression).

---

## What it is

A snapshot of your aruta.sh state, persisted as a small directory tree (or a `.zip` of the same tree):

```
profile.json                     ← version + timestamps + origin tag
localStorage.json                ← every aruta_* key (except aruta_summoned)
registry/
  manifests.json                 ← installed packages (manifest objects)
  files.meta.json                ← MIME map for the file blobs
  files/<appId>/<path>           ← raw package file bytes
apps/<appId>.json                ← per-app kv storage (ctx.storage)
appearance/                      ← user-customized look (optional)
  meta.json                      ← kind/mime/filename per asset
  background.<ext>               ← custom desktop background (image or video)
  portrait.<ext>                 ← custom hero portrait
```

There are two backends:

- **DiskBackend** — a real folder on your filesystem, picked via the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API). Writes are mirrored live as you use the OS. Chromium-only today.
- **ZipBackend** — manual export and import of a `.zip`. Works in every browser.

Both backends produce and consume the exact same layout, so a `.zip` you export from Firefox can be unpacked into a folder linked from Chrome, and vice-versa.

---

## Who is it for

- You use aruta.sh in more than one browser or on more than one machine.
- You want a backup before wiping the OS or trying a destructive package.
- You're a package author and want to round-trip state for testing.
- You'd rather your installed apps survive a `Clear site data`.

If you only use a single browser and never clear storage, you don't need the profile feature — local persistence already covers you.

---

## How to use it

Open **Settings → Profile**.

### Folder mode (Chromium: Chrome, Edge, Brave, Arc, Opera)

1. Click **Pick folder…** and choose an empty folder (or one that already holds an aruta profile).
2. The browser asks for read/write permission — Allow.
3. If the folder is empty, your current browser state is dumped into it.
4. If the folder already contains a `profile.json`, you're asked whether to **Load from folder** (folder wins, browser state is replaced) or **Overwrite folder** (browser wins, folder is rewritten).

From that point on, every change you make in the OS — installing a package, switching theme, completing a Snake high score, editing a Grimoire workspace — is debounced (~400 ms) and written through to the folder. Open the folder in another tool and you'll see the JSON / file blobs update in place.

### Zip mode (any browser)

- **Export** — Settings → Profile → **Export `.zip`**. Download lands as `aruta-profile-<timestamp>.zip`.
- **Import** — Settings → Profile → **Import `.zip`** → pick the file. After confirmation, your current state is **replaced** with the snapshot and the page reloads.

Zip mode is one-shot. There's no continuous sync — you re-export when you want a new snapshot.

### Boot-time auto-restore

If a folder handle is persisted from a previous session, on every page load aruta.sh:

1. Reads the saved handle from its private IDB (`aruta_profile`).
2. Calls `queryPermission()` (no prompt — boot must be silent).
3. If permission is still `granted`: reads the folder, restores into the browser, and reloads.
4. If permission is dormant: keeps the handle but flags the profile as **Disconnected**. Settings shows a **Reconnect** button that re-prompts.
5. If the folder is reachable but empty: writes the current browser state into it (treats it as a fresh link).

The reload-after-restore is intentional. It keeps the boot path simple — every module just sees the freshly-restored state.

---

## What's stored

| Source | What gets captured |
|---|---|
| `localStorage` | Every key starting with `aruta_` (theme, language, font, achievements, perms, terminal history, registry cache, …) |
| `aruta_packages` IDB | All installed package manifests + every file blob |
| `aruta_app_<id>` IDB | Each app's private `ctx.storage` kv store |
| `aruta_appearance` IDB | Custom background and portrait binaries set from Settings → Appearance |

## What's NOT stored

- `aruta_summoned` (sessionStorage flag) — intentionally excluded so the summoning intro replays after a restore on a new device.
- The `aruta_profile` IDB itself (where the folder handle lives) — handles are origin-bound and meaningless on another machine.
- Browser cookies, service-worker caches, anything outside the `aruta_` namespace.
- Any third-party app data that bypasses `ctx.storage` (e.g. apps that write directly to their own custom IndexedDB — don't do this).

---

## Conflict resolution

When you link to a folder that already has a profile, aruta compares the folder's `profile.json.updatedAt` against the browser snapshot's `updatedAt` and picks the dialog accordingly:

- **Folder is newer (or timestamps match/missing)** — the classic 2-choice modal:
    - **Load from folder** → `restore(snapshotFromBinary(folder))` then `location.reload()`.
    - **Overwrite folder** → `writeAll(snapshotBinary(currentBrowserState))`.
- **Browser is newer** — a 3-way conflict modal (implemented as two chained confirms so it still works without a custom tri-button widget):
    - **Keep Local** → overwrite the folder with current browser state.
    - **Keep Folder** → restore from folder and reload (discards the newer browser changes).
    - **Cancel** → abort linking; the folder is not adopted.

After that initial decision, **folder always wins** at boot. The browser is treated as a cache; the folder is the source of truth.

There is no merge. If you edit state in two browsers linked to the same folder simultaneously, the last one to flush wins. The intended pattern is: one active browser at a time, sync via the shared folder when you switch.

---

## Browser compatibility

| Browser | Folder sync (DiskBackend) | Zip export/import |
|---|---|---|
| Chrome / Edge / Brave / Opera (desktop) | Yes (FS Access API) | Yes |
| Arc | Yes | Yes |
| Firefox (desktop) | No (no FS Access API) | Yes |
| Safari (desktop) | No | Yes |
| Chrome on Android | No (`showDirectoryPicker` not implemented on mobile Chromium) | Yes |
| iOS Safari | No | Yes |

If you're on a non-Chromium browser, Settings hides the **Pick folder** controls and shows only Export/Import. The status line reads *"Use Export/Import .zip (folder sync requires Chromium)."*

---

## Troubleshooting

### "Disconnected — reconnect to resume sync"

Browsers can drop the persisted permission silently after long idle periods, profile cleanups, or a permission reset in site settings. Your handle is still saved; click **Reconnect** in Settings → Profile to re-prompt. After reconnect, the folder's contents are loaded (folder wins) and the page reloads.

### "Pick folder" does nothing / errors out

`showDirectoryPicker()` requires:
- A user gesture (the click itself satisfies this).
- A secure context (`https://` or `localhost`). Opening `index.html` from `file://` will work for most of the OS but **not** for folder linking — use `npx serve .` or `python -m http.server`.
- Chromium 86+. If you're on Firefox/Safari, use Zip mode.

### "profile_newer_version"

Thrown by `restore()` if the snapshot's `version` field is greater than the runtime's `PROFILE_VERSION`. Means: the profile was created by a newer aruta.sh than the one currently running. Update the site (or the local checkout) and retry.

Profiles are forward-compatible within the same major version. The current version is `1` — if it ever bumps, this doc will document the migration.

### Lost folder (folder moved or deleted on disk)

If you move or delete the linked folder outside the browser, the persisted handle becomes stale. On next boot you'll see Disconnected; clicking Reconnect will fail. **Unlink** in Settings, then **Pick folder** again at the new location.

### Browser revoked the permission

Some browsers' "Clear site data" wipes the IDB that stores the handle. Same fix as above: re-pick the folder. If the folder still has the previous profile, choose **Load from folder** to recover.

### "Profile disconnected — re-link in Settings" toast

Raised when a debounced write-through fails (folder removed mid-session, disk full, OS-level permission loss). Sync stops; your in-browser state is unaffected. Re-link to resume.

### Verifying a snapshot

Open DevTools → Console:

```js
await arutaProfileDebug.dump()  // returns the live snapshot object
```

To force-restore a snapshot you've stashed in JS:

```js
await arutaProfileDebug.rewind(snap)  // restore + reload
```

Both helpers are intentionally exposed only as `arutaProfileDebug.*` — they bypass the UI's confirmations, so use them deliberately.

---

## Programmatic API

`window.profile` (set by `profile.js`) exposes:

| Method | Purpose |
|---|---|
| `snapshot()` | Capture current state into a JS object |
| `snapshotBinary(snap?)` | Convert a snapshot into a `Map<path, bytes\|string>` (the on-disk layout) |
| `snapshotFromBinary(map)` | Inverse — reconstruct a snapshot object from a path map |
| `restore(snap)` | Wipe and rewrite localStorage + every aruta IDB from a snapshot |
| `exportZip()` | Trigger a `.zip` download of the current state |
| `importZip(file)` | Import a `.zip` `File` and reload |
| `link(handle, {overwriteFolder})` | Adopt a directory handle as the active sync target |
| `unlink()` | Forget the handle, stop syncing |
| `reconnect()` | Re-prompt for permission on the existing handle |
| `tryRestoreFromHandle()` | Boot-gate: restore if a handle is live, else no-op |
| `markDirty(scope, key)` | Hook called by storage/registry/sandbox to schedule a write |
| `isLinked() / isDisconnected() / linkedName() / linkedMode()` | Status accessors |
| `hasHandle()` | Resolve to `true` if a handle is persisted (regardless of permission) |

The `markDirty` hooks fire from:
- `JavaScript/util.js` `storage.set/del` (localStorage scope)
- `JavaScript/registry.js` (manifests + files scope)
- `JavaScript/sandbox.js` `_appStorageSet/Remove` (per-app scope)

All writes are coalesced through a single 400 ms debounce timer; for simplicity v1 always re-serializes the full snapshot rather than diffing. If profile sizes grow large, `flushDirty` is the place to add per-scope incremental writes.

---

## Security notes

- The folder permission is **per-origin**. A profile linked from `https://aruta.sh` cannot be touched by any other site.
- Snapshots include a free-form `origin` tag (`location.origin` at capture time) for debugging, but it's not used to gate restores — you can deliberately move a profile between origins.
- The folder is only as private as the directory you picked. Don't link to a synced cloud drive you share with other people.
- Importing a `.zip` is equivalent to installing every package inside it. The same trust caveats from [packages.md](./packages.md) apply — only import zips from sources you trust.

---

## Related

- [Architecture](./architecture.md) — boot diagram showing where the profile gate sits.
- [Packages](./packages.md) — package format that fills `registry/files/`.
- [Permissions](./permissions.md) — per-app grants live in `localStorage`, so they're carried by the profile.
