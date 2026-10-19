/* ╔══════════════════════════════════════════════════════════╗
 * ║  PROFILE — Portable profile snapshot / restore / mirror   ║
 * ║  Captures localStorage aruta_* keys, aruta_packages DB,   ║
 * ║  and every aruta_app_<id> DB into a portable snapshot.    ║
 * ║  DiskBackend (Chromium): live-sync to a folder handle.    ║
 * ║  ZipBackend: manual export/import for Firefox/Safari.     ║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    // Route DB/key strings through the Storage facade so there's a single
    // source of truth. Fall back to inline literals only if storage.js
    // didn't load for some reason (defensive, not expected at runtime).
    const SC = (window.Storage && window.Storage.constants) || {
        PACKAGES_DB: 'aruta_packages',
        APP_DB_PREFIX: 'aruta_app_',
        LS_PREFIX: 'aruta_',
    };
    const LS_PREFIX        = SC.LS_PREFIX;
    const LS_EXCLUDE       = new Set(['aruta_summoned']);
    const PACKAGES_DB      = SC.PACKAGES_DB;
    const APP_DB_PREFIX    = SC.APP_DB_PREFIX;
    const PROFILE_DB       = 'aruta_profile';
    const PROFILE_DB_VER   = 1;
    const HANDLE_STORE     = 'handles';
    const HANDLE_KEY       = 'current';
    const PROFILE_VERSION  = 1;

    // ── helpers ────────────────────────────────────────────
    function nowISO() { return new Date().toISOString(); }

    function _mimeFromPath(path) {
        const m = /\.([a-z0-9]+)$/i.exec(path || '');
        const ext = m ? m[1].toLowerCase() : '';
        const map = {
            txt:'text/plain', md:'text/markdown', json:'application/json',
            js:'text/javascript', mjs:'text/javascript', ts:'text/typescript',
            css:'text/css', html:'text/html', xml:'application/xml',
            yml:'text/yaml', yaml:'text/yaml', csv:'text/csv', log:'text/plain',
            png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
            webp:'image/webp', svg:'image/svg+xml', ico:'image/x-icon',
            mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime',
            mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg',
            zip:'application/zip', pdf:'application/pdf',
        };
        return map[ext] || 'application/octet-stream';
    }

    /** True if window.crypto.subtle exists — used for the origin tag. */
    function originTag() { try { return location.origin || 'unknown'; } catch { return 'unknown'; } }

    /** Open our own small DB for the persisted directory handle. */
    function _openProfileDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(PROFILE_DB, PROFILE_DB_VER);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }

    async function _putHandle(handle) {
        const db = await _openProfileDB();
        await new Promise((res, rej) => {
            const t = db.transaction(HANDLE_STORE, 'readwrite');
            t.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
            t.oncomplete = () => res();
            t.onerror    = () => rej(t.error);
        });
        db.close();
    }
    async function _getHandle() {
        const db = await _openProfileDB();
        const handle = await new Promise((res, rej) => {
            const t = db.transaction(HANDLE_STORE, 'readonly');
            const r = t.objectStore(HANDLE_STORE).get(HANDLE_KEY);
            r.onsuccess = () => res(r.result || null);
            r.onerror   = () => rej(r.error);
        });
        db.close();
        return handle;
    }
    async function _clearHandle() {
        const db = await _openProfileDB();
        await new Promise((res, rej) => {
            const t = db.transaction(HANDLE_STORE, 'readwrite');
            t.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
            t.oncomplete = () => res();
            t.onerror    = () => rej(t.error);
        });
        db.close();
    }

    // ── localStorage scan ──────────────────────────────────
    function _readLocalStorage() {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(LS_PREFIX) || LS_EXCLUDE.has(key)) continue;
            try { out[key] = localStorage.getItem(key); } catch {}
        }
        return out;
    }
    function _writeLocalStorage(obj) {
        // Clear existing aruta_* keys (except excluded) then apply snapshot.
        const toDel = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(LS_PREFIX) && !LS_EXCLUDE.has(key)) toDel.push(key);
        }
        for (const k of toDel) { try { localStorage.removeItem(k); } catch {} }
        for (const [k, v] of Object.entries(obj || {})) {
            if (LS_EXCLUDE.has(k)) continue;
            try { localStorage.setItem(k, v); } catch {}
        }
    }

    // ── IndexedDB dump helpers ─────────────────────────────
    function _openRaw(name) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(name);
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }
    function _getAll(db, storeName) {
        return new Promise((res, rej) => {
            if (!db.objectStoreNames.contains(storeName)) return res([]);
            const t = db.transaction(storeName, 'readonly');
            const r = t.objectStore(storeName).getAll();
            r.onsuccess = () => res(r.result || []);
            r.onerror   = () => rej(r.error);
        });
    }
    function _getAllKV(db, storeName) {
        return new Promise((res, rej) => {
            if (!db.objectStoreNames.contains(storeName)) return res({});
            const t = db.transaction(storeName, 'readonly');
            const out = {};
            const req = t.objectStore(storeName).openCursor();
            req.onsuccess = (e) => {
                const c = e.target.result;
                if (c) { out[String(c.key)] = c.value; c.continue(); }
                else res(out);
            };
            req.onerror = () => rej(req.error);
        });
    }
    function _deleteDB(name) {
        return new Promise((resolve) => {
            try {
                const req = indexedDB.deleteDatabase(name);
                req.onsuccess = () => resolve(true);
                req.onerror   = () => resolve(false);
                req.onblocked = () => resolve(false);
            } catch { resolve(false); }
        });
    }

    async function _blobToBytes(blob) {
        if (blob instanceof Uint8Array) return blob;
        if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
        if (blob && typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
        if (typeof blob === 'string') return new TextEncoder().encode(blob);
        return new Uint8Array(0);
    }

    // ── SNAPSHOT ───────────────────────────────────────────
    async function snapshot() {
        const ls = _readLocalStorage();
        // Packages DB
        let manifests = [];
        const filesArr = [];
        try {
            const pdb = await _openRaw(PACKAGES_DB);
            manifests = await _getAll(pdb, 'manifests');
            const rawFiles = await _getAll(pdb, 'files');
            for (const f of rawFiles) {
                filesArr.push({
                    appId: f.appId,
                    path: f.path,
                    mime: (f.blob && f.blob.type) || 'application/octet-stream',
                    bytes: await _blobToBytes(f.blob),
                });
            }
            pdb.close();
        } catch (e) { console.warn('[profile] packages dump failed', e); }

        // Per-app DBs
        const apps = {};
        for (const m of manifests) {
            const name = APP_DB_PREFIX + m.id;
            try {
                const adb = await _openRaw(name);
                apps[m.id] = await _getAllKV(adb, 'kv');
                adb.close();
            } catch (e) { console.warn('[profile] app dump failed', m.id, e); }
        }

        // Appearance assets (background/portrait binaries).
        let appearance = [];
        try { appearance = (await window.appearance?.dumpForSnapshot?.()) || []; }
        catch (e) { console.warn('[profile] appearance dump failed', e); }

        return {
            version:   PROFILE_VERSION,
            createdAt: nowISO(),
            updatedAt: nowISO(),
            origin:    originTag(),
            localStorage: ls,
            registry: { manifests, files: filesArr },
            apps,
            appearance,
        };
    }

    /** Snapshot laid out as a Map<path, Uint8Array|string> matching the
     *  on-disk / in-zip layout. Used by DiskBackend and exportZip. */
    async function snapshotBinary(snap) {
        snap = snap || await snapshot();
        const out = new Map();
        const meta = {
            version:   snap.version,
            createdAt: snap.createdAt,
            updatedAt: snap.updatedAt,
            origin:    snap.origin,
        };
        out.set('profile.json', JSON.stringify(meta, null, 2));
        out.set('localStorage.json', JSON.stringify(snap.localStorage, null, 2));
        out.set('registry/manifests.json', JSON.stringify(snap.registry.manifests, null, 2));
        for (const f of snap.registry.files) {
            out.set('registry/files/' + f.appId + '/' + f.path, f.bytes);
        }
        // Track MIME types alongside files so restore can rebuild Blobs.
        const fileMeta = snap.registry.files.map(f => ({ appId: f.appId, path: f.path, mime: f.mime }));
        out.set('registry/files.meta.json', JSON.stringify(fileMeta, null, 2));
        for (const [appId, kv] of Object.entries(snap.apps || {})) {
            out.set('apps/' + appId + '.json', JSON.stringify(kv, null, 2));
        }
        // Appearance assets: binary per key + meta.json describing kind/mime/filename.
        const appearance = snap.appearance || [];
        if (appearance.length) {
            const appMeta = [];
            for (const a of appearance) {
                const ext = _extFromMime(a.mime) || 'bin';
                const path = 'appearance/' + a.key + '.' + ext;
                out.set(path, a.bytes instanceof Uint8Array ? a.bytes : new Uint8Array(a.bytes || []));
                appMeta.push({ key: a.key, kind: a.kind || '', mime: a.mime || '', filename: a.filename || '', path });
            }
            out.set('appearance/meta.json', JSON.stringify(appMeta, null, 2));
        }
        return out;
    }

    function _extFromMime(mime) {
        if (!mime) return '';
        if (mime === 'video/mp4') return 'mp4';
        if (mime === 'video/webm') return 'webm';
        if (mime === 'image/png') return 'png';
        if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
        if (mime === 'image/gif') return 'gif';
        if (mime === 'image/webp') return 'webp';
        if (mime === 'image/svg+xml') return 'svg';
        // Fallback: strip subtype after last '/'
        const m = /\/([a-z0-9.+-]+)$/i.exec(mime);
        return m ? m[1].replace(/[^a-z0-9]/gi, '') : 'bin';
    }

    /** Re-hydrate a snapshot object from a Map<path, Uint8Array|string>. */
    function snapshotFromBinary(map) {
        const td = new TextDecoder();
        const asText = (v) => (typeof v === 'string') ? v : td.decode(v);
        const parseJSON = (path, fallback) => {
            const raw = map.get(path);
            if (raw == null) return fallback;
            try { return JSON.parse(asText(raw)); } catch { return fallback; }
        };
        const meta     = parseJSON('profile.json', {});
        const ls       = parseJSON('localStorage.json', {});
        const manifests = parseJSON('registry/manifests.json', []);
        const fileMeta  = parseJSON('registry/files.meta.json', []);
        const fileMetaByKey = new Map(fileMeta.map(m => [m.appId + '\u0000' + m.path, m.mime]));

        // Collect file bytes from the registry/files/ prefix.
        const files = [];
        for (const [path, value] of map) {
            if (!path.startsWith('registry/files/')) continue;
            const rest = path.slice('registry/files/'.length);
            const slash = rest.indexOf('/');
            if (slash < 0) continue;
            const appId = rest.slice(0, slash);
            const innerPath = rest.slice(slash + 1);
            const bytes = (typeof value === 'string') ? new TextEncoder().encode(value) : value;
            const mime = fileMetaByKey.get(appId + '\u0000' + innerPath) || 'application/octet-stream';
            files.push({ appId, path: innerPath, mime, bytes });
        }

        const apps = {};
        for (const [path, value] of map) {
            if (!path.startsWith('apps/') || !path.endsWith('.json')) continue;
            const appId = path.slice('apps/'.length, -'.json'.length);
            try { apps[appId] = JSON.parse(asText(value)); } catch { apps[appId] = {}; }
        }

        // Appearance assets: read meta.json for kind/mime, then pull bytes from path.
        const appearance = [];
        const appMeta = parseJSON('appearance/meta.json', []);
        for (const m of appMeta) {
            const raw = map.get(m.path);
            if (raw == null) continue;
            const bytes = (typeof raw === 'string') ? new TextEncoder().encode(raw) : raw;
            appearance.push({ key: m.key, kind: m.kind || '', mime: m.mime || 'application/octet-stream', filename: m.filename || '', bytes });
        }

        return {
            version: meta.version || 1,
            createdAt: meta.createdAt || nowISO(),
            updatedAt: meta.updatedAt || nowISO(),
            origin:    meta.origin    || 'unknown',
            localStorage: ls,
            registry: { manifests, files },
            apps,
            appearance,
        };
    }

    // ── RESTORE ────────────────────────────────────────────
    async function restore(snap) {
        if (!snap || typeof snap !== 'object') throw new Error('invalid snapshot');
        if (snap.version && snap.version > PROFILE_VERSION) {
            throw new Error('profile_newer_version');
        }

        // Close every app DB we might be holding open.
        try {
            for (const m of (snap.registry?.manifests || [])) {
                try { await window.sandbox?.closeAppStorage?.(m.id); } catch {}
            }
        } catch {}

        // Replace localStorage
        _writeLocalStorage(snap.localStorage || {});

        // Wipe + rebuild aruta_packages
        await _deleteDB(PACKAGES_DB);
        await new Promise((resolve, reject) => {
            const req = indexedDB.open(PACKAGES_DB, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('manifests')) db.createObjectStore('manifests', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('files'))     db.createObjectStore('files',     { keyPath: ['appId', 'path'] });
            };
            req.onsuccess = () => {
                const db = req.result;
                const t = db.transaction(['manifests', 'files'], 'readwrite');
                const mstore = t.objectStore('manifests');
                const fstore = t.objectStore('files');
                for (const m of (snap.registry?.manifests || [])) mstore.put(m);
                for (const f of (snap.registry?.files || [])) {
                    const bytes = f.bytes instanceof Uint8Array
                        ? f.bytes
                        : (typeof f.bytes === 'string' ? new TextEncoder().encode(f.bytes) : new Uint8Array(f.bytes || []));
                    const blob = new Blob([bytes], { type: f.mime || 'application/octet-stream' });
                    fstore.put({ appId: f.appId, path: f.path, blob });
                }
                t.oncomplete = () => { db.close(); resolve(); };
                t.onerror    = () => reject(t.error);
            };
            req.onerror = () => reject(req.error);
        });

        // Rebuild aruta_appearance (background/portrait binaries).
        try {
            if (window.appearance?.restoreFromSnapshot) {
                await window.appearance.restoreFromSnapshot(snap.appearance || []);
            }
        } catch (e) { console.warn('[profile] appearance restore failed', e); }

        // Rebuild each aruta_app_<id>
        for (const [appId, kv] of Object.entries(snap.apps || {})) {
            const name = APP_DB_PREFIX + appId;
            await _deleteDB(name);
            await new Promise((resolve, reject) => {
                const req = indexedDB.open(name, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
                };
                req.onsuccess = () => {
                    const db = req.result;
                    const t = db.transaction('kv', 'readwrite');
                    const store = t.objectStore('kv');
                    for (const [k, v] of Object.entries(kv || {})) store.put(v, k);
                    t.oncomplete = () => { db.close(); resolve(); };
                    t.onerror    = () => reject(t.error);
                };
                req.onerror = () => reject(req.error);
            });
        }
    }

    // ── EXPORT / IMPORT (zip) ──────────────────────────────
    async function exportZip() {
        const snap = await snapshot();
        const map  = await snapshotBinary(snap);
        const entries = [];
        for (const [path, value] of map) entries.push({ path, content: value });
        const bytes = window.arutaZip.encode(entries);
        const blob  = new Blob([bytes], { type: 'application/zip' });
        const url   = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.download = 'aruta-profile-' + stamp + '.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function importZip(file) {
        const buf   = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const { entries } = window.arutaZip.decode(bytes);
        const map = new Map();
        for (const e of entries) map.set(e.path, e.bytes);
        const snap = snapshotFromBinary(map);
        await restore(snap);
        location.reload();
    }

    // ── DISK BACKEND (FS Access API) ───────────────────────
    let _disk = null;    // active DiskBackend or null
    let _disconnected = false; // set when writes start failing
    let _dirty = new Set();    // scope strings: 'ls', 'manifests', 'file:<app>:<path>', 'app:<id>'
    let _dirtyTimer = null;
    const DEBOUNCE_MS = 400;

    class DiskBackend {
        constructor(handle) { this.handle = handle; this.name = handle.name; }

        async checkPermission(mode = 'readwrite') {
            if (!this.handle) return 'denied';
            try {
                const q = await this.handle.queryPermission?.({ mode });
                if (q === 'granted') return 'granted';
                const r = await this.handle.requestPermission?.({ mode });
                return r || 'denied';
            } catch { return 'denied'; }
        }

        async _getDir(pathParts, create) {
            let dir = this.handle;
            for (const p of pathParts) {
                dir = await dir.getDirectoryHandle(p, { create });
            }
            return dir;
        }

        async _writeFile(path, data) {
            const parts = path.split('/');
            const name  = parts.pop();
            const dir   = await this._getDir(parts, true);
            const fh    = await dir.getFileHandle(name, { create: true });
            const w     = await fh.createWritable();
            const bytes = (typeof data === 'string') ? new TextEncoder().encode(data) : data;
            await w.write(bytes);
            await w.close();
        }

        async _deleteFile(path) {
            const parts = path.split('/');
            const name  = parts.pop();
            const dir   = await this._getDir(parts, false);
            await dir.removeEntry(name);
        }

        async _listDir(path) {
            const parts = path ? path.split('/').filter(Boolean) : [];
            let dir = this.handle;
            for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: false });
            const out = [];
            for await (const [name, entry] of dir.entries()) {
                if (entry.kind === 'file') {
                    let size = 0;
                    try { const f = await entry.getFile(); size = f.size; } catch {}
                    out.push({ name, kind: 'file', size });
                } else {
                    out.push({ name, kind: 'dir' });
                }
            }
            return out;
        }

        async _readFile(path) {
            try {
                const parts = path.split('/');
                const name  = parts.pop();
                let dir = this.handle;
                for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: false });
                const fh = await dir.getFileHandle(name, { create: false });
                const f  = await fh.getFile();
                return new Uint8Array(await f.arrayBuffer());
            } catch { return null; }
        }

        /** Recursively list all files under a sub-directory, returning an array of paths relative to `this.handle`. */
        async _listAll(prefix = '') {
            const out = [];
            const walk = async (dir, p) => {
                for await (const [name, entry] of dir.entries()) {
                    const full = p ? (p + '/' + name) : name;
                    if (entry.kind === 'file') out.push(full);
                    else if (entry.kind === 'directory') await walk(entry, full);
                }
            };
            try {
                if (prefix) {
                    const parts = prefix.split('/').filter(Boolean);
                    let dir = this.handle;
                    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: false });
                    await walk(dir, prefix);
                } else {
                    await walk(this.handle, '');
                }
            } catch {}
            return out;
        }

        async writeAll(map) {
            for (const [path, data] of map) {
                await this._writeFile(path, data);
            }
        }

        /** Read the entire folder into a snapshot. Returns null on "empty" folder. */
        async readAll() {
            const profileRaw = await this._readFile('profile.json');
            if (!profileRaw) return null;
            const map = new Map();
            map.set('profile.json', profileRaw);
            const lsRaw = await this._readFile('localStorage.json');
            if (lsRaw) map.set('localStorage.json', lsRaw);
            const manRaw = await this._readFile('registry/manifests.json');
            if (manRaw) map.set('registry/manifests.json', manRaw);
            const fmRaw  = await this._readFile('registry/files.meta.json');
            if (fmRaw)  map.set('registry/files.meta.json', fmRaw);
            // All registry/files/**
            const fileList = await this._listAll('registry/files');
            for (const p of fileList) {
                const b = await this._readFile(p);
                if (b) map.set(p, b);
            }
            // All apps/*.json
            const appList = await this._listAll('apps');
            for (const p of appList) {
                const b = await this._readFile(p);
                if (b) map.set(p, b);
            }
            // Appearance meta + binaries
            const appearanceMetaRaw = await this._readFile('appearance/meta.json');
            if (appearanceMetaRaw) {
                map.set('appearance/meta.json', appearanceMetaRaw);
                const appearanceList = await this._listAll('appearance');
                for (const p of appearanceList) {
                    if (p === 'appearance/meta.json') continue;
                    const b = await this._readFile(p);
                    if (b) map.set(p, b);
                }
            }
            return snapshotFromBinary(map);
        }

        /** Try to read profile.json to detect whether folder already holds a profile. */
        async peekMeta() {
            const raw = await this._readFile('profile.json');
            if (!raw) return null;
            try { return JSON.parse(new TextDecoder().decode(raw)); } catch { return null; }
        }
    }

    // ── Dirty-key debouncer ────────────────────────────────
    function markDirty(scope, key) {
        if (!_disk || _disconnected) return;
        if (scope === 'localStorage') _dirty.add('ls');
        else if (scope === 'manifests') _dirty.add('manifests');
        else if (scope === 'file')      _dirty.add('file:' + key);   // key = "<appId>/<path>"
        else if (scope === 'app')       _dirty.add('app:' + key);    // key = appId
        else _dirty.add(scope + ':' + (key || ''));

        if (_dirtyTimer) return;
        _dirtyTimer = setTimeout(flushDirty, DEBOUNCE_MS);
    }

    async function flushDirty() {
        _dirtyTimer = null;
        if (!_disk || _disconnected) { _dirty.clear(); return; }
        const items = Array.from(_dirty);
        _dirty.clear();
        try {
            // Always refresh profile.json updatedAt
            const snap = await snapshot();
            const map  = await snapshotBinary(snap);

            // Map "ls" → localStorage.json, "manifests" → registry/manifests.json + files.meta.json
            // For a simpler & safer implementation we just write the whole snapshot.
            // (Incremental writes are an optimization — v1 prioritizes correctness.)
            await _disk.writeAll(map);
        } catch (e) {
            console.warn('[profile] write-through failed', e);
            _disconnected = true;
            try { window.showToast?.('Profile disconnected — re-link in Settings', 'warning'); } catch {}
        }
    }

    // ── Public link / unlink ───────────────────────────────
    async function link(directoryHandle, { overwriteFolder = true } = {}) {
        const backend = new DiskBackend(directoryHandle);
        const perm = await backend.checkPermission('readwrite');
        if (perm !== 'granted') throw new Error('permission_denied');
        await _putHandle(directoryHandle);
        _disk = backend;
        _disconnected = false;
        if (overwriteFolder) {
            const snap = await snapshot();
            const map  = await snapshotBinary(snap);
            await backend.writeAll(map);
        }
    }

    /** Read-only accessor for the currently-linked directory handle.
     *  Returns the handle only if read permission is already granted.
     *  Never prompts — safe to call without a user gesture. */
    async function getLinkedHandle() {
        let handle;
        try { handle = await _getHandle(); } catch { return null; }
        if (!handle) return null;
        try {
            const perm = await handle.queryPermission?.({ mode: 'read' });
            return perm === 'granted' ? handle : null;
        } catch { return null; }
    }

    async function unlink() {
        await _clearHandle();
        _disk = null;
        _disconnected = false;
        _dirty.clear();
        if (_dirtyTimer) { clearTimeout(_dirtyTimer); _dirtyTimer = null; }
    }

    function isLinked() { return !!_disk && !_disconnected; }
    function linkedName() { return _disk?.name || null; }
    function linkedMode() { return _disk ? 'disk' : 'none'; }

    /** Boot-time: if a handle is persisted and grant is still live, read the
     *  folder and restore. Returns true iff restore happened (caller should
     *  skip further boot because we're about to reload). */
    async function tryRestoreFromHandle() {
        let handle;
        try { handle = await _getHandle(); } catch { return false; }
        if (!handle) return false;
        const backend = new DiskBackend(handle);
        // queryPermission only — never prompt on boot (user didn't click anything).
        let state = 'prompt';
        try { state = await handle.queryPermission?.({ mode: 'readwrite' }); } catch {}
        if (state !== 'granted') {
            // Grant is dormant — keep the handle but don't restore; Settings
            // UI will surface a "Reconnect" affordance to re-prompt.
            _disk = backend;
            _disconnected = true;
            return false;
        }
        try {
            const snap = await backend.readAll();
            if (!snap) {
                // Folder is empty — treat as first-time link, write current state.
                _disk = backend;
                _disconnected = false;
                const s   = await snapshot();
                const map = await snapshotBinary(s);
                await backend.writeAll(map);
                return false;
            }
            // Folder wins: restore then reload.
            await restore(snap);
            _disk = backend;
            _disconnected = false;
            // Re-persist handle just in case (browsers sometimes drop state on crash).
            try { await _putHandle(handle); } catch {}
            location.reload();
            return true;
        } catch (e) {
            console.warn('[profile] tryRestoreFromHandle failed', e);
            _disk = backend;
            _disconnected = true;
            return false;
        }
    }

    /** Attempt to re-prompt for permission on an existing handle (user-gesture only). */
    async function reconnect() {
        let handle;
        try { handle = await _getHandle(); } catch { return false; }
        if (!handle) return false;
        const backend = new DiskBackend(handle);
        const perm = await backend.checkPermission('readwrite');
        if (perm !== 'granted') return false;
        _disk = backend;
        _disconnected = false;
        // After reconnect, folder wins: read from folder and restore.
        try {
            const snap = await backend.readAll();
            if (snap) { await restore(snap); location.reload(); return true; }
        } catch (e) { console.warn('[profile] reconnect read failed', e); }
        return true;
    }

    // ── Debug helper ───────────────────────────────────────
    window.arutaProfileDebug = {
        dump: () => snapshot(),
        rewind: async (snap) => { await restore(snap); location.reload(); },
    };

    window.profile = {
        snapshot,
        snapshotBinary,
        snapshotFromBinary,
        restore,
        exportZip,
        importZip,
        link,
        unlink,
        reconnect,
        tryRestoreFromHandle,
        markDirty,
        isLinked,
        linkedName,
        linkedMode,
        hasHandle: async () => !!(await _getHandle().catch(() => null)),
        getLinkedHandle,
        isDisconnected: () => _disconnected,
        // ── Raw folder I/O, used by the File Explorer app via ctx.profile.*
        async listFolder(path) {
            if (!_disk || _disconnected) throw new Error('profile_not_linked');
            return _disk._listDir(path || '');
        },
        async readFolderFile(path) {
            if (!_disk || _disconnected) throw new Error('profile_not_linked');
            const bytes = await _disk._readFile(path);
            if (!bytes) throw new Error('not_found');
            return { bytes, mime: _mimeFromPath(path) };
        },
        async writeFolderFile(path, bytes, mime) {
            if (!_disk || _disconnected) throw new Error('profile_not_linked');
            const arr = bytes instanceof Uint8Array
                ? bytes
                : (typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes || []));
            await _disk._writeFile(path, arr);
        },
        async removeFolderFile(path) {
            if (!_disk || _disconnected) throw new Error('profile_not_linked');
            await _disk._deleteFile(path);
        },
        /** Read the currently-linked folder and return a snapshot (or null). */
        __readLinkedFolder: async () => {
            if (!_disk) return null;
            try { return await _disk.readAll(); } catch { return null; }
        },
    };

    // ── Boot gate ──────────────────────────────────────────
    // app.js awaits this before bootstrapping registry / defaults. The promise
    // resolves to `true` if we kicked off a reload (caller should stop).
    window.__arutaProfileReady = (async () => {
        try {
            return await tryRestoreFromHandle();
        } catch (e) {
            console.warn('[profile] boot gate failed', e);
            return false;
        }
    })();
})();
