/* ╔══════════════════════════════════════════════════════════╗
 * ║  ULTIMA ARUTA — isometric emoji RPG                       ║
 * ║                                                            ║
 * ║  Structure (single file for blob-URL compatibility):       ║
 * ║    §1 DATA      — constants, biomes, items, creatures      ║
 * ║    §2 ENGINE    — noise, World, dungeon, rendering, SFX    ║
 * ║    §3 PLAYER    — Player class, stats, movement            ║
 * ║    §4 UI        — world-select, backpack, paperdoll, shop  ║
 * ║    §5 GAME LOOP — mount, combat, creature AI, input        ║
 * ╚══════════════════════════════════════════════════════════╝ */

/* ╔══════════════════════════════════════════════════════════╗
 * ║  ULTIMA ARUTA — data.js                                    ║
 * ║  All game constants, item/creature/biome definitions.      ║
 * ║  Pure data — no logic, no side effects.                    ║
 * ╚══════════════════════════════════════════════════════════╝ */

// ── Character classes ────────────────────────────────────
const CLASSES = {
    warrior: {
        name: 'Warrior', icon: '⚔️', desc: 'High HP, strong melee, starts with sword + shield.',
        hp: 120, mana: 30, stamina: 110, baseDmg: 7,
        gear: { weapon: 'sword', shield: 'shield', armor: 'armor' },
    },
    mage: {
        name: 'Mage', icon: '🧙', desc: 'High mana, starts with spellbook + robe.',
        hp: 80, mana: 80, stamina: 90, baseDmg: 4,
        gear: { book: 'spellbook', chest: 'robe', head: 'hat' },
    },
    archer: {
        name: 'Archer', icon: '🏹', desc: 'Fast, ranged attacker, starts with bow + boots.',
        hp: 90, mana: 40, stamina: 130, baseDmg: 5,
        gear: { weapon: 'bow', feet: 'boots', cape: 'cape' },
    },
    rogue: {
        name: 'Rogue', icon: '🗡️', desc: 'High crit chance, starts with dagger + gloves.',
        hp: 85, mana: 40, stamina: 120, baseDmg: 6,
        gear: { weapon: 'dagger', hands: 'gloves', feet: 'sandals' },
    },
};

function showClassSelect(root) {
    return new Promise((resolve) => {
        root.innerHTML = `
            <div class="ua-select-shell">
                <h1 class="ua-select-title">Choose thy class</h1>
                <p class="ua-select-sub">Each path shapes your destiny…</p>
                <div class="ua-select-list" id="ua-class-list">
                    ${Object.entries(CLASSES).map(([k, c]) => `
                        <div class="ua-select-row ua-class-row" data-class="${k}">
                            <div class="ua-select-meta">
                                <div class="ua-select-name">${c.icon} ${c.name}</div>
                                <div class="ua-select-info">${c.desc}</div>
                                <div class="ua-select-info">HP ${c.hp} · MP ${c.mana} · SP ${c.stamina} · DMG ${c.baseDmg}</div>
                            </div>
                            <button class="ua-btn ua-btn-primary" data-pick="${k}">Select</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        root.querySelectorAll('[data-pick]').forEach(btn => {
            btn.addEventListener('click', () => resolve(btn.dataset.pick));
        });
    });
}

// ── World-select screen ──────────────────────────────────
// Shown before the game mounts. Returns the picked world id (or null
// on cancel). Mutates the `worlds` array in place via `onChange`.
function showWorldSelect(root, worlds, onChange) {
    return new Promise((resolve) => {
        function render() {
            root.innerHTML = `
                <div class="ua-select-shell">
                    <h1 class="ua-select-title">⚔ Ultima Aruta</h1>
                    <p class="ua-select-sub">Choose a realm to wander…</p>
                    <div class="ua-select-list" id="ua-select-list">
                        ${worlds.slice().sort((a,b) => (b.lastPlayed||0) - (a.lastPlayed||0)).map(w => `
                            <div class="ua-select-row" data-id="${w.id}">
                                <div class="ua-select-meta">
                                    <div class="ua-select-name">${escapeHTML(w.name)}</div>
                                    <div class="ua-select-info">${w.playerClass ? (CLASSES[w.playerClass]?.icon || '') + ' ' + (CLASSES[w.playerClass]?.name || '') + ' Lv' + (w.level || 1) + ' · 💀' + (w.kills || 0) + ' · ' : ''}Seed ${w.seed}</div>
                                    <div class="ua-select-info">Last played ${w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : '—'}</div>
                                </div>
                                <div class="ua-select-actions">
                                    <button class="ua-btn" data-act="play">▶ Play</button>
                                    <button class="ua-btn ua-btn-danger" data-act="del">🗑</button>
                                </div>
                            </div>
                        `).join('') || '<div class="ua-select-empty">No worlds yet — create one below.</div>'}
                    </div>
                    <div class="ua-select-new">
                        <input type="text" id="ua-new-name" placeholder="World name" class="ua-input" maxlength="40">
                        <input type="text" id="ua-new-seed" placeholder="Seed (optional)" class="ua-input" maxlength="12">
                        <button class="ua-btn ua-btn-primary" id="ua-new-go">＋ Create new world</button>
                    </div>
                </div>
            `;

            root.querySelectorAll('.ua-select-row').forEach(row => {
                const id = row.dataset.id;
                row.querySelector('[data-act="play"]').addEventListener('click', () => {
                    resolve(id);
                });
                row.querySelector('[data-act="del"]').addEventListener('click', async () => {
                    if (!confirm('Delete world permanently? Save data will be lost.')) return;
                    const i = worlds.findIndex(w => w.id === id);
                    if (i >= 0) {
                        worlds.splice(i, 1);
                        await onChange(worlds);
                        render();
                    }
                });
            });

            const $name = root.querySelector('#ua-new-name');
            const $seed = root.querySelector('#ua-new-seed');
            const $go   = root.querySelector('#ua-new-go');
            $go.addEventListener('click', async () => {
                const name = ($name.value || '').trim() || ('World ' + (worlds.length + 1));
                let seed = ($seed.value || '').trim();
                let seedNum;
                if (seed && /^\d+$/.test(seed)) seedNum = Number(seed) >>> 0;
                else if (seed) { let h = 2166136261; for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619); seedNum = h >>> 0; }
                else seedNum = (Math.random() * 0xffffffff) >>> 0;
                const w = {
                    id: 'w_' + Math.random().toString(36).slice(2, 9),
                    name, seed: seedNum,
                    createdAt: Date.now(), lastPlayed: Date.now(),
                };
                worlds.push(w);
                await onChange(worlds);
                resolve(w.id);
            });
        }

        function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

        render();
    });
}

