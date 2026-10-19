/* ╔══════════════════════════════════════════════════════════╗
 * ║  REPOS — System-level registry of package-store sources   ║
 * ║  Promoted from Package Store private state so any app or  ║
 * ║  command can browse / mutate enabled repositories.        ║
 * ║  Backed by localStorage.aruta_repos (rides profile mirror)║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    const LS_KEY = 'aruta_repos';

    const DEFAULT_SEED = [{
        url: 'https://raw.githubusercontent.com/Arutosio/aruta.sh/master/packages/index.json',
        name: 'Official',
        description: 'Curated bundle by Aruta',
        enabled: false,
        addedAt: Date.now(),
    }];

    let _repos = [];
    const _listeners = new Set();

    function _read() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : null;
        } catch { return null; }
    }
    function _write() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(_repos)); }
        catch (e) { console.warn('[repos] write failed', e); }
        // Mirror into linked Profile folder so cross-device sync picks up
        // repo edits even when no other localStorage write follows.
        try { window.profile?.markDirty?.('localStorage'); } catch (_) {}
    }
    function _emit() {
        for (const cb of Array.from(_listeners)) {
            try { cb(list()); } catch (e) { console.warn('[repos] listener', e); }
        }
    }
    function _normalizeURL(url) {
        if (typeof url !== 'string') return null;
        const u = url.trim();
        if (!/^https?:\/\//i.test(u)) return null;
        return u;
    }
    function _clone(r) {
        // Use JSON round-trip when possible; cachedIndex may be a plain object.
        try { return JSON.parse(JSON.stringify(r)); }
        catch { return { ...r }; }
    }

    function list() {
        return _repos.map(_clone);
    }

    function add(url, opts) {
        const norm = _normalizeURL(url);
        if (!norm) throw new Error('repos.add: url must be http(s)');
        if (_repos.some(r => r.url === norm)) throw new Error('repos.add: duplicate');
        const o = opts || {};
        const repo = {
            url: norm,
            name: o.name || (() => { try { return new URL(norm).hostname; } catch { return norm; } })(),
            description: o.description || '',
            enabled: o.enabled !== undefined ? !!o.enabled : true,
            addedAt: o.addedAt || Date.now(),
            lastFetched: o.lastFetched || null,
            etag: o.etag || null,
            cachedIndex: o.cachedIndex || null,
        };
        _repos.push(repo);
        _write();
        _emit();
        return _clone(repo);
    }

    function remove(url) {
        const before = _repos.length;
        _repos = _repos.filter(r => r.url !== url);
        if (_repos.length === before) return false;
        _write();
        _emit();
        return true;
    }

    function setEnabled(url, enabled) {
        const r = _repos.find(x => x.url === url);
        if (!r) return false;
        r.enabled = !!enabled;
        _write();
        _emit();
        return true;
    }

    function update(url, patch) {
        const r = _repos.find(x => x.url === url);
        if (!r || !patch || typeof patch !== 'object') return null;
        // Whitelist mutable fields to keep storage tidy.
        const allowed = ['name', 'description', 'enabled', 'lastFetched',
                         'etag', 'cachedIndex', 'lastError', 'displayName'];
        for (const k of allowed) {
            if (k in patch) r[k] = patch[k];
        }
        _write();
        _emit();
        return _clone(r);
    }

    function onChange(cb) { if (typeof cb === 'function') _listeners.add(cb); }
    function offChange(cb) { _listeners.delete(cb); }

    // ── Boot ──────────────────────────────────────────────────
    const initial = _read();
    if (initial && initial.length) {
        _repos = initial;
    } else {
        // Before seeding defaults, check for a one-shot legacy migration from
        // the old packagestore private IDB kv store. If found, prefer that
        // over the seed so the user keeps their custom repos. We still mark
        // `_repos` with seed synchronously so callers never see `undefined`;
        // the migration swaps in the real list once it resolves and emits.
        _repos = DEFAULT_SEED.map(r => ({ ...r }));
        _write();
        _tryMigrateLegacyPackagestoreRepos();
    }

    // One-shot: copy legacy `repos` entry from `aruta_app_packagestore.kv`
    // into `localStorage.aruta_repos` and drop it from IDB. Silent on miss.
    function _tryMigrateLegacyPackagestoreRepos() {
        try {
            const req = indexedDB.open('aruta_app_packagestore');
            // If upgradeneeded fires, the DB didn't previously exist. Abort so
            // we don't leave an empty v1 stub that would block the real
            // sandbox _appStorageDB from creating its 'kv' store later.
            req.onupgradeneeded = (e) => {
                try { e.target.transaction.abort(); } catch (_) {}
            };
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('kv')) {
                    // Either this boot created a stub, or an earlier buggy
                    // migration did. Either way, delete it so the next
                    // _appStorageDB open recreates it with kv.
                    try { db.close(); } catch (_) {}
                    try { indexedDB.deleteDatabase('aruta_app_packagestore'); } catch (_) {}
                    return;
                }
                try {
                    const t = db.transaction('kv', 'readwrite');
                    const store = t.objectStore('kv');
                    const g = store.get('repos');
                    g.onsuccess = () => {
                        const legacy = g.result;
                        if (Array.isArray(legacy) && legacy.length) {
                            _repos = legacy;
                            _write();
                            _emit();
                            try { store.delete('repos'); } catch (_) {}
                        }
                    };
                    t.oncomplete = () => { try { db.close(); } catch (_) {} };
                } catch (_) { try { db.close(); } catch (__) {} }
            };
            // abort() + deleteDatabase both surface as error — swallow silently
            req.onerror = () => {};
        } catch (_) {}
    }

    window.repos = { list, add, remove, setEnabled, update, onChange, offChange };
})();
