/* ╔══════════════════════════════════════════════════════════╗
 * ║  APP.JS — Application Entry Point                       ║
 * ║  Bootstraps the Arcane OS: restores settings, inits all ║
 * ║  modules, runs summoning sequence, then shows the app.  ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Load order (regular <script> tags, no modules):
 *   1. config.js  — i18n translations, social links, project slugs
 *   2. core.js    — state, i18n functions, theme toggle
 *   3. effects.js — particles, cursor, parallax, spells, fireflies, flying letters
 *   4. desktop.js — magic circle interaction, summoning canvas + sequence
 *   5. content.js — link cards, interests, projects, clips, live, countdown, tilt
 *   6. extras.js  — ambient sound, achievements, share, easter eggs
 *   7. os.js      — window manager, taskbar, start menu, settings, sysinfo, clock
 *   8. app.js     — this file (entry point)
 */

/* ────────────────────────────────
 * § SHOW APP
 * Called after summoning completes (or immediately on repeat
 * visits). Reveals the main app container and initializes
 * all interactive features.
 * ──────────────────────────────── */
function showApp() {
    const app = document.getElementById('app');
    app.classList.remove('hidden');
    app.classList.add('visible');
    buildLinkCards();
    buildInterestGrid(currentLang);
    initLiveSection();
    initCountdown();
    initShareButton();
    buildProjectCards(currentLang);
    buildClipGallery();
    applyTranslations(currentLang);
    startClock();
    initWindowManager();
    initStartMenu();
    initSections();
    updateTabTitle('home');
    initFireflies();
    initMagicCircleInteraction();
    initDesktopContextMenu();
    initAmbientSound();
    initAchievements();
    initSysInfo();

    // Initialize package registry (loads installed apps + commands from IndexedDB),
    // then install any bundled default packages missing from the registry.
    // Profile gate: if a linked folder is present and readable, it will have
    // already restored browser state and triggered a reload — in which case
    // `reloading === true` and we skip further boot to avoid double work.
    (async () => {
        let reloading = false;
        try { reloading = await (window.__arutaProfileReady || Promise.resolve(false)); } catch {}
        if (reloading) return;
        // Apply user-customizable appearance (background/portrait/name) after the
        // profile gate so folder-linked binaries are already in IDB.
        try { await window.appearance?.apply(); } catch (e) { console.warn('[appearance] apply failed', e); }
        if (window.registry) await window.registry.bootstrap();
        if (window.defaults) await window.defaults.bootstrap();
        if (window.widgets) await window.widgets.bootstrap();
        applyTranslations(currentLang);
    })();
    if (window.installer) window.installer.initDragDrop();

    // Entrance animation for home hero on desktop
    setTimeout(() => {
        animateSectionEntrance('home');
        initTilt();
    }, 200);
}

/* ────────────────────────────────
 * § SECTION ENTRANCE EFFECTS
 * Triggers visual entrance animations when a section/window
 * is opened. Each section has its own entrance pattern.
 * ──────────────────────────────── */
function animateSectionEntrance(sectionId) {
    switch (sectionId) {
        case 'home':
            flyingLettersInit();
            break;

        case 'about':
            revealCards('.interest-card', 200);
            setTimeout(initTilt, 800);
            break;

        case 'live':
            // No special entrance animation needed
            break;

        case 'links':
            revealCards('.link-card', 100);
            setTimeout(initTilt, 600);
            break;
    }
}

/* ────────────────────────────────
 * § INIT — DOMContentLoaded
 * Restores saved settings (font size, language, theme),
 * starts background effects, and either runs the summoning
 * sequence or skips it for repeat visits in the same session.
 * ──────────────────────────────── */
