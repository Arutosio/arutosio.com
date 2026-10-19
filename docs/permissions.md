# Permissions

aruta.sh uses an **iOS-style runtime permission model**: no capability is granted just because a package declares it. Every protected `ctx.*` method prompts the user the first time it's called. The user can Allow once, Allow always, or Deny, and can revoke at any time from **Settings → 🔐 Permissions**.

---

## The permissions

| Name | Unlocks |
|---|---|
| `storage` | `ctx.storage.get/set/remove` — per-app private IndexedDB |
| `notifications` | `ctx.toast` — themed toast notifications on the host |
| `windows` | `ctx.openWindow`, `ctx.closeWindow` — manipulate other windows |
| `terminal` | `ctx.print`, `ctx.clear` — write to the Terminal |
| `fetch` | `ctx.fetch` — HTTP requests to external URLs |
| `theme` | `ctx.theme.get/set` — read and switch the UI theme |
| `clipboard` | `ctx.clipboard.read/write` — read/write system clipboard |
| `profile-fs` | `ctx.profile.list/read/write/remove` — read and write the folder the user linked via Settings → Profile. Fails with `profile_not_linked` when no folder is connected. Used primarily by the File Explorer app. |
| `install` | `ctx.installZip(blob)` submits a `.zip` to the host installer, `ctx.listInstalled()` enumerates installed packages (id + version), `ctx.uninstall(id)` removes an installed package (refuses to self-uninstall), `ctx.repos.*` reads/mutates the system repository list (sources used by Package Store and the `pkg` CLI), and `ctx.defaults.list()` / `ctx.defaults.restore(id)` inspect and reinstall bundled default packages the user previously uninstalled. The user still sees the standard install-confirm modal for every install — this permission gates *submission*, not approval. Uninstalls are immediate; the calling app is expected to prompt the user first. |

Anything not in this table has no permission gate (e.g. `ctx.asset`, `ctx.i18n`, DOM access inside your own iframe).

---

## The lifecycle

1. **Declared at install** — `manifest.permissions` lists what your package *expects* to use. The install modal shows this list so users can decide whether to install at all.
2. **Prompted at first call** — the very first `ctx.foo()` that needs a permission opens a modal:
    - **Deny** → persisted as `denied`, future calls return `null`/`false` silently, no re-prompt
    - **Allow** → one-shot grant, next call asks again
    - **Always allow** → persisted as `granted`, never prompts again
3. **Revocable** — Settings → 🔐 Permissions shows every installed package and every permission it has ever used or declared, with a toggle. Revoking flips the state back to *ask* (next call will prompt). The Permissions page is permissions-only: install / update / uninstall moved to the **📦 Package Store** (and the `pkg` CLI).

Grants are stored per-app in `localStorage.aruta_perms_<appId>` as JSON: `{ "storage": "granted", "fetch": "denied" }`.

---

## What happens when denied

Most methods fail soft:

```js
await ctx.toast('hi', 'success');   // denied → resolves, no-op
await ctx.storage.get('key');       // denied → resolves with null
await ctx.storage.set('key', val);  // denied → resolves with false
```

A few methods throw instead, because returning a fake value would be misleading:

```js
try {
    await ctx.fetch('https://example.com/api');
} catch (e) {
    if (String(e).includes('permission_denied')) {
        // user said no
    }
}
```

This is consistent with the Web Clipboard API and `fetch` — errors rather than silent success.

---

## Prompt UX

- Only one prompt is ever visible — simultaneous `ctx.*` calls that each need a grant serialize automatically.
- The prompt shows the app's icon, name, and a short sentence describing *what* the permission does (not just its technical name). Copy lives in `config.js` under `perm_<name>_desc` keys.
- Esc / click-outside = Deny (one-shot: asks again next call).

---

## Designing a polite package

- Declare only what you'll actually use. Declared-but-unused permissions look suspicious in the install modal.
- Use `ctx.permission.request(name)` once up-front if you want to get prompts out of the way at launch instead of mid-interaction.
- Always handle the denied case — don't crash if `ctx.storage.get()` returns `null`.
- Don't request the same permission over and over in a tight loop. The user can't revoke a `granted` state without going to Settings.

---

## Security boundary

Apps run in an iframe with `sandbox="allow-scripts allow-modals"` (plus `allow-same-origin` if the package opts in via `allowOrigin: true`). `allow-modals` is added so `prompt`/`alert`/`confirm` work; browsers block them by default inside sandboxed iframes. That means:

- They cannot read the host's `localStorage`, `cookies`, or `document`.
- They cannot make same-origin `fetch` calls to aruta.sh APIs.
- They can only talk to the host via `postMessage`, which goes through the `ctx` bridge and its permission gate.

Commands run in the main thread (no UI → the iframe overhead isn't justified). They *can* touch global JS, so only install commands you trust. Their `ctx` capabilities still go through the same permission gate.
