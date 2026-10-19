/* ╔══════════════════════════════════════════════════════════╗
 * ║  APPEARANCE — User-customizable backgrounds, portrait,    ║
 * ║  and display name. Binaries live in IDB `aruta_appearance`║
 * ║  and are slurped by profile.js into snapshots (zip/disk). ║
 * ║  Backgrounds are a playlist that rotates on a user-set    ║
 * ║  interval or by time of day (dawn/noon/sunset/night).     ║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    const DB_NAME = 'aruta_appearance';
    const STORE   = 'assets';
    const DB_VER  = 1;
    const LS_META = 'aruta_appearance_meta';
    const LS_BG_MODE     = 'aruta_bg_mode';      // 'interval' | 'time'
    const LS_BG_INTERVAL = 'aruta_bg_interval';  // minutes
    const SITE = window.SITE_CONFIG || {};
    const SITE_BG = SITE.backgrounds || {};
    const DEFAULT_NAME = SITE.name || 'Arutosio';
    const DEFAULT_PORTRAIT = './Images/aru_portrait.webp';
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10 MB
    const MAX_VIDEO_BYTES = 50 * 1024 * 1024;  // 50 MB
    const BG_KEY_PREFIX = 'bg_';
    const FADE_MS = 900;

    // Time-of-day phases (start hour inclusive). `night` wraps past midnight.
    const SLOTS = [
        { id: 'dawn',   start: 5 },
        { id: 'noon',   start: 11 },
        { id: 'sunset', start: 16 },
        { id: 'night',  start: 20 },
    ];
    const SLOT_IDS = SLOTS.map(s => s.id);

    let _portraitURL = null;

    // Rotator state
    let _queue = [];          // candidates currently cycling
    let _idx = 0;
    let _currentId = null;    // id of the item on screen
    let _currentSlot = null;  // phase used to build _queue (time mode)
    let _rotTimer = null;
    let _slotTimer = null;
    let _showToken = 0;

    // ── IDB helpers ────────────────────────────────────────
    function _open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VER);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }
    async function _put(key, value) {
        const db = await _open();
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).put(value, key);
            t.oncomplete = () => res();
            t.onerror    = () => rej(t.error);
        });
        db.close();
        window.profile?.markDirty?.('appearance', key);
    }
    async function _get(key) {
        const db = await _open();
        const v = await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readonly');
            const r = t.objectStore(STORE).get(key);
            r.onsuccess = () => res(r.result || null);
            r.onerror   = () => rej(r.error);
        });
        db.close();
        return v;
    }
    async function _del(key) {
        const db = await _open();
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).delete(key);
            t.oncomplete = () => res();
            t.onerror    = () => rej(t.error);
        });
        db.close();
        window.profile?.markDirty?.('appearance', key);
    }
    async function _readAll() {
        const out = {};
        try {
            const db = await _open();
            await new Promise((res, rej) => {
                const t = db.transaction(STORE, 'readonly');
                const req = t.objectStore(STORE).openCursor();
                req.onsuccess = (e) => {
                    const c = e.target.result;
                    if (c) { out[String(c.key)] = c.value; c.continue(); }
                    else res();
                };
                req.onerror = () => rej(req.error);
            });
            db.close();
        } catch {}
        return out;
    }

    // ── Metadata (name + mime + filename) ──────────────────
    function _readMeta() {
        try { return JSON.parse(localStorage.getItem(LS_META) || '{}'); }
        catch { return {}; }
    }
    function _writeMeta(m) {
        try { localStorage.setItem(LS_META, JSON.stringify(m || {})); } catch {}
        try { window.profile?.markDirty?.('localStorage', LS_META); } catch {}
    }
    function _userBackgrounds(meta) {
        return Array.isArray(meta.backgrounds) ? meta.backgrounds : [];
    }

    // ── File size / type validation ────────────────────────
    function _validate(file) {
        if (!file) return { ok: false, reason: 'no_file' };
        const isImg = /^image\//.test(file.type);
        const isVid = /^video\//.test(file.type);
        if (!isImg && !isVid) return { ok: false, reason: 'bad_type' };
        const cap = isVid ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
        if (file.size > cap) return { ok: false, reason: 'too_big', cap };
        return { ok: true, kind: isVid ? 'video' : 'image' };
    }

    async function _fileToRecord(file, kind) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return { kind, mime: file.type || (kind === 'video' ? 'video/mp4' : 'image/png'), filename: file.name || '', bytes };
    }

    function _newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // ── URL lifecycle ──────────────────────────────────────
    function _revokePortrait() {
        if (_portraitURL) { try { URL.revokeObjectURL(_portraitURL); } catch {} _portraitURL = null; }
    }
    function _recordToURL(rec) {
        if (!rec || !rec.bytes) return null;
        const bytes = rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes);
        const blob = new Blob([bytes], { type: rec.mime || 'application/octet-stream' });
        return URL.createObjectURL(blob);
    }

    // ── Rotation settings ──────────────────────────────────
    function getRotation() {
        let mode = null, interval = NaN;
        try {
            mode = localStorage.getItem(LS_BG_MODE);
            interval = parseFloat(localStorage.getItem(LS_BG_INTERVAL));
        } catch {}
        if (mode !== 'interval' && mode !== 'time') mode = SITE_BG.mode === 'time' ? 'time' : 'interval';
        if (!(interval > 0)) interval = SITE_BG.intervalMin > 0 ? SITE_BG.intervalMin : 10;
        return { mode, intervalMin: interval };
    }

    function currentSlot(date = new Date()) {
        const h = date.getHours();
        let id = 'night';
        for (const s of SLOTS) if (h >= s.start) id = s.id;
        return id;
    }

    function _msToNextSlot(now = new Date()) {
        const next = new Date(now);
        next.setMinutes(0, 0, 0);
        const h = now.getHours();
        const upcoming = SLOTS.map(s => s.start).find(start => start > h);
        if (upcoming == null) { next.setDate(next.getDate() + 1); next.setHours(SLOTS[0].start); }
        else next.setHours(upcoming);
        return Math.max(1000, next - now);
    }

    // ── Playlist ───────────────────────────────────────────
    function _kindFromSrc(src) {
        return /\.(webm|mp4|m4v|mov|ogv)(\?|#|$)/i.test(src || '') ? 'video' : 'image';
    }
    function _playlist() {
        const user = _userBackgrounds(_readMeta());
        if (user.length) {
            return user.map(b => ({ id: b.id, kind: b.kind, slot: b.slot || null, user: true }));
        }
        const defaults = Array.isArray(SITE_BG.items) ? SITE_BG.items : [];
        return defaults
            .filter(it => it && it.src)
            .map((it, i) => ({ id: 'default_' + i, kind: it.kind || _kindFromSrc(it.src), src: it.src, slot: it.slot || null }));
    }
    function _candidates(mode, slot) {
        const list = _playlist();
        if (mode !== 'time') return list;
        const inSlot = list.filter(it => !it.slot || it.slot === slot);
        // If nothing covers the current phase, fall back to the whole list
        // rather than leaving the desktop bare.
        return inSlot.length ? inSlot : list;
    }

    function _stopTimers() {
        clearTimeout(_rotTimer); _rotTimer = null;
        clearTimeout(_slotTimer); _slotTimer = null;
    }

    function _scheduleNext() {
        clearTimeout(_rotTimer); _rotTimer = null;
        if (_queue.length < 2) return;
        const { intervalMin } = getRotation();
        _rotTimer = setTimeout(() => {
            _idx = (_idx + 1) % _queue.length;
            _show(_queue[_idx]);
            _scheduleNext();
        }, intervalMin * 60 * 1000);
    }

    /** Rebuild the queue from current settings and (re)arm the timers.
     *  Keeps the item on screen if it is still a valid candidate. */
    function _refresh() {
        _stopTimers();
        const { mode } = getRotation();
        _currentSlot = currentSlot();
        _queue = _candidates(mode, _currentSlot);
        if (!_queue.length) { _show(null); return; }
        const keep = _queue.findIndex(it => it.id === _currentId);
        _idx = keep >= 0 ? keep : 0;
        _show(_queue[_idx]);
        _scheduleNext();
        if (mode === 'time') _slotTimer = setTimeout(_refresh, _msToNextSlot());
    }

    // ── DOM application ────────────────────────────────────
    function _disposeMedia(el) {
        if (el.tagName === 'VIDEO') {
            try { el.pause(); el.removeAttribute('src'); el.load(); } catch {}
        }
        const blob = el.dataset.blob;
        if (blob) { try { URL.revokeObjectURL(blob); } catch {} }
        el.remove();
    }

    function _createMedia(kind, src) {
        let el;
        if (kind === 'video') {
            el = document.createElement('video');
            el.autoplay = true; el.loop = true; el.muted = true; el.playsInline = true;
            el.setAttribute('muted', ''); el.setAttribute('playsinline', '');
            el.preload = 'auto';
        } else {
            el = document.createElement('img');
            el.alt = '';
            el.decoding = 'async';
        }
        el.className = 'user-bg-media';
        el.src = src;
        return el;
    }

    async function _show(item) {
        const token = ++_showToken;
        const mount = document.getElementById('user-bg-layer');
        if (!mount) return;
        if (!item) {
            mount.querySelectorAll('.user-bg-media').forEach(_disposeMedia);
            mount.style.display = 'none';
            _currentId = null;
            return;
        }
        if (item.id === _currentId && mount.querySelector('.user-bg-media')) return;

        let src = item.src;
        let kind = item.kind;
        let blob = null;
        if (item.user) {
            let rec = null;
            try { rec = await _get(BG_KEY_PREFIX + item.id); } catch {}
            if (token !== _showToken) return;
            if (!rec) return;
            blob = _recordToURL(rec);
            if (!blob) return;
            src = blob;
            kind = rec.kind || kind;
        }

        mount.style.display = '';
        const el = _createMedia(kind, src);
        if (blob) el.dataset.blob = blob;
        const prev = Array.from(mount.querySelectorAll('.user-bg-media'));
        mount.appendChild(el);
        _currentId = item.id;

        let revealed = false;
        const reveal = () => {
            if (revealed) return;
            revealed = true;
            requestAnimationFrame(() => el.classList.add('is-visible'));
            setTimeout(() => prev.forEach(_disposeMedia), FADE_MS + 100);
        };
        if (kind === 'video') {
            el.addEventListener('loadeddata', reveal, { once: true });
            el.play?.().catch(() => {});
        } else {
            el.addEventListener('load', reveal, { once: true });
        }
        el.addEventListener('error', reveal, { once: true });
        setTimeout(reveal, 4000);  // never leave the old media stuck on screen
    }

    function _applyPortrait(rec) {
        _revokePortrait();
        const img = document.querySelector('.portrait-img');
        if (!img) return;
        if (!rec) { img.src = DEFAULT_PORTRAIT; return; }
        _portraitURL = _recordToURL(rec);
        img.src = _portraitURL || DEFAULT_PORTRAIT;
    }
    function _applyName(name) {
        const label = (name && String(name).trim()) || DEFAULT_NAME;
        document.querySelectorAll('.char-name, .start-title').forEach(el => {
            el.textContent = label;
        });
    }

    // ── Legacy migration ───────────────────────────────────
    /** Older builds stored a single background under the `background` key. */
    async function _migrateLegacy() {
        let legacy = null;
        try { legacy = await _get('background'); } catch {}
        const meta = _readMeta();
        if (!legacy) {
            if (meta.background) { delete meta.background; _writeMeta(meta); }
            return;
        }
        const id = _newId();
        await _put(BG_KEY_PREFIX + id, legacy);
        await _del('background');
        const list = _userBackgrounds(meta);
        list.unshift({ id, kind: legacy.kind || 'image', mime: legacy.mime || '', filename: legacy.filename || '', slot: null });
        meta.backgrounds = list;
        delete meta.background;
        _writeMeta(meta);
    }

    // ── Public API ─────────────────────────────────────────
    let _visibilityWired = false;
    async function apply() {
        const meta = _readMeta();
        _applyName(meta.name);
        try { await _migrateLegacy(); } catch (e) { console.warn('[appearance] legacy migration failed', e); }
        _refresh();
        const portrait = await _get('portrait');
        _applyPortrait(portrait);
        if (!_visibilityWired) {
            _visibilityWired = true;
            // Timers are throttled in hidden tabs; re-check the phase on return.
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState !== 'visible') return;
                if (getRotation().mode === 'time' && currentSlot() !== _currentSlot) _refresh();
            });
        }
    }

    /** Add one or more files to the playlist. Returns the first failure (if any) for toasts. */
    async function addBackgrounds(files) {
        const list = Array.from(files || []);
        const meta = _readMeta();
        const bgs = _userBackgrounds(meta);
        let added = 0, failure = null;
        for (const file of list) {
            const v = _validate(file);
            if (!v.ok) { failure = failure || v; continue; }
            const rec = await _fileToRecord(file, v.kind);
            const id = _newId();
            await _put(BG_KEY_PREFIX + id, rec);
            bgs.push({ id, kind: v.kind, mime: rec.mime, filename: rec.filename, slot: null });
            added++;
        }
        meta.backgrounds = bgs;
        _writeMeta(meta);
        if (added) _refresh();
        return failure ? { ...failure, added } : { ok: true, added };
    }

    async function removeBackground(id) {
        await _del(BG_KEY_PREFIX + id);
        const meta = _readMeta();
        meta.backgrounds = _userBackgrounds(meta).filter(b => b.id !== id);
        _writeMeta(meta);
        _refresh();
        return { ok: true };
    }

    function setBackgroundSlot(id, slot) {
        const meta = _readMeta();
        const b = _userBackgrounds(meta).find(x => x.id === id);
        if (!b) return { ok: false, reason: 'not_found' };
        b.slot = SLOT_IDS.includes(slot) ? slot : null;
        _writeMeta(meta);
        _refresh();
        return { ok: true };
    }

    function setRotation({ mode, intervalMin } = {}) {
        try {
            if (mode === 'interval' || mode === 'time') localStorage.setItem(LS_BG_MODE, mode);
            const n = parseFloat(intervalMin);
            if (n > 0) localStorage.setItem(LS_BG_INTERVAL, String(Math.min(1440, n)));
        } catch {}
        try { window.profile?.markDirty?.('localStorage', LS_BG_MODE); } catch {}
        _refresh();
        return getRotation();
    }

    async function clearBackgrounds() {
        const all = await _readAll();
        for (const key of Object.keys(all)) {
            if (key.startsWith(BG_KEY_PREFIX) || key === 'background') await _del(key);
        }
        const meta = _readMeta();
        delete meta.backgrounds;
        delete meta.background;
        _writeMeta(meta);
        _refresh();
        return { ok: true };
    }

    /** Back-compat: replace the whole playlist with a single file (or clear it). */
    async function setBackground(file) {
        if (file == null) return clearBackgrounds();
        const v = _validate(file);
        if (!v.ok) return v;
        await clearBackgrounds();
        return addBackgrounds([file]);
    }

    async function setPortrait(file) {
        if (file == null) {
            await _del('portrait');
            const meta = _readMeta(); delete meta.portrait; _writeMeta(meta);
            _applyPortrait(null);
            return { ok: true };
        }
        const v = _validate(file);
        if (!v.ok || v.kind !== 'image') return { ok: false, reason: 'image_only' };
        const rec = await _fileToRecord(file, 'image');
        await _put('portrait', rec);
        const meta = _readMeta();
        meta.portrait = { mime: rec.mime, filename: rec.filename };
        _writeMeta(meta);
        _applyPortrait(rec);
        return { ok: true };
    }

    function setName(str) {
        const meta = _readMeta();
        if (!str || !String(str).trim()) delete meta.name;
        else meta.name = String(str).trim().slice(0, 64);
        _writeMeta(meta);
        _applyName(meta.name);
    }

    async function reset() {
        const all = await _readAll();
        for (const key of Object.keys(all)) await _del(key);
        try {
            localStorage.removeItem(LS_META);
            localStorage.removeItem(LS_BG_MODE);
            localStorage.removeItem(LS_BG_INTERVAL);
        } catch {}
        _refresh();
        _applyPortrait(null);
        _applyName(null);
    }

    function get() {
        const meta = _readMeta();
        const backgrounds = _userBackgrounds(meta);
        return {
            name: meta.name || null,
            backgrounds,
            background: backgrounds[0] || null,
            defaultBackgrounds: Array.isArray(SITE_BG.items) ? SITE_BG.items.length : 0,
            rotation: getRotation(),
            currentSlot: currentSlot(),
            portrait: meta.portrait || null,
        };
    }

    // ── Snapshot helpers for profile.js ────────────────────
    /** Dump IDB contents as array for profile snapshot. */
    async function dumpForSnapshot() {
        const all = await _readAll();
        const out = [];
        for (const [key, rec] of Object.entries(all)) {
            if (!rec) continue;
            const bytes = rec.bytes instanceof Uint8Array
                ? rec.bytes
                : (rec.bytes ? new Uint8Array(rec.bytes) : new Uint8Array(0));
            out.push({ key, kind: rec.kind || '', mime: rec.mime || 'application/octet-stream', filename: rec.filename || '', bytes });
        }
        return out;
    }

    /** Restore IDB from a snapshot-style array. Does not touch LS (that's handled via snapshot.localStorage). */
    async function restoreFromSnapshot(items) {
        try {
            const req = indexedDB.deleteDatabase(DB_NAME);
            await new Promise((res) => { req.onsuccess = () => res(); req.onerror = () => res(); req.onblocked = () => res(); });
        } catch {}
        if (!items || !items.length) return;
        const db = await _open();
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            const store = t.objectStore(STORE);
            for (const it of items) {
                const bytes = it.bytes instanceof Uint8Array
                    ? it.bytes
                    : (typeof it.bytes === 'string' ? new TextEncoder().encode(it.bytes) : new Uint8Array(it.bytes || []));
                store.put({ kind: it.kind || '', mime: it.mime || 'application/octet-stream', filename: it.filename || '', bytes }, it.key);
            }
            t.oncomplete = () => res();
            t.onerror    = () => rej(t.error);
        });
        db.close();
    }

    window.appearance = {
        apply,
        get,
        addBackgrounds,
        removeBackground,
        setBackgroundSlot,
        setRotation,
        getRotation,
        clearBackgrounds,
        setBackground,
        setPortrait,
        setName,
        reset,
        currentSlot,
        dumpForSnapshot,
        restoreFromSnapshot,
        SLOTS: SLOT_IDS,
        DEFAULT_NAME,
        DEFAULT_PORTRAIT,
        MAX_IMAGE_BYTES,
        MAX_VIDEO_BYTES,
    };
})();
