/* ╔══════════════════════════════════════════════════════════╗
 * ║  DESKTOP — Magic Circle Interaction + Summoning Boot    ║
 * ║  Interactive ring system and the boot-up canvas ritual  ║
 * ╚══════════════════════════════════════════════════════════╝ */

/* ────────────────────────────────
 * § INTERACTIVE MAGIC CIRCLE
 * 4 SVG rings with auto-rotation + drag-to-rotate.
 * Each ring has independent speed, direction, and friction.
 * Alignment easter egg fires when all 4 rings align to ~0 deg.
 * Rings ramp up from 0 speed over 2 seconds on init.
 * ──────────────────────────────── */
function initMagicCircleInteraction() {
    const frame = document.querySelector('.magic-circle-frame');
    if (!frame) return;

    // Speeds start at 0 and ramp up to target over 2 seconds
    const TARGET_SPEEDS = [0.3, 0.5, 0.7, 0.9];
    const rings = [
        { el: frame.querySelector('.mc-outer'), angle: 0, speed: 0, targetSpeed: 0.3, dir:  1 },
        { el: frame.querySelector('.mc-mid'),   angle: 0, speed: 0, targetSpeed: 0.5, dir: -1 },
        { el: frame.querySelector('.mc-rune'),  angle: 0, speed: 0, targetSpeed: 0.7, dir: -1 },
        { el: frame.querySelector('.mc-inner'), angle: 0, speed: 0, targetSpeed: 0.9, dir:  1 }
    ].filter(r => r.el);
    const ringsStartTime = performance.now();

    let dragging = null;   // which ring index is being dragged
    let dragStart = 0;     // angle at drag start
    let dragAngleStart = 0;
    let lastDragAngle = 0;
    let lastDragTime = 0;
    let alignmentGrace = true; // block alignment check for first 5s (rings start at 0 = "aligned")
    let alignTriggered = false;

    /**
     * Calculate the angle (degrees) from center of frame to pointer
     * @param {Event} e — mouse or touch event
     * @param {DOMRect} rect — bounding rect of the frame
     * @returns {number} angle in degrees
     */
    function getAngle(e, rect) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI);
    }

    /**
     * Detect which ring the pointer is over based on distance from center
     * @param {Event} e — mouse or touch event
     * @returns {number} ring index (0-3) or -1 for portrait area
     */
    function getRingIndex(e) {
        const rect = frame.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const dist = Math.sqrt((clientX - cx) ** 2 + (clientY - cy) ** 2);
        const maxR = rect.width / 2;
        const ratio = dist / maxR;

        // Map distance to ring: outer > mid > rune > inner > portrait
        if (ratio > 0.86) return 0;      // outer (500px)
        if (ratio > 0.72) return 1;      // mid (430px)
        if (ratio > 0.60) return 2;      // rune (370px)
        if (ratio > 0.48) return 3;      // inner (320px)
        return -1;                        // portrait area
    }

    function onDown(e) {
        const idx = getRingIndex(e);
        if (idx < 0 || idx >= rings.length) return;
        e.preventDefault();
        dragging = idx;
        rings[idx].el.classList.add('mc-dragging');
        const rect = frame.getBoundingClientRect();
        dragStart = getAngle(e, rect);
        dragAngleStart = rings[idx].angle;
        lastDragAngle = dragStart;
        lastDragTime = performance.now();
    }

    function onMove(e) {
        if (dragging === null) return;
        const rect = frame.getBoundingClientRect();
        const current = getAngle(e, rect);
        const delta = current - dragStart;
        rings[dragging].angle = dragAngleStart + delta;

        // Track velocity for release
        lastDragAngle = current;
        lastDragTime = performance.now();
    }

    function onUp(e) {
        if (dragging === null) return;
        const r = rings[dragging];
        r.el.classList.remove('mc-dragging');

        // Calculate release velocity from drag movement
        const rect = frame.getBoundingClientRect();
        const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
        const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const finalAngle = Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI);
        const dt = Math.max(1, performance.now() - lastDragTime);
        let velocity = (finalAngle - lastDragAngle) / dt * 16; // degrees per frame

        // Clamp velocity
        velocity = Math.max(-5, Math.min(5, velocity));

        // Apply release velocity as the new speed+direction
        if (Math.abs(velocity) > 0.1) {
            r.speed = Math.abs(velocity);
            r.dir = velocity > 0 ? 1 : -1;
        }

        dragging = null;
    }

    frame.addEventListener('mousedown', onDown);
    frame.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);

    // Disable alignment grace period after 5s (rings need time to diverge from 0 deg)
    setTimeout(() => { alignmentGrace = false; }, 5000);

    /** Check alignment easter egg: all rings within +/-15 deg of 0 */
    function checkAlignment() {
        if (alignTriggered || alignmentGrace) return;
        const aligned = rings.every(r => {
            const norm = ((r.angle % 360) + 360) % 360;
            return norm < 15 || norm > 345;
        });
        if (aligned) {
            alignTriggered = true;
            triggerAlignmentEasterEgg();
            setTimeout(() => alignTriggered = false, 10000);
        }
    }

    /** All rings aligned — magic burst + glow flash */
    function triggerAlignmentEasterEgg() {
        const frame = document.querySelector('.magic-circle-frame');
        if (!frame) return;

        // Bright flash
        frame.style.transition = 'filter 0.3s';
        frame.style.filter = 'drop-shadow(0 0 40px rgba(167,139,250,0.9)) drop-shadow(0 0 80px rgba(255,200,87,0.6)) brightness(1.8)';

        // Burst particles from center
        const rect = frame.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const RUNES = RUNE_SET;

        for (let i = 0; i < 20; i++) {
            const el = document.createElement('div');
            el.className = 'spell-burst';
            el.setAttribute('data-rune', RUNES[Math.floor(Math.random() * RUNES.length)]);
            const angle = (i / 20) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
            const dist = 60 + Math.random() * 100;
            el.style.left = cx + 'px';
            el.style.top = cy + 'px';
            el.style.setProperty('--bx', Math.cos(angle) * dist + 'px');
            el.style.setProperty('--by', Math.sin(angle) * dist + 'px');
            document.body.appendChild(el);
            el.addEventListener('animationend', () => el.remove());
        }

        // Temporarily speed up all rings
        rings.forEach(r => r.speed *= 4);
        setTimeout(() => {
            rings.forEach(r => r.speed /= 4);
            frame.style.filter = '';
            frame.style.transition = '';
        }, 3000);
    }

    // Fade in rings + ambient glow after a short delay so CSS doesn't flash on load
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            rings.forEach(r => r.el.classList.add('mc-ready'));
            frame.classList.add('mc-frame-ready');
        });
    });

    /** Animation loop — auto-rotate with friction + apply transform */
    let ringsRaf = 0;
    function tickRings() {
        if (!_tabVisible) { ringsRaf = requestAnimationFrame(tickRings); return; }
        if (window._circleRotationEnabled === false) { ringsRaf = requestAnimationFrame(tickRings); return; }
        // Hero covered by a window — skip the rotate/repaint work (rings are hidden).
        if (document.body.classList.contains('hero-hidden')) { ringsRaf = requestAnimationFrame(tickRings); return; }
        // Ramp up speed over first 2 seconds
        const elapsed = performance.now() - ringsStartTime;
        const rampUp = Math.min(1, elapsed / 2000);

        for (const r of rings) {
            if (dragging === null || rings[dragging] !== r) {
                // During ramp-up, lerp speed toward target
                if (rampUp < 1 && r.speed < r.targetSpeed) {
                    r.speed = r.targetSpeed * rampUp;
                }
                r.angle += r.speed * r.dir;
                // Gentle friction — speed decays toward a minimum idle speed
                const minSpeed = 0.15;
                if (rampUp >= 1 && r.speed > minSpeed) {
                    r.speed *= 0.998;
                    if (r.speed < minSpeed) r.speed = minSpeed;
                }
            }
            r.el.style.transform = `rotate(${r.angle}deg)`;
        }
        checkAlignment();
        ringsRaf = requestAnimationFrame(tickRings);
    }
    tickRings();
    window._cancelMagicCircle = () => { if (ringsRaf) cancelAnimationFrame(ringsRaf); ringsRaf = 0; };
}

