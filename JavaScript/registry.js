/* ╔══════════════════════════════════════════════════════════╗
 * ║  REGISTRY — IndexedDB store of installed packages         ║
 * ║  Keeps in-memory cache, syncs to IndexedDB and localStorage ║
 * ╚══════════════════════════════════════════════════════════╝ */

const DB_NAME = (window.Storage && window.Storage.constants.PACKAGES_DB) || 'aruta_packages';
const DB_VERSION = 1;
const INDEX_KEY = 'aruta_installed_apps';

function openDB() {
    return window.db.openDB(DB_NAME, DB_VERSION, (db) => {
        if (!db.objectStoreNames.contains('manifests')) db.createObjectStore('manifests', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files'))     db.createObjectStore('files',     { keyPath: ['appId', 'path'] });
    });
}

function tx(db, stores, mode) { return db.transaction(stores, mode); }

const _manifests = new Map();
const _commands = new Map();

// Aliases owned by bundled hybrid packages. Only the canonical owner id is
// allowed to claim its reserved alias — any third-party package trying to
// squat on `pkg` / `roll` / `fortune` is rejected at saveManifest time.
const RESERVED_OWNER = { pkg: 'packagestore', roll: 'dice-roller', fortune: 'oracle' };
const RESERVED_ALIASES = new Set(Object.keys(RESERVED_OWNER));

function loadIndex() {
    try {
        const raw = localStorage.getItem(INDEX_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function saveIndex() {
    const arr = Array.from(_manifests.values()).map(m => ({
        id: m.id, name: m.name, icon: m.icon, type: m.type, roles: Array.isArray(m.roles) ? m.roles.slice() : [], permissions: m.permissions || []
    }));
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(arr)); } catch {}
}

function _normalize(m) {
    // Legacy-safe pass-through when the host hasn't booted yet: if the
    // sandbox helper is present, use it; otherwise do the minimal inline
    // normalization so we never store a manifest without `roles`.
    if (window.sandbox?.normalizeManifest) return window.sandbox.normalizeManifest(m);
    if (!m || typeof m !== 'object') return m;
    const out = { ...m };
    if (!Array.isArray(out.roles) || out.roles.length === 0) {
        out.roles = (out.type === 'app' || out.type === 'command') ? [out.type] : [];
    }
    if (!out.type && out.roles[0]) out.type = out.roles[0];
    return out;
}

async function bootstrap() {
    try {
        const db = await openDB();
        const store = tx(db, ['manifests'], 'readonly').objectStore('manifests');
        const all = await new Promise((res, rej) => {
            const r = store.getAll();
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
        for (const raw of all) {
            const m = _normalize(raw);
            _manifests.set(m.id, m);
            if (m.roles.includes('command')) _commands.set(m.commandAlias || m.id, m);
            if (m.roles.includes('app')) { registerAppInOS(m); ensureAppWindow(m); }
        }
        saveIndex();
        renderStartMenuItems();
    } catch (e) {
        console.warn('[registry] bootstrap failed', e);
    }
}

function registerAppInOS(manifest) {
    if (typeof WIN_META !== 'undefined') {
        WIN_META[manifest.id] = { icon: manifest.icon || '📦', label: manifest.name, custom: true };
    }
}

function unregisterAppFromOS(id) {
    window.sandbox?.unmount(id);
    if (typeof WIN_META !== 'undefined') delete WIN_META[id];
    const win = document.getElementById('win-' + id);
    if (win) win.remove();
    if (typeof removeWindowTab === 'function') removeWindowTab(id);
}

/* Built-in windows grouped by category. Mirrors the static HTML that used
   to live inside .start-items. Each entry: id, icon, i18n-key, category. */
const BUILTIN_ITEMS = [
    { id: 'about',    icon: '📖',  key: 'sec_about',    cat: 'info'   },
    { id: 'live',     icon: '🔮',  key: 'sec_live',     cat: 'info'   },
    { id: 'links',    icon: '🔗',  key: 'sec_links',    cat: 'info'   },
    { id: 'terminal', icon: '⌨️',  key: 'sec_terminal', cat: 'system' },
    { id: 'settings', icon: '⚙️', key: 'sec_settings', cat: 'system' },
];

/* Rendering order. Empty categories are skipped automatically. */
const CATEGORY_ORDER = ['info', 'games', 'tools', 'creativity', 'other', 'system'];
const CATEGORY_ICON = {
    info: '✦', games: '⚔', tools: '🔧', creativity: '🎨', other: '📦', system: '⚙',
};

const OPEN_CAT_KEY = 'aruta_start_open_cat';

function renderStartMenuItems() {
    const items = document.getElementById('start-items');
    if (!items) return;

    // Bucket everything by category.
    const buckets = Object.fromEntries(CATEGORY_ORDER.map(c => [c, []]));
    for (const b of BUILTIN_ITEMS) {
        buckets[b.cat].push({ ...b, builtin: true });
    }
    for (const m of _manifests.values()) {
        if (!m.roles?.includes('app')) continue;
        const cat = CATEGORY_ORDER.includes(m.category) ? m.category : 'other';
        buckets[cat].push({
            id: m.id,
            icon: m.icon || '📦',
            label: m.name,
            cat,
            custom: true,
        });
    }

    const t = window.t();
    // Accordion behavior: at most one category open at a time.
    // Persisted open-category id (empty string = none open). Default: none.
    const openCat = window.storage.get(OPEN_CAT_KEY, '');
    items.innerHTML = '';
    let first = true;
    for (const cat of CATEGORY_ORDER) {
        const entries = buckets[cat];
        if (!entries.length) continue;
        if (!first) items.appendChild(Object.assign(document.createElement('div'), { className: 'start-cat-sep' }));
        first = false;

        const group = document.createElement('div');
        group.className = 'start-cat-group';
        if (cat !== openCat) group.classList.add('is-collapsed');
        group.dataset.cat = cat;

        const header = document.createElement('button');
        header.className = 'start-cat-header';
        header.type = 'button';
        header.innerHTML = `
            <span class="start-cat-chevron" aria-hidden="true">▾</span>
            <span class="start-cat-icon">${CATEGORY_ICON[cat]}</span>
            <span class="start-cat-label" data-i18n="cat_${cat}">${t['cat_' + cat] || cat}</span>
            <span class="start-cat-count">${entries.length}</span>
        `;
        header.addEventListener('click', () => {
            const isCurrentlyOpen = !group.classList.contains('is-collapsed');
            // Collapse every sibling group first…
            items.querySelectorAll('.start-cat-group').forEach(g => g.classList.add('is-collapsed'));
            // …then, unless this group was the one already open, open it.
            if (!isCurrentlyOpen) group.classList.remove('is-collapsed');
            window.storage.set(OPEN_CAT_KEY, isCurrentlyOpen ? '' : cat);
        });
        group.appendChild(header);

        const body = document.createElement('div');
        body.className = 'start-cat-body';
        for (const e of entries) {
            const btn = document.createElement('button');
            btn.className = 'start-item' + (e.custom ? ' start-custom' : '');
            btn.dataset.window = e.id;
            const label = e.builtin ? (t[e.key] || e.key) : (e.label || e.id);
            btn.innerHTML = `${e.icon} <span${e.builtin ? ` data-i18n="${e.key}"` : ''}>${window.escapeHTML(label)}</span>`;
            btn.addEventListener('click', () => {
                if (typeof openWindow === 'function') openWindow(e.id);
                const menu = document.getElementById('start-menu');
                const startBtn = document.getElementById('start-btn');
                if (menu && menu.style.display !== 'none') startBtn?.click();
            });
            body.appendChild(btn);
        }
        group.appendChild(body);
        items.appendChild(group);
    }
}

async function saveManifest(manifest, files) {
    manifest = _normalize(manifest);
    // Reject reserved commandAlias squatting up-front, before we touch IDB or
    // the in-memory maps. Only the canonical owner id may claim the alias.
    if (manifest.commandAlias && RESERVED_ALIASES.has(manifest.commandAlias)
        && RESERVED_OWNER[manifest.commandAlias] !== manifest.id) {
        throw new Error('reserved_alias:' + manifest.commandAlias);
    }
    // Detect update: if the id is already known and anything about the
    // iframe-bound config changed (version, sandbox policy, entry, type/roles),
    // tear down the live iframe so the next openWindow remounts with the
    // fresh manifest. The sandbox attribute can't be edited after insertion,
    // so without this the user would keep seeing the old sandboxed app.
    const previous = _manifests.get(manifest.id);
    const isUpdate = !!previous;
    const prevAppEntry = previous?.entriesResolved?.app || previous?.entry;
    const curAppEntry  = manifest.entriesResolved?.app   || manifest.entry;
    const iframeShapeChanged = isUpdate && (
        previous.version    !== manifest.version    ||
        previous.allowOrigin !== manifest.allowOrigin ||
        prevAppEntry        !== curAppEntry         ||
        (previous.roles || []).join(',') !== (manifest.roles || []).join(',')
    );
    if (iframeShapeChanged) {
        try { window.sandbox?.unmount(manifest.id); } catch {}
        // If the window is currently visible, close it — better than leaving
        // the user staring at an empty frame. They'll reopen to get fresh.
        const win = document.getElementById('win-' + manifest.id);
        if (win && win.style.display !== 'none' && typeof closeWindow === 'function') {
            closeWindow(manifest.id);
        }
    }

    const db = await openDB();
    await new Promise((res, rej) => {
        const t = tx(db, ['manifests', 'files'], 'readwrite');
        t.objectStore('manifests').put({ ...manifest, _installedAt: Date.now() });
        const filesStore = t.objectStore('files');
        const range = IDBKeyRange.bound([manifest.id, ''], [manifest.id, '\uffff']);
        const req = filesStore.openCursor(range);
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) { cursor.delete(); cursor.continue(); }
            else {
                for (const [path, blob] of Object.entries(files)) {
                    filesStore.put({ appId: manifest.id, path, blob });
                }
            }
        };
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
    });
    _manifests.set(manifest.id, manifest);
    // Drop stale alias entries from a previous install of the same id (e.g.
    // an update that changes commandAlias or removes the command role).
    if (previous) {
        const prevKey = previous.commandAlias || previous.id;
        if (_commands.get(prevKey) && _commands.get(prevKey).id === manifest.id) {
            _commands.delete(prevKey);
        }
    }
    if (manifest.roles.includes('command')) {
        const key = manifest.commandAlias || manifest.id;
        const existing = _commands.get(key);
        if (existing && existing.id !== manifest.id) {
            console.warn('[registry] commandAlias collision:', key, 'replacing', existing.id, 'with', manifest.id);
        }
        _commands.set(key, manifest);
    }
    if (manifest.roles.includes('app')) {
        registerAppInOS(manifest);
        ensureAppWindow(manifest);
    }
    saveIndex();
    renderStartMenuItems();
    try { window.profile?.markDirty?.('manifests', manifest.id); } catch {}
    try { window.sandbox?.broadcastInstallChange?.(); } catch {}
}

async function getFiles(appId) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const t = tx(db, ['files'], 'readonly');
        const store = t.objectStore('files');
        const out = {};
        const range = IDBKeyRange.bound([appId, ''], [appId, '\uffff']);
        const req = store.openCursor(range);
        req.onsuccess = (e) => {
            const c = e.target.result;
            if (c) { out[c.value.path] = c.value.blob; c.continue(); }
            else res(out);
        };
        req.onerror = () => rej(req.error);
    });
}

