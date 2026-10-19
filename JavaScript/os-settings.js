/* SETTINGS — Settings panel + Portable profile UI (split from os.js). */

/* ────────────────────────────────
 * § SETTINGS APP
 * Full settings panel with categories: Appearance, Performance,
 * Clock, Language, Sound, Reset, About. Each category has its
 * own page with toggles, sliders, and selectors.
 * All preferences persist in localStorage with 'aruta_' prefix.
 * ──────────────────────────────── */
function initSettings() {
    // Sidebar category navigation
    document.querySelectorAll('.settings-cat').forEach(cat => {
        cat.addEventListener('click', () => {
            document.querySelectorAll('.settings-cat').forEach(c => c.classList.remove('active'));
            cat.classList.add('active');
            const page = cat.dataset.cat;
            document.querySelectorAll('.settings-page').forEach(p => p.classList.remove('active'));
            const target = document.querySelector(`.settings-page[data-page="${page}"]`);
            if (target) target.classList.add('active');
            if (page === 'permissions' && window.permissions) window.permissions.renderSettings();
            if (page === 'widgets' && window.widgets) window.widgets.renderSettings();
        });
    });

    // Install button on permissions tab
    const installBtn = document.getElementById('settings-install-pkg');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            await window.installer?.installPrompt();
            window.permissions?.renderSettings();
        });
    }

    // Theme toggle
    const themeToggle = document.getElementById('settings-theme-toggle');
    if (themeToggle) {
        if (currentTheme === 'dark') themeToggle.classList.remove('active');
        else themeToggle.classList.add('active');
        themeToggle.addEventListener('click', () => {
            toggleTheme();
            themeToggle.classList.toggle('active');
        });
    }

    // Follow-OS toggle — when on, theme tracks prefers-color-scheme live.
    // Defaults to true; manual theme toggles flip this off via toggleTheme().
    const followToggle = document.getElementById('settings-theme-follow-toggle');
    if (followToggle) {
        const isOn = localStorage.getItem('aruta_theme_follow_os') !== 'false';
        followToggle.classList.toggle('active', isOn);
        followToggle.addEventListener('click', () => {
            const nowOn = !followToggle.classList.contains('active');
            localStorage.setItem('aruta_theme_follow_os', nowOn ? 'true' : 'false');
            followToggle.classList.toggle('active', nowOn);
            if (nowOn) {
                const osPref = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
                if (osPref !== window.currentTheme) toggleTheme({ keepFollowOS: true });
            }
        });
    }

    // Font family preset
    const FONTS = {
        default:  { body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: "'Cinzel', Georgia, serif" },
        medieval: { body: "'IM Fell English', Georgia, serif", display: "'IM Fell English', Georgia, serif" },
        modern:   { body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", display: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" },
        serif:    { body: "Georgia, 'Times New Roman', serif", display: "Georgia, 'Times New Roman', serif" },
        mono:     { body: "'Courier New', Consolas, monospace", display: "'Courier New', Consolas, monospace" },
        nordic:   { body: "'Cinzel', Georgia, serif", display: "'Cinzel', Georgia, serif" },
    };
    function applyFont(id) {
        const f = FONTS[id] || FONTS.default;
        document.documentElement.style.setProperty('--font-body', f.body);
        document.documentElement.style.setProperty('--font-display', f.display);
    }
    const fontSel = document.getElementById('settings-font');
    if (fontSel) {
        const saved = localStorage.getItem('aruta_font') || 'default';
        fontSel.value = FONTS[saved] ? saved : 'default';
        applyFont(fontSel.value);
        fontSel.addEventListener('change', () => {
            applyFont(fontSel.value);
            localStorage.setItem('aruta_font', fontSel.value);
        });
    }

    // Font size slider
    const fontRange = document.getElementById('settings-font-size');
    const fontLabel = document.getElementById('font-size-label');
    if (fontRange) {
        const saved = localStorage.getItem('aruta_fontsize') || '100';
        fontRange.value = saved;
        if (fontLabel) fontLabel.textContent = saved + '%';
        document.documentElement.style.fontSize = saved + '%';
        fontRange.addEventListener('input', () => {
            const val = fontRange.value;
            document.documentElement.style.fontSize = val + '%';
            if (fontLabel) fontLabel.textContent = val + '%';
            localStorage.setItem('aruta_fontsize', val);
        });
    }

    // Accent color buttons
    // ACCENTS / lightenHex / applyAccent live at module scope (§ THEME
    // TWEAKS below) so restoreThemeTweaks() can re-apply them at boot.
    const customPicker = document.getElementById('settings-accent-custom');
    const customBtn = document.querySelector('.settings-color-btn[data-accent="custom"]');

    document.querySelectorAll('.settings-color-btn').forEach(btn => {
        // Preset buttons: click = select. Custom button: the <input type="color">
        // inside handles the interaction; we only update "active" after it changes.
        if (btn.dataset.accent === 'custom') return;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.settings-color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const colors = ACCENTS[btn.dataset.accent];
            if (colors) {
                applyAccent(colors.gold, colors.goldLight);
                localStorage.setItem('aruta_accent', btn.dataset.accent);
            }
        });
    });

    if (customPicker && customBtn) {
        const onCustomPick = () => {
            const hex = customPicker.value;
            const light = lightenHex(hex, 0.4);
            applyAccent(hex, light);
            localStorage.setItem('aruta_accent', 'custom');
            localStorage.setItem('aruta_accent_custom', hex);
            document.querySelectorAll('.settings-color-btn').forEach(b => b.classList.remove('active'));
            customBtn.classList.add('active');
            customBtn.style.setProperty('--custom-color', hex);
        };
        customPicker.addEventListener('input', onCustomPick);
        customPicker.addEventListener('change', onCustomPick);
    }

    // Restore saved accent
    const savedAccent = localStorage.getItem('aruta_accent');
    if (savedAccent === 'custom') {
        const hex = localStorage.getItem('aruta_accent_custom') || '#ffc857';
        if (customPicker) customPicker.value = hex;
        applyAccent(hex, lightenHex(hex, 0.4));
        document.querySelectorAll('.settings-color-btn').forEach(b => b.classList.remove('active'));
        if (customBtn) {
            customBtn.classList.add('active');
            customBtn.style.setProperty('--custom-color', hex);
        }
    } else if (savedAccent) {
        const btn = document.querySelector(`.settings-color-btn[data-accent="${savedAccent}"]`);
        if (btn) btn.click();
    }

    // ── Magic (secondary) color — mirrors the accent picker ──
    const magicPicker = document.getElementById('settings-magic-custom');
    const magicBtns = document.querySelectorAll('#settings-magic .settings-color-btn');
    const magicCustomBtn = document.querySelector('#settings-magic .settings-color-btn[data-magic="custom"]');
    function syncMagicUI(name, hex) {
        magicBtns.forEach(b => b.classList.toggle('active', b.dataset.magic === name));
        if (name === 'custom' && magicCustomBtn && hex) magicCustomBtn.style.setProperty('--custom-color', hex);
    }
    magicBtns.forEach(btn => {
        if (btn.dataset.magic === 'custom') return;
        btn.addEventListener('click', () => {
            applyMagic(MAGIC_PRESETS[btn.dataset.magic]);
            localStorage.setItem('aruta_magic', btn.dataset.magic);
            syncMagicUI(btn.dataset.magic);
        });
    });
    if (magicPicker) {
        const onMagicPick = () => {
            applyMagic(magicPicker.value);
            localStorage.setItem('aruta_magic', 'custom');
            localStorage.setItem('aruta_magic_custom', magicPicker.value);
            syncMagicUI('custom', magicPicker.value);
        };
        magicPicker.addEventListener('input', onMagicPick);
        magicPicker.addEventListener('change', onMagicPick);
    }
    {   // Restore UI state only — the colors were applied at boot.
        const m = localStorage.getItem('aruta_magic');
        if (m === 'custom') {
            const hex = localStorage.getItem('aruta_magic_custom') || MAGIC_PRESETS.purple;
            if (magicPicker) magicPicker.value = hex;
            syncMagicUI('custom', hex);
        } else if (m && MAGIC_PRESETS[m]) syncMagicUI(m);
    }

    // ── Border color (auto = follows accent) + intensity ──
    const borderPicker = document.getElementById('settings-border-custom');
    const borderAutoBtn = document.getElementById('settings-border-auto');
    const borderCustomBtn = document.querySelector('.settings-color-btn[data-border="custom"]');
    if (borderPicker) {
        const onBorderPick = () => {
            applyBorderTint(borderPicker.value);
            localStorage.setItem('aruta_border_custom', borderPicker.value);
            if (borderCustomBtn) {
                borderCustomBtn.classList.add('active');
                borderCustomBtn.style.setProperty('--custom-color', borderPicker.value);
            }
        };
        borderPicker.addEventListener('input', onBorderPick);
        borderPicker.addEventListener('change', onBorderPick);
    }
    if (borderAutoBtn) {
        borderAutoBtn.addEventListener('click', () => {
            applyBorderTint(null);
            localStorage.removeItem('aruta_border_custom');
            borderCustomBtn?.classList.remove('active');
        });
    }
    {
        const hex = localStorage.getItem('aruta_border_custom');
        if (hex && borderPicker) {
            borderPicker.value = hex;
            if (borderCustomBtn) {
                borderCustomBtn.classList.add('active');
                borderCustomBtn.style.setProperty('--custom-color', hex);
            }
        }
    }

    // ── Range rows (border intensity / glass blur / corner roundness) ──
    // Shared wiring: restore from storage, live-apply + persist on input.
    function wireRange(id, labelId, key, def, suffix, apply) {
        const range = document.getElementById(id);
        if (!range) return;
        const label = document.getElementById(labelId);
        const saved = parseInt(localStorage.getItem(key) ?? String(def), 10);
        range.value = saved;
        if (label) label.textContent = saved + suffix;
        range.addEventListener('input', () => {
            const v = parseInt(range.value, 10);
            apply(v);
            localStorage.setItem(key, v);
            if (label) label.textContent = v + suffix;
        });
    }
    wireRange('settings-border-alpha', 'border-alpha-label', 'aruta_border_alpha', 100, '%', applyBorderAlpha);
    wireRange('settings-blur', 'blur-label', 'aruta_blur', 18, 'px', applyBlur);
    wireRange('settings-radius', 'radius-label', 'aruta_radius', 100, '%', applyRadius);
    wireRange('settings-bgdim', 'bgdim-label', 'aruta_bg_dim', 0, '%', applyBgDim);

    // ── Wallpaper overlay colour (defaults to the accent) ──
    const bgdimPicker = document.getElementById('settings-bgdim-color');
    const bgdimClear = document.getElementById('settings-bgdim-color-clear');
    const bgdimBtn = document.querySelector('.settings-color-btn[data-bgdim="custom"]');
    const markBgDimColor = (hex) => {
        if (!bgdimBtn) return;
        bgdimBtn.classList.toggle('active', !!hex);
        if (hex) bgdimBtn.style.setProperty('--custom-color', hex);
        else bgdimBtn.style.removeProperty('--custom-color');
    };
    if (bgdimPicker) {
        const saved = localStorage.getItem('aruta_bg_dim_color');
        if (saved) bgdimPicker.value = saved;
        markBgDimColor(saved);
        const onPick = () => {
            applyBgDimColor(bgdimPicker.value);
            localStorage.setItem('aruta_bg_dim_color', bgdimPicker.value);
            markBgDimColor(bgdimPicker.value);
        };
        bgdimPicker.addEventListener('input', onPick);
        bgdimPicker.addEventListener('change', onPick);
    }
    if (bgdimClear) {
        bgdimClear.addEventListener('click', () => {
            applyBgDimColor(null);
            localStorage.removeItem('aruta_bg_dim_color');
            markBgDimColor(null);
        });
    }

    // ── Background tint ──
    const bgtintPicker = document.getElementById('settings-bgtint-custom');
    const bgtintClear = document.getElementById('settings-bgtint-clear');
    const bgtintBtn = document.querySelector('.settings-color-btn[data-bgtint="custom"]');
    if (bgtintPicker) {
        const onBgTintPick = () => {
            applyBgTint(bgtintPicker.value);
            localStorage.setItem('aruta_bgtint', bgtintPicker.value);
            if (bgtintBtn) {
                bgtintBtn.classList.add('active');
                bgtintBtn.style.setProperty('--custom-color', bgtintPicker.value);
            }
        };
        bgtintPicker.addEventListener('input', onBgTintPick);
        bgtintPicker.addEventListener('change', onBgTintPick);
    }
    if (bgtintClear) {
        bgtintClear.addEventListener('click', () => {
            applyBgTint(null);
            localStorage.removeItem('aruta_bgtint');
            bgtintBtn?.classList.remove('active');
        });
    }
    {
        const hex = localStorage.getItem('aruta_bgtint');
        if (hex && bgtintPicker) {
            bgtintPicker.value = hex;
            if (bgtintBtn) {
                bgtintBtn.classList.add('active');
                bgtintBtn.style.setProperty('--custom-color', hex);
            }
        }
    }

    // Show/hide date
    const dateToggle = document.getElementById('settings-show-date');
    const dateEl = document.getElementById('hud-date');
    const dateSep = document.querySelector('.hud-clock-sep');
    if (dateToggle) {
        const showDate = localStorage.getItem('aruta_showdate') !== 'false';
        dateToggle.classList.toggle('active', showDate);
        if (!showDate && dateEl) { dateEl.style.display = 'none'; if (dateSep) dateSep.style.display = 'none'; }
        dateToggle.addEventListener('click', () => {
            dateToggle.classList.toggle('active');
            const show = dateToggle.classList.contains('active');
            if (dateEl) dateEl.style.display = show ? '' : 'none';
            if (dateSep) dateSep.style.display = show ? '' : 'none';
            localStorage.setItem('aruta_showdate', show);
        });
    }

    // 24h format
    const h24Toggle = document.getElementById('settings-24h');
    if (h24Toggle) {
        const use24 = localStorage.getItem('aruta_24h') !== 'false';
        h24Toggle.classList.toggle('active', use24);
        window._use24h = use24;
        h24Toggle.addEventListener('click', () => {
            h24Toggle.classList.toggle('active');
            window._use24h = h24Toggle.classList.contains('active');
            localStorage.setItem('aruta_24h', window._use24h);
        });
    }

    // Low power mode — auto-detected, user can force on/off (explicit override)
    const lpToggle = document.getElementById('settings-low-power');
    if (lpToggle) {
        lpToggle.classList.toggle('active', !!window._lowPower);
        lpToggle.addEventListener('click', () => {
            lpToggle.classList.toggle('active');
            const on = lpToggle.classList.contains('active');
            localStorage.setItem('aruta_low_power', on ? 'on' : 'off');
            window.applyLowPower?.(on);
        });
    }

    // Auto-hide taskbar (macOS-dock style) — overlays + lets windows expand
    const autohideToggle = document.getElementById('settings-taskbar-autohide');
    if (autohideToggle) {
        const on = localStorage.getItem('aruta_taskbar_autohide') === 'true';
        autohideToggle.classList.toggle('active', on);
        if (on) window.taskbarAutohide?.enable();
        autohideToggle.addEventListener('click', () => {
            autohideToggle.classList.toggle('active');
            const en = autohideToggle.classList.contains('active');
            localStorage.setItem('aruta_taskbar_autohide', en);
            if (en) window.taskbarAutohide?.enable();
            else window.taskbarAutohide?.disable();
            window.relayoutManagedWindows?.();
        });
    }

    // Sound toggle
    const soundToggle = document.getElementById('settings-sound-toggle');
    if (soundToggle) {
        soundToggle.addEventListener('click', () => {
            soundToggle.classList.toggle('active');
            document.getElementById('sound-btn')?.click();
        });
    }

    // Language select
    const langSelect = document.getElementById('settings-lang');
    if (langSelect) {
        langSelect.value = currentLang;
        langSelect.addEventListener('change', () => {
            const mainSelect = document.getElementById('lang-select');
            if (mainSelect) {
                mainSelect.value = langSelect.value;
                mainSelect.dispatchEvent(new Event('change'));
            }
        });
    }

    initProfileSettings();
    initAppearanceCustom();

    // Reset button — clears all aruta_ settings from localStorage
    const resetBtn = document.getElementById('settings-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            localStorage.removeItem('aruta_theme');
            localStorage.removeItem('aruta_fontsize');
            localStorage.removeItem('aruta_font');
            localStorage.removeItem('aruta_accent');
            localStorage.removeItem('aruta_accent_custom');
            localStorage.removeItem('aruta_showdate');
            localStorage.removeItem('aruta_24h');
            localStorage.removeItem('aruta_taskbar_autohide');
            localStorage.removeItem('aruta_low_power');
            localStorage.removeItem('aruta_lang');
            // Theme tweaks (magic / borders / blur / roundness / bg tint)
            localStorage.removeItem('aruta_magic');
            localStorage.removeItem('aruta_magic_custom');
            localStorage.removeItem('aruta_border_custom');
            localStorage.removeItem('aruta_border_alpha');
            localStorage.removeItem('aruta_blur');
            localStorage.removeItem('aruta_radius');
            localStorage.removeItem('aruta_bgtint');
            localStorage.removeItem('aruta_bg_dim');
            localStorage.removeItem('aruta_bg_dim_color');
            applyMagic(null);
            applyBorderTint(null);
            applyBorderAlpha(100);
            applyBlur(18);
            applyRadius(100);
            applyBgTint(null);
            applyBgDim(0);
            applyBgDimColor(null);
            document.querySelector('.settings-color-btn[data-bgdim="custom"]')?.classList.remove('active');
            // Performance toggles back to defaults (apply only if overridden)
            for (const [id, config] of Object.entries(PERF_TOGGLES)) {
                localStorage.removeItem('aruta_' + id);
                const defOn = perfDefault(id, config);
                const tgl = document.getElementById(id);
                if (tgl) tgl.classList.toggle('active', defOn);
                applyPerfToggle(config, defOn);
            }
            // Disable any live widgets before wiping their state so their
            // iframes tear down cleanly; then clear the persisted positions.
            if (window.widgets?.list) {
                for (const m of window.widgets.list()) {
                    try { window.widgets.disable(m.id); } catch {}
                }
            }
            localStorage.removeItem('aruta_widgets');
            // Reset to defaults
            document.documentElement.style.fontSize = '100%';
            applyAccent('#ffc857', '#ffe4a0');
            if (currentTheme !== 'dark') toggleTheme();
            // Reset toggles UI
            if (themeToggle) themeToggle.classList.remove('active');
            if (fontRange) { fontRange.value = 100; if (fontLabel) fontLabel.textContent = '100%'; }
            if (fontSel) { fontSel.value = 'default'; applyFont('default'); }
            if (dateToggle) { dateToggle.classList.add('active'); if (dateEl) dateEl.style.display = ''; if (dateSep) dateSep.style.display = ''; }
            if (h24Toggle) { h24Toggle.classList.add('active'); window._use24h = true; }
            if (autohideToggle) { autohideToggle.classList.remove('active'); window.taskbarAutohide?.disable(); window.relayoutManagedWindows?.(); }
            window.applyLowPower?.(window.resolveLowPower?.()); if (lpToggle) lpToggle.classList.toggle('active', !!window._lowPower);
            document.querySelectorAll('.settings-color-btn').forEach(b => b.classList.remove('active'));
            const goldBtn = document.querySelector('.settings-color-btn[data-accent="gold"]');
            if (goldBtn) goldBtn.classList.add('active');
            const purpleBtn = document.querySelector('#settings-magic .settings-color-btn[data-magic="purple"]');
            if (purpleBtn) purpleBtn.classList.add('active');
            // Range rows back to their default positions
            const resetRange = (id, labelId, v, suffix) => {
                const range = document.getElementById(id);
                if (range) range.value = v;
                const label = document.getElementById(labelId);
                if (label) label.textContent = v + suffix;
            };
            resetRange('settings-border-alpha', 'border-alpha-label', 100, '%');
            resetRange('settings-blur', 'blur-label', 18, 'px');
            resetRange('settings-radius', 'radius-label', 100, '%');
            resetRange('settings-bgdim', 'bgdim-label', 0, '%');
            // Reset appearance customizations (backgrounds + rotation, portrait, name)
            window.appearance?.reset().then(refreshAppearanceUI);
            refreshAppearanceUI();
            const t = window.t();
            if (window.showToast) showToast(t.toast_reset_done || 'Settings restored to defaults', 'success');
        });
    }

    // Wipe button — clears ALL localStorage + sessionStorage and reloads
    const wipeBtn = document.getElementById('settings-wipe');
    if (wipeBtn) {
        wipeBtn.addEventListener('click', async () => {
            const t = window.t();
            const confirmMsg = t.settings_wipe_confirm || 'Delete all locally stored data and reload the page?';
            const confirmFn = window.showConfirm || ((m) => Promise.resolve(confirm(m)));
            const ok = await confirmFn(confirmMsg, { type: 'warning', okText: t.confirm_wipe || 'Wipe', cancelText: t.confirm_cancel || 'Cancel' });
            if (!ok) return;
            // Collect installed app ids BEFORE clearing storage so we can delete their per-app DBs
            let appIds = [];
            try { appIds = (window.registry?.list() || []).map(a => a.id); } catch {}
            try { localStorage.clear(); } catch (e) { console.warn('localStorage.clear failed', e); }
            try { sessionStorage.clear(); } catch (e) { console.warn('sessionStorage.clear failed', e); }
            // Delete IndexedDB: package registry + each app's private storage DB
            try {
                indexedDB.deleteDatabase('aruta_packages');
                indexedDB.deleteDatabase('aruta_appearance');
                for (const id of appIds) indexedDB.deleteDatabase('aruta_app_' + id);
            } catch (e) { console.warn('indexedDB wipe failed', e); }
            if (window.showToast) showToast(t.toast_wipe_done || 'Local data wiped. Reloading…', 'warning', 1200);
            setTimeout(() => location.reload(), 900);
        });
    }

    // Wipe settings only — keeps installed packages + permissions
    const wipeSettingsBtn = document.getElementById('settings-wipe-settings');
    if (wipeSettingsBtn) {
        wipeSettingsBtn.addEventListener('click', async () => {
            const t = window.t();
            const confirmMsg = t.settings_wipe_settings_confirm || 'Reset preferences? Installed apps, commands and their permissions will be kept.';
            const confirmFn = window.showConfirm || ((m) => Promise.resolve(confirm(m)));
            const ok = await confirmFn(confirmMsg, { type: 'warning', okText: t.confirm_wipe || 'Wipe', cancelText: t.confirm_cancel || 'Cancel' });
            if (!ok) return;
            try {
                const preserve = new Set();
                preserve.add('aruta_installed_apps');
                preserve.add('aruta_defaults_seen');
                preserve.add('aruta_defaults_uninstalled');
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('aruta_perms_')) preserve.add(k);
                }
                const toRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('aruta_') && !preserve.has(k)) toRemove.push(k);
                }
                toRemove.forEach(k => localStorage.removeItem(k));
            } catch (e) { console.warn('wipe settings failed', e); }
            try { sessionStorage.clear(); } catch {}
            if (window.showToast) showToast(t.toast_wipe_settings_done || 'Settings wiped. Reloading…', 'warning', 1200);
            setTimeout(() => location.reload(), 900);
        });
    }

    // Performance toggles — sync UI state and bind clicks. The toggle map +
    // apply logic live at module scope (PERF_TOGGLES / applyPerfToggle) so
    // restorePerfToggles() can re-apply saved choices at boot, long before
    // this lazy init runs on the first Settings open.
    for (const [id, config] of Object.entries(PERF_TOGGLES)) {
        const toggle = document.getElementById(id);
        if (!toggle) continue;

        // Restore from localStorage (def: false toggles are opt-in)
        const enabled = perfEnabled(id, config);
        toggle.classList.toggle('active', enabled);
        if (enabled !== perfBaseline(config)) applyPerfToggle(config, enabled);

        toggle.addEventListener('click', () => {
            toggle.classList.toggle('active');
            const enabled = toggle.classList.contains('active');
            localStorage.setItem('aruta_' + id, enabled);
            applyPerfToggle(config, enabled);
        });
    }
}

