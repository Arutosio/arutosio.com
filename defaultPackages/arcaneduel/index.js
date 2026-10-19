/* ============================================================
   ARCANE DUEL — Mini Mage Arena (Easter Egg)
   UO-inspired: 7 elements x 3 spells, meditation, buffs/debuffs
   ============================================================ */

export default {
  async mount(root, sdk) {

    /* ════════════════════════════
       SPELL DATABASE — 3 per element + meditation
       target: 'enemy' | 'self' | 'enemy+self'
    ════════════════════════════ */
    // cast = precast time in ms (spell charges before firing)
    const SPELLS = [
        // ── FIRE ──
        { key: 'Q', name: 'Fireball',       icon: '🔥', element: 'fire',      mana: 14, dmg: 16, cast: 800,  target: 'enemy', effect: 'burn',       desc: 'Burn 3dps/3s',          color: '#ff4020', trail: '#ff8040' },
        { key: 'W', name: 'Meteor',          icon: '☄️', element: 'fire',      mana: 28, dmg: 30, cast: 2000, target: 'enemy', effect: 'none',       desc: 'Heavy fire damage',     color: '#ff6010', trail: '#ffa040' },
        { key: 'E', name: 'Curse',           icon: '💀', element: 'fire',      mana: 18, dmg: 0,  cast: 1200, target: 'enemy', effect: 'curse',      desc: '-25% resist, slow cast, -regen', color: '#a02020', trail: '#c04040' },

        // ── WATER ──
        { key: 'R', name: 'Frost Wave',      icon: '💧', element: 'water',     mana: 12, dmg: 11, cast: 700,  target: 'enemy', effect: 'slow',       desc: 'Slow enemy 2.5s',       color: '#40a0ff', trail: '#80d0ff' },
        { key: 'T', name: 'Poison',          icon: '🐍', element: 'water',     mana: 15, dmg: 0,  cast: 1000, target: 'enemy', effect: 'poison',     desc: '4dps/5s, blocks regen',  color: '#40c040', trail: '#80e080' },
        { key: 'Y', name: 'Cure',            icon: '💚', element: 'water',     mana: 10, dmg: 0,  cast: 600,  target: 'self',  effect: 'cure',       desc: 'Remove poison',         color: '#60ff60', trail: '#a0ffa0' },

        // ── EARTH ──
        { key: 'U', name: 'Rock Shield',     icon: '🛡️', element: 'earth',    mana: 20, dmg: 0,  cast: 1000, target: 'self',  effect: 'shield',     desc: '+30 Shield',            color: '#a08040', trail: '#c0a060' },
        { key: 'I', name: 'Protection',       icon: '🌍', element: 'earth',    mana: 22, dmg: 0,  cast: 1500, target: 'self',  effect: 'protection', desc: '+30% resist 8s',        color: '#c0a050', trail: '#e0c070' },
        { key: 'O', name: 'Earthquake',       icon: '🪨', element: 'earth',    mana: 24, dmg: 20, cast: 1800, target: 'enemy', effect: 'stun',       desc: 'Stun 1s + damage',      color: '#806030', trail: '#a08050' },

        // ── AIR ──
        { key: 'A', name: 'Wind Slash',      icon: '💨', element: 'air',       mana: 10, dmg: 9,  cast: 500,  target: 'enemy', effect: 'knock',      desc: 'Delay enemy cast',      color: '#c0e8c0', trail: '#e0ffe0' },
        { key: 'S', name: 'Dispel',          icon: '🌀', element: 'air',       mana: 16, dmg: 0,  cast: 800,  target: 'self',  effect: 'dispel',     desc: 'Remove all buffs/debuffs', color: '#e0e0ff', trail: '#ffffff' },
        { key: 'D', name: 'Bless',           icon: '🕊️', element: 'air',      mana: 20, dmg: 0,  cast: 1200, target: 'self',  effect: 'bless',      desc: '+20% dmg 8s',           color: '#f0f0ff', trail: '#ffffff' },

        // ── LIGHTNING ──
        { key: 'F', name: 'Thunder',         icon: '⚡', element: 'lightning', mana: 22, dmg: 24, cast: 1200, target: 'enemy', effect: 'stun',       desc: 'Stun 1.5s',             color: '#ffe040', trail: '#ffff80' },
        { key: 'G', name: 'Chain Lightning', icon: '⛈️', element: 'lightning', mana: 32, dmg: 35, cast: 2500, target: 'enemy', effect: 'none',       desc: 'Massive lightning',     color: '#fff060', trail: '#ffffa0' },
        { key: 'H', name: 'Mana Vampire',   icon: '🦇', element: 'lightning', mana: 8,  dmg: 5,  cast: 600,  target: 'enemy', effect: 'manavamp',   desc: 'Steal 15 mana',         color: '#c080ff', trail: '#d0a0ff' },

        // ── LIGHT ──
        { key: 'J', name: 'Heal',            icon: '❤️', element: 'light',     mana: 12, dmg: 0,  cast: 800,  target: 'self',  effect: 'heal',       desc: 'Heal +15 HP',           color: '#ff8080', trail: '#ffb0b0' },
        { key: 'K', name: 'Greater Heal',    icon: '❤️‍🔥', element: 'light',  mana: 25, dmg: 0,  cast: 1800, target: 'self',  effect: 'gheal',      desc: 'Heal +35 HP',           color: '#ff4060', trail: '#ff80a0' },
        { key: 'L', name: 'Magic Reflection', icon: '🪞', element: 'light',   mana: 30, dmg: 0,  cast: 2000, target: 'self',  effect: 'reflect',    desc: 'Reflect next spell',    color: '#e0e0ff', trail: '#ffffff' },

        // ── DARK ──
        { key: 'Z', name: 'Shadow Drain',   icon: '🌑', element: 'dark',      mana: 18, dmg: 12, cast: 900,  target: 'enemy', effect: 'drain',      desc: 'Steal 10 mana',         color: '#8040c0', trail: '#a060e0' },
        { key: 'X', name: 'Wither',          icon: '☠️', element: 'dark',      mana: 20, dmg: 18, cast: 1500, target: 'enemy', effect: 'wither',     desc: 'Reduce max HP by 10',   color: '#604080', trail: '#8060a0' },
        { key: 'C', name: 'Holy Beam',       icon: '✦',  element: 'dark',      mana: 26, dmg: 22, cast: 1600, target: 'enemy', effect: 'none',       desc: 'Pure dark damage',      color: '#6020a0', trail: '#8040c0' }
    ];

    // Meditation key
    const MEDITATE_KEY = 'M';

    // Elemental advantage: key beats value (1.5x damage)
    const ADVANTAGE = {
        fire: 'air', air: 'earth', earth: 'lightning', lightning: 'water', water: 'fire',
        light: 'dark', dark: 'light'
    };

    /* ════════════════════════════
       GAME STATE
    ════════════════════════════ */
    let canvas, ctx, overlay, running = false, gameLoop;
    let player, enemy, projectiles, particles, enemyTimer;
    let playerFx, enemyFx; // status effects
    let playerMeditating, enemyMeditating;
    let casting; // { idx, remaining, total } or null — current spell being precast

    const MANA_REGEN   = 1.5;  // base mana/sec (low — forces meditation)
    const MEDI_REGEN   = 8;    // mana/sec while meditating
    const HP_REGEN     = 1.5;  // hp/sec

    function newFighter(isPlayer) {
        return { hp: 100, maxHp: 100, mana: 100, maxMana: 100, shield: 0, x: isPlayer ? 0.18 : 0.82, y: 0.45 };
    }

    function newFx() {
        return { burn: null, poison: null, slow: null, stun: null, knock: null,
                 curse: null, bless: null, protection: null, reflect: false };
    }

    /* ════════════════════════════
       INIT / DESTROY
    ════════════════════════════ */
    function start() {
        if (running) return;
        running = true;
        player = newFighter(true);
        enemy  = newFighter(false);
        projectiles = [];
        particles = [];
        playerFx = newFx();
        enemyFx  = newFx();
        playerMeditating = false;
        enemyMeditating  = false;
        casting = null;
        enemyTimer = 2000 + Math.random() * 1000;

        buildUI();
        canvas = document.getElementById('duel-canvas');
        ctx = canvas.getContext('2d');
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // Show guide first, player starts when ready
        gameLoop = { last: performance.now(), running: true, paused: true };
        showGuide();
        requestAnimationFrame(tick);
    }

    /* ════════════════════════════
       GUIDE / SPELLBOOK
    ════════════════════════════ */
    function showGuide() {
        const elements = ['fire','water','earth','air','lightning','light','dark'];
        const elLabels = { fire:'🔥 Fire', water:'💧 Water', earth:'🌍 Earth', air:'💨 Air', lightning:'⚡ Lightning', light:'✦ Light', dark:'🌑 Dark' };

        let tableHTML = '';
        elements.forEach(el => {
            const group = SPELLS.filter(s => s.element === el);
            group.forEach((s, i) => {
                tableHTML += `<tr>
                    ${i === 0 ? `<td class="guide-el" rowspan="${group.length}">${elLabels[el]}</td>` : ''}
                    <td class="guide-key">${s.key}</td>
                    <td>${s.icon} ${s.name}</td>
                    <td>${s.mana}</td>
                    <td>${s.dmg || '—'}</td>
                    <td>${(s.cast / 1000).toFixed(1)}s</td>
                    <td class="guide-desc">${s.desc}</td>
                </tr>`;
            });
        });

        const guideEl = document.createElement('div');
        guideEl.id = 'duel-guide';
        guideEl.innerHTML = `
            <div class="guide-scroll">
                <h2 class="guide-title">⚔️ Arcane Duel — Spellbook</h2>

                <div class="guide-section">
                    <h3>How to Play</h3>
                    <ul>
                        <li>Press <b>spell keys</b> (or click buttons) to cast spells</li>
                        <li>Each spell has a <b>precast time</b> — you must wait for it to charge</li>
                        <li>Pressing another spell while casting <b>cancels</b> the current cast (mana lost)</li>
                        <li>Press <b>M</b> to <b>Meditate</b> — regenerates mana faster (+${MEDI_REGEN}/s), stops when you cast</li>
                        <li>Press <b>ESC</b> to leave the arena at any time</li>
                        <li>Being <b>Poisoned</b> blocks mana regeneration completely</li>
                        <li>Being <b>Cursed</b> slows casting speed by 40%, reduces HP regen and resistances</li>
                        <li><b>Magic Reflection</b> bounces the next incoming spell back to the caster</li>
                        <li><b>Dispel</b> removes ALL buffs and debuffs from yourself</li>
                    </ul>
                </div>

                <div class="guide-section">
                    <h3>Stats</h3>
                    <ul>
                        <li><b>HP</b>: 100 — regen ${HP_REGEN}/s (halved if cursed)</li>
                        <li><b>Mana</b>: 100 — regen ${MANA_REGEN}/s (${MEDI_REGEN}/s while meditating, 0 if poisoned)</li>
                        <li><b>Shield</b>: absorbs damage before HP (max 60)</li>
                    </ul>
                </div>

                <div class="guide-section">
                    <h3>Elemental Advantage (1.5x damage)</h3>
                    <p>Fire → Air → Earth → Lightning → Water → Fire<br>Light ↔ Dark (mutual weakness)</p>
                </div>

                <div class="guide-section">
                    <h3>All Spells</h3>
                    <table class="guide-table">
                        <thead><tr><th>Element</th><th>Key</th><th>Spell</th><th>Mana</th><th>Dmg</th><th>Cast</th><th>Effect</th></tr></thead>
                        <tbody>${tableHTML}</tbody>
                    </table>
                </div>

                <button class="guide-ready-btn" id="duel-ready-btn">⚔️ Ready to Fight!</button>
            </div>
        `;
        overlay.appendChild(guideEl);

        document.getElementById('duel-ready-btn').addEventListener('click', () => {
            guideEl.remove();
            runCountdown(3, () => {
                gameLoop.paused = false;
                document.addEventListener('keydown', handleKey);
            });
        });
    }

    function runCountdown(seconds, onComplete) {
        const el = document.getElementById('duel-result');
        if (!el) { onComplete(); return; }
        let remaining = seconds;

        el.style.color = 'var(--gold)';
        el.textContent = remaining;
        el.style.opacity = '1';

        const interval = setInterval(() => {
            remaining--;
            if (remaining > 0) {
                el.textContent = remaining;
            } else {
                el.textContent = '⚔️ FIGHT!';
                el.style.color = '#ff4040';
                clearInterval(interval);
                setTimeout(() => { el.style.opacity = '0'; }, 800);
                onComplete();
            }
        }, 1000);
    }

    function stop(won) {
        running = false;
        gameLoop.running = false;
        window.removeEventListener('resize', resizeCanvas);
        document.removeEventListener('keydown', handleKey);

        const result = document.getElementById('duel-result');
        if (result) {
            result.innerHTML = won
                ? '✦ Victory! The shadow fades... ✦<br><span class="duel-endmsg">Press ESC to leave or click below to fight again</span>'
                : '☠ Defeated... The darkness prevails ☠<br><span class="duel-endmsg">Press ESC to leave or click below to fight again</span>';
            result.style.color = won ? '#8aaf30' : '#ff4040';
            result.style.opacity = '1';
        }

        // Show rematch + exit buttons
        const btns = document.createElement('div');
        btns.className = 'duel-end-btns';
        btns.innerHTML = `
            <button class="duel-rematch-btn" id="duel-rematch">⚔️ Rematch</button>
            <button class="duel-exit-btn" id="duel-exit">ESC — Leave</button>
        `;
        overlay.appendChild(btns);

        document.getElementById('duel-rematch').addEventListener('click', () => {
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            overlay = null;
            start();
        });
        document.getElementById('duel-exit').addEventListener('click', closeGame);

        // ESC to exit
        document.addEventListener('keydown', escHandler);
    }

    function escHandler(e) {
        if (e.key === 'Escape') {
            document.removeEventListener('keydown', escHandler);
            closeGame();
        }
    }

    function closeGame() {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
    }

    function resizeCanvas() {
        if (!canvas) return;
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    }

    /* ════════════════════════════
       UI BUILD
    ════════════════════════════ */
    function buildUI() {
        // Group spells by element for the UI
        const elements = ['fire', 'water', 'earth', 'air', 'lightning', 'light', 'dark'];
        const labels   = ['🔥Fire', '💧Water', '🌍Earth', '💨Air', '⚡Lightning', '✦Light', '🌑Dark'];

        let spellBarHTML = '';
        elements.forEach((el, ei) => {
            const group = SPELLS.filter(s => s.element === el);
            spellBarHTML += `<div class="duel-spell-group"><div class="duel-spell-group-label">${labels[ei]}</div><div class="duel-spell-group-btns">`;
            group.forEach(s => {
                const idx = SPELLS.indexOf(s);
                spellBarHTML += `<button class="duel-spell-btn" data-idx="${idx}" title="${s.name}: ${s.desc} (${s.mana} mana)">
                    <span class="duel-spell-icon">${s.icon}</span>
                    <span class="duel-spell-name">${s.name}</span>
                    <span class="duel-spell-key">${s.key}</span>
                </button>`;
            });
            spellBarHTML += '</div></div>';
        });

        overlay = document.createElement('div');
        overlay.id = 'duel-overlay';
        overlay.innerHTML = `
            <canvas id="duel-canvas"></canvas>
            <div class="duel-hud">
                <div class="duel-col duel-player-stats">
                    <div class="duel-label">🧙 You</div>
                    <div class="duel-bar-wrap"><div class="duel-bar duel-hp" id="duel-p-hp"></div><span class="duel-bar-text" id="duel-p-hp-t">100</span></div>
                    <div class="duel-bar-wrap"><div class="duel-bar duel-mana" id="duel-p-mana"></div><span class="duel-bar-text" id="duel-p-mana-t">100</span></div>
                    <div class="duel-bar-wrap duel-shield-wrap"><div class="duel-bar duel-shield" id="duel-p-shield"></div><span class="duel-bar-text" id="duel-p-shield-t">0</span></div>
                    <div class="duel-fx-list" id="duel-p-fx"></div>
                </div>
                <div class="duel-col duel-enemy-stats">
                    <div class="duel-label">👤 Shadow Mage</div>
                    <div class="duel-bar-wrap"><div class="duel-bar duel-hp" id="duel-e-hp"></div><span class="duel-bar-text" id="duel-e-hp-t">100</span></div>
                    <div class="duel-bar-wrap"><div class="duel-bar duel-mana" id="duel-e-mana"></div><span class="duel-bar-text" id="duel-e-mana-t">100</span></div>
                    <div class="duel-fx-list" id="duel-e-fx"></div>
                </div>
            </div>
            <div class="duel-spell-bar" id="duel-spells">
                ${spellBarHTML}
                <div class="duel-spell-group">
                    <div class="duel-spell-group-label">🧘Meditate</div>
                    <div class="duel-spell-group-btns">
                        <button class="duel-spell-btn duel-meditate-btn" id="duel-meditate" title="Meditate: +${MEDI_REGEN} mana/s (stops on cast)">
                            <span class="duel-spell-icon">🧘</span>
                            <span class="duel-spell-key">M</span>
                        </button>
                    </div>
                </div>
            </div>
            <div class="duel-journals">
                <div class="duel-journal" id="duel-journal-player">
                    <div class="duel-journal-title">Your Journal</div>
                </div>
                <div class="duel-journal duel-journal-right" id="duel-journal-enemy">
                    <div class="duel-journal-title">Shadow Mage</div>
                </div>
            </div>
            <div class="duel-result" id="duel-result"></div>
            <div class="duel-gcd-bar" id="duel-gcd-bar"></div>
        `;
        root.appendChild(overlay);

        // Spell button clicks
        overlay.querySelectorAll('.duel-spell-btn:not(.duel-meditate-btn)').forEach(btn => {
            btn.addEventListener('click', () => castSpell(parseInt(btn.dataset.idx)));
        });
        document.getElementById('duel-meditate').addEventListener('click', toggleMeditate);
    }

    /* ════════════════════════════
       INPUT
    ════════════════════════════ */
    function handleKey(e) {
        const key = e.key.toUpperCase();
        if (key === 'ESCAPE') { closeGame(); running = false; if (gameLoop) gameLoop.running = false; return; }
        if (key === MEDITATE_KEY) { e.preventDefault(); toggleMeditate(); return; }

        const idx = SPELLS.findIndex(s => s.key === key);
        if (idx >= 0) {
            e.preventDefault();
            castSpell(idx);
        }
    }

    /* ════════════════════════════
       MEDITATION
    ════════════════════════════ */
    function toggleMeditate() {
        playerMeditating = !playerMeditating;
        const btn = document.getElementById('duel-meditate');
        if (btn) btn.classList.toggle('duel-spell-active', playerMeditating);
    }

    function breakMeditation() {
        if (playerMeditating) {
            playerMeditating = false;
            const btn = document.getElementById('duel-meditate');
            if (btn) btn.classList.remove('duel-spell-active');
        }
    }

    /* ════════════════════════════
       CAST SPELL (precast system)
    ════════════════════════════ */
    function castSpell(idx) {
        if (!running) return;
        const spell = SPELLS[idx];
        if (!spell || player.mana < spell.mana) return;

        // If already casting, pressing a new spell cancels the current cast
        if (casting) casting = null;

        // Casting breaks meditation
        breakMeditation();

        // Start precast — mana is consumed immediately
        player.mana -= spell.mana;
        casting = { idx, remaining: spell.cast, total: spell.cast };
        journal(false, `Casting <span class="j-spell">${spell.icon} ${spell.name}</span>...`);
    }

    // Called when precast completes
    function finishCast(idx) {
        const spell = SPELLS[idx];
        applySelfEffects(spell, player, playerFx, false);

        if (spell.target === 'enemy' || spell.target === 'enemy+self') {
            fireProjectile(player, enemy, spell, false);
        }
        casting = null;
    }

    function applySelfEffects(spell, caster, fx, isEnemy) {
        switch (spell.effect) {
            case 'shield':
                caster.shield = Math.min(60, caster.shield + 30);
                spawnParticles(caster.x, caster.y, spell.color, 12);
                journal(isEnemy, `<span class="j-buff">${spell.icon} +30 Shield</span>`);
                break;
            case 'heal':
                caster.hp = Math.min(caster.maxHp, caster.hp + 15);
                spawnParticles(caster.x, caster.y, '#ff8080', 10);
                journal(isEnemy, `<span class="j-heal">${spell.icon} Heal +15 HP</span>`);
                break;
            case 'gheal':
                caster.hp = Math.min(caster.maxHp, caster.hp + 35);
                spawnParticles(caster.x, caster.y, '#ff4060', 14);
                journal(isEnemy, `<span class="j-heal">${spell.icon} Greater Heal +35 HP</span>`);
                break;
            case 'cure':
                fx.poison = null;
                spawnParticles(caster.x, caster.y, '#60ff60', 10);
                journal(isEnemy, `<span class="j-heal">${spell.icon} Cured!</span>`);
                break;
            case 'dispel':
                Object.keys(fx).forEach(k => fx[k] = (k === 'reflect') ? false : null);
                spawnParticles(caster.x, caster.y, '#e0e0ff', 16);
                journal(isEnemy, `<span class="j-buff">${spell.icon} Dispel — all cleared</span>`);
                break;
            case 'bless':
                fx.bless = { remaining: 8000 };
                spawnParticles(caster.x, caster.y, '#f0f0ff', 12);
                journal(isEnemy, `<span class="j-buff">${spell.icon} Bless +20% dmg</span>`);
                break;
            case 'protection':
                fx.protection = { remaining: 8000 };
                spawnParticles(caster.x, caster.y, '#c0a050', 12);
                journal(isEnemy, `<span class="j-buff">${spell.icon} Protection +30% resist</span>`);
                break;
            case 'reflect':
                fx.reflect = true;
                spawnParticles(caster.x, caster.y, '#e0e0ff', 14);
                journal(isEnemy, `<span class="j-buff">${spell.icon} Magic Reflection active</span>`);
                break;
        }
    }

    function fireProjectile(from, to, spell, isEnemy) {
        projectiles.push({
            x: from.x, y: from.y,
            tx: to.x, ty: to.y,
            speed: 0.0013,
            spell, isEnemy,
            alive: true
        });
    }

    /* ════════════════════════════
       DAMAGE + EFFECTS ON HIT
    ════════════════════════════ */
    function applyHit(target, attacker, spell, isEnemy) {
        const tFx = isEnemy ? playerFx : enemyFx;
        const aFx = isEnemy ? enemyFx : playerFx;

        // Magic Reflection — bounce spell back
        if (tFx.reflect) {
            tFx.reflect = false;
            spawnParticles(target.x, target.y, '#e0e0ff', 16);
            journal(!isEnemy, `<span class="j-buff">🪞 Reflected ${spell.name}!</span>`);
            fireProjectile(target, attacker, spell, !isEnemy);
            return;
        }

        let dmg = spell.dmg;

        // Bless buff on attacker: +20% dmg
        if (aFx.bless && aFx.bless.remaining > 0) dmg = Math.round(dmg * 1.2);

        // Elemental advantage: 1.5x
        if (ADVANTAGE[spell.element] === (isEnemy ? getLastElement(playerFx) : getLastElement(enemyFx))) {
            dmg = Math.round(dmg * 1.5);
        }

        // Protection on target: -30% dmg
        if (tFx.protection && tFx.protection.remaining > 0) dmg = Math.round(dmg * 0.7);

        // Curse on target: -25% resist → +25% dmg taken
        if (tFx.curse && tFx.curse.remaining > 0) dmg = Math.round(dmg * 1.25);

        // Shield absorb
        if (target.shield > 0) {
            const absorbed = Math.min(target.shield, dmg);
            target.shield -= absorbed;
            dmg -= absorbed;
        }

        target.hp = Math.max(0, target.hp - dmg);

        // Journal the hit
        if (dmg > 0) journal(isEnemy, `<span class="j-spell">${spell.icon} ${spell.name}</span> <span class="j-dmg">-${dmg} HP</span>`);

        // Apply debuffs
        switch (spell.effect) {
            case 'burn':    tFx.burn   = { remaining: 3000, dps: 3 }; break;
            case 'poison':  tFx.poison = { remaining: 5000, dps: 4 }; break;
            case 'slow':    tFx.slow   = { remaining: 2500 }; break;
            case 'stun':    tFx.stun   = { remaining: 1500 }; break;
            case 'knock':   tFx.knock  = { remaining: 1200 }; break;
            case 'curse':   tFx.curse  = { remaining: 8000 }; break;
            case 'wither':  target.maxHp = Math.max(40, target.maxHp - 10); target.hp = Math.min(target.hp, target.maxHp); break;
            case 'drain':
                target.mana = Math.max(0, target.mana - 10);
                attacker.mana = Math.min(attacker.maxMana, attacker.mana + 10);
                break;
            case 'manavamp':
                target.mana = Math.max(0, target.mana - 15);
                attacker.mana = Math.min(attacker.maxMana, attacker.mana + 15);
                break;
        }

        spawnParticles(target.x, target.y, spell.color, 15);
    }

    function getLastElement() { return ''; } // simplified

    /* ════════════════════════════
       PARTICLES
    ════════════════════════════ */
    function spawnParticles(x, y, color, count) {
        for (let i = 0; i < count; i++) {
            particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 0.008,
                vy: (Math.random() - 0.5) * 0.008,
                life: 500 + Math.random() * 400,
                maxLife: 500 + Math.random() * 400,
                color,
                size: 2 + Math.random() * 3
            });
        }
    }

    /* ════════════════════════════
       AI — smarter with new spells
    ════════════════════════════ */
    function aiThink(dt) {
        if (enemyFx.stun && enemyFx.stun.remaining > 0) return;
        if (enemyFx.knock && enemyFx.knock.remaining > 0) return;

        const slowMult = (enemyFx.slow && enemyFx.slow.remaining > 0) ? 2 : 1;
        enemyTimer -= dt / slowMult;
        if (enemyTimer > 0) return;

        const affordable = SPELLS.filter(s => enemy.mana >= s.mana);
        if (!affordable.length) {
            // AI meditates when out of mana
            enemyMeditating = true;
            enemyTimer = 800;
            return;
        }

        // Break meditation on cast
        enemyMeditating = false;

        let spell = null;

        // Priority decisions
        if (enemy.hp < 25 && canCast('Greater Heal')) {
            spell = byName('Greater Heal');
        } else if (enemyFx.poison && canCast('Cure')) {
            spell = byName('Cure');
        } else if (enemy.hp < 45 && canCast('Heal')) {
            spell = byName('Heal');
        } else if (!enemyFx.reflect && enemy.hp < 60 && canCast('Magic Reflection')) {
            spell = byName('Magic Reflection');
        } else if (!enemyFx.protection && canCast('Protection') && Math.random() < 0.3) {
            spell = byName('Protection');
        } else if (!enemyFx.bless && canCast('Bless') && Math.random() < 0.3) {
            spell = byName('Bless');
        } else if (!playerFx.poison && canCast('Poison') && Math.random() < 0.4) {
            spell = byName('Poison');
        } else if (!playerFx.curse && canCast('Curse') && Math.random() < 0.3) {
            spell = byName('Curse');
        } else {
            // Random attack
            const attacks = affordable.filter(s => s.dmg > 0 && s.target === 'enemy');
            spell = attacks.length ? attacks[Math.floor(Math.random() * attacks.length)] : affordable[0];
        }

        if (!spell) { enemyTimer = 600; return; }

        enemy.mana -= spell.mana;

        // Apply self-targeting effects
        if (spell.target === 'self') {
            applySelfEffects(spell, enemy, enemyFx, true);
        } else {
            fireProjectile(enemy, player, spell, true);
            journal(true, `Casts <span class="j-spell">${spell.icon} ${spell.name}</span>`);
        }

        enemyTimer = 1800 + Math.random() * 1500;
    }

    function canCast(name) { const s = byName(name); return s && enemy.mana >= s.mana; }
    function byName(name) { return SPELLS.find(s => s.name === name); }

    /* ════════════════════════════
       GAME LOOP
    ════════════════════════════ */
    function tick(now) {
        if (!gameLoop.running) return;
        const dt = Math.min(now - gameLoop.last, 50);
        gameLoop.last = now;

        if (!gameLoop.paused) {
            update(dt);
            updateUI();
        }
        draw(); // always draw (shows mages during countdown)

        if (player.hp <= 0) { stop(false); return; }
        if (enemy.hp <= 0) { stop(true); return; }

        requestAnimationFrame(tick);
    }

    function update(dt) {
        const sec = dt / 1000;

        // ── Mana regen (poison blocks it) ──
        const pPoisoned = playerFx.poison && playerFx.poison.remaining > 0;
        const ePoisoned = enemyFx.poison && enemyFx.poison.remaining > 0;

        if (!pPoisoned) {
            const pManaRate = playerMeditating ? MEDI_REGEN : MANA_REGEN;
            player.mana = Math.min(player.maxMana, player.mana + pManaRate * sec);
        }
        if (!ePoisoned) {
            const eManaRate = enemyMeditating ? MEDI_REGEN : MANA_REGEN;
            enemy.mana = Math.min(enemy.maxMana, enemy.mana + eManaRate * sec);
        }

        // ── HP regen (curse reduces it) ──
        const pCursed = playerFx.curse && playerFx.curse.remaining > 0;
        const eCursed = enemyFx.curse && enemyFx.curse.remaining > 0;
        player.hp = Math.min(player.maxHp, player.hp + (pCursed ? HP_REGEN * 0.5 : HP_REGEN) * sec);
        enemy.hp  = Math.min(enemy.maxHp,  enemy.hp  + (eCursed ? HP_REGEN * 0.5 : HP_REGEN) * sec);

        // ── Precast timer ──
        if (casting) {
            // Curse slows casting by 40%
            const castSpeed = (playerFx.curse && playerFx.curse.remaining > 0) ? 0.6 : 1;
            casting.remaining -= dt * castSpeed;
            const gcdBar = document.getElementById('duel-gcd-bar');
            if (gcdBar) gcdBar.style.width = (casting.remaining / casting.total * 100) + '%';
            if (casting.remaining <= 0) {
                finishCast(casting.idx);
                if (gcdBar) gcdBar.style.width = '0%';
            }
        }

        // ── Status effects tick ──
        tickEffects(dt, playerFx, player);
        tickEffects(dt, enemyFx, enemy);

        // ── AI ──
        aiThink(dt);

        // ── Projectiles ──
        for (const p of projectiles) {
            if (!p.alive) continue;
            const dx = p.tx - p.x, dy = p.ty - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.02) {
                p.alive = false;
                applyHit(p.isEnemy ? player : enemy, p.isEnemy ? enemy : player, p.spell, p.isEnemy);
                continue;
            }
            const move = p.speed * dt;
            p.x += (dx / dist) * move;
            p.y += (dy / dist) * move;

            if (Math.random() < 0.4) {
                particles.push({
                    x: p.x + (Math.random() - 0.5) * 0.01,
                    y: p.y + (Math.random() - 0.5) * 0.01,
                    vx: (Math.random() - 0.5) * 0.001,
                    vy: (Math.random() - 0.5) * 0.001,
                    life: 300, maxLife: 300,
                    color: p.spell.trail,
                    size: 1 + Math.random() * 2
                });
            }
        }
        projectiles = projectiles.filter(p => p.alive);

        // ── Particles ──
        for (const p of particles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
        }
        particles = particles.filter(p => p.life > 0);
    }

    function tickEffects(dt, fx, target) {
        if (fx.burn && fx.burn.remaining > 0) {
            fx.burn.remaining -= dt;
            target.hp = Math.max(0, target.hp - fx.burn.dps * dt / 1000);
            if (fx.burn.remaining <= 0) fx.burn = null;
        }
        if (fx.poison && fx.poison.remaining > 0) {
            fx.poison.remaining -= dt;
            target.hp = Math.max(0, target.hp - fx.poison.dps * dt / 1000);
            if (fx.poison.remaining <= 0) fx.poison = null;
        }
        if (fx.slow && fx.slow.remaining > 0) { fx.slow.remaining -= dt; if (fx.slow.remaining <= 0) fx.slow = null; }
        if (fx.stun && fx.stun.remaining > 0) { fx.stun.remaining -= dt; if (fx.stun.remaining <= 0) fx.stun = null; }
        if (fx.knock && fx.knock.remaining > 0) { fx.knock.remaining -= dt; if (fx.knock.remaining <= 0) fx.knock = null; }
        if (fx.curse && fx.curse.remaining > 0) { fx.curse.remaining -= dt; if (fx.curse.remaining <= 0) fx.curse = null; }
        if (fx.bless && fx.bless.remaining > 0) { fx.bless.remaining -= dt; if (fx.bless.remaining <= 0) fx.bless = null; }
        if (fx.protection && fx.protection.remaining > 0) { fx.protection.remaining -= dt; if (fx.protection.remaining <= 0) fx.protection = null; }
    }

    /* ════════════════════════════
       DRAW
    ════════════════════════════ */
    function draw() {
        if (!ctx || !canvas.width) return;
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        drawMage(player.x * W, player.y * H, '🧙', 36, false, playerMeditating, playerFx);
        drawMage(enemy.x * W, enemy.y * H, '🧙', 36, true, enemyMeditating, enemyFx);

        for (const p of projectiles) {
            const px = p.x * W, py = p.y * H;
            ctx.save();
            ctx.beginPath();
            ctx.arc(px, py, 7, 0, Math.PI * 2);
            ctx.fillStyle = p.spell.color;
            ctx.shadowColor = p.spell.color;
            ctx.shadowBlur = 20;
            ctx.fill();
            ctx.restore();
        }

        for (const p of particles) {
            const alpha = p.life / p.maxLife;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(p.x * W, p.y * H, p.size * alpha, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 6;
            ctx.fill();
            ctx.restore();
        }
    }

    function drawMage(x, y, emoji, size, flip, meditating, fx) {
        ctx.save();
        ctx.font = `${size}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (flip) {
            ctx.translate(x, y);
            ctx.scale(-1, 1);
            ctx.fillText(emoji, 0, 0);
        } else {
            ctx.fillText(emoji, x, y);
        }
        ctx.restore();

        // Glow under mage
        const glowColor = meditating ? 'rgba(60,120,255,0.25)' : 'rgba(167,139,250,0.15)';
        ctx.save();
        const grad = ctx.createRadialGradient(x, y + size * 0.6, 0, x, y + size * 0.6, size * 1.2);
        grad.addColorStop(0, glowColor);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(x - size * 1.2, y - size * 0.3, size * 2.4, size * 1.5);
        ctx.restore();

        // Meditation aura
        if (meditating) {
            ctx.save();
            ctx.globalAlpha = 0.3 + 0.15 * Math.sin(performance.now() * 0.004);
            ctx.beginPath();
            ctx.arc(x, y, size * 0.8, 0, Math.PI * 2);
            ctx.strokeStyle = '#60a0ff';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#60a0ff';
            ctx.shadowBlur = 12;
            ctx.stroke();
            ctx.restore();
        }

        // Reflect aura
        if (fx.reflect) {
            ctx.save();
            ctx.globalAlpha = 0.4 + 0.2 * Math.sin(performance.now() * 0.005);
            ctx.beginPath();
            ctx.arc(x, y, size * 0.9, 0, Math.PI * 2);
            ctx.strokeStyle = '#e0e0ff';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#e0e0ff';
            ctx.shadowBlur = 14;
            ctx.stroke();
            ctx.restore();
        }
    }

    /* ════════════════════════════
       UI UPDATE
    ════════════════════════════ */
    function updateUI() {
        setBar('duel-p-hp', player.hp, player.maxHp, 'duel-p-hp-t');
        setBar('duel-p-mana', player.mana, player.maxMana, 'duel-p-mana-t');
        setBar('duel-p-shield', player.shield, 60, 'duel-p-shield-t');
        setBar('duel-e-hp', enemy.hp, enemy.maxHp, 'duel-e-hp-t');
        setBar('duel-e-mana', enemy.mana, enemy.maxMana, 'duel-e-mana-t');

        // Active effects display
        renderFxList('duel-p-fx', playerFx, playerMeditating);
        renderFxList('duel-e-fx', enemyFx, enemyMeditating);

        // Disable spell buttons if not enough mana, highlight casting spell
        overlay.querySelectorAll('.duel-spell-btn:not(.duel-meditate-btn)').forEach(btn => {
            const idx = parseInt(btn.dataset.idx);
            const spell = SPELLS[idx];
            btn.classList.toggle('duel-spell-disabled', player.mana < spell.mana);
            btn.classList.toggle('duel-spell-casting', casting && casting.idx === idx);
        });
    }

    function renderFxList(id, fx, meditating) {
        const el = document.getElementById(id);
        if (!el) return;
        let html = '';
        if (meditating) html += '<span class="duel-fx-tag duel-fx-buff">🧘</span>';
        if (fx.reflect) html += '<span class="duel-fx-tag duel-fx-buff">🪞</span>';
        if (fx.bless && fx.bless.remaining > 0) html += '<span class="duel-fx-tag duel-fx-buff">🕊️</span>';
        if (fx.protection && fx.protection.remaining > 0) html += '<span class="duel-fx-tag duel-fx-buff">🛡️</span>';
        if (fx.burn && fx.burn.remaining > 0) html += '<span class="duel-fx-tag duel-fx-debuff">🔥</span>';
        if (fx.poison && fx.poison.remaining > 0) html += '<span class="duel-fx-tag duel-fx-debuff">🐍</span>';
        if (fx.curse && fx.curse.remaining > 0) html += '<span class="duel-fx-tag duel-fx-debuff">💀</span>';
        if (fx.slow && fx.slow.remaining > 0) html += '<span class="duel-fx-tag duel-fx-debuff">❄️</span>';
        if (fx.stun && fx.stun.remaining > 0) html += '<span class="duel-fx-tag duel-fx-debuff">💫</span>';
        el.innerHTML = html;
    }

    /* ════════════════════════════
       JOURNAL
    ════════════════════════════ */
    function journal(isEnemy, text) {
        const id = isEnemy ? 'duel-journal-enemy' : 'duel-journal-player';
        const el = document.getElementById(id);
        if (!el) return;
        const now = new Date();
        const ts = `${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const entry = document.createElement('div');
        entry.className = 'duel-journal-entry';
        if (isEnemy) {
            entry.innerHTML = `${text} <span class="j-time">${ts}</span>`;
        } else {
            entry.innerHTML = `<span class="j-time">${ts}</span>${text}`;
        }
        el.appendChild(entry);
        el.scrollTop = el.scrollHeight;
    }

    function setBar(barId, val, max, textId) {
        const bar = document.getElementById(barId);
        const text = document.getElementById(textId);
        if (bar) bar.style.width = Math.max(0, val / max * 100) + '%';
        if (text) text.textContent = Math.round(Math.max(0, val));
    }

    /* ════════════════════════════
       MOUNT ENTRY + CLEANUP
    ════════════════════════════ */
    // Expose cleanup for unmount().
    root.__arcaneDuelCleanup = () => {
        running = false;
        if (gameLoop) gameLoop.running = false;
        try { window.removeEventListener('resize', resizeCanvas); } catch {}
        try { document.removeEventListener('keydown', handleKey); } catch {}
        try { document.removeEventListener('keydown', escHandler); } catch {}
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
    };

    start();
  },

  async unmount(root, sdk) {
    try { root.__arcaneDuelCleanup?.(); } catch {}
    delete root.__arcaneDuelCleanup;
  }
};
