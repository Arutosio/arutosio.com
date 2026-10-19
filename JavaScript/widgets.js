/* ╔══════════════════════════════════════════════════════════╗
 * ║  WIDGETS — Floating draggable mini-panels                 ║
 * ║  Third role alongside 'app' and 'command'. Hosted as      ║
 * ║  sandboxed iframes inside .widget-frame containers that   ║
 * ║  float above OS windows. Positions persist via `aruta_    ║
 * ║  widgets` in localStorage (auto-synced by profile).       ║
 * ╚══════════════════════════════════════════════════════════╝ */

const WIDGETS_LS_KEY = 'aruta_widgets';
const WIDGET_TASKBAR_MARGIN = 68;  // keep below taskbar (taskbar is ~44px + 12+12 margin)
const WIDGET_MIN_VISIBLE = 40;      // clamp so at least this much stays on screen
const WIDGET_MOBILE_MAX = 640;       // hide widgets below this viewport width

function _loadState() {
    try {
        const raw = localStorage.getItem(WIDGETS_LS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function _saveState(state) {
    try { localStorage.setItem(WIDGETS_LS_KEY, JSON.stringify(state)); } catch {}
    try { window.profile?.markDirty?.('ls', WIDGETS_LS_KEY); } catch {}
}

let _state = _loadState();
let _zTop = 0;  // tracks highest widget z-index for bring-to-front on drag

function _isMobile() {
    return window.matchMedia(`(max-width: ${WIDGET_MOBILE_MAX}px)`).matches;
}

function list() {
    if (!window.registry) return [];
    return window.registry.list().filter(m => m.roles?.includes('widget'));
}

function getState(id) {
    return _state[id] || null;
}

function removeState(id) {
    if (!_state[id]) return;
    delete _state[id];
    _saveState(_state);
}

function _defaultPosition(manifest) {
    const opts = manifest.widget || {};
    const w = opts.defaultWidth || 280;
    const h = opts.defaultHeight || 360;
    const anchor = opts.defaultAnchor || 'bottom-right';
    const pad = 16;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = pad, y = WIDGET_TASKBAR_MARGIN + pad;
    if (anchor === 'top-right' || anchor === 'bottom-right') x = Math.max(pad, vw - w - pad);
    if (anchor === 'bottom-left' || anchor === 'bottom-right') y = Math.max(WIDGET_TASKBAR_MARGIN + pad, vh - h - pad);
    return { x, y, width: w, height: h };
}

function _clampPosition(x, y, w, h) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const maxX = vw - WIDGET_MIN_VISIBLE;
    const minX = -w + WIDGET_MIN_VISIBLE;
    const maxY = vh - WIDGET_MIN_VISIBLE;
    const minY = WIDGET_TASKBAR_MARGIN;
    return {
        x: Math.min(maxX, Math.max(minX, x)),
        y: Math.min(maxY, Math.max(minY, y)),
    };
}

/**
 * Determine which screen edge the widget is "stuck" to so resize can
 * preserve that relationship. Returns horizontal + vertical anchors
 * plus the pixel offset from the chosen edge — the values feed
 * _applyAnchor() to recompute coordinates on a new viewport.
 */
function _computeAnchor(x, y, w, h) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const distLeft   = x;
    const distRight  = vw - x - w;
    const distTop    = y - WIDGET_TASKBAR_MARGIN;
    const distBottom = vh - y - h;
    return {
        h: distLeft <= distRight ? 'left' : 'right',
        v: distTop  <= distBottom ? 'top'  : 'bottom',
        offsetH: Math.max(0, Math.min(distLeft, distRight)),
        offsetV: Math.max(0, Math.min(distTop,  distBottom)),
    };
}

/** Convert an anchor + size to a clamped {x, y} for the current viewport. */
function _applyAnchor(anchor, w, h) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = anchor.h === 'left'
        ? anchor.offsetH
        : (vw - w - anchor.offsetH);
    const y = anchor.v === 'top'
        ? (WIDGET_TASKBAR_MARGIN + anchor.offsetV)
        : (vh - h - anchor.offsetV);
    return _clampPosition(x, y, w, h);
}