/* ────────────────────────────────
 * § PERFORMANCE TOGGLES
 * Visual-effect switches (Settings → Performance). Persisted as
 * 'aruta_<id>' in localStorage; def: false marks opt-in (off by default).
 * ──────────────────────────────── */
const PERF_TOGGLES = {
    'settings-particles': { selector: '#rune-bg', prop: 'display' },
    'settings-fog': { selector: '.fog-layer', prop: 'display', all: true },
    'settings-parallax': { key: '_parallaxEnabled' },
    'settings-cursor': { selector: '#magic-cursor', prop: 'display', cursorClass: true },
    'settings-clickspells': { key: '_clickSpellsEnabled' },
    'settings-circles': { key: '_circleRotationEnabled' },
    'settings-glowpulse': { bodyClass: 'glow-pulse', def: false },
    'settings-hero': { offClass: 'hide-hero' },
    'settings-bgrings': { offClass: 'hide-bg-rings' },
    'settings-intro': { key: '_introEnabled' },
};

/** State the page has with no toggle applied (markup/CSS defaults). */
function perfBaseline(config) {
    return config.def !== false;
}
/** Default for this site: SITE_CONFIG.effects can override the baseline per toggle id. */
function perfDefault(id, config) {
    const override = window.SITE_CONFIG?.effects?.[id];
    return typeof override === 'boolean' ? override : perfBaseline(config);
}
function perfEnabled(id, config) {
    const saved = localStorage.getItem('aruta_' + id);
    return saved == null ? perfDefault(id, config) : saved === 'true';
}

