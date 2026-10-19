/* Ultima Aruta — engine.js: noise, World, dungeon, rendering, SFX */
function generateDungeon(dungeonId) {
    const rnd = mulberry32(dungeonId);
    const N = DUNGEON_SIZE;
    const biomes = new Array(N * N).fill('cave_wall');
    const elevations = new Float32Array(N * N).fill(0.5);
    const features = [];
    const creatures = [];

    // Carve rooms + corridors.
    const rooms = [];
    for (let i = 0; i < 6; i++) {
        const rw = 3 + Math.floor(rnd() * 4);
        const rh = 3 + Math.floor(rnd() * 4);
        const rx = 1 + Math.floor(rnd() * (N - rw - 2));
        const ry = 1 + Math.floor(rnd() * (N - rh - 2));
        rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: Math.floor(rx + rw / 2), cy: Math.floor(ry + rh / 2) });
        for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) biomes[y * N + x] = 'cave_floor';
    }
    for (let i = 1; i < rooms.length; i++) {
        let cx = rooms[i - 1].cx, cy = rooms[i - 1].cy;
        const tx = rooms[i].cx, ty = rooms[i].cy;
        while (cx !== tx) { biomes[cy * N + cx] = 'cave_floor'; cx += Math.sign(tx - cx); }
        while (cy !== ty) { biomes[cy * N + cx] = 'cave_floor'; cy += Math.sign(ty - cy); }
    }
    const exitRoom = rooms[0];
    biomes[exitRoom.cy * N + exitRoom.cx] = 'exit';
    features.push({ c: exitRoom.cx, r: exitRoom.cy, emoji: '🪜', isExit: true });
    const lastRoom = rooms[rooms.length - 1];
    for (let i = 0; i < 4; i++) {
        const lx = lastRoom.x + Math.floor(rnd() * lastRoom.w);
        const ly = lastRoom.y + Math.floor(rnd() * lastRoom.h);
        if (biomes[ly * N + lx] === 'cave_floor') biomes[ly * N + lx] = 'lava';
    }
    // Treasure chests — at least 1 per room (except the exit room).
    // Last room has guaranteed rare loot.
    const commonPool = ['gold', 'gold', 'gold', 'gem', 'potion', 'herb', 'berry', 'scroll', 'iron'];
    const rarePool   = ['sword', 'shield', 'helm', 'armor', 'bow', 'spellbook', 'crown', 'ring', 'necklace', 'treasure_map', 'iron', 'iron'];
    for (let i = 1; i < rooms.length; i++) {
        const chestCount = i === rooms.length - 1 ? 2 : (rnd() < 0.7 ? 1 : 0);
        for (let j = 0; j < chestCount; j++) {
            const tc = rooms[i].x + Math.floor(rnd() * rooms[i].w);
            const tr = rooms[i].y + Math.floor(rnd() * rooms[i].h);
            if (biomes[tr * N + tc] !== 'cave_floor') continue;
            if (features.find(f => f.c === tc && f.r === tr)) continue;
            const isRare = i === rooms.length - 1 || rnd() < 0.25;
            const pool = isRare ? rarePool : commonPool;
            features.push({ c: tc, r: tr, emoji: '🧰', item: true, itemKey: pool[Math.floor(rnd() * pool.length)], chest: true });
        }
    }
    for (let i = 1; i < rooms.length; i++) {
        const isLast = i === rooms.length - 1;
        const count = isLast ? 1 : 1 + Math.floor(rnd() * 3);
        for (let j = 0; j < count; j++) {
            const cc = rooms[i].x + Math.floor(rnd() * rooms[i].w);
            const cr2 = rooms[i].y + Math.floor(rnd() * rooms[i].h);
            if (biomes[cr2 * N + cc] !== 'cave_floor') continue;
            if (isLast && j === 0) {
                // BOSS — stronger unique creature in the deepest room.
                const bossPool = [
                    { emoji: '🐲', hp: 100, dmg: 15, xp: 40 },
                    { emoji: '👹', hp: 80,  dmg: 12, xp: 30 },
                    { emoji: '🧟', hp: 70,  dmg: 10, xp: 25 },
                    { emoji: '👿', hp: 110, dmg: 16, xp: 45 },
                    { emoji: '🧌', hp: 90,  dmg: 13, xp: 35 },
                ];
                const boss = bossPool[Math.floor(rnd() * bossPool.length)];
                creatures.push({
                    c: cc, r: cr2, rc: cc, rr: cr2, fromC: cc, fromR: cr2, moveT: 0,
                    emoji: boss.emoji, biome: 'cave_floor',
                    nextMoveAt: 600, timer: 0,
                    hp: boss.hp, maxHp: boss.hp, ai: 'aggressive', dmg: boss.dmg,
                    attackCooldown: 0, dead: false, isBoss: true,
                });
            } else {
                const def = DUNGEON_CREATURES[Math.floor(rnd() * DUNGEON_CREATURES.length)];
                creatures.push({
                    c: cc, r: cr2, rc: cc, rr: cr2, fromC: cc, fromR: cr2, moveT: 0,
                    emoji: def.emoji, biome: 'cave_floor',
                    nextMoveAt: 800 + rnd() * 3000, timer: 0,
                    hp: def.hp, maxHp: def.hp, ai: def.ai, dmg: def.dmg,
                    attackCooldown: 0, dead: false,
                });
            }
        }
    }
    // Dungeon atmosphere decorations: candles + cobwebs on corridor/room edges.
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        if (biomes[y * N + x] !== 'cave_floor') continue;
        if (features.find(f => f.c === x && f.r === y)) continue;
        // Place candle next to a wall.
        const wallAdj = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => biomes[(y+dy)*N+(x+dx)] === 'cave_wall');
        if (wallAdj && rnd() < 0.06) features.push({ c: x, r: y, emoji: '🕯️' });
        else if (wallAdj && rnd() < 0.04) features.push({ c: x, r: y, emoji: '🕸️' });
        else if (rnd() < 0.01) features.push({ c: x, r: y, emoji: '🪦' });
    }
    return { biomes, elevations, features, creatures, N, spawnX: exitRoom.cx, spawnY: exitRoom.cy };
}

