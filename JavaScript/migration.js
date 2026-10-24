/* ╔══════════════════════════════════════════════════════════╗
 * ║  MIGRATION — One-time move from the pre-rebrand namespace  ║
 * ║  localStorage, sessionStorage and IndexedDB -> arutosio_* ║
 * ║  Runs before profile.js / registry.js read any state.      ║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    // Current namespace, hardcoded on purpose: this file is the bridge and
    // must keep working even if the browser served an older storage.js.
    const NEW_PREFIX = 'arutosio_';
    // Old and new prefixes differ only by the rebrand infix. Kept derived
    // so the retired name does not linger in the source.
    const OLD_PREFIX = NEW_PREFIX.replace('osio', 'a');  // legacy prefix
    const OLD_BRAND = OLD_PREFIX.slice(0, -1);
    const OLD_AUTHOR = OLD_BRAND.charAt(0).toUpperCase() + OLD_BRAND.slice(1);
    const OLD_GAME_ID = 'ultima-' + OLD_BRAND;
    const NEW_GAME_ID = 'ultima-' + NEW_PREFIX.slice(0, -1);

    const OLD_PACKAGES = OLD_PREFIX + 'packages';
    const NEW_PACKAGES = 'arutosio_packages';
    const OLD_APP_PREFIX = OLD_PREFIX + 'app_';
    const NEW_APP_PREFIX = 'arutosio_app_';
    const OLD_APPEARANCE = OLD_PREFIX + 'appearance';
    const NEW_APPEARANCE = 'arutosio_appearance';
    const OLD_PROFILE = OLD_PREFIX + 'profile';
    const NEW_PROFILE = 'arutosio_profile';

    const PACKAGE_STORES = [
        { name: 'manifests', keyPath: 'id' },
        { name: 'files', keyPath: ['appId', 'path'] },
    ];
    const APP_STORES = [{ name: 'kv', keyPath: null }];
    const APPEARANCE_STORES = [{ name: 'assets', keyPath: null }];
    const PROFILE_STORES = [{ name: 'handles', keyPath: null }];

    const mapAppId = (id) => (id === OLD_GAME_ID ? NEW_GAME_ID : id);

    // ── localStorage / sessionStorage ──────────────────────
    // Synchronous: repos.js reads localStorage right after this file loads.
    function migrateWebStorage() {
        const moves = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith(OLD_PREFIX)) continue;
            moves.push([k, NEW_PREFIX + k.slice(OLD_PREFIX.length)]);
        }
        for (const [oldKey, newKey] of moves) {
            try {
                if (localStorage.getItem(newKey) == null) {
                    localStorage.setItem(newKey, localStorage.getItem(oldKey));
                }
                localStorage.removeItem(oldKey);
            } catch (e) { console.warn('[migration] localStorage key failed', oldKey, e); }
        }
        // App-scoped keys keep the old package id in the suffix.
        const oldPerm = NEW_PREFIX + 'perms_' + OLD_GAME_ID;
        const newPerm = NEW_PREFIX + 'perms_' + NEW_GAME_ID;
        try {
            if (localStorage.getItem(newPerm) == null && localStorage.getItem(oldPerm) != null) {
                localStorage.setItem(newPerm, localStorage.getItem(oldPerm));
            }
            localStorage.removeItem(oldPerm);
        } catch {}

        // Keep the user's defaults choices when the game package id changed.
        for (const name of ['defaults_seen', 'defaults_uninstalled']) {
            try {
                const key = NEW_PREFIX + name;
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                const arr = JSON.parse(raw);
                if (!Array.isArray(arr)) continue;
                const mapped = arr.map(id => (id === OLD_GAME_ID ? NEW_GAME_ID : id));
                if (mapped.some((id, i) => id !== arr[i])) localStorage.setItem(key, JSON.stringify(mapped));
            } catch {}
        }

        // Point the seeded official repository at the current site.
        try {
            const raw = localStorage.getItem(NEW_PREFIX + 'repos');
            if (raw) {
                const oldRepo = 'https://raw.githubusercontent.com/Arutosio/' + OLD_BRAND + '.sh/master/packages/index.json';
                const origin = (location.origin && location.origin !== 'null') ? location.origin : 'https://arutosio.com';
                const newRepo = origin + '/packages/index.json';
                const list = JSON.parse(raw);
                if (Array.isArray(list)) {
                    let touched = false;
                    for (const r of list) {
                        if (r && r.url === oldRepo) {
                            r.url = newRepo;
                            r.description = 'Curated bundle by Arutosio';
                            touched = true;
                        }
                    }
                    if (touched) localStorage.setItem(NEW_PREFIX + 'repos', JSON.stringify(list));
                }
            }
        } catch {}

        try {
            const oldKey = OLD_PREFIX + 'summoned';
            const newKey = NEW_PREFIX + 'summoned';
            if (sessionStorage.getItem(newKey) == null && sessionStorage.getItem(oldKey) != null) {
                sessionStorage.setItem(newKey, sessionStorage.getItem(oldKey));
            }
            sessionStorage.removeItem(oldKey);
        } catch {}
    }

    // ── IndexedDB primitives ───────────────────────────────
    function openDB(name, version, upgrade) {
        return new Promise((resolve, reject) => {
            const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
            req.onupgradeneeded = () => { if (upgrade) upgrade(req.result); };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error('indexeddb_blocked'));
        });
    }

    function requestP(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function dbExists(name) {
        if (indexedDB.databases) {
            try {
                const dbs = await indexedDB.databases();
                return dbs.some(d => d.name === name);
            } catch {}
        }
        // Older browser fallback: opening a missing DB creates it; close and
        // delete the empty stub, then report it as absent.
        return new Promise(resolve => {
            let created = false;
            let req;
            try { req = indexedDB.open(name); } catch { return resolve(false); }
            req.onupgradeneeded = () => { created = true; };
            req.onsuccess = () => {
                try { req.result.close(); } catch {}
                if (created) { try { indexedDB.deleteDatabase(name); } catch {} }
                resolve(!created);
            };
            req.onerror = () => resolve(false);
            req.onblocked = () => resolve(false);
        });
    }

    function readEntries(db, store) {
        return new Promise((resolve, reject) => {
            if (!db.objectStoreNames.contains(store)) return resolve([]);
            const out = [];
            const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
            req.onsuccess = (e) => {
                const c = e.target.result;
                if (c) { out.push([c.key, c.value]); c.continue(); }
                else resolve(out);
            };
            req.onerror = () => reject(req.error);
        });
    }

    function writeEntries(db, store, entries, inlineKey) {
        return new Promise((resolve, reject) => {
            const t = db.transaction(store, 'readwrite');
            const s = t.objectStore(store);
            try {
                for (const [key, value] of entries) {
                    if (inlineKey) s.put(value);
                    else s.put(value, key);
                }
            } catch (e) { reject(e); return; }
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('tx_aborted'));
        });
    }

    function createStores(d, stores) {
        for (const s of stores) {
            if (!d.objectStoreNames.contains(s.name)) {
                d.createObjectStore(s.name, s.keyPath ? { keyPath: s.keyPath } : undefined);
            }
        }
    }

    async function ensureDB(name, stores) {
        // Missing DB: create it at v1 so the normal modules (which all open
        // v1) can use it afterwards.
        if (!(await dbExists(name))) {
            return openDB(name, 1, (d) => createStores(d, stores));
        }
        const db = await openDB(name);
        const missing = stores.some(s => !db.objectStoreNames.contains(s.name));
        if (!missing) return db;
        try { db.close(); } catch {}
        // A stub left by an interrupted run is empty: replace it at v1.
        // If it somehow holds data, keep it rather than destroy the data;
        // the write below will fail and the caller will leave the old DB.
        if (!(await dbHasData(name, stores))) {
            await deleteDB(name);
            return openDB(name, 1, (d) => createStores(d, stores));
        }
        console.warn('[migration] existing DB lacks expected stores:', name);
        return openDB(name);
    }

    async function dbHasData(name, stores) {
        if (!(await dbExists(name))) return false;
        const db = await openDB(name);
        try {
            for (const s of stores) {
                if (!db.objectStoreNames.contains(s.name)) continue;
                const count = await requestP(db.transaction(s.name, 'readonly').objectStore(s.name).count());
                if (count > 0) return true;
            }
            return false;
        } finally {
            try { db.close(); } catch {}
        }
    }

    async function copyDB(oldName, newName, stores, mapValue) {
        if (!(await dbExists(oldName))) return true;
        const oldDb = await openDB(oldName);
        const data = {};
        try {
            for (const s of stores) data[s.name] = await readEntries(oldDb, s.name);
        } finally {
            try { oldDb.close(); } catch {}
        }
        if (await dbHasData(newName, stores)) return false;

        const newDb = await ensureDB(newName, stores);
        try {
            for (const s of stores) {
                const entries = (data[s.name] || []).map(([k, v]) => [k, mapValue ? mapValue(s.name, v) : v]);
                await writeEntries(newDb, s.name, entries, !!s.keyPath);
            }
        } finally {
            try { newDb.close(); } catch {}
        }
        return true;
    }

    function deleteDB(name) {
        return new Promise(resolve => {
            try {
                const req = indexedDB.deleteDatabase(name);
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
                req.onblocked = () => resolve(false);
                setTimeout(() => resolve(false), 3000);
            } catch { resolve(false); }
        });
    }

    // ── IndexedDB migration ────────────────────────────────
    async function migrateIndexedDB() {
        // Fast path: once the old DBs are gone this is a no-op. Also avoids
        // the stub-probe fallback on every boot in older browsers.
        if (indexedDB.databases) {
            try {
                const names = (await indexedDB.databases()).map(d => d && d.name).filter(Boolean);
                if (!names.some(n => n.startsWith(OLD_PREFIX))) return;
            } catch {}
        }
        const appIds = new Set();

        // Old manifests are the authoritative list of app DBs. Fall back to
        // the boot index (already moved to the new prefix) if they are gone.
        if (await dbExists(OLD_PACKAGES)) {
            const oldDb = await openDB(OLD_PACKAGES);
            try {
                const manifests = await readEntries(oldDb, 'manifests');
                for (const [, m] of manifests) if (m && m.id) appIds.add(m.id);
            } finally {
                try { oldDb.close(); } catch {}
            }
        }
        try {
            const arr = JSON.parse(localStorage.getItem(NEW_PREFIX + 'installed_apps') || '[]');
            if (Array.isArray(arr)) for (const m of arr) if (m && m.id) appIds.add(m.id);
        } catch {}

        const packagesCopied = await copyDB(OLD_PACKAGES, NEW_PACKAGES, PACKAGE_STORES, (store, v) => {
            if (!v || typeof v !== 'object') return v;
            if (store === 'manifests') {
                let out = v;
                if (v.id === OLD_GAME_ID) out = { ...out, id: NEW_GAME_ID, name: 'Ultima Arutosio' };
                if (out.author === OLD_AUTHOR) out = { ...out, author: 'Arutosio' };
                return out;
            }
            if (store === 'files' && v.appId === OLD_GAME_ID) {
                return { ...v, appId: NEW_GAME_ID };
            }
            return v;
        });

        for (const oldId of appIds) {
            const newId = mapAppId(oldId);
            const copied = await copyDB(OLD_APP_PREFIX + oldId, NEW_APP_PREFIX + newId, APP_STORES, null);
            if (copied) await deleteDB(OLD_APP_PREFIX + oldId);
        }

        const appearanceCopied = await copyDB(OLD_APPEARANCE, NEW_APPEARANCE, APPEARANCE_STORES, null);
        if (appearanceCopied) await deleteDB(OLD_APPEARANCE);

        const profileCopied = await copyDB(OLD_PROFILE, NEW_PROFILE, PROFILE_STORES, null);
        if (profileCopied) await deleteDB(OLD_PROFILE);

        // Keep the old package DB if the new one already had data: it may
        // still be the only source for apps this run did not touch.
        if (packagesCopied) await deleteDB(OLD_PACKAGES);
    }

    // The storage-key pass is synchronous on purpose: repos.js runs next and
    // reads localStorage immediately.
    try { migrateWebStorage(); } catch (e) { console.warn('[migration] web storage', e); }

    window.__arutosioMigrationReady = (async () => {
        try { await migrateIndexedDB(); }
        catch (e) { console.warn('[migration] indexeddb', e); }
        return true;
    })();
})();