/**
 * Apply a performance toggle — show/hide elements, set window flags or
 * toggle a body class.
 * @param {Object} config — toggle configuration
 * @param {boolean} enabled — whether the feature is enabled
 */
function applyPerfToggle(config, enabled) {
    if (config.selector) {
        const els = config.all
            ? document.querySelectorAll(config.selector)
            : [document.querySelector(config.selector)];
        els.forEach(el => {
            if (!el) return;
            if (config.prop === 'display') el.style.display = enabled ? '' : 'none';
            else if (config.prop === 'animation') el.style.animation = enabled ? '' : 'none';
        });
    }
    if (config.key) window[config.key] = enabled;
    if (config.bodyClass) document.body.classList.toggle(config.bodyClass, enabled);
    if (config.offClass) document.body.classList.toggle(config.offClass, !enabled);
    if (config.cursorClass) {
        if (enabled) document.documentElement.classList.add('magic-cursor-active');
        else document.documentElement.classList.remove('magic-cursor-active');
    }
}

/**
 * Re-apply persisted performance toggles at page load. initSettings() is
 * lazy (runs on the first Settings open), so without this a reload would
 * silently revert every saved effect choice until Settings is opened.
 */
function restorePerfToggles() {
    for (const [id, config] of Object.entries(PERF_TOGGLES)) {
        const enabled = perfEnabled(id, config);
        if (enabled !== perfBaseline(config)) applyPerfToggle(config, enabled);
    }
}
window.restorePerfToggles = restorePerfToggles;