async function uninstall(id) {
    const m = _manifests.get(id);
    if (!m) return;
    // Note: self-uninstall from inside a sandboxed iframe is refused earlier
    // at sandbox.js (`targetId === appId`). Here we freely unmount other apps —
    // `unregisterAppFromOS` below calls sandbox.unmount so an open window of
    // the target app gets torn down cleanly before we delete it.
    // Widget cleanup: if package had an active widget, tear it down first so
    // its DOM frame and iframe are removed before we nuke files/perms.
    if (m.roles?.includes('widget') && window.widgets) {
        try {
            const state = window.widgets.getState(id);
            if (state?.enabled) {
                window.widgets.disable(id);
                const t = window.t ? window.t() : {};
                window.showToast?.(t.widget_uninstall_warning || 'Widget disabled before uninstall', 'warning');
            }
            window.widgets.removeState(id);
        } catch (e) { console.warn('[registry] widget cleanup failed', e); }
    }
    const db = await openDB();
    await new Promise((res, rej) => {
        const t = tx(db, ['manifests', 'files'], 'readwrite');
        t.objectStore('manifests').delete(id);
        const filesStore = t.objectStore('files');
        const range = IDBKeyRange.bound([id, ''], [id, '\uffff']);
        const req = filesStore.openCursor(range);
        req.onsuccess = (e) => {
            const c = e.target.result;
            if (c) { c.delete(); c.continue(); }
        };
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
    });
    _manifests.delete(id);
    _commands.delete(m.commandAlias || id);
    _commands.delete(id);
    unregisterAppFromOS(id);
    // Close any cached DB handle before deleting — deleteDatabase is blocked by open connections.
    try { await window.sandbox?.closeAppStorage?.(id); } catch {}
    // Explicit await — previously the `??` chain could fire-and-forget the
    // Storage promise while falling through to deleteDatabase, racing them.
    try {
        if (window.Storage?.deleteAppKV) await window.Storage.deleteAppKV(id);
        else indexedDB.deleteDatabase('aruta_app_' + id);
    } catch (_) {}
    // Drop any stored permission grants for this app — keeping them around
    // would pre-grant a reinstalled package with the same id.
    try { localStorage.removeItem('aruta_perms_' + id); } catch {}
    // If this was a default package, remember so we don't auto-reinstall it.
    window.defaults?.markUninstalled(id);
    saveIndex();
    renderStartMenuItems();
    try { window.profile?.markDirty?.('manifests', id); } catch {}
    try { window.profile?.markDirty?.('app', id); } catch {}
    try { window.sandbox?.broadcastInstallChange?.(); } catch {}
}

