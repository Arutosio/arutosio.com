/* ╔══════════════════════════════════════════════════════════╗
 * ║  EXTRAS — Sound, Achievements, Share, Easter Eggs       ║
 * ║  Optional features and hidden surprises                 ║
 * ╚══════════════════════════════════════════════════════════╝ */

/* ────────────────────────────────
 * § AMBIENT SOUND (Web Audio API)
 * Generates a mystical ambient drone using three oscillators:
 *   - Deep bass hum (A1, 55 Hz)
 *   - Higher harmonic (E3, 165 Hz)
 *   - Subtle shimmer with LFO (A4, 440 Hz)
 * Toggled via the hidden sound button in the taskbar.
 * ──────────────────────────────── */
function initAmbientSound() {
    const btn = document.getElementById('sound-btn');
    const icon = document.getElementById('sound-icon');
    if (!btn || !icon) return;

    let audioCtx = null;
    let playing = false;
    let nodes = [];

    function createDrone() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // Deep drone — mystical hum
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.value = 55; // A1 — deep bass
        gain1.gain.value = 0.04;
        osc1.connect(gain1).connect(audioCtx.destination);

        // Higher harmonic
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'sine';
        osc2.frequency.value = 165; // E3
        gain2.gain.value = 0.015;
        osc2.connect(gain2).connect(audioCtx.destination);

        // Very subtle shimmer
        const osc3 = audioCtx.createOscillator();
        const gain3 = audioCtx.createGain();
        osc3.type = 'triangle';
        osc3.frequency.value = 440; // A4
        gain3.gain.value = 0.005;
        // LFO for shimmer
        const lfo = audioCtx.createOscillator();
        const lfoGain = audioCtx.createGain();
        lfo.frequency.value = 0.3;
        lfoGain.gain.value = 0.003;
        lfo.connect(lfoGain).connect(gain3.gain);
        lfo.start();
        osc3.connect(gain3).connect(audioCtx.destination);

        osc1.start();
        osc2.start();
        osc3.start();

        nodes = [osc1, osc2, osc3, lfo, gain1, gain2, gain3, lfoGain];
    }

    function stopDrone() {
        nodes.forEach(n => { try { n.stop?.(); n.disconnect(); } catch {} });
        nodes = [];
    }

    btn.addEventListener('click', () => {
        if (playing) {
            stopDrone();
            icon.className = 'fas fa-volume-mute';
            playing = false;
        } else {
            createDrone();
            icon.className = 'fas fa-volume-up';
            playing = true;
        }
    });
}

/* ────────────────────────────────
 * § VISITOR ACHIEVEMENTS
 * Tracks visitor milestones and shows toast notifications.
 * Achievements: first visit, theme switch, all sections opened,
 * Konami code, night owl (past midnight), speed reader (full bio).
 * Persisted in localStorage as 'arutosio_achievements'.
 * ──────────────────────────────── */

/** Achievement definitions */
const ACHIEVEMENTS = {
    first_visit:   { icon: '\uD83C\uDFF0', name: 'First Steps', desc: 'Visited the realm' },
    theme_switch:  { icon: '\uD83C\uDF13', name: 'Duality', desc: 'Toggled the theme' },
    all_sections:  { icon: '\uD83D\uDDFA\uFE0F', name: 'Explorer', desc: 'Visited all sections' },
    konami:        { icon: '\u2726', name: 'Secret Spell', desc: 'Found the Konami code' },
    night_owl:     { icon: '\uD83E\uDD89', name: 'Night Owl', desc: 'Visited after midnight' },
    speed_reader:  { icon: '\uD83D\uDCD6', name: 'Speed Reader', desc: 'Read the full bio' },
};

/** Get the list of unlocked achievement IDs from localStorage */
function getUnlockedAchievements() {
    try {
        return JSON.parse(localStorage.getItem('arutosio_achievements') || '[]');
    } catch { return []; }
}

/**
 * Unlock an achievement (if not already unlocked) and show a toast
 * @param {string} id — achievement identifier
 */