/* ────────────────────────────────
 * § THEME TWEAKS (Appearance)
 * Accent, magic color, borders, glass blur, roundness, background tint.
 * Apply functions live at module scope so restoreThemeTweaks() can run at
 * boot (initSettings is lazy — first Settings open); initSettings only
 * wires the controls and syncs their UI state.
 * Inline custom properties override BOTH themes by design (same behavior
 * the accent picker always had).
 * ──────────────────────────────── */
const ACCENTS = {
    gold:    { gold: '#ffc857', goldLight: '#ffe4a0' },
    purple:  { gold: '#a78bfa', goldLight: '#c4b5fd' },
    cyan:    { gold: '#22d3ee', goldLight: '#67e8f9' },
    rose:    { gold: '#fb7185', goldLight: '#fda4af' },
    emerald: { gold: '#34d399', goldLight: '#6ee7b7' },
};
const MAGIC_PRESETS = {
    purple: '#a78bfa', ice: '#67e8f9', ember: '#fb923c',
    blood: '#fb7185', fae: '#34d399',
};

// Derive a lighter variant by mixing with white (40%) — used for custom colors.
function lightenHex(hex, amount = 0.4) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substr(0, 2), 16);
    const g = parseInt(h.substr(2, 2), 16);
    const b = parseInt(h.substr(4, 2), 16);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    const toHex = (c) => c.toString(16).padStart(2, '0');
    return '#' + toHex(mix(r)) + toHex(mix(g)) + toHex(mix(b));
}