// ── Seeded RNG (Mulberry32) ───────────���──────────���───────
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Deterministic hash-based value noise (fast, good enough for biomes)
function hash2(x, y, seed) {
    let h = x * 374761393 + y * 668265263 + seed * 2147483647;
    h = (h ^ (h >> 13)) * 1274126177;
    h = (h ^ (h >> 16)) >>> 0;
    return h / 4294967295;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise2D(x, y, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = x0 + 1, y1 = y0 + 1;
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const n00 = hash2(x0, y0, seed);
    const n10 = hash2(x1, y0, seed);
    const n01 = hash2(x0, y1, seed);
    const n11 = hash2(x1, y1, seed);
    return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fy);
}

// Fractal noise: sum octaves for natural terrain.
function fbm2D(x, y, seed, octaves = 4, persistence = 0.5) {
    let total = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
        total += valueNoise2D(x * freq, y * freq, seed + i * 101) * amp;
        max += amp; amp *= persistence; freq *= 2;
    }
    return total / max;
}

// ── World ────────────────────────────────────────────────
class World {
    constructor(seed) {
        this.seed = seed >>> 0;
        this.chunks = new Map(); // "cx,cy" -> { tiles: Uint8Array(CHUNK_SIZE²), features: Array<{c,r,emoji}>, biomeIds: Uint8Array }
        this._biomeKeys = Object.keys(BIOMES);
    }

    _chunkKey(cx, cy) { return cx + ',' + cy; }

    getChunk(cx, cy) {
        const key = this._chunkKey(cx, cy);
        let ch = this.chunks.get(key);
        if (!ch) { ch = this._generate(cx, cy); this.chunks.set(key, ch); }
        return ch;
    }

