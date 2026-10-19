/* ╔══════════════════════════════════════════════════════════╗
 * ║  OS — Shell: start menu, sections, clock, tab title,     ║
 * ║       typewriter. Window manager, settings, sysinfo and  ║
 * ║       profile UI live in sibling files:                  ║
 * ║         os-windows.js   — window manager / tabs / drag   ║
 * ║         os-settings.js  — settings panel + profile UI    ║
 * ║         os-sysinfo.js   — system info popover            ║
 * ║       Load order in index.html: os-windows → os →        ║
 * ║       os-settings → os-sysinfo (settings/sysinfo call    ║
 * ║       into os-windows; os.js itself only needs it for    ║
 * ║       openWindow/closeWindow references in start menu).  ║
 * ╚══════════════════════════════════════════════════════════╝ */

/* ────────────────────────────────
 * § START MENU
 * Toggle-able menu anchored to the taskbar start button.
 * Opens windows via .start-item clicks and closes on outside
 * click or Escape key.
 * ──────────────────────────────── */
function initStartMenu() {
    const btn = document.getElementById('start-btn');
    const menu = document.getElementById('start-menu');
    if (!btn || !menu) return;

    let isOpen = false;

    function toggleMenu() {
        if (isOpen) {
            menu.style.animation = 'startMenuClose 0.2s ease forwards';
            btn.classList.remove('start-open');
            setTimeout(() => { menu.style.display = 'none'; menu.style.animation = ''; }, 200);
            isOpen = false;
        } else {
            menu.style.display = 'block';
            menu.style.animation = 'startMenuOpen 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
            btn.classList.add('start-open');
            isOpen = true;
        }
    }

    function closeMenu() {
        if (!isOpen) return;
        toggleMenu();
    }

    btn.addEventListener('click', toggleMenu);

    // Start menu items → open window + close menu
    menu.querySelectorAll('.start-item').forEach(item => {
        item.addEventListener('click', () => {
            openWindow(item.dataset.window);
            closeMenu();
        });
    });

    // Share in start menu — close menu on click (share logic in extras.js)
    const shareBtn = document.getElementById('start-share');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => closeMenu());
    }

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        // Ignore clicks that are consumed by a floating context menu (the
        // user is interacting with a right-click menu — don't collapse the
        // start menu underneath).
        if (e.target.closest && e.target.closest('.ctx-menu')) return;
        if (isOpen && !menu.contains(e.target) && !btn.contains(e.target)) {
            closeMenu();
        }
    });

    // Right-click on a start item → per-app menu (Open / About / Uninstall)
    menu.addEventListener('contextmenu', async (e) => {
        const row = e.target.closest('.start-item');
        if (!row || !menu.contains(row)) return;
        e.preventDefault();
        const id = row.dataset.window || '';
        const manifest = window.registry?.getManifest?.(id);
        const isBuiltin = !manifest || manifest._origin === 'default' || ['home','about','live','links','terminal','settings'].includes(id);

        const items = [
            { id: 'open',      label: 'Open',      icon: '↗' },
            { id: 'about',     label: 'About',     icon: 'ⓘ' },
        ];
        if (!isBuiltin) items.push({ separator: true }, { id: 'uninstall', label: 'Uninstall', icon: '🗑', danger: true });

        const choice = await window.contextMenu.show({ x: e.clientX, y: e.clientY, items });
        if (choice === 'open') { openWindow(id); closeMenu(); }
        else if (choice === 'about') {
            const m = manifest || { id, name: row.textContent.trim(), version: '—' };
            const v = m.version ? ' v' + m.version : '';
            window.showToast?.((m.name || m.id) + v + ' — ' + (m.id || ''), 'info', 3000);
        }
        else if (choice === 'uninstall') {
            const confirmFn = window.showConfirm || ((msg) => Promise.resolve(confirm(msg)));
            const ok = await confirmFn('Uninstall "' + (manifest?.name || id) + '"?', { type: 'warning' });
            if (!ok) return;
            try { await window.registry?.uninstall(id); window.showToast?.('Uninstalled', 'success'); }
            catch (err) { window.showToast?.('Uninstall failed: ' + (err.message || err), 'error'); }
        }
    });

    // Close menu on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) closeMenu();
    });
}

/* ────────────────────────────────
 * § DESKTOP CONTEXT MENU
 * Right-click on the empty desktop background → Appearance,
 * Open Files, Refresh. Skips clicks on windows / taskbar /
 * menus / the magic portrait (they have their own behavior).
 * ──────────────────────────────── */
