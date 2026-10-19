/* ╔══════════════════════════════════════════════════════════╗
 * ║  DB — Promise-based IndexedDB helpers (shared)            ║
 * ║  Used by registry.js (aruta_packages) and sandbox.js      ║
 * ║  (aruta_app_<id>). Handles are cached per DB name.        ║
 * ╚══════════════════════════════════════════════════════════╝ */

const _cache = new Map();

/** Open (and cache) a DB. `upgrade(db)` runs on onupgradeneeded. */
function openDB(name, version, upgrade) {
    const cacheKey = name + '@' + version;
    let p = _cache.get(cacheKey);
    if (p) return p;
    p = new Promise((resolve, reject) => {
        const req = indexedDB.open(name, version);
        req.onupgradeneeded = (e) => { if (upgrade) upgrade(e.target.result, e); };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => { _cache.delete(cacheKey); reject(req.error); };
    });
    _cache.set(cacheKey, p);
    return p;
}

/** Drop a cached handle (and close the DB) so deleteDatabase can proceed. */
async function closeDB(name, version) {
    const cacheKey = version != null ? name + '@' + version : null;
    for (const [key, p] of _cache) {
        if (cacheKey ? key === cacheKey : key.startsWith(name + '@')) {
            try { const db = await p; db.close(); } catch {}
            _cache.delete(key);
        }
    }
}

/** Run a transaction and resolve when it completes. `fn(stores)` can return
    a value, or use `setResult()` inside — the resolved value is that. */
function txRun(db, stores, mode, fn) {
    return new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let result;
        const storeMap = (Array.isArray(stores) ? stores : [stores])
            .reduce((acc, s) => (acc[s] = t.objectStore(s), acc), {});
        t.oncomplete = () => resolve(result);
        t.onerror    = () => reject(t.error);
        t.onabort    = () => reject(t.error || new Error('tx aborted'));
        try { result = fn(storeMap, t); } catch (e) { reject(e); }
    });
}

/** Read every row that matches a key range from an object store. */
function rangeCollect(store, range) {
    return new Promise((resolve, reject) => {
        const out = [];
        const req = store.openCursor(range);
        req.onsuccess = (e) => {
            const c = e.target.result;
            if (c) { out.push(c.value); c.continue(); }
            else   resolve(out);
        };
        req.onerror = () => reject(req.error);
    });
}

/** Delete every row that matches a key range. */
function rangeDelete(store, range) {
    return new Promise((resolve, reject) => {
        const req = store.openCursor(range);
        req.onsuccess = (e) => {
            const c = e.target.result;
            if (c) { c.delete(); c.continue(); }
            else   resolve();
        };
        req.onerror = () => reject(req.error);
    });
}

window.db = { openDB, closeDB, txRun, rangeCollect, rangeDelete };