function _createFrame(manifest, initialState) {
    const frame = document.createElement('div');
    frame.className = 'widget-frame';
    frame.dataset.widget = manifest.id;
    frame.title = manifest.name;
    frame.style.width = initialState.width + 'px';
    frame.style.height = initialState.height + 'px';
    frame.style.left = initialState.x + 'px';
    frame.style.top = initialState.y + 'px';
    frame.style.zIndex = String(++_zTop);
    // No chrome — just a thin border around the body that doubles as the
    // drag handle. Closing/disabling is handled exclusively from
    // Settings -> Widgets so the surface stays compact.
    frame.innerHTML = `<div class="widget-body"></div>`;
    document.body.appendChild(frame);
    return frame;
}

function _wireDrag(frame, widgetId) {
    // Whole frame is the drag handle, except the body — which contains the
    // package iframe and must stay interactive. The 4px padding around the
    // body acts as the visible drag belt.
    const handle = frame;
    let dragging = false;
    let startX = 0, startY = 0, origX = 0, origY = 0;
    let saveTimer = null;

    const onDown = (e) => {
        // Mousedown inside the body (including the iframe) = no drag.
        if (e.target.closest('.widget-body')) return;
        const isTouch = e.type === 'touchstart';
        const p = isTouch ? e.touches[0] : e;
        dragging = true;
        startX = p.clientX; startY = p.clientY;
        const r = frame.getBoundingClientRect();
        origX = r.left; origY = r.top;
        // Bring to front on grab.
        frame.style.zIndex = String(++_zTop);
        frame.classList.add('widget-dragging');
        if (!isTouch) e.preventDefault();
    };

    const onMove = (e) => {
        if (!dragging) return;
        const isTouch = e.type === 'touchmove';
        const p = isTouch ? e.touches[0] : e;
        const nx = origX + (p.clientX - startX);
        const ny = origY + (p.clientY - startY);
        const clamped = _clampPosition(nx, ny, frame.offsetWidth, frame.offsetHeight);
        frame.style.left = clamped.x + 'px';
        frame.style.top = clamped.y + 'px';
        if (!isTouch) e.preventDefault();
    };

    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        frame.classList.remove('widget-dragging');
        // Debounce save to coalesce drag bursts.
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const r = frame.getBoundingClientRect();
            savePosition(widgetId, Math.round(r.left), Math.round(r.top));
        }, 150);
    };

    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);

    // Return disposer for unmount cleanup.
    return () => {
        handle.removeEventListener('mousedown', onDown);
        handle.removeEventListener('touchstart', onDown);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
        if (saveTimer) clearTimeout(saveTimer);
    };
}

const _disposers = new Map(); // widgetId -> drag disposer

async function enable(id) {
    const manifest = window.registry?.getManifest(id);
    if (!manifest || !manifest.roles?.includes('widget')) return false;
    if (window.sandbox?.isWidgetMounted?.(id)) return true;

    const existing = _state[id] || {};
    const def = _defaultPosition(manifest);
    const initial = {
        enabled: true,
        x: Number.isFinite(existing.x) ? existing.x : def.x,
        y: Number.isFinite(existing.y) ? existing.y : def.y,
        width: Number.isFinite(existing.width) ? existing.width : def.width,
        height: Number.isFinite(existing.height) ? existing.height : def.height,
    };
    // Prefer the saved edge-anchor so the widget keeps the same gap from
    // its nearest edge across viewport changes (window resize, screen
    // rotation, devtools toggle). Fall back to absolute coords if no
    // anchor was ever saved (legacy state).
    if (existing.anchor) {
        const pos = _applyAnchor(existing.anchor, initial.width, initial.height);
        initial.x = pos.x; initial.y = pos.y;
        initial.anchor = existing.anchor;
    } else {
        const clamped = _clampPosition(initial.x, initial.y, initial.width, initial.height);
        initial.x = clamped.x; initial.y = clamped.y;
        initial.anchor = _computeAnchor(initial.x, initial.y, initial.width, initial.height);
    }

    _state[id] = initial;
    _saveState(_state);

    const frame = _createFrame(manifest, initial);
    const body = frame.querySelector('.widget-body');

    const mounted = await window.sandbox.mountWidget(id, { container: body });
    if (!mounted) {
        frame.remove();
        _state[id].enabled = false;
        _saveState(_state);
        return false;
    }
    _disposers.set(id, _wireDrag(frame, id));
    return true;
}

