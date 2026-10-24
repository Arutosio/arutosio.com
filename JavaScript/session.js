/* ╔══════════════════════════════════════════════════════════╗
 * ║  SESSION — Open windows, geometry and focus                 ║
 * ║  Persisted per device: arutosiod in local mode,            ║
 * ║  localStorage in hosted mode.                              ║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    const DEVICE_KEY = 'arutosio_device_id';
    const LS_PREFIX = 'arutosio_session_';
    let restoring = false;
    let timer = null;

    function newDeviceId() {
        try {
            if (window.crypto?.randomUUID) return crypto.randomUUID();
        } catch (_) {}
        return 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    let deviceId = '';
    try { deviceId = localStorage.getItem(DEVICE_KEY) || ''; } catch (_) {}
    if (!deviceId) {
        deviceId = newDeviceId();
        try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (_) {}
    }

    function taskbarHeight() {
        return typeof taskbarReserve === 'function' ? taskbarReserve() : 68;
    }

    function rectFromRestore(restore) {
        if (!restore) return null;
        const x = parseFloat(restore.left);
        const y = parseFloat(restore.top);
        const w = parseFloat(restore.width);
        const h = parseFloat(restore.height);
        if (![x, y, w, h].every(Number.isFinite)) return null;
        return { x, y, w, h };
    }

    function currentRect(win) {
        const r = win.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }

    function capture() {
        const windows = [];
        document.querySelectorAll('.os-window[data-window]').forEach(win => {
            const id = win.dataset.window;
            if (!id) return;
            const tab = Array.from(document.querySelectorAll('.taskbar-tab')).find(t => t.dataset.tab === id);
            const open = win.style.display !== 'none';
            if (!open && !tab) return;
            const maximized = win.classList.contains('win-maximized');
            const snapped = win._snapState || null;
            let rect = null;
            if (open) rect = currentRect(win);
            if (!rect && win._arutosioRect) rect = { ...win._arutosioRect };
            if (!rect && win._restoreRect) rect = rectFromRestore(win._restoreRect);
            const restoreRect = (maximized || snapped) ? rectFromRestore(win._restoreRect) : null;
            windows.push({
                id,
                open,
                minimized: !open,
                maximized,
                snapped,
                rect,
                restoreRect,
                z: parseInt(win.style.zIndex, 10) || 0,
                focused: win.classList.contains('win-focused'),
            });
        });
        return {
            version: 1,
            deviceId,
            updatedAt: new Date().toISOString(),
            viewport: { w: window.innerWidth, h: window.innerHeight },
            windows,
        };
    }

    async function save() {
        if (window.arutosioLocal?.isLocal && !window.arutosioLocal.authenticated) return;
        const data = capture();
        if (window.arutosioLocal?.isLocal) {
            try { await window.arutosioLocal.profile.putSession(deviceId, data); }
            catch (e) { console.warn('[session] server save failed', e); }
            return;
        }
        try { localStorage.setItem(LS_PREFIX + deviceId, JSON.stringify(data)); }
        catch (e) { console.warn('[session] local save failed', e); }
    }

    function schedule() {
        if (restoring) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; save(); }, 700);
    }

    async function load() {
        if (window.arutosioLocal?.isLocal) {
            try { return await window.arutosioLocal.profile.getSession(deviceId); } catch (_) { return null; }
        }
        try {
            const raw = localStorage.getItem(LS_PREFIX + deviceId);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }

    function clampRect(rect) {
        const top = taskbarHeight();
        const maxW = Math.max(260, window.innerWidth - 20);
        const maxH = Math.max(180, window.innerHeight - top - 20);
        const w = Math.min(maxW, Math.max(240, rect.w || 520));
        const h = Math.min(maxH, Math.max(160, rect.h || 360));
        const x = Math.min(Math.max(0, rect.x || 0), Math.max(0, window.innerWidth - 80));
        const y = Math.min(Math.max(top, rect.y || top + 20), Math.max(top, window.innerHeight - 40));
        return { x, y, w, h };
    }

    function applyRect(win, rect) {
        if (!win || !rect) return;
        const r = clampRect(rect);
        win.style.position = 'fixed';
        win.style.transform = 'none';
        win.style.margin = '0';
        win.style.left = r.x + 'px';
        win.style.top = r.y + 'px';
        win.style.width = r.w + 'px';
        win.style.height = r.h + 'px';
    }

    function restoreWindows(data) {
        const saved = (data?.windows || []).filter(w => w && w.id && document.getElementById('win-' + w.id));
        if (!saved.length) return;
        saved.sort((a, b) => (a.z || 0) - (b.z || 0));

        for (const w of saved) {
            const win = document.getElementById('win-' + w.id);
            if (!win) continue;
            openWindow(w.id);
            if (w.minimized) {
                win.style.display = 'none';
                win.classList.remove('win-focused');
                if (w.rect) win._arutosioRect = { ...w.rect };
                continue;
            }
            applyRect(win, w.rect || { x: 80, y: 90, w: 520, h: 360 });
            const restoreRect = w.restoreRect ? {
                left: w.restoreRect.x + 'px', top: w.restoreRect.y + 'px',
                width: w.restoreRect.w + 'px', height: w.restoreRect.h + 'px',
                position: 'fixed', transform: 'none',
            } : null;
            if (w.maximized) {
                // toggleMaximize saves the current rect; restore the floating
                // rect saved with the session afterwards.
                toggleMaximize(win);
                if (restoreRect) win._restoreRect = restoreRect;
            } else if (w.snapped && typeof applySnap === 'function') {
                applySnap(win, w.snapped);
                if (restoreRect) win._restoreRect = restoreRect;
            }
        }

        // Raise in saved z-order, then focus the window that had focus.
        for (const w of saved) {
            if (w.minimized) continue;
            const win = document.getElementById('win-' + w.id);
            if (win) focusWindow(win);
        }
        const focused = saved.find(w => w.focused && !w.minimized);
        if (focused) {
            const win = document.getElementById('win-' + focused.id);
            if (win) focusWindow(win);
        }
    }

    async function restore() {
        if (restoring) return;
        restoring = true;
        try {
            const data = await load();
            if (data && Array.isArray(data.windows) && data.windows.length) restoreWindows(data);
        } catch (e) {
            console.warn('[session] restore failed', e);
        } finally {
            restoring = false;
        }
    }

    function wrap(name) {
        const original = window[name];
        if (typeof original !== 'function') return;
        window[name] = function () {
            const result = original.apply(this, arguments);
            schedule();
            return result;
        };
    }
    ['openWindow', 'closeWindow', 'focusWindow', 'toggleMaximize'].forEach(wrap);

    // Minimize needs the last visible rect before display:none.
    const originalMinimize = window.minimizeWindow;
    if (typeof originalMinimize === 'function') {
        window.minimizeWindow = function (id) {
            const win = document.getElementById('win-' + id);
            if (win) {
                const rect = currentRect(win);
                if (rect) win._arutosioRect = rect;
            }
            const result = originalMinimize.apply(this, arguments);
            schedule();
            return result;
        };
    }

    ['pointerup', 'mouseup', 'touchend'].forEach(ev => {
        window.addEventListener(ev, () => { if (!restoring) schedule(); }, true);
    });
    window.addEventListener('resize', () => { if (!restoring) schedule(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') save();
    });
    window.addEventListener('pagehide', () => save());

    window.session = {
        restore,
        save,
        capture,
        deviceId,
    };
})();
