# Widgets

A **widget** is a compact, draggable mini-panel that floats above the
desktop. It runs in its own sandboxed iframe like an app, but instead of
filling a full window it shows up as a small pinned frame the user can
move anywhere on screen.

Widgets are designed for glanceable, persistent information that
shouldn't require opening a window: chat presence, clocks, system
status, a small notepad, and so on.

See also:

- [Packages](./packages.md) — the base package model (app + command +
  widget roles)
- [`ctx` API reference](./ctx-api.md) — same API is available to
  widget code
- [Tavern](./tavern.md) — the reference widget implementation

---

## When to declare the `widget` role

Add `"widget"` to `roles` when your package has something useful to
show in a small, always-visible frame. A package can declare `widget`
alone (widget-only, no windowed app) or pair it with `app` for hybrid
access — Tavern uses the hybrid pattern to expose the full chat UI as
an app and a compact view as a widget sharing the same storage.

Widgets are **disabled by default** after install. The user must enable
them individually from **Settings → 🪄 Widgets**. This prevents a newly
installed package from spawning a floating panel without explicit
consent.

---

## Manifest additions

```json
{
    "id": "tavern",
    "name": "Tavern",
    "icon": "🍺",
    "version": "2.1.0",
    "minSdk": 2,
    "roles": ["app", "widget"],
    "entries": { "app": "ui.js", "widget": "widget.js" },
    "widget": {
        "defaultWidth": 320,
        "defaultHeight": 420,
        "minWidth": 240,
        "minHeight": 200,
        "defaultAnchor": "bottom-right"
    },
    "permissions": ["storage"]
}
```

| Field | Required | Rules | Notes |
|---|---|---|---|
| `roles` must include `"widget"` | ✅ | — | Adds the widget to the Settings → Widgets list |
| `entries.widget` | ◐ | path inside zip | Entry file for the widget role. Falls back to the shared `entry` / `index.js` when absent |
| `widget` block | — | object | Optional sizing + initial anchor hints |
| `widget.defaultWidth` | — | positive number | Initial width (px). Default: 280 |
| `widget.defaultHeight` | — | positive number | Initial height (px). Default: 360 |
| `widget.minWidth` / `minHeight` | — | positive number | Floor used by the host when clamping |
| `widget.defaultAnchor` | — | `"top-left"` \| `"top-right"` \| `"bottom-left"` \| `"bottom-right"` | Which corner the widget drops into the first time the user enables it |

The widget block is validated at install time (`installer.js:validateManifest`).
Declaring it without `"widget"` in `roles` is rejected.

---

## Entry contract

The widget entry exports the same shape as an app — `default { mount, unmount? }`:

```js
export default {
    async mount(root, ctx) {
        // root is the inside of the widget body (flex column, full size).
        root.innerHTML = '<div class="clock" data-c></div>';
        const $c = root.querySelector('[data-c]');
        const t = setInterval(() => {
            $c.textContent = new Date().toLocaleTimeString();
        }, 1000);
        return {
            unmount() { clearInterval(t); }
        };
    },
};
```

The host passes `role: 'widget'` in the init payload so the iframe
bootstrap resolves `entriesResolved.widget` for the entry path.
Everything else — `ctx`, `style.css` auto-injection, theme sync, perm
gate — behaves identically to the `app` role.

---

## Lifecycle

| Phase | What happens | Where |
|---|---|---|
| Package install | `"widget"` role registers in `widgets.list()`, state = disabled | `registry.saveManifest` |
| Boot | `widgets.bootstrap()` runs after `defaults.bootstrap()` and remounts every previously-enabled widget | `app.js` |
| User toggles ON (Settings → Widgets) | `widgets.enable(id)` → creates `.widget-frame`, `sandbox.mountWidget(id)` spins up the iframe, announces in `localStorage.aruta_widgets` | `widgets.js` |
| User toggles OFF | `widgets.disable(id)` → unmounts iframe, keeps state `enabled:false` | `widgets.js` |
| User drags | `savePosition(id, x, y)` debounced; edge anchor recomputed | `widgets.js` |
| Viewport resize | Position is re-derived from the saved anchor (keeps the same gap from the nearest edge) | `widgets.js` resize handler, rAF-throttled |
| Mobile (<640px) | Frames hidden via CSS; bootstrap skips mounting | `widgets.css` + `widgets.bootstrap` |
| Package uninstall | `registry.uninstall(id)` disables the widget, removes its state entry, and then wipes the IDB | `registry.js:uninstall` hook |
| Reset settings | `aruta_widgets` key cleared, all widgets disabled | `os-settings.js` reset handler |