// ── Mount ────────────────────────────────────────────────
export default {
    async mount(root, sdk) {
        // ── Load data + engine modules ────────────────────

        // ── World selection ──────────────────────────────
        // Each "world" is an independent save slot: its own seed, player
        // position, inventory, day/night clock, and world deltas.
        let worlds = [];
        try {
            const w = await sdk.storage.get('worlds');
            if (Array.isArray(w)) worlds = w;
        } catch {}

        const pickedWorldId = await showWorldSelect(root, worlds, async (newWorlds) => {
            worlds = newWorlds;
            await sdk.storage.set('worlds', worlds).catch(e => console.warn('[ultima-aruta] save worlds failed', e));
        });
        if (!pickedWorldId) return; // user closed the window while selecting

        const worldRow = worlds.find(w => w.id === pickedWorldId);
        const worldId = pickedWorldId;
        const STATE_KEY  = 'state_'        + worldId;
        const INV_KEY    = 'inventory_'    + worldId;
        const DELTA_KEY  = 'worldDeltas_'  + worldId;
        const EQUIP_KEY  = 'equipment_'    + worldId;

        // ── Class selection (first time only per world) ──
        let saved = null;
        try { saved = await sdk.storage.get(STATE_KEY); } catch {}
        let playerClass = saved?.playerClass || null;
        if (!playerClass) {
            playerClass = await showClassSelect(root);
            if (!playerClass) return;
        }
        const classDef = CLASSES[playerClass];
        const seed = worldRow.seed >>> 0;
        const world = new World(seed);

        // Find a walkable starting cell. Spiral outward from (0,0) looking
        // for a grass tile surrounded by other grass (= continental interior,
        // not a tiny island). The wider search radius ensures we land on a
        // proper landmass even when (0,0) is deep ocean.
        let startX = saved?.px ?? 0, startY = saved?.py ?? 0;
        if (!saved) {
            let bestX = 0, bestY = 0, bestScore = -1;
            for (let r = 0; r < 600; r++) {
                const ang = r * 0.618;
                const rad = Math.floor(1 + r * 0.5);
                const tx = Math.round(Math.cos(ang) * rad);
                const ty = Math.round(Math.sin(ang) * rad);
                if (!world.canTraverse(tx, ty)) continue;
                const b = world.biomeAt(tx, ty);
                if (b !== 'grass' && b !== 'forest') continue;
                // Score: count passable neighbours in a 5-tile radius.
                let score = 0;
                for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
                    if (world.canTraverse(tx + dx, ty + dy)) score++;
                }
                if (score > bestScore) { bestScore = score; bestX = tx; bestY = ty; }
                if (bestScore >= 40) break; // big enough landmass, stop searching
            }
            startX = bestX; startY = bestY;
        }
        // ── Boat state ────────────────────────────────────
        let _boarded = false;
        let _savedEmoji = '';

        function hasBoatInInventory() {
            return inventory.items.some(i => ITEMS[i.key]?.boat);
        }
        function boardBoat() {
            if (_boarded) return;
            _boarded = true;
            _savedEmoji = player.emoji;
            const boat = inventory.items.find(i => ITEMS[i.key]?.boat);
            player.emoji = boat && boat.key === 'sailboat' ? '⛵' : '🛶';
            addFloater(player.wx, player.wy, 'Boarded!', '#80c0ff');
            _sfx(220, 0.1, 'sine', 0.04);
        }
        function unboardBoat() {
            if (!_boarded) return;
            _boarded = false;
            player.emoji = _savedEmoji || '🧙';
            addFloater(player.wx, player.wy, 'Disembarked', '#80c0ff');
        }
        /** Toggle boarding — press B near water with boat in inventory. */
        function toggleBoard() {
            if (_boarded) {
                // Unboard only if current tile is land (or shore).
                const b = biomeAtDg(player.wx, player.wy);
                if (BIOMES[b]?.passable) { unboardBoat(); }
                else { addFloater(player.wx, player.wy, 'Move to land first!', '#ffaa00'); }
            } else {
                if (!hasBoatInInventory()) { addFloater(player.wx, player.wy, 'No boat!', '#ff6060'); return; }
                // Check if adjacent to water.
                const adj = [[1,0],[-1,0],[0,1],[0,-1]];
                const nearWater = adj.some(([dx,dy]) => {
                    const b = biomeAtDg(player.wx+dx, player.wy+dy);
                    return b === 'water' || b === 'deep';
                });
                if (!nearWater) { addFloater(player.wx, player.wy, 'No water nearby!', '#ffaa00'); return; }
                boardBoat();
            }
        }

        // ── Movement mode ────────────────────────────────
        /** Determine current movement mode. Only two modes for the player:
         *  walk (default) or sail (when boarded). No auto-swim — water is
         *  blocked unless you board a boat first. */
        function getMoveMode() {
            return _boarded ? 'sail' : 'walk';
        }

        /** Creature movement mode from emoji type. */
        function creatureMode(emoji) {
            if (AQUATIC_CREATURES.includes(emoji)) return 'swim';
            if (FLYING_CREATURES.includes(emoji)) return 'walk'; // flying uses walk but skips water block
            return 'walk';
        }

        // ── Dungeon state ──────────────────────────────────
        let _dungeon = null;

        // Dungeon-aware lookups (override world methods when inside).
        function biomeAtDg(wx, wy) {
            if (!_dungeon) return world.biomeAt(wx, wy);
            if (wx < 0 || wy < 0 || wx >= DUNGEON_SIZE || wy >= DUNGEON_SIZE) return 'cave_wall';
            return _dungeon.map.biomes[wy * DUNGEON_SIZE + wx];
        }
        function elevAtDg(wx, wy) {
            if (!_dungeon) return world.elevAt(wx, wy);
            return 0.5; // flat dungeons
        }
        /**
         * Unified passability check for player movement.
         * Uses the current movement mode (walk/swim/sail).
         */
        function passableDg(wx, wy) {
            const mode = getMoveMode();
            return canTraverseDg(wx, wy, mode);
        }

        /** Core traversal check — used by player AND creatures. */
        function canTraverseDg(wx, wy, mode = 'walk') {
            if (_dungeon) {
                // Dungeon tiles.
                if (wx < 0 || wy < 0 || wx >= DUNGEON_SIZE || wy >= DUNGEON_SIZE) return false;
                const b = _dungeon.map.biomes[wy * DUNGEON_SIZE + wx];
                const bio = ALL_BIOMES[b];
                if (!bio || !bio.passable) return false;
                const f = _dungeon.map.features.find(ff => ff.c === wx && ff.r === wy);
                return !(f && f.blocks);
            }
            // Overworld — delegate to World.canTraverse.
            return world.canTraverse(wx, wy, mode);
        }
        function featureAtDg(wx, wy) {
            if (!_dungeon) return world.featureAt(wx, wy);
            return _dungeon.map.features.find(f => f.c === wx && f.r === wy) || null;
        }
        function creaturesForRender() {
            if (_dungeon) return [{ key: '0,0', creatures: _dungeon.map.creatures, ox: 0, oy: 0 }];
            return null; // use normal chunk-based rendering
        }

        function enterDungeon(dungeonId) {
            const map = generateDungeon(dungeonId);
            _dungeon = { map, overworldX: player.wx, overworldY: player.wy };
            player.wx = map.spawnX; player.wy = map.spawnY;
            player.rx = map.spawnX; player.ry = map.spawnY;
            player.moveT = 0;
            showDialogBubble('🕳️', 'You descend into the darkness...');
            _sfx(120, 0.3, 'sawtooth', 0.06);
        }
        function exitDungeon() {
            player.wx = _dungeon.overworldX; player.wy = _dungeon.overworldY;
            player.rx = player.wx; player.ry = player.wy;
            player.moveT = 0;
            _dungeon = null;
            showDialogBubble('🪜', 'You emerge back to the surface.');
            _sfx(440, 0.15, 'sine', 0.05);
        }

        const player = new Player(startX, startY);
        // Apply class stats.
        if (classDef) {
            player.maxHp = classDef.hp; player.hp = classDef.hp;
            player.maxMana = classDef.mana; player.mana = classDef.mana;
            player.maxStamina = classDef.stamina; player.stamina = classDef.stamina;
            player.baseDmg = classDef.baseDmg;
            player.emoji = classDef.icon === '🧙' ? '🧙' : classDef.icon === '🏹' ? '🧝' : classDef.icon === '🗡️' ? '🥷' : '🧙';
        }
        // Restore player stats from save (overrides class defaults for returning players).
        if (saved) {
            if (saved.hp != null)      player.hp      = saved.hp;
            if (saved.mana != null)    player.mana    = saved.mana;
            if (saved.level != null)   player.level   = saved.level;
            if (saved.xp != null)      player.xp      = saved.xp;
            if (saved.xpNext != null)  player.xpNext  = saved.xpNext;
            if (saved.maxHp != null)   player.maxHp   = saved.maxHp;
            if (saved.maxMana != null) player.maxMana = saved.maxMana;
            if (saved.stamina != null)    player.stamina    = saved.stamina;
            if (saved.maxStamina != null) player.maxStamina = saved.maxStamina;
            if (saved.hunger != null)     player.hunger     = saved.hunger;
            if (saved.maxHunger != null)  player.maxHunger  = saved.maxHunger;
            if (saved.skills && typeof saved.skills === 'object') {
                for (const k of Object.keys(player.skills)) {
                    if (typeof saved.skills[k] === 'number') player.skills[k] = saved.skills[k];
                }
            }
            if (typeof saved.crafted === 'number') player.crafted = saved.crafted;
            if (saved.slayDragon) player._slayDragon = true;
            if (saved.slayDemon) player._slayDemon = true;
            if (saved.slayBrute) player._slayBrute = true;
            if (saved.baseDmg != null) player.baseDmg = saved.baseDmg;
            if (saved.kills != null)  player.kills  = saved.kills;
            if (saved.days != null)   player.days   = saved.days;
        }
        // ── Ancient Runes (endgame) ──────────────────────
        // One rune shard per boss family. Killing a boss of a family attunes
        // its shard (guaranteed, once); all four together forge the Seal of
        // Aruta — a one-shot permanent boon + victory screen. Free play after.
        const RUNE_SHARDS = [
            { id: 'dragon', rune: 'ᚠ', name: 'Fehu',     keys: ['🐉', '🐲'] },
            { id: 'brute',  rune: 'ᚢ', name: 'Uruz',     keys: ['👹', '🧌'] },
            { id: 'undead', rune: 'ᚦ', name: 'Thurisaz', keys: ['🧟'] },
            { id: 'demon',  rune: 'ᚨ', name: 'Ansuz',    keys: ['👿'] },
        ];
        const runeShards = (saved && saved.runeShards && typeof saved.runeShards === 'object') ? saved.runeShards : {};
        let sealForged = !!(saved && saved.sealForged);
        // Day starts at noon on first load. Time advances with real-time dt.
        let timeOfDay = (typeof saved?.timeOfDay === 'number') ? saved.timeOfDay : 0.5;

        // ── Inventory + equipment + world deltas ─────────
        let inventory = { items: [] };
        let equipment = {}; // { head: itemRow, weapon: ..., ... }
        try {
            const inv = await sdk.storage.get(INV_KEY);
            if (inv && Array.isArray(inv.items)) inventory = inv;
        } catch {}
        try {
            const eq = await sdk.storage.get(EQUIP_KEY);
            if (eq && typeof eq === 'object') equipment = eq;
        } catch {}
        // First-time class starting gear (only when no save exists).
        if (!saved && classDef && classDef.gear) {
            for (const [slot, key] of Object.entries(classDef.gear)) {
                const def = ITEMS[key];
                if (def) {
                    equipment[slot] = {
                        id: 'it_' + Math.random().toString(36).slice(2, 9),
                        key, emoji: def.emoji, name: def.name,
                    };
                }
            }
            // Class starter bundle — seeds the inventory so each class has
            // a tiny head start that matches its playstyle.
            const STARTER = {
                warrior: ['bread', 'bread', 'wood'],
                mage:    ['potion', 'scroll', 'torch'],
                archer:  ['berry', 'feather', 'feather'],
                rogue:   ['potion', 'gold', 'gold', 'gold'],
            };
            const bundle = STARTER[playerClass] || [];
            for (const key of bundle) {
                const def = ITEMS[key];
                if (!def) continue;
                inventory.items.push({
                    id: 'it_' + Math.random().toString(36).slice(2, 9),
                    key, emoji: def.emoji, name: def.name,
                    x: 6 + (inventory.items.length % 7) * 36,
                    y: 6 + Math.floor(inventory.items.length / 7) * 36,
                });
            }
        }
        // Persistent mutations to the procedural world (things picked up,
        // things dropped by the player). Applied to each chunk after
        // generation — without this a reload would respawn picked items.
        let worldDeltas = { removed: {}, added: {} };
        try {
            const d = await sdk.storage.get(DELTA_KEY);
            if (d) worldDeltas = { removed: d.removed || {}, added: d.added || {} };
        } catch {}
        world._applyDeltas = (ch) => {
            const key = ch.cx + ',' + ch.cy;
            const rem = worldDeltas.removed[key];
            if (rem) ch.features = ch.features.filter(f => !rem.some(r => r.c === f.c && r.r === f.r && r.key === f.itemKey));
            const add = worldDeltas.added[key];
            if (add) {
                for (const a of add) {
                    if (ch.features.find(f => f.c === a.c && f.r === a.r)) continue;
                    const def = ITEMS[a.key];
                    if (!def) continue;
                    if (a.kind === 'structure') {
                        const feat = {
                            c: a.c, r: a.r, emoji: def.emoji,
                            structure: true, structKey: a.key,
                        };
                        if (def.structure?.blocks) feat.blocks = true;
                        if (typeof a.fuel === 'number') feat.fuel = a.fuel;
                        else if (def.structure?.fuel != null) feat.fuel = def.structure.fuel;
                        if (typeof a.growth === 'number') feat.growth = a.growth;
                        else if (def.structure?.growth != null) feat.growth = def.structure.growth;
                        ch.features.push(feat);
                    } else {
                        ch.features.push({ c: a.c, r: a.r, emoji: def.emoji, item: true, itemKey: a.key });
                    }
                }
            }
        };
        // Patch getChunk to apply deltas on generation.
        const _origGen = world._generate.bind(world);
        world._generate = (cx, cy) => {
            const ch = _origGen(cx, cy);
            world._applyDeltas(ch);
            return ch;
        };

        function saveInventory()    { sdk.storage.set(INV_KEY,   inventory).catch(e => console.warn('[ultima-aruta] save inventory failed', e)); }
        function saveWorldDeltas()  { sdk.storage.set(DELTA_KEY, worldDeltas).catch(e => console.warn('[ultima-aruta] save world deltas failed', e)); }
        function saveEquipment()    { sdk.storage.set(EQUIP_KEY, equipment).catch(e => console.warn('[ultima-aruta] save equipment failed', e)); }

        function removeWorldItem(wx, wy) {
            const cx = Math.floor(wx / CHUNK_SIZE), cy = Math.floor(wy / CHUNK_SIZE);
            const lc = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const lr = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const ch = world.getChunk(cx, cy);
            const idx = ch.features.findIndex(f => f.c === lc && f.r === lr && f.item);
            if (idx < 0) return null;
            const f = ch.features[idx];
            ch.features.splice(idx, 1);
            const key = cx + ',' + cy;
            (worldDeltas.removed[key] = worldDeltas.removed[key] || []).push({ c: lc, r: lr, key: f.itemKey });
            saveWorldDeltas();
            return f.itemKey;
        }
        function placeWorldItem(wx, wy, itemKey) {
            // Structure-flagged items (campfires, etc.) delegate to the
            // dedicated placer so they deploy as non-pickupable fixtures.
            if (ITEMS[itemKey]?.structure) return !!placeStructure(wx, wy, itemKey);
            const cx = Math.floor(wx / CHUNK_SIZE), cy = Math.floor(wy / CHUNK_SIZE);
            const lc = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const lr = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const ch = world.getChunk(cx, cy);
            if (ch.features.find(f => f.c === lc && f.r === lr)) return false;
            ch.features.push({ c: lc, r: lr, emoji: ITEMS[itemKey].emoji, item: true, itemKey });
            const key = cx + ',' + cy;
            (worldDeltas.added[key] = worldDeltas.added[key] || []).push({ c: lc, r: lr, key: itemKey });
            saveWorldDeltas();
            return true;
        }
        // Place a non-pickupable structure (campfire, etc.) on the world.
        // Returns the feature on success, null if the tile is blocked.
        function placeStructure(wx, wy, structKey) {
            const def = ITEMS[structKey];
            if (!def || !def.structure) return null;
            const cx = Math.floor(wx / CHUNK_SIZE), cy = Math.floor(wy / CHUNK_SIZE);
            const lc = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const lr = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const ch = world.getChunk(cx, cy);
            if (ch.features.find(f => f.c === lc && f.r === lr)) return null;
            const f = { c: lc, r: lr, emoji: def.emoji, structure: true, structKey };
            if (def.structure.blocks) f.blocks = true;
            const delta = { c: lc, r: lr, key: structKey, kind: 'structure' };
            if (def.structure.fuel != null) {
                f.fuel = def.structure.fuel;
                delta.fuel = def.structure.fuel;
            }
            if (def.structure.growth != null) {
                f.growth = def.structure.growth;
                delta.growth = def.structure.growth;
            }
            ch.features.push(f);
            const key = cx + ',' + cy;
            (worldDeltas.added[key] = worldDeltas.added[key] || []).push(delta);
            saveWorldDeltas();
            return f;
        }
        function removeStructureAt(wx, wy) {
            const cx = Math.floor(wx / CHUNK_SIZE), cy = Math.floor(wy / CHUNK_SIZE);
            const lc = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const lr = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const ch = world.getChunk(cx, cy);
            const idx = ch.features.findIndex(f => f.c === lc && f.r === lr && f.structure);
            if (idx < 0) return false;
            ch.features.splice(idx, 1);
            const key = cx + ',' + cy;
            const adds = worldDeltas.added[key];
            if (adds) {
                const di = adds.findIndex(a => a.c === lc && a.r === lr && a.kind === 'structure');
                if (di >= 0) adds.splice(di, 1);
            }
            saveWorldDeltas();
            return true;
        }

        // ── DOM ──────────────────────────────────────────
        root.innerHTML = `
            <div class="ua-shell">
                <canvas class="ua-canvas" id="ua-canvas"></canvas>
                <canvas class="ua-minimap" id="ua-minimap" width="140" height="140"></canvas>
                <div class="ua-hud" id="ua-hud"></div>
                <div class="ua-help">WASD · <b>Right-hold</b> walk · <b>Click</b> attack · <b>F</b> 🔥 <b>G</b> 🌱 <b>T</b> tame <b>Y</b> feed <b>X</b> stay <b>V</b> whistle <b>U</b> recall <b>Z</b> sleep · <b>Q</b> potion · <b>Space</b> talk · <b>H</b> guide</div>
                <div class="ua-backpack" id="ua-backpack" style="display:none;">
                    <div class="ua-backpack-head">
                        <span class="ua-backpack-title">🎒 Backpack</span>
                        <span id="ua-backpack-sort" title="Sort & group" style="cursor:pointer;padding:0 8px;opacity:0.8;">⇅</span>
                        <span class="ua-backpack-close" data-close="pack" title="Close (I)">×</span>
                    </div>
                    <div class="ua-backpack-body" id="ua-backpack-body"></div>
                </div>
                <div class="ua-paperdoll" id="ua-paperdoll" style="display:none;">
                    <div class="ua-paperdoll-head">
                        <span>👤 Paperdoll</span>
                        <span class="ua-backpack-close" data-close="doll" title="Close (P)">×</span>
                    </div>
                    <div class="ua-paperdoll-body" id="ua-paperdoll-body">
                        <div class="ua-doll-figure">🧙</div>
                        <div class="ua-doll-slots" id="ua-doll-slots"></div>
                    </div>
                </div>
                <div class="ua-stats" id="ua-stats" style="display:none;">
                    <div class="ua-backpack-head">
                        <span>📊 Stats</span>
                        <span class="ua-backpack-close" data-close="stats" title="Close">×</span>
                    </div>
                    <div class="ua-stats-body" id="ua-stats-body"></div>
                </div>
                <div class="ua-magic" id="ua-magic" style="display:none;">
                    <div class="ua-backpack-head"><span>📖 Spellbook</span><span class="ua-backpack-close" data-close="magic">×</span></div>
                    <div class="ua-magic-body" id="ua-magic-body"></div>
                </div>
                <div class="ua-help-panel" id="ua-help-panel" style="display:none;">
                    <div class="ua-backpack-head"><span>❓ Guide</span><span class="ua-backpack-close" data-close="help">×</span></div>
                    <div class="ua-help-body" id="ua-help-body"></div>
                </div>
                <div class="ua-craft" id="ua-craft" style="display:none;">
                    <div class="ua-backpack-head"><span>🔨 Craft</span><span class="ua-backpack-close" data-close="craft">×</span></div>
                    <div class="ua-craft-body" id="ua-craft-body"></div>
                </div>
                <div class="ua-hub" id="ua-hub">
                    <button class="ua-hub-btn" data-hub="pack"   title="Backpack (I)">🎒</button>
                    <button class="ua-hub-btn" data-hub="doll"   title="Paperdoll (P)">👤</button>
                    <button class="ua-hub-btn" data-hub="craft"  title="Craft (C)">🔨</button>
                    <button class="ua-hub-btn" data-hub="magic"  title="Spellbook (K)">📖</button>
                    <button class="ua-hub-btn" data-hub="stats"  title="Stats">📊</button>
                    <button class="ua-hub-btn" data-hub="help"   title="Guide (H)">❓</button>
                </div>
                <div class="ua-drag-ghost" id="ua-drag-ghost" style="display:none;"></div>
            </div>
        `;
        const canvas = root.querySelector('#ua-canvas');
        const ctx = canvas.getContext('2d');
        const $hud = root.querySelector('#ua-hud');

        // Fixed internal resolution — the viewport always shows the same
        // area (~18 tiles wide) regardless of the window size. CSS stretches
        // the canvas to fill; `image-rendering: pixelated` on the canvas
        // element keeps it crisp.
        const VIEW_W = 560, VIEW_H = 380;
        canvas.width = VIEW_W;
        canvas.height = VIEW_H;
        canvas.style.imageRendering = 'pixelated';

        // ── Input: grid-snap with auto-repeat ────────────
        const held = new Set();
        function onKey(e) {
            const k = e.key.toLowerCase();
            const MAP = { arrowup:'n', w:'n', arrowdown:'s', s:'s', arrowleft:'w', a:'w', arrowright:'e', d:'e' };
            const dir = MAP[k];
            if (dir) {
                e.preventDefault();
                if (e.type === 'keydown') held.add(dir); else held.delete(dir);
                return;
            }
            if (e.type === 'keydown' && (k === ' ' || k === 'enter' || k === 'e')) {
                e.preventDefault();
                tryInteract();
                return;
            }
            if (e.type === 'keydown' && k === 'b') {
                e.preventDefault();
                toggleBoard();
                return;
            }
            if (e.type === 'keydown' && k === 'i') {
                e.preventDefault();
                toggleBackpack();
                return;
            }
            if (e.type === 'keydown' && k === 'p') {
                e.preventDefault();
                togglePaperdoll();
                return;
            }
            if (e.type === 'keydown' && k === 'c') {
                e.preventDefault();
                togglePanel('craft');
                return;
            }
            if (e.type === 'keydown' && k === 'k') {
                e.preventDefault();
                togglePanel('magic');
                return;
            }
            if (e.type === 'keydown' && k === 'h') {
                e.preventDefault();
                togglePanel('help');
                return;
            }
            if (e.type === 'keydown' && k === 'q') {
                e.preventDefault();
                quickPotion();
                return;
            }
            if (e.type === 'keydown' && k === 'f') {
                e.preventDefault();
                tryPlaceCampfire();
                return;
            }
            if (e.type === 'keydown' && k === 'g') {
                e.preventDefault();
                tryPlantSapling();
                return;
            }
            if (e.type === 'keydown' && k === 't') {
                e.preventDefault();
                tryTameAdjacent();
                return;
            }
            if (e.type === 'keydown' && k === 'y') {
                e.preventDefault();
                tryFeedPets();
                return;
            }
            if (e.type === 'keydown' && k === 'u') {
                e.preventDefault();
                tryRecall();
                return;
            }
            if (e.type === 'keydown' && k === 'z') {
                e.preventDefault();
                trySleep();
                return;
            }
            if (e.type === 'keydown' && k === 'x') {
                e.preventDefault();
                togglePetCommand();
                return;
            }
            if (e.type === 'keydown' && k === 'v') {
                e.preventDefault();
                whistlePets();
                return;
            }
        }

        // ── Interaction: SPACE/E talks to an adjacent NPC or enters a
        // dungeon when the player is standing on (or beside) its tile.
        function tryInteract() {
            // In dungeon: check for exit tile.
            if (_dungeon) {
                const f = featureAtDg(player.wx, player.wy);
                if (f && f.isExit) { exitDungeon(); return; }
                // Check adjacent for dungeon features (chests handled via drag).
                return;
            }
            // Overworld: check the 9 cells centred on the player.
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const f = world.featureAt(player.wx + dx, player.wy + dy);
                    if (!f) continue;
                    if (f.fountain) {
                        player.hp = player.maxHp; player.mana = player.maxMana; player.stamina = player.maxStamina;
                        addFloater(player.wx, player.wy, 'Fully restored!', '#60ff60');
                        _sfx(440, 0.12); setTimeout(() => _sfx(660, 0.14), 100);
                        applyBlessing();
                        showDialogBubble('⛲', 'The sacred fountain restores your body and spirit. You feel blessed.');
                        return;
                    }
                    if (f.merchant) { showShop(); return; }
                    if (f.npc) { talkToNpc(f, player.wx + dx, player.wy + dy); return; }
                    if (f.dungeon && dx === 0 && dy === 0) {
                        enterDungeon(f.dungeonId);
                        return;
                    }
                }
            }
        }

        // ── Merchant shop UI ──────────────────────────────
        function showShop() {
            let shopEl = root.querySelector('#ua-shop');
            if (shopEl) { shopEl.remove(); return; } // toggle off
            shopEl = document.createElement('div');
            shopEl.id = 'ua-shop';
            shopEl.className = 'ua-shop';
            function goldCount() { return inventory.items.filter(i => i.key === 'gold').length; }
            function renderShop() {
                const gold = goldCount();
                shopEl.innerHTML = `
                    <div class="ua-backpack-head"><span>🧑‍💼 Merchant</span><span class="ua-backpack-close" id="ua-shop-close">×</span></div>
                    <div class="ua-shop-gold">🪙 Your gold: <b>${gold}</b></div>
                    <div class="ua-shop-section"><b>Buy</b></div>
                    <div class="ua-shop-list">
                        ${MERCHANT_STOCK.map(s => {
                            const def = ITEMS[s.key];
                            return `<div class="ua-shop-row">
                                <span>${def.emoji} ${def.name}</span>
                                <span class="ua-shop-price">${s.price}🪙</span>
                                <button class="ua-btn ua-shop-buy" data-key="${s.key}" data-price="${s.price}" ${gold < s.price ? 'disabled' : ''}>Buy</button>
                            </div>`;
                        }).join('')}
                    </div>
                    <div class="ua-shop-section"><b>Sell</b></div>
                    <div class="ua-shop-list">
                        ${inventory.items.filter(i => i.key !== 'gold').map(i => {
                            const def = ITEMS[i.key] || {};
                            const buyPrice = MERCHANT_STOCK.find(s => s.key === i.key)?.price;
                            // Special-cased buybacks: treasure maps are
                            // premium curios, gems are always wanted.
                            const fixed = i.key === 'treasure_map' ? 40
                                        : i.key === 'gem'          ? 15
                                        : null;
                            const sellPrice = fixed != null
                                ? fixed
                                : (buyPrice ? Math.max(1, Math.floor(buyPrice * SELL_RATIO)) : 1);
                            return `<div class="ua-shop-row">
                                <span>${def.emoji || '?'} ${def.name || i.key}</span>
                                <span class="ua-shop-price">${sellPrice}🪙</span>
                                <button class="ua-btn ua-shop-sell" data-id="${i.id}" data-sell="${sellPrice}">Sell</button>
                            </div>`;
                        }).join('') || '<div style="opacity:0.5;padding:6px;">Nothing to sell.</div>'}
                    </div>
                    <div class="ua-shop-section"><b>Repair</b></div>
                    <div class="ua-shop-list">
                        ${(() => {
                            const rows = Object.entries(equipment)
                                .filter(([, it]) => it && typeof it.dur === 'number' && it.dur < it.durMax)
                                .map(([slot, it]) => {
                                    const missing = it.durMax - it.dur;
                                    const cost = Math.max(1, Math.ceil(missing / 2));
                                    return `<div class="ua-shop-row">
                                        <span>${it.emoji} ${it.name} (${Math.ceil(it.dur)}/${it.durMax})</span>
                                        <span class="ua-shop-price">${cost}🪙</span>
                                        <button class="ua-btn ua-shop-repair" data-slot="${slot}" data-cost="${cost}" ${gold < cost ? 'disabled' : ''}>Repair</button>
                                    </div>`;
                                });
                            return rows.length ? rows.join('') : '<div style="opacity:0.5;padding:6px;">All gear at full durability.</div>';
                        })()}
                    </div>
                    <div class="ua-shop-section"><b>Enchant</b> <span style="font-size:10px;opacity:0.6;">(1 gem + 20 gold, max +3)</span></div>
                    <div class="ua-shop-list">
                        ${(() => {
                            const gemCount = inventory.items.filter(i => i.key === 'gem').length;
                            const rows = Object.entries(equipment)
                                .filter(([, it]) => it && (typeof it.dur === 'number' || it.key === 'ring' || it.key === 'necklace'))
                                .map(([slot, it]) => {
                                    const lvl = it.enchant || 0;
                                    const canEnchant = lvl < 3 && gemCount >= 1 && gold >= 20;
                                    const label = lvl > 0 ? ` +${lvl}` : '';
                                    return `<div class="ua-shop-row">
                                        <span>${it.emoji} ${it.name}${label}</span>
                                        <span class="ua-shop-price">1💎 + 20🪙</span>
                                        <button class="ua-btn ua-shop-enchant" data-slot="${slot}" ${canEnchant ? '' : 'disabled'}>${lvl >= 3 ? 'Maxed' : 'Enchant'}</button>
                                    </div>`;
                                });
                            return rows.length ? rows.join('') : '<div style="opacity:0.5;padding:6px;">Equip gear to enchant.</div>';
                        })()}
                    </div>
                `;
                shopEl.querySelector('#ua-shop-close').addEventListener('click', () => shopEl.remove());
                shopEl.querySelectorAll('.ua-shop-buy').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const key = btn.dataset.key;
                        const price = Number(btn.dataset.price);
                        if (goldCount() < price) return;
                        // Remove gold coins.
                        let removed = 0;
                        inventory.items = inventory.items.filter(i => {
                            if (i.key === 'gold' && removed < price) { removed++; return false; }
                            return true;
                        });
                        // Add purchased item.
                        const def = ITEMS[key];
                        inventory.items.push({
                            id: 'it_' + Math.random().toString(36).slice(2, 9),
                            key, emoji: def.emoji, name: def.name,
                            x: 6 + (inventory.items.length % 7) * 36,
                            y: 6 + Math.floor(inventory.items.length / 7) * 36,
                        });
                        saveInventory();
                        addFloater(player.wx, player.wy, '-' + price + '🪙', '#ffaa00');
                        _sfx(880, 0.06, 'sine', 0.04);
                        renderShop();
                        if ($pack.style.display !== 'none') renderBackpack();
                    });
                });
                shopEl.querySelectorAll('.ua-shop-enchant').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const slot = btn.dataset.slot;
                        const it = equipment[slot];
                        if (!it) return;
                        const lvl = it.enchant || 0;
                        if (lvl >= 3) return;
                        const gemIdx = inventory.items.findIndex(i => i.key === 'gem');
                        if (gemIdx < 0 || goldCount() < 20) return;
                        inventory.items.splice(gemIdx, 1);
                        let removed = 0;
                        inventory.items = inventory.items.filter(i => {
                            if (i.key === 'gold' && removed < 20) { removed++; return false; }
                            return true;
                        });
                        it.enchant = lvl + 1;
                        saveInventory(); saveEquipment();
                        addFloater(player.wx, player.wy, '✨ ' + it.name + ' +' + it.enchant, '#c080ff');
                        _sfx(900, 0.18, 'sine', 0.05);
                        renderShop();
                        if ($pack.style.display !== 'none') renderBackpack();
                        if ($doll.style.display !== 'none') renderPaperdoll();
                    });
                });
                shopEl.querySelectorAll('.ua-shop-repair').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const slot = btn.dataset.slot;
                        const cost = Number(btn.dataset.cost);
                        const it = equipment[slot];
                        if (!it || goldCount() < cost) return;
                        let removed = 0;
                        inventory.items = inventory.items.filter(i => {
                            if (i.key === 'gold' && removed < cost) { removed++; return false; }
                            return true;
                        });
                        it.dur = it.durMax;
                        saveInventory(); saveEquipment();
                        addFloater(player.wx, player.wy, '🔧 ' + it.name + ' restored', '#60ff60');
                        _sfx(520, 0.1, 'sine', 0.05);
                        renderShop();
                        if ($pack.style.display !== 'none') renderBackpack();
                        if ($doll.style.display !== 'none') renderPaperdoll();
                    });
                });
                shopEl.querySelectorAll('.ua-shop-sell').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.dataset.id;
                        const sell = Number(btn.dataset.sell);
                        inventory.items = inventory.items.filter(i => i.id !== id);
                        // Add gold coins.
                        for (let g = 0; g < sell; g++) {
                            inventory.items.push({
                                id: 'it_' + Math.random().toString(36).slice(2, 9),
                                key: 'gold', emoji: '🪙', name: 'Gold Coin',
                                x: 6 + (inventory.items.length % 7) * 36,
                                y: 6 + Math.floor(inventory.items.length / 7) * 36,
                            });
                        }
                        saveInventory();
                        addFloater(player.wx, player.wy, '+' + sell + '🪙', '#ffc857');
                        _sfx(660, 0.06, 'sine', 0.04);
                        renderShop();
                        if ($pack.style.display !== 'none') renderBackpack();
                    });
                });
            }
            root.querySelector('.ua-shell').appendChild(shopEl);
            renderShop();
        }

        function showDialogBubble(icon, text) {
            let b = root.querySelector('#ua-dialog');
            if (b) b.remove();
            b = document.createElement('div');
            b.id = 'ua-dialog';
            b.className = 'ua-dialog';
            b.innerHTML = `<span class="ua-dialog-icon">${icon}</span><span class="ua-dialog-text">${text.replace(/[<>&]/g, c=>({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c]))}</span>`;
            root.querySelector('.ua-shell').appendChild(b);
            setTimeout(() => { b.classList.add('ua-dialog-out'); setTimeout(() => b.remove(), 500); }, 4500);
        }
        document.addEventListener('keydown', onKey);
        document.addEventListener('keyup', onKey);

        // ── Backpack + drag-drop ─────────────────────────
        const $pack = root.querySelector('#ua-backpack');
        const $packBody = root.querySelector('#ua-backpack-body');
        const $ghost = root.querySelector('#ua-drag-ghost');
        let dragState = null;

        function toggleBackpack() { togglePanel('pack'); }
        function togglePaperdoll() { togglePanel('doll'); }
        // ── Paperdoll + HUB + stats windows ──────────────
        const $doll     = root.querySelector('#ua-paperdoll');
        const $dollBody = root.querySelector('#ua-doll-slots');
        const $stats    = root.querySelector('#ua-stats');
        const $statsBody= root.querySelector('#ua-stats-body');

        const $craft     = root.querySelector('#ua-craft');
        const $craftBody = root.querySelector('#ua-craft-body');

        function _craftCategory(output) {
            const def = ITEMS[output];
            if (!def) return 'Other';
            if (def.boat) return '🛶 Boats';
            if (def.use) return '🧪 Consumables';
            const armorSlots = ['head', 'chest', 'feet', 'hands', 'shield', 'cape'];
            if (armorSlots.includes(def.slot)) return '🛡️ Armor';
            if (def.slot === 'weapon') return '⚔️ Weapons';
            if (['ring', 'neck', 'book'].includes(def.slot)) return '✦ Accessories';
            return '🔧 Other';
        }

        function renderCraft() {
            // Group recipes by category.
            const cats = {};
            RECIPES.forEach((r, ri) => {
                const cat = _craftCategory(r.output);
                (cats[cat] = cats[cat] || []).push({ r, ri });
            });
            const catOrder = ['🧪 Consumables', '⚔️ Weapons', '🛡️ Armor', '✦ Accessories', '🛶 Boats', '🔧 Other'];

            let html = '';
            for (const cat of catOrder) {
                const entries = cats[cat];
                if (!entries) continue;
                html += `<div class="ua-craft-cat">${cat}</div>`;
                for (const { r, ri } of entries) {
                    const def = ITEMS[r.output];
                    const counts = {};
                    for (const k of r.inputs) counts[k] = (counts[k] || 0) + 1;
                    let canCraft = true;
                    // Build ingredient string with have/need highlighting.
                    const ingParts = [];
                    for (const [k, need] of Object.entries(counts)) {
                        const have = inventory.items.filter(i => i.key === k).length;
                        if (have < need) canCraft = false;
                        const color = have >= need ? '#60ff60' : '#ff6060';
                        ingParts.push(`<span style="color:${color}">${ITEMS[k]?.emoji || '?'} ${have}/${need}</span>`);
                    }
                    html += `<div class="ua-craft-row">
                        <div class="ua-craft-item">${def.emoji} <b>${r.name}</b></div>
                        <div class="ua-craft-ing">${ingParts.join(' ')}</div>
                        <button class="ua-btn" data-craft="${ri}" ${canCraft ? '' : 'disabled'}>Craft</button>
                    </div>`;
                }
            }
            $craftBody.innerHTML = html;
            $craftBody.querySelectorAll('[data-craft]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const ri = Number(btn.dataset.craft);
                    const r = RECIPES[ri];
                    // Consume ingredients.
                    const toRemove = {};
                    for (const k of r.inputs) toRemove[k] = (toRemove[k] || 0) + 1;
                    for (const [k, n] of Object.entries(toRemove)) {
                        let rem = 0;
                        inventory.items = inventory.items.filter(i => {
                            if (i.key === k && rem < n) { rem++; return false; }
                            return true;
                        });
                    }
                    // Add result.
                    const def = ITEMS[r.output];
                    inventory.items.push({
                        id: 'it_' + Math.random().toString(36).slice(2, 9),
                        key: r.output, emoji: def.emoji, name: def.name,
                        x: 6 + (inventory.items.length % 7) * 36,
                        y: 6 + Math.floor(inventory.items.length / 7) * 36,
                    });
                    saveInventory();
                    addFloater(player.wx, player.wy, '🔨 ' + def.name, '#80c0ff');
                    _sfx(520, 0.08, 'triangle', 0.05); setTimeout(() => _sfx(780, 0.1, 'triangle', 0.04), 80);
                    // Skill XP from the crafted recipe inputs.
                    const inputs = r.inputs || [];
                    if (inputs.includes('wood')) addSkillXp('woodcutting', 3);
                    if (inputs.includes('stone') || inputs.includes('iron')) addSkillXp('mining', 3);
                    player.crafted = (player.crafted || 0) + 1;
                    renderCraft();
                    if ($pack.style.display !== 'none') renderBackpack();
                });
            });
        }

        // ── Spells ────────────────────────────────────────
        const SPELLS = [
            { name: 'Heal',       icon: '❤️', mana: 15, cooldown: 2000, target: 'self',  effect: (p) => { p.hp = Math.min(p.maxHp, p.hp + 20); addFloater(p.wx, p.wy, '+20 HP', '#60ff60'); } },
            { name: 'Fireball',   icon: '🔥', mana: 20, cooldown: 1500, target: 'enemy', dmg: 18 },
            { name: 'Lightning',  icon: '⚡', mana: 25, cooldown: 2000, target: 'enemy', dmg: 25 },
            { name: 'Cure',       icon: '💚', mana: 10, cooldown: 1000, target: 'self',  effect: (p) => { p.hp = Math.min(p.maxHp, p.hp + 8); p.stamina = Math.min(p.maxStamina, p.stamina + 20); addFloater(p.wx, p.wy, 'Cured!', '#60ff60'); } },
            { name: 'Mana Shield',icon: '🛡️', mana: 30, cooldown: 5000, target: 'self',  effect: (p) => { p.hp = Math.min(p.maxHp, p.hp + 5); p.maxHp += 5; addFloater(p.wx, p.wy, '+5 max HP', '#80c0ff'); } },
            { name: 'Light',      icon: '💡', mana: 8,  cooldown: 3000, target: 'self',  effect: (p) => { _spellLightUntil = _renderTime + 45000; addFloater(p.wx, p.wy, '💡 Light', '#ffe080'); } },
        ];
        let spellCooldowns = SPELLS.map(() => 0);

        function castSpell(idx) {
            const spell = SPELLS[idx];
            if (!spell) return;
            if (!equipment.book) { addFloater(player.wx, player.wy, 'No spellbook equipped!', '#ffaa00'); return; }
            if (player.mana < spell.mana) { addFloater(player.wx, player.wy, 'Not enough mana', '#4080e0'); return; }
            if (spellCooldowns[idx] > 0) { addFloater(player.wx, player.wy, 'Cooldown...', '#aaa'); return; }
            player.mana -= spell.mana;
            spellCooldowns[idx] = spell.cooldown;
            _sfx(520, 0.1, 'triangle', 0.06);

            if (spell.target === 'self' && spell.effect) {
                spell.effect(player);
            } else if (spell.target === 'enemy' && spell.dmg) {
                // Hit nearest creature within 5 tiles.
                let best = null, bestDist = 6;
                const cx0 = Math.floor(player.wx / CHUNK_SIZE), cy0 = Math.floor(player.wy / CHUNK_SIZE);
                const sources = _dungeon
                    ? [{ creatures: _dungeon.map.creatures, ox: 0, oy: 0 }]
                    : (() => { const s = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const ch = world.chunks.get((cx0+dx)+','+(cy0+dy)); if (ch) s.push({ creatures: ch.creatures, ox: (cx0+dx)*CHUNK_SIZE, oy: (cy0+dy)*CHUNK_SIZE }); } return s; })();
                for (const src of sources) for (const cr of src.creatures) {
                    if (cr.dead) continue;
                    const d = Math.max(Math.abs(src.ox + cr.c - player.wx), Math.abs(src.oy + cr.r - player.wy));
                    if (d < bestDist) { bestDist = d; best = { cr, src }; }
                }
                if (best) {
                    best.cr.hp = Math.max(0, best.cr.hp - spell.dmg);
                    addFloater(best.src.ox + best.cr.c, best.src.oy + best.cr.r, '-' + spell.dmg + ' ' + spell.icon, '#ff4040');
                    sfxHit();
                    if (best.cr.ai === 'neutral') best.cr.ai = 'aggressive';
                    if (best.cr.hp <= 0) {
                        const chCx = Math.floor((best.src.ox + best.cr.c) / CHUNK_SIZE);
                        const chCy = Math.floor((best.src.oy + best.cr.r) / CHUNK_SIZE);
                        killCreature(best.cr, chCx, chCy);
                    }
                } else {
                    addFloater(player.wx, player.wy, 'No target!', '#aaa');
                    player.mana += spell.mana; spellCooldowns[idx] = 0; // refund
                }
            }
        }

        const $magic     = root.querySelector('#ua-magic');
        const $magicBody = root.querySelector('#ua-magic-body');
        const $helpPanel = root.querySelector('#ua-help-panel');
        const $helpBody  = root.querySelector('#ua-help-body');

        function renderMagic() {
            $magicBody.innerHTML = SPELLS.map((s, i) => {
                const cd = spellCooldowns[i] > 0 ? ` (${(spellCooldowns[i]/1000).toFixed(1)}s)` : '';
                const canCast = equipment.book && player.mana >= s.mana && spellCooldowns[i] <= 0;
                return `<div class="ua-shop-row">
                    <span>${s.icon} <b>${s.name}</b></span>
                    <span style="font-size:11px;opacity:0.7">${s.mana} MP${cd}</span>
                    <button class="ua-btn" data-spell="${i}" ${canCast ? '' : 'disabled'}>${s.target === 'self' ? 'Cast' : 'Attack'}</button>
                </div>`;
            }).join('') + (equipment.book ? '' : '<div style="padding:8px;opacity:0.6;font-size:12px;">Equip a 📖 Spellbook to cast spells.</div>');
            $magicBody.querySelectorAll('[data-spell]').forEach(btn => {
                btn.addEventListener('click', () => {
                    castSpell(Number(btn.dataset.spell));
                    renderMagic();
                });
            });
        }

        function renderHelp() {
            $helpBody.innerHTML = `
                <div style="padding:12px;font-size:13px;line-height:1.7;">
                    <b>Controls</b><br>
                    WASD / Arrows — move<br>
                    Right-click + hold — walk toward cursor<br>
                    Left-click creature — attack (melee / bow)<br>
                    Space / E — interact (NPC, merchant, dungeon)<br>
                    Double-click item in bag — consume food/potion<br>
                    Q — quick potion · F — light a campfire 🔥 · G — plant sapling 🌱<br>
                    T — tame an adjacent passive creature (needs meat)<br>
                    Y — feed meat to wounded pets (raw +10, roast +25)<br>
                    U — Recall (30 mana, next to 🔥) → nearest distant camp<br>
                    Z — Sleep at 🔥 (night only) → full heal + dawn jump<br>
                    X — Toggle pets between Follow and Stay (stay still guards)<br>
                    V — Whistle: teleport all pets to your tile<br><br>
                    <b>Panels</b><br>
                    I / B — Backpack · P — Paperdoll · C — Craft<br>
                    K — Spellbook · H — This guide<br><br>
                    <b>Combat</b><br>
                    Click a creature to attack. Damage = base + weapon bonus.<br>
                    Weapons and armor now have durability — each swing and<br>
                    each hit taken wears them down. At 0 they break. Watch<br>
                    the green/orange/red bars on the paperdoll. Visit a<br>
                    merchant to repair gear (cost = missing_dur/2 gold).<br>
                    Combat mastery skips some wear rolls automatically.<br>
                    Bow 🏹 has range 3; melee range 1.5.<br>
                    Stamina ⚡ drains on move (2) and attack (8).<br>
                    Below 5 stamina you can't attack. Regen 6/s standing, 2/s walking.<br><br>
                    <b>Magic</b><br>
                    Equip a 📖 Spellbook, then press K to open the spell panel.<br>
                    Spells cost mana 💧 and have cooldowns.<br><br>
                    <b>Night</b><br>
                    Vision shrinks. Neutral creatures turn aggressive.<br>
                    Craft 🔥 campfires (2×🪵) and press F to light a safe<br>
                    radius of warm light for 90 s. Standing next to one is<br>
                    <b>resting</b> 💤: 4× HP regen, 3× mana regen, 1.5× stamina<br>
                    regen, and hunger pauses — camp out safely.<br>
                    Carry 🔦 torches for a personal light halo (stacks up<br>
                    to 3 for a wider radius). Tame pets also emit soft<br>
                    auras so you don't lose them in the dark.<br><br>
                    <b>Hunger</b><br>
                    🍗 decays over time. At 0 you stop regenerating and<br>
                    starvation drains HP. Eat food (berries, apples, bread,<br>
                    meat...) to refill.<br><br>
                    <b>Cooking & Brewing</b><br>
                    Hunt passive creatures (🐑 🐇 🦌 🐗 🐄 🐓 🦆) for 🥩 Raw Meat.<br>
                    Stand next to a burning 🔥 campfire; raw meat roasts into<br>
                    🍖 Roast Meat every ~3 s (a big hunger refill). When no<br>
                    raw meat is left, the fire brews 🌿 herb + 🍄 mushroom<br>
                    into a 🧪 potion on the same cycle (and burns extra fuel).<br>
                    Eating 🍖 grants a 30 s <b>Well Fed</b> buff: +20% damage.<br><br>
                    <b>Skills</b><br>
                    Every chop, mine, cook, fish, tame, and swing feeds a<br>
                    per-skill XP counter (level 0–100, sqrt curve).<br>
                    Bonuses at higher levels:<br>
                    · Woodcutting — chance of a bonus drop per chop<br>
                    · Mining — cheaper swings + bonus drop chance<br>
                    · Cooking — faster roast cycles (3s → 1s at 100)<br>
                    · Fishing — higher catch rate (40% → 75%, +20% with 🎣 rod)<br>
                    · Taming — higher tame success (+up to 40%)<br>
                    · Combat — +1 damage per 20 levels<br><br>
                    <b>The Ancient Runes ⚝</b><br>
                    Four rune shards bind the realm — each held by a boss<br>
                    family: ᚠ dragons (🐉 🐲), ᚢ brutes (👹 🧌), ᚦ the<br>
                    undead (🧟), ᚨ demons (👿). Slaying a boss of a family<br>
                    attunes its shard (guaranteed, once). Bosses lurk in the<br>
                    deepest dungeon rooms and on high mountains. Gather all<br>
                    four to forge the <b>Seal of Aruta</b> — a permanent boon<br>
                    (+20 HP/MP/SP, +2 DMG) and the realm's gratitude. Track<br>
                    progress in the Stats panel.<br><br>
                    <b>Treasure Maps</b><br>
                    Rare 🗺️ drops from bosses (🐉 🐲 👿 👹 🧟). Each map<br>
                    points to a buried hoard 20–60 tiles away. Double-click<br>
                    the map in your backpack: if you're far from the spot,<br>
                    the map shows the compass direction and distance. Stand<br>
                    within 2 tiles and double-click again to dig up the<br>
                    treasure — a burst of gold, gems, iron, and gear.<br><br>
                    <b>Taming</b><br>
                    Stand next to a passive creature (🐑 🐇 🦌 🐄 🐴 🐓...),<br>
                    hold 🥩 or 🍖 and press T. 50% chance (+25% if wounded).<br>
                    Tamed pets follow you and attack aggressive enemies<br>
                    within 5 tiles. Max 3 pets at once. Pets gain XP from<br>
                    their kills and level up — each level adds +10 max HP<br>
                    and +1 damage (level × 20 XP required).<br><br>
                    <b>Building</b><br>
                    Craft 🧱 Stone Walls (3×🪨) and drag them from the<br>
                    backpack onto an adjacent empty tile (≤ 2 away) to<br>
                    deploy. Walls block player and creature movement —<br>
                    use them to fence camps, funnel enemies, or close off<br>
                    a safe sleeping spot. Mine walls back to stone by<br>
                    clicking them (several hits).<br><br>
                    <b>Forestry & Farming</b><br>
                    Chopping trees occasionally drops a 🌱 Sapling (18%).<br>
                    Press G on fertile soil (grass / forest / swamp / savanna<br>
                    / tundra) to plant. Priority: sapling (→ 🌳 in 2 min) →<br>
                    herb (→ 🌿 in 1 min) → berry (→ 🌾 in 75 s) → mushroom<br>
                    (→ 🍄 in 90 s). Mature crops gather like wild plants.<br><br>
                    <b>Enchanting</b><br>
                    Visit a merchant with 💎 gems to enchant equipped gear.<br>
                    Each level costs 1 gem + 20 gold (max +3 per piece).<br>
                    Weapons gain +2 damage per enchant, armor gains +1 def.<br><br>
                    <b>Quests</b><br>
                    Talk to villagers (Space / E adjacent to an NPC) —<br>
                    60% they'll hand you a gather or kill quest. One<br>
                    active at a time; return to the same NPC to turn<br>
                    it in for gold. Progress shows in the Stats panel.<br><br>
                    <b>Weather</b><br>
                    Biomes with high moisture trigger ☔/⛈️ rain. Under<br>
                    rain: saplings grow up to 2.5× faster, but campfires<br>
                    burn through fuel up to 2× faster. Plan your camps.<br><br>
                    <b>Mining</b><br>
                    Mountain biomes now spawn ⛰️ peaks and 🪨 boulders. Click<br>
                    within 2 tiles to mine. Peaks are rich in 🔩 Iron Ingots<br>
                    but cost 6 stamina per swing; boulders are cheaper but<br>
                    yield mostly stone. Iron unlocks sword / helm / armor<br>
                    upgrades in the Craft panel.<br><br>
                    <b>Dungeons</b><br>
                    Step on 🕳️/🏚️ and press Space to enter.<br>
                    Stronger enemies + treasure chests 🧰 inside.<br>
                    Find the 🪜 ladder to exit.
                </div>
            `;
        }

        function togglePanel(kind) {
            const m = { pack: $pack, doll: $doll, stats: $stats, craft: $craft, magic: $magic, help: $helpPanel };
            const el = m[kind]; if (!el) return;
            const open = el.style.display !== 'none';
            if (open) el.style.display = 'none';
            else { el.style.display = ''; if (kind === 'pack') renderBackpack(); if (kind === 'doll') renderPaperdoll(); if (kind === 'stats') renderStats(); if (kind === 'craft') renderCraft(); if (kind === 'magic') renderMagic(); if (kind === 'help') renderHelp(); }
        }
        root.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => togglePanel(btn.dataset.close)));
        root.querySelectorAll('.ua-hub-btn').forEach(btn => btn.addEventListener('click', () => togglePanel(btn.dataset.hub)));
        root.querySelector('#ua-backpack-sort')?.addEventListener('click', () => {
            // Group inventory items by key, then lay them out in a 7-wide grid.
            inventory.items.sort((a, b) => a.key.localeCompare(b.key) || (a.id < b.id ? -1 : 1));
            inventory.items.forEach((it, i) => {
                it.x = 6 + (i % 7) * 36;
                it.y = 6 + Math.floor(i / 7) * 36;
            });
            saveInventory();
            renderBackpack();
        });

        function renderPaperdoll() {
            $dollBody.innerHTML = SLOTS.map(s => {
                const it = equipment[s.key];
                let inner = '';
                if (it) {
                    let durBar = '';
                    if (typeof it.dur === 'number' && typeof it.durMax === 'number' && it.durMax > 0) {
                        const pct = Math.max(0, Math.min(1, it.dur / it.durMax));
                        const color = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#f44336';
                        durBar = `<div style="position:absolute;left:2px;right:2px;bottom:2px;height:3px;background:rgba(0,0,0,0.4);border-radius:1px;">` +
                                 `<div style="width:${(pct * 100).toFixed(0)}%;height:100%;background:${color};border-radius:1px;"></div></div>`;
                    }
                    const durTitle = typeof it.dur === 'number' ? ` (${Math.ceil(it.dur)}/${it.durMax})` : '';
                    const enchTag = it.enchant ? `<span style="position:absolute;top:-2px;right:-2px;color:#c080ff;font-size:10px;text-shadow:0 0 3px #000;">+${it.enchant}</span>` : '';
                    inner = `<div class="ua-item ua-slot-item" data-slot-of="${s.key}" title="${it.name}${it.enchant ? ' +' + it.enchant : ''}${durTitle}" style="position:relative;">${it.emoji}${enchTag}${durBar}</div>`;
                }
                return `<div class="ua-slot" data-slot="${s.key}"><div class="ua-slot-label">${s.label}</div><div class="ua-slot-cell">${inner}</div></div>`;
            }).join('');
            // Wire equipped items for drag (equip → inventory or swap).
            $dollBody.querySelectorAll('.ua-slot-item').forEach(el => {
                el.addEventListener('pointerdown', (ev) => {
                    ev.preventDefault();
                    const slotKey = el.dataset.slotOf;
                    const it = equipment[slotKey];
                    if (!it) return;
                    startDrag('equip', { invItem: it, fromSlot: slotKey }, ev.clientX, ev.clientY);
                });
            });
        }
        function renderStats() {
            const b = biomeAtDg(player.wx, player.wy);
            const bm = (ALL_BIOMES[b] || BIOMES.grass).name;
            const cd = classDef || CLASSES.warrior;
            const wpn = equipment.weapon;
            const wpnStr = wpn ? `${ITEMS[wpn.key]?.emoji || '?'} ${wpn.name} (+${getWeaponDmg()})` : 'Bare hands';
            $statsBody.innerHTML = `
                <div><b>${worldRow.name}</b></div>
                <div>Class: ${cd.icon} <b>${cd.name}</b></div>
                <div>Level: <b>${player.level}</b> (${player.xp}/${player.xpNext} XP)</div>
                <div>Weapon: ${wpnStr}</div>
                <div>Armor: 🛡️ <b>${getArmorDef()}</b> defense</div>
                <div>Base DMG: <b>${player.baseDmg}</b></div>
                <div style="margin-top:6px">Position: ${player.wx}, ${player.wy}</div>
                <div>Biome: ${bm}</div>
                <div>Seed: <span style="color:#ffc857">${worldRow.seed}</span></div>
                <div>Kills: 💀 <b>${player.kills}</b> · Crafted: 🔨 <b>${player.crafted || 0}</b> · Days: <b>${player.days + 1}</b></div>
                <div style="margin-top:8px"><b>Skills</b></div>
                ${(() => {
                    const icons = { woodcutting: '🪓', mining: '⛏️', cooking: '🍳', fishing: '🎣', taming: '💖', combat: '⚔️' };
                    return Object.entries(player.skills || {}).map(([k, xp]) => {
                        const lvl = skillLevel(xp);
                        const next = Math.pow((lvl + 1) / 0.63, 2);
                        return `<div style="display:flex;gap:6px;align-items:center;">
                            <span style="width:18px">${icons[k] || '•'}</span>
                            <span style="width:84px;text-transform:capitalize">${k}</span>
                            <span style="width:30px;text-align:right"><b>${lvl}</b></span>
                            <span style="flex:1;font-size:10px;color:#aac">${Math.floor(xp)} / ${Math.floor(next)} xp</span>
                        </div>`;
                    }).join('');
                })()}
                <div style="margin-top:6px">Inventory: ${inventory.items.length} items</div>
                ${(() => {
                    const earned = [];
                    if (player._slayDragon) earned.push('🏆 Dragonslayer');
                    if (player._slayDemon) earned.push('🏆 Demonbreaker');
                    if (player._slayBrute) earned.push('🏆 Brutebane');
                    if (!earned.length) return '';
                    return `<div style="margin-top:6px"><b>Titles</b></div>
                        <div style="font-size:11px;opacity:0.9;">${earned.join(' · ')}</div>`;
                })()}
                ${(() => {
                    const have = RUNE_SHARDS.filter(s => runeShards[s.id]).length;
                    const glyphs = RUNE_SHARDS.map(s =>
                        `<span title="${s.name}" style="color:#c0a0ff;opacity:${runeShards[s.id] ? 1 : 0.22};">${s.rune}</span>`
                    ).join(' ');
                    return `<div style="margin-top:6px"><b>Ancient Runes</b> ${sealForged ? '· ⚝ Seal of Aruta forged' : `(${have}/4)`}</div>
                        <div style="font-size:16px;letter-spacing:8px;">${glyphs}</div>`;
                })()}
                ${activeQuest ? `<div style="margin-top:6px;padding:6px;background:rgba(200,170,80,0.12);border-left:3px solid #ffc857;border-radius:2px;">
                    <b>📜 Active Quest</b><br>
                    <span style="font-size:11px">${_questProgressText(activeQuest)} → ${activeQuest.reward.gold}🪙</span>
                </div>` : ''}
                <div style="margin-top:10px"><button class="ua-btn ua-btn-danger" id="ua-back-to-menu">↩ Back to world menu</button></div>
            `;
            $statsBody.querySelector('#ua-back-to-menu').addEventListener('click', () => {
                // Persist state then re-mount the shell.
                sdk.storage.set(STATE_KEY, {
                    seed, px: player.wx, py: player.wy, timeOfDay, playerClass,
                    hp: player.hp, mana: player.mana, stamina: player.stamina, hunger: player.hunger,
                    level: player.level, xp: player.xp, xpNext: player.xpNext,
                    maxHp: player.maxHp, maxMana: player.maxMana, maxStamina: player.maxStamina, maxHunger: player.maxHunger, baseDmg: player.baseDmg, kills: player.kills, days: player.days,
                    pets: pets.map(p => ({ emoji: p.emoji, name: p.name, hp: p.hp, maxHp: p.maxHp, dmg: p.dmg, wx: p.wx, wy: p.wy, level: p.level, xp: p.xp, command: p.command })),
                    skills: player.skills,
                    activeQuest,
                    crafted: player.crafted || 0,
                    slayDragon: player._slayDragon || false,
                    slayDemon: player._slayDemon || false,
                    slayBrute: player._slayBrute || false,
                    runeShards, sealForged,
                }).catch(e => console.warn('[ultima-aruta] save state failed', e));
                root.__uaCleanup?.();
                // Reload by re-invoking mount — simplest way.
                location.reload();
            });
        }

        root.querySelector('#ua-backpack-close')?.addEventListener?.('click', toggleBackpack);

        // Draggable backpack window — grab the title bar.
        (function makeBackpackDraggable() {
            const head = root.querySelector('.ua-backpack-head');
            let dragging = false, dx = 0, dy = 0;
            head.style.cursor = 'grab';
            head.addEventListener('pointerdown', (ev) => {
                if (ev.target.closest('.ua-backpack-close')) return;
                dragging = true;
                const rect = $pack.getBoundingClientRect();
                dx = ev.clientX - rect.left;
                dy = ev.clientY - rect.top;
                // Remove the centering transform so left/top in px apply directly.
                $pack.style.transform = 'none';
                $pack.style.left = rect.left + 'px';
                $pack.style.top  = rect.top  + 'px';
                head.setPointerCapture?.(ev.pointerId);
                head.style.cursor = 'grabbing';
            });
            head.addEventListener('pointermove', (ev) => {
                if (!dragging) return;
                $pack.style.left = (ev.clientX - dx) + 'px';
                $pack.style.top  = (ev.clientY - dy) + 'px';
            });
            function stop() { dragging = false; head.style.cursor = 'grab'; }
            head.addEventListener('pointerup', stop);
            head.addEventListener('pointercancel', stop);
        })();

        function renderBackpack() {
            $packBody.innerHTML = '';
            for (const it of inventory.items) {
                const el = document.createElement('div');
                el.className = 'ua-item';
                el.style.left = (it.x || 6) + 'px';
                el.style.top  = (it.y || 6) + 'px';
                el.textContent = it.emoji;
                el.title = it.name;
                el.dataset.id = it.id;
                $packBody.appendChild(el);
            }
        }

        function showGhost(emoji, x, y) {
            $ghost.textContent = emoji;
            $ghost.style.display = '';
            $ghost.style.left = x + 'px';
            $ghost.style.top  = y + 'px';
        }
        function hideGhost() { $ghost.style.display = 'none'; $ghost.textContent = ''; }

        // Convert CSS-pixel coords relative to canvas top-left into internal
        // 800×540 resolution coords (canvas stretches via CSS).
        function _cssToInternal(relX, relY) {
            const rect = canvas.getBoundingClientRect();
            return {
                x: relX * VIEW_W / rect.width,
                y: relY * VIEW_H / rect.height,
            };
        }

        function canvasToWorldCell(cssRelX, cssRelY) {
            const { x: canvasX, y: canvasY } = _cssToInternal(cssRelX, cssRelY);
            const W = VIEW_W, H = VIEW_H;
            const cam = camera(W, H, player.rx, player.ry);
            // Top-down inversion: each tile is TILE_SIZE square starting at
            // (cam.cx, cam.cy) for world (0,0). Floor to hit the tile the
            // pointer is over, not the nearest edge.
            return {
                wx: Math.floor((canvasX - cam.cx) / TILE_SIZE),
                wy: Math.floor((canvasY - cam.cy) / TILE_SIZE),
            };
        }

        function startDrag(source, data, pageX, pageY) {
            dragState = { source, ...data };
            const emoji = source === 'inv' ? data.invItem.emoji : ITEMS[data.worldKey].emoji;
            showGhost(emoji, pageX - 16, pageY - 16);
        }

        function _dropTarget(ev) {
            // What is under the pointer? Return one of 'pack' | 'doll:<slot>' | 'world' | null.
            if ($pack.style.display !== 'none') {
                const r = $packBody.getBoundingClientRect();
                if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return { kind: 'pack', rect: r };
            }
            if ($doll.style.display !== 'none') {
                for (const s of SLOTS) {
                    const slotEl = $dollBody.querySelector(`.ua-slot[data-slot="${s.key}"] .ua-slot-cell`);
                    if (!slotEl) continue;
                    const r = slotEl.getBoundingClientRect();
                    if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return { kind: 'doll', slot: s.key };
                }
            }
            return { kind: 'world' };
        }

        function endDrag(ev) {
            if (!dragState) return;
            hideGhost();
            const target = _dropTarget(ev);

            // ── From world ──────────────────────────────────
            if (dragState.source === 'world') {
                const key = dragState.worldKey;
                const def = ITEMS[key];
                const picked = () => removeItemAt(dragState.wx, dragState.wy);
                // Detect drop on the player's own tile (or any tile within 1),
                // which acts as a shortcut for "put in backpack".
                let droppedOnPlayer = false;
                if (target.kind === 'world') {
                    const cr = canvas.getBoundingClientRect();
                    const { wx, wy } = canvasToWorldCell(ev.clientX - cr.left, ev.clientY - cr.top);
                    droppedOnPlayer = Math.max(Math.abs(wx - player.wx), Math.abs(wy - player.wy)) <= 1;
                }
                if (target.kind === 'pack' && picked()) {
                    const r = target.rect;
                    inventory.items.push({
                        id: 'it_' + Math.random().toString(36).slice(2, 9),
                        key, emoji: def.emoji, name: def.name,
                        x: Math.max(0, ev.clientX - r.left - 16),
                        y: Math.max(0, ev.clientY - r.top  - 16),
                    });
                    saveInventory(); renderBackpack();
                } else if (target.kind === 'doll' && def.slot === target.slot && picked()) {
                    _equipTo(target.slot, {
                        id: 'it_' + Math.random().toString(36).slice(2, 9),
                        key, emoji: def.emoji, name: def.name,
                    });
                } else if (droppedOnPlayer && picked()) {
                    // Auto-pickup into backpack at a free-looking spot near the top-left.
                    // Treasure maps get freshly-rolled target coords at pickup time so
                    // every map sends you somewhere new.
                    if (key === 'treasure_map') {
                        inventory.items.push(newTreasureMapRow());
                    } else {
                        inventory.items.push({
                            id: 'it_' + Math.random().toString(36).slice(2, 9),
                            key, emoji: def.emoji, name: def.name,
                            x: 6 + (inventory.items.length % 7) * 36,
                            y: 6 + Math.floor(inventory.items.length / 7) * 36,
                        });
                    }
                    saveInventory();
                    if ($pack.style.display !== 'none') renderBackpack();
                }
                dragState = null;
                return;
            }

            // ── From inventory ──────────────────────────────
            if (dragState.source === 'inv') {
                if (target.kind === 'pack') {
                    const it = dragState.invItem;
                    const r = target.rect;
                    it.x = Math.max(0, ev.clientX - r.left - 16);
                    it.y = Math.max(0, ev.clientY - r.top  - 16);
                    saveInventory(); renderBackpack();
                } else if (target.kind === 'doll' && ITEMS[dragState.invItem.key]?.slot === target.slot) {
                    _equipTo(target.slot, dragState.invItem);
                    inventory.items = inventory.items.filter(i => i.id !== dragState.invItem.id);
                    saveInventory(); renderBackpack();
                } else if (target.kind === 'world') {
                    const cr = canvas.getBoundingClientRect();
                    const { wx, wy } = canvasToWorldCell(ev.clientX - cr.left, ev.clientY - cr.top);
                    const dist = Math.max(Math.abs(wx - player.wx), Math.abs(wy - player.wy));
                    if (dist <= 2 && world.canTraverse(wx, wy) && placeWorldItem(wx, wy, dragState.invItem.key)) {
                        inventory.items = inventory.items.filter(i => i.id !== dragState.invItem.id);
                        saveInventory(); renderBackpack();
                    }
                }
                dragState = null;
                return;
            }

            // ── From equipment slot ─────────────────────────
            if (dragState.source === 'equip') {
                const it = dragState.invItem;
                const fromSlot = dragState.fromSlot;
                if (target.kind === 'doll' && ITEMS[it.key]?.slot === target.slot) {
                    equipment[fromSlot] = null;
                    _equipTo(target.slot, it);
                } else if (target.kind === 'pack' || target.kind === 'world') {
                    // Unequip → backpack (or drop on world if far).
                    delete equipment[fromSlot];
                    if (target.kind === 'pack') {
                        const r = target.rect;
                        inventory.items.push({
                            ...it,
                            x: Math.max(0, ev.clientX - r.left - 16),
                            y: Math.max(0, ev.clientY - r.top  - 16),
                        });
                        saveInventory(); renderBackpack();
                    } else {
                        const cr = canvas.getBoundingClientRect();
                        const { wx, wy } = canvasToWorldCell(ev.clientX - cr.left, ev.clientY - cr.top);
                        const dist = Math.max(Math.abs(wx - player.wx), Math.abs(wy - player.wy));
                        if (dist <= 2 && world.canTraverse(wx, wy)) placeWorldItem(wx, wy, it.key);
                        else inventory.items.push(it);
                        saveInventory(); renderBackpack();
                    }
                    saveEquipment(); renderPaperdoll();
                }
                dragState = null;
            }
        }

        // Max durability per item key. Weapons/tools wear down on attack,
        // armor wears down when the player takes a hit. Missing key → no
        // durability (item is indestructible, e.g. jewelry).
        const MAX_DURABILITY = {
            sword: 80, axe: 100, bow: 70, dagger: 60, wand: 50, rod: 120,
            shield: 90, helm: 60, crown: 120, hat: 50,
            armor: 120, robe: 60, gloves: 50, boots: 60, sandals: 40,
            cape: 40, spellbook: 100, crystal: 80,
        };
        // ── NPC Quests ───────────────────────────────────────────
        // Single active quest at a time. Villagers hand them out; completing
        // one refills the pool so there's always something to grind toward.
        let activeQuest = (saved && saved.activeQuest) || null;

        function _questGatherPick() {
            const pool = [
                { key: 'herb', n: 4 },
                { key: 'berry', n: 4 },
                { key: 'mushroom', n: 3 },
                { key: 'wood', n: 5 },
                { key: 'stone', n: 5 },
                { key: 'iron', n: 2 },
                { key: 'feather', n: 3 },
                { key: 'raw_meat', n: 3 },
            ];
            return pool[Math.floor(Math.random() * pool.length)];
        }
        function _questKillPick() {
            const pool = [
                { emoji: '🐺', n: 2 }, { emoji: '🐍', n: 3 },
                { emoji: '🦂', n: 3 }, { emoji: '🕷️', n: 2 },
                { emoji: '🐗', n: 2 }, { emoji: '🦇', n: 3 },
            ];
            return pool[Math.floor(Math.random() * pool.length)];
        }
        function _generateQuest(giverWx, giverWy) {
            const gather = Math.random() < 0.6;
            if (gather) {
                const p = _questGatherPick();
                return {
                    kind: 'gather', item: p.key, needed: p.n, current: 0,
                    giverWx, giverWy,
                    reward: { gold: 15 + p.n * 8 },
                };
            } else {
                const p = _questKillPick();
                return {
                    kind: 'kill', target: p.emoji, needed: p.n, current: 0,
                    giverWx, giverWy,
                    reward: { gold: 25 + p.n * 12 },
                };
            }
        }
        function _giveGold(n) {
            for (let i = 0; i < n; i++) {
                const def = ITEMS.gold;
                inventory.items.push({
                    id: 'it_' + Math.random().toString(36).slice(2, 9),
                    key: 'gold', emoji: def.emoji, name: def.name,
                    x: 6 + (inventory.items.length % 7) * 36,
                    y: 6 + Math.floor(inventory.items.length / 7) * 36,
                });
            }
            saveInventory();
        }
        function _questProgressText(q) {
            if (q.kind === 'gather') {
                const have = inventory.items.filter(i => i.key === q.item).length;
                const def = ITEMS[q.item];
                return `Bring me ${q.needed} ${def?.emoji || ''} ${def?.name || q.item}. (${Math.min(have, q.needed)}/${q.needed})`;
            }
            return `Slay ${q.needed}× ${q.target}. (${q.current}/${q.needed})`;
        }
        function talkToNpc(f, nwx, nwy) {
            if (activeQuest) {
                // Same giver — check for completion.
                if (activeQuest.giverWx === nwx && activeQuest.giverWy === nwy) {
                    let done = false;
                    if (activeQuest.kind === 'gather') {
                        const have = inventory.items.filter(i => i.key === activeQuest.item);
                        if (have.length >= activeQuest.needed) {
                            // Remove required items.
                            let removed = 0;
                            inventory.items = inventory.items.filter(i => {
                                if (i.key === activeQuest.item && removed < activeQuest.needed) { removed++; return false; }
                                return true;
                            });
                            saveInventory();
                            done = true;
                        }
                    } else if (activeQuest.kind === 'kill') {
                        if (activeQuest.current >= activeQuest.needed) done = true;
                    }
                    if (done) {
                        _giveGold(activeQuest.reward.gold);
                        addFloater(player.wx, player.wy, '+' + activeQuest.reward.gold + '🪙', '#ffd060');
                        showDialogBubble(f.emoji, `Well done! Here's ${activeQuest.reward.gold} gold for your trouble.`);
                        addSkillXp('combat', 2);
                        activeQuest = null;
                        return;
                    }
                    showDialogBubble(f.emoji, `Not yet — ${_questProgressText(activeQuest)}`);
                    return;
                }
                // Different NPC — remind.
                showDialogBubble(f.emoji, `Another asked you already. ${_questProgressText(activeQuest)}`);
                return;
            }
            // No active quest — offer one with 60% chance, else idle chatter.
            if (Math.random() < 0.6) {
                activeQuest = _generateQuest(nwx, nwy);
                showDialogBubble(f.emoji, `Hail, traveller! ${_questProgressText(activeQuest)} Reward: ${activeQuest.reward.gold} gold.`);
                return;
            }
            showDialogBubble(f.emoji, f.dialog || DIALOGS[Math.floor(Math.random() * DIALOGS.length)]);
        }

        // Returns true if the (wx, wy) tile is inside the light radius of
        // any burning campfire in the 3×3 chunk neighborhood.
        function nearBurningCampfire(wx, wy) {
            if (_dungeon) return false;
            const cx0 = Math.floor(wx / CHUNK_SIZE), cy0 = Math.floor(wy / CHUNK_SIZE);
            for (let dcy = -1; dcy <= 1; dcy++) for (let dcx = -1; dcx <= 1; dcx++) {
                const ch = world.chunks.get((cx0 + dcx) + ',' + (cy0 + dcy));
                if (!ch) continue;
                for (const f of ch.features) {
                    if (f.structKey !== 'campfire') continue;
                    if (typeof f.fuel === 'number' && f.fuel <= 0) continue;
                    const fwx = (cx0 + dcx) * CHUNK_SIZE + f.c;
                    const fwy = (cy0 + dcy) * CHUNK_SIZE + f.r;
                    const light = ITEMS.campfire?.structure?.light || 4;
                    if (Math.max(Math.abs(fwx - wx), Math.abs(fwy - wy)) <= light) return true;
                }
            }
            return false;
        }

        // ── Buffs ────────────────────────────────────────────────
        // Single active buff slot. Set by consuming certain foods or touching
        // sacred objects. Drained per-frame in the combat tick.
        //   dmgMult    — multiplies outgoing damage
        //   dmgReduce  — flat damage reduction on incoming hits (>= 0)
        let activeBuff = null; // { type, dmgMult, dmgReduce, remaining, icon, label }
        function applyFoodBuff(itemKey) {
            // Roast meat grants +20% damage for 30 s.
            if (itemKey === 'meat') {
                activeBuff = {
                    type: 'wellfed', dmgMult: 1.2, remaining: 30000,
                    icon: '🍖', label: '+20% dmg',
                };
                addFloater(player.wx, player.wy, '🍖 Well Fed +20% dmg', '#ffb070');
            }
        }
        // Timestamp (ms since mount) of the last fountain blessing so the
        // shrine can't be spammed for permanent invulnerability.
        let _lastBlessing = -Infinity;
        function applyBlessing() {
            if (_renderTime - _lastBlessing < 120000) {
                addFloater(player.wx, player.wy, '🙏 Blessing still pending', '#aaa');
                return;
            }
            _lastBlessing = _renderTime;
            activeBuff = {
                type: 'blessed', dmgReduce: 3, remaining: 60000,
                icon: '🙏', label: '-3 incoming dmg',
            };
            addFloater(player.wx, player.wy, '🙏 Blessed', '#e0d060');
        }

        // ── Weather ──────────────────────────────────────────────
        // Sample the moisture noise field at the player's tile. Rain starts
        // at moist > 0.55 and scales up from there; intensity 0..1 drives
        // the rain particle density in render() and gameplay modifiers
        // (sapling growth + campfire fuel drain) in the structure tick.
        function rainIntensity() {
            if (_dungeon) return 0;
            const moist = fbm2D(player.wx / 120, player.wy / 120, world.seed + 9999, 3, 0.5);
            if (moist <= 0.55) return 0;
            return Math.min(1, (moist - 0.55) * 4);
        }

        // ── Skill XP ─────────────────────────────────────────────
        // Skill level grows with total XP on a soft sqrt curve so early
        // levels come quickly but mastery is a long grind — classic UO pacing.
        // skillLevel(xp) -> 0..100, with 100 around 25k XP.
        function skillLevel(xp) {
            if (!xp) return 0;
            return Math.min(100, Math.floor(Math.sqrt(xp) * 0.63));
        }
        function addSkillXp(name, amount) {
            if (!player.skills || !(name in player.skills)) return;
            const before = skillLevel(player.skills[name]);
            player.skills[name] += amount;
            const after = skillLevel(player.skills[name]);
            if (after > before) {
                addFloater(player.wx, player.wy, `⬆ ${name} ${after}`, '#a0d0ff');
                _sfx(820, 0.08, 'sine', 0.04);
            }
        }

        // Consume a treasure map. If the player is within 2 tiles of its
        // target, spawn a burst of loot items into the backpack; otherwise
        // paint a compass hint so the player can navigate toward the spot.
        function useTreasureMap(it) {
            if (_dungeon) { addFloater(player.wx, player.wy, 'Go outside to dig', '#ffaa00'); return; }
            const meta = it.meta;
            if (!meta || typeof meta.tx !== 'number' || typeof meta.ty !== 'number') {
                // Legacy/corrupt map — reroll target around current position.
                const rerolled = newTreasureMapRow();
                it.meta = rerolled.meta;
                addFloater(player.wx, player.wy, '🗺️ Rerolled!', '#c0a060');
                saveInventory();
                return;
            }
            const dx = meta.tx - player.wx;
            const dy = meta.ty - player.wy;
            const dist = Math.max(Math.abs(dx), Math.abs(dy));
            if (dist > 2) {
                const dir = _compassDir(dx, dy);
                addFloater(player.wx, player.wy, `🗺️ ${dist} tiles ${dir}`, '#e0c080');
                return;
            }
            // Dig! Spawn loot into inventory (up to backpack space, sanity cap 8).
            const drops = rollTreasureLoot().slice(0, 8);
            for (const key of drops) {
                const def = ITEMS[key];
                if (!def) continue;
                inventory.items.push({
                    id: 'it_' + Math.random().toString(36).slice(2, 9),
                    key, emoji: def.emoji, name: def.name,
                    x: 6 + (inventory.items.length % 7) * 36,
                    y: 6 + Math.floor(inventory.items.length / 7) * 36,
                });
            }
            inventory.items = inventory.items.filter(i => i.id !== it.id);
            saveInventory();
            if ($pack.style.display !== 'none') renderBackpack();
            addFloater(player.wx, player.wy, '💎 Treasure!', '#ffe060');
            _sfx(820, 0.25, 'sine', 0.06);
            showDialogBubble('🧰', `Dug up a buried hoard: ${drops.map(k => ITEMS[k]?.emoji || '?').join(' ')}`);
        }

        // Discrete compass direction from a delta vector.
        function _compassDir(dx, dy) {
            const ax = Math.abs(dx), ay = Math.abs(dy);
            if (ax > ay * 2) return dx > 0 ? 'E' : 'W';
            if (ay > ax * 2) return dy > 0 ? 'S' : 'N';
            if (dx > 0 && dy > 0) return 'SE';
            if (dx > 0 && dy < 0) return 'NE';
            if (dx < 0 && dy > 0) return 'SW';
            return 'NW';
        }

        // Build a treasure-map item row with randomized target coords, 20–60
        // tiles away from the player along a random compass direction.
        function newTreasureMapRow() {
            const def = ITEMS.treasure_map;
            const angle = Math.random() * Math.PI * 2;
            const dist  = 20 + Math.floor(Math.random() * 40);
            const tx = Math.round(player.wx + Math.cos(angle) * dist);
            const ty = Math.round(player.wy + Math.sin(angle) * dist);
            return {
                id: 'it_' + Math.random().toString(36).slice(2, 9),
                key: 'treasure_map', emoji: def.emoji, name: def.name,
                meta: { tx, ty },
                x: 6 + (inventory.items.length % 7) * 36,
                y: 6 + Math.floor(inventory.items.length / 7) * 36,
            };
        }

        // Pick a small batch of loot keys for a solved treasure map. Weighted
        // toward gold + gems, occasionally drops a full piece of armor.
        function rollTreasureLoot() {
            const pool = [
                ['gold', 0.9], ['gold', 0.9], ['gold', 0.9],
                ['gem', 0.6], ['gem', 0.4],
                ['potion', 0.5], ['scroll', 0.3],
                ['iron', 0.5], ['iron', 0.3],
                ['ring', 0.25], ['necklace', 0.2], ['crown', 0.1],
                ['spellbook', 0.15], ['armor', 0.2], ['sword', 0.15],
            ];
            const results = [];
            for (const [key, rate] of pool) if (Math.random() < rate) results.push(key);
            if (!results.length) results.push('gold', 'gem');
            return results;
        }

        function _ensureDur(itemRow) {
            if (!itemRow) return;
            const max = MAX_DURABILITY[itemRow.key];
            if (max != null && typeof itemRow.dur !== 'number') itemRow.dur = max;
            if (max != null && typeof itemRow.durMax !== 'number') itemRow.durMax = max;
        }
        // Retroactively seed durability on items loaded from older saves so
        // the UI never flashes "—/—" for pre-existing gear.
        for (const it of inventory.items) _ensureDur(it);
        for (const slot of Object.keys(equipment)) _ensureDur(equipment[slot]);
        function _equipTo(slotKey, itemRow) {
            // If already equipped, the displaced item goes to the backpack.
            const prev = equipment[slotKey];
            _ensureDur(itemRow);
            equipment[slotKey] = itemRow;
            if (prev && prev !== itemRow) {
                inventory.items.push({ ...prev, x: 6, y: 6 });
            }
            saveEquipment(); saveInventory();
            renderPaperdoll(); renderBackpack();
        }

        // Wear down the equipped weapon by one tick. Breaks at 0, moving the
        // item out of the slot with a warning floater. Mastery mitigates wear:
        // at combat 100 the wear roll is skipped 50% of the time.
        function _wearWeapon() {
            const w = equipment.weapon;
            if (!w || typeof w.dur !== 'number') return;
            if (player?.skills && Math.random() < skillLevel(player.skills.combat) / 200) return;
            w.dur -= 1;
            if (w.dur <= 0) {
                equipment.weapon = null;
                addFloater(player.wx, player.wy, '💥 ' + w.name + ' broke!', '#ff8040');
                _sfx(160, 0.2, 'sawtooth', 0.05);
                saveEquipment();
                if ($doll.style.display !== 'none') renderPaperdoll();
            }
        }
        // Wear a random equipped armor piece. Called whenever the player
        // soaks a hit. Jewelry (no durability) is skipped.
        function _wearArmor() {
            const slots = Object.keys(equipment).filter(s => {
                const it = equipment[s];
                return it && typeof it.dur === 'number' && s !== 'weapon' && s !== 'book';
            });
            if (!slots.length) return;
            const slot = slots[Math.floor(Math.random() * slots.length)];
            const it = equipment[slot];
            it.dur -= 1;
            if (it.dur <= 0) {
                equipment[slot] = null;
                addFloater(player.wx, player.wy, '💥 ' + it.name + ' broke!', '#ff8040');
                _sfx(140, 0.2, 'sawtooth', 0.05);
                saveEquipment();
                if ($doll.style.display !== 'none') renderPaperdoll();
            }
        }

        canvas.addEventListener('pointerdown', (ev) => {
            if (ev.button === 2) return; // right-click handled by mouseWalk below
            const rect = canvas.getBoundingClientRect();
            const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
            // Emoji render anchor is at the bottom of the tile, so the visible
            // glyph hovers ~20–30 px above its logical cell. Probe the clicked
            // cell and a small cluster just above it (wy-1, wx-1, wx+1) so a
            // click on the *visible* sprite maps to its owner tile.
            const hit = _findItemNear(cx, cy, world, canvasToWorldCell);
            if (!hit) return;
            const { wx, wy, feature: f } = hit;
            const dist = Math.max(Math.abs(wx - player.wx), Math.abs(wy - player.wy));
            if (dist > 2) return;
            startDrag('world', { worldKey: f.itemKey, wx, wy }, ev.clientX, ev.clientY);
        });

        function _findItemNear(cx, cy, _unused, c2w) {
            const base = c2w(cx, cy);
            const offsets = [[0,0],[0,-1],[-1,-1],[1,-1],[-1,0],[1,0],[0,1],[0,-2],[-1,-2],[1,-2]];
            for (const [dx, dy] of offsets) {
                const wx = base.wx + dx, wy = base.wy + dy;
                const f = featureAtDg(wx, wy);
                if (f && f.item) return { wx, wy, feature: f };
            }
            return null;
        }

        // Remove an item from wherever we are (overworld or dungeon).
        function removeItemAt(wx, wy) {
            if (_dungeon) {
                const idx = _dungeon.map.features.findIndex(f => f.c === wx && f.r === wy && f.item);
                if (idx < 0) return null;
                const f = _dungeon.map.features[idx];
                _dungeon.map.features.splice(idx, 1);
                return f.itemKey;
            }
            return removeWorldItem(wx, wy);
        }

        // Double-click an item in backpack to consume it (food/potions).
        $packBody.addEventListener('dblclick', (ev) => {
            const itemEl = ev.target.closest('.ua-item');
            if (!itemEl) return;
            const id = itemEl.dataset.id;
            const it = inventory.items.find(i => i.id === id);
            if (!it) return;
            const def = ITEMS[it.key];
            if (def && def.map) { useTreasureMap(it); return; }
            if (!def || !def.use) { addFloater(player.wx, player.wy, 'Cannot use', '#aaa'); return; }
            // Apply effects.
            if (def.use.hp)      player.hp      = Math.min(player.maxHp,      player.hp      + def.use.hp);
            if (def.use.mana)    player.mana    = Math.min(player.maxMana,    player.mana    + def.use.mana);
            if (def.use.stamina) player.stamina = Math.min(player.maxStamina, player.stamina + def.use.stamina);
            if (def.use.hunger)  player.hunger  = Math.min(player.maxHunger,  player.hunger  + def.use.hunger);
            if (def.use.cure) { player.poison = 0; player.poisonDps = 0; }
            applyFoodBuff(it.key);
            // Remove from inventory.
            inventory.items = inventory.items.filter(i => i.id !== id);
            saveInventory();
            renderBackpack();
            const parts = [];
            if (def.use.hp)      parts.push('+' + def.use.hp + ' HP');
            if (def.use.mana)    parts.push('+' + def.use.mana + ' MP');
            if (def.use.stamina) parts.push('+' + def.use.stamina + ' SP');
            if (def.use.hunger)  parts.push('+' + def.use.hunger + ' 🍗');
            addFloater(player.wx, player.wy, parts.join(' '), '#60ff60');
            _sfx(660, 0.08, 'sine', 0.05);
        });

        $packBody.addEventListener('pointerdown', (ev) => {
            const itemEl = ev.target.closest('.ua-item');
            if (!itemEl) return;
            const id = itemEl.dataset.id;
            const it = inventory.items.find(i => i.id === id);
            if (!it) return;
            ev.preventDefault();
            startDrag('inv', { invItem: it }, ev.clientX, ev.clientY);
        });

        function onPointerMove(ev) {
            if (!dragState) return;
            showGhost($ghost.textContent, ev.clientX - 16, ev.clientY - 16);
        }
        function onPointerUp(ev) { endDrag(ev); }
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);

        // ── Game loop ────────────────────────────────────
        let last = performance.now();
        let rafId = 0;
        let saveTimer = 0;

        // Mouse-walk (UO-style): right-click + hold to steer.
        let mouseWalk = null; // { clientX, clientY } when active
        canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
        canvas.addEventListener('pointerdown', (ev) => {
            if (ev.button === 2) {
                ev.preventDefault();
                canvas.setPointerCapture?.(ev.pointerId);
                mouseWalk = { clientX: ev.clientX, clientY: ev.clientY };
            }
        });
        canvas.addEventListener('pointermove', (ev) => {
            if (mouseWalk) { mouseWalk.clientX = ev.clientX; mouseWalk.clientY = ev.clientY; }
        });
        function stopMouseWalk(ev) {
            if (ev && ev.button !== 2) return;
            mouseWalk = null;
        }
        canvas.addEventListener('pointerup', stopMouseWalk);
        canvas.addEventListener('pointercancel', () => { mouseWalk = null; });

        function tryStepFromHeld() {
            if (player.moveT > 0) return;
            let dx = 0, dy = 0;
            // Top-down mapping: n/s/e/w are cardinal world-axis steps.
            // (Iso mapping used to pair these with diagonal deltas so the
            // diamond's top was visually "up" — no longer needed.)
            if (held.has('n')) dy -= 1;
            if (held.has('s')) dy += 1;
            if (held.has('e')) dx += 1;
            if (held.has('w')) dx -= 1;

            // If right-mouse is held, steer toward the cursor. Convert the
            // screen-space vector from the player to the cursor into a world
            // delta — trivial in top-down since world axes align with screen.
            if (!dx && !dy && mouseWalk) {
                const rect = canvas.getBoundingClientRect();
                const { x: cx, y: cy } = _cssToInternal(
                    mouseWalk.clientX - rect.left,
                    mouseWalk.clientY - rect.top);
                const W = VIEW_W, H = VIEW_H;
                const cam = camera(W, H, player.rx, player.ry);
                const p = iso(player.wx, player.wy);
                const px = p.x + cam.cx, py = p.y + cam.cy;
                const vx = cx - px, vy = cy - py;
                // Dead zone so tiny movements don't cause twitchy walking.
                if (vx * vx + vy * vy < 22 * 22) return;
                // Snap to one of the 8 compass directions. If one axis is
                // much smaller than the other (ratio < 0.4), treat it as 0
                // so the player can walk along a pure cardinal axis.
                const absX = Math.abs(vx), absY = Math.abs(vy);
                const bigger = Math.max(absX, absY);
                dx = absX >= bigger * 0.4 ? Math.sign(vx) : 0;
                dy = absY >= bigger * 0.4 ? Math.sign(vy) : 0;
            }
            if (dx || dy) {
                const sdx = Math.sign(dx), sdy = Math.sign(dy);
                const mode = getMoveMode();

                // Try diagonal, then slide fallback.
                let moved = player.tryMove(sdx, sdy, passableDg, mode);
                if (!moved && dx && dy) {
                    moved = player.tryMove(sdx, 0, passableDg, mode) ||
                            player.tryMove(0, sdy, passableDg, mode);
                }

                // Auto-unboard when reaching land while sailing.
                if (moved && _boarded && !_dungeon) {
                    const b = biomeAtDg(player.wx, player.wy);
                    if (b !== 'water' && b !== 'deep') unboardBoat();
                }
            }
        }

        function render() {
            const W = VIEW_W;
            const H = VIEW_H;
            ctx.clearRect(0, 0, W, H);

            // Stars behind everything, visible at night.
            const nf = _nightFactor(timeOfDay);
            if (nf > 0.15) {
                const stars = ensureStars();
                const alpha = Math.min(1, (nf - 0.15) * 2);
                for (const s of stars) {
                    const twinkle = 0.5 + 0.5 * Math.sin(_renderTime * 0.001 + s.twinkle);
                    ctx.fillStyle = `rgba(220,220,255,${(alpha * twinkle * 0.7).toFixed(2)})`;
                    ctx.beginPath();
                    ctx.arc(s.x * W, s.y * H * 0.5, s.r, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            const cam = camera(W, H, player.rx, player.ry);

            // Determine visible world-cell range — simple top-down inversion.
            // World (0,0) renders at (cam.cx, cam.cy). Floor after dividing
            // by TILE_SIZE to snap to the tile the pixel belongs to.
            const minX = Math.floor(-cam.cx / TILE_SIZE) - 1;
            const maxX = Math.floor((W - cam.cx) / TILE_SIZE) + 1;
            const minY = Math.floor(-cam.cy / TILE_SIZE) - 1;
            const maxY = Math.floor((H - cam.cy) / TILE_SIZE) + 1;

            // PASS 1 — tiles. Square tiles, cached procedural patterns per biome.
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const sx = x * TILE_SIZE + cam.cx;
                    const sy = y * TILE_SIZE + cam.cy;
                    const b = biomeAtDg(x, y);
                    drawTile(ctx, sx, sy, b);
                }
            }

            // ── Day/night fog of war (drawn on tiles, BEFORE sprites
            //    so entities stay fully opaque and visible in the dark).
            //    iso() now returns a tile center, so adding the camera
            //    offset lands exactly on the player sprite — no further
            //    half-tile correction is needed.
            const pScreen = iso(player.rx, player.ry);
            const lights = collectLightSources(cam);
            drawFogOfWar(ctx, W, H,
                pScreen.x + cam.cx,
                pScreen.y + cam.cy,
                timeOfDay,
                lights);

            // PASS 2 — features + player, depth-sorted by wx+wy then wx.
            // Sprite sizes come from data.js (SPRITE_SIZES).
            const sprites = [];
            if (_dungeon) {
                // Dungeon features + creatures.
                for (const f of _dungeon.map.features) {
                    if (f.c >= minX && f.c <= maxX && f.r >= minY && f.r <= maxY) {
                        sprites.push({ wx: f.c, wy: f.r, emoji: f.emoji, size: SPRITE_SIZES[f.emoji] || 26 });
                    }
                }
                for (const cr of _dungeon.map.creatures) {
                    if (cr.dead) continue;
                    const aggro = cr.ai === 'aggressive' && Math.max(Math.abs(cr.rc - player.wx), Math.abs(cr.rr - player.wy)) <= 6;
                    sprites.push({ wx: cr.rc, wy: cr.rr, emoji: cr.emoji, size: SPRITE_SIZES[cr.emoji] || 22,
                                   hp: cr.hp, maxHp: cr.maxHp, isCreature: true, aggro,
                                   hitFlash: cr._hitFlash || 0, isTarget: cr === _autoTarget });
                }
            } else {
                // Overworld features + creatures.
                const seenChunks = new Set();
                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        const f = world.featureAt(x, y);
                        if (f) sprites.push({ wx: x, wy: y, emoji: f.emoji, size: SPRITE_SIZES[f.emoji] || 26 });
                        const ccx = Math.floor(x / CHUNK_SIZE), ccy = Math.floor(y / CHUNK_SIZE);
                        seenChunks.add(ccx + ',' + ccy);
                    }
                }
                for (const key of seenChunks) {
                    const [ccx, ccy] = key.split(',').map(Number);
                    const ch = world.getChunk(ccx, ccy);
                    for (const cr of ch.creatures) {
                        if (cr.dead) continue;
                        const wx = ccx * CHUNK_SIZE + cr.rc;
                        const wy = ccy * CHUNK_SIZE + cr.rr;
                        if (wx < minX - 1 || wx > maxX + 1 || wy < minY - 1 || wy > maxY + 1) continue;
                        const isNight = _nightFactor(timeOfDay) > 0.5;
                        const effAI = (isNight && cr.ai === 'neutral') ? 'aggressive' : cr.ai;
                        const aggro = effAI === 'aggressive' && Math.max(Math.abs(wx - player.wx), Math.abs(wy - player.wy)) <= 6;
                        sprites.push({ wx, wy, emoji: cr.emoji, size: SPRITE_SIZES[cr.emoji] || 22,
                                       hp: cr.hp, maxHp: cr.maxHp, isCreature: true, aggro,
                                       hitFlash: cr._hitFlash || 0, isTarget: cr === _autoTarget });
                    }
                }
            }
            // Tamed pets — same sprite pipeline as creatures, with an
            // isPet flag so render can distinguish the friendly halo.
            for (const pet of pets) {
                const baseSize = SPRITE_SIZES[pet.emoji] || 22;
                // Pets grow a bit with level — max +8 px at level 10.
                const lvl = pet.level || 1;
                const bonus = Math.min(8, (lvl - 1) * 0.8);
                sprites.push({
                    wx: pet.rx, wy: pet.ry, emoji: pet.emoji,
                    size: Math.round(baseSize + bonus),
                    hp: pet.hp, maxHp: pet.maxHp,
                    hitFlash: pet._hitFlash || 0,
                    isPet: true,
                    petLevel: lvl,
                    petCommand: pet.command,
                    petName: pet.name,
                });
            }
            sprites.push({ wx: player.rx, wy: player.ry, emoji: player.emoji, size: 24, isPlayer: true, flash: _playerFlash });
            sprites.sort((a, b) => (a.wx + a.wy) - (b.wx + b.wy) || a.wx - b.wx);
            for (const s of sprites) {
                // iso() returns the tile CENTER in screen-local coords. The
                // sprite helpers (drawEmoji, drawShadow, HP bars) all expect a
                // tile TOP-LEFT and center their own content inside TILE_W x
                // TILE_H — so subtract a half-tile on both axes here.
                const p = iso(s.wx, s.wy);
                const rawSx = p.x + cam.cx;
                const rawSy = p.y + cam.cy;
                const ps = 1; // perspective disabled in top-down; kept as constant for HUD math below
                const sx = rawSx - TILE_SIZE / 2;
                const sy = rawSy - TILE_SIZE / 2;
                const scaledSize = s.size;
                drawShadow(ctx, sx, sy, scaledSize);
                // Item sparkle (ground items pulse softly to attract attention).
                if (!s.isCreature && !s.isPlayer && !s.aggro) {
                    const f = featureAtDg(Math.round(s.wx), Math.round(s.wy));
                    if (f && f.item) {
                        const sparkle = 0.3 + 0.3 * Math.sin(_renderTime * 0.005 + s.wx * 7 + s.wy * 11);
                        ctx.fillStyle = `rgba(255,220,100,${sparkle.toFixed(2)})`;
                        const tw = TILE_W * ps;
                        ctx.beginPath();
                        ctx.arc(sx + tw / 2, sy + (TILE_H * ps) / 2, 4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                // Pet halo: soft pink ring under tamed creatures so the
                // player can tell them apart from wild ones at a glance.
                if (s.isPet) {
                    const tw = TILE_W * ps;
                    ctx.strokeStyle = 'rgba(255,140,200,0.7)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.ellipse(sx + tw / 2, sy + (TILE_H * ps) / 2 + 3, tw * 0.4, tw * 0.18, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
                // Target highlight ring.
                if (s.isTarget) {
                    ctx.strokeStyle = 'rgba(255,200,60,0.7)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    const tw = TILE_W * ps;
                    ctx.ellipse(sx + tw / 2, sy + (TILE_H * ps) / 2, tw * 0.35, tw * 0.18, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
                // Boss-class creatures (maxHp ≥ 80) pulse a purple aura so
                // they're instantly recognizable as dangerous even at a
                // glance — supports the milestone slayer system.
                if (s.isCreature && s.maxHp >= 80) {
                    const bp = 0.4 + 0.5 * Math.sin(_renderTime * 0.004);
                    const tw = TILE_W * ps;
                    ctx.strokeStyle = `rgba(180,80,255,${bp.toFixed(2)})`;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.ellipse(sx + tw / 2, sy + (TILE_H * ps) / 2 + 3, tw * 0.55, tw * 0.22, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
                // Creature hit flash: red glow.
                if (s.hitFlash > 0) {
                    const fa = Math.min(0.5, s.hitFlash / 250);
                    ctx.fillStyle = `rgba(255,40,40,${fa.toFixed(2)})`;
                    const tw = TILE_W * ps;
                    ctx.beginPath();
                    ctx.ellipse(sx + tw / 2, sy + (TILE_H * ps) / 2, 14, 8, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
                // Resting halo: slow-pulsing warm ring above the player when
                // standing next to a burning campfire. Pairs with the 💤 glyph
                // painted after the sprite below.
                if (s.isPlayer && _resting) {
                    const rpulse = 0.4 + 0.4 * Math.sin(_renderTime * 0.003);
                    const tw = TILE_W * ps;
                    ctx.fillStyle = `rgba(255,170,80,${(rpulse * 0.25).toFixed(2)})`;
                    ctx.beginPath();
                    ctx.ellipse(sx + tw / 2, sy + (TILE_H * ps) / 2 + 2, tw * 0.65, tw * 0.3, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
                // Player damage flash: red glow under sprite.
                // Player position indicator — bright green pulsing ellipse.
                if (s.isPlayer) {
                    const pulse = 0.5 + 0.3 * Math.sin(_renderTime * 0.004);
                    const tw = TILE_W * ps;
                    const th = TILE_H * ps;
                    // Fill + stroke for visibility.
                    ctx.fillStyle = `rgba(60,220,60,${(pulse * 0.25).toFixed(2)})`;
                    ctx.strokeStyle = `rgba(60,255,60,${pulse.toFixed(2)})`;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.ellipse(sx + tw / 2, sy + th / 2 + 2, tw * 0.4, th * 0.5, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
                if (s.flash && s.flash > 0) {
                    const fa = Math.min(0.5, s.flash / 300);
                    ctx.fillStyle = `rgba(255,40,40,${fa.toFixed(2)})`;
                    ctx.beginPath();
                    ctx.ellipse(sx + TILE_W / 2, sy + TILE_H / 2, 16, 10, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
                // Hit-flash bounce: wounded sprites lift briefly so the
                // impact reads without a sound cue.
                let drawSy = sy;
                if (s.hitFlash > 0) {
                    const bounce = -Math.sin((250 - s.hitFlash) / 250 * Math.PI) * 4;
                    drawSy = sy + bounce;
                }
                drawEmoji(ctx, sx, drawSy, s.emoji, scaledSize);
                // Pet name + level badge + stay-mode icon above the sprite.
                if (s.isPet) {
                    const nameText = (s.petCommand === 'stay' ? '🛑 ' : '') + (s.petName || '') + ' L' + s.petLevel;
                    ctx.font = "bold 9px 'Inter', sans-serif";
                    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                    const w = ctx.measureText(nameText).width + 6;
                    ctx.fillStyle = 'rgba(0,0,0,0.7)';
                    ctx.fillRect(sx + TILE_W / 2 - w / 2, sy - 10, w, 10);
                    ctx.fillStyle = '#ff80c0';
                    ctx.fillText(nameText, sx + TILE_W / 2, sy - 2);
                }
                // Resting 💤 glyph above the player while near a campfire.
                if (s.isPlayer && _resting) {
                    const bob = Math.sin(_renderTime * 0.004) * 1.5;
                    ctx.font = "14px 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText('💤', sx + TILE_W / 2 + 10, sy - 4 + bob);
                }
                // Aggro indicator — pulsing red triangle above hostile creatures.
                if (s.aggro) {
                    const pulse = 0.5 + 0.5 * Math.sin(_renderTime * 0.008);
                    ctx.fillStyle = `rgba(255,50,50,${(0.5 + pulse * 0.5).toFixed(2)})`;
                    const tw = TILE_W * ps;
                    const ax = sx + tw / 2, ay = sy - 6 * ps;
                    ctx.beginPath();
                    ctx.moveTo(ax, ay - 6); ctx.lineTo(ax - 4, ay); ctx.lineTo(ax + 4, ay);
                    ctx.closePath(); ctx.fill();
                }
                // HP bar above damaged creatures/pets, and always above
                // aggressive creatures so you can size up threats cleanly.
                if ((s.isCreature || s.isPet) && (s.hp < s.maxHp || (s.isCreature && s.aggro))) {
                    const bw = Math.round(24 * ps), bh = 3;
                    const tw = TILE_W * ps;
                    const bx = sx + tw / 2 - bw / 2;
                    const by = sy - 2 * ps;
                    ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
                    const pct = Math.max(0, s.hp / s.maxHp);
                    const hpColor = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#f44336';
                    ctx.fillStyle = hpColor;
                    ctx.fillRect(bx, by, bw * pct, bh);
                }
            }

            // ── Player stat bars (top-left, below HUD) ─────
            const barX = 8, barY = H - 28, barW = 120, barH = 5, barGap = 8;
            function drawBar(y, pct, color) {
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillRect(barX - 1, y - 1, barW + 2, barH + 2);
                ctx.fillStyle = color;
                ctx.fillRect(barX, y, barW * Math.max(0, pct), barH);
            }
            drawBar(barY,              player.hp / player.maxHp,           '#e04040');
            drawBar(barY - barH - barGap, player.mana / player.maxMana,     '#4080e0');
            drawBar(barY - (barH + barGap) * 2, player.stamina / player.maxStamina, '#e0c040');
            // Hunger: dark orange → dull red as it empties so low values read
            // as urgent. Blinks when starving (hunger == 0).
            const hungerPct = player.hunger / player.maxHunger;
            const hungerCrit = player.hunger <= 0;
            const hungerLow  = hungerPct < 0.25;
            const blink = hungerCrit && Math.floor(_renderTime / 300) % 2 === 0;
            const hungerColor = blink ? '#ff4444' : hungerLow ? '#d07030' : '#c06030';
            drawBar(barY - (barH + barGap) * 3, Math.max(0.02, hungerPct), hungerColor);
            // Labels.
            ctx.font = "9px 'Inter', sans-serif";
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#fff';
            ctx.fillText('HP',  barX + barW + 4, barY + barH / 2);
            ctx.fillText('MP',  barX + barW + 4, barY - barH - barGap + barH / 2);
            ctx.fillText('SP',  barX + barW + 4, barY - (barH + barGap) * 2 + barH / 2);
            ctx.fillText('🍗',  barX + barW + 4, barY - (barH + barGap) * 3 + barH / 2);

            // ── Level-up gold flash overlay ───────────────────
            if (_renderTime < _levelUpFlash) {
                const remaining = _levelUpFlash - _renderTime;
                const a = (remaining / 800) * 0.45;
                ctx.fillStyle = `rgba(255,220,80,${a.toFixed(2)})`;
                ctx.fillRect(0, 0, W, H);
            }
            // ── Low-HP vignette (red pulse around the edges) ─
            const hpFrac = player.hp / Math.max(1, player.maxHp);
            if (hpFrac < 0.25) {
                const pulse = 0.5 + 0.5 * Math.sin(_renderTime * 0.006);
                const vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.6);
                vignette.addColorStop(0, 'rgba(255,40,40,0)');
                vignette.addColorStop(1, `rgba(255,40,40,${(0.35 * pulse * (1 - hpFrac * 4)).toFixed(2)})`);
                ctx.fillStyle = vignette;
                ctx.fillRect(0, 0, W, H);
            }
            // ── Active buff indicator ─────────────────────────
            if (activeBuff) {
                ctx.font = "12px 'Inter', sans-serif";
                ctx.textAlign = 'right'; ctx.textBaseline = 'top';
                ctx.fillStyle = activeBuff.type === 'blessed' ? '#e0d060' : '#ffb070';
                const secs = Math.max(0, Math.ceil(activeBuff.remaining / 1000));
                const icon = activeBuff.icon || '⭐';
                const label = activeBuff.label || activeBuff.type;
                ctx.fillText(`${icon} ${label}  ${secs}s`, W - 6, 26);
            }
            // ── Rain / snow particles + HUD indicator ────────
            const rainI = rainIntensity();
            if (rainI > 0) {
                const intensity = Math.floor(rainI * 40);
                const biomeHere = biomeAtDg(player.wx, player.wy);
                const snowing = biomeHere === 'snow' || biomeHere === 'tundra';
                if (snowing) {
                    ctx.fillStyle = 'rgba(240,240,255,0.7)';
                    for (let i = 0; i < intensity; i++) {
                        const rx = Math.random() * W;
                        const ry = Math.random() * H;
                        ctx.beginPath();
                        ctx.arc(rx, ry, 1.4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else {
                    ctx.strokeStyle = 'rgba(150,180,220,0.25)';
                    ctx.lineWidth = 1;
                    for (let i = 0; i < intensity; i++) {
                        const rx = Math.random() * W;
                        const ry = Math.random() * H;
                        ctx.beginPath();
                        ctx.moveTo(rx, ry);
                        ctx.lineTo(rx + 2, ry + 6);
                        ctx.stroke();
                    }
                }
                // Weather badge in the top-right corner.
                ctx.font = "13px 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
                ctx.textAlign = 'right'; ctx.textBaseline = 'top';
                ctx.globalAlpha = 0.6 + rainI * 0.3;
                ctx.fillText(snowing ? '❄️' : (rainI > 0.6 ? '⛈️' : '☔'), W - 6, 6);
                ctx.globalAlpha = 1;
            }

            // ── Target creature name ─────────────────────────
            if (_autoTarget && !_autoTarget.dead) {
                const def = CREATURE_DEFS[_autoTarget.emoji];
                if (def) {
                    const twx = (_dungeon ? 0 : Math.floor(player.wx / CHUNK_SIZE) * CHUNK_SIZE) + _autoTarget.rc;
                    const twy = (_dungeon ? 0 : Math.floor(player.wy / CHUNK_SIZE) * CHUNK_SIZE) + _autoTarget.rr;
                    const tp = iso(twx, twy);
                    // Tile center in screen space. Label sits just above the
                    // tile (tile top = center - TILE_SIZE/2, then -8px margin).
                    const tcx = tp.x + cam.cx;
                    const ttop = tp.y + cam.cy - TILE_SIZE / 2;
                    ctx.font = "bold 9px 'Inter', sans-serif";
                    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                    ctx.fillStyle = '#ffc857';
                    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2;
                    const label = `${_autoTarget.emoji} HP ${Math.round(_autoTarget.hp)}/${_autoTarget.maxHp}`;
                    ctx.strokeText(label, tcx, ttop - 4);
                    ctx.fillText(label, tcx, ttop - 4);
                }
            }

            // ── Floating combat text ────────────────────────
            ctx.font = "bold 11px 'Inter', sans-serif";
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const fl of _floaters) {
                const p = iso(fl.wx, fl.wy);
                // Start at tile center, drift upward over the floater lifetime.
                const fx = p.x + cam.cx;
                const fy = p.y + cam.cy - (fl.age / fl.maxAge) * 24;
                const alpha = 1 - fl.age / fl.maxAge;
                ctx.fillStyle = fl.color.replace(')', ',' + alpha.toFixed(2) + ')').replace('rgb', 'rgba');
                // Fallback for hex colours.
                if (fl.color.startsWith('#')) {
                    const h = fl.color.replace('#', '');
                    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
                    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
                }
                ctx.strokeStyle = `rgba(0,0,0,${(alpha * 0.7).toFixed(2)})`;
                ctx.lineWidth = 2;
                ctx.strokeText(fl.text, fx, fy);
                ctx.fillText(fl.text, fx, fy);
            }
        }

        // ── Minimap ────────────────────────────────────────
        const $mini = root.querySelector('#ua-minimap');
        const miniCtx = $mini.getContext('2d');
        const MINI_RADIUS = 70; // cells per half-axis → 140×140 total
        let miniElapsed = 0;
        function renderMinimap() {
            miniElapsed += 16; // coarse throttle; function called once per frame
            if (miniElapsed < 250) return;
            miniElapsed = 0;
            miniCtx.fillStyle = '#0a0d18';
            miniCtx.fillRect(0, 0, 140, 140);
            const img = miniCtx.getImageData(0, 0, 140, 140);
            const data = img.data;
            const pw = player.wx, pyw = player.wy;
            for (let py = 0; py < 140; py++) {
                for (let px = 0; px < 140; px++) {
                    const wx = pw + (px - 70);
                    const wy = pyw + (py - 70);
                    const b = BIOMES[world.biomeAt(wx, wy)];
                    const rgb = _hexToRgb(b.color1);
                    const i = (py * 140 + px) * 4;
                    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
                }
            }
            miniCtx.putImageData(img, 0, 0);

            // Village markers (yellow squares) + creature dots (red) on minimap.
            const mpx = player.wx, mpy = player.wy;
            const mcx = Math.floor(mpx / CHUNK_SIZE), mcy = Math.floor(mpy / CHUNK_SIZE);
            for (let dcy = -2; dcy <= 2; dcy++) for (let dcx = -2; dcx <= 2; dcx++) {
                const ch = world.chunks.get((mcx+dcx)+','+(mcy+dcy));
                if (!ch) continue;
                for (const f of ch.features) {
                    const isLandmark = f.village || f.npc || f.merchant || f.dungeon;
                    const isStructure = f.structure;
                    if (!isLandmark && !isStructure) continue;
                    const fwx = (mcx+dcx) * CHUNK_SIZE + f.c;
                    const fwy = (mcy+dcy) * CHUNK_SIZE + f.r;
                    const mx = fwx - mpx + 70, my = fwy - mpy + 70;
                    if (mx < 0 || mx >= 140 || my < 0 || my >= 140) continue;
                    if (isStructure) {
                        // Player-built landmarks: campfire orange, walls grey,
                        // crops/saplings green, grown trees dark-green.
                        if (f.structKey === 'campfire') miniCtx.fillStyle = '#ff9040';
                        else if (f.structKey === 'wall') miniCtx.fillStyle = '#888';
                        else if (f.structKey === 'grown_tree') miniCtx.fillStyle = '#2d6a2a';
                        else miniCtx.fillStyle = '#60d060';
                    } else {
                        miniCtx.fillStyle = f.dungeon ? '#ff4040' : f.merchant ? '#60ff60' : f.npc ? '#ffffff' : '#ffc857';
                    }
                    miniCtx.fillRect(mx, my, 2, 2);
                }
                for (const cr of ch.creatures) {
                    if (cr.dead) continue;
                    const fwx = (mcx+dcx) * CHUNK_SIZE + cr.c;
                    const fwy = (mcy+dcy) * CHUNK_SIZE + cr.r;
                    const mx = fwx - mpx + 70, my = fwy - mpy + 70;
                    if (mx < 0 || mx >= 140 || my < 0 || my >= 140) continue;
                    const isAgg = cr.ai === 'aggressive' || (_nightFactor(timeOfDay) > 0.5 && cr.ai === 'neutral');
                    miniCtx.fillStyle = isAgg ? '#ff4040' : '#80ff80';
                    miniCtx.fillRect(mx, my, 1, 1);
                }
            }
            // Active quest giver — cyan dot so the player knows where to
            // return for turn-in.
            if (activeQuest && typeof activeQuest.giverWx === 'number') {
                const qx = activeQuest.giverWx - mpx + 70;
                const qy = activeQuest.giverWy - mpy + 70;
                if (qx >= 0 && qx < 140 && qy >= 0 && qy < 140) {
                    miniCtx.fillStyle = '#60d0ff';
                    miniCtx.fillRect(qx - 1, qy - 1, 3, 3);
                    miniCtx.strokeStyle = 'rgba(0,0,0,0.8)';
                    miniCtx.strokeRect(qx - 1.5, qy - 1.5, 4, 4);
                }
            }
            // Treasure map targets (pulse ★ on the minimap or clamp to the
            // edge with an arrow hint when the target is outside the 140-
            // tile view).
            const pulse = 0.5 + 0.5 * Math.sin(_renderTime * 0.005);
            for (const it of inventory.items) {
                if (it.key !== 'treasure_map' || !it.meta) continue;
                const rx = it.meta.tx - mpx, ry = it.meta.ty - mpy;
                const mx = rx + 70, my = ry + 70;
                if (mx >= 0 && mx < 140 && my >= 0 && my < 140) {
                    miniCtx.fillStyle = `rgba(255,200,60,${(0.6 + pulse * 0.4).toFixed(2)})`;
                    miniCtx.fillRect(mx - 1, my - 1, 3, 3);
                    miniCtx.strokeStyle = 'rgba(0,0,0,0.8)';
                    miniCtx.strokeRect(mx - 1.5, my - 1.5, 4, 4);
                } else {
                    // Off-map: clamp to the nearest edge as a directional hint.
                    const ang = Math.atan2(ry, rx);
                    const ex = 70 + Math.cos(ang) * 66;
                    const ey = 70 + Math.sin(ang) * 66;
                    miniCtx.fillStyle = `rgba(255,200,60,${(0.5 + pulse * 0.4).toFixed(2)})`;
                    miniCtx.beginPath();
                    miniCtx.arc(ex, ey, 2.5, 0, Math.PI * 2);
                    miniCtx.fill();
                    miniCtx.strokeStyle = 'rgba(0,0,0,0.9)';
                    miniCtx.lineWidth = 1;
                    miniCtx.stroke();
                }
            }
            // Player dot.
            miniCtx.fillStyle = '#ffc857';
            miniCtx.fillRect(69, 69, 3, 3);
            miniCtx.strokeStyle = 'rgba(0,0,0,0.6)';
            miniCtx.strokeRect(68.5, 68.5, 4, 4);
        }

        function updateHUD() {
            const b = biomeAtDg(player.wx, player.wy);
            const biome = (ALL_BIOMES[b] || BIOMES.grass).name;
            const hours = Math.floor(timeOfDay * 24);
            const mins  = Math.floor((timeOfDay * 24 * 60) % 60);
            const hh = String(hours).padStart(2, '0');
            const mm = String(mins).padStart(2, '0');
            const phase = timeOfDay < 0.25 ? '🌑' : timeOfDay < 0.42 ? '🌅' : timeOfDay < 0.66 ? '☀️' : timeOfDay < 0.83 ? '🌇' : '🌙';
            const cd2 = classDef || CLASSES.warrior;
            const poisonTag = player.poison > 0 ? ' · <span style="color:#40c040">☠ POISONED</span>' : '';
            $hud.innerHTML = `${cd2.icon} <b>Lv${player.level}</b> · ❤️ <b>${Math.round(player.hp)}/${player.maxHp}</b> · 💧 <b>${Math.round(player.mana)}/${player.maxMana}</b> · ⚡ <b>${Math.round(player.stamina)}/${player.maxStamina}</b> · 💀${player.kills}${poisonTag}<br>📍 <b>${player.wx},${player.wy}</b> · ${biome} · ${phase} <b>${hh}:${mm}</b> · Day <b>${player.days + 1}</b>`;
        }

        // ── Combat helpers ─────────────────────────────────
        function getWeaponDmg() {
            const w = equipment.weapon;
            if (!w) return 0;
            const map = { sword: 8, axe: 10, bow: 7, dagger: 5, wand: 6 };
            const base = map[w.key] || 4;
            return base + (w.enchant || 0) * 2;
        }

        /** Armor damage reduction — sums defence from all equipped armor pieces.
         *  Each enchant level on an armor piece adds +1 flat defence. */
        function getArmorDef() {
            let def = 0;
            const map = { helm: 2, armor: 5, robe: 2, gloves: 1, boots: 1, shield: 4, cape: 1, crown: 1 };
            for (const [, item] of Object.entries(equipment)) {
                if (item && map[item.key]) def += map[item.key] + (item.enchant || 0);
            }
            return def;
        }

        /** Apply armor reduction to incoming damage (min 1). Blessed buff
         *  adds a flat extra reduction layer on top of armor. Wielding a
         *  🗡️ Dagger gives a 12% chance to fully dodge an incoming hit. */
        function reduceDamage(rawDmg) {
            // Dodge first — applies before reduction so it's fully negated.
            if (equipment.weapon?.key === 'dagger' && Math.random() < 0.12) {
                addFloater(player.wx, player.wy, 'Dodge!', '#80ffff');
                return 0;
            }
            const def = getArmorDef();
            const extra = activeBuff?.dmgReduce || 0;
            return Math.max(1, rawDmg - def - extra);
        }

        function attackCreature(cr) {
            if (cr.dead || player.attackCooldown > 0) return;
            // Bow has range 3; melee range 1.5
            const range = equipment.weapon?.key === 'bow' ? 3 : 1.5;
            const chCx = Math.floor(player.wx / CHUNK_SIZE), chCy = Math.floor(player.wy / CHUNK_SIZE);
            const cwx = (_dungeon ? 0 : chCx * CHUNK_SIZE) + cr.c;
            const cwy = (_dungeon ? 0 : chCy * CHUNK_SIZE) + cr.r;
            const d = Math.max(Math.abs(cwx - player.wx), Math.abs(cwy - player.wy));
            if (d > range) return;

            if (player.stamina < 5) { addFloater(player.wx, player.wy, 'Exhausted!', '#ffaa00'); return; }
            player.stamina = Math.max(0, player.stamina - 8);

            // Critical hit: 10% base, +5% with dagger.
            const critChance = 0.10 + (equipment.weapon?.key === 'dagger' ? 0.05 : 0);
            const isCrit = Math.random() < critChance;
            const combatBonus = Math.floor(skillLevel(player.skills.combat) / 20); // +0..+5
            let dmg = player.baseDmg + getWeaponDmg() + Math.floor(Math.random() * 3) + combatBonus;
            if (activeBuff?.dmgMult) dmg = Math.round(dmg * activeBuff.dmgMult);
            // Bow ignores half the target's armor via the simplified creature
            // armor model (creatures don't track armor today, so this hook
            // exists as a dedicated +3 pierce bonus against naturally tough
            // emoji classes — dragons, demons, ogres).
            if (equipment.weapon?.key === 'bow') {
                const tough = ['🐉', '🐲', '👿', '👹', '🧌', '🧟', '🐻'].includes(cr.emoji);
                if (tough) dmg += 3;
            }
            if (isCrit) dmg = Math.floor(dmg * 2);

            cr.hp = Math.max(0, cr.hp - dmg);
            cr._hitFlash = 250; // visual flash on creature
            player.attackCooldown = 800;
            addFloater(cwx, cwy, isCrit ? 'CRIT -' + dmg + '!' : '-' + dmg, isCrit ? '#ffff00' : '#ff4040');
            sfxHit();
            _wearWeapon();
            // Crit adrenaline: +5 stamina as a reward for precise hits.
            if (isCrit) player.stamina = Math.min(player.maxStamina, player.stamina + 5);
            addSkillXp('combat', isCrit ? 3 : 1);
            if (isCrit) _sfx(600, 0.08, 'triangle', 0.05);
            if (cr.ai === 'neutral') cr.ai = 'aggressive';
            if (cr.hp <= 0) killCreature(cr, chCx, chCy);
        }

        /** Quick potion: press Q to consume the first potion in backpack. */
        /** Find nearest village feature — used for respawn. */
        function findNearestVillage() {
            let best = null, bestDist = Infinity;
            const cx0 = Math.floor(startX / CHUNK_SIZE), cy0 = Math.floor(startY / CHUNK_SIZE);
            for (let dcy = -4; dcy <= 4; dcy++) for (let dcx = -4; dcx <= 4; dcx++) {
                const ch = world.chunks.get((cx0+dcx)+','+(cy0+dcy));
                if (!ch) continue;
                for (const f of ch.features) {
                    if (!f.village) continue;
                    const wx = (cx0+dcx) * CHUNK_SIZE + f.c;
                    const wy = (cy0+dcy) * CHUNK_SIZE + f.r;
                    const d = Math.abs(wx - player.wx) + Math.abs(wy - player.wy);
                    if (d < bestDist && world.canTraverse(wx, wy)) { bestDist = d; best = { wx, wy }; }
                }
            }
            return best || { wx: startX, wy: startY };
        }

        function respawnPlayer() {
            const goldCount = inventory.items.filter(i => i.key === 'gold').length;
            const goldLost = Math.min(goldCount, Math.max(1, Math.floor(goldCount * 0.3)));
            let removed = 0;
            inventory.items = inventory.items.filter(i => {
                if (i.key === 'gold' && removed < goldLost) { removed++; return false; }
                return true;
            });
            saveInventory();
            const lostMsg = goldLost > 0 ? ' Lost ' + goldLost + ' gold.' : '';
            showDialogBubble('☠️', 'You have been slain!' + lostMsg);
            if (_dungeon) exitDungeon();
            const spawn = findNearestVillage();
            player.hp = player.maxHp; player.mana = player.maxMana; player.stamina = player.maxStamina;
            // Respawn with half hunger — you're alive but famished.
            // Cap fullness at half (Math.min): dying never restores food, and a
            // well-fed corpse wakes up famished. Math.max here was backwards — it
            // *raised* a starving player to half-full, rewarding death.
            player.hunger = Math.min(player.hunger, player.maxHunger * 0.5);
            player.wx = spawn.wx; player.wy = spawn.wy;
            player.rx = spawn.wx; player.ry = spawn.wy;
            _playerFlash = 600;
        }

        // Rune shard attunement — shared by player and pet kill paths so a
        // pet landing the killing blow on a boss still grants the shard.
        function attuneRuneShard(emoji, wx, wy) {
            if (sealForged) return;
            const shard = RUNE_SHARDS.find(s => s.keys.includes(emoji) && !runeShards[s.id]);
            if (!shard) return;
            runeShards[shard.id] = true;
            const have = RUNE_SHARDS.filter(s => runeShards[s.id]).length;
            addFloater(wx, wy, `${shard.rune} Rune shard!`, '#c0a0ff');
            showDialogBubble(shard.rune, `The ${shard.name} rune attunes to your soul. (${have}/4 shards)`);
            _sfx(740, 0.25, 'triangle', 0.06); setTimeout(() => _sfx(1100, 0.3, 'sine', 0.05), 160);
            if (have === RUNE_SHARDS.length) forgeSeal();
        }

        // All four rune shards collected — forge the Seal of Aruta. One-shot:
        // permanent boon, victory overlay, then the world stays playable.
        function forgeSeal() {
            if (sealForged) return;
            sealForged = true;
            player.maxHp += 20; player.maxMana += 20; player.maxStamina += 20; player.baseDmg += 2;
            player.hp = player.maxHp; player.mana = player.maxMana; player.stamina = player.maxStamina;
            sfxLevelUp();
            _levelUpFlash = _renderTime + 1200;
            const cd = classDef || CLASSES.warrior;
            const ov = document.createElement('div');
            ov.className = 'ua-victory';
            ov.innerHTML = `
                <div class="ua-victory-card">
                    <div class="ua-victory-runes">ᚠ ᚢ ᚦ ᚨ</div>
                    <h2>⚝ The Seal of Aruta is forged!</h2>
                    <p>All four ancient runes answer to you.<br>The realm of <b class="ua-victory-realm"></b> knows peace — for now.</p>
                    <p class="ua-victory-stats">${cd.icon} Level <b>${player.level}</b> · 💀 <b>${player.kills}</b> kills · 🔨 <b>${player.crafted || 0}</b> crafted · Day <b>${player.days + 1}</b></p>
                    <p class="ua-victory-boon">Boon of the Seal: +20 HP · +20 MP · +20 SP · +2 DMG — forever.</p>
                    <button class="ua-btn ua-btn-primary" id="ua-victory-close">Continue exploring</button>
                </div>`;
            ov.querySelector('.ua-victory-realm').textContent = worldRow.name;
            root.querySelector('.ua-shell').appendChild(ov);
            ov.querySelector('#ua-victory-close').addEventListener('click', () => ov.remove());
            _sfx(523, 0.3, 'sine', 0.06);
            setTimeout(() => _sfx(659, 0.3, 'sine', 0.06), 220);
            setTimeout(() => _sfx(784, 0.45, 'sine', 0.07), 440);
            setTimeout(() => _sfx(1046, 0.6, 'sine', 0.06), 660);
        }

        function quickPotion() {
            const idx = inventory.items.findIndex(i => i.key === 'potion');
            if (idx < 0) { addFloater(player.wx, player.wy, 'No potions!', '#ff6060'); return; }
            const def = ITEMS.potion;
            if (def.use.hp)   player.hp   = Math.min(player.maxHp,   player.hp   + def.use.hp);
            if (def.use.mana) player.mana = Math.min(player.maxMana, player.mana + def.use.mana);
            inventory.items.splice(idx, 1);
            saveInventory();
            addFloater(player.wx, player.wy, '+30 HP +20 MP', '#60ff60');
            _sfx(660, 0.08, 'sine', 0.05);
            if ($pack.style.display !== 'none') renderBackpack();
        }

        // F — light a campfire on the player's current tile. Consumes one
        // campfire item (craft: 2x wood). Burns for ~90s, emitting warm
        // light that carves the night fog around it.
        function tryPlaceCampfire() {
            if (_dungeon) { addFloater(player.wx, player.wy, 'Not in dungeons', '#ffaa00'); return; }
            const idx = inventory.items.findIndex(i => i.key === 'campfire');
            if (idx < 0) { addFloater(player.wx, player.wy, 'No campfire', '#ffaa00'); return; }
            // Reject water/deep so the flame isn't floating on waves.
            const b = biomeAtDg(player.wx, player.wy);
            if (b === 'water' || b === 'deep') { addFloater(player.wx, player.wy, 'Too wet', '#80c0ff'); return; }
            // Reject if a feature already occupies this tile (tree, rock, NPC, etc.).
            const existing = world.featureAt(player.wx, player.wy);
            if (existing) { addFloater(player.wx, player.wy, 'Tile occupied', '#ffaa00'); return; }
            const placed = placeStructure(player.wx, player.wy, 'campfire');
            if (!placed) { addFloater(player.wx, player.wy, 'Cannot place', '#ffaa00'); return; }
            inventory.items.splice(idx, 1);
            saveInventory();
            if ($pack.style.display !== 'none') renderBackpack();
            addFloater(player.wx, player.wy, '🔥 Campfire', '#ff8040');
            _sfx(240, 0.12, 'sawtooth', 0.04);
        }

        // ── Pets (UO-style taming) ────────────────────────────────
        // Each pet: { emoji, hp, maxHp, dmg, wx, wy, rx, ry, moveT, moveFrom,
        //             attackCooldown, timer, _hitFlash, targetId?, lastMeal }
        // Pets follow the player and attack nearby aggressive creatures.
        let pets = Array.isArray(saved?.pets) ? saved.pets.map(p => ({
            ...p, rx: p.rx ?? p.wx, ry: p.ry ?? p.wy,
            moveT: 0, moveFrom: { wx: p.wx, wy: p.wy },
            attackCooldown: 0, timer: 0, _hitFlash: 0,
            level: p.level || 1, xp: p.xp || 0,
            command: p.command || 'follow',
        })) : [];

        // V — whistle all pets back to the player's tile regardless of
        // distance or command mode. Useful when a pet gets stuck on a wall
        // or left behind across a chunk boundary.
        function whistlePets() {
            if (!pets.length) { addFloater(player.wx, player.wy, 'No pets', '#aaa'); return; }
            for (const pet of pets) {
                pet.wx = player.wx + (Math.floor(Math.random() * 3) - 1);
                pet.wy = player.wy + (Math.floor(Math.random() * 3) - 1);
                pet.rx = pet.wx; pet.ry = pet.wy;
                pet.moveT = 0; pet.moveFrom = { wx: pet.wx, wy: pet.wy };
            }
            addFloater(player.wx, player.wy, '📯 Pets returned', '#ff80c0');
            _sfx(540, 0.12, 'triangle', 0.05);
            savePets();
        }

        // X — toggle all pets between follow (default) and stay. Stay pets
        // stop chasing and returning, but still defend if an enemy walks
        // onto an adjacent tile, so a stay pack can guard a camp.
        function togglePetCommand() {
            if (!pets.length) { addFloater(player.wx, player.wy, 'No pets', '#aaa'); return; }
            const next = pets[0].command === 'stay' ? 'follow' : 'stay';
            for (const p of pets) p.command = next;
            addFloater(player.wx, player.wy,
                next === 'stay' ? '🛑 Pets: Stay' : '🐾 Pets: Follow',
                '#ff80c0');
            _sfx(600, 0.08, 'sine', 0.04);
            savePets();
        }

        // T — tame an adjacent passive creature. Consumes one raw or roast
        // meat as bait. Success chance is 50% + 25% when the creature is
        // already wounded (HP ≤ 50%).
        function tryTameAdjacent() {
            if (_dungeon) { addFloater(player.wx, player.wy, 'Not in dungeons', '#ffaa00'); return; }
            if (pets.length >= 3) { addFloater(player.wx, player.wy, 'Too many pets (3 max)', '#ffaa00'); return; }
            const cx0 = Math.floor(player.wx / CHUNK_SIZE), cy0 = Math.floor(player.wy / CHUNK_SIZE);
            let found = null;
            outer: for (let dcy = -1; dcy <= 1; dcy++) for (let dcx = -1; dcx <= 1; dcx++) {
                const ch = world.chunks.get((cx0 + dcx) + ',' + (cy0 + dcy));
                if (!ch) continue;
                for (let i = 0; i < ch.creatures.length; i++) {
                    const cr = ch.creatures[i];
                    if (cr.dead) continue;
                    const cwx = (cx0 + dcx) * CHUNK_SIZE + cr.c;
                    const cwy = (cy0 + dcy) * CHUNK_SIZE + cr.r;
                    if (Math.max(Math.abs(cwx - player.wx), Math.abs(cwy - player.wy)) > 1) continue;
                    const def = CREATURE_DEFS[cr.emoji] || {};
                    // Only passive, walking creatures can be tamed — no dragons, no fish.
                    if (def.ai !== 'passive') continue;
                    if (FLYING_CREATURES.includes(cr.emoji) || AQUATIC_CREATURES.includes(cr.emoji)) continue;
                    found = { cr, ch, idx: i, wx: cwx, wy: cwy };
                    break outer;
                }
            }
            if (!found) { addFloater(player.wx, player.wy, 'No tameable creature', '#ffaa00'); return; }
            const baitIdx = inventory.items.findIndex(i => i.key === 'raw_meat' || i.key === 'meat');
            if (baitIdx < 0) { addFloater(player.wx, player.wy, 'Need meat to tame', '#ffaa00'); return; }
            // Consume bait.
            inventory.items.splice(baitIdx, 1);
            saveInventory();
            // Roll success.
            const wounded = found.cr.hp <= found.cr.maxHp * 0.5;
            const tameBonus = skillLevel(player.skills.taming) / 250; // up to +0.4 at lvl 100
            const chance = Math.min(0.95, 0.5 + (wounded ? 0.25 : 0) + tameBonus);
            if (Math.random() > chance) {
                addFloater(found.wx, found.wy, '❌ Fled!', '#ff6060');
                _sfx(200, 0.1, 'sawtooth', 0.04);
                // Small chance the target flees (teleport it a few tiles away).
                const nc = Math.max(0, Math.min(CHUNK_SIZE - 1, found.cr.c + (Math.random() < 0.5 ? 2 : -2)));
                const nr = Math.max(0, Math.min(CHUNK_SIZE - 1, found.cr.r + (Math.random() < 0.5 ? 2 : -2)));
                found.cr.c = nc; found.cr.r = nr; found.cr.rc = nc; found.cr.rr = nr;
                return;
            }
            // Success — lift creature out of the chunk into the pet roster.
            found.ch.creatures.splice(found.idx, 1);
            const def = CREATURE_DEFS[found.cr.emoji] || { hp: 10, dmg: 2 };
            const NAMES = ['Ash', 'Briar', 'Cinder', 'Dusk', 'Ember', 'Fern', 'Glim', 'Hazel', 'Iris', 'Jet', 'Kit', 'Lark', 'Moss', 'Nox', 'Pip', 'Quill', 'Rune', 'Sage', 'Thorn', 'Vale', 'Wisp', 'Yarrow'];
            pets.push({
                emoji: found.cr.emoji,
                name: NAMES[Math.floor(Math.random() * NAMES.length)],
                hp: found.cr.hp || def.hp,
                maxHp: found.cr.maxHp || def.hp,
                dmg: Math.max(3, Math.floor(def.hp / 6)),
                wx: found.wx, wy: found.wy,
                rx: found.wx, ry: found.wy,
                moveT: 0, moveFrom: { wx: found.wx, wy: found.wy },
                attackCooldown: 0, timer: 0, _hitFlash: 0,
                level: 1, xp: 0,
                command: 'follow',
            });
            const newPet = pets[pets.length - 1];
            addFloater(found.wx, found.wy, `💖 Tamed ${newPet.name}!`, '#ff60c0');
            _sfx(700, 0.2, 'sine', 0.06);
            addSkillXp('taming', 15);
            savePets();
        }

        function savePets() { /* pets are serialized with main state blob below */ }

        // U — recall: if the player is next to a burning campfire, spend
        // 30 mana to teleport to the nearest other burning campfire in the
        // world. Looks across the full worldDeltas.added set so it finds
        // camps placed in distant chunks the player is no longer near.
        function tryRecall() {
            if (_dungeon) { addFloater(player.wx, player.wy, 'Not in dungeons', '#ffaa00'); return; }
            const anchor = isAdjacentToBurningStructure('campfire');
            if (!anchor) { addFloater(player.wx, player.wy, 'Stand by a 🔥 campfire', '#ffaa00'); return; }
            if (player.mana < 30) { addFloater(player.wx, player.wy, 'Need 30 mana', '#4080e0'); return; }
            // Scan every chunk delta for 'campfire' structures, skipping the
            // anchor tile itself.
            const candidates = [];
            for (const [key, adds] of Object.entries(worldDeltas.added || {})) {
                if (!Array.isArray(adds)) continue;
                const [cx, cy] = key.split(',').map(Number);
                for (const a of adds) {
                    if (a.kind !== 'structure' || a.key !== 'campfire') continue;
                    const wx = cx * CHUNK_SIZE + a.c;
                    const wy = cy * CHUNK_SIZE + a.r;
                    if (wx === anchor.wx && wy === anchor.wy) continue;
                    const d = Math.max(Math.abs(wx - player.wx), Math.abs(wy - player.wy));
                    if (d < 10) continue; // must be a meaningful distance
                    candidates.push({ wx, wy, d });
                }
            }
            if (!candidates.length) { addFloater(player.wx, player.wy, 'No distant camp', '#ffaa00'); return; }
            candidates.sort((a, b) => a.d - b.d);
            const dest = candidates[0];
            player.mana = Math.max(0, player.mana - 30);
            player.wx = dest.wx; player.wy = dest.wy;
            player.rx = dest.wx; player.ry = dest.wy;
            player.moveT = 0;
            addFloater(dest.wx, dest.wy, '✨ Recalled!', '#c080ff');
            _sfx(900, 0.4, 'sine', 0.06);
        }

        // Z — sleep at the campfire to fast-forward to dawn. Full heal,
        // partial hunger refill, drains the fire's fuel. Classic UO camping.
        function trySleep() {
            if (_dungeon) { addFloater(player.wx, player.wy, 'Not in dungeons', '#ffaa00'); return; }
            const anchor = isAdjacentToBurningStructure('campfire');
            if (!anchor) { addFloater(player.wx, player.wy, 'Need a 🔥 campfire', '#ffaa00'); return; }
            // Only useful at night — during the day it's just a fuel waste.
            if (_nightFactor(timeOfDay) < 0.15) {
                addFloater(player.wx, player.wy, 'Only sleep at night', '#c0c0ff');
                return;
            }
            // Jump forward to dawn (0.25). Advances player.days if we wrap.
            const priorT = timeOfDay;
            if (priorT > 0.25) player.days++;
            timeOfDay = 0.25;
            // Compute how many ms we fast-forwarded so growth/fuel timers on
            // structures can advance proportionally.
            const skipRatio = (priorT > 0.25 ? (1 - priorT + 0.25) : (0.25 - priorT));
            const skipMs = skipRatio * DAY_MS;
            for (const [key, adds] of Object.entries(worldDeltas.added || {})) {
                if (!Array.isArray(adds)) continue;
                const [cx, cy] = key.split(',').map(Number);
                const ch = world.chunks.get(cx + ',' + cy);
                for (let i = adds.length - 1; i >= 0; i--) {
                    const a = adds[i];
                    if (a.kind !== 'structure') continue;
                    // Advance growth.
                    if (typeof a.growth === 'number') {
                        a.growth -= skipMs;
                        if (ch) {
                            const feat = ch.features.find(f => f.c === a.c && f.r === a.r && f.structure);
                            if (feat && typeof feat.growth === 'number') feat.growth -= skipMs;
                        }
                    }
                    // Drain fuel proportionally (fires burn through the night).
                    if (typeof a.fuel === 'number') {
                        a.fuel -= skipMs * 0.5;
                        if (ch) {
                            const feat = ch.features.find(f => f.c === a.c && f.r === a.r && f.structure);
                            if (feat && typeof feat.fuel === 'number') feat.fuel -= skipMs * 0.5;
                        }
                    }
                }
            }
            saveWorldDeltas();
            player.hp = player.maxHp;
            player.mana = player.maxMana;
            player.stamina = player.maxStamina;
            player.hunger = Math.min(player.maxHunger, player.hunger + 30);
            player.poison = 0; player.poisonDps = 0;
            // Pets that slept beside the fire also refill to full HP.
            for (const pet of pets) pet.hp = pet.maxHp;
            // Sleeping burns a chunk of the campfire's fuel on top of the
            // proportional skip so the anchor may go out at dawn.
            anchor.f.fuel = Math.max(0, (anchor.f.fuel || 0) - 30000);
            addFloater(player.wx, player.wy, '💤 Rested till dawn', '#c0a0ff');
            _sfx(220, 0.4, 'sine', 0.04);
            // Occasional ambient dream line to flavor the rest.
            const DREAMS = [
                'You dream of endless green valleys.',
                'A dragon watched you from a great distance, but did not move.',
                'You dream of an iron key hidden beneath a stone.',
                'Soft music plays somewhere at the edge of hearing.',
                'You dream you are swimming through clouds.',
                'A voice whispers your name, then fades.',
                'The fire speaks in a language you almost understand.',
                'You see a pet you have never tamed, watching you sleep.',
            ];
            const dream = DREAMS[Math.floor(Math.random() * DREAMS.length)];
            showDialogBubble('🌅', `You wake refreshed as the sun climbs. ${dream}`);
        }

        // Y — feed every wounded pet nearby. Each piece of meat in the
        // backpack heals one pet for a chunk of HP. Prefers raw first so
        // cooked meat stays for the player. Roast heals more than raw.
        function tryFeedPets() {
            if (!pets.length) { addFloater(player.wx, player.wy, 'No pets', '#aaa'); return; }
            const wounded = pets.filter(p => p.hp < p.maxHp);
            if (!wounded.length) { addFloater(player.wx, player.wy, 'Pets at full HP', '#aaa'); return; }
            let fed = 0;
            for (const pet of wounded) {
                const rawIdx = inventory.items.findIndex(i => i.key === 'raw_meat');
                const cookedIdx = rawIdx < 0 ? inventory.items.findIndex(i => i.key === 'meat') : -1;
                const idx = rawIdx >= 0 ? rawIdx : cookedIdx;
                if (idx < 0) break;
                const isRaw = inventory.items[idx].key === 'raw_meat';
                pet.hp = Math.min(pet.maxHp, pet.hp + (isRaw ? 10 : 25));
                inventory.items.splice(idx, 1);
                fed++;
                addFloater(pet.wx, pet.wy, (isRaw ? '🥩' : '🍖') + ' +' + (isRaw ? 10 : 25), '#ff80c0');
            }
            if (!fed) {
                addFloater(player.wx, player.wy, 'No meat to feed', '#ffaa00');
                return;
            }
            saveInventory();
            if ($pack.style.display !== 'none') renderBackpack();
            _sfx(500, 0.1, 'sine', 0.05);
        }

        // Pet AI: each pet follows the player and engages aggressive creatures
        // within 5 tiles of the player. Uses discrete-step movement like the
        // creature AI for consistency.
        const PET_MOVE_MS = 380;
        function tickPets(dt) {
            if (_dungeon || !pets.length) return;
            // Pets standing on a tile adjacent to a burning campfire regen HP
            // at 2/s, matching the player's resting buff thematically.
            const petFireScan = (px, py) => {
                const cx0 = Math.floor(px / CHUNK_SIZE), cy0 = Math.floor(py / CHUNK_SIZE);
                for (let dcy = -1; dcy <= 1; dcy++) for (let dcx = -1; dcx <= 1; dcx++) {
                    const ch = world.chunks.get((cx0 + dcx) + ',' + (cy0 + dcy));
                    if (!ch) continue;
                    for (const f of ch.features) {
                        if (f.structKey !== 'campfire') continue;
                        if (typeof f.fuel === 'number' && f.fuel <= 0) continue;
                        const wx = (cx0 + dcx) * CHUNK_SIZE + f.c;
                        const wy = (cy0 + dcy) * CHUNK_SIZE + f.r;
                        if (Math.max(Math.abs(wx - px), Math.abs(wy - py)) <= 1) return true;
                    }
                }
                return false;
            };
            for (let pi = pets.length - 1; pi >= 0; pi--) {
                const pet = pets[pi];
                if (pet._hitFlash > 0) pet._hitFlash = Math.max(0, pet._hitFlash - dt);
                if (pet.attackCooldown > 0) pet.attackCooldown -= dt;
                if (pet.hp < pet.maxHp && petFireScan(pet.wx, pet.wy)) {
                    // Taming mastery makes pets regen faster at the fire:
                    // base 2 HP/s, +up to 3 HP/s at taming lvl 100.
                    const regen = 2 + skillLevel(player.skills.taming) / 33;
                    pet.hp = Math.min(pet.maxHp, pet.hp + regen * dt / 1000);
                }
                if (pet.hp <= 0) {
                    addFloater(pet.wx, pet.wy, '💔 ' + pet.emoji + ' lost', '#ff6060');
                    // Drop the base creature's loot table one last time so
                    // a slain pet still yields raw_meat / herbs / feathers
                    // for the player to recover.
                    const def = CREATURE_DEFS[pet.emoji];
                    if (def?.loot) {
                        for (const l of def.loot) {
                            if (Math.random() < l.rate) {
                                placeWorldItem(pet.wx, pet.wy, l.key);
                                break;
                            }
                        }
                    }
                    pets.splice(pi, 1);
                    continue;
                }
                // Movement tween.
                if (pet.moveT > 0) {
                    pet.moveT = Math.max(0, pet.moveT - dt);
                    const t = 1 - (pet.moveT / PET_MOVE_MS);
                    pet.rx = pet.moveFrom.wx + (pet.wx - pet.moveFrom.wx) * t;
                    pet.ry = pet.moveFrom.wy + (pet.wy - pet.moveFrom.wy) * t;
                    continue;
                }
                pet.rx = pet.wx; pet.ry = pet.wy;

                // Find the best aggressive creature within 5 tiles of the
                // player. Score = distance + (1 - hpFraction) * -4, so a
                // wounded enemy 3 tiles away beats a full-HP enemy 1 tile
                // away. Pets finish what the player started.
                let target = null, bestScore = Infinity;
                const cx0 = Math.floor(player.wx / CHUNK_SIZE), cy0 = Math.floor(player.wy / CHUNK_SIZE);
                for (let dcy = -1; dcy <= 1; dcy++) for (let dcx = -1; dcx <= 1; dcx++) {
                    const ch = world.chunks.get((cx0 + dcx) + ',' + (cy0 + dcy));
                    if (!ch) continue;
                    for (const cr of ch.creatures) {
                        if (cr.dead) continue;
                        const isNight = _nightFactor(timeOfDay) > 0.5;
                        const eff = (isNight && cr.ai === 'neutral') ? 'aggressive' : cr.ai;
                        if (eff !== 'aggressive') continue;
                        const cwx = (cx0 + dcx) * CHUNK_SIZE + cr.c;
                        const cwy = (cy0 + dcy) * CHUNK_SIZE + cr.r;
                        const distPlayer = Math.max(Math.abs(cwx - player.wx), Math.abs(cwy - player.wy));
                        if (distPlayer > 5) continue;
                        const distPet = Math.max(Math.abs(cwx - pet.wx), Math.abs(cwy - pet.wy));
                        const frac = cr.maxHp ? cr.hp / cr.maxHp : 1;
                        const score = distPet - (1 - frac) * 4;
                        if (score < bestScore) {
                            target = { cr, wx: cwx, wy: cwy, dist: distPet };
                            bestScore = score;
                        }
                    }
                }

                pet.timer += dt;
                if (pet.timer < 350) continue;
                pet.timer = 0;

                // Attack if adjacent to target.
                if (target && target.dist <= 1 && pet.attackCooldown <= 0) {
                    target.cr.hp = Math.max(0, target.cr.hp - pet.dmg);
                    target.cr._hitFlash = 250;
                    pet.attackCooldown = 1000;
                    addFloater(target.wx, target.wy, '-' + pet.dmg, '#ff80c0');
                    _sfx(480, 0.05, 'square', 0.03);
                    if (target.cr.hp <= 0) {
                        // Bonus XP for the player (pet-assisted kill = 50%).
                        const tdef = CREATURE_DEFS[target.cr.emoji] || { xp: 1 };
                        const xpGain = Math.ceil(tdef.xp * 0.5);
                        player.xp += xpGain;
                        addFloater(target.wx, target.wy, '+' + xpGain + ' XP', '#ffc857');
                        // Pet XP — level up every 20 XP, growing HP and dmg.
                        pet.xp = (pet.xp || 0) + tdef.xp;
                        while (pet.xp >= 20 * (pet.level || 1)) {
                            pet.xp -= 20 * (pet.level || 1);
                            pet.level = (pet.level || 1) + 1;
                            pet.maxHp += 10;
                            pet.hp = pet.maxHp;
                            pet.dmg += 1;
                            addFloater(pet.wx, pet.wy, `⬆ ${pet.emoji} lvl ${pet.level}`, '#ff80c0');
                            _sfx(880, 0.12, 'sine', 0.05);
                        }
                        target.cr.dead = true;
                        attuneRuneShard(target.cr.emoji, target.wx, target.wy);
                    }
                    continue;
                }

                // Stay command: pet doesn't chase or return, just holds position
                // and attacks when an enemy wanders adjacent (already handled above).
                if (pet.command === 'stay') continue;
                // Otherwise walk toward target (if any) or toward player.
                const goal = target ? { wx: target.wx, wy: target.wy } : { wx: player.wx, wy: player.wy };
                const distGoal = Math.max(Math.abs(goal.wx - pet.wx), Math.abs(goal.wy - pet.wy));
                // Stop at range 1 from player to avoid stepping on them.
                if (!target && distGoal <= 1) continue;
                const sdx = Math.sign(goal.wx - pet.wx);
                const sdy = Math.sign(goal.wy - pet.wy);
                const nwx = pet.wx + sdx, nwy = pet.wy + sdy;
                if (world.canTraverse(nwx, nwy)) {
                    pet.moveFrom = { wx: pet.wx, wy: pet.wy };
                    pet.wx = nwx; pet.wy = nwy;
                    pet.moveT = PET_MOVE_MS;
                }
            }
        }

        // Press G to plant something on the player's current tile. Tries a
        // priority list — sapling first, then herb/berry/mushroom crop seeds
        // — and consumes the first matching inventory item. Water, stone,
        // mountain, sand, snow all reject the plant.
        function tryPlantSapling() {
            if (_dungeon) { addFloater(player.wx, player.wy, 'Not in dungeons', '#ffaa00'); return; }
            const b = biomeAtDg(player.wx, player.wy);
            const fertile = b === 'grass' || b === 'forest' || b === 'savanna' || b === 'swamp' || b === 'tundra';
            if (!fertile) { addFloater(player.wx, player.wy, 'Soil too poor', '#c08060'); return; }
            if (world.featureAt(player.wx, player.wy)) { addFloater(player.wx, player.wy, 'Tile occupied', '#ffaa00'); return; }
            // Priority: trees first, then crops by tier.
            const options = [
                { invKey: 'sapling',  structKey: 'sapling',         label: '🌱 Sapling' },
                { invKey: 'herb',     structKey: 'herb_seed',       label: '🌱 Herb sprout' },
                { invKey: 'berry',    structKey: 'berry_seed',      label: '🌱 Berry sprout' },
                { invKey: 'mushroom', structKey: 'mushroom_seed',   label: '🌱 Spore cluster' },
            ];
            for (const opt of options) {
                const idx = inventory.items.findIndex(i => i.key === opt.invKey);
                if (idx < 0) continue;
                const placed = placeStructure(player.wx, player.wy, opt.structKey);
                if (!placed) { addFloater(player.wx, player.wy, 'Cannot plant', '#ffaa00'); return; }
                inventory.items.splice(idx, 1);
                saveInventory();
                if ($pack.style.display !== 'none') renderBackpack();
                addFloater(player.wx, player.wy, opt.label, '#60d060');
                _sfx(500, 0.08, 'sine', 0.03);
                return;
            }
            addFloater(player.wx, player.wy, 'Nothing to plant', '#ffaa00');
        }

        // Tick structure timers on visible chunks: fuel-based structures
        // auto-despawn when depleted; growth-based structures morph into
        // their `grownKey` definition once ripe (saplings → trees).
        function tickStructures(dt) {
            if (_dungeon) return;
            const cx0 = Math.floor(player.wx / CHUNK_SIZE), cy0 = Math.floor(player.wy / CHUNK_SIZE);
            // Weather modifiers — rain speeds growth and drowns fuel.
            const rain = rainIntensity();
            const fuelMult   = 1 + rain;       // 1x .. 2x drain under heavy rain
            const growthMult = 1 + rain * 1.5; // 1x .. 2.5x growth under heavy rain
            let anyChanged = false;
            for (let dcy = -1; dcy <= 1; dcy++) {
                for (let dcx = -1; dcx <= 1; dcx++) {
                    const ch = world.chunks.get((cx0 + dcx) + ',' + (cy0 + dcy));
                    if (!ch) continue;
                    const key = (cx0 + dcx) + ',' + (cy0 + dcy);
                    const adds = worldDeltas.added[key];
                    for (let i = ch.features.length - 1; i >= 0; i--) {
                        const f = ch.features[i];
                        if (!f.structure) continue;
                        // Fuel decay → auto-despawn (campfires).
                        if (typeof f.fuel === 'number') {
                            f.fuel -= dt * fuelMult;
                            if (f.fuel <= 0) {
                                const wx = (cx0 + dcx) * CHUNK_SIZE + f.c;
                                const wy = (cy0 + dcy) * CHUNK_SIZE + f.r;
                                ch.features.splice(i, 1);
                                if (adds) {
                                    const di = adds.findIndex(a => a.c === f.c && a.r === f.r && a.kind === 'structure');
                                    if (di >= 0) adds.splice(di, 1);
                                }
                                addFloater(wx, wy, '💨 burned out', '#888');
                                anyChanged = true;
                            }
                            continue;
                        }
                        // Growth evolution → morph into grownKey.
                        if (typeof f.growth === 'number') {
                            f.growth -= dt * growthMult;
                            if (f.growth <= 0) {
                                const currentDef = ITEMS[f.structKey];
                                const grownKey = currentDef?.structure?.grownKey;
                                if (grownKey && ITEMS[grownKey]) {
                                    const grownDef = ITEMS[grownKey];
                                    const wx = (cx0 + dcx) * CHUNK_SIZE + f.c;
                                    const wy = (cy0 + dcy) * CHUNK_SIZE + f.r;
                                    f.emoji = grownDef.emoji;
                                    f.structKey = grownKey;
                                    delete f.growth;
                                    // Update delta entry in place.
                                    if (adds) {
                                        const di = adds.findIndex(a => a.c === f.c && a.r === f.r && a.kind === 'structure');
                                        if (di >= 0) {
                                            adds[di].key = grownKey;
                                            delete adds[di].growth;
                                            delete adds[di].fuel;
                                        }
                                    }
                                    addFloater(wx, wy, '🌳 Grown!', '#40c040');
                                    anyChanged = true;
                                }
                            }
                        }
                    }
                }
            }
            if (anyChanged) saveWorldDeltas();
        }

        // Timestamp (ms on _renderTime axis) while the Light spell is
        // active. Read by collectLightSources as a personal halo.
        let _spellLightUntil = -Infinity;
        // Ticks down in the main loop; render paints a gold screen flash while > 0.
        let _levelUpFlash = 0;

        // Whether the player is currently adjacent to a burning campfire
        // (set by tickCombat; read by render() for the 💤 resting indicator).
        let _resting = false;

        // Cooking: while player stands next to a burning campfire, raw meat
        // in the backpack auto-roasts into cooked meat, one unit every 3 s.
        // Also drains a chunk of campfire fuel per roast so fires don't last
        // forever when used as outdoor ovens.
        let _cookTimer = 0;
        function isAdjacentToBurningStructure(structKey) {
            if (_dungeon) return null;
            const cx0 = Math.floor(player.wx / CHUNK_SIZE), cy0 = Math.floor(player.wy / CHUNK_SIZE);
            for (let dcy = -1; dcy <= 1; dcy++) {
                for (let dcx = -1; dcx <= 1; dcx++) {
                    const ch = world.chunks.get((cx0 + dcx) + ',' + (cy0 + dcy));
                    if (!ch) continue;
                    for (const f of ch.features) {
                        if (!f.structure || f.structKey !== structKey) continue;
                        if (typeof f.fuel === 'number' && f.fuel <= 0) continue;
                        const wx = (cx0 + dcx) * CHUNK_SIZE + f.c;
                        const wy = (cy0 + dcy) * CHUNK_SIZE + f.r;
                        if (Math.max(Math.abs(wx - player.wx), Math.abs(wy - player.wy)) <= 1) {
                            return { f, wx, wy };
                        }
                    }
                }
            }
            return null;
        }
        function tickCooking(dt) {
            const hit = isAdjacentToBurningStructure('campfire');
            if (!hit) { _cookTimer = 0; return; }
            const cookLvl = skillLevel(player.skills.cooking);
            const need = Math.max(1000, 3000 - cookLvl * 20);
            // Roasting — raw_meat is always prioritized over brewing.
            const rawIdx = inventory.items.findIndex(i => i.key === 'raw_meat');
            if (rawIdx >= 0) {
                _cookTimer += dt;
                if (_cookTimer < need) return;
                _cookTimer = 0;
                const raw = inventory.items[rawIdx];
                const cookedDef = ITEMS.meat;
                inventory.items[rawIdx] = {
                    ...raw,
                    id: 'it_' + Math.random().toString(36).slice(2, 9),
                    key: 'meat', emoji: cookedDef.emoji, name: cookedDef.name,
                };
                saveInventory();
                if ($pack.style.display !== 'none') renderBackpack();
                addFloater(hit.wx, hit.wy, '🍖 Roasted!', '#ffb070');
                _sfx(720, 0.08, 'triangle', 0.04);
                addSkillXp('cooking', 3);
                hit.f.fuel = Math.max(0, (hit.f.fuel || 0) - 2500);
                return;
            }
            // Brewing — consume one herb + one mushroom and produce a potion.
            const herbIdx = inventory.items.findIndex(i => i.key === 'herb');
            const shroomIdx = inventory.items.findIndex(i => i.key === 'mushroom');
            if (herbIdx < 0 || shroomIdx < 0) { _cookTimer = 0; return; }
            _cookTimer += dt;
            if (_cookTimer < need) return;
            _cookTimer = 0;
            // Remove highest index first so the other index stays valid.
            const [first, second] = herbIdx > shroomIdx ? [herbIdx, shroomIdx] : [shroomIdx, herbIdx];
            inventory.items.splice(first, 1);
            inventory.items.splice(second, 1);
            const potionDef = ITEMS.potion;
            inventory.items.push({
                id: 'it_' + Math.random().toString(36).slice(2, 9),
                key: 'potion', emoji: potionDef.emoji, name: potionDef.name,
                x: 6 + (inventory.items.length % 7) * 36,
                y: 6 + Math.floor(inventory.items.length / 7) * 36,
            });
            saveInventory();
            if ($pack.style.display !== 'none') renderBackpack();
            addFloater(hit.wx, hit.wy, '🧪 Brewed!', '#80d0ff');
            _sfx(640, 0.08, 'sine', 0.04);
            addSkillXp('cooking', 4);
            hit.f.fuel = Math.max(0, (hit.f.fuel || 0) - 4000);
        }

        // Collect visible structure light sources for the fog-of-war pass.
        // Also emits a small personal halo around the player when they carry
        // a 🔦 Torch, and tiny auras around tamed pets so they're readable in
        // the dark.
        function collectLightSources(cam) {
            if (_dungeon) return [];
            const lights = [];
            const cx0 = Math.floor(player.wx / CHUNK_SIZE), cy0 = Math.floor(player.wy / CHUNK_SIZE);
            for (let dcy = -1; dcy <= 1; dcy++) {
                for (let dcx = -1; dcx <= 1; dcx++) {
                    const ch = world.chunks.get((cx0 + dcx) + ',' + (cy0 + dcy));
                    if (!ch) continue;
                    for (const f of ch.features) {
                        if (!f.structure) continue;
                        const def = ITEMS[f.structKey];
                        const lightTiles = def?.structure?.light;
                        if (!lightTiles) continue;
                        const wx = (cx0 + dcx) * CHUNK_SIZE + f.c;
                        const wy = (cy0 + dcy) * CHUNK_SIZE + f.r;
                        const p = iso(wx, wy);
                        lights.push({
                            x: p.x + cam.cx,
                            y: p.y + cam.cy,
                            radius: lightTiles * TILE_W,
                        });
                    }
                }
            }
            // Hand-held torch + lantern: any Torch in inventory grants a
            // small personal halo; a Lantern extends it much further. The
            // Light spell contributes up to 6 extra tiles while active.
            const torches = inventory.items.filter(i => i.key === 'torch').length;
            const lanterns = inventory.items.filter(i => i.key === 'lantern').length;
            const spellActive = _renderTime < _spellLightUntil;
            if (torches > 0 || lanterns > 0 || spellActive) {
                const pp = iso(player.rx, player.ry);
                const radius = (1 + Math.min(torches, 3) + Math.min(lanterns, 2) * 3 + (spellActive ? 6 : 0)) * TILE_W;
                lights.push({
                    x: pp.x + cam.cx,
                    y: pp.y + cam.cy,
                    radius,
                });
            }
            // Tame pets emit a soft light so they're easier to find at night.
            for (const pet of pets) {
                const pp = iso(pet.rx, pet.ry);
                lights.push({
                    x: pp.x + cam.cx,
                    y: pp.y + cam.cy,
                    radius: 1.5 * TILE_W,
                });
            }
            return lights;
        }

        function killCreature(cr, chCx, chCy) {
            cr.dead = true;
            sfxKill();
            player.kills++;
            // Soul harvest: every kill returns a small amount of mana.
            // Aggressive kills return more than passive — reflects risk.
            const soul = cr.ai === 'aggressive' ? 3 : 1;
            player.mana = Math.min(player.maxMana, player.mana + soul);
            // Dungeon kills give +50% XP to reward venturing underground.
            const xpMult = _dungeon ? 1.5 : 1;
            // Milestone slayer bonuses — each fires once per world.
            const emoji = cr.emoji;
            const milestones = [
                { keys: ['🐉', '🐲'], flag: '_slayDragon', hp: 5,   title: 'Dragonslayer',  line: "You've slain a dragon! Your resolve hardens." },
                { keys: ['👿'],       flag: '_slayDemon',  mana: 20, title: 'Demonbreaker',  line: "The demon king lies dead. Your mana pool widens." },
                { keys: ['👹', '🧌'], flag: '_slayBrute', stam: 15, title: 'Brutebane',     line: "The brutes fall before you. Stamina steels up." },
            ];
            for (const m of milestones) {
                if (!m.keys.includes(emoji) || player[m.flag]) continue;
                player[m.flag] = true;
                if (m.hp)   { player.maxHp   += m.hp;   player.hp   = player.maxHp;   }
                if (m.mana) { player.maxMana += m.mana; player.mana = player.maxMana; }
                if (m.stam) { player.maxStamina += m.stam; player.stamina = player.maxStamina; }
                const gain = m.hp ? `+${m.hp} HP` : m.mana ? `+${m.mana} MP` : `+${m.stam} SP`;
                addFloater(chCx * CHUNK_SIZE + cr.c, chCy * CHUNK_SIZE + cr.r, `🏆 ${m.title} ${gain}`, '#ffd060');
                showDialogBubble(emoji, `${m.line} ${gain} forever.`);
                _sfx(300, 0.3, 'sawtooth', 0.06); setTimeout(() => _sfx(900, 0.3, 'sine', 0.05), 150);
                break;
            }
            // Ancient Rune shards — first kill of each boss family attunes
            // its shard. All four forge the Seal of Aruta (endgame).
            attuneRuneShard(emoji, chCx * CHUNK_SIZE + cr.c, chCy * CHUNK_SIZE + cr.r);
            // Quest progress (kill-type): match by emoji regardless of dungeon/overworld.
            if (activeQuest && activeQuest.kind === 'kill' && activeQuest.target === cr.emoji && activeQuest.current < activeQuest.needed) {
                activeQuest.current++;
                addFloater(chCx * CHUNK_SIZE + cr.c, chCy * CHUNK_SIZE + cr.r,
                    `📜 ${activeQuest.current}/${activeQuest.needed}`, '#e0c080');
            }
            const def = CREATURE_DEFS[cr.emoji] || { xp: 1, loot: [] };
            const xpGain = Math.ceil(def.xp * xpMult);
            player.xp += xpGain;
            addFloater(chCx * CHUNK_SIZE + cr.c, chCy * CHUNK_SIZE + cr.r, '+' + xpGain + ' XP', '#ffc857');
            while (player.xp >= player.xpNext) {
                player.xp -= player.xpNext;
                player.level++;
                player.xpNext = Math.floor(player.xpNext * 1.5);
                player.maxHp += 10; player.hp = player.maxHp;
                player.maxMana += 5; player.mana = player.maxMana;
                player.maxStamina += 5; player.stamina = player.maxStamina;
                player.baseDmg += 1;
                sfxLevelUp();
                _levelUpFlash = _renderTime + 800; // end-time — render paints a gold overlay until then
                showDialogBubble('✦', 'Level up! You are now level ' + player.level);
            }
            // Loot drop at the creature's tile.
            if (_dungeon) {
                // Dungeon: add directly to dungeon features.
                for (const l of def.loot) {
                    if (Math.random() < l.rate) {
                        const lootDef = ITEMS[l.key];
                        if (lootDef && !_dungeon.map.features.find(f => f.c === cr.c && f.r === cr.r)) {
                            _dungeon.map.features.push({ c: cr.c, r: cr.r, emoji: lootDef.emoji, item: true, itemKey: l.key });
                        }
                        break;
                    }
                }
            } else {
                // Overworld: use persistent world delta system.
                const wx = chCx * CHUNK_SIZE + cr.c;
                const wy = chCy * CHUNK_SIZE + cr.r;
                for (const l of def.loot) {
                    if (Math.random() < l.rate) {
                        placeWorldItem(wx, wy, l.key);
                        break;
                    }
                }
            }
        }

        // Dungeon creature tick helper — same AI as overworld but on a flat array.
        function _tickCreatureList(creatures, ox, oy, dt, N) {
            for (const cr of creatures) {
                if (cr.dead) continue;
                if (cr.attackCooldown > 0) cr.attackCooldown -= dt;
                if (cr._hitFlash > 0) cr._hitFlash = Math.max(0, cr._hitFlash - dt);
                if (cr.moveT > 0) {
                    cr.moveT = Math.max(0, cr.moveT - dt);
                    const t = 1 - (cr.moveT / CREATURE_MOVE_MS);
                    cr.rc = cr.fromC + (cr.c - cr.fromC) * t;
                    cr.rr = cr.fromR + (cr.r - cr.fromR) * t;
                    continue;
                }
                cr.rc = cr.c; cr.rr = cr.r;
                const cwx = ox + cr.c, cwy = oy + cr.r;
                const distToPlayer = Math.max(Math.abs(cwx - player.wx), Math.abs(cwy - player.wy));
                if (cr.ai === 'aggressive' && distToPlayer <= 6) {
                    if (distToPlayer <= 1 && cr.attackCooldown <= 0) {
                        const dmgTaken = reduceDamage(cr.dmg);
                        player.hp = Math.max(0, player.hp - dmgTaken);
                        cr.attackCooldown = 1200;
                        if (dmgTaken > 0) addFloater(player.wx, player.wy, '-' + dmgTaken, '#ff6060');
                        sfxHurt();
                        _wearArmor();
                        _playerFlash = 300;
                        // Venomous creatures apply poison.
                        const venomous = ['🐍', '🦂', '🕷️'];
                        if (venomous.includes(cr.emoji) && player.poison <= 0) {
                            player.poison = 8000; player.poisonDps = 2;
                            addFloater(player.wx, player.wy, '☠ Poisoned!', '#40c040');
                        }
                        if (player.hp <= 0) { respawnPlayer(); }
                        continue;
                    }
                    cr.timer += dt;
                    if (cr.timer < 400) continue;
                    cr.timer = 0;
                    const sdx = Math.sign(player.wx - cwx), sdy = Math.sign(player.wy - cwy);
                    const nc = cr.c + sdx, nr = cr.r + sdy;
                    if (nc >= 0 && nc < N && nr >= 0 && nr < N && canTraverseDg(ox + nc, oy + nr, creatureMode(cr.emoji))) {
                        cr.fromC = cr.c; cr.fromR = cr.r;
                        cr.c = nc; cr.r = nr;
                        cr.moveT = CREATURE_MOVE_MS * 0.7;
                    }
                    continue;
                }
                cr.timer += dt;
                if (cr.timer < cr.nextMoveAt) continue;
                cr.timer = 0;
                cr.nextMoveAt = 1200 + Math.random() * 3500;
                const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
                const [ddx, ddy] = dirs[Math.floor(Math.random() * 4)];
                const nc = cr.c + ddx, nr = cr.r + ddy;
                if (nc < 0 || nc >= N || nr < 0 || nr >= N) continue;
                if (!canTraverseDg(ox + nc, oy + nr, creatureMode(cr.emoji))) continue;
                cr.fromC = cr.c; cr.fromR = cr.r;
                cr.c = nc; cr.r = nr;
                cr.moveT = CREATURE_MOVE_MS;
            }
        }

        // Respawn dead creatures after 30–60 s.
        let _respawnTimer = 0;
        function tickCreatureRespawn(dt) {
            _respawnTimer += dt;
            if (_respawnTimer < 5000) return; // check every 5 s
            _respawnTimer = 0;
            const cx0 = Math.floor(player.wx / CHUNK_SIZE), cy0 = Math.floor(player.wy / CHUNK_SIZE);
            for (let dcy = -2; dcy <= 2; dcy++) for (let dcx = -2; dcx <= 2; dcx++) {
                const ch = world.chunks.get((cx0+dcx)+','+(cy0+dcy));
                if (!ch) continue;
                for (const cr of ch.creatures) {
                    if (!cr.dead) continue;
                    cr._deadTime = (cr._deadTime || 0) + 5000;
                    if (cr._deadTime > 30000 + Math.random() * 30000) {
                        const def = CREATURE_DEFS[cr.emoji] || { hp: 10 };
                        cr.dead = false; cr.hp = def.hp; cr.maxHp = def.hp;
                        cr.ai = (CREATURE_DEFS[cr.emoji] || {}).ai || 'neutral';
                        cr._deadTime = 0;
                        cr.attackCooldown = 0;
                    }
                }
            }
        }

        function tickCombat(dt) {
            if (player.attackCooldown > 0) player.attackCooldown -= dt;
            // Spell cooldowns.
            for (let i = 0; i < spellCooldowns.length; i++) {
                if (spellCooldowns[i] > 0) spellCooldowns[i] = Math.max(0, spellCooldowns[i] - dt);
            }
            // Auto-attack: keep swinging at the target if still alive + in range.
            if (_autoTarget && !_autoTarget.dead) {
                attackCreature(_autoTarget);
            } else {
                _autoTarget = null;
            }
            // Standing directly on a burning campfire burns the player
            // (but not adjacent — adjacent is the safe-zone "resting" tile).
            if (!_dungeon) {
                const onFire = world.featureAt(player.wx, player.wy);
                if (onFire && onFire.structKey === 'campfire' && typeof onFire.fuel === 'number' && onFire.fuel > 0) {
                    player.hp = Math.max(1, player.hp - 4 * dt / 1000);
                }
            }
            // Poison DoT.
            if (player.poison > 0) {
                player.poison -= dt;
                player.hp = Math.max(1, player.hp - player.poisonDps * dt / 1000);
                if (player.poison <= 0) { player.poison = 0; player.poisonDps = 0; addFloater(player.wx, player.wy, 'Cured!', '#60ff60'); }
            }
            // Resting next to a burning campfire is a proper safe-zone: HP and
            // mana regenerate far faster, and the hunger decay this frame is
            // refunded so players can camp out the night without starving.
            const resting = !!isAdjacentToBurningStructure('campfire');
            const hpRate   = resting ? 1.2 : 0.3;  // HP/s
            const manaRate = resting ? 1.5 : 0.5;  // MP/s
            // HP regen (slow — blocked while poisoned or starving).
            if (player.hp < player.maxHp && player.poison <= 0 && player.hunger > 0) {
                player.hp = Math.min(player.maxHp, player.hp + hpRate * dt / 1000);
            }
            // Mana regen.
            if (player.mana < player.maxMana) player.mana = Math.min(player.maxMana, player.mana + manaRate * dt / 1000);
            if (resting && player.maxHunger) {
                // player.update already subtracted (dt / 12000) from hunger; give it back.
                player.hunger = Math.min(player.maxHunger, player.hunger + dt / 12000);
            }
            // Stamina regen — faster when standing still (6/s), slower while moving (2/s).
            const moving = player.moveT > 0;
            const staminaBase = moving ? 2 : 6;
            const staminaRate = resting ? staminaBase * 1.5 : staminaBase;
            if (player.stamina < player.maxStamina) player.stamina = Math.min(player.maxStamina, player.stamina + staminaRate * dt / 1000);
            _resting = resting;
        }

        // ── Ambient biome sounds ─────────────────────────
        let _ambientOsc = null, _ambientGain = null, _ambientBiome = '';
        const BIOME_TONES = {
            grass: { freq: 180, type: 'sine',     gain: 0.012 },
            forest:{ freq: 140, type: 'sine',     gain: 0.015 },
            sand:  { freq: 260, type: 'triangle', gain: 0.008 },
            water: { freq: 220, type: 'sine',     gain: 0.018 },
            deep:  { freq: 190, type: 'sine',     gain: 0.020 },
            snow:  { freq: 300, type: 'triangle', gain: 0.010 },
            mountain:{ freq: 160, type: 'sine',   gain: 0.008 },
        };
        function tickAmbientSound() {
            const biome = world.biomeAt(player.wx, player.wy);
            if (biome === _ambientBiome) return;
            _ambientBiome = biome;
            const tone = BIOME_TONES[biome];
            if (!tone) return;
            if (!_sfxCtx) try { _sfxCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
            // Crossfade to new ambient tone.
            try {
                if (_ambientGain) _ambientGain.gain.linearRampToValueAtTime(0, _sfxCtx.currentTime + 0.5);
                if (_ambientOsc) setTimeout(() => { try { _ambientOsc.stop(); } catch {} }, 600);
            } catch {}
            const o = _sfxCtx.createOscillator();
            const g = _sfxCtx.createGain();
            o.type = tone.type; o.frequency.value = tone.freq;
            g.gain.setValueAtTime(0, _sfxCtx.currentTime);
            g.gain.linearRampToValueAtTime(tone.gain, _sfxCtx.currentTime + 0.8);
            o.connect(g); g.connect(_sfxCtx.destination);
            o.start();
            _ambientOsc = o; _ambientGain = g;
        }

        // ── Hover tooltip ─────────────────────────────────
        let _tooltip = null;
        canvas.addEventListener('mousemove', (ev) => {
            const rect = canvas.getBoundingClientRect();
            const { wx, wy } = canvasToWorldCell(ev.clientX - rect.left, ev.clientY - rect.top);
            let text = null;
            // Check creatures.
            const cx0 = Math.floor(wx / CHUNK_SIZE), cy0 = Math.floor(wy / CHUNK_SIZE);
            outer: for (let dcy = -1; dcy <= 1; dcy++) for (let dcx = -1; dcx <= 1; dcx++) {
                const ch = world.chunks.get((cx0+dcx)+','+(cy0+dcy));
                if (!ch) continue;
                for (const cr of ch.creatures) {
                    if (cr.dead) continue;
                    const cwx = (cx0+dcx) * CHUNK_SIZE + cr.c, cwy = (cy0+dcy) * CHUNK_SIZE + cr.r;
                    if (Math.abs(cwx - wx) <= 1 && Math.abs(cwy - wy) <= 1) {
                        const def = CREATURE_DEFS[cr.emoji] || {};
                        const aiLabel = cr.ai === 'aggressive' ? '⚠ Hostile' : cr.ai === 'passive' ? 'Passive' : 'Neutral';
                        text = `${cr.emoji} ${aiLabel} · HP ${Math.round(cr.hp)}/${cr.maxHp}`;
                        break outer;
                    }
                }
            }
            // Check features (items, NPCs, dungeons).
            if (!text) {
                const hit = _findItemNear(ev.clientX - rect.left, ev.clientY - rect.top, world, canvasToWorldCell);
                if (hit) {
                    const def = ITEMS[hit.feature.itemKey];
                    text = `${hit.feature.emoji} ${def ? def.name : 'Item'}`;
                    if (def && def.use) {
                        const parts = [];
                        if (def.use.hp) parts.push('+' + def.use.hp + ' HP');
                        if (def.use.mana) parts.push('+' + def.use.mana + ' MP');
                        if (def.use.stamina) parts.push('+' + def.use.stamina + ' SP');
                        if (def.use.hunger) parts.push('+' + def.use.hunger + ' 🍗');
                        if (parts.length) text += ' (' + parts.join(', ') + ')';
                    }
                } else {
                    const f = world.featureAt(wx, wy);
                    if (f && f.fountain) text = `${f.emoji} Sacred Fountain · Press Space to heal`;
                    else if (f && f.merchant) text = `${f.emoji} Merchant · Press Space to trade`;
                    else if (f && f.npc) text = `${f.emoji} NPC · Press Space to talk`;
                    else if (f && f.dungeon) text = `${f.emoji} ${f.emoji === '⛰️' ? 'Mountain cave' : 'Dungeon entrance'} · Press Space to enter`;
                }
            }
            if (text && text !== _tooltip) {
                _tooltip = text;
                canvas.title = text;
            } else if (!text && _tooltip) {
                _tooltip = null;
                canvas.title = '';
            }
        });

        // ── Click-to-attack (+ auto-attack on hold) ─────
        let _autoTarget = null; // creature ref, cleared on pointerup or target death/far
        canvas.addEventListener('pointerup', () => { _autoTarget = null; });

        canvas.addEventListener('click', (ev) => {
            if (ev.button !== 0) return;
            const rect = canvas.getBoundingClientRect();
            const { wx, wy } = canvasToWorldCell(ev.clientX - rect.left, ev.clientY - rect.top);

            // Search creatures — in dungeon use the flat array, overworld uses chunks.
            const creatureSources = [];
            if (_dungeon) {
                creatureSources.push({ creatures: _dungeon.map.creatures, ox: 0, oy: 0 });
            } else {
                const cx0 = Math.floor(wx / CHUNK_SIZE), cy0 = Math.floor(wy / CHUNK_SIZE);
                for (let dcy = -1; dcy <= 1; dcy++) for (let dcx = -1; dcx <= 1; dcx++) {
                    const ch = world.chunks.get((cx0+dcx)+','+(cy0+dcy));
                    if (ch) creatureSources.push({ creatures: ch.creatures, ox: (cx0+dcx) * CHUNK_SIZE, oy: (cy0+dcy) * CHUNK_SIZE });
                }
            }
            for (const src of creatureSources) {
                for (const cr of src.creatures) {
                    if (cr.dead) continue;
                    const cwx = src.ox + cr.c, cwy = src.oy + cr.r;
                    if (Math.abs(cwx - wx) <= 1 && Math.abs(cwy - wy) <= 1) {
                        attackCreature(cr);
                        _autoTarget = cr;
                        return;
                    }
                }
            }

            // Fishing: click a water tile within 2 tiles.
            if (!_dungeon) {
                const dist0 = Math.max(Math.abs(wx - player.wx), Math.abs(wy - player.wy));
                const clickBiome = biomeAtDg(wx, wy);
                if (dist0 <= 2 && (clickBiome === 'water' || clickBiome === 'deep')) {
                    if (player.stamina < 3) { addFloater(player.wx, player.wy, 'Exhausted!', '#ffaa00'); return; }
                    player.stamina -= 3;
                    _sfx(250, 0.06, 'sine', 0.03);
                    // Base catch rate 40%, +up to 35% from fishing skill (0.75 at lvl 100),
                    // +20% with 🎣 Fishing Rod, +up to 15% during rain (fish rise).
                    const rodBonus = equipment.weapon?.key === 'rod' ? 0.2 : 0;
                    const rainBonus = rainIntensity() * 0.15;
                    const fishRate = 0.4 + skillLevel(player.skills.fishing) / 286 + rodBonus + rainBonus;
                    if (Math.random() < fishRate) {
                        const fishPool = ['gold', 'herb', 'gem'];
                        const fishKey = clickBiome === 'deep' ? (Math.random() < 0.3 ? 'gem' : 'gold') : fishPool[Math.floor(Math.random() * fishPool.length)];
                        const def = ITEMS[fishKey];
                        inventory.items.push({
                            id: 'it_' + Math.random().toString(36).slice(2, 9),
                            key: fishKey, emoji: def.emoji, name: def.name,
                            x: 6 + (inventory.items.length % 7) * 36,
                            y: 6 + Math.floor(inventory.items.length / 7) * 36,
                        });
                        addFloater(wx, wy, '🐟 +' + def.name, '#80c0ff');
                        saveInventory();
                        addSkillXp('fishing', 2);
                    } else {
                        addFloater(wx, wy, 'Nothing bites...', '#aaa');
                    }
                    return;
                }
            }

            // Gathering: click a tree or rock within 2 tiles to harvest.
            if (!_dungeon) {
                const dist = Math.max(Math.abs(wx - player.wx), Math.abs(wy - player.wy));
                if (dist <= 2) {
                    const f = world.featureAt(wx, wy);
                    // Block player's own placed walls even though they set blocks:true —
                    // structures are always allowed as gather targets, but village
                    // houses / NPC props remain blocked as before.
                    const gatherAllowed = f && !f.item && !f.npc && !f.merchant && !f.dungeon && !f.village && (!f.blocks || f.structure);
                    if (gatherAllowed) {
                        const GATHER = {
                            '🌲': [{ key: 'wood', rate: 0.5 }, { key: 'herb', rate: 0.3 }, { key: 'apple', rate: 0.1 }],
                            '🌳': [{ key: 'wood', rate: 0.5 }, { key: 'herb', rate: 0.3 }, { key: 'apple', rate: 0.2 }],
                            '🌴': [{ key: 'wood', rate: 0.3 }, { key: 'apple', rate: 0.5 }],
                            // Boulders: mostly stone, rare iron, occasional gem.
                            '🪨': [{ key: 'stone', rate: 0.55 }, { key: 'iron', rate: 0.12 }, { key: 'gem', rate: 0.08 }],
                            // Mountain peaks: iron-rich vein. Tougher to harvest in the fiction
                            // but same click UX — reward reflects difficulty.
                            '⛰️': [{ key: 'iron', rate: 0.35 }, { key: 'stone', rate: 0.5 }, { key: 'gem', rate: 0.06 }],
                            '🍄': [{ key: 'mushroom', rate: 0.9 }],
                            '🌿': [{ key: 'herb', rate: 0.8 }],
                            '🌾': [{ key: 'berry', rate: 0.7 }],
                            '⛄': [{ key: 'stone', rate: 0.3 }],
                            // Mining a placed wall returns one stone reliably.
                            '🧱': [{ key: 'stone', rate: 1.0 }],
                        };
                        const table = GATHER[f.emoji];
                        if (table) {
                            // Mining ⛰️ peaks is costly — higher stamina floor than other gathers.
                            const isMining = f.emoji === '⛰️' || f.emoji === '🪨';
                            const isTree   = f.emoji === '🌲' || f.emoji === '🌳' || f.emoji === '🌴';
                            const mineLvl = skillLevel(player.skills.mining);
                            const woodLvl = skillLevel(player.skills.woodcutting);
                            // Mining mastery reduces swing cost by up to 3 stamina (at lvl 100).
                            const mineDiscount = Math.floor(mineLvl / 34);
                            // Woodcutting mastery shaves up to 2 stamina off tree chops.
                            const woodDiscount = Math.floor(woodLvl / 50);
                            const baseCost = isMining ? 6 : 3;
                            const disc = isMining ? mineDiscount : (isTree ? woodDiscount : 0);
                            const costStam = Math.max(1, baseCost - disc);
                            const minStam  = costStam;
                            if (player.stamina < minStam) { addFloater(player.wx, player.wy, 'Exhausted!', '#ffaa00'); return; }
                            player.stamina -= costStam;
                            _sfx(isMining ? 180 : 300, 0.08, isMining ? 'sawtooth' : 'triangle', 0.05);
                            for (const drop of table) {
                                if (Math.random() < drop.rate) {
                                    const def = ITEMS[drop.key];
                                    inventory.items.push({
                                        id: 'it_' + Math.random().toString(36).slice(2, 9),
                                        key: drop.key, emoji: def.emoji, name: def.name,
                                        x: 6 + (inventory.items.length % 7) * 36,
                                        y: 6 + Math.floor(inventory.items.length / 7) * 36,
                                    });
                                    addFloater(wx, wy, '+' + def.name, '#80c0ff');
                                    saveInventory();
                                    break;
                                }
                            }
                            // Skill XP for this swing — route by tool emoji.
                            const isTreeEmoji = f.emoji === '🌲' || f.emoji === '🌳' || f.emoji === '🌴';
                            const isRockEmoji = f.emoji === '🪨' || f.emoji === '⛰️' || f.emoji === '🧱';
                            if (isTreeEmoji) addSkillXp('woodcutting', 2);
                            else if (isRockEmoji) addSkillXp('mining', 3);
                            // Skill bonus roll: chance of a second independent drop
                            // scales linearly with the matching skill (0 → 50% at 100).
                            const bonusChance = isTreeEmoji ? woodLvl / 200 : (isRockEmoji ? mineLvl / 200 : 0);
                            if (bonusChance > 0 && Math.random() < bonusChance) {
                                for (const drop of table) {
                                    if (Math.random() < drop.rate) {
                                        const def = ITEMS[drop.key];
                                        inventory.items.push({
                                            id: 'it_' + Math.random().toString(36).slice(2, 9),
                                            key: drop.key, emoji: def.emoji, name: def.name,
                                            x: 6 + (inventory.items.length % 7) * 36,
                                            y: 6 + Math.floor(inventory.items.length / 7) * 36,
                                        });
                                        addFloater(wx, wy, '✨ +' + def.name, '#a0ffd0');
                                        saveInventory();
                                        break;
                                    }
                                }
                            }
                            // Bonus independent roll: chopping trees occasionally
                            // drops a sapling the player can replant elsewhere.
                            if (isTree && Math.random() < 0.18) {
                                const def = ITEMS.sapling;
                                inventory.items.push({
                                    id: 'it_' + Math.random().toString(36).slice(2, 9),
                                    key: 'sapling', emoji: def.emoji, name: def.name,
                                    x: 6 + (inventory.items.length % 7) * 36,
                                    y: 6 + Math.floor(inventory.items.length / 7) * 36,
                                });
                                addFloater(wx, wy, '+🌱 Sapling', '#60d060');
                                saveInventory();
                            }
                            if (Math.random() < 0.3) {
                                // Tree/rock depleted. Structures (grown saplings) need
                                // their world-delta entry cleaned up so they don't
                                // respawn on reload; biome-generated features just
                                // splice out — the chunk's own regen rules cover them.
                                if (f.structure) {
                                    removeStructureAt(wx, wy);
                                } else {
                                    const cx0 = Math.floor(wx / CHUNK_SIZE), cy0 = Math.floor(wy / CHUNK_SIZE);
                                    const ch = world.getChunk(cx0, cy0);
                                    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
                                    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
                                    const fi = ch.features.findIndex(ff => ff.c === lx && ff.r === ly);
                                    if (fi >= 0) ch.features.splice(fi, 1);
                                }
                            }
                        }
                    }
                }
            }
        });

        function tickCreatures(dt) {
            // In dungeon, tick dungeon creatures directly.
            if (_dungeon) {
                _tickCreatureList(_dungeon.map.creatures, 0, 0, dt, DUNGEON_SIZE);
                return;
            }
            const cx0 = Math.floor(player.wx / CHUNK_SIZE), cy0 = Math.floor(player.wy / CHUNK_SIZE);
            for (let dcy = -1; dcy <= 1; dcy++) {
                for (let dcx = -1; dcx <= 1; dcx++) {
                    const ch = world.chunks.get((cx0 + dcx) + ',' + (cy0 + dcy));
                    if (!ch) continue;
                    for (const cr of ch.creatures) {
                        if (cr.dead) continue;
                        // Attack cooldown.
                        if (cr.attackCooldown > 0) cr.attackCooldown -= dt;
                if (cr._hitFlash > 0) cr._hitFlash = Math.max(0, cr._hitFlash - dt);
                        // Advance an in-progress tween.
                        if (cr.moveT > 0) {
                            cr.moveT = Math.max(0, cr.moveT - dt);
                            const t = 1 - (cr.moveT / CREATURE_MOVE_MS);
                            cr.rc = cr.fromC + (cr.c - cr.fromC) * t;
                            cr.rr = cr.fromR + (cr.r - cr.fromR) * t;
                            continue;
                        }
                        cr.rc = cr.c; cr.rr = cr.r;

                        // World coords of this creature.
                        const cwx = (cx0 + dcx) * CHUNK_SIZE + cr.c;
                        const cwy = (cy0 + dcy) * CHUNK_SIZE + cr.r;
                        const distToPlayer = Math.max(Math.abs(cwx - player.wx), Math.abs(cwy - player.wy));

                        // At night, neutral creatures turn aggressive (UO-style danger).
                        // Creatures standing inside a burning campfire's light radius
                        // stay passive/neutral — camps become real safe zones.
                        const isNight = _nightFactor(timeOfDay) > 0.5;
                        const sheltered = nearBurningCampfire(cwx, cwy);
                        const effectiveAI = (isNight && cr.ai === 'neutral' && !sheltered) ? 'aggressive' : cr.ai;

                        // Aggressive AI: chase player + attack when adjacent.
                        if (effectiveAI === 'aggressive' && distToPlayer <= 6) {
                            if (distToPlayer <= 1 && cr.attackCooldown <= 0) {
                                const dmgTaken = reduceDamage(cr.dmg);
                                player.hp = Math.max(0, player.hp - dmgTaken);
                                cr.attackCooldown = 1200;
                                if (dmgTaken > 0) addFloater(player.wx, player.wy, '-' + dmgTaken, '#ff6060');
                                sfxHurt();
                                _wearArmor();
                                _playerFlash = 300;
                                // Venomous overworld creatures.
                                const venomous = ['🐍', '🦂'];
                                if (venomous.includes(cr.emoji) && player.poison <= 0) {
                                    player.poison = 8000; player.poisonDps = 2;
                                    addFloater(player.wx, player.wy, '☠ Poisoned!', '#40c040');
                                }
                                if (player.hp <= 0) { respawnPlayer(); }
                                continue;
                            }
                            cr.timer += dt;
                            if (cr.timer < 400) continue;
                            cr.timer = 0;
                            // Chase: step toward player (uses canTraverseDg).
                            const sdx = Math.sign(player.wx - cwx);
                            const sdy = Math.sign(player.wy - cwy);
                            const nc = cr.c + sdx, nr = cr.r + sdy;
                            const cMode = creatureMode(cr.emoji);
                            const nwx = (cx0 + dcx) * CHUNK_SIZE + nc;
                            const nwy = (cy0 + dcy) * CHUNK_SIZE + nr;
                            if (nc >= 0 && nc < CHUNK_SIZE && nr >= 0 && nr < CHUNK_SIZE &&
                                canTraverseDg(nwx, nwy, cMode)) {
                                cr.fromC = cr.c; cr.fromR = cr.r;
                                cr.c = nc; cr.r = nr;
                                cr.moveT = CREATURE_MOVE_MS * 0.7;
                            }
                            continue;
                        }

                        // Passive AI: flee if player within 4 tiles.
                        if (effectiveAI === 'passive' && distToPlayer <= 4) {
                            cr.timer += dt;
                            if (cr.timer < 300) continue;
                            cr.timer = 0;
                            const fdx = Math.sign(cwx - player.wx);
                            const fdy = Math.sign(cwy - player.wy);
                            const nc = cr.c + fdx, nr = cr.r + fdy;
                            const cMode = creatureMode(cr.emoji);
                            const nwx = (cx0 + dcx) * CHUNK_SIZE + nc;
                            const nwy = (cy0 + dcy) * CHUNK_SIZE + nr;
                            if (nc >= 0 && nc < CHUNK_SIZE && nr >= 0 && nr < CHUNK_SIZE &&
                                canTraverseDg(nwx, nwy, cMode)) {
                                cr.fromC = cr.c; cr.fromR = cr.r;
                                cr.c = nc; cr.r = nr;
                                cr.moveT = CREATURE_MOVE_MS * 0.6;
                            }
                            continue;
                        }

                        // Default wander.
                        cr.timer += dt;
                        if (cr.timer < cr.nextMoveAt) continue;
                        cr.timer = 0;
                        cr.nextMoveAt = 1200 + Math.random() * 3500;
                        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
                        const [dx, dy] = dirs[Math.floor(Math.random() * 4)];
                        const nc = cr.c + dx, nr = cr.r + dy;
                        if (nc < 0 || nc >= CHUNK_SIZE || nr < 0 || nr >= CHUNK_SIZE) continue;
                        const cMode = creatureMode(cr.emoji);
                        const nwx = (cx0 + dcx) * CHUNK_SIZE + nc;
                        const nwy = (cy0 + dcy) * CHUNK_SIZE + nr;
                        if (!canTraverseDg(nwx, nwy, cMode)) continue;
                        cr.fromC = cr.c; cr.fromR = cr.r;
                        cr.c = nc; cr.r = nr;
                        cr.moveT = CREATURE_MOVE_MS;
                    }
                }
            }
        }

        function loop(now) {
            const dt = Math.min(50, now - last); last = now;
            _renderTime += dt;
            tryStepFromHeld();
            player.update(dt);
            tickCreatures(dt);
            tickCombat(dt);
            tickFloaters(dt);
            tickCreatureRespawn(dt);
            tickStructures(dt);
            tickCooking(dt);
            tickPets(dt);
            if (activeBuff) {
                activeBuff.remaining -= dt;
                if (activeBuff.remaining <= 0) {
                    addFloater(player.wx, player.wy, '⏳ Buff faded', '#aaa');
                    activeBuff = null;
                }
            }
            if (_playerFlash > 0) _playerFlash = Math.max(0, _playerFlash - dt);
            tickAmbientSound();
            render();
            updateHUD();
            renderMinimap();

            // Advance time-of-day (wraps 0..1 over DAY_MS).
            const prevDay = timeOfDay;
            timeOfDay = (timeOfDay + dt / DAY_MS) % 1;
            if (timeOfDay < prevDay) player.days++; // midnight wrap = new day
            // Dawn/dusk chimes — fire once when crossing the transition.
            if (prevDay < 0.25 && timeOfDay >= 0.25) {
                _sfx(520, 0.2, 'sine', 0.03); setTimeout(() => _sfx(780, 0.25, 'sine', 0.03), 200);
            }
            if (prevDay < 0.75 && timeOfDay >= 0.75) {
                _sfx(400, 0.2, 'sine', 0.03); setTimeout(() => _sfx(280, 0.25, 'sine', 0.03), 200);
            }

            // Save every ~2s.
            saveTimer += dt;
            if (saveTimer > 2000) {
                saveTimer = 0;
                sdk.storage.set(STATE_KEY, {
                    seed, px: player.wx, py: player.wy, timeOfDay, playerClass,
                    hp: player.hp, mana: player.mana, stamina: player.stamina, hunger: player.hunger,
                    level: player.level, xp: player.xp, xpNext: player.xpNext,
                    maxHp: player.maxHp, maxMana: player.maxMana, maxStamina: player.maxStamina, maxHunger: player.maxHunger, baseDmg: player.baseDmg, kills: player.kills, days: player.days,
                    pets: pets.map(p => ({ emoji: p.emoji, name: p.name, hp: p.hp, maxHp: p.maxHp, dmg: p.dmg, wx: p.wx, wy: p.wy, level: p.level, xp: p.xp, command: p.command })),
                    skills: player.skills,
                    activeQuest,
                    crafted: player.crafted || 0,
                    slayDragon: player._slayDragon || false,
                    slayDemon: player._slayDemon || false,
                    slayBrute: player._slayBrute || false,
                    runeShards, sealForged,
                }).catch(e => console.warn('[ultima-aruta] save state failed', e));
                worldRow.lastPlayed = Date.now();
                worldRow.playerClass = playerClass;
                worldRow.level = player.level;
                worldRow.kills = player.kills;
                sdk.storage.set('worlds', worlds).catch(e => console.warn('[ultima-aruta] save worlds failed', e));
            }

            rafId = requestAnimationFrame(loop);
        }
        rafId = requestAnimationFrame(loop);

        // ── Cleanup ──────────────────────────────────────
        root.__uaCleanup = () => {
            cancelAnimationFrame(rafId);
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('keyup', onKey);
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
            try { _ambientOsc?.stop(); _ambientOsc = null; } catch {}
        };
    },

    async unmount(root) {
        try { root.__uaCleanup?.(); } catch {}
        delete root.__uaCleanup;
    }
};