    _generate(cx, cy) {
        const N = CHUNK_SIZE;
        const biomes = new Array(N * N);
        const elevations = new Float32Array(N * N);
        const features = [];
        const rnd = mulberry32(this.seed ^ (cx * 73856093) ^ (cy * 19349663));

        for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
                const wx = cx * N + c;
                const wy = cy * N + r;
                // Two noise fields: elevation + moisture.
                // Large-scale continental shelf (low freq) + local detail (high freq).
                const continental = fbm2D(wx / 200, wy / 200, this.seed + 777, 2, 0.5);
                const detail      = fbm2D(wx / 50,  wy / 50,  this.seed, 4, 0.5);
                const elev = continental * 0.6 + detail * 0.4;
                const moist = fbm2D(wx / 120, wy / 120, this.seed + 9999, 3, 0.5);
                const biome = this._classify(elev, moist);
                biomes[r * N + c] = biome;
                elevations[r * N + c] = elev;

                // Feature roll
                const feats = FEATURES[biome];
                if (feats) {
                    const roll = rnd();
                    let acc = 0;
                    for (const f of feats) {
                        acc += f.rate;
                        if (roll < acc) { features.push({ c, r, emoji: f.emoji }); break; }
                    }
                }

                // Loose item scatter — independent of the scenic feature roll.
                const drops = ITEM_DROPS[biome];
                if (drops && BIOMES[biome].passable) {
                    const roll = rnd();
                    let acc = 0;
                    for (const d of drops) {
                        acc += d.rate;
                        if (roll < acc) {
                            features.push({ c, r, emoji: ITEMS[d.key].emoji, item: true, itemKey: d.key });
                            break;
                        }
                    }
                }
            }
        }

        // ── Village placement ──────────────────────────────
        // ~8% of chunks get a village. Find the largest flat grass patch
        // around the chunk center; if big enough, carve a small settlement.
        if (rnd() < 0.14) {
            this._maybePlaceVillage(cx, cy, biomes, features, rnd);
        }

        // ── Dungeon / crypt entrance placement ──────────────
        // ~6% of chunks get a dungeon. Priority: mountain foothills (cave
        // entrance at the base of a mountain). Fallback: forest crypt.
        if (rnd() < 0.06) {
            let placed = false;
            const N2 = CHUNK_SIZE;
            // Pass 1: find a passable cell adjacent to a mountain tile.
            for (let attempts = 0; attempts < 30 && !placed; attempts++) {
                const lc = Math.floor(rnd() * N2);
                const lr = Math.floor(rnd() * N2);
                const b = biomes[lr * N2 + lc];
                if (!BIOMES[b]?.passable) continue;
                if (features.find(f => f.c === lc && f.r === lr)) continue;
                // Check if any neighbour is mountain.
                let nearMtn = false;
                for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                    const nc = lc + dx, nr = lr + dy;
                    if (nc >= 0 && nc < N2 && nr >= 0 && nr < N2 && biomes[nr * N2 + nc] === 'mountain') nearMtn = true;
                }
                if (!nearMtn) continue;
                features.push({ c: lc, r: lr, emoji: '⛰️', dungeon: true,
                    dungeonId: (this.seed ^ (cx * 31) ^ (cy * 17) ^ lc ^ lr * 911) >>> 0 });
                placed = true;
            }
            // Pass 2 fallback: forest crypt.
            if (!placed) {
                for (let attempts = 0; attempts < 20; attempts++) {
                    const lc = Math.floor(rnd() * N2);
                    const lr = Math.floor(rnd() * N2);
                    const b = biomes[lr * N2 + lc];
                    if (b !== 'forest' && b !== 'grass') continue;
                    if (features.find(f => f.c === lc && f.r === lr)) continue;
                    const emoji = rnd() < 0.5 ? '🕳️' : '🏚️';
                    features.push({ c: lc, r: lr, emoji, dungeon: true,
                        dungeonId: (this.seed ^ (cx * 31) ^ (cy * 17) ^ lc ^ lr * 911) >>> 0 });
                    break;
                }
            }
        }

        // ── Ambient creatures ──────────────────────────────
        // Creature positions are stored in chunk-local coords; world coord
        // reads add the chunk origin. We also track a per-creature random-
        // walk timer so the AI ticks independently per creature.
        const creatures = [];
        const rule = null; // picked per-cell below via biome
        // Spawn up to N creatures in this chunk based on the dominant biomes.
        const biomeCount = {};
        for (const b of biomes) biomeCount[b] = (biomeCount[b] || 0) + 1;
        for (const [bKey, rule2] of Object.entries(CREATURES)) {
            if ((biomeCount[bKey] || 0) < 20) continue;
            const target = rule2.count;
            let placed = 0, attempts = 0;
            while (placed < target && attempts < 40) {
                attempts++;
                const lc = Math.floor(rnd() * N), lr = Math.floor(rnd() * N);
                if (biomes[lr * N + lc] !== bKey) continue;
                // Don't spawn on a blocking feature tile.
                if (features.find(f => f.c === lc && f.r === lr && f.blocks)) continue;
                const em = rule2.pool[Math.floor(rnd() * rule2.pool.length)];
                const def = CREATURE_DEFS[em] || { ai: 'neutral', hp: 10, dmg: 2, xp: 1, loot: [] };
                creatures.push({
                    c: lc, r: lr,
                    rc: lc, rr: lr,
                    fromC: lc, fromR: lr,
                    moveT: 0,
                    emoji: em,
                    biome: bKey,
                    nextMoveAt: 800 + rnd() * 4000,
                    timer: 0,
                    hp: def.hp, maxHp: def.hp,
                    ai: def.ai, dmg: def.dmg,
                    attackCooldown: 0,
                    dead: false,
                });
                placed++;
            }
        }

        return { cx, cy, biomes, elevations, features, creatures };
    }

    /** Try to find a ~5×5 mostly-grass patch near the chunk centre and
     *  stamp a small village (houses around a central landmark) + NPCs. */
    _maybePlaceVillage(cx, cy, biomes, features, rnd) {
        const N = CHUNK_SIZE;
        const centerC = Math.floor(N / 2), centerR = Math.floor(N / 2);
        // Probe offsets spiralling out from centre.
        const probes = [];
        for (let dr = -8; dr <= 8; dr++) for (let dc = -8; dc <= 8; dc++) probes.push([dc, dr]);
        probes.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
        for (const [dc, dr] of probes) {
            const oc = centerC + dc, or = centerR + dr;
            if (oc < 2 || or < 2 || oc > N - 3 || or > N - 3) continue;
            // Check 5×5 area is mostly grass (no mountain/water).
            let grass = 0, bad = 0;
            for (let r = or - 2; r <= or + 2; r++) {
                for (let c = oc - 2; c <= oc + 2; c++) {
                    const b = biomes[r * N + c];
                    if (b === 'grass' || b === 'forest') grass++;
                    else if (!BIOMES[b].passable) bad++;
                }
            }
            if (bad > 0 || grass < 20) continue;

            // Clear any existing features in the 5×5 area so the village
            // gets a clean footprint.
            for (let i = features.length - 1; i >= 0; i--) {
                const f = features[i];
                if (f.c >= oc - 2 && f.c <= oc + 2 && f.r >= or - 2 && f.r <= or + 2) features.splice(i, 1);
            }

            // Pave the village area with sand (dirt paths).
            for (let pr = or - 1; pr <= or + 1; pr++) {
                for (let pc = oc - 1; pc <= oc + 1; pc++) {
                    if (pr >= 0 && pr < N && pc >= 0 && pc < N) biomes[pr * N + pc] = 'sand';
                }
            }
            // Cross paths to houses.
            for (const [hc, hr] of [[-2,0],[2,0],[0,-2],[0,2]]) {
                const pc = oc + hc, pr2 = or + hr;
                if (pc >= 0 && pc < N && pr2 >= 0 && pr2 < N) biomes[pr2 * N + pc] = 'sand';
                const mc = oc + Math.sign(hc), mr = or + Math.sign(hr);
                if (mc >= 0 && mc < N && mr >= 0 && mr < N) biomes[mr * N + mc] = 'sand';
            }

            // Landmark at the centre.
            const landmark = VILLAGE.centers[Math.floor(rnd() * VILLAGE.centers.length)];
            features.push({ c: oc, r: or, emoji: landmark, blocks: true, village: true });

            // 4 houses at the cardinal +2 cells (skip diagonals for visibility).
            const houseSpots = [[-2,0],[2,0],[0,-2],[0,2]];
            for (const [hc, hr] of houseSpots) {
                if (rnd() < 0.15) continue; // slight variety
                features.push({ c: oc + hc, r: or + hr, emoji: VILLAGE.houses[Math.floor(rnd() * VILLAGE.houses.length)], blocks: true, village: true });
            }
            // 1-2 dialog NPCs near the centre.
            const npcCount = 1 + Math.floor(rnd() * 2);
            for (let i = 0; i < npcCount; i++) {
                const c = oc + (Math.floor(rnd() * 3) - 1);
                const r = or + 1 + Math.floor(rnd() * 2);
                if (features.find(f => f.c === c && f.r === r)) continue;
                features.push({
                    c, r,
                    emoji: VILLAGE.npcs[Math.floor(rnd() * VILLAGE.npcs.length)],
                    npc: true,
                    dialog: DIALOGS[Math.floor(rnd() * DIALOGS.length)],
                });
            }
            // Fountain at one of the corners (heals on interact).
            const fc = oc - 1, fr = or - 1;
            if (!features.find(f => f.c === fc && f.r === fr)) {
                features.push({ c: fc, r: fr, emoji: '⛲', fountain: true });
            }
            // 1-2 guards at village edges.
            const guardSpots = [[-2, -1], [2, 1]];
            for (const [gc, gr] of guardSpots) {
                const gx = oc + gc, gy = or + gr;
                if (gx >= 0 && gx < N && gy >= 0 && gy < N && !features.find(f => f.c === gx && f.r === gy)) {
                    features.push({ c: gx, r: gy, emoji: '💂', npc: true, dialog: 'Move along, citizen. The village is safe under our watch.' });
                }
            }
            // 1 merchant per village (always present).
            const mc = oc + 1, mr = or - 1;
            if (!features.find(f => f.c === mc && f.r === mr)) {
                features.push({ c: mc, r: mr, emoji: '🧑‍💼', npc: true, merchant: true });
            }
            return; // stamp one village per chunk
        }
    }

    _classify(elev, moist) {
        if (elev < 0.25) return 'deep';
        if (elev < 0.32) return 'water';
        if (elev < 0.35) return 'sand';          // narrow beach strip
        if (elev > 0.82) return 'snow';
        if (elev > 0.75) return 'tundra';
        if (elev > 0.68) return 'mountain';
        // Moisture-driven biomes on land (0.35–0.68 elevation).
        if (moist > 0.58) return 'forest';        // wet → dense forest
        if (moist > 0.48 && elev > 0.40) return 'forest'; // moderately wet + inland
        if (moist < 0.30) return 'savanna';       // dry → savanna
        if (moist > 0.42 && elev < 0.40) return 'swamp'; // wet + low → swamp
        return 'grass';                           // default: plains
    }

    biomeAt(wx, wy) {
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cy = Math.floor(wy / CHUNK_SIZE);
        const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        return this.getChunk(cx, cy).biomes[ly * CHUNK_SIZE + lx];
    }

    /** Is this water tile on the shore? (≥1 cardinal land neighbor) */
    isShore(wx, wy) {
        const cardinals = [[1,0],[-1,0],[0,1],[0,-1]];
        for (const [dx, dy] of cardinals) {
            const nb = this.biomeAt(wx + dx, wy + dy);
            if (BIOMES[nb]?.passable) return true;
        }
        return false;
    }

    /**
     * Unified passability check.
     * @param {number} wx — world X
     * @param {number} wy — world Y
     * @param {'walk'|'swim'|'sail'} mode
     * @returns {boolean}
     */
    canTraverse(wx, wy, mode = 'walk') {
        const b = this.biomeAt(wx, wy);
        const bio = BIOMES[b];
        if (!bio) return false;

        // Feature blocking (structures in villages etc.) — blocks walk only.
        if (mode === 'walk') {
            const f = this.featureAt(wx, wy);
            if (f && f.blocks) return false;
        }

        // Land biomes (passable by default): only walkable.
        if (bio.passable) return mode === 'walk';

        // Water biome rules: NOT walkable. Swim or sail only.
        if (b === 'water') {
            if (mode === 'sail') return true;
            if (mode === 'swim') return true;
            return false;
        }
        if (b === 'deep') {
            if (mode === 'sail') return true;
            return false; // no swimming or walking in deep water
        }

        // Mountain, cave_wall, lava: always blocked.
        return false;
    }

    elevAt(wx, wy) {
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cy = Math.floor(wy / CHUNK_SIZE);
        const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        return this.getChunk(cx, cy).elevations[ly * CHUNK_SIZE + lx];
    }

    featureAt(wx, wy) {
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cy = Math.floor(wy / CHUNK_SIZE);
        const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const ch = this.getChunk(cx, cy);
        return ch.features.find(f => f.c === lx && f.r === ly) || null;
    }
}

