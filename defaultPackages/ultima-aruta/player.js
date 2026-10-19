/* Ultima Aruta — player.js: Player class */

class Player {
    constructor(wx, wy) {
        this.wx = wx; this.wy = wy;
        this.rx = wx; this.ry = wy;
        this.moveT = 0;
        this._moveDur = MOVE_MS; // actual duration of current move (for tween)
        this.moveFrom = { wx, wy };
        this.emoji = '🧙';
        this.hp = 100; this.maxHp = 100;
        this.mana = 50; this.maxMana = 50;
        this.stamina = 100; this.maxStamina = 100;
        // Hunger decays passively; food items (use.hunger) refill it.
        // Reaching 0 stops natural HP regen and tickles damage over time.
        this.hunger = 100; this.maxHunger = 100;
        this.level = 1; this.xp = 0; this.xpNext = 20;
        this.attackCooldown = 0;
        this.baseDmg = 5;
        this.kills = 0;
        this.days = 0;
        this.poison = 0;
        this.poisonDps = 0;
        // UO-style classless skill XP. Each action bumps the relevant counter
        // via addSkillXp (defined in index.js). Level is computed on the fly
        // from XP so we don't track two parallel numbers per skill.
        this.skills = {
            woodcutting: 0,
            mining:      0,
            cooking:     0,
            fishing:     0,
            taming:      0,
            combat:      0,
        };
        // Running counters for milestones + Stats panel flavor.
        this.crafted = 0;
    }

    /**
     * Try to move one tile in direction (dx, dy).
     * @param {number} dx — world X step (-1, 0, +1)
     * @param {number} dy — world Y step (-1, 0, +1)
     * @param {function} canPass — (wx, wy) → boolean
     * @param {'walk'|'swim'|'sail'} mode — traversal mode
     * @returns {boolean} true if moved
     */
    tryMove(dx, dy, canPass, mode = 'walk') {
        if (this.moveT > 0) return false;
        const nx = this.wx + dx, ny = this.wy + dy;
        if (!canPass(nx, ny)) return false;

        this.moveFrom = { wx: this.wx, wy: this.wy };
        this.wx = nx; this.wy = ny;

        // Stamina cost from mode.
        const cost = STAMINA_COST[mode] || 2;
        this.stamina = Math.max(0, this.stamina - cost);

        // Speed from mode + exhaustion.
        const speedMult = SPEED[mode] || 1;
        const exhaustMult = this.stamina > 0 ? 1 : SPEED.exhausted;
        this._moveDur = Math.round(MOVE_MS * speedMult * exhaustMult);
        this.moveT = this._moveDur;

        // Footstep SFX — vary by mode.
        try {
            if (mode === 'swim')      _sfx(200, 0.05, 'sine', 0.02);
            else if (mode === 'sail') _sfx(160, 0.06, 'triangle', 0.015);
            else                      _sfx(100 + Math.random() * 60, 0.04, 'triangle', 0.02);
        } catch {}

        return true;
    }

    update(dt) {
        if (this.moveT > 0) {
            this.moveT = Math.max(0, this.moveT - dt);
            const t = 1 - (this.moveT / this._moveDur);
            this.rx = this.moveFrom.wx + (this.wx - this.moveFrom.wx) * t;
            this.ry = this.moveFrom.wy + (this.wy - this.moveFrom.wy) * t;
        } else {
            this.rx = this.wx; this.ry = this.wy;
        }

        // Hunger decay: ~1 point per 12 s (100 → 0 in ~20 min).
        if (typeof this.hunger === 'number' && this.maxHunger) {
            this.hunger = Math.max(0, this.hunger - dt / 12000);
            // Starvation drains HP slowly while hunger is empty.
            if (this.hunger <= 0) {
                this.hp = Math.max(0, this.hp - dt / 2000); // 0.5 HP/s
            }
        }
    }
}
