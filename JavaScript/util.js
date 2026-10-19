/* ╔══════════════════════════════════════════════════════════╗
 * ║  UTIL — Shared helpers used across modules                ║
 * ║  t() i18n · escapeHTML · safe storage · mq state · toast  ║
 * ╚══════════════════════════════════════════════════════════╝ */

/* i18n accessor — returns the current-language table, empty on miss.
   i18n (config.js) and currentLang (core.js) are declared with const/let,
   which do NOT attach to `window` in classic scripts — so we have to
   reference them by bare name via `typeof` guards. */
window.t = function t() {
    try {
        if (typeof i18n !== 'undefined' && typeof currentLang !== 'undefined') {
            return i18n[currentLang] || {};
        }
    } catch {}
    return {};
};

/* HTML entity escape for user-provided text rendered via innerHTML */
window.escapeHTML = function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
};

/* Safe localStorage wrapper. get() auto-JSON-parses; set() auto-stringifies.
   All methods swallow quota/SecurityError so callers never need try/catch. */
window.storage = {
    get(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            if (raw == null) return fallback;
            // Leave plain strings alone — only try JSON if it smells like JSON.
            if (raw[0] === '{' || raw[0] === '[' || raw === 'true' || raw === 'false' || raw === 'null' || /^-?\d/.test(raw)) {
                try { return JSON.parse(raw); } catch { return raw; }
            }
            return raw;
        } catch { return fallback; }
    },
    set(key, value) {
        try {
            const v = typeof value === 'string' ? value : JSON.stringify(value);
            localStorage.setItem(key, v);
            try { window.profile?.markDirty?.('localStorage', key); } catch {}
            return true;
        } catch { return false; }
    },
    del(key) {
        try {
            localStorage.removeItem(key);
            try { window.profile?.markDirty?.('localStorage', key); } catch {}
            return true;
        }
        catch { return false; }
    },
};

/* Shared media-query state. Single source of truth for "are we on
   a phone/touch/light-mode viewport", mirrored to classes on <html>
   so CSS can react too. */
(function initMQ() {
    const MOBILE = window.matchMedia('(max-width: 640px), (pointer: coarse)');
    const TOUCH  = window.matchMedia('(pointer: coarse)');
    const LIGHT  = window.matchMedia('(prefers-color-scheme: light)');
    const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');

    function sync() {
        const html = document.documentElement;
        html.classList.toggle('is-mobile', MOBILE.matches);
        html.classList.toggle('is-touch',  TOUCH.matches);
        html.classList.toggle('is-reduced-motion', REDUCE.matches);
    }
    sync();
    [MOBILE, TOUCH, LIGHT, REDUCE].forEach(m => m.addEventListener('change', sync));

    window.mq = {
        get isMobile()  { return MOBILE.matches; },
        get isTouch()   { return TOUCH.matches; },
        get prefersLight() { return LIGHT.matches; },
        get reduceMotion() { return REDUCE.matches; },
        onChange(fn) {
            MOBILE.addEventListener('change', fn);
            TOUCH.addEventListener('change', fn);
        },
    };
})();

/* Toast / confirm fallbacks — zero-op if the UI helpers aren't loaded yet. */
window.toast = function toast(msg, type = 'info', duration) {
    return window.showToast ? window.showToast(msg, type, duration) : null;
};
window.confirmDialog = function confirmDialog(msg, opts) {
    if (window.showConfirm) return window.showConfirm(msg, opts);
    return Promise.resolve(window.confirm(msg));
};