// ── Day/night + fog of war ────────────────────────────────
// timeOfDay: 0..1, with 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk.

/** Returns a darkness factor 0 (full day) → 1 (midnight). */
function _nightFactor(t) {
    // Cosine curve peaking at 0.5 (noon = 0 dark). Minimum at 0 (midnight = max dark).
    const noon = Math.cos(t * Math.PI * 2); // +1 at noon, -1 at midnight
    return Math.max(0, -noon); // 0..1
}

/** Vision radius in tiles. Day = 12 tiles, night = 5. Tighter for close cam. */
function _visionRadius(t) {
    const nf = _nightFactor(t);
    return 12 - nf * 7; // 12 day → 5 night
}

/** Vision radius fog — ALWAYS active. Daytime shows a wide clear area
 *  with grey beyond; night shrinks the radius and tints with dark blue.
 *  `lights` is an optional array of { x, y, radius } (screen-space) that
 *  carve extra bright spots into the darkness — campfires, torches, etc. */
function drawFogOfWar(ctx, W, H, playerScreenX, playerScreenY, timeOfDay, lights) {
    const nf = _nightFactor(timeOfDay);
    const vr = _visionRadius(timeOfDay);
    const radiusPx = vr * TILE_W * 0.7;

    // Colour: warm at dusk/dawn, cold at night, neutral grey during day.
    const warm = (timeOfDay > 0.66 && timeOfDay < 0.85) || (timeOfDay > 0.15 && timeOfDay < 0.34);
    const r = warm ? 80 : nf > 0.1 ? 8 : 40;
    const g = warm ? 50 : nf > 0.1 ? 10 : 40;
    const b = warm ? 20 : nf > 0.1 ? 35 : 45;

    // Inner alpha: 0 (clear). Outer alpha: 0.92 at night, 0.85 during day.
    const outerAlpha = 0.85 + nf * 0.07;
    const midAlpha   = nf * 0.35;

    const grad = ctx.createRadialGradient(
        playerScreenX, playerScreenY, radiusPx * 0.25,
        playerScreenX, playerScreenY, radiusPx
    );
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(0.55, `rgba(${r},${g},${b},${midAlpha.toFixed(3)})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},${outerAlpha.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Extra night atmosphere.
    if (nf > 0.05) {
        const flatAlpha = nf * 0.25;
        ctx.fillStyle = `rgba(${r},${g},${b},${flatAlpha.toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
    }

    // ── Dynamic light sources (carve darkness + warm glow overlay) ──
    if (lights && lights.length && nf > 0.05) {
        // 1) Erase fog inside each light radius (destination-out with a
        //    radial falloff keeps edges soft).
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        for (const L of lights) {
            const flick = 0.85 + Math.random() * 0.15; // subtle flicker
            const rad = L.radius * flick;
            const g2 = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, rad);
            g2.addColorStop(0, `rgba(0,0,0,${(0.95 * nf).toFixed(3)})`);
            g2.addColorStop(0.6, `rgba(0,0,0,${(0.5 * nf).toFixed(3)})`);
            g2.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g2;
            ctx.fillRect(L.x - rad, L.y - rad, rad * 2, rad * 2);
        }
        ctx.restore();

        // 2) Additive warm glow so the lit area reads as firelight, not
        //    a plain hole in the fog.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const L of lights) {
            const flick = 0.9 + Math.random() * 0.1;
            const rad = L.radius * flick;
            const g3 = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, rad);
            g3.addColorStop(0, `rgba(255,150,60,${(0.35 * nf).toFixed(3)})`);
            g3.addColorStop(0.5, `rgba(255,110,40,${(0.15 * nf).toFixed(3)})`);
            g3.addColorStop(1, 'rgba(255,100,30,0)');
            ctx.fillStyle = g3;
            ctx.fillRect(L.x - rad, L.y - rad, rad * 2, rad * 2);
        }
        ctx.restore();
    }
}

