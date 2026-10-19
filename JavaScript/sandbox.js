/* ╔══════════════════════════════════════════════════════════╗
 * ║  SANDBOX — Iframe host for apps + executor for commands   ║
 * ║  Bridges ctx API across postMessage with permission gate  ║
 * ╚══════════════════════════════════════════════════════════╝ */

/** Host-side SDK version. The ctx contract surface. Bump this only on a
 *  breaking change to `ctx.*` / init-payload shape. Apps may declare a
 *  minimum `sdk` in their manifest to opt into a newer contract. */
const SDK_VERSION = 2;

/**
 * Normalize a manifest so downstream code can rely on `roles` being an array.
 * Legacy manifests with `type: "app"|"command"` get promoted to `roles: [type]`.
 * Also resolves the per-role entry file via `entries[role] ?? entry ?? 'index.js'`,
 * cached on `entriesResolved` for quick lookup by `mountApp` / `runCommand`.
 */
function normalizeManifest(m) {
    if (!m || typeof m !== 'object') return m;
    const out = { ...m };
    if (!Array.isArray(out.roles) || out.roles.length === 0) {
        if (out.type === 'app' || out.type === 'command') {
            out.roles = [out.type];
        } else {
            out.roles = [];
        }
    }
    // Back-compat: ensure `type` mirrors the primary role so any legacy
    // consumer that still reads `m.type` keeps working during the transition.
    if (!out.type && out.roles[0]) out.type = out.roles[0];
    const defaultEntry = out.entry || 'index.js';
    const resolved = {};
    for (const role of out.roles) {
        resolved[role] = (out.entries && out.entries[role]) || defaultEntry;
    }
    out.entriesResolved = resolved;
    return out;
}

const _mounted = new Map(); // appId -> { iframe, channel }
const _mountedWidgets = new Map(); // widgetId -> { iframe, frame, onMsg }

/**
 * Push a theme change to every mounted app iframe. The in-iframe bootstrap
 * listens for `{type:'theme', value}` messages and updates the iframe's
 * root `data-theme` attribute so CSS vars recompute automatically.
 */
function broadcastTheme(v) {
    for (const m of _mounted.values()) {
        try { m.iframe.contentWindow?.postMessage({ __aruta_sdk: true, type: 'theme', value: v }, '*'); } catch (_) {}
    }
    for (const m of _mountedWidgets.values()) {
        try { m.iframe.contentWindow?.postMessage({ __aruta_sdk: true, type: 'theme', value: v }, '*'); } catch (_) {}
    }
}

/**
 * Notify every mounted iframe that the set of installed packages changed
 * (install / uninstall / update). Iframes receive it as a DOM event
 * `aruta:installChanged` on document — apps can `addEventListener` to refresh.
 */
function broadcastInstallChange() {
    for (const m of _mounted.values()) {
        try { m.iframe.contentWindow?.postMessage({ __aruta_sdk: true, type: 'install-change' }, '*'); } catch (_) {}
    }
    for (const m of _mountedWidgets.values()) {
        try { m.iframe.contentWindow?.postMessage({ __aruta_sdk: true, type: 'install-change' }, '*'); } catch (_) {}
    }
}

// Per-app KV is implemented in storage.js (window.Storage.appKV). These thin
// wrappers route the host-side `ctx.storage.*` calls through the facade so
// the DB name (`aruta_app_<id>`) lives in exactly one place.
async function _appStorageGet(appId, key)         { return window.Storage.appKV.get(appId, key); }
async function _appStorageSet(appId, key, value)  { return window.Storage.appKV.set(appId, key, value); }
async function _appStorageRemove(appId, key)      { return window.Storage.appKV.remove(appId, key); }