function applyAccent(gold, goldLight) {
    document.documentElement.style.setProperty('--gold', gold);
    document.documentElement.style.setProperty('--gold-light', goldLight);
    // Rune canvas proximity glow + cursor trail follow the accent
    // (#ffc857 is the built-in default ramp — pass null to restore it).
    window.setRuneTint?.('accent', gold === '#ffc857' ? null : gold);
}

// Magic (secondary) color: magic circle, rings, fog/orb tints, terminal
// accents — everything reading --purple/--mc-color/--bg-ring-col.
// Passing null or the default purple removes the overrides so the
// per-theme CSS values take over again.
function applyMagic(hex) {
    const s = document.documentElement.style;
    if (hex && hex !== MAGIC_PRESETS.purple) {
        s.setProperty('--purple', hex);
        s.setProperty('--mc-color', hex);
        s.setProperty('--bg-ring-col', hex);
        window.setRuneTint?.('magic', hex);
    } else {
        s.removeProperty('--purple');
        s.removeProperty('--mc-color');
        s.removeProperty('--bg-ring-col');
        window.setRuneTint?.('magic', null);
    }
}

// Borders: null = auto (–-border-tint falls back to the accent).
function applyBorderTint(hex) {
    const s = document.documentElement.style;
    if (hex) s.setProperty('--border-tint', hex);
    else s.removeProperty('--border-tint');
}
function applyBorderAlpha(pct) {
    const s = document.documentElement.style;
    if (pct && pct !== 100) s.setProperty('--border-alpha', pct / 100);
    else s.removeProperty('--border-alpha');
}
function applyBlur(px) {
    const s = document.documentElement.style;
    if (px != null && px !== 18) s.setProperty('--blur-glass', px + 'px');
    else s.removeProperty('--blur-glass');
}
function applyRadius(pct) {
    const s = document.documentElement.style;
    if (pct != null && pct !== 100) s.setProperty('--radius-scale', pct / 100);
    else s.removeProperty('--radius-scale');
}
// Background tint: gradient composed against --bg-base/--bg-core so it
// stays theme-aware when dark/light switches.
function applyBgTint(hex) {
    const s = document.documentElement.style;
    if (hex) {
        s.setProperty('--bg', `color-mix(in srgb, ${hex} 22%, var(--bg-base))`);
        s.setProperty('--bg-grad',
            `radial-gradient(ellipse at 50% 40%, color-mix(in srgb, ${hex} 40%, var(--bg-core)) 0%, color-mix(in srgb, ${hex} 22%, var(--bg-base)) 65%)`);
    } else {
        s.removeProperty('--bg');
        s.removeProperty('--bg-grad');
    }
}

// Wallpaper overlay: opacity (0–90%) and colour of #user-bg-layer::after.
// No colour override = follow the accent (--gold).
function applyBgDim(pct) {
    const s = document.documentElement.style;
    if (pct > 0) s.setProperty('--bg-dim', Math.min(90, pct) / 100);
    else s.removeProperty('--bg-dim');
}
function applyBgDimColor(hex) {
    const s = document.documentElement.style;
    if (hex) s.setProperty('--bg-dim-color', hex);
    else s.removeProperty('--bg-dim-color');
}

/**
 * Re-apply every persisted Appearance tweak at page load — including the
 * accent, whose restore used to live only in the lazy initSettings(), so
 * a reload reverted it until the Settings window was opened.
 */