// ── Color helpers ────────────────────────────────────────
function _hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0,2), 16), parseInt(h.slice(2,4), 16), parseInt(h.slice(4,6), 16)];
}

// ── Top-down projection (Pokémon-era square tiles) ───────
// iso() kept as name for compatibility with existing call sites. In the
// top-down rebuild it returns the tile's CENTER in world→screen-local
// coords (pre-camera). Matching the iso version's "sprite anchor = tile
// midpoint" semantics keeps the sprite positioning code in index.js
// working with only the new projection plugged in.
function iso(wx, wy) {
    return {
        x: wx * TILE_SIZE + TILE_SIZE / 2,
        y: wy * TILE_SIZE + TILE_SIZE / 2,
    };
}

// Camera centers the player sprite at the viewport midpoint. Because iso()
// returns a tile center, adding cam to it gives a screen coord that matches
// the existing sprite pipeline (which then subtracts TILE_W/2 to get the
// top-left draw point).
function camera(canvasW, canvasH, pwx, pwy) {
    const p = iso(pwx, pwy);
    return {
        cx: Math.round(canvasW / 2 - p.x),
        cy: Math.round(canvasH / 2 - p.y),
    };
}

// Perspective is disabled in top-down — always 1.0 so any legacy call
// site that still multiplies by this factor becomes a no-op.
function perspScale(_screenY, _viewH) { return 1.0; }

