/* ╔══════════════════════════════════════════════════════════╗
 * ║  CORE — State, Internationalization, Theme              ║
 * ║  Global state variables, language switching, theme mgmt ║
 * ╚══════════════════════════════════════════════════════════╝ */

/* ────────────────────────────────
 * § STATE — Global variables & constants
 * Shared across all modules via window scope.
 * _tabVisible pauses canvas loops when the tab is hidden.
 * ──────────────────────────────── */
let currentLang  = 'it';
let currentTheme = 'dark';
const RUNE_SET = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟᛡᛣᛤᛥᛦ✦⊕⋆◈✧';

/* Cached globals — avoid DOM reads in animation loops */
let _isLight = false;          // cached theme check — updated in toggleTheme
let _tabVisible = true;        // visibility state — pause animations when hidden
window._parallaxEnabled = true;
window._clickSpellsEnabled = true;
window._circleRotationEnabled = true;

document.addEventListener('visibilitychange', () => {
    _tabVisible = !document.hidden;
});

/* ────────────────────────────────
 * § I18N — Language detection, switching, translation
 * Reads from the global `i18n` object defined in config.js.
 * Persists choice in localStorage under 'arutosio_lang'.
 * ──────────────────────────────── */

/**
 * Apply translations to all elements with data-i18n attributes
 * @param {string} lang — language code (it, en, es, ja, fn)
 */
function applyTranslations(lang) {
    const t = i18n[lang];
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (t[key] !== undefined) el.textContent = t[key];
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        if (t[key] !== undefined) el.title = t[key];
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        const key = el.dataset.i18nAria;
        if (t[key] !== undefined) el.setAttribute('aria-label', t[key]);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        if (t[key] !== undefined) el.placeholder = t[key];
    });
}

/**
 * Auto-detect user language from navigator, with fallback mapping
 * @returns {string} language code
 */
function detectLanguage() {
    const code = (navigator.language || 'en').split('-')[0].toLowerCase();
    if (i18n[code]) return code;
    const map = { pt:'es', ca:'es', gl:'es' };
    return map[code] || 'en';
}

/**
 * Switch the active language, updating all translated content
 * @param {string} lang — target language code
 */
function switchLanguage(lang) {
    if (!i18n[lang] || lang === currentLang) return;
    currentLang = lang;
    localStorage.setItem('arutosio_lang', lang);
    document.documentElement.setAttribute('lang', lang === 'fn' ? 'en' : lang);
    setActiveLangBtn(lang);
    applyTranslations(lang);
    if (typeof refreshAppearanceUI === 'function') refreshAppearanceUI();
    buildInterestGrid(lang);
    buildProjectCards(lang);
    typewriterBio(i18n[lang].bio);
    // Update taskbar tab labels to match new language
    document.querySelectorAll('.taskbar-tab').forEach(tab => {
        const id = tab.dataset.tab;
        const meta = WIN_META[id];
        if (!meta) return;
        const labelKey = id === 'settings' ? 'sec_settings' : 'sec_' + id;
        const newLabel = i18n[currentLang][labelKey] || meta.label;
        const labelSpan = tab.querySelector('.tab-label');
        if (labelSpan) labelSpan.textContent = newLabel;
    });
    // Notify modules that write text dynamically (profile status, appearance
    // placeholders, permissions/widgets lists) so they can re-render against
    // the new language. Pure data-i18n elements are already handled above.
    document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
}

/**
 * Sync the language selector UI to the current language
 * @param {string} lang — active language code
 */
function setActiveLangBtn(lang) {
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = lang;
    const settingsSel = document.getElementById('settings-lang');
    if (settingsSel) settingsSel.value = lang;
}

/* ────────────────────────────────
 * § THEME — Dark/Light mode toggle
 * Uses a CSS ripple transition centered on the toggle button.
 * Persists choice in localStorage under 'arutosio_theme'.
 * ──────────────────────────────── */

/**
 * Toggle between dark and light themes with a ripple transition
 */
