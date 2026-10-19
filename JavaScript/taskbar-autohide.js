/* ╔══════════════════════════════════════════════════════════╗
 * ║  TASKBAR AUTO-HIDE — macOS-dock-style reveal             ║
 * ║  Opt-in (Settings → Appearance). When enabled the top    ║
 * ║  taskbar slides off-screen and reappears when the cursor ║
 * ║  reaches the top edge (desktop) or the reveal strip is   ║
 * ║  tapped (touch). The bar overlays content — windows then ║
 * ║  reclaim the freed space via taskbarReserve() in         ║
 * ║  os-windows.js. Default OFF: zero change to current UX.  ║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    const body = document.body;

    const REVEAL_Y      = 6;     // px from top that triggers reveal (mouse)
    const HIDE_DELAY    = 250;   // ms grace before hiding after pointer leaves
    const TOUCH_AUTOHIDE = 3500; // ms before auto-hiding after a touch reveal

    const isCoarse = window.matchMedia('(pointer: coarse)').matches;

    let enabled   = false;
    let hideTimer = null;
    let peekLock  = false;       // external pin (kept visible regardless)
    let revealZone = null;

    /** Start menu / sysinfo popover anchor to the bar — never hide while open. */
    function menusOpen() {
        const vis = (id) => {
            const el = document.getElementById(id);
            return el && el.style.display !== 'none' &&
                   window.getComputedStyle(el).display !== 'none';
        };
        return vis('start-menu') || vis('sysinfo-panel');
    }

    function peek() {
        clearTimeout(hideTimer);
        body.classList.add('taskbar-peek');
    }

    function scheduleHide(delay) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (peekLock || menusOpen()) return;
            body.classList.remove('taskbar-peek');
        }, delay);
    }

    function onMouseMove(e) {
        if (e.clientY <= REVEAL_Y) peek();
    }
    function onBarEnter() { peek(); }
    function onBarLeave() { scheduleHide(HIDE_DELAY); }

    /** Thin top strip that turns the reveal into a tappable target on touch.
     *  Inert (pointer-events:none) on fine pointers — see os.css — so it never
     *  steals clicks; the mousemove handler drives desktop reveal instead. */
    function ensureRevealZone() {
        if (revealZone) return revealZone;
        revealZone = document.createElement('div');
        revealZone.id = 'taskbar-reveal-zone';
        revealZone.setAttribute('aria-hidden', 'true');
        body.appendChild(revealZone);
        revealZone.addEventListener('pointerdown', () => {
            if (body.classList.contains('taskbar-peek')) {
                scheduleHide(0);
            } else {
                peek();
                if (isCoarse) scheduleHide(TOUCH_AUTOHIDE);
            }
        });
        return revealZone;
    }

    /** On touch, tapping anywhere outside the bar/strip dismisses the reveal. */
    function onDocPointerDown(e) {
        if (!isCoarse) return;
        if (revealZone && revealZone.contains(e.target)) return;
        const tb = document.querySelector('.taskbar');
        if (tb && tb.contains(e.target)) return;
        if (menusOpen()) return;
        scheduleHide(0);
    }

    function enable() {
        if (enabled) return;
        enabled = true;
        body.classList.add('taskbar-autohide');
        body.classList.remove('taskbar-peek'); // start hidden
        ensureRevealZone();
        const tb = document.querySelector('.taskbar');
        window.addEventListener('mousemove', onMouseMove, { passive: true });
        if (tb) {
            tb.addEventListener('mouseenter', onBarEnter);
            tb.addEventListener('mouseleave', onBarLeave);
        }
        document.addEventListener('pointerdown', onDocPointerDown, true);
    }

    function disable() {
        if (!enabled) return;
        enabled = false;
        clearTimeout(hideTimer);
        body.classList.remove('taskbar-autohide', 'taskbar-peek');
        const tb = document.querySelector('.taskbar');
        window.removeEventListener('mousemove', onMouseMove);
        if (tb) {
            tb.removeEventListener('mouseenter', onBarEnter);
            tb.removeEventListener('mouseleave', onBarLeave);
        }
        document.removeEventListener('pointerdown', onDocPointerDown, true);
    }

    /** Pin the bar visible (e.g. while a menu is open). */
    function setPeekLock(v) {
        peekLock = !!v;
        if (peekLock) peek();
        else scheduleHide(HIDE_DELAY);
    }

    window.taskbarAutohide = { enable, disable, peek, setPeekLock, isOn: () => enabled };

    // Restore persisted state at startup — independent of the lazy Settings
    // init (which only runs when the Settings window is first opened), so the
    // bar is already hidden on first paint when the user enabled the option.
    // initSettings() later just syncs the toggle's .active class; enable() is
    // idempotent so the double call is harmless.
    if (localStorage.getItem('aruta_taskbar_autohide') === 'true') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', enable);
        } else {
            enable();
        }
    }
})();
