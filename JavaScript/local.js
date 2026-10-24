/* ╔══════════════════════════════════════════════════════════╗
 * ║  LOCAL — arutosiod bridge for the browser                  ║
 * ║  Detects the local daemon, handles login/CSRF and exposes  ║
 * ║  fs/profile helpers to the host. Iframes never see the     ║
 * ║  token or the CSRF value; sandbox.js mediates every call. ║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    const state = {
        local: false,
        version: null,
        capabilities: [],
        csrf: null,
        cookie: false,
    };

    const DEVICE_LOCAL = /^arutosio_(device_id|low_power|theme_follow_os|perms_|handoff_|session_|term_session)/;
    const SYNC_DEBOUNCE = 900;
    let lastPushed = null;
    let pushTimer = null;
    let syncStarted = false;
    let pulling = false;
    let appearanceTimer = null;
    const appTimers = new Map();

    let resolveReady;
    window.__arutosioLocalReady = new Promise((resolve) => { resolveReady = resolve; });

    function isMutating(method) {
        return /^(POST|PUT|PATCH|DELETE)$/i.test(method || 'GET');
    }

    function authError(message) {
        const err = new Error(message || 'unauthorized');
        err.code = 'unauthorized';
        return err;
    }

    async function fetchJSON(path, opts) {
        const res = await fetch(path, Object.assign({
            credentials: 'same-origin',
            cache: 'no-store',
        }, opts || {}));
        if (res.status === 401) {
            showLogin();
            throw authError('unauthorized');
        }
        if (!res.ok) {
            let message = res.status + ' ' + res.statusText;
            try {
                const body = await res.json();
                if (body && body.error) message = body.error;
            } catch (_) {}
            throw new Error(message);
        }
        return res;
    }

    async function api(path, opts) {
        const options = Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {});
        const headers = new Headers(options.headers || {});
        if (isMutating(options.method) && state.csrf) headers.set('X-Arutosio-CSRF', state.csrf);
        options.headers = headers;
        return fetchJSON(path, options);
    }

    async function json(path, opts) {
        return (await api(path, opts)).json();
    }

    async function optionalJSON(path) {
        const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
        if (res.status === 401) {
            showLogin();
            throw authError('unauthorized');
        }
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        return res.json();
    }

    async function probe() {
        try {
            const res = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' });
            if (!res.ok) return false;
            const data = await res.json();
            if (!data || data.name !== 'arutosiod' || data.mode !== 'local') return false;
            state.local = true;
            state.version = data.version || null;
            state.capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
            return true;
        } catch (_) {
            return false;
        }
    }

    async function loadSession() {
        const res = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
        if (res.status === 401) return false;
        if (!res.ok) return false;
        const data = await res.json();
        if (!data || !data.authenticated) return false;
        state.csrf = data.csrf || null;
        state.cookie = !!data.cookie;
        return true;
    }

    async function login(token) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: String(token || '') }),
        });
        if (!res.ok) {
            let message = 'Invalid token';
            try {
                const body = await res.json();
                if (body && body.error) message = body.error;
            } catch (_) {}
            throw new Error(message);
        }
        const data = await res.json();
        state.csrf = data.csrf || null;
        state.cookie = true;
        return true;
    }

    async function logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } catch (_) {}
        state.csrf = null;
        state.cookie = false;
        location.reload();
    }

    function tokenFromURL() {
        const q = new URLSearchParams(location.search);
        const h = new URLSearchParams(location.hash.replace(/^#/, ''));
        return q.get('token') || h.get('setup') || h.get('token') || '';
    }

    function clearTokenFromURL() {
        try {
            const q = new URLSearchParams(location.search);
            const h = new URLSearchParams(location.hash.replace(/^#/, ''));
            q.delete('token');
            h.delete('setup');
            h.delete('token');
            const qs = q.toString();
            const hs = h.toString();
            history.replaceState({}, '', location.pathname + (qs ? '?' + qs : '') + (hs ? '#' + hs : ''));
        } catch (_) {}
    }

    function showLogin() {
        if (document.getElementById('arutosio-login')) return;
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', showLogin, { once: true });
            return;
        }
        const overlay = document.createElement('div');
        overlay.id = 'arutosio-login';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'arutosio-login-title');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(12,10,26,.96);color:#e8e6f0;font-family:var(--font-body,system-ui,sans-serif);';

        const card = document.createElement('div');
        card.style.cssText = 'width:min(420px,100%);background:#171329;border:1px solid rgba(255,200,87,.35);border-radius:14px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.5);';

        const title = document.createElement('h2');
        title.id = 'arutosio-login-title';
        title.textContent = 'Arutosio — This machine';
        title.style.cssText = 'margin:0 0 6px;font-size:20px;';

        const desc = document.createElement('p');
        desc.textContent = 'Sign in with the arutosiod token. It is stored on the machine in ~/.arutosio/token and printed by the daemon at startup.';
        desc.style.cssText = 'margin:0 0 16px;font-size:13px;line-height:1.5;color:#b9b4cc;';

        const input = document.createElement('input');
        input.type = 'password';
        input.autocomplete = 'current-password';
        input.placeholder = 'access token';
        input.setAttribute('aria-label', 'Access token');
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid #3a3358;background:#0f0c1d;color:#fff;font:inherit;';

        const error = document.createElement('div');
        error.setAttribute('role', 'alert');
        error.style.cssText = 'min-height:18px;margin:8px 0 12px;font-size:12px;color:#fb7185;';

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Connect';
        button.style.cssText = 'width:100%;padding:11px 14px;border:0;border-radius:9px;background:#ffc857;color:#1a1320;font:inherit;font-weight:700;cursor:pointer;';

        async function submit() {
            const token = input.value.trim();
            if (!token) { error.textContent = 'Token required'; input.focus(); return; }
            button.disabled = true;
            button.textContent = 'Connecting…';
            error.textContent = '';
            try {
                await login(token);
                clearTokenFromURL();
                location.reload();
            } catch (e) {
                error.textContent = e.message || 'Login failed';
                button.disabled = false;
                button.textContent = 'Connect';
                input.select();
            }
        }

        button.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        card.append(title, desc, input, error, button);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        setTimeout(() => input.focus(), 30);
    }

    function snapshotLocalStorage() {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith('arutosio_')) continue;
            if (DEVICE_LOCAL.test(key)) continue;
            const value = localStorage.getItem(key);
            if (value != null) out[key] = value;
        }
        return out;
    }

    function applyRemoteLocalStorage(remote) {
        let changed = false;
        for (const [key, value] of Object.entries(remote || {})) {
            if (!key.startsWith('arutosio_') || DEVICE_LOCAL.test(key)) continue;
            if (typeof value !== 'string') continue;
            if (localStorage.getItem(key) !== value) {
                try { localStorage.setItem(key, value); changed = true; } catch (_) {}
            }
        }
        return changed;
    }

    function hashString(s) {
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(36);
    }

    async function pushLocalStorage(force) {
        if (!state.local || !state.csrf) return;
        const data = snapshotLocalStorage();
        const serialized = JSON.stringify(data);
        if (!force && serialized === lastPushed) return;
        lastPushed = serialized;
        try {
            await json('/api/profile/localStorage', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: serialized,
            });
        } catch (e) {
            console.warn('[local] profile sync failed', e);
            lastPushed = null;
        }
    }

    function schedulePush() {
        if (!state.local || !state.csrf) return;
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(() => { pushTimer = null; pushLocalStorage(false); }, SYNC_DEBOUNCE);
    }

    async function dumpApp(appId) {
        if (!window.Storage?.appKV?.dumpAll) return null;
        const map = await window.Storage.appKV.dumpAll(appId);
        const out = {};
        for (const [key, value] of map) out[key] = value;
        return out;
    }

    async function pushApp(appId) {
        if (!state.local || !state.csrf || pulling || !appId) return;
        try {
            const data = await dumpApp(appId);
            if (data) await profile.putApp(appId, data);
        } catch (e) {
            console.warn('[local] app sync failed', appId, e);
        }
    }

    function scheduleApp(appId) {
        if (!state.local || pulling || !appId) return;
        if (appTimers.has(appId)) clearTimeout(appTimers.get(appId));
        appTimers.set(appId, setTimeout(() => {
            appTimers.delete(appId);
            pushApp(appId);
        }, SYNC_DEBOUNCE));
    }

    async function pullApps(ids) {
        if (!state.local || !Array.isArray(ids) || !window.Storage?.appKV) return;
        pulling = true;
        try {
            for (const id of ids) {
                if (!id) continue;
                const data = await profile.getApp(id);
                if (data) {
                    for (const [key, value] of Object.entries(data)) {
                        await window.Storage.appKV.set(id, key, value);
                    }
                } else {
                    const dump = await dumpApp(id);
                    if (dump) await profile.putApp(id, dump);
                }
            }
        } catch (e) {
            console.warn('[local] app pull failed', e);
        } finally {
            pulling = false;
        }
    }

    async function pushAppearance() {
        if (!state.local || !state.csrf || !window.appearance?.dumpForSnapshot) return;
        try {
            const items = await window.appearance.dumpForSnapshot();
            for (const item of items) {
                if (!item || !item.key) continue;
                await api('/api/profile/appearance/' + encodeURIComponent(item.key), {
                    method: 'PUT',
                    headers: { 'Content-Type': item.mime || 'application/octet-stream' },
                    body: item.bytes,
                });
            }
        } catch (e) {
            console.warn('[local] appearance sync failed', e);
        }
    }

    function scheduleAppearance() {
        if (!state.local) return;
        if (appearanceTimer) clearTimeout(appearanceTimer);
        appearanceTimer = setTimeout(() => { appearanceTimer = null; pushAppearance(); }, 1400);
    }

    async function pullAppearance() {
        if (!state.local || !window.appearance?.restoreFromSnapshot) return;
        let meta = {};
        try { meta = JSON.parse(localStorage.getItem('arutosio_appearance_meta') || '{}'); } catch { return; }
        const refs = [];
        const bgs = Array.isArray(meta.backgrounds) ? meta.backgrounds : [];
        for (const bg of bgs) {
            if (!bg || bg.src || !bg.id) continue;
            refs.push({
                key: 'bg_' + bg.id,
                kind: bg.kind || 'image',
                mime: bg.mime || 'application/octet-stream',
                filename: bg.filename || '',
            });
        }
        if (meta.background && !bgs.length) {
            refs.push({
                key: 'background',
                kind: meta.background.kind || 'image',
                mime: meta.background.mime || 'application/octet-stream',
                filename: meta.background.filename || '',
            });
        }
        if (meta.portrait) {
            refs.push({
                key: 'portrait',
                kind: 'image',
                mime: meta.portrait.mime || 'image/png',
                filename: meta.portrait.filename || '',
            });
        }
        if (!refs.length) return;
        const items = [];
        for (const ref of refs) {
            const res = await fetch('/api/profile/appearance/' + encodeURIComponent(ref.key), {
                credentials: 'same-origin',
                cache: 'no-store',
            });
            if (res.status === 404) { items.length = 0; break; }
            if (!res.ok) return;
            items.push({ ...ref, bytes: new Uint8Array(await res.arrayBuffer()) });
        }
        if (items.length === refs.length) {
            await window.appearance.restoreFromSnapshot(items);
        } else {
            await pushAppearance();
        }
    }

    function startSync() {
        if (syncStarted) return;
        syncStarted = true;
        document.addEventListener('arutosio:storage', schedulePush);
        document.addEventListener('arutosio:app-storage', (e) => scheduleApp(e.detail?.appId));
        document.addEventListener('arutosio:appearance', scheduleAppearance);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') pushLocalStorage(false);
        });
        window.addEventListener('pagehide', () => pushLocalStorage(false));
        setInterval(() => {
            if (document.visibilityState === 'visible') pushLocalStorage(false);
        }, 3000);
    }

    const fs = {
        async roots() { return json('/api/fs/roots'); },
        async list(path) { return json('/api/fs/list?path=' + encodeURIComponent(path || '')); },
        async stat(path) { return json('/api/fs/stat?path=' + encodeURIComponent(path || '')); },
        async read(path, max) {
            const suffix = max ? '&max=' + encodeURIComponent(String(max)) : '';
            const res = await api('/api/fs/read?path=' + encodeURIComponent(path || '') + suffix);
            const bytes = new Uint8Array(await res.arrayBuffer());
            return {
                bytes,
                mime: res.headers.get('content-type') || '',
                etag: res.headers.get('x-arutosio-etag') || '',
                mtime: res.headers.get('x-arutosio-mtime') || '',
                size: bytes.byteLength,
            };
        },
        async write(path, bytes, etag) {
            const headers = {};
            if (etag) headers['If-Match'] = etag;
            return json('/api/fs/write?path=' + encodeURIComponent(path || ''), {
                method: 'PUT', headers, body: bytes,
            });
        },
        async upload(path, file, overwrite) {
            const q = '?path=' + encodeURIComponent(path || '') + (overwrite ? '&overwrite=1' : '');
            return json('/api/fs/upload' + q, {
                method: 'POST',
                headers: { 'Content-Type': (file && file.type) || 'application/octet-stream' },
                body: file,
            });
        },
        async mkdir(path) {
            return json('/api/fs/mkdir', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
            });
        },
        async rename(from, to) {
            return json('/api/fs/rename', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from, to }),
            });
        },
        async remove(path, opts) {
            const options = opts || {};
            return json('/api/fs/delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, trash: options.trash !== false, confirm: !!options.confirm }),
            });
        },
        async download(path) {
            const a = document.createElement('a');
            a.href = '/api/fs/download?path=' + encodeURIComponent(path || '');
            document.body.appendChild(a);
            a.click();
            a.remove();
        },
    };

    const system = {
        info: () => json('/api/system/info'),
        processes: () => json('/api/system/processes'),
        kill: (pid) => json('/api/system/kill', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pid: Number(pid) }),
        }),
        services: () => json('/api/system/services'),
        service: (name, action) => json('/api/system/service', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, action }),
        }),
        trash: () => json('/api/system/trash'),
        trashList: () => json('/api/system/trash/list'),
        restoreTrash: (id) => json('/api/system/trash/restore', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        }),
        emptyTrash: () => json('/api/system/trash/empty', { method: 'POST' }),
        terms: () => json('/api/system/terms'),
        killTerm: (id) => json('/api/system/terms/kill', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        }),
    };

    const profile = {
        async getLocalStorage() { return optionalJSON('/api/profile/localStorage'); },
        async putLocalStorage(obj) {
            return json('/api/profile/localStorage', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(obj || {}),
            });
        },
        async getApp(id) { return optionalJSON('/api/profile/apps/' + encodeURIComponent(id)); },
        async putApp(id, obj) {
            return json('/api/profile/apps/' + encodeURIComponent(id), {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(obj || {}),
            });
        },
        async getSession(id) { return optionalJSON('/api/profile/session/' + encodeURIComponent(id)); },
        async putSession(id, data) {
            return json('/api/profile/session/' + encodeURIComponent(id), {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data || {}),
            });
        },
    };

    function openTerm(cols, rows, session) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        let q = '?cols=' + encodeURIComponent(String(cols || 80)) +
            '&rows=' + encodeURIComponent(String(rows || 24));
        if (session) q += '&session=' + encodeURIComponent(String(session));
        return new WebSocket(proto + '//' + location.host + '/ws/term' + q);
    }

    window.arutosioLocal = {
        get isLocal() { return state.local; },
        get version() { return state.version; },
        get capabilities() { return state.capabilities.slice(); },
        get authenticated() { return !!state.csrf; },
        login,
        logout,
        showLogin,
        fs,
        profile,
        system,
        openTerm,
        pullApps,
        syncNow: () => pushLocalStorage(true),
    };

    async function boot() {
        try {
            if (!(await probe())) { resolveReady(false); return; }
            let ok = await loadSession();
            if (!ok) {
                const token = tokenFromURL();
                if (token) {
                    try {
                        await login(token);
                        clearTokenFromURL();
                        ok = true;
                    } catch (e) {
                        console.warn('[local] token from URL rejected', e);
                    }
                }
            }
            if (!ok) {
                showLogin();
                return; // ready resolves after the login reload
            }
            const remote = await profile.getLocalStorage();
            if (remote && Object.keys(remote).length) {
                const changed = applyRemoteLocalStorage(remote);
                const remoteHash = hashString(JSON.stringify(remote));
                if (changed && sessionStorage.getItem('arutosio_local_sync') !== remoteHash) {
                    sessionStorage.setItem('arutosio_local_sync', remoteHash);
                    location.reload();
                    return;
                }
                lastPushed = JSON.stringify(snapshotLocalStorage());
            } else {
                await pushLocalStorage(true);
            }
            try { await pullAppearance(); } catch (e) { console.warn('[local] appearance pull failed', e); }
            startSync();
            resolveReady(true);
        } catch (e) {
            console.warn('[local] boot failed', e);
            resolveReady(false);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