function disable(id) {
    try { window.sandbox?.unmountWidget?.(id); } catch {}
    const frame = document.querySelector(`.widget-frame[data-widget="${CSS.escape(id)}"]`);
    if (frame) frame.remove();
    const dispose = _disposers.get(id);
    if (dispose) { dispose(); _disposers.delete(id); }
    if (_state[id]) {
        _state[id].enabled = false;
        _saveState(_state);
    }
}

function savePosition(id, x, y) {
    const s = _state[id] || {};
    s.x = x; s.y = y;
    // Recompute the edge anchor so future resizes keep the same gap
    // from the nearest edge instead of just clamping to it.
    const w = s.width  || 280;
    const h = s.height || 360;
    s.anchor = _computeAnchor(x, y, w, h);
    _state[id] = s;
    _saveState(_state);
}

async function bootstrap() {
    _state = _loadState();
    if (_isMobile()) return; // hide all on mobile
    if (!window.registry) return;
    const available = new Set(list().map(m => m.id));
    // Clean up orphan state (package uninstalled offline).
    for (const id of Object.keys(_state)) {
        if (!available.has(id)) { delete _state[id]; }
    }
    _saveState(_state);
    // Mount every enabled widget sequentially (avoids z-index race).
    for (const m of list()) {
        if (_state[m.id]?.enabled) {
            try { await enable(m.id); }
            catch (e) { console.warn('[widgets] enable failed', m.id, e); }
        }
    }
}

/**
 * Render the Settings → Widgets tab body. Mirrors the permissions.js
 * pattern: full re-render on every toggle click.
 */
function renderSettings() {
    const root = document.getElementById('settings-widgets-list');
    if (!root) return;
    const mobileHint = document.querySelector('.widgets-empty-mobile');
    const t = window.t ? window.t() : {};

    if (_isMobile()) {
        if (mobileHint) mobileHint.style.display = '';
        root.innerHTML = '';
        return;
    }
    if (mobileHint) mobileHint.style.display = 'none';

    const widgets = list();
    if (widgets.length === 0) {
        root.innerHTML = `<div class="perm-empty">${t.widgets_empty || 'No widgets available. Install a package that provides a widget.'}</div>`;
        return;
    }

    root.innerHTML = widgets.map(m => {
        const enabled = !!_state[m.id]?.enabled;
        return `<div class="widget-row">
            <div class="widget-row-label">
                <span class="widget-row-icon">${m.icon || '🪄'}</span>
                <div class="widget-row-text">
                    <strong>${window.escapeHTML ? window.escapeHTML(m.name) : m.name}</strong>
                    <br><small>${window.escapeHTML ? window.escapeHTML(m.id) : m.id}</small>
                </div>
            </div>
            <button class="settings-toggle${enabled ? ' active' : ''}" data-widget="${m.id}" aria-label="${enabled ? 'Disable' : 'Enable'} ${m.name} widget">
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </button>
        </div>`;
    }).join('');

    root.querySelectorAll('.settings-toggle').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.widget;
            const currentlyOn = btn.classList.contains('active');
            if (currentlyOn) disable(id);
            else await enable(id);
            renderSettings();
        });
    });
}

// Re-anchor on window resize: keep each widget the same gap from its
// nearest edge so the layout adapts instead of drifting off-screen
// (or worse, getting hidden behind the taskbar).
let _resizeRaf = 0;
window.addEventListener('resize', () => {
    if (_resizeRaf) return;
    _resizeRaf = requestAnimationFrame(() => {
        _resizeRaf = 0;
        for (const frame of document.querySelectorAll('.widget-frame')) {
            const id = frame.dataset.widget;
            const s = _state[id];
            if (!s) continue;
            const w = frame.offsetWidth, h = frame.offsetHeight;
            const pos = s.anchor
                ? _applyAnchor(s.anchor, w, h)
                : _clampPosition(s.x || 0, s.y || 0, w, h);
            frame.style.left = pos.x + 'px';
            frame.style.top  = pos.y + 'px';
            // Persist the new absolute coords (anchor stays the same).
            s.x = pos.x; s.y = pos.y;
            _state[id] = s;
        }
        _saveState(_state);
    });
});

window.widgets = {
    bootstrap,
    enable,
    disable,
    list,
    getState,
    removeState,
    savePosition,
    renderSettings,
};
