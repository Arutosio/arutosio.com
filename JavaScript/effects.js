/* ╔══════════════════════════════════════════════════════════╗
 * ║  EFFECTS — Particles, Cursor, Parallax, Spells, Letters ║
 * ║  All visual effects that run on canvas or DOM overlays  ║
 * ╚══════════════════════════════════════════════════════════╝ */

/* ────────────────────────────────
 * § RUNE PARTICLES + CURSOR TRAIL (canvas)
 * 40 drifting rune glyphs on a full-screen canvas.
 * Features: mouse-proximity glow, magnetic orbit, constellation
 * lines, and a thin cursor trail — all GPU-friendly.
 * ──────────────────────────────── */
function initRuneParticles() {
    const canvas = document.getElementById('rune-bg');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const RUNES   = RUNE_SET;
    // dark:  base #6e8efb (blue) → hot #d0eaff (white-blue near cursor)
    // light: base #5a320a (sepia ink) → hot #bc6c14 (amber candlelight near cursor)
    const THEMES = {
        dark:  { br: 110, bg: 142, bb: 251, hr: 255, hg: 200, hb: 87, trail: '#ffc857',  tShadow: 'rgba(255,200,87,0.55)' },
        light: { br:  90, bg:  50, bb:  10, hr: 139, hg: 105, hb:  20, trail: '#8b6914',  tShadow: 'rgba(139,105,20,0.55)' }
    };
    const THEMES_DEFAULT = { dark: { ...THEMES.dark }, light: { ...THEMES.light } };

    /**
     * Re-tint the rune color ramps from Settings → Appearance.
     *   setRuneTint('magic',  hex|null) — base drift color (null = default)
     *   setRuneTint('accent', hex|null) — proximity-glow + cursor trail color
     * Light variants are darkened (×0.5 / ×0.55) so glyphs stay legible on
     * the parchment background.
     */
    window.setRuneTint = function (kind, hex) {
        const rgb = hex ? [
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16),
        ] : null;
        if (kind === 'magic') {
            const d = rgb || [THEMES_DEFAULT.dark.br, THEMES_DEFAULT.dark.bg, THEMES_DEFAULT.dark.bb];
            const l = rgb ? rgb.map(c => Math.round(c * 0.5))
                          : [THEMES_DEFAULT.light.br, THEMES_DEFAULT.light.bg, THEMES_DEFAULT.light.bb];
            [THEMES.dark.br,  THEMES.dark.bg,  THEMES.dark.bb]  = d;
            [THEMES.light.br, THEMES.light.bg, THEMES.light.bb] = l;
        } else if (kind === 'accent') {
            if (rgb) {
                [THEMES.dark.hr, THEMES.dark.hg, THEMES.dark.hb] = rgb;
                THEMES.dark.trail   = hex;
                THEMES.dark.tShadow = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.55)`;
                const l = rgb.map(c => Math.round(c * 0.55));
                [THEMES.light.hr, THEMES.light.hg, THEMES.light.hb] = l;
                THEMES.light.trail   = `rgb(${l[0]},${l[1]},${l[2]})`;
                THEMES.light.tShadow = `rgba(${l[0]},${l[1]},${l[2]},0.55)`;
            } else {
                Object.assign(THEMES.dark,  { hr: THEMES_DEFAULT.dark.hr,  hg: THEMES_DEFAULT.dark.hg,  hb: THEMES_DEFAULT.dark.hb,  trail: THEMES_DEFAULT.dark.trail,  tShadow: THEMES_DEFAULT.dark.tShadow });
                Object.assign(THEMES.light, { hr: THEMES_DEFAULT.light.hr, hg: THEMES_DEFAULT.light.hg, hb: THEMES_DEFAULT.light.hb, trail: THEMES_DEFAULT.light.trail, tShadow: THEMES_DEFAULT.light.tShadow });
            }
        }
    };
    const MOUSE_R = 170;
    const MC_R    = 190;
    let mouse = { x: -999, y: -999 };
    let frame = 0;
    const trail = [];

    function getTheme() {
        return _isLight ? THEMES.light : THEMES.dark;
    }
    function runeColor(c, t) {
        return `rgb(${Math.round(c.br + t*(c.hr-c.br))},${Math.round(c.bg + t*(c.hg-c.bg))},${Math.round(c.bb + t*(c.hb-c.bb))})`;
    }

    // Cache magic-circle center — recompute only on resize or section change
    let mcCache = null, mcDirty = true;
    function getMCCenter() {
        if (!mcDirty) return mcCache;
        mcDirty = false;
        const el = document.querySelector('.magic-circle-frame');
        if (!el) return (mcCache = null);
        const r = el.getBoundingClientRect();
        return (mcCache = { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }

    function resize() {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
        mcDirty = true;
    }
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', e => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        trail.push({ x: e.clientX, y: e.clientY, t: Date.now() });
        if (trail.length > 15) trail.shift();
    });

    const ATTRACT_R = 68;   // radius where magnet kicks in
    const ORBIT_R   = 46;   // target orbit distance from cursor
    const MAX_V     = 0.45; // absolute speed cap for all runes

    /** Spawn a single rune particle with random position and slow drift */
    function spawn() {
        const spd = 0.06 + Math.random() * 0.22;
        const ang = Math.random() * Math.PI * 2;
        return {
            x:        Math.random() * window.innerWidth,
            y:        Math.random() * window.innerHeight,
            vx:       Math.cos(ang) * spd,
            vy:       Math.sin(ang) * spd,
            char:     RUNES[Math.floor(Math.random() * RUNES.length)],
            base:     18 + Math.random() * 20,
            phase:    Math.random() * Math.PI * 2,
            alpha:    0.13 + Math.random() * 0.17,
            glowM:    0,
            glowMC:   0,
            pull:     0,
            orbitDir: Math.random() < 0.5 ? 1 : -1,
            life:     0
        };
    }

    const particles = Array.from({ length: 40 }, spawn);

    /** Main animation loop — runs every rAF, pauses when tab hidden or the
     *  hero is covered by a window (canvas sits behind it — drawing is wasted) */
    function tick() {
        if (!_tabVisible || document.body.classList.contains('hero-hidden')) {
            requestAnimationFrame(tick); return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        frame++;

        // Thin cursor trail — single save/restore for all points
        const now = Date.now();
        const c = getTheme();
        ctx.save();
        ctx.fillStyle = c.trail;
        ctx.shadowColor = c.tShadow;
        for (let ti = 0; ti < trail.length; ti++) {
            const pt = trail[ti];
            const age = now - pt.t;
            if (age > 480) continue;
            const life = 1 - age / 480;
            ctx.globalAlpha = life * 0.30;
            ctx.shadowBlur  = window._lowPower ? 0 : life * 8;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, life * 2.5 + 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        const mc = getMCCenter();

        // Low-power: process fewer runes (caps the O(n²) constellation pass too).
        const N = window._lowPower ? 16 : particles.length;

        for (let i = 0; i < N; i++) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            if (p.life < 1) p.life = Math.min(1, p.life + 0.012);

            // Off-screen → respawn
            if (p.x < -50 || p.x > canvas.width + 50 || p.y < -50 || p.y > canvas.height + 50) {
                particles[i] = spawn();
                continue;
            }

            // Edge fade
            const edge = Math.min(p.x / 80, (canvas.width - p.x) / 80,
                                  p.y / 80, (canvas.height - p.y) / 80, 1);

            // Very subtle float: stays between 90%–100% so runes never "shrink to nothing"
            const float = 0.90 + 0.10 * Math.sin(frame * 0.009 + p.phase);

            // Mouse proximity → color shift + size boost
            const dx = p.x - mouse.x, dy = p.y - mouse.y;
            const distM = Math.sqrt(dx * dx + dy * dy);
            p.glowM += ((distM < MOUSE_R ? 1 - distM / MOUSE_R : 0) - p.glowM) * 0.07;

            // ── Magnetic orbit ──────────────────────────────────────────
            // pull: 0=free drift, 1=fully captured in orbit
            p.pull += ((distM < ATTRACT_R && distM > 1 ? 1 : 0) - p.pull) * 0.04;

            if (p.pull > 0.01) {
                const nx = dx / distM, ny = dy / distM;
                const dr = distM - ORBIT_R;
                // Very subtle spring + tangential — minimal attraction
                p.vx += -dr * 0.0012 * p.pull * nx;
                p.vy += -dr * 0.0012 * p.pull * ny;
                p.vx += -ny * p.orbitDir * 0.004 * p.pull;
                p.vy +=  nx * p.orbitDir * 0.004 * p.pull;
                const damp = 1 - p.pull * 0.03;
                p.vx *= damp;
                p.vy *= damp;
            }

            // Hard speed cap — runes never rush
            const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (spd > MAX_V) { p.vx = p.vx / spd * MAX_V; p.vy = p.vy / spd * MAX_V; }
            // ────────────────────────────────────────────────────────────

            // Magic circle proximity → size boost only (no color change)
            let targetMC = 0;
            if (mc) {
                const mx = p.x - mc.x, my = p.y - mc.y;
                targetMC = Math.sqrt(mx * mx + my * my) < MC_R
                    ? 1 - Math.sqrt(mx * mx + my * my) / MC_R : 0;
            }
            p.glowMC += (targetMC - p.glowMC) * 0.05;

            // Orbit pulse: very slow intensity swell while circling
            const orbitPulse = p.pull > 0.15
                ? p.pull * (0.5 + 0.5 * Math.sin(frame * 0.025 + p.phase))
                : 0;

            const effectiveGlow = Math.min(1, p.glowM + orbitPulse * 0.7);

            // Size grows near cursor OR magic circle, returns to base when away
            const size  = p.base * float * (1 + Math.max(effectiveGlow, p.glowMC) * 0.65);
            const color = runeColor(c, effectiveGlow);
            const blur  = 2 + float * 3 + effectiveGlow * 30;
            const alpha = (p.alpha + effectiveGlow * 0.55) * edge * p.life;

            // Skip shadow entirely when rune is far from any attractor (biggest GPU saver)
            const sz = Math.round(size);
            ctx.globalAlpha = alpha;
            ctx.font        = `${sz}px serif`;
            ctx.fillStyle   = color;
            if (effectiveGlow > 0.04 || p.glowMC > 0.04) {
                ctx.shadowColor = color;
                ctx.shadowBlur  = blur;
            } else {
                ctx.shadowBlur  = 0;
            }
            ctx.fillText(p.char, p.x, p.y);
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur  = 0;

        // ── Constellation lines between nearby particles ──
        ctx.save();
        const LINK_DIST = 120;
        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                const a = particles[i], b = particles[j];
                const dx = a.x - b.x, dy = a.y - b.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < LINK_DIST) {
                    const strength = (1 - d / LINK_DIST);
                    // Only draw if at least one particle is near cursor or magic circle
                    const proximity = Math.max(a.glowM, b.glowM, a.glowMC * 0.5, b.glowMC * 0.5);
                    if (proximity < 0.02) continue;
                    ctx.globalAlpha = strength * proximity * 0.3 * Math.min(a.life, b.life);
                    ctx.strokeStyle = runeColor(c, proximity);
                    ctx.lineWidth = strength * 0.8;
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                }
            }
        }
        ctx.restore();

        requestAnimationFrame(tick);
    }
    tick();
}

/* ────────────────────────────────
 * § MAGIC CURSOR (desktop only)
 * Replaces the native cursor with a glowing dot that
 * expands on hover over interactive elements. Skipped
 * on touch devices (pointer: coarse).
 * ──────────────────────────────── */
function initMagicCursor() {
    const el = document.getElementById('magic-cursor');
    if (!el) return;

    // "Mobile-ish": coarse pointer OR narrow viewport. Kept in sync so a
    // desktop window narrowed past the breakpoint matches a real phone.
    const mq = window.matchMedia('(pointer: coarse), (max-width: 640px)');
    const sync = () => {
        const userOff = localStorage.getItem('arutosio_settings-cursor') === 'false';
        const enabled = !mq.matches && !userOff;
        document.documentElement.classList.toggle('magic-cursor-active', enabled);
        if (el) el.style.display = enabled ? '' : 'none';
    };
    sync();
    mq.addEventListener('change', sync);

    // Batch cursor position updates via rAF — mousemove can fire 100+ times per
    // second on fast mice, but the compositor only commits at display refresh.
    let px = 0, py = 0, scheduled = false;
    window.addEventListener('mousemove', e => {
        if (mq.matches) return;
        px = e.clientX; py = e.clientY;
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            el.style.transform = `translate(${px}px,${py}px)`;
            scheduled = false;
        });
    });

    // Ring expands over interactive elements (delegation handles dynamic cards)
    document.addEventListener('mouseover', e => {
        if (mq.matches) return;
        if (e.target.closest('a, button')) el.classList.add('cursor-hover');
    });
    document.addEventListener('mouseout', e => {
        if (e.target.closest('a, button')) el.classList.remove('cursor-hover');
    });
}

/* ────────────────────────────────
 * § PARALLAX DEPTH
 * Smoothly shifts background rings and magic-bg pseudo-elements
 * based on mouse position. Uses CSS custom properties to avoid
 * layout thrashing. Pauses when _parallaxEnabled is false.
 * ──────────────────────────────── */
function initParallax() {
    const ring1 = document.querySelector('.bg-ring-1');
    const ring2 = document.querySelector('.bg-ring-2');
    const magicBg = document.querySelector('.magic-bg');
    if (!ring1 || !ring2 || !magicBg) return;

    let mx = 0.5, my = 0.5;
    let cx = 0.5, cy = 0.5;

    window.addEventListener('mousemove', e => {
        mx = e.clientX / window.innerWidth;
        my = e.clientY / window.innerHeight;
    });

    function parallaxTick() {
        if (window._parallaxEnabled === false || window._lowPower) { requestAnimationFrame(parallaxTick); return; }
        if (!_tabVisible || document.body.classList.contains('hero-hidden')) { requestAnimationFrame(parallaxTick); return; }
        cx += (mx - cx) * 0.04;
        cy += (my - cy) * 0.04;

        const offX = (cx - 0.5) * 30;
        const offY = (cy - 0.5) * 20;

        // Shift background pseudo-elements via CSS custom properties
        magicBg.style.setProperty('--px', `${offX * 0.6}px`);
        magicBg.style.setProperty('--py', `${offY * 0.6}px`);

        // Shift rings subtly via CSS custom properties (avoids layout thrashing)
        ring1.style.setProperty('--parallax-x', `${offX * 0.3}px`);
        ring1.style.setProperty('--parallax-y', `${offY * 0.3}px`);
        ring2.style.setProperty('--parallax-x', `${offX * -0.2}px`);
        ring2.style.setProperty('--parallax-y', `${offY * -0.2}px`);

        requestAnimationFrame(parallaxTick);
    }
    parallaxTick();
}

/* ────────────────────────────────
 * § CLICK SPELL BURST
 * On click (non-interactive areas), 12 rune glyphs burst
 * outward in a radial pattern and fade out via CSS animation.
 * ──────────────────────────────── */
function initClickSpells() {
    const RUNES = RUNE_SET;
    const BURST_COUNT = 12;

    document.addEventListener('click', e => {
        if (window._clickSpellsEnabled === false) return;
        // Don't burst on interactive elements
        if (e.target.closest('a, button, select, input')) return;

        for (let i = 0; i < BURST_COUNT; i++) {
            const el = document.createElement('div');
            el.className = 'spell-burst';
            el.setAttribute('data-rune', RUNES[Math.floor(Math.random() * RUNES.length)]);

            const angle = (i / BURST_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            const dist  = 40 + Math.random() * 60;
            el.style.left = `${e.clientX}px`;
            el.style.top  = `${e.clientY}px`;
            el.style.setProperty('--bx', `${Math.cos(angle) * dist}px`);
            el.style.setProperty('--by', `${Math.sin(angle) * dist}px`);
            el.style.animationDelay = `${Math.random() * 0.08}s`;

            document.body.appendChild(el);
            el.addEventListener('animationend', () => el.remove());
        }
    });
}

/* ────────────────────────────────
 * § FIREFLY NAV SYSTEM
 * Tiny green/gold fireflies orbit around the active section
 * button. Each firefly has independent elliptical orbit params,
 * wobble, and pulse. Uses MutationObserver to track .active class.
 * ──────────────────────────────── */
function initFireflies() {
    const COUNT = 10;       // fireflies per active button
    const pools = new Map(); // btn → firefly[]

    function spawnFirefly(btn) {
        const el = document.createElement('div');
        el.className = 'firefly';
        btn.appendChild(el);

        // Each firefly has its own orbit params
        const f = {
            el,
            cx: 0.3 + Math.random() * 0.4,    // 30%-70% of width
            cy: 0.2 + Math.random() * 0.6,    // 20%-80% of height
            rx: 8 + Math.random() * 18,        // orbit radius X
            ry: 4 + Math.random() * 10,        // orbit radius Y
            angle: Math.random() * Math.PI * 2,
            speed: 0.008 + Math.random() * 0.018,
            dir: Math.random() < 0.5 ? 1 : -1,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.02 + Math.random() * 0.03,
            pulsePhase: Math.random() * Math.PI * 2,
            size: 3 + Math.random() * 3
        };
        el.style.width  = f.size + 'px';
        el.style.height = f.size + 'px';

        // Fade in
        requestAnimationFrame(() => el.classList.add('alive'));
        return f;
    }

    function killFireflies(btn) {
        const flies = pools.get(btn);
        if (!flies) return;
        flies.forEach(f => {
            f.el.classList.remove('alive');
            f.el.classList.add('dying');
            setTimeout(() => f.el.remove(), 600);
        });
        pools.delete(btn);
    }

    // Cache button dimensions (avoid reflow in loop)
    const btnSizes = new Map();
    function cacheBtnSizes() {
        document.querySelectorAll('.sec-btn').forEach(btn => {
            btnSizes.set(btn, { w: btn.offsetWidth, h: btn.offsetHeight });
        });
    }
    window.addEventListener('resize', cacheBtnSizes);

    function activateBtn(btn) {
        if (pools.has(btn)) return;
        cacheBtnSizes();
        const flies = [];
        for (let i = 0; i < COUNT; i++) {
            flies.push(spawnFirefly(btn));
        }
        pools.set(btn, flies);
    }

    // Animation loop — uses cached sizes, no boxShadow recalc
    function tick() {
        if (!_tabVisible) { requestAnimationFrame(tick); return; }
        pools.forEach((flies, btn) => {
            const size = btnSizes.get(btn) || { w: 80, h: 40 };
            for (const f of flies) {
                f.angle += f.speed * f.dir;
                f.wobble += f.wobbleSpeed;

                const wobbleX = Math.sin(f.wobble) * 3;
                const wobbleY = Math.cos(f.wobble * 0.7) * 2;
                const x = f.cx * size.w + Math.cos(f.angle) * f.rx + wobbleX;
                const y = f.cy * size.h + Math.sin(f.angle) * f.ry + wobbleY;

                // Only update position + opacity (GPU-friendly, no boxShadow recalc)
                f.pulsePhase += 0.03;
                const pulse = 0.5 + 0.5 * Math.sin(f.pulsePhase);

                f.el.style.transform = `translate(${x}px, ${y}px)`;
                f.el.style.opacity = 0.35 + pulse * 0.65;
            }
        });
        requestAnimationFrame(tick);
    }
    tick();

    // Watch for active button changes (guarded against double init)
    if (window._fireflyObserver) window._fireflyObserver.disconnect();
    const observer = new MutationObserver(() => {
        document.querySelectorAll('.sec-btn').forEach(btn => {
            if (btn.classList.contains('active')) {
                activateBtn(btn);
            } else {
                killFireflies(btn);
            }
        });
    });

    // Observe class changes on all sec-btns
    document.querySelectorAll('.sec-btn').forEach(btn => {
        observer.observe(btn, { attributes: true, attributeFilter: ['class'] });
    });
    window._fireflyObserver = observer;

    // Activate initial active button
    const initial = document.querySelector('.sec-btn.active');
    if (initial) activateBtn(initial);
}

/* ────────────────────────────────
 * § FLYING LETTERS
 * Two-phase title animation for "Arutosio":
 *   Phase 1 — letters drift like rune particles (2.5s)
 *   Phase 2 — letters fly to their final position with
 *             an expo ease-out, shifting from rune color to gold
 * ──────────────────────────────── */
let titleAnimated = false;
let _flyingRAF = null;

function flyingLettersInit() {
    const el = document.querySelector('.char-name');
    if (!el || titleAnimated) return;
    titleAnimated = true;

    // Use whatever text is currently in .char-name (may be a user-custom
    // display name from Appearance settings). Fall back to the default.
    const text = (el.textContent && el.textContent.trim()) || 'Arutosio';
    const runeColor = _isLight ? 'rgb(139, 105, 20)' : 'rgb(167, 139, 250)';

    el.textContent = '';
    el.style.overflow = 'visible';

    const DRIFT_DURATION = 2500;  // ms letters float before assembling
    const FLY_DURATION   = 2200;  // ms to fly to final position
    const FLY_STAGGER    = 180;   // ms between each letter starting to fly

    // Create letter objects with physics
    const letters = [];
    for (let i = 0; i < text.length; i++) {
        const span = document.createElement('span');
        span.textContent = text[i];
        span.className = 'fly-letter';
        span.style.display = 'inline-block';
        span.style.color = runeColor;
        span.style.opacity = '0';
        el.appendChild(span);

        letters.push({
            el: span,
            // Scattered position — scaled to viewport so letters stay on screen
            x: (Math.random() - 0.5) * Math.min(window.innerWidth * 0.85, 1200),
            y: (Math.random() - 0.5) * Math.min(window.innerHeight * 0.7, 800),
            rot: (Math.random() - 0.5) * 300,
            // Slow drift velocity (like rune particles)
            vx: (Math.random() - 0.5) * 0.6,
            vy: (Math.random() - 0.5) * 0.4,
            vr: (Math.random() - 0.5) * 0.3,
            // Wobble
            wobblePhase: Math.random() * Math.PI * 2,
            wobbleAmp: 0.15 + Math.random() * 0.25,
            // State
            flying: false,
            landed: false,
            flyStart: 0,
            startX: 0, startY: 0, startRot: 0
        });
    }

    const t0 = performance.now();

    function tick(now) {
        const elapsed = now - t0;

        for (let i = 0; i < letters.length; i++) {
            const L = letters[i];

            // Phase 1: drift like a rune
            if (!L.flying) {
                const fadeIn = Math.min(1, elapsed / 600);
                L.el.style.opacity = fadeIn * 0.65;

                L.wobblePhase += 0.02;
                L.x += L.vx + Math.sin(L.wobblePhase) * L.wobbleAmp;
                L.y += L.vy + Math.cos(L.wobblePhase * 0.7) * L.wobbleAmp * 0.6;
                L.rot += L.vr;

                L.el.style.transform = `translate(${L.x}px, ${L.y}px) rotate(${L.rot}deg) scale(0.75)`;

                // Trigger fly phase after drift duration (staggered per letter)
                const flyTrigger = DRIFT_DURATION + i * FLY_STAGGER;
                if (elapsed > flyTrigger) {
                    L.flying = true;
                    L.flyStart = now;
                    L.startX = L.x;
                    L.startY = L.y;
                    L.startRot = L.rot;
                }
            }
            // Phase 2: fly to final position
            else if (!L.landed) {
                const flyElapsed = now - L.flyStart;
                // Ease out expo: 1 - 2^(-10t)
                let t = Math.min(1, flyElapsed / FLY_DURATION);
                t = 1 - Math.pow(2, -10 * t);

                const cx = L.startX * (1 - t);
                const cy = L.startY * (1 - t);
                const cr = L.startRot * (1 - t);
                const cs = 0.75 + t * 0.25; // scale 0.75 → 1
                const co = 0.65 + t * 0.35; // opacity 0.65 → 1

                L.el.style.transform = `translate(${cx}px, ${cy}px) rotate(${cr}deg) scale(${cs})`;
                L.el.style.opacity = co;

                if (flyElapsed >= FLY_DURATION) {
                    L.landed = true;
                    L.el.style.transform = '';
                    L.el.style.opacity = '1';
                    L.el.style.color = '';
                    L.el.classList.add('fly-letter-landed');
                }
            }
        }

        // Continue loop until all landed
        if (letters.some(L => !L.landed)) {
            _flyingRAF = requestAnimationFrame(tick);
        } else {
            _flyingRAF = null;
        }
    }

    _flyingRAF = requestAnimationFrame(tick);
}