// Restore theme/font ASAP (DOMContentLoaded) to prevent flash
document.addEventListener('DOMContentLoaded', () => {
    const savedFontSize = localStorage.getItem('aruta_fontsize');
    if (savedFontSize) document.documentElement.style.fontSize = savedFontSize + '%';

    // Restore font family preset ASAP to avoid a flash of default fonts
    const FONT_PRESETS = {
        medieval: { body: "'IM Fell English', Georgia, serif", display: "'IM Fell English', Georgia, serif" },
        modern:   { body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", display: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" },
        serif:    { body: "Georgia, 'Times New Roman', serif", display: "Georgia, 'Times New Roman', serif" },
        mono:     { body: "'Courier New', Consolas, monospace", display: "'Courier New', Consolas, monospace" },
        nordic:   { body: "'Cinzel', Georgia, serif", display: "'Cinzel', Georgia, serif" },
    };
    const savedFont = localStorage.getItem('aruta_font');
    if (savedFont && FONT_PRESETS[savedFont]) {
        document.documentElement.style.setProperty('--font-body', FONT_PRESETS[savedFont].body);
        document.documentElement.style.setProperty('--font-display', FONT_PRESETS[savedFont].display);
    }

    // Follow-OS is the default. The user can disable it from Settings, in
    // which case we honour the saved manual choice. With follow-OS active,
    // any saved value is ignored and the system preference wins.
    const followOS = localStorage.getItem('aruta_theme_follow_os') !== 'false';
    const savedTheme = localStorage.getItem('aruta_theme');
    const osPref = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    currentTheme = followOS ? osPref : (savedTheme || osPref);
    window.currentTheme = currentTheme;
    document.documentElement.setAttribute('data-theme', currentTheme);
    _isLight = currentTheme === 'light';

    // React to OS theme changes while follow-OS is on. When the user later
    // toggles manually we flip follow-OS off in toggleTheme, so this listener
    // becomes a no-op without removal.
    try {
        const mq = window.matchMedia('(prefers-color-scheme: light)');
        const onMqChange = (e) => {
            if (localStorage.getItem('aruta_theme_follow_os') === 'false') return;
            const next = e.matches ? 'light' : 'dark';
            if (next === window.currentTheme) return;
            if (typeof toggleTheme === 'function') toggleTheme({ keepFollowOS: true });
        };
        mq.addEventListener ? mq.addEventListener('change', onMqChange) : mq.addListener(onMqChange);
    } catch (_) { /* old browsers — skip */ }

    // Respect OS reduced-motion preference — disable heavy mouse-driven effects.
    // The user can still re-enable these from Settings → Performance if they want.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        window._parallaxEnabled = false;
        window._clickSpellsEnabled = false;
        window._circleRotationEnabled = false;
    }
});

/* ────────────────────────────────
 * § LOW POWER MODE
 * Trims the heaviest ambient effects (fog blur, particle density, parallax,
 * glass blur) on weak/battery-constrained devices. Auto-detected from device
 * hints; user can force on/off from Settings → Performance.
 *   localStorage 'aruta_low_power': absent = auto, 'on'/'off' = explicit override.
 * ──────────────────────────────── */
function detectLowPower() {
    try {
        return window.matchMedia('(pointer: coarse)').matches
            || (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4)
            || window.matchMedia('(prefers-reduced-motion: reduce)').matches
            || !!(navigator.connection && navigator.connection.saveData);
    } catch (_) { return false; }
}
function resolveLowPower() {
    const stored = localStorage.getItem('aruta_low_power');
    return stored == null ? detectLowPower() : stored === 'on';
}
function applyLowPower(on) {
    window._lowPower = on;
    document.body.classList.toggle('low-power', on);
}
window.detectLowPower = detectLowPower;
window.resolveLowPower = resolveLowPower;
window.applyLowPower = applyLowPower;

// Boot as soon as the DOM is parsed — no longer block on fonts/images.
// Head stylesheets are render-blocking so CSSOM is ready here; the hero
// portrait is a tiny webp that loads independently. Waiting on window.load
// (all images/fonts) needlessly delayed first interaction on mobile.
function bootApp() {
    const savedLang  = localStorage.getItem('aruta_lang');

    currentLang  = (savedLang && i18n[savedLang]) ? savedLang : detectLanguage();
    document.documentElement.setAttribute('lang', currentLang === 'fn' ? 'en' : currentLang);
    updateThemeIcon();
    setActiveLangBtn(currentLang);

    // Resolve low-power BEFORE effects init so particle density etc. honor it.
    applyLowPower(resolveLowPower());

    // Start background effects — CSS is fully loaded now
    initRuneParticles();
    initMagicCursor();
    initParallax();
    initClickSpells();

    // Re-apply saved Performance toggles and Appearance tweaks — Settings
    // init is lazy (first open), so without this a reload would revert
    // them until Settings is opened.
    window.restorePerfToggles?.();
    window.restoreThemeTweaks?.();

    /**
     * Smooth fade transition from overlay to desktop.
     * Prepares the app behind the overlay, then fades out.
     */
    function fadeOverlayAndReveal() {
        // Prepare app behind the overlay (invisible, ready to go)
        showApp();
        // Smooth fade-out of the overlay
        const overlay = document.getElementById('summon-overlay');
        if (overlay) {
            overlay.classList.add('fade-out');
            overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
            // Fallback removal if transitionend doesn't fire
            setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 1200);
        }
    }

    if (sessionStorage.getItem('aruta_summoned')) {
        // Repeat visit — everything loaded, reveal immediately
        const overlay = document.getElementById('summon-overlay');
        if (overlay) overlay.remove();
        showApp();
    } else {
        // First visit — resources already loaded (we're inside window.load)
        // Play summoning animation then reveal
        initSummonCanvas();

        runSummoning(() => {
            sessionStorage.setItem('aruta_summoned', '1');
            fadeOverlayAndReveal();
        });
    }

    // Bind taskbar controls
    const themeBtn = document.getElementById('theme-btn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    const langSelect = document.getElementById('lang-select');
    if (langSelect) langSelect.addEventListener('change', e => switchLanguage(e.target.value));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootApp, { once: true });
} else {
    bootApp();
}