function restoreThemeTweaks() {
    const accent = localStorage.getItem('aruta_accent');
    if (accent === 'custom') {
        const hex = localStorage.getItem('aruta_accent_custom') || '#ffc857';
        applyAccent(hex, lightenHex(hex, 0.4));
    } else if (accent && ACCENTS[accent]) {
        applyAccent(ACCENTS[accent].gold, ACCENTS[accent].goldLight);
    }
    const magic = localStorage.getItem('aruta_magic');
    if (magic === 'custom') applyMagic(localStorage.getItem('aruta_magic_custom') || MAGIC_PRESETS.purple);
    else if (magic && MAGIC_PRESETS[magic]) applyMagic(MAGIC_PRESETS[magic]);
    applyBorderTint(localStorage.getItem('aruta_border_custom') || null);
    applyBorderAlpha(parseInt(localStorage.getItem('aruta_border_alpha') ?? '100', 10));
    applyBlur(parseInt(localStorage.getItem('aruta_blur') ?? '18', 10));
    applyRadius(parseInt(localStorage.getItem('aruta_radius') ?? '100', 10));
    applyBgTint(localStorage.getItem('aruta_bgtint') || null);
    applyBgDim(parseInt(localStorage.getItem('aruta_bg_dim') ?? '0', 10));
    applyBgDimColor(localStorage.getItem('aruta_bg_dim_color') || null);
}
window.restoreThemeTweaks = restoreThemeTweaks;


/* ────────────────────────────────
 * § PROFILE — Portable profile (link folder / export / import)
 * ──────────────────────────────── */
function initProfileSettings() {
    if (!window.profile) return;
    const statusEl   = document.getElementById('settings-profile-status');
    const pickBtn    = document.getElementById('settings-profile-pick');
    const reconnBtn  = document.getElementById('settings-profile-reconnect');
    const unlinkBtn  = document.getElementById('settings-profile-unlink');
    const exportBtn  = document.getElementById('settings-profile-export');
    const importBtn  = document.getElementById('settings-profile-import');
    const importFile = document.getElementById('settings-profile-import-file');
    if (!pickBtn || !exportBtn || !importBtn) return;

    const hasFSAPI = !!(window.showDirectoryPicker);

    async function refreshStatus() {
        const t = window.t();
        const hasHandle = await window.profile.hasHandle();
        const linked    = window.profile.isLinked();
        const disc      = window.profile.isDisconnected();
        const name      = window.profile.linkedName();

        if (!hasFSAPI) {
            pickBtn.style.display = 'none';
            reconnBtn.style.display = 'none';
            unlinkBtn.style.display = 'none';
            if (statusEl) statusEl.textContent = t.settings_profile_zip_only || 'Use Export/Import .zip (folder sync requires Chromium).';
            return;
        }

        if (linked && name) {
            pickBtn.textContent = (t.settings_profile_change || 'Change folder…');
            reconnBtn.style.display = 'none';
            unlinkBtn.style.display = '';
            if (statusEl) statusEl.textContent = (t.settings_profile_linked || 'Linked:') + ' ' + name;
        } else if (hasHandle && disc) {
            pickBtn.textContent = (t.settings_profile_pick || 'Pick folder…');
            reconnBtn.style.display = '';
            unlinkBtn.style.display = '';
            if (statusEl) statusEl.textContent = (t.settings_profile_disconnected || 'Disconnected — reconnect to resume sync.') + (name ? ' (' + name + ')' : '');
        } else {
            pickBtn.textContent = (t.settings_profile_pick || 'Pick folder…');
            reconnBtn.style.display = 'none';
            unlinkBtn.style.display = 'none';
            if (statusEl) statusEl.textContent = t.settings_profile_not_linked || 'Not linked';
        }
    }

    pickBtn.addEventListener('click', async () => {
        const t = window.t();
        if (!hasFSAPI) {
            showToast(t.settings_profile_zip_only || 'Folder linking requires Chromium — use Export/Import.', 'warning');
            return;
        }
        let handle;
        try {
            handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch { return; /* user cancelled */ }

        // Peek: does the folder already hold a profile?
        let existingMeta = null;
        try {
            // Minimal read probe via a transient DiskBackend (we reuse profile internals).
            const probe = new (class {
                constructor(h){ this.handle = h; }
                async read() {
                    try {
                        const fh = await this.handle.getFileHandle('profile.json', { create: false });
                        const f  = await fh.getFile();
                        return JSON.parse(await f.text());
                    } catch { return null; }
                }
            })(handle);
            existingMeta = await probe.read();
        } catch {}

        if (existingMeta) {
            // Fingerprint comparison: if the browser's current snapshot was
            // updated more recently than the folder's profile.json, surface a
            // 3-way conflict modal so the user doesn't silently clobber fresh
            // local changes. If folder is newer (or timestamps are
            // missing/equal) we keep the legacy 2-choice flow.
            let browserUpdatedAt = null;
            try { browserUpdatedAt = (await window.profile.snapshot())?.updatedAt || null; } catch {}
            const folderUpdatedAt = existingMeta.updatedAt || null;
            const browserNewer = browserUpdatedAt && folderUpdatedAt &&
                new Date(browserUpdatedAt).getTime() > new Date(folderUpdatedAt).getTime();

            const confirmFn = window.showConfirm || ((m) => Promise.resolve(confirm(m)));
            let loadFromFolder; // true = load, false = overwrite folder, null = cancel
            if (browserNewer) {
                // Chain two confirms to emulate a 3-button modal (Keep Local /
                // Keep Folder / Cancel) without changing showConfirm's shape.
                const keepLocal = await confirmFn(
                    (t.settings_profile_conflict_msg ||
                        'Conflict: this browser has NEWER data than the folder.') +
                    '\n\nBrowser: ' + (browserUpdatedAt || '—') +
                    '\nFolder:  ' + (folderUpdatedAt || '—') +
                    '\n\nKeep LOCAL (overwrite folder with browser state)?',
                    {
                        type: 'warning',
                        okText: t.settings_profile_keep_local || 'Keep Local',
                        cancelText: t.settings_profile_choose_other || 'Choose other…',
                    });
                if (keepLocal) {
                    loadFromFolder = false;
                } else {
                    const keepFolder = await confirmFn(
                        (t.settings_profile_conflict_keep_folder ||
                            'Keep FOLDER (overwrite browser with folder contents)?') +
                        '\n\nCancel to abort linking.',
                        {
                            type: 'warning',
                            okText: t.settings_profile_keep_folder || 'Keep Folder',
                            cancelText: t.confirm_cancel || 'Cancel',
                        });
                    loadFromFolder = keepFolder ? true : null;
                }
            } else {
                const msg = (t.settings_profile_found_msg || 'This folder already contains a profile.')
                    + (existingMeta.updatedAt ? ' (' + existingMeta.updatedAt + ')' : '')
                    + '\n\n' + (t.settings_profile_found_prompt || 'Load profile FROM the folder (overwrites browser state), or overwrite the folder WITH current browser state?');
                loadFromFolder = await confirmFn(msg, {
                    type: 'warning',
                    okText: t.settings_profile_load_from_folder || 'Load from folder',
                    cancelText: t.settings_profile_overwrite_folder || 'Overwrite folder',
                });
            }
            if (loadFromFolder === null) {
                // User cancelled the conflict dialog — do not link.
                showToast(t.settings_profile_link_cancelled || 'Link cancelled.', 'info');
                return;
            }
            try {
                if (loadFromFolder) {
                    // Link without overwriting, then read folder and restore (which reloads).
                    await window.profile.link(handle, { overwriteFolder: false });
                    showToast(t.settings_profile_linked_toast || 'Profile linked — loading from folder…', 'success');
                    // Trigger a full read+restore path by calling reconnect-equivalent:
                    const snap = await window.profile.__readLinkedFolder?.();
                    if (snap) { await window.profile.restore(snap); location.reload(); }
                    else {
                        // Fallback: reload and let tryRestoreFromHandle handle it.
                        location.reload();
                    }
                } else {
                    await window.profile.link(handle, { overwriteFolder: true });
                    showToast(t.settings_profile_linked_toast || 'Profile linked — folder written.', 'success');
                    refreshStatus();
                }
            } catch (e) {
                console.warn(e);
                showToast((t.settings_profile_link_failed || 'Link failed:') + ' ' + (e.message || e), 'error');
            }
            return;
        }

        // Fresh folder: just link and write.
        try {
            await window.profile.link(handle, { overwriteFolder: true });
            showToast(t.settings_profile_linked_toast || 'Profile linked — folder written.', 'success');
        } catch (e) {
            console.warn(e);
            showToast((t.settings_profile_link_failed || 'Link failed:') + ' ' + (e.message || e), 'error');
        }
        refreshStatus();
    });

    reconnBtn?.addEventListener('click', async () => {
        const t = window.t();
        const ok = await window.profile.reconnect();
        if (ok) showToast(t.settings_profile_reconnected || 'Profile reconnected.', 'success');
        else showToast(t.settings_profile_reconnect_failed || 'Reconnect denied.', 'warning');
        refreshStatus();
    });

    unlinkBtn?.addEventListener('click', async () => {
        const t = window.t();
        const confirmFn = window.showConfirm || ((m) => Promise.resolve(confirm(m)));
        const ok = await confirmFn(t.settings_profile_unlink_confirm || 'Unlink folder? Your local browser data is kept; only the sync connection is dropped.', {
            type: 'warning',
            okText: t.settings_profile_unlink || 'Unlink',
            cancelText: t.confirm_cancel || 'Cancel',
        });
        if (!ok) return;
        await window.profile.unlink();
        showToast(t.settings_profile_unlinked || 'Profile unlinked.', 'info');
        refreshStatus();
    });

    exportBtn.addEventListener('click', async () => {
        const t = window.t();
        try {
            await window.profile.exportZip();
            showToast(t.settings_profile_exported || 'Profile exported.', 'success');
        } catch (e) {
            console.warn(e);
            showToast((t.settings_profile_export_failed || 'Export failed:') + ' ' + (e.message || e), 'error');
        }
    });

    importBtn.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', async (e) => {
        const t = window.t();
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const confirmFn = window.showConfirm || ((m) => Promise.resolve(confirm(m)));
        const ok = await confirmFn(t.settings_profile_import_confirm || 'Importing will REPLACE all current settings, apps, and app data. Continue?', {
            type: 'warning',
            okText: t.settings_profile_import_btn || 'Import',
            cancelText: t.confirm_cancel || 'Cancel',
        });
        if (!ok) return;
        try {
            showToast(t.settings_profile_importing || 'Importing profile…', 'info', 1500);
            await window.profile.importZip(file);
            // importZip reloads on success.
        } catch (err) {
            console.warn(err);
            showToast((t.settings_profile_import_failed || 'Import failed:') + ' ' + (err.message || err), 'error');
        }
    });

    refreshStatus();
    // Expose so the global i18n:changed listener can re-render status/button
    // labels when the user switches language. Registered at file bottom.
    window.__arutaProfileRefresh = refreshStatus;
}