const PERM_REQUIRED = {
    print: 'terminal',
    clear: 'terminal',
    toast: 'notifications',
    openWindow: 'windows',
    closeWindow: 'windows',
    'storage.get': 'storage',
    'storage.set': 'storage',
    'storage.remove': 'storage',
    fetch: 'fetch',
    'theme.get': 'theme',
    'theme.set': 'theme',
    'clipboard.read': 'clipboard',
    'clipboard.write': 'clipboard',
    installZip: 'install',
    listInstalled: 'install',
    uninstall: 'install',
    'repos.list': 'install',
    'repos.add': 'install',
    'repos.remove': 'install',
    'repos.setEnabled': 'install',
    'repos.update': 'install',
    'defaults.list': 'install',
    'defaults.restore': 'install',
    'profile.isLinked': 'profile-fs',
    'profile.list':     'profile-fs',
    'profile.read':     'profile-fs',
    'profile.write':    'profile-fs',
    'profile.remove':   'profile-fs',
    'install.listPackageFiles': 'install',
    'install.readPackageFile':  'install',
    handoff: 'windows',
};

async function _handleCall(appId, method, args) {
    const perm = PERM_REQUIRED[method];
    if (perm) {
        const ok = await window.permissions.request(appId, perm);
        if (!ok) throw new Error('permission_denied:' + perm);
    }
    switch (method) {
        case 'print': window.terminal?.print(String(args[0] ?? '')); return true;
        case 'clear': window.terminal?.clear(); return true;
        case 'toast': window.showToast?.(String(args[0] ?? ''), args[1] || 'info'); return true;
        case 'openWindow': window.openWindow?.(String(args[0])); return true;
        case 'closeWindow': window.closeWindow?.(String(args[0])); return true;
        case 'storage.get': return await _appStorageGet(appId, args[0]);
        case 'storage.set': return await _appStorageSet(appId, args[0], args[1]);
        case 'storage.remove': return await _appStorageRemove(appId, args[0]);
        case 'fetch': {
            const opts = args[1] || {};
            const binary = opts && opts.binary;
            // Strip our custom flag before passing through to fetch — browsers
            // treat unknown init fields as no-ops but this keeps it clean.
            const init = { ...opts }; delete init.binary;
            const r = await fetch(args[0], init);
            if (binary) {
                const blob = await r.blob();
                return { ok: r.ok, status: r.status, statusText: r.statusText, blob };
            }
            const text = await r.text();
            return { ok: r.ok, status: r.status, statusText: r.statusText, body: text };
        }
        case 'theme.get': return window.currentTheme || document.documentElement.dataset.theme;
        case 'theme.set':
            if (args[0] !== window.currentTheme && typeof toggleTheme === 'function') toggleTheme();
            return true;
        case 'clipboard.read': return await navigator.clipboard.readText();
        case 'clipboard.write': await navigator.clipboard.writeText(String(args[0] ?? '')); return true;
        case 'installZip': {
            // Accept a Blob (postMessage structured-clones Blobs across frames)
            // and hand it to the existing installer pipeline. The installer
            // still shows the install-confirm modal — we do NOT bypass it.
            const blob = args[0];
            if (!blob) throw new Error('installZip: missing blob');
            const file = (typeof File !== 'undefined' && blob instanceof File)
                ? blob
                : new File([blob], (args[1] && args[1].filename) || 'remote.zip', { type: blob.type || 'application/zip' });
            // Flag this install as sandbox-originated so the installer can
            // add an extra consent prompt if the package requests allowOrigin.
            const m = await window.installer.installFromFile(file, { sandboxOrigin: true, callerAppId: appId });
            if (!m) return null; // user cancelled
            return { id: m.id, name: m.name, version: m.version, type: m.type, roles: m.roles };
        }
        case 'uninstall': {
            const targetId = String(args[0] || '');
            if (!targetId) throw new Error('uninstall: missing id');
            // Guard against an app uninstalling itself mid-call (would yank its
            // own iframe out while we're still waiting on the reply).
            if (targetId === appId) throw new Error('self_uninstall_refused');
            if (!window.registry?.isInstalled(targetId)) return false;
            await window.registry.uninstall(targetId);
            try { localStorage.removeItem('aruta_perms_' + targetId); } catch {}
            return true;
        }
        case 'listInstalled': {
            const all = window.registry?.list() || [];
            return all.map(m => ({ id: m.id, name: m.name, icon: m.icon || null, version: m.version || null, type: m.type, roles: Array.isArray(m.roles) ? m.roles.slice() : (m.type ? [m.type] : []), _origin: m._origin || 'user' }));
        }
        case 'repos.list':       return window.repos?.list() || [];
        case 'repos.add':        return window.repos?.add(args[0], args[1]);
        case 'repos.remove':     return !!window.repos?.remove(args[0]);
        case 'repos.setEnabled': return !!window.repos?.setEnabled(args[0], args[1]);
        case 'repos.update':     return window.repos?.update(args[0], args[1]);
        case 'defaults.list':    return window.defaults?.list ? await window.defaults.list() : [];
        case 'defaults.restore': {
            if (!window.defaults?.restore) throw new Error('defaults_unavailable');
            const m = await window.defaults.restore(String(args[0] || ''));
            if (!m) return null;
            return { id: m.id, name: m.name, version: m.version, type: m.type, roles: m.roles };
        }
        case 'i18n': return (window.i18n?.[window.currentLang] || {})[args[0]] || args[0];
        case 'contextMenu.show': {
            if (!window.contextMenu?.show) return null;
            const opts = args[0] || {};
            // Translate iframe-local coords to the host viewport.
            let x = Number(opts.x) || 0;
            let y = Number(opts.y) || 0;
            const iframe = _mounted.get(appId)?.iframe;
            if (iframe) {
                const r = iframe.getBoundingClientRect();
                x += r.left; y += r.top;
            }
            const items = Array.isArray(opts.items) ? opts.items : [];
            return await window.contextMenu.show({ x, y, items });
        }
        case 'profile.isLinked': return !!window.profile?.isLinked?.();
        case 'profile.list':  return await window.profile.listFolder(String(args[0] || ''));
        case 'profile.read':  return await window.profile.readFolderFile(String(args[0] || ''));
        case 'profile.write': return await window.profile.writeFolderFile(String(args[0] || ''), args[1], args[2]);
        case 'profile.remove': return await window.profile.removeFolderFile(String(args[0] || ''));
        case 'install.listPackageFiles': {
            const targetId = String(args[0] || '');
            if (!targetId || !window.registry?.isInstalled(targetId)) return [];
            const files = await window.registry.getFiles(targetId);
            const out = [];
            for (const [path, blob] of Object.entries(files || {})) {
                out.push({ path, size: blob?.size || 0, mime: blob?.type || '' });
            }
            out.sort((a, b) => a.path.localeCompare(b.path));
            return out;
        }
        case 'install.readPackageFile': {
            const targetId = String(args[0] || '');
            const path     = String(args[1] || '');
            if (!targetId || !path) throw new Error('missing_args');
            const files = await window.registry.getFiles(targetId);
            const blob  = files?.[path];
            if (!blob) throw new Error('not_found');
            const bytes = new Uint8Array(await blob.arrayBuffer());
            return { bytes, mime: blob.type || 'application/octet-stream' };
        }
        case 'handoff': {
            const targetId = String(args[0] || '');
            const payload  = args[1];
            if (!targetId) throw new Error('missing_target');
            if (!window.registry?.isInstalled(targetId)) throw new Error('target_not_installed');
            let serialized;
            try { serialized = JSON.stringify(payload); } catch { throw new Error('payload_not_serializable'); }
            if (serialized.length > 2 * 1024 * 1024) throw new Error('payload_too_large');
            try { localStorage.setItem('aruta_handoff_' + targetId, serialized); }
            catch { throw new Error('handoff_storage_failed'); }
            window.openWindow?.(targetId);
            return true;
        }
        default: throw new Error('unknown_method:' + method);
    }
}