// ── Rendering ────────────────────────────────────────────
// ELEV_PX loaded from data.js

let _renderTime = 0;
let _playerFlash = 0;
const _floaters = [];
function addFloater(wx, wy, text, color = '#fff') {
    _floaters.push({ wx, wy, text, color, age: 0, maxAge: 900 });
}
function tickFloaters(dt) {
    for (let i = _floaters.length - 1; i >= 0; i--) {
        _floaters[i].age += dt;
        if (_floaters[i].age >= _floaters[i].maxAge) _floaters.splice(i, 1);
    }
}

// ── Stars (rendered behind tiles at night) ───────────────
let _stars = null;
function ensureStars() {
    if (_stars) return _stars;
    _stars = [];
    for (let i = 0; i < 120; i++) {
        _stars.push({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.2, twinkle: Math.random() * Math.PI * 2 });
    }
    return _stars;
}

// ── Simple WebAudio SFX (no assets) ─────────────────────
let _sfxCtx = null;
function _sfx(freq, dur = 0.1, type = 'sine', gain = 0.06) {
    if (!_sfxCtx) try { _sfxCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const t = _sfxCtx.currentTime;
    const o = _sfxCtx.createOscillator();
    const g = _sfxCtx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(_sfxCtx.destination);
    o.start(t); o.stop(t + dur + 0.02);
}
// _playerFlash lives in index.js (mutable game state).

function sfxHit()     { _sfx(180, 0.1, 'square', 0.07); }
function sfxKill()    { _sfx(440, 0.08); setTimeout(() => _sfx(660, 0.12), 60); }
function sfxHurt()    { _sfx(120, 0.14, 'sawtooth', 0.08); }
function sfxLevelUp() { _sfx(523, 0.12); setTimeout(() => _sfx(659, 0.14), 100); setTimeout(() => _sfx(784, 0.2), 240); }

// ── Procedural biome patterns ────────────────────────────
// Each biome is baked once into an OffscreenCanvas at startup. Instead of
// stroking geometry per tile every frame we just drawImage() the cached
// pattern. This is both prettier than flat colour and faster than the
// diamond gradient path it replaces.
const _biomePatterns = new Map();

function _seededRand(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function _paintBiomePattern(biome, def, size) {
    const canvas = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(size, size)
        : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const c = canvas.getContext('2d');
    // Vertical gradient base — reuses color1/color2 already defined in data.js.
    const g = c.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, def.color1);
    g.addColorStop(1, def.color2);
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);

    // Hash biome name for deterministic-per-biome detail noise.
    let seed = 0;
    for (let i = 0; i < biome.length; i++) seed = (seed * 31 + biome.charCodeAt(i)) >>> 0;
    const rand = _seededRand(seed || 1);

    // Per-biome detail layer. Cheap, readable, zero asset files.
    if (biome === 'grass' || biome === 'savanna') {
        // Scattered grass blades + tiny dots.
        c.fillStyle = _adjustBright(def.color1, 1.15);
        for (let i = 0; i < 40; i++) {
            c.fillRect(rand() * size, rand() * size, 1, 2);
        }
        c.fillStyle = _adjustBright(def.color2, 0.8);
        for (let i = 0; i < 14; i++) {
            c.fillRect(rand() * size, rand() * size, 1, 1);
        }
    } else if (biome === 'forest') {
        // Darker speckle + few pine-needle marks.
        c.fillStyle = _adjustBright(def.color2, 0.7);
        for (let i = 0; i < 20; i++) c.fillRect(rand() * size, rand() * size, 2, 1);
        c.fillStyle = _adjustBright(def.color1, 1.1);
        for (let i = 0; i < 12; i++) c.fillRect(rand() * size, rand() * size, 1, 1);
    } else if (biome === 'sand') {
        // Dune dots + sparse pebbles.
        c.fillStyle = _adjustBright(def.color2, 0.88);
        for (let i = 0; i < 30; i++) c.fillRect(rand() * size, rand() * size, 1, 1);
        c.fillStyle = _adjustBright(def.color1, 1.12);
        for (let i = 0; i < 10; i++) c.fillRect(rand() * size, rand() * size, 2, 1);
    } else if (biome === 'swamp') {
        // Darker blotches for stagnant mud.
        c.fillStyle = _adjustBright(def.color2, 0.75);
        for (let i = 0; i < 12; i++) {
            const r = 1 + rand() * 2;
            c.beginPath();
            c.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
            c.fill();
        }
    } else if (biome === 'mountain') {
        // Angular crack lines for stone.
        c.strokeStyle = _adjustBright(def.color2, 0.7);
        c.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            c.beginPath();
            const x0 = rand() * size, y0 = rand() * size;
            c.moveTo(x0, y0);
            c.lineTo(x0 + (rand() - 0.5) * size * 0.4, y0 + (rand() - 0.5) * size * 0.4);
            c.stroke();
        }
    } else if (biome === 'tundra') {
        c.fillStyle = _adjustBright(def.color1, 0.9);
        for (let i = 0; i < 18; i++) c.fillRect(rand() * size, rand() * size, 2, 1);
    } else if (biome === 'snow') {
        // Sparkles.
        c.fillStyle = '#ffffff';
        for (let i = 0; i < 18; i++) c.fillRect(rand() * size, rand() * size, 1, 1);
    } else if (biome === 'water' || biome === 'deep') {
        // Wave lines — slightly animated via time offset drawn at paint-time
        // in the main loop (here we bake a base pattern; shimmer added on top).
        c.strokeStyle = _adjustBright(def.color1, 1.25);
        c.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
            const yy = (i + 1) * size / 4 + (rand() - 0.5) * 4;
            c.beginPath();
            c.moveTo(0, yy);
            for (let x = 0; x <= size; x += 4) {
                c.lineTo(x, yy + Math.sin(x * 0.5 + i) * 1.2);
            }
            c.stroke();
        }
    } else if (biome === 'cave_floor') {
        c.fillStyle = _adjustBright(def.color2, 0.7);
        for (let i = 0; i < 14; i++) c.fillRect(rand() * size, rand() * size, 1, 1);
    } else if (biome === 'cave_wall') {
        c.strokeStyle = _adjustBright(def.color1, 1.4);
        c.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
            c.beginPath();
            const x0 = rand() * size, y0 = rand() * size;
            c.moveTo(x0, y0);
            c.lineTo(x0 + rand() * size * 0.3, y0 + rand() * size * 0.3);
            c.stroke();
        }
    } else if (biome === 'lava') {
        c.fillStyle = '#ffb020';
        for (let i = 0; i < 8; i++) {
            const r = 1 + rand() * 2;
            c.beginPath();
            c.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
            c.fill();
        }
    } else if (biome === 'exit') {
        c.strokeStyle = _adjustBright(def.color1, 1.5);
        c.lineWidth = 2;
        c.strokeRect(4, 4, size - 8, size - 8);
    }
    return canvas;
}