/* ────────────────────────────────
 * § APPEARANCE CUSTOM — Background / Portrait / Display name
 * Inputs live in the Appearance panel; persistence is handled by
 * window.appearance (IDB `aruta_appearance` + LS `aruta_appearance_meta`).
 * ──────────────────────────────── */
function refreshAppearanceUI() {
    if (!window.appearance) return;
    const t = (window.t && window.t()) || {};
    const dflt = t.settings_status_default || 'Default';
    const state = window.appearance.get();
    const bgStatus = document.getElementById('settings-bg-status');
    const portraitStatus = document.getElementById('settings-portrait-status');
    const nameInput = document.getElementById('settings-name-input');
    const bgs = state.backgrounds || [];
    const count = (t.settings_bg_count || '{n} in rotation').replace('{n}', bgs.length);
    // No backgrounds: "Default" means the stock gradient, unless the site's own defaults were removed.
    if (bgStatus) bgStatus.textContent = !bgs.length
        ? (state.defaultBackgrounds ? (t.settings_bg_none || 'None') : dflt)
        : state.usingDefaultBackgrounds ? dflt + ' · ' + count : count;
    const bgDefaults = document.getElementById('settings-bg-defaults');
    // Only offered when the site ships defaults and the user has diverged from them.
    if (bgDefaults) bgDefaults.hidden = !state.defaultBackgrounds || state.usingDefaultBackgrounds;
    renderBackgroundList(bgs, state.rotation.mode);
    const modeSel = document.getElementById('settings-bg-mode');
    const intervalInput = document.getElementById('settings-bg-interval');
    if (modeSel) modeSel.value = state.rotation.mode;
    // The interval also cycles items that share a phase, so it stays visible in time mode.
    if (intervalInput && document.activeElement !== intervalInput) intervalInput.value = state.rotation.intervalMin;
    if (portraitStatus) portraitStatus.textContent = state.portrait
        ? (state.portrait.filename || 'Image')
        : dflt;
    if (nameInput) nameInput.value = state.name || '';
}