const IFRAME_BOOT = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;color:inherit;font-family:Inter,system-ui,sans-serif;}
#root{width:100%;height:100%;overflow:auto;}
</style></head><body><div id="root"></div><script>
(function(){
    const root = document.getElementById('root');
    // Suppress the browser's native right-click menu inside app iframes too,
    // except on editable fields where copy/paste/undo are expected.
    document.addEventListener('contextmenu', (e) => {
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
        e.preventDefault();
    });
    const pending = new Map();
    let nextId = 1;
    function call(method, ...args) {
        return new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            parent.postMessage({ __aruta_sdk: true, type: 'call', id, method, args }, '*');
        });
    }
    window.addEventListener('message', async (e) => {
        const d = e.data;
        if (!d || !d.__aruta_sdk) return;
        if (d.type === 'reply') {
            const p = pending.get(d.id);
            if (!p) return;
            pending.delete(d.id);
            if (d.error) p.reject(new Error(d.error));
            else p.resolve(d.value);
        } else if (d.type === 'theme') {
            if (d.value) document.documentElement.dataset.theme = d.value;
        } else if (d.type === 'install-change') {
            try { document.dispatchEvent(new Event('aruta:installChanged')); } catch (_) {}
        } else if (d.type === 'teardown') {
            // Host is about to remove the iframe. Give the app module a
            // chance to detach listeners. Best-effort; swallow errors so
            // unmount can't block iframe removal host-side.
            try {
                const app = window.__arutaApp;
                if (app && app.exp && typeof app.exp.unmount === 'function') {
                    await app.exp.unmount(app.root, app.ctx);
                }
            } catch (err) {
                console.warn('[sandbox iframe] unmount threw', err);
            }
            try { parent.postMessage({ __aruta_sdk: true, type: 'teardown-ack' }, '*'); } catch (_) {}
        } else if (d.type === 'init') {
            try {
                const fileURLs = {};
                for (const [path, blob] of Object.entries(d.files)) {
                    fileURLs[path] = URL.createObjectURL(blob);
                }
                const ctx = {
                    appId: d.manifest.id,
                    sdkVersion: d.sdkVersion || 1,
                    asset: (p) => fileURLs[p] || fileURLs['assets/' + p] || null,
                    print: (s) => call('print', s),
                    clear: () => call('clear'),
                    toast: (m, t) => call('toast', m, t),
                    openWindow: (id) => call('openWindow', id),
                    closeWindow: (id) => call('closeWindow', id),
                    storage: {
                        get: (k) => call('storage.get', k),
                        set: (k, v) => call('storage.set', k, v),
                        remove: (k) => call('storage.remove', k),
                    },
                    fetch: async (url, opts) => {
                        const r = await call('fetch', url, opts);
                        return {
                            ok: r.ok, status: r.status, statusText: r.statusText,
                            text: async () => r.body,
                            json: async () => JSON.parse(r.body),
                            blob: async () => r.blob || new Blob([r.body || ''], { type: 'application/octet-stream' }),
                            arrayBuffer: async () => {
                                if (r.blob) return await r.blob.arrayBuffer();
                                return new TextEncoder().encode(r.body || '').buffer;
                            },
                        };
                    },
                    theme: { get: () => call('theme.get'), set: (t) => call('theme.set', t) },
                    clipboard: { read: () => call('clipboard.read'), write: (s) => call('clipboard.write', s) },
                    i18n: (k) => call('i18n', k),
                    installZip: (blob, opts) => call('installZip', blob, opts),
                    listInstalled: () => call('listInstalled'),
                    uninstall: (id) => call('uninstall', id),
                    repos: {
                        list: () => call('repos.list'),
                        add: (url, opts) => call('repos.add', url, opts),
                        remove: (url) => call('repos.remove', url),
                        setEnabled: (url, enabled) => call('repos.setEnabled', url, enabled),
                        update: (url, patch) => call('repos.update', url, patch),
                    },
                    defaults: {
                        list: () => call('defaults.list'),
                        restore: (id) => call('defaults.restore', id),
                    },
                    profile: {
                        isLinked: () => call('profile.isLinked'),
                        list:  (path) => call('profile.list',  path || ''),
                        read:  (path) => call('profile.read',  path || ''),
                        write: (path, bytes, mime) => call('profile.write', path || '', bytes, mime || ''),
                        remove:(path) => call('profile.remove', path || ''),
                    },
                    install: {
                        listFiles: (appId) => call('install.listPackageFiles', appId),
                        readFile:  (appId, path) => call('install.readPackageFile', appId, path),
                    },
                    handoff: (appId, payload) => call('handoff', appId, payload),
                    contextMenu: {
                        show: (opts) => call('contextMenu.show', opts || {}),
                    },
                    permission: { request: (p) => call('permission.request', p) },
                };
                // sync theme from host before user CSS loads so the first paint
                // already matches light/dark instead of flashing the CSS default.
                // Theme is sent in the init payload (no permission prompt).
                if (d.theme) document.documentElement.dataset.theme = d.theme;
                // inject style.css if present
                if (fileURLs['style.css']) {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = fileURLs['style.css'];
                    document.head.appendChild(link);
                }
                const role = d.role || 'app';
                const entryPath = (d.manifest.entriesResolved && d.manifest.entriesResolved[role]) || d.manifest.entry || 'index.js';
                // Mini-bundler: concatenate all .js files (except entry +
                // style.css) into the entry module so classes defined in
                // separate files are in scope. Fixes Firefox blob-URL
                // dynamic import limitation. Convention: dependency files
                // define classes/functions at top level (no export needed);
                // only the entry file uses export default.
                let bundledURL = fileURLs[entryPath];
                // Collect all resolved entry paths so they're excluded from bundling.
                const allEntries = new Set([entryPath]);
                if (d.manifest.entriesResolved) {
                    for (const v of Object.values(d.manifest.entriesResolved)) {
                        if (v) allEntries.add(v);
                    }
                }
                if (d.manifest.entry) allEntries.add(d.manifest.entry);
                const depFiles = Object.keys(fileURLs).filter(p =>
                    p.endsWith('.js') && !allEntries.has(p) && p !== 'style.css');
                if (depFiles.length > 0) {
                    const parts = [];
                    for (const dep of depFiles.sort()) {
                        const r = await fetch(fileURLs[dep]);
                        let txt = await r.text();
                        // Strip export keywords so they don't conflict at top level.
                        // Order matters: inline patterns (used by minified bundles such
                        // as Trystero — \`export{a,b};export default null;\`) must be
                        // removed before the line-start fallback that handles plain
                        // \`export default ...\` / \`export function/class/const ...\`.
                        txt = txt.replace(/export\\s*\\{[^}]*\\}\\s*;?/g, '');
                        txt = txt.replace(/export\\s+default\\s+null\\s*;?/g, '');
                        txt = txt.replace(/^export\\s+(default\\s+)?/gm, '');
                        parts.push('/* ── ' + dep + ' ── */\\n' + txt);
                    }
                    const entryR = await fetch(fileURLs[entryPath]);
                    const entryTxt = await entryR.text();
                    const bundle = parts.join('\\n\\n') + '\\n\\n/* ── ' + entryPath + ' ── */\\n' + entryTxt;
                    const blob = new Blob([bundle], { type: 'application/javascript' });
                    bundledURL = URL.createObjectURL(blob);
                }
                const mod = await import(bundledURL);
                const exp = mod.default || mod;
                if (typeof exp.mount === 'function') await exp.mount(root, ctx);
                // Stash the module and ctx so a later teardown message can
                // invoke exp.unmount(root, ctx) before the host removes the
                // iframe — lets apps detach document-level listeners.
                window.__arutaApp = { exp, root, ctx };
                parent.postMessage({ __aruta_sdk: true, type: 'mounted' }, '*');
            } catch (err) {
                root.innerHTML = '<pre style="color:#fb7185;padding:1rem;white-space:pre-wrap;">' + (err.stack || err.message || err) + '</pre>';
                parent.postMessage({ __aruta_sdk: true, type: 'error', error: String(err) }, '*');
            }
        }
    });
    parent.postMessage({ __aruta_sdk: true, type: 'ready' }, '*');
})();
<\/script></body></html>`;

async function mountApp(appId) {
    const manifest = window.registry.getManifest(appId);
    if (!manifest || !Array.isArray(manifest.roles) || !manifest.roles.includes('app')) return false;

    // SDK version gate: warn, don't block. Packages that absolutely need a
    // newer host feature can branch on `ctx.sdkVersion` inside their code.
    const requestedSDK = Number(manifest.sdk) || 1;
    if (requestedSDK > SDK_VERSION) {
        console.warn('[sandbox] ' + appId + ' requires SDK v' + requestedSDK + ', host is v' + SDK_VERSION);
    }

    const win = document.getElementById('win-' + appId);
    if (!win) return false;
    const content = win.querySelector('.custom-app-content');
    if (!content) return false;

    if (_mounted.has(appId)) return true;

    const files = await window.registry.getFiles(appId);

    content.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.className = 'sandbox-iframe';
    // Packages can opt into same-origin by declaring `allowOrigin: true` in
    // their manifest. This breaks the opaque-origin sandbox boundary (the
    // iframe can then reach window.parent and shares storage origin) but is
    // required for a handful of browser APIs — notably the File System
    // Access API (showDirectoryPicker) — which refuse to run in a null-
    // origin frame. Trust is on the user: the install modal shows the flag.
    // allow-modals lets apps use prompt()/alert()/confirm(). Without it these
    // silently return null in sandboxed iframes (Firefox/Chrome both block).
    const sandboxAttr = manifest.allowOrigin
        ? 'allow-scripts allow-same-origin allow-modals allow-downloads'
        : 'allow-scripts allow-modals allow-downloads';
    iframe.setAttribute('sandbox', sandboxAttr);
    console.debug('[sandbox] mounted', appId, 'with sandbox=', sandboxAttr);
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:transparent;';
    iframe.srcdoc = IFRAME_BOOT;
    content.appendChild(iframe);

    const onMsg = async (e) => {
        if (e.source !== iframe.contentWindow) return;
        const d = e.data;
        if (!d || !d.__aruta_sdk) return;
        if (d.type === 'ready') {
            const theme = window.currentTheme || document.documentElement.dataset.theme || 'dark';
            iframe.contentWindow.postMessage({ __aruta_sdk: true, type: 'init', manifest, files, theme, sdkVersion: SDK_VERSION }, '*');
        } else if (d.type === 'call') {
            try {
                const value = await _handleCall(appId, d.method, d.args || []);
                iframe.contentWindow.postMessage({ __aruta_sdk: true, type: 'reply', id: d.id, value }, '*');
            } catch (err) {
                iframe.contentWindow.postMessage({ __aruta_sdk: true, type: 'reply', id: d.id, error: String(err.message || err) }, '*');
            }
        } else if (d.type === 'error') {
            console.warn('[sandbox]', appId, d.error);
        }
    };
    window.addEventListener('message', onMsg);
    _mounted.set(appId, { iframe, onMsg });
    return true;
}

function unmountApp(appId) {
    const m = _mounted.get(appId);
    if (!m) return;
    // Notify the iframe so it can invoke exp.unmount(root, ctx) and detach
    // any document-level listeners (e.g. packagestore's install-change
    // handler). Fire-and-forget: we don't wait for ack because iframe removal
    // must stay synchronous for existing callers.
    try {
        m.iframe.contentWindow?.postMessage({ __aruta_sdk: true, type: 'teardown' }, '*');
    } catch (_) {}
    window.removeEventListener('message', m.onMsg);
    m.iframe.remove();
    _mounted.delete(appId);
}

async function runCommand(commandId, args) {
    const manifest = window.registry.getManifest(commandId);
    if (!manifest || !Array.isArray(manifest.roles) || !manifest.roles.includes('command')) throw new Error('not_a_command');
    const files = await window.registry.getFiles(commandId);
    const entryPath = (manifest.entriesResolved && manifest.entriesResolved.command) || manifest.entry || 'index.js';
    const entry = files[entryPath];
    if (!entry) throw new Error('entry_missing');

    const entryURL = URL.createObjectURL(entry);
    const { ctx, cleanup } = _buildHostCtx(commandId, files);
    try {
        const mod = await import(/* @vite-ignore */ entryURL);
        const exp = mod.default || mod;
        if (typeof exp.run === 'function') return await exp.run(args, ctx);
        throw new Error('command_missing_run');
    } finally {
        setTimeout(() => { URL.revokeObjectURL(entryURL); cleanup(); }, 1000);
    }
}

function _buildHostCtx(appId, files) {
    const fileURLs = {};
    for (const [p, b] of Object.entries(files || {})) fileURLs[p] = URL.createObjectURL(b);
    const cleanup = () => { for (const u of Object.values(fileURLs)) URL.revokeObjectURL(u); };
    const ctx = {
        appId,
        asset: (p) => fileURLs[p] || fileURLs['assets/' + p] || null,
        print: async (s) => { if (await window.permissions.request(appId, 'terminal')) window.terminal?.print(String(s ?? '')); },
        clear: async () => { if (await window.permissions.request(appId, 'terminal')) window.terminal?.clear(); },
        toast: async (m, t) => { if (await window.permissions.request(appId, 'notifications')) window.showToast?.(String(m ?? ''), t || 'info'); },
        openWindow: async (id) => { if (await window.permissions.request(appId, 'windows')) window.openWindow?.(id); },
        closeWindow: async (id) => { if (await window.permissions.request(appId, 'windows')) window.closeWindow?.(id); },
        storage: {
            get: async (k) => (await window.permissions.request(appId, 'storage')) ? _appStorageGet(appId, k) : null,
            set: async (k, v) => (await window.permissions.request(appId, 'storage')) ? _appStorageSet(appId, k, v) : false,
            remove: async (k) => (await window.permissions.request(appId, 'storage')) ? _appStorageRemove(appId, k) : false,
        },
        fetch: async (url, opts) => {
            if (!(await window.permissions.request(appId, 'fetch'))) throw new Error('permission_denied:fetch');
            return fetch(url, opts);
        },
        theme: {
            get: async () => (await window.permissions.request(appId, 'theme')) ? (window.currentTheme || document.documentElement.dataset.theme) : null,
            set: async (t) => { if (await window.permissions.request(appId, 'theme')) { if (t !== window.currentTheme) toggleTheme(); } },
        },
        clipboard: {
            read: async () => (await window.permissions.request(appId, 'clipboard')) ? navigator.clipboard.readText() : null,
            write: async (s) => (await window.permissions.request(appId, 'clipboard')) ? navigator.clipboard.writeText(String(s ?? '')) : false,
        },
        i18n: (k) => (window.i18n?.[window.currentLang] || {})[k] || k,
        permission: { request: (p) => window.permissions.request(appId, p) },
        installZip: async (blob, opts) => {
            if (!(await window.permissions.request(appId, 'install'))) throw new Error('permission_denied:install');
            const file = (typeof File !== 'undefined' && blob instanceof File)
                ? blob
                : new File([blob], (opts && opts.filename) || 'remote.zip', { type: blob.type || 'application/zip' });
            const m = await window.installer.installFromFile(file);
            if (!m) return null;
            return { id: m.id, name: m.name, version: m.version, type: m.type, roles: m.roles };
        },
        uninstall: async (id) => {
            if (!(await window.permissions.request(appId, 'install'))) throw new Error('permission_denied:install');
            return window.registry?.uninstall ? await window.registry.uninstall(id) : false;
        },
        listInstalled: async () => {
            if (!(await window.permissions.request(appId, 'install'))) throw new Error('permission_denied:install');
            const all = window.registry?.list() || [];
            return all.map(m => ({ id: m.id, name: m.name, icon: m.icon || null, version: m.version || null, type: m.type, roles: Array.isArray(m.roles) ? m.roles.slice() : (m.type ? [m.type] : []), _origin: m._origin || 'user' }));
        },
        repos: {
            list:       async () => (await window.permissions.request(appId, 'install')) ? window.repos.list() : [],
            add:        async (url, opts) => (await window.permissions.request(appId, 'install')) ? window.repos.add(url, opts) : null,
            remove:     async (url) => (await window.permissions.request(appId, 'install')) ? window.repos.remove(url) : false,
            setEnabled: async (url, en) => (await window.permissions.request(appId, 'install')) ? window.repos.setEnabled(url, en) : false,
            update:     async (url, patch) => (await window.permissions.request(appId, 'install')) ? window.repos.update(url, patch) : null,
        },
        defaults: {
            list:    async () => (await window.permissions.request(appId, 'install')) ? (window.defaults?.list ? window.defaults.list() : []) : [],
            restore: async (id) => (await window.permissions.request(appId, 'install')) ? (window.defaults?.restore ? window.defaults.restore(id) : null) : null,
        },
    };
    return { ctx, cleanup };
}

async function closeAppStorage(appId) {
    await window.db.closeDB((window.Storage?.constants.APP_DB_PREFIX || 'aruta_app_') + appId);
}

/**
 * Mount a package as a floating draggable widget. Parallel to mountApp but
 * uses the package's widget entry (manifest.entriesResolved.widget) and a
 * compact .widget-frame container inserted into the desktop instead of a
 * full OS window. Same postMessage protocol, same ctx SDK.
 *
 * @param {string} widgetId — package id (must have 'widget' role)
 * @param {object} opts — { container: HTMLElement, onReady: () => void }
 * @returns {Promise<boolean>} true on success
 */
async function mountWidget(widgetId, opts) {
    opts = opts || {};
    const manifest = window.registry.getManifest(widgetId);
    if (!manifest || !Array.isArray(manifest.roles) || !manifest.roles.includes('widget')) return false;
    if (_mountedWidgets.has(widgetId)) return true;

    const container = opts.container;
    if (!container) return false;

    const files = await window.registry.getFiles(widgetId);

    const iframe = document.createElement('iframe');
    iframe.className = 'widget-iframe';
    const sandboxAttr = manifest.allowOrigin
        ? 'allow-scripts allow-same-origin allow-modals allow-downloads'
        : 'allow-scripts allow-modals allow-downloads';
    iframe.setAttribute('sandbox', sandboxAttr);
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:transparent;';
    iframe.srcdoc = IFRAME_BOOT;
    container.appendChild(iframe);

    const onMsg = async (e) => {
        if (e.source !== iframe.contentWindow) return;
        const d = e.data;
        if (!d || !d.__aruta_sdk) return;
        if (d.type === 'ready') {
            const theme = window.currentTheme || document.documentElement.dataset.theme || 'dark';
            iframe.contentWindow.postMessage({ __aruta_sdk: true, type: 'init', manifest, files, theme, sdkVersion: SDK_VERSION, role: 'widget' }, '*');
        } else if (d.type === 'call') {
            try {
                const value = await _handleCall(widgetId, d.method, d.args || []);
                iframe.contentWindow.postMessage({ __aruta_sdk: true, type: 'reply', id: d.id, value }, '*');
            } catch (err) {
                iframe.contentWindow.postMessage({ __aruta_sdk: true, type: 'reply', id: d.id, error: String(err.message || err) }, '*');
            }
        } else if (d.type === 'error') {
            console.warn('[sandbox:widget]', widgetId, d.error);
        } else if (d.type === 'mounted' && typeof opts.onReady === 'function') {
            opts.onReady();
        }
    };
    window.addEventListener('message', onMsg);
    _mountedWidgets.set(widgetId, { iframe, onMsg, container });
    return true;
}

function unmountWidget(widgetId) {
    const m = _mountedWidgets.get(widgetId);
    if (!m) return;
    try { m.iframe.contentWindow?.postMessage({ __aruta_sdk: true, type: 'teardown' }, '*'); } catch (_) {}
    window.removeEventListener('message', m.onMsg);
    m.iframe.remove();
    _mountedWidgets.delete(widgetId);
}

window.sandbox = { mount: mountApp, unmount: unmountApp, runCommand, closeAppStorage, broadcastTheme, broadcastInstallChange, SDK_VERSION, PERM_REQUIRED, normalizeManifest, isMounted: (id) => _mounted.has(id), mountWidget, unmountWidget, isWidgetMounted: (id) => _mountedWidgets.has(id) };
