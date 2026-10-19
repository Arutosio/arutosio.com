/* ╔══════════════════════════════════════════════════════════╗
 * ║  STORAGE — Tiny facade over localStorage + IndexedDB      ║
 * ║  Centralizes DB/key string literals so registry/profile/  ║
 * ║  sandbox/defaults go through one place. Additive — does   ║
 * ║  NOT replace util.js `window.storage` (kept for back-compat). ║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    const constants = {
        PACKAGES_DB:   'aruta_packages',
        APP_DB_PREFIX: 'aruta_app_',
        LS_PREFIX:     'aruta_',
    };

    // ── localStorage shim ──────────────────────────────────
    // Thin passthrough to util.js's window.storage. Kept here so
    // callers have a single, obvious import surface.
    const ls = {
        get(key, fallback = null) { return window.storage ? window.storage.get(key, fallback) : fallback; },
        set(key, value)           { return window.storage ? window.storage.set(key, value) : false; },
        del(key)                  { return window.storage ? window.storage.del(key) : false; },
    };

    // ── registry (aruta_packages) ──────────────────────────
    const registry = {
        /** Open the shared package registry DB. Uses the cached handle
         *  from db.js — safe to call repeatedly. */
        openDB() {
            return window.db.openDB(constants.PACKAGES_DB, 1, (db) => {
                if (!db.objectStoreNames.contains('manifests')) db.createObjectStore('manifests', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('files'))     db.createObjectStore('files',     { keyPath: ['appId', 'path'] });
            });
        },
    };

    // ── per-app KV (aruta_app_<id>) ────────────────────────
    function _appDB(appId) {
        return window.db.openDB(constants.APP_DB_PREFIX + appId, 1, (db) => {
            if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        });
    }

    const appKV = {
        async get(appId, key) {
            const db = await _appDB(appId);
            return new Promise((res, rej) => {
                const t = db.transaction('kv', 'readonly');
                const r = t.objectStore('kv').get(key);
                r.onsuccess = () => res(r.result === undefined ? null : r.result);
                r.onerror   = () => rej(r.error);
            });
        },
        async set(appId, key, value) {
            const db = await _appDB(appId);
            return new Promise((res, rej) => {
                const t = db.transaction('kv', 'readwrite');
                t.objectStore('kv').put(value, key);
                t.oncomplete = () => {
                    try { window.profile?.markDirty?.('app', appId); } catch {}
                    res(true);
                };
                t.onerror = () => rej(t.error);
            });
        },
        async remove(appId, key) {
            const db = await _appDB(appId);
            return new Promise((res, rej) => {
                const t = db.transaction('kv', 'readwrite');
                t.objectStore('kv').delete(key);
                t.oncomplete = () => {
                    try { window.profile?.markDirty?.('app', appId); } catch {}
                    res(true);
                };
                t.onerror = () => rej(t.error);
            });
        },
        /** Snapshot every key/value in the app's KV store as a Map.
         *  Used by profile.js when exporting the portable snapshot. */
        async dumpAll(appId) {
            const db = await _appDB(appId);
            return new Promise((res, rej) => {
                const out = new Map();
                const t = db.transaction('kv', 'readonly');
                const req = t.objectStore('kv').openCursor();
                req.onsuccess = (e) => {
                    const c = e.target.result;
                    if (c) { out.set(String(c.key), c.value); c.continue(); }
                    else res(out);
                };
                req.onerror = () => rej(req.error);
            });
        },
    };

    /** Drop an app's entire private KV DB. Callers should first close any
     *  cached handle (see window.sandbox.closeAppStorage). */
    function deleteAppKV(appId) {
        try { return indexedDB.deleteDatabase(constants.APP_DB_PREFIX + appId); }
        catch { return null; }
    }

    window.Storage = { ls, registry, appKV, deleteAppKV, constants };
})();