function unlockAchievement(id) {
    const unlocked = getUnlockedAchievements();
    if (unlocked.includes(id)) return;
    unlocked.push(id);
    try { localStorage.setItem('arutosio_achievements', JSON.stringify(unlocked)); } catch {}

    const ach = ACHIEVEMENTS[id];
    if (!ach) return;

    // Show toast notification
    const toast = document.createElement('div');
    toast.className = 'achievement-toast';
    toast.innerHTML = `
        <span class="ach-icon">${ach.icon}</span>
        <div class="ach-body">
            <span class="ach-name">${ach.name}</span>
            <span class="ach-desc">${ach.desc}</span>
        </div>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('ach-show'));
    setTimeout(() => {
        toast.classList.remove('ach-show');
        setTimeout(() => toast.remove(), 500);
    }, 3500);
}

/** Initialize achievement tracking (first visit, night owl, section tracking) */
function initAchievements() {
    // First visit
    unlockAchievement('first_visit');

    // Night owl (after midnight)
    if (new Date().getHours() < 5) unlockAchievement('night_owl');

    // Track sections visited via taskbar tab additions
    const visited = new Set(['home']);
    const tabsEl = document.getElementById('taskbar-tabs');
    if (tabsEl) {
        const obs = new MutationObserver(() => {
            document.querySelectorAll('.taskbar-tab').forEach(t => {
                visited.add(t.dataset.tab);
            });
            if (visited.size >= 4) {
                unlockAchievement('all_sections');
                obs.disconnect();
            }
        });
        obs.observe(tabsEl, { childList: true });
    }
}

/* ────────────────────────────────
 * § SHARE BUTTON
 * Uses the Web Share API if available, otherwise falls back
 * to copying the URL to clipboard with visual feedback.
 * ──────────────────────────────── */

/** Initialize the share button with Web Share API or clipboard fallback */
function initShareButton() {
    const btn = document.getElementById('start-share');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const shareData = {
            title: 'Arutosio \u2014 The Wandering Mage',
            text: 'Streamer \u00b7 Programmer \u00b7 Adventurer',
            url: 'https://arutosio.com'
        };

        if (navigator.share) {
            try { await navigator.share(shareData); }
            catch (err) { if (err?.name !== 'AbortError' && window.showToast) showToast('Share failed', 'warning'); }
        } else {
            try {
                await navigator.clipboard.writeText(shareData.url);
                btn.classList.add('share-copied');
                setTimeout(() => btn.classList.remove('share-copied'), 2000);
                if (window.showToast) showToast('Link copied to clipboard', 'success');
            } catch { if (window.showToast) showToast('Copy failed', 'error'); }
        }
    });
}

/* ────────────────────────────────
 * § EASTER EGG TRIGGER — 7 clicks on magic circle
 * Keeps the trigger wired so we can hook it to something else
 * later. Previously launched the Arcane Duel overlay; that game
 * is now a bundled package (`defaultPackages/arcaneduel`) and is
 * reached from the Start menu.
 * ──────────────────────────────── */
(function initEasterEggTrigger() {
    let clicks = 0, timer = null;
    document.addEventListener('click', e => {
        if (e.target.closest('.magic-circle-frame')) {
            clicks++;
            clearTimeout(timer);
            timer = setTimeout(() => clicks = 0, 3000);
            if (clicks >= 7) {
                clicks = 0;
                // Placeholder — wire a new easter egg here.
            }
        }
    });
})();

/* ────────────────────────────────
 * § EASTER EGG — KONAMI CODE
 * Entering the classic Konami sequence (up up down down
 * left right left right B A) triggers a golden rune storm
 * with a secret message in the current language.
 * ──────────────────────────────── */
(function initKonamiEgg() {
    const SEQ = [38,38,40,40,37,39,37,39,66,65]; // arrow keys + B + A
    let pos = 0;
    let eggActive = false;

    document.addEventListener('keydown', e => {
        if (e.keyCode === SEQ[pos]) {
            pos++;
            if (pos === SEQ.length) {
                pos = 0;
                if (!eggActive) triggerRuneStorm();
            }
        } else {
            pos = 0;
        }
    });

    /** Trigger the golden rune storm easter egg */
    function triggerRuneStorm() {
        unlockAchievement('konami');
        eggActive = true;
        const RUNES = RUNE_SET;
        const COUNT = 120;
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;inset:0;z-index:9998;pointer-events:none;overflow:hidden;';
        document.body.appendChild(container);

        // Secret message in current language
        const msg = document.createElement('div');
        const eggMessages = {
            it: '\u2726 Hai trovato l\'incantesimo segreto \u2726',
            en: '\u2726 You found the secret spell \u2726',
            es: '\u2726 Encontraste el hechizo secreto \u2726',
            ja: '\u2726 \u79D8\u5BC6\u306E\u546A\u6587\u3092\u898B\u3064\u3051\u305F \u2726',
            fn: '\u2726 \u16C3\u16DF\u16A2 \u16A0\u16DF\u16A2\u16BE\u16DE \u16A6\u16D6 \u16CA\u16D6\u16B2\u16B1\u16D6\u16CF \u16CA\u16C8\u16D6\u16DA\u16DA \u2726'
        };
        msg.textContent = eggMessages[currentLang] || eggMessages.en;
        msg.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;
            font-family:'Cinzel',Georgia,serif;font-size:clamp(1.5rem,4vw,2.5rem);
            color:#fff;text-align:center;pointer-events:none;
            text-shadow:0 0 20px rgba(167,139,250,0.8),0 0 50px rgba(167,139,250,0.4),0 0 80px rgba(255,200,87,0.3);
            opacity:0;transition:opacity 0.8s;letter-spacing:0.1em;
        `;
        document.body.appendChild(msg);
        requestAnimationFrame(() => msg.style.opacity = '1');

        // Screen flash
        const flash = document.createElement('div');
        flash.style.cssText = 'position:fixed;inset:0;z-index:9997;background:radial-gradient(circle at 50% 50%, rgba(255,200,87,0.15), rgba(167,139,250,0.1));pointer-events:none;transition:opacity 1.5s;';
        document.body.appendChild(flash);

        // Spawn rune rain
        for (let i = 0; i < COUNT; i++) {
            const rune = document.createElement('div');
            const char = RUNES[Math.floor(Math.random() * RUNES.length)];
            const x = Math.random() * 100;
            const size = 14 + Math.random() * 24;
            const dur = 2 + Math.random() * 3;
            const delay = Math.random() * 2;
            const rand = Math.random();
            const color = rand > 0.6 ? '#ffc857' : rand > 0.3 ? '#a78bfa' : '#e8c84a';
            const glow = rand > 0.5 ? 'rgba(255,200,87,0.6)' : 'rgba(167,139,250,0.5)';

            rune.textContent = char;
            rune.style.cssText = `
                position:absolute;top:-5%;left:${x}%;
                font-size:${size}px;color:${color};opacity:0;
                text-shadow:0 0 8px ${glow},0 0 16px ${glow};
                font-family:serif;pointer-events:none;
                animation:eggRuneFall ${dur}s ${delay}s ease-in forwards;
            `;
            container.appendChild(rune);
        }

        // Cleanup after animation
        setTimeout(() => {
            msg.style.opacity = '0';
            flash.style.opacity = '0';
            setTimeout(() => {
                container.remove();
                msg.remove();
                flash.remove();
                eggActive = false;
            }, 1500);
        }, 4500);
    }
})();
