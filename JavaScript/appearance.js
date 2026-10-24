/* ╔══════════════════════════════════════════════════════════╗
 * ║  APPEARANCE — User-customizable backgrounds, portrait,    ║
 * ║  and display name. Binaries live in IDB                   ║
 * ║  arutosio_appearance and are slurped by profile.js into   ║
 * ║  snapshots. Backgrounds rotate on a user-set interval or  ║
 * ║  by time of day (dawn/noon/sunset/night).                 ║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    const DB_NAME = (window.Storage && window.Storage.constants.APPEARANCE_DB) || 'arutosio_appearance';
    const STORE   = 'assets';
    const DB_VER  = 1;
    const LS_META = 'arutosio_appearance_meta';
    const LS_BG_MODE     = 'arutosio_bg_mode';      // 'interval' | 'time'
    const LS_BG_INTERVAL = 'arutosio_bg_interval';  // minutes
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
    const _failed = new Set();  // ids that failed to load this session (skipped by the rotator)
    const MIN_INTERVAL = 1, MAX_INTERVAL = 1440;  // minutes; also keeps setTimeout below 2^31 ms

    // Playlist mutations read meta, await IDB, then write meta back. Run them
    // one at a time so two quick clicks can't overwrite each other's result.
    let _opChain = Promise.resolve();
    function _serial(fn) {
        const run = _opChain.then(fn, fn);
        _opChain = run.catch(() => {});
        return run;
    }

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
        try { document.dispatchEvent(new CustomEvent('arutosio:appearance')); } catch {}
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
        try { document.dispatchEvent(new CustomEvent('arutosio:appearance')); } catch {}
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

    /** Keys only — avoids pulling every (up to 50 MB) record into memory. */
    async function _keys() {
        try {
            const db = await _open();
            const keys = await new Promise((res, rej) => {
                const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
                r.onsuccess = () => res(r.result.map(String));
                r.onerror   = () => rej(r.error);
            });
            db.close();
            return keys;
        } catch { return []; }
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
    /** Site defaults as playlist entries. Static entries carry `src` instead of IDB bytes. */
    function _siteDefaults() {
        const items = Array.isArray(SITE_BG.items) ? SITE_BG.items : [];
        return items
            .filter(it => it && it.src)
            .map((it, i) => ({
                id: 'default_' + i,
                kind: it.kind || _kindFromSrc(it.src),
                src: it.src,
                filename: decodeURIComponent(String(it.src).split(/[\\/]/).pop() || ''),
                slot: it.slot || null,
            }));
    }
    /** Until the user edits the playlist, meta.backgrounds is absent and the site
     *  defaults apply. The first edit copies them in so they can be removed or re-slotted. */
    function _effectiveBackgrounds(meta) {
        if (!Array.isArray(meta.backgrounds)) return _siteDefaults();
        // Copied defaults keep their `src` as a reference into SITE_CONFIG; drop
        // ones this site no longer ships (config edit, or a profile imported
        // from the other mirror) instead of showing a 404.
        const srcs = new Set(_siteDefaults().map(d => d.src));
        return meta.backgrounds.filter(b => !b.src || srcs.has(b.src));
    }
    function _materialize(meta) {
        if (!Array.isArray(meta.backgrounds)) meta.backgrounds = _siteDefaults();
        return meta.backgrounds;
    }

    // ── File size / type validation ────────────────────────
    function _validate(file) {
        if (!file) return { ok: false, reason: 'no_file' };
        const isImg = /^image\//.test(file.type);
        const isVid = /^video\//.test(file.type);
        if (!isImg && !isVid) return { ok: false, reason: 'bad_type' };
        const cap = isVid ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
        if (file.size > cap) return { ok: false, reason: 'too_big', cap };
        if (isVid && !document.createElement('video').canPlayType(file.type)) return { ok: false, reason: 'unsupported' };
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
        interval = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, interval));
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
        return _effectiveBackgrounds(_readMeta()).map(b => ({
            id: b.id, kind: b.kind, slot: b.slot || null,
            src: b.src || null, user: !b.src,
        }));
    }
    function _candidates(mode, slot) {
        const list = _playlist().filter(it => !_failed.has(it.id));
        if (mode !== 'time') return list;
        const inSlot = list.filter(it => !it.slot || it.slot === slot);
        // If nothing covers the current phase, fall back to the whole list
        // rather than leaving the desktop bare.
        return inSlot.length ? inSlot : list;
    }

    /** Video backgrounds loop forever: hold them on their first frame when the
     *  OS asks for reduced motion / data saving, or when the user explicitly
     *  turned low-power on. Auto-detected low power (phones, ≤4 GB RAM) keeps
     *  the video — it is the point of a video wallpaper. */
    const _reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    function _motionAllowed() {
        if (_reducedMotion && _reducedMotion.matches) return false;
        if (navigator.connection && navigator.connection.saveData) return false;
        try { if (localStorage.getItem('arutosio_low_power') === 'on' && window._lowPower) return false; } catch {}
        return true;
    }
    function _syncPlayback() {
        const play = _motionAllowed() && !document.hidden;
        document.querySelectorAll('#user-bg-layer video.user-bg-media').forEach(v => {
            if (play) v.play?.().catch(() => {});
            else v.pause?.();
        });
    }

    function _stopTimers() {
        clearTimeout(_rotTimer); _rotTimer = null;
        clearTimeout(_slotTimer); _slotTimer = null;
    }

    function _scheduleNext() {
        clearTimeout(_rotTimer); _rotTimer = null;
        if (_queue.length < 2 || document.hidden) return;  // resumed on visibilitychange
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
        const prevSlot = _currentSlot;
        _currentSlot = currentSlot();
        _queue = _candidates(mode, _currentSlot);
        if (!_queue.length) { _show(null); return; }
        const keep = _queue.findIndex(it => it.id === _currentId);
        // On a phase change, switch to an item assigned to the new phase
        // rather than lingering on an "any time" one.
        const phaseChanged = mode === 'time' && prevSlot && prevSlot !== _currentSlot;
        const preferred = phaseChanged ? _queue.findIndex(it => it.slot === _currentSlot) : -1;
        _idx = preferred >= 0 ? preferred : (keep >= 0 ? keep : 0);
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
            el.autoplay = _motionAllowed(); el.loop = true; el.muted = true; el.playsInline = true;
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
            // Nothing to show: let the stock background (and its ambience) back in.
            delete document.documentElement.dataset.wallpaper;
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
            // Bytes gone (partial restore / quota): skip it like a failed load,
            // otherwise the wallpaper gate would stay stuck on "loading".
            if (!rec) { _failed.add(item.id); _refresh(); return; }
            blob = _recordToURL(rec);
            if (!blob) { _failed.add(item.id); _refresh(); return; }
            src = blob;
            kind = rec.kind || kind;
        }

        mount.style.display = '';
        const el = _createMedia(kind, src);
        el.dataset.bgId = item.id;
        if (blob) el.dataset.blob = blob;
        const prev = Array.from(mount.querySelectorAll('.user-bg-media'));
        mount.appendChild(el);
        _currentId = item.id;

        let settled = false;
        // `loaded` = a real first frame is available. The 4 s safety net below
        // reveals whatever has arrived, but must not claim the wallpaper is ready.
        const reveal = (loaded) => {
            if (settled) return;
            settled = true;
            // Only the first item is born visible: a crossfade needs a previous layer.
            const crossfade = prev.length > 0;
            if (!crossfade) el.style.transition = 'none';
            // rAF doesn't run in hidden tabs; show immediately there.
            if (document.hidden || !crossfade) el.classList.add('is-visible');
            else requestAnimationFrame(() => el.classList.add('is-visible'));
            if (loaded) document.documentElement.dataset.wallpaper = 'ready';
            setTimeout(() => prev.forEach(_disposeMedia), FADE_MS + 100);
        };
        const fail = () => {
            if (settled) return;
            settled = true;
            // Keep whatever was on screen; skip this item from now on.
            _disposeMedia(el);
            _failed.add(item.id);
            console.warn('[appearance] background failed to load, skipping:', item.src || item.id);
            const still = mount.querySelector('.user-bg-media');
            _currentId = still ? still.dataset.bgId || null : null;
            if (token === _showToken) _refresh();
        };
        if (kind === 'video') {
            el.addEventListener('loadeddata', () => reveal(true), { once: true });
            if (_motionAllowed()) el.play?.().catch(() => {});
        } else {
            el.addEventListener('load', () => reveal(true), { once: true });
        }
        el.addEventListener('error', fail, { once: true });
        setTimeout(() => reveal(false), 4000);  // slow network: show whatever has loaded so far
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

    // ── Orphan cleanup ─────────────────────────────────────
    /** Make meta and IDB agree: drop list entries whose bytes are gone (failed
     *  write, partial restore) and bytes nothing references (wiped settings,
     *  interrupted upload). Keeps snapshots from carrying dead weight. */
    async function _pruneOrphans() {
        const keys = new Set(await _keys());
        const meta = _readMeta();
        let dirty = false;
        if (Array.isArray(meta.backgrounds)) {
            const kept = meta.backgrounds.filter(b => b.src || keys.has(BG_KEY_PREFIX + b.id));
            if (kept.length !== meta.backgrounds.length) { meta.backgrounds = kept; dirty = true; }
        }
        if (meta.portrait && !keys.has('portrait')) { delete meta.portrait; dirty = true; }
        if (dirty) _writeMeta(meta);
        const referenced = new Set(_userBackgrounds(meta).filter(b => !b.src).map(b => BG_KEY_PREFIX + b.id));
        if (meta.portrait) referenced.add('portrait');
        for (const key of keys) {
            if ((key.startsWith(BG_KEY_PREFIX) || key === 'portrait') && !referenced.has(key)) await _del(key);
        }
    }

    // ── Public API ─────────────────────────────────────────
    let _wired = false;
    function _wireLifecycle() {
        if (_wired) return;
        _wired = true;
        // Hidden tab: pause videos and the rotation timer (no point swapping
        // pixels nobody sees). Back: re-check the phase and resume.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { clearTimeout(_rotTimer); _rotTimer = null; _syncPlayback(); return; }
            if (getRotation().mode === 'time' && currentSlot() !== _currentSlot) _refresh();
            else _scheduleNext();
            _syncPlayback();
        });
        // Timers don't advance while the machine sleeps; a cheap minute tick
        // catches phase changes the slot timer missed.
        setInterval(() => {
            if (!document.hidden && getRotation().mode === 'time' && currentSlot() !== _currentSlot) _refresh();
        }, 60 * 1000);
        _reducedMotion?.addEventListener?.('change', _syncPlayback);
    }

    async function apply() {
        const meta = _readMeta();
        _applyName(meta.name);
        // Wallpaper first (usually already on screen via the prewarm below), then
        // the integrity pass — it must not delay the first frame.
        _refresh();
        await _serial(async () => {
            try { await _migrateLegacy(); } catch (e) { console.warn('[appearance] legacy migration failed', e); }
            try { await _pruneOrphans(); } catch (e) { console.warn('[appearance] orphan cleanup failed', e); }
        });
        _refresh();
        let portrait = null;
        try { portrait = await _get('portrait'); } catch (e) { console.warn('[appearance] portrait load failed', e); }
        _applyPortrait(portrait);
        _wireLifecycle();
    }

    /** Add one or more files to the playlist. Returns the first failure (if any) for toasts. */
    function addBackgrounds(files) {
        return _serial(async () => {
            const list = Array.from(files || []);
            let added = 0, failure = null;
            for (const file of list) {
                const v = _validate(file);
                if (!v.ok) { failure = failure || v; continue; }
                try {
                    const rec = await _fileToRecord(file, v.kind);
                    const id = _newId();
                    await _put(BG_KEY_PREFIX + id, rec);
                    // Persist after every file so a later failure (quota) keeps the earlier ones.
                    const meta = _readMeta();
                    _materialize(meta).push({ id, kind: v.kind, mime: rec.mime, filename: rec.filename, slot: null });
                    _writeMeta(meta);
                    added++;
                } catch (e) {
                    console.warn('[appearance] could not store background', file.name, e);
                    failure = failure || { ok: false, reason: 'failed' };
                }
            }
            if (added) { _failed.clear(); _refresh(); }
            return failure ? { ...failure, added } : { ok: true, added };
        });
    }

    function removeBackground(id) {
        return _serial(async () => {
            const meta = _readMeta();
            const bgs = _materialize(meta);
            const target = bgs.find(b => b.id === id);
            if (target && !target.src) await _del(BG_KEY_PREFIX + id);
            meta.backgrounds = bgs.filter(b => b.id !== id);
            _writeMeta(meta);
            _refresh();
            return { ok: true };
        });
    }

    function setBackgroundSlot(id, slot) {
        return _serial(async () => {
            const meta = _readMeta();
            const b = _materialize(meta).find(x => x.id === id);
            if (!b) return { ok: false, reason: 'not_found' };
            b.slot = SLOT_IDS.includes(slot) ? slot : null;
            _writeMeta(meta);
            _refresh();
            return { ok: true };
        });
    }

    function setRotation({ mode, intervalMin } = {}) {
        try {
            if (mode === 'interval' || mode === 'time') localStorage.setItem(LS_BG_MODE, mode);
            const n = parseFloat(intervalMin);
            if (n > 0) localStorage.setItem(LS_BG_INTERVAL, String(Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, n))));
        } catch {}
        try { window.profile?.markDirty?.('localStorage', LS_BG_MODE); } catch {}
        _refresh();
        return getRotation();
    }

    async function _deleteUploads() {
        for (const key of await _keys()) {
            if (key.startsWith(BG_KEY_PREFIX) || key === 'background') await _del(key);
        }
    }

    /** Remove every background, site defaults included (desktop falls back to the gradient). */
    function clearBackgrounds() {
        return _serial(async () => {
            await _deleteUploads();
            const meta = _readMeta();
            meta.backgrounds = [];
            delete meta.background;
            _writeMeta(meta);
            _refresh();
            return { ok: true };
        });
    }

    /** Drop the user's playlist and go back to the site's default backgrounds. */
    function restoreDefaultBackgrounds() {
        return _serial(async () => {
            await _deleteUploads();
            const meta = _readMeta();
            delete meta.backgrounds;
            delete meta.background;
            _writeMeta(meta);
            _failed.clear();
            _refresh();
            return { ok: true };
        });
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

    function reset() {
        return _serial(async () => {
            // Settings first, so a failing IDB delete can't leave them behind.
            try {
                localStorage.removeItem(LS_META);
                localStorage.removeItem(LS_BG_MODE);
                localStorage.removeItem(LS_BG_INTERVAL);
            } catch {}
            try { window.profile?.markDirty?.('localStorage', LS_META); } catch {}
            _failed.clear();
            try {
                for (const key of await _keys()) await _del(key);
            } finally {
                _refresh();
                _applyPortrait(null);
                _applyName(null);
            }
        });
    }

    function get() {
        const meta = _readMeta();
        const backgrounds = _effectiveBackgrounds(meta);
        return {
            name: meta.name || null,
            backgrounds,
            background: backgrounds[0] || null,
            usingDefaultBackgrounds: !Array.isArray(meta.backgrounds),
            defaultBackgrounds: _siteDefaults().length,
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

    // ── Prewarm ────────────────────────────────────────────
    // This script runs at parse time with #user-bg-layer already in the DOM, so
    // start the wallpaper request here instead of waiting for showApp() + the
    // profile gate + the IDB integrity pass. Site defaults start downloading
    // synchronously; uploads start as soon as their IDB read resolves.
    // Legacy single-background profiles are skipped: _migrateLegacy() in apply()
    // turns them into playlist entries first.
    if (!_readMeta().background) _refresh();
    // Stalled fetch: never leave a flat colour standing in for the wallpaper.
    // (A late first frame still flips the gate to "ready" when it arrives.)
    setTimeout(() => {
        if (document.documentElement.dataset.wallpaper === 'loading')
            delete document.documentElement.dataset.wallpaper;
    }, 10000);

    window.appearance = {
        apply,
        get,
        addBackgrounds,
        removeBackground,
        setBackgroundSlot,
        setRotation,
        getRotation,
        clearBackgrounds,
        restoreDefaultBackgrounds,
        setBackground,
        setPortrait,
        setName,
        reset,
        currentSlot,
        syncPlayback: _syncPlayback,
        dumpForSnapshot,
        restoreFromSnapshot,
        SLOTS: SLOT_IDS,
        DEFAULT_NAME,
        DEFAULT_PORTRAIT,
        MAX_IMAGE_BYTES,
        MAX_VIDEO_BYTES,
    };
})();