function buildBiomePatterns() {
    _biomePatterns.clear();
    const all = { ...BIOMES, ...DUNGEON_BIOMES };
    for (const [key, def] of Object.entries(all)) {
        _biomePatterns.set(key, _paintBiomePattern(key, def, TILE_SIZE));
    }
}

function getBiomePattern(biome) {
    if (_biomePatterns.size === 0) buildBiomePatterns();
    return _biomePatterns.get(biome) || _biomePatterns.get('grass');
}

// Top-down square tile. sx/sy is the top-left corner on screen.
function drawTile(ctx, sx, sy, biome, _elev) {
    const pat = getBiomePattern(biome);
    if (pat) {
        ctx.drawImage(pat, sx, sy);
        // Live water shimmer on top of the baked base.
        if (biome === 'water' || biome === 'deep') {
            const shimmer = 0.08 + 0.08 * Math.sin(_renderTime * 0.002 + sx * 0.08 + sy * 0.12);
            ctx.fillStyle = `rgba(255,255,255,${shimmer.toFixed(3)})`;
            ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
        }
    } else {
        const b = BIOMES[biome] || DUNGEON_BIOMES[biome];
        ctx.fillStyle = b ? b.color1 : '#333';
        ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    }
}

// Depth walls are meaningless on a flat top-down plane — kept as a no-op
// so any legacy call site keeps compiling without changes.
function drawTileDepth(_ctx, _sx, _sy, _elev, _elevS, _elevE) { /* no-op in top-down */ }