/* ────────────────────────────────
 * § SUMMONING CIRCLE (boot canvas)
 * Full-screen canvas animation shown during boot.
 * Draws 6 concentric rotating layers with runes, polygons,
 * tick marks, and a pulsing core. Randomly picks a color
 * variant (arcane/golden/frost/blood). Limited to ~30 fps.
 * ──────────────────────────────── */
function initSummonCanvas() {
    const canvas = document.getElementById('summon-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;

    function resize() {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Random summoning variant
    const SUMMON_VARIANTS = [
        { hue: 250, name: 'arcane' },    // purple (default)
        { hue: 45,  name: 'golden' },    // gold
        { hue: 180, name: 'frost' },     // cyan/ice
        { hue: 320, name: 'blood' },     // crimson
    ];
    const summonVariant = SUMMON_VARIANTS[Math.floor(Math.random() * SUMMON_VARIANTS.length)];

    // Limit summoning canvas to ~30 fps to cut GPU load during page load
    const SUMMON_INTERVAL = 1000 / 30;
    let lastSummonTime = 0;
    let t = 0;
    function drawSummonCircle(ts) {
        raf = requestAnimationFrame(drawSummonCircle);
        if (ts - lastSummonTime < SUMMON_INTERVAL) return;
        lastSummonTime = ts;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const cx    = canvas.width  / 2;
        const cy    = canvas.height / 2;
        const maxR  = Math.min(canvas.width, canvas.height) * 0.36;
        const grow  = Math.min(1, t / 90);
        const pulse = 0.82 + 0.18 * Math.sin(t * 0.05);

        const light = _isLight;
        const svH = summonVariant.hue;
        const G = light ? 'rgba(90,50,8,'   : `hsla(${svH},80%,67%,`;   // primary glow
        const P = light ? 'rgba(139,28,34,' : `hsla(${(svH + 60) % 360},60%,70%,`; // secondary
        const E = light ? 'rgba(72,40,8,'   : `hsla(${(svH + 150) % 360},55%,55%,`;  // accent

        ctx.save();
        ctx.translate(cx, cy);

        // ── L1: outer ring + 16 dots + rune arcs (CW slow) ──
        ctx.save();
        ctx.rotate(t * 0.005);
        ctx.shadowColor = `${G}0.80)`; ctx.shadowBlur = 10;
        const r1 = maxR * grow;
        drawRing(ctx, 0, 0, r1,        3.5, `${G}0.45)`, [6, 10]);
        drawRing(ctx, 0, 0, r1 * 0.96, 1.2, `${G}0.15)`, [1, 5]);
        drawRuneDots(ctx, 0, 0, r1, 16, `${G}0.45)`, 2);
        drawRuneDots(ctx, 0, 0, r1, 4,  `${G}0.90)`, 4.5);
        drawRuneArc(ctx, 0, 0, r1 * 0.89, 24, `${G}0.28)`, maxR * 0.040);
        ctx.restore();

        // ── L2: compass ticks (CCW slow) ──
        ctx.save();
        ctx.rotate(-t * 0.009);
        ctx.shadowColor = `${G}0.60)`; ctx.shadowBlur = 7;
        const r2 = maxR * 0.83 * grow;
        drawRing(ctx, 0, 0, r2, 2.0, `${G}0.25)`, [3, 6]);
        drawTickMarks(ctx, 0, 0, r2, 24, r2 * 0.09, `${G}0.38)`);
        ctx.restore();

        // ── L3: hexagram (CW medium) ──
        ctx.save();
        ctx.rotate(t * 0.014);
        ctx.shadowColor = `${P}0.85)`; ctx.shadowBlur = 13;
        const r3 = maxR * 0.70 * grow;
        drawRing(ctx, 0, 0, r3, 2.5, `${P}0.45)`, [4, 7]);
        drawPolygon(ctx, 0, 0, r3, 3, `${P}0.24)`, 0);
        drawPolygon(ctx, 0, 0, r3, 3, `${P}0.24)`, Math.PI);
        drawRuneDots(ctx, 0, 0, r3, 6, `${P}0.65)`, 2.5);
        ctx.restore();

        // ── L4: pentagon (CCW medium) ──
        ctx.save();
        ctx.rotate(-t * 0.021);
        ctx.shadowColor = `${P}0.70)`; ctx.shadowBlur = 9;
        const r4 = maxR * 0.55 * grow;
        drawRing(ctx, 0, 0, r4, 2.0, `${P}0.35)`, [2, 5]);
        drawPolygon(ctx, 0, 0, r4, 5, `${P}0.20)`, -Math.PI / 2);
        drawRuneDots(ctx, 0, 0, r4, 5, `${P}0.55)`, 2);
        ctx.restore();

        // ── L5: double ring + triangle (CW fast) ──
        ctx.save();
        ctx.rotate(t * 0.030);
        ctx.shadowColor = `${E}0.90)`; ctx.shadowBlur = 14;
        const r5 = maxR * 0.42 * grow;
        drawRing(ctx, 0, 0, r5,        3.0, `${E}0.55)`, []);
        drawRing(ctx, 0, 0, r5 * 0.91, 1.2, `${E}0.22)`, [2, 4]);
        drawPolygon(ctx, 0, 0, r5, 3, `${E}0.28)`, -Math.PI / 2);
        drawRuneDots(ctx, 0, 0, r5, 3, `${E}0.75)`, 2.5);
        ctx.restore();

        // ── L6: 6-point star (CCW fast) ──
        ctx.save();
        ctx.rotate(-t * 0.040);
        ctx.shadowColor = `${G}0.90)`; ctx.shadowBlur = 11;
        const r6 = maxR * 0.27 * grow;
        drawRing(ctx, 0, 0, r6, 2.2, `${G}0.45)`, []);
        drawStar(ctx, 0, 0, r6, 6, `${G}0.32)`);
        ctx.restore();

        // ── Core: pulsing nucleus ──
        const coreR = maxR * 0.09 * grow * pulse;
        ctx.shadowBlur = 0;
        const gCore = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR * 2.5);
        gCore.addColorStop(0,   `${G}0.60)`);
        gCore.addColorStop(0.5, `${G}0.18)`);
        gCore.addColorStop(1,   `${G}0.0)`);
        ctx.fillStyle = gCore;
        ctx.beginPath();
        ctx.arc(0, 0, coreR * 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Ambient halo
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.32 * grow);
        grd.addColorStop(0,   `${G}0.10)`);
        grd.addColorStop(0.5, `${P}0.05)`);
        grd.addColorStop(1,   'transparent');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        t++;
    }
    raf = requestAnimationFrame(drawSummonCircle);
    window._cancelSummon = () => cancelAnimationFrame(raf);
}

/* ── Canvas drawing helpers ─────────────────────────────── */

/** Draw a circle (ring) with optional dash pattern */
function drawRing(ctx, x, y, r, lw, color, dash) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
}