function toggleTheme(opts) {
    // Manual toggles disable follow-OS; the OS-driven listener in app.js
    // passes { keepFollowOS:true } when reacting to a system change so it
    // doesn't disable the very mode it's responding to.
    if (!opts || !opts.keepFollowOS) {
        try { localStorage.setItem('arutosio_theme_follow_os', 'false'); } catch (_) {}
    }
    unlockAchievement('theme_switch');
    // Ripple transition effect
    const ripple = document.createElement('div');
    ripple.className = 'theme-ripple';
    const themeEl = document.getElementById('theme-btn') || document.getElementById('settings-theme-toggle');
    if (themeEl) {
        const btnRect = themeEl.getBoundingClientRect();
        ripple.style.left = btnRect.left + btnRect.width / 2 + 'px';
        ripple.style.top = btnRect.top + btnRect.height / 2 + 'px';
    } else {
        ripple.style.left = '50%';
        ripple.style.top = '50%';
    }
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 800);

    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    _isLight = currentTheme === 'light';
    window.currentTheme = currentTheme;
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('arutosio_theme', currentTheme);
    updateThemeIcon();
    // Push the new theme to every mounted app iframe so CSS vars update live.
    window.sandbox?.broadcastTheme?.(currentTheme);
}

/**
 * Sync the theme icon (sun/moon) to the current theme
 */
function updateThemeIcon() {
    const icon = document.getElementById('theme-icon');
    if (!icon) return;
    icon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}

/**
 * Show a themed toast notification
 * @param {string} msg — message text
 * @param {string} [type='info'] — 'info' | 'success' | 'warning' | 'error'
 * @param {number} [duration=3500] — ms before auto-dismiss
 */
const TOAST_ICONS = {
    info:    'fa-circle-info',
    success: 'fa-circle-check',
    warning: 'fa-triangle-exclamation',
    error:   'fa-circle-xmark',
};
function showToast(msg, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.setProperty('--toast-duration', `${duration}ms`);
    toast.innerHTML = `
        <i class="toast-icon fas ${TOAST_ICONS[type] || TOAST_ICONS.info}" aria-hidden="true"></i>
        <span class="toast-msg"></span>
        <button class="toast-close" aria-label="Close">✕</button>
    `;
    toast.querySelector('.toast-msg').textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-show'));
    const dismiss = () => {
        if (toast._dismissed) return;
        toast._dismissed = true;
        toast.classList.remove('toast-show');
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 400);
    };
    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    setTimeout(dismiss, duration);
    return toast;
}
window.showToast = showToast;

/**
 * Themed confirm dialog — returns a Promise<boolean>
 * @param {string} msg — confirmation text
 * @param {object} [opts] — { okText, cancelText, type }
 */
function showConfirm(msg, opts = {}) {
    return new Promise(resolve => {
        const ok = opts.okText || 'Confirm';
        const cancel = opts.cancelText || 'Cancel';
        const type = opts.type || 'warning';
        const backdrop = document.createElement('div');
        backdrop.className = 'confirm-backdrop';
        const modal = document.createElement('div');
        modal.className = `confirm-modal confirm-${type}`;
        modal.innerHTML = `
            <div class="confirm-msg"></div>
            <div class="confirm-actions">
                <button class="confirm-btn confirm-cancel"></button>
                <button class="confirm-btn confirm-ok"></button>
            </div>
        `;
        modal.querySelector('.confirm-msg').textContent = msg;
        modal.querySelector('.confirm-cancel').textContent = cancel;
        modal.querySelector('.confirm-ok').textContent = ok;
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        requestAnimationFrame(() => backdrop.classList.add('confirm-show'));
        const close = (result) => {
            backdrop.classList.remove('confirm-show');
            setTimeout(() => backdrop.remove(), 250);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') close(false);
            else if (e.key === 'Enter') close(true);
        };
        document.addEventListener('keydown', onKey);
        modal.querySelector('.confirm-ok').addEventListener('click', () => close(true));
        modal.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
        modal.querySelector('.confirm-ok').focus();
    });
}
window.showConfirm = showConfirm;