/** One row per user background: filename, phase picker (time mode), remove button. */
function renderBackgroundList(bgs, mode) {
    const list = document.getElementById('settings-bg-list');
    if (!list) return;
    const t = (window.t && window.t()) || {};
    list.innerHTML = '';
    list.hidden = !bgs.length;
    const slotLabels = {
        '':     t.settings_bg_slot_any    || 'Any time',
        dawn:   t.settings_bg_slot_dawn   || 'Dawn (5–11)',
        noon:   t.settings_bg_slot_noon   || 'Noon (11–16)',
        sunset: t.settings_bg_slot_sunset || 'Sunset (16–20)',
        night:  t.settings_bg_slot_night  || 'Night (20–5)',
    };
    for (const bg of bgs) {
        const li = document.createElement('li');
        li.className = 'settings-bg-item';

        const icon = document.createElement('span');
        icon.textContent = bg.kind === 'video' ? '🎞' : '🖼';
        icon.setAttribute('aria-hidden', 'true');

        const name = document.createElement('span');
        name.className = 'settings-bg-item-name';
        name.textContent = bg.filename || (bg.kind === 'video' ? 'Video' : 'Image');
        name.title = name.textContent;

        li.append(icon, name);
        if (bg.src) {
            const tag = document.createElement('span');
            tag.className = 'settings-bg-item-tag';
            tag.textContent = t.settings_bg_default_tag || 'default';
            li.appendChild(tag);
        }

        if (mode === 'time') {
            const sel = document.createElement('select');
            sel.className = 'settings-select';
            sel.setAttribute('aria-label', t.settings_bg_slot || 'Time of day');
            for (const [value, label] of Object.entries(slotLabels)) {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = label;
                sel.appendChild(opt);
            }
            sel.value = bg.slot || '';
            sel.addEventListener('change', () => window.appearance.setBackgroundSlot(bg.id, sel.value || null));
            li.appendChild(sel);
        }

        const remove = document.createElement('button');
        remove.className = 'settings-reset-btn';
        remove.textContent = '✕';
        remove.title = t.settings_bg_remove || 'Remove';
        remove.setAttribute('aria-label', remove.title + ': ' + name.textContent);
        remove.addEventListener('click', async () => {
            await window.appearance.removeBackground(bg.id);
            refreshAppearanceUI();
        });
        li.appendChild(remove);

        list.appendChild(li);
    }
}

function initAppearanceCustom() {
    if (!window.appearance) return;

    const bgPick    = document.getElementById('settings-bg-pick');
    const bgClear   = document.getElementById('settings-bg-clear');
    const bgFile    = document.getElementById('settings-bg-file');
    const portraitPick  = document.getElementById('settings-portrait-pick');
    const portraitClear = document.getElementById('settings-portrait-clear');
    const portraitFile  = document.getElementById('settings-portrait-file');
    const nameInput = document.getElementById('settings-name-input');
    const nameClear = document.getElementById('settings-name-clear');

    function toastFor(res) {
        if (res?.ok) return;
        const t = (window.t && window.t()) || {};
        if (res?.reason === 'too_big') {
            const mb = Math.round((res.cap || 0) / (1024 * 1024));
            window.showToast?.((t.toast_appearance_too_big || 'File too large — max ') + mb + ' MB', 'warning');
        } else if (res?.reason === 'bad_type') {
            window.showToast?.(t.toast_appearance_bad_type || 'Unsupported file type', 'warning');
        } else if (res?.reason === 'image_only') {
            window.showToast?.(t.toast_appearance_image_only || 'Portrait must be an image', 'warning');
        } else {
            window.showToast?.(t.toast_appearance_failed || 'Could not apply file', 'error');
        }
    }

    if (bgPick && bgFile) {
        bgPick.addEventListener('click', () => bgFile.click());
        bgFile.addEventListener('change', async () => {
            const files = Array.from(bgFile.files || []);
            bgFile.value = '';
            if (!files.length) return;
            const res = await window.appearance.addBackgrounds(files);
            toastFor(res);
            refreshAppearanceUI();
        });
    }
    if (bgClear) {
        bgClear.addEventListener('click', async () => {
            await window.appearance.clearBackgrounds();
            refreshAppearanceUI();
        });
    }
    const bgDefaults = document.getElementById('settings-bg-defaults');
    if (bgDefaults) {
        bgDefaults.addEventListener('click', async () => {
            await window.appearance.restoreDefaultBackgrounds();
            refreshAppearanceUI();
        });
    }

    const bgMode = document.getElementById('settings-bg-mode');
    const bgInterval = document.getElementById('settings-bg-interval');
    if (bgMode) {
        bgMode.addEventListener('change', () => {
            window.appearance.setRotation({ mode: bgMode.value });
            refreshAppearanceUI();
        });
    }
    if (bgInterval) {
        bgInterval.addEventListener('change', () => {
            const n = parseFloat(bgInterval.value);
            if (!(n > 0)) { refreshAppearanceUI(); return; }
            window.appearance.setRotation({ intervalMin: n });
            refreshAppearanceUI();
        });
    }

    if (portraitPick && portraitFile) {
        portraitPick.addEventListener('click', () => portraitFile.click());
        portraitFile.addEventListener('change', async () => {
            const f = portraitFile.files?.[0];
            portraitFile.value = '';
            if (!f) return;
            const res = await window.appearance.setPortrait(f);
            toastFor(res);
            refreshAppearanceUI();
        });
    }
    if (portraitClear) {
        portraitClear.addEventListener('click', async () => {
            await window.appearance.setPortrait(null);
            refreshAppearanceUI();
        });
    }

    if (nameInput) {
        let debounce = null;
        nameInput.addEventListener('input', () => {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => {
                window.appearance.setName(nameInput.value);
            }, 200);
        });
    }
    if (nameClear && nameInput) {
        nameClear.addEventListener('click', () => {
            nameInput.value = '';
            window.appearance.setName(null);
        });
    }

    refreshAppearanceUI();
}

// Re-render every dynamically-written label in the Settings panel when the
// active language changes. Pure data-i18n elements are handled by
// core.js:applyTranslations; this covers text written imperatively by JS
// (profile status, background/portrait status, permissions + widgets lists).
document.addEventListener('i18n:changed', () => {
    try { refreshAppearanceUI(); } catch (_) {}
    try { window.__arutaProfileRefresh?.(); } catch (_) {}
    try { window.permissions?.renderSettings?.(); } catch (_) {}
    try { window.widgets?.renderSettings?.(); } catch (_) {}
});