/** Draw evenly-spaced dots around a circle */
function drawRuneDots(ctx, cx, cy, r, count, color, dotR) {
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, dotR, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
    }
}

/** Draw a regular polygon (triangle, pentagon, etc.) */
function drawPolygon(ctx, cx, cy, r, sides, color, rotOffset) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 + (rotOffset || 0);
        i === 0 ? ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
                : ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.restore();
}

/** Draw radial tick marks around a circle */
function drawTickMarks(ctx, cx, cy, r, count, len, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r,       cy + Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * (r - len), cy + Math.sin(a) * (r - len));
        ctx.stroke();
    }
    ctx.restore();
}

/** Draw rune text characters around a circular arc */
function drawRuneArc(ctx, cx, cy, r, count, color, size) {
    const SET = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        ctx.save();
        ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.rotate(a + Math.PI / 2);
        ctx.fillText(SET[i % SET.length], 0, 0);
        ctx.restore();
    }
    ctx.restore();
}

/** Draw a star shape (alternating inner/outer points) */
function drawStar(ctx, cx, cy, r, points, color) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const a  = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        i === 0 ? ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
                : ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke();
}

/* ────────────────────────────────
 * § SUMMONING SEQUENCE
 * Typewriter-style boot log that displays i18n boot lines,
 * then fades the overlay and calls onComplete.
 * ──────────────────────────────── */

/**
 * Run the summoning boot sequence
 * @param {Function} onComplete — called when summoning finishes
 */
/**
 * Runs the summoning boot sequence (text lines + canvas animation).
 * Calls onComplete when ALL lines have been shown + a short pause.
 * The fade-out transition is handled separately by the caller.
 */
function runSummoning(onComplete) {
    const logEl = document.getElementById('summon-log');
    const lines  = i18n[currentLang].boot;
    let idx = 0;

    function addLine() {
        if (idx < lines.length) {
            const span = document.createElement('span');
            span.className   = 'summon-line';
            span.textContent = lines[idx++];
            logEl.appendChild(span);
            setTimeout(addLine, 380);
        } else {
            // Lines done — short pause then signal complete
            setTimeout(() => {
                if (window._cancelSummon) window._cancelSummon();
                onComplete();
            }, 600);
        }
    }
    addLine();
}