The host provides **no chrome** around the widget body — no titlebar,
no close button — by design. The only way to turn a widget off is
Settings → Widgets. The 4px border around the iframe doubles as a
drag belt; mousedown inside the body passes through to the package
for interactions.

---

## Persistence

Widget state lives in `localStorage` under `aruta_widgets`:

```json
{
    "tavern": {
        "enabled": true,
        "x": 1240,
        "y": 520,
        "width": 320,
        "height": 420,
        "anchor": { "h": "right", "v": "bottom", "offsetH": 16, "offsetV": 16 }
    }
}
```

- Prefix `aruta_*` → auto-synced by the portable-profile folder mirror
  and `.zip` export (see [profile.md](./profile.md)). No extra wiring.
- `anchor` is recomputed on every drag end. It drives the resize
  handler that keeps the widget at the same distance from its chosen
  edge when the viewport changes.
- Orphan entries (`enabled:true` for a package that's been uninstalled
  elsewhere) are skipped + cleaned up at `widgets.bootstrap()`.

---

## Host API surface

`widgets.js` exposes a small API on `window.widgets` that Settings uses
and tests can drive:

| Method | Purpose |
|---|---|
| `widgets.list()` | All installed packages whose `roles` include `"widget"` |
| `widgets.getState(id)` | Raw persisted state for one widget |
| `widgets.enable(id)` | Mount + save enabled:true |
| `widgets.disable(id)` | Unmount + save enabled:false |
| `widgets.savePosition(id, x, y)` | Persist new x/y + recompute anchor |
| `widgets.removeState(id)` | Delete the entry entirely (used by uninstall) |
| `widgets.bootstrap()` | Mount every enabled widget (boot path) |
| `widgets.renderSettings()` | Rebuild the Settings → Widgets list |

From inside a widget the API is not needed — the host manages
lifecycle. Widget code only exports its `mount` and optional `unmount`.

---

## Example: minimal widget-only package

```
mini-clock.zip
├── manifest.json
└── widget.js
```

```json
// manifest.json
{
    "id": "mini-clock",
    "name": "Mini Clock",
    "icon": "🕐",
    "version": "1.0.0",
    "minSdk": 2,
    "roles": ["widget"],
    "entries": { "widget": "widget.js" },
    "widget": {
        "defaultWidth": 200,
        "defaultHeight": 80,
        "defaultAnchor": "top-right"
    }
}
```

```js
// widget.js
export default {
    async mount(root) {
        root.style.display = 'flex';
        root.style.alignItems = 'center';
        root.style.justifyContent = 'center';
        root.style.fontFamily = 'Cinzel, serif';
        root.style.fontSize = '1.4rem';
        root.style.color = 'var(--gold, gold)';

        const update = () => {
            root.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        };
        update();
        const h = setInterval(update, 1000);

        return { unmount() { clearInterval(h); } };
    },
};
```

The user installs the `.zip`, enables **Mini Clock** from Settings →
Widgets, and a small clock pops in the top-right corner. They drag
it to whatever position they like. On reload, the host remounts it
with the saved anchor.

---

## Mobile

Widgets are hidden entirely below 640px viewport via CSS:

```css
@media (max-width: 640px) {
    .widget-frame { display: none !important; }
}
```

`widgets.bootstrap()` also bails out when the viewport matches that
query, so iframes aren't even mounted on small screens. Reason:
draggable floating panels + touch targets + a taskbar + Safari's
bottom-bar don't cooperate, and widgets are meant to be a desktop
augmentation, not a primary UI.

If you really need a mobile-friendly compact view, consider surfacing
the same content from the `app` role instead — full windows behave
well on mobile because the OS auto-maximizes them.

---

## Trade-offs to know about

- **Runtime cost**: each enabled widget is an iframe + its own Trystero /
  fetch / timers. Keep widgets cheap; they're meant to stay on the
  desktop all day.
- **Single drag zone**: the chrome is intentionally minimal. If your
  widget needs a drag handle more discoverable than "hover the border"
  you can add one inside your own body — but remember that mousedown
  on body children doesn't trigger host drag.
- **No resize handles**: the v1 frame uses whatever `widget.defaultWidth`
  / `defaultHeight` said. Resize is a future enhancement.
- **No z-order management**: last-mounted widget sits above earlier
  ones. Good enough for 2-3 widgets; messy past that.