function initDesktopContextMenu() {
    // Site-wide: suppress the browser's native right-click menu so only
    // aruta.sh's own menus show. Keep the native menu on editable fields
    // (input, textarea, contenteditable) so copy / paste / undo still work.
    document.addEventListener('contextmenu', (e) => {
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
        e.preventDefault();
    });

    const desktop = document.getElementById('desktop');
    if (!desktop || !window.contextMenu) return;
    desktop.addEventListener('contextmenu', async (e) => {
        // Bail if the event target is inside something interactive.
        const skipSel = '.os-window, .taskbar, .start-menu, .portrait-img-wrap, .magic-circle-frame, .ctx-menu, input, textarea, [contenteditable="true"]';
        if (e.target.closest && e.target.closest(skipSel)) return;
        e.preventDefault();
        const choice = await window.contextMenu.show({
            x: e.clientX, y: e.clientY,
            items: [
                { id: 'appearance', label: 'Appearance settings', icon: '🎨' },
                { id: 'files',      label: 'Open Files',          icon: '📁' },
                { separator: true },
                { id: 'refresh',    label: 'Refresh',             icon: '⟳' },
            ],
        });
        if (choice === 'appearance') {
            openWindow('settings');
            // Defer: the settings panel exists after openWindow.
            setTimeout(() => {
                const btn = document.querySelector('.settings-cat[data-cat="appearance"]');
                btn?.click();
            }, 60);
        } else if (choice === 'files') {
            openWindow('filemanager');
        } else if (choice === 'refresh') {
            location.reload();
        }
    });
}

/* ────────────────────────────────
 * § SECTION SWITCHING
 * Mobile swipe navigation between open windows.
 * Swipe left/right to switch focus between open windows.
 * ──────────────────────────────── */
function initSections() {
    let touchStartX = 0;
    let touchStartY = 0;
    const SWIPE_THRESHOLD = 60;

    document.addEventListener('touchstart', e => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > Math.abs(dx)) return;

        const openWindows = Array.from(document.querySelectorAll('.os-window')).filter(w => w.style.display !== 'none');
        if (openWindows.length < 2) return;

        const focused = document.querySelector('.os-window.win-focused');
        if (!focused) return;
        const currentIdx = openWindows.indexOf(focused);
        if (currentIdx < 0) return;

        const nextIdx = dx < 0 ? currentIdx + 1 : currentIdx - 1;
        if (nextIdx < 0 || nextIdx >= openWindows.length) return;

        focusWindow(openWindows[nextIdx]);
    }, { passive: true });
}

/* ────────────────────────────────
 * § CLOCK
 * Updates the HUD time and date every second.
 * Respects the _use24h setting for 12/24 hour format.
 * ──────────────────────────────── */
function startClock() {
    tickClock();
    setInterval(tickClock, 1000);
}

function tickClock() {
    const now = new Date();
    let hrs = now.getHours();
    if (window._use24h === false) {
        hrs = hrs % 12 || 12;
    }
    const h  = String(hrs).padStart(2, '0');
    const m  = String(now.getMinutes()).padStart(2, '0');
    const s  = String(now.getSeconds()).padStart(2, '0');
    const y  = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d  = String(now.getDate()).padStart(2, '0');
    const tEl = document.getElementById('hud-time');
    const dEl = document.getElementById('hud-date');
    if (tEl) tEl.textContent = `${h}:${m}:${s}`;
    if (dEl) dEl.textContent = `${y}/${mo}/${d}`;
}

/* ────────────────────────────────
 * § TAB TITLE — LIVE INDICATOR
 * Updates the browser tab title when the live section is open.
 * ──────────────────────────────── */
function updateTabTitle(sectionId) {
    const base = 'Arutosio \u2014 Tome of the Wandering Mage';
    if (sectionId === 'live') {
        document.title = '\uD83D\uDD2E Live \u2014 Arutosio';
    } else {
        document.title = base;
    }
}

/* ────────────────────────────────
 * § TYPEWRITER
 * Character-by-character bio text animation with a blinking
 * cursor. Unlocks the speed_reader achievement on completion.
 * ──────────────────────────────── */

/**
 * Typewriter animation for the bio text
 * @param {string} text — the bio text to type out
 */
function typewriterBio(text) {
    const el = document.getElementById('char-bio');
    if (!el) return;
    if (typewriterBio._timeout) clearTimeout(typewriterBio._timeout);
    el.innerHTML = '';
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    el.appendChild(cursor);
    let i = 0;
    function type() {
        if (i < text.length) {
            el.insertBefore(document.createTextNode(text.charAt(i++)), cursor);
            typewriterBio._timeout = setTimeout(type, 22);
        } else {
            unlockAchievement('speed_reader');
            setTimeout(() => cursor.remove(), 2500);
        }
    }
    type();
}