function _adjustBright(hex, factor) {
    const h = hex.replace('#', '');
    const r = Math.min(255, Math.round(parseInt(h.slice(0,2), 16) * factor));
    const g = Math.min(255, Math.round(parseInt(h.slice(2,4), 16) * factor));
    const b = Math.min(255, Math.round(parseInt(h.slice(4,6), 16) * factor));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function drawShadow(ctx, sx, sy, spriteSize) {
    if (spriteSize < 16) return; // tiny items (coins, flowers) skip shadow
    const rx = Math.min(12, spriteSize * 0.35);
    const ry = Math.min(5, spriteSize * 0.14);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(sx + TILE_W / 2, sy + TILE_H / 2 + 2, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
}

// Emoji cache: render each emoji+size pair to an offscreen canvas once,
// force all partially-transparent pixels to full opacity (fixes Windows
// Segoe UI Emoji rendering with internal alpha), then drawImage from cache.
const _emojiCache = new Map();
function _getEmojiImg(emoji, size) {
    const key = emoji + ':' + size;
    let c = _emojiCache.get(key);
    if (c) return c;
    const s = Math.ceil(size * 1.4);
    c = document.createElement('canvas');
    c.width = s; c.height = s;
    const c2 = c.getContext('2d');
    c2.font = size + "px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.fillText(emoji, s / 2, s / 2);
    // Force full opacity on every visible pixel.
    const img = c2.getImageData(0, 0, s, s);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 25) d[i] = 255;
    }
    c2.putImageData(img, 0, 0);
    _emojiCache.set(key, c);
    return c;
}

function drawEmoji(ctx, sx, sy, emoji, size = 28) {
    const cached = _getEmojiImg(emoji, size);
    const cx = sx + TILE_W / 2 - cached.width / 2;
    const cy = sy + TILE_H / 2 - cached.height / 2;
    ctx.drawImage(cached, cx, cy);
}
/* ╔══════════════════════════════════════════════════════════╗
 * ║  ULTIMA ARUTA — index.js (entry point)                     ║
 * ║  Imports data.js (constants) and wires Player, combat,     ║
 * ║  UI panels, world/dungeon layer, and the game loop.        ║
 * ╚══════════════════════════════════════════════════════════╝ */

// Data is loaded dynamically in mount() via sdk.asset('data.js').
// We declare D as a module-level ref so top-level functions (generateDungeon,
// World, noise, rendering) can access it after setup.

// These are assigned from data.js in mount() — declared here so
// top-level functions (World, generateDungeon, rendering) can use them.