function ensureAppWindow(manifest) {
    const id = manifest.id;
    if (document.getElementById('win-' + id)) return;
    const desktop = document.getElementById('desktop');
    if (!desktop) return;
    const win = document.createElement('div');
    win.className = 'os-window os-window-custom';
    win.id = 'win-' + id;
    win.dataset.window = id;
    win.style.display = 'none';
    win.innerHTML = `
        <div class="win-titlebar">
            <span class="win-title">${manifest.icon || '📦'} <span>${manifest.name}</span></span>
            <div class="win-controls">
                <button class="win-btn win-minimize" title="Minimize" data-i18n-title="win_minimize">▬</button>
                <button class="win-btn win-maximize" title="Maximize" data-i18n-title="win_maximize">☐</button>
                <button class="win-btn win-close" title="Close" data-i18n-title="win_close">✕</button>
            </div>
        </div>
        <div class="win-content custom-app-content"></div>
    `;
    desktop.appendChild(win);
    // Wire window controls (mirrors initWindowManager logic for one window)
    if (typeof initResize === 'function') initResize(win);
    const titlebar = win.querySelector('.win-titlebar');
    if (titlebar && typeof initDrag === 'function') {
        initDrag(win, titlebar);
        titlebar.addEventListener('dblclick', (e) => {
            if (e.target.closest('.win-btn')) return;
            if (typeof toggleMaximize === 'function') toggleMaximize(win);
        });
    }
    win.addEventListener('mousedown', () => { if (typeof focusWindow === 'function') focusWindow(win); });
    win.querySelector('.win-minimize')?.addEventListener('click', e => { e.stopPropagation(); if (typeof minimizeWindow === 'function') minimizeWindow(id); });
    win.querySelector('.win-maximize')?.addEventListener('click', e => { e.stopPropagation(); if (typeof toggleMaximize === 'function') toggleMaximize(win); });
    win.querySelector('.win-close')?.addEventListener('click', e => {
        e.stopPropagation();
        if (typeof closeWindow === 'function') closeWindow(id);
        // Keep iframe alive so app state (game progress, form input, ...) survives close/reopen.
        // Packages that must not linger in background (e.g. Tavern keeping
        // a P2P swarm open) can opt in with manifest.unmountOnClose: true —
        // closing the window then tears the iframe down so no connection
        // stays active. Next openWindow remounts fresh.
        if (manifest.unmountOnClose) {
            try { window.sandbox?.unmount(id); } catch (_) {}
        }
    });
}

window.registry = {
    bootstrap,
    saveManifest,
    getFiles,
    uninstall,
    list: () => Array.from(_manifests.values()),
    listCommands: () => Array.from(_commands.values()),
    getManifest: (id) => _manifests.get(id),
    // Resolve a terminal token to a command manifest. Checks the alias map
    // first (keyed by `commandAlias || id`) so `pkg` finds the `packagestore`
    // package even though the package id is different.
    getCommand: (name) => _commands.get(name),
    isInstalled: (id) => _manifests.has(id),
};
