/* Ultima Aruta — data.js: all game constants */
// Top-down square tiles (Pokémon-style). 24px gives ~23×16 visible tiles in
// the 560×380 viewport — similar density to a GBA-era RPG. TILE_W and TILE_H
// remain identical and equal to TILE_SIZE so legacy width/height call sites
// keep compiling. Change TILE_SIZE in one place to rescale the whole game.
const TILE_SIZE = 24;
const TILE_W = TILE_SIZE;
const TILE_H = TILE_SIZE;
const CHUNK_SIZE = 32;
const MOVE_MS = 440;
const CREATURE_MOVE_MS = 600;
const DAY_MS = 5 * 60 * 1000;
// Elevation-driven lift and perspective scale are disabled in the top-down
// rebuild; kept as 0 to neutralize any legacy call sites without having to
// strip them. All tiles render at the same flat plane.
const ELEV_PX = 0;
const PERSP_STRENGTH = 0;
const DUNGEON_SIZE = 24;
const SELL_RATIO = 0.3;

// Movement speed multipliers (applied to MOVE_MS).
const SPEED = {
    walk: 1.0,        // base
    swim: 1.5,        // 50% slower
    sail: 1.2,        // 20% slower
    exhausted: 1.8,   // 80% slower (stacks multiplicatively)
};
// Stamina cost per step by mode.
const STAMINA_COST = { walk: 2, swim: 4, sail: 1 };

// Creature movement types.
const AQUATIC_CREATURES = ['🐟', '🐠', '🦈', '🦆'];
const FLYING_CREATURES  = ['🦅'];

const BIOMES = {
    deep:     { color1: '#123864', color2: '#0a1e3d', passable: false, name: 'Deep Water' },
    water:    { color1: '#2a7abc', color2: '#1d5a92', passable: false, name: 'Water' },
    sand:     { color1: '#e0cc8a', color2: '#c4ad66', passable: true,  name: 'Beach' },
    swamp:    { color1: '#4a6e3a', color2: '#384e2a', passable: true,  name: 'Swamp' },
    grass:    { color1: '#5ca14b', color2: '#427a35', passable: true,  name: 'Plain' },
    savanna:  { color1: '#a8b44a', color2: '#8a9636', passable: true,  name: 'Savanna' },
    forest:   { color1: '#2d6a2a', color2: '#1f4c1c', passable: true,  name: 'Forest' },
    mountain: { color1: '#7a6e5b', color2: '#554b3d', passable: false, name: 'Mountain' },
    tundra:   { color1: '#9a9a8a', color2: '#7a7a6a', passable: true,  name: 'Tundra' },
    snow:     { color1: '#e8e8f0', color2: '#b4b8cc', passable: true,  name: 'Snow' },
};

const DUNGEON_BIOMES = {
    cave_floor: { color1: '#3a3040', color2: '#28202a', passable: true,  name: 'Cave' },
    cave_wall:  { color1: '#1a1418', color2: '#0e0a10', passable: false, name: 'Wall' },
    lava:       { color1: '#a03010', color2: '#601808', passable: false, name: 'Lava' },
    exit:       { color1: '#406040', color2: '#304830', passable: true,  name: 'Exit' },
};

// Merged lookup for both overworld + dungeon biomes (used by the renderer).
const ALL_BIOMES = { ...BIOMES, ...DUNGEON_BIOMES };

const FEATURES = {
    sand:    [{ emoji: '🌴', rate: 0.02 }, { emoji: '🪨', rate: 0.01 }],
    swamp:   [{ emoji: '🌿', rate: 0.08 }, { emoji: '🍄', rate: 0.04 }, { emoji: '🌳', rate: 0.02 }],
    grass:   [{ emoji: '🌳', rate: 0.03 }, { emoji: '🌿', rate: 0.04 }, { emoji: '🌾', rate: 0.02 }, { emoji: '🪨', rate: 0.005 }],
    savanna: [{ emoji: '🌾', rate: 0.06 }, { emoji: '🌳', rate: 0.01 }, { emoji: '🪨', rate: 0.008 }, { emoji: '🗿', rate: 0.003 }],
    forest:  [{ emoji: '🌲', rate: 0.35 }, { emoji: '🌳', rate: 0.12 }, { emoji: '🍄', rate: 0.01 }, { emoji: '🪨', rate: 0.01 }],
    tundra:  [{ emoji: '🪨', rate: 0.03 }, { emoji: '🌿', rate: 0.01 }, { emoji: '🗿', rate: 0.004 }],
    snow:    [{ emoji: '🌲', rate: 0.06 }, { emoji: '⛄', rate: 0.005 }],
    // Mountain peaks and boulders — mineable for stone/iron/gem.
    mountain:[{ emoji: '⛰️', rate: 0.18 }, { emoji: '🪨', rate: 0.08 }],
};

const CREATURE_DEFS = {
    '🐑': { ai: 'passive', hp: 10, dmg: 0, xp: 2, loot: [{ key: 'raw_meat', rate: 0.6 }, { key: 'herb', rate: 0.4 }] },
    '🐇': { ai: 'passive', hp: 8,  dmg: 0, xp: 1, loot: [{ key: 'raw_meat', rate: 0.5 }, { key: 'berry', rate: 0.5 }] },
    '🦌': { ai: 'passive', hp: 18, dmg: 0, xp: 3, loot: [{ key: 'raw_meat', rate: 0.7 }, { key: 'herb', rate: 0.3 }, { key: 'apple', rate: 0.2 }] },
    '🐟': { ai: 'passive', hp: 6,  dmg: 0, xp: 1, loot: [] },
    '🐠': { ai: 'passive', hp: 6,  dmg: 0, xp: 1, loot: [] },
    '🦊': { ai: 'neutral',  hp: 20, dmg: 4, xp: 5, loot: [{ key: 'gold', rate: 0.3 }] },
    '🦉': { ai: 'neutral',  hp: 14, dmg: 3, xp: 3, loot: [{ key: 'scroll', rate: 0.15 }] },
    '🦝': { ai: 'neutral',  hp: 16, dmg: 3, xp: 4, loot: [{ key: 'gold', rate: 0.2 }] },
    '🦀': { ai: 'neutral',  hp: 12, dmg: 2, xp: 2, loot: [{ key: 'stone', rate: 0.3 }] },
    '🦎': { ai: 'neutral',  hp: 10, dmg: 2, xp: 2, loot: [{ key: 'gem', rate: 0.1 }] },
    '🐗': { ai: 'aggressive', hp: 35, dmg: 7, xp: 10, loot: [{ key: 'raw_meat', rate: 0.8 }, { key: 'gold', rate: 0.5 }, { key: 'potion', rate: 0.2 }] },
    '🐺': { ai: 'aggressive', hp: 40, dmg: 8, xp: 12, loot: [{ key: 'gold', rate: 0.4 }, { key: 'dagger', rate: 0.08 }] },
    '💀': { ai: 'aggressive', hp: 45, dmg: 10, xp: 15, loot: [{ key: 'gold', rate: 0.6 }, { key: 'sword', rate: 0.1 }] },
    '👻': { ai: 'aggressive', hp: 35, dmg: 8,  xp: 12, loot: [{ key: 'scroll', rate: 0.3 }, { key: 'gem', rate: 0.15 }] },
    '🦇': { ai: 'aggressive', hp: 20, dmg: 5,  xp: 6,  loot: [{ key: 'herb', rate: 0.4 }] },
    '🕷️': { ai: 'aggressive', hp: 30, dmg: 7,  xp: 10, loot: [{ key: 'potion', rate: 0.2 }, { key: 'gold', rate: 0.4 }] },
    '🐻': { ai: 'neutral',    hp: 50, dmg: 9,  xp: 14, loot: [{ key: 'raw_meat', rate: 0.7 }, { key: 'herb', rate: 0.4 }, { key: 'gold', rate: 0.3 }] },
    '🐍': { ai: 'aggressive', hp: 22, dmg: 6,  xp: 7,  loot: [{ key: 'potion', rate: 0.15 }] },
    '🐉': { ai: 'aggressive', hp: 120, dmg: 18, xp: 50, loot: [{ key: 'gem', rate: 0.8 }, { key: 'crown', rate: 0.2 }, { key: 'spellbook', rate: 0.15 }, { key: 'treasure_map', rate: 0.4 }] },
    '🐸': { ai: 'passive',   hp: 8,   dmg: 0,  xp: 1,  loot: [{ key: 'herb', rate: 0.3 }] },
    '🐲': { ai: 'aggressive', hp: 100, dmg: 15, xp: 40, loot: [{ key: 'gem', rate: 0.9 }, { key: 'crown', rate: 0.3 }, { key: 'treasure_map', rate: 0.35 }] },
    '👹': { ai: 'aggressive', hp: 80,  dmg: 12, xp: 30, loot: [{ key: 'armor', rate: 0.4 }, { key: 'gold', rate: 0.8 }, { key: 'treasure_map', rate: 0.2 }] },
    '🧟': { ai: 'aggressive', hp: 70,  dmg: 10, xp: 25, loot: [{ key: 'sword', rate: 0.3 }, { key: 'potion', rate: 0.5 }, { key: 'treasure_map', rate: 0.15 }] },
    // New overworld creatures
    '🦅': { ai: 'passive',    hp: 14, dmg: 0,  xp: 3,  loot: [{ key: 'feather', rate: 0.6 }] },
    '🦈': { ai: 'aggressive', hp: 50, dmg: 12, xp: 15, loot: [{ key: 'gold', rate: 0.5 }] },
    '🐊': { ai: 'aggressive', hp: 40, dmg: 9,  xp: 12, loot: [{ key: 'raw_meat', rate: 0.5 }, { key: 'gold', rate: 0.4 }] },
    '🦂': { ai: 'aggressive', hp: 25, dmg: 7,  xp: 8,  loot: [{ key: 'potion', rate: 0.2 }] },
    '🐄': { ai: 'passive',    hp: 20, dmg: 0,  xp: 2,  loot: [{ key: 'raw_meat', rate: 0.9 }] },
    '🐴': { ai: 'passive',    hp: 30, dmg: 0,  xp: 1,  loot: [{ key: 'raw_meat', rate: 0.5 }, { key: 'herb', rate: 0.3 }] },
    '🦄': { ai: 'passive',    hp: 40, dmg: 0,  xp: 10, loot: [{ key: 'gem', rate: 0.8 }, { key: 'potion', rate: 0.5 }] },
    '🧛': { ai: 'aggressive', hp: 55, dmg: 11, xp: 18, loot: [{ key: 'scroll', rate: 0.4 }, { key: 'gold', rate: 0.6 }] },
    '🧌': { ai: 'aggressive', hp: 65, dmg: 10, xp: 16, loot: [{ key: 'stone', rate: 0.5 }, { key: 'gold', rate: 0.4 }] },
    '👿': { ai: 'aggressive', hp: 110, dmg: 16, xp: 45, loot: [{ key: 'spellbook', rate: 0.3 }, { key: 'gem', rate: 0.7 }, { key: 'treasure_map', rate: 0.3 }] },
    '🐓': { ai: 'passive',    hp: 5,  dmg: 0,  xp: 1,  loot: [{ key: 'feather', rate: 0.5 }, { key: 'raw_meat', rate: 0.4 }] },
    '🦆': { ai: 'passive',    hp: 8,  dmg: 0,  xp: 1,  loot: [{ key: 'feather', rate: 0.4 }, { key: 'raw_meat', rate: 0.4 }] },
};

const CREATURES = {
    grass:    { count: 4, pool: ['🐑', '🐇', '🦊', '🦌', '🐄', '🐴', '🐓'] },
    savanna:  { count: 3, pool: ['🐇', '🦎', '🐍', '🦂', '🐄'] },
    forest:   { count: 4, pool: ['🦌', '🐗', '🦉', '🦝', '🐻', '🐍', '🦄'] },
    swamp:    { count: 3, pool: ['🐍', '🦎', '🐸', '🐊'] },
    sand:     { count: 2, pool: ['🦀', '🦎', '🦂'] },
    water:    { count: 3, pool: ['🐟', '🐠', '🦆'] },
    deep:     { count: 2, pool: ['🦈'] },
    tundra:   { count: 2, pool: ['🐺', '🐻', '🦅'] },
    snow:     { count: 1, pool: ['🦌', '🐺', '🐻'] },
    mountain: { count: 1, pool: ['🐉', '🦅', '🧌'] },
};

const DUNGEON_CREATURES = [
    { emoji: '💀', ai: 'aggressive', hp: 45, dmg: 10, xp: 15, loot: [{ key: 'gold', rate: 0.6 }, { key: 'sword', rate: 0.1 }] },
    { emoji: '👻', ai: 'aggressive', hp: 35, dmg: 8,  xp: 12, loot: [{ key: 'scroll', rate: 0.3 }, { key: 'gem', rate: 0.15 }] },
    { emoji: '🦇', ai: 'aggressive', hp: 20, dmg: 5,  xp: 6,  loot: [{ key: 'herb', rate: 0.4 }] },
    { emoji: '🕷️', ai: 'aggressive', hp: 30, dmg: 7,  xp: 10, loot: [{ key: 'potion', rate: 0.2 }, { key: 'gold', rate: 0.4 }] },
];

const VILLAGE = {
    houses:  ['🏠', '🏡', '🛖'],
    centers: ['⛪', '🏛️', '🏰'],
    npcs:    ['🧙', '🧝', '🧑‍🌾', '🧑‍🍳', '⚔️'],
};

const ITEMS = {
    gold:     { emoji: '🪙', name: 'Gold Coin' },
    gem:      { emoji: '💎', name: 'Gem' },
    berry:    { emoji: '🍓', name: 'Wild Berry',  use: { hp: 8, stamina: 10, hunger: 8 } },
    mushroom: { emoji: '🍄', name: 'Mushroom',    use: { hp: 5, mana: 8, hunger: 6 } },
    stone:    { emoji: '🪨', name: 'Stone' },
    flower:   { emoji: '🌸', name: 'Flower' },
    apple:    { emoji: '🍎', name: 'Apple',       use: { hp: 12, stamina: 15, hunger: 12 } },
    herb:     { emoji: '🌿', name: 'Herb',        use: { hp: 6, mana: 5, hunger: 3 } },
    key:      { emoji: '🗝️', name: 'Old Key' },
    potion:   { emoji: '🧪', name: 'Potion',      use: { hp: 30, mana: 20 } },
    scroll:   { emoji: '📜', name: 'Scroll',      use: { mana: 25 } },
    sword:    { emoji: '⚔️', name: 'Shortsword',   slot: 'weapon' },
    axe:      { emoji: '🪓', name: 'Hand Axe',      slot: 'weapon' },
    bow:      { emoji: '🏹', name: 'Hunter Bow',    slot: 'weapon' },
    dagger:   { emoji: '🗡️', name: 'Dagger',       slot: 'weapon' },
    shield:   { emoji: '🛡️', name: 'Round Shield', slot: 'shield' },
    helm:     { emoji: '⛑️', name: 'Iron Helm',    slot: 'head' },
    crown:    { emoji: '👑', name: 'Crown',         slot: 'head' },
    hat:      { emoji: '🎩', name: 'Mage Hat',      slot: 'head' },
    armor:    { emoji: '🦺', name: 'Cuirass',       slot: 'chest' },
    robe:     { emoji: '🥼', name: 'Robe',          slot: 'chest' },
    gloves:   { emoji: '🧤', name: 'Gloves',        slot: 'hands' },
    boots:    { emoji: '🥾', name: 'Boots',         slot: 'feet' },
    sandals:  { emoji: '👡', name: 'Sandals',       slot: 'feet' },
    cape:     { emoji: '🧣', name: 'Cape',          slot: 'cape' },
    necklace: { emoji: '📿', name: 'Necklace',      slot: 'neck' },
    ring:     { emoji: '💍', name: 'Ring',          slot: 'ring' },
    spellbook:{ emoji: '📖', name: 'Spellbook',     slot: 'book' },
    // New items
    wand:     { emoji: '🪄', name: 'Wand',          slot: 'weapon' },
    meat:     { emoji: '🍖', name: 'Roast Meat',    use: { hp: 18, stamina: 20, hunger: 40 } },
    raw_meat: { emoji: '🥩', name: 'Raw Meat',      use: { hp: 4, stamina: 5, hunger: 12 } },
    bread:    { emoji: '🍞', name: 'Bread',         use: { hp: 10, stamina: 12, hunger: 28 } },
    wine:     { emoji: '🍷', name: 'Wine',          use: { hp: 5, mana: 15, stamina: 10, hunger: 6 } },
    feather:  { emoji: '🪶', name: 'Feather' },
    wood:     { emoji: '🪵', name: 'Wood' },
    iron:     { emoji: '🔩', name: 'Iron Ingot' },
    rod:      { emoji: '🎣', name: 'Fishing Rod', slot: 'weapon' },
    treasure_map: { emoji: '🗺️', name: 'Treasure Map', map: true },
    lantern:  { emoji: '🏮', name: 'Lantern' },
    crystal:  { emoji: '🔮', name: 'Crystal Ball',  slot: 'book' },
    torch:    { emoji: '🔦', name: 'Torch' },
    compass:  { emoji: '🧭', name: 'Compass' },
    antidote: { emoji: '⚗️', name: 'Antidote',     use: { cure: true } },
    canoe:    { emoji: '🛶', name: 'Canoe',         boat: true },
    sailboat: { emoji: '⛵', name: 'Sailboat',      boat: true },
    // Structures — placeable world features (not pickupable once deployed).
    // `structure.fuel` (ms) drives auto-despawn; `structure.light` (tiles)
    // carves a warm light hole in the night fog around its tile.
    // `structure.growth` (ms) evolves the structure into `structure.grownKey`
    // once elapsed — used for plantable saplings → mature trees.
    campfire:    { emoji: '🔥', name: 'Campfire',      structure: { fuel: 90000, light: 4 } },
    sapling:     { emoji: '🌱', name: 'Sapling',       structure: { growth: 120000, grownKey: 'grown_tree' } },
    // Internal-only grown tree structure (player never holds one in inventory).
    grown_tree:  { emoji: '🌳', name: 'Tree',          structure: { mature: true } },
    // Stone wall — blocks walking and creature AI. Mineable (click within 2).
    wall:        { emoji: '🧱', name: 'Stone Wall',    structure: { blocks: true } },
    // Crop seeds — internal-only structure keys, never held in inventory;
    // planting consumes the raw ingredient (herb/berry/mushroom) directly.
    herb_seed:      { emoji: '🌱', name: 'Herb Sprout',    structure: { growth: 60000, grownKey: 'grown_herb' } },
    grown_herb:     { emoji: '🌿', name: 'Herb Bush',      structure: { mature: true } },
    berry_seed:     { emoji: '🌱', name: 'Berry Sprout',   structure: { growth: 75000, grownKey: 'grown_berry' } },
    grown_berry:    { emoji: '🌾', name: 'Berry Patch',    structure: { mature: true } },
    mushroom_seed:  { emoji: '🌱', name: 'Spore Cluster',  structure: { growth: 90000, grownKey: 'grown_mushroom' } },
    grown_mushroom: { emoji: '🍄', name: 'Mushroom Ring',  structure: { mature: true } },
};

const ITEM_DROPS = {
    grass:  [
        { key: 'flower', rate: 0.01 }, { key: 'berry', rate: 0.006 }, { key: 'gold', rate: 0.002 },
        { key: 'sword', rate: 0.0008 }, { key: 'dagger', rate: 0.0008 }, { key: 'shield', rate: 0.0006 },
        { key: 'robe', rate: 0.0005 }, { key: 'ring', rate: 0.0003 },
    ],
    forest: [
        { key: 'mushroom', rate: 0.008 }, { key: 'herb', rate: 0.006 }, { key: 'apple', rate: 0.003 },
        { key: 'bow', rate: 0.0008 }, { key: 'axe', rate: 0.0006 }, { key: 'cape', rate: 0.0005 },
        { key: 'spellbook', rate: 0.0005 }, { key: 'hat', rate: 0.0003 },
    ],
    sand:   [
        { key: 'stone', rate: 0.004 }, { key: 'gem', rate: 0.001 },
        { key: 'sandals', rate: 0.0006 }, { key: 'necklace', rate: 0.0004 }, { key: 'crown', rate: 0.00015 },
    ],
    snow:   [
        { key: 'stone', rate: 0.003 }, { key: 'gem', rate: 0.001 },
        { key: 'boots', rate: 0.0007 }, { key: 'helm', rate: 0.0005 }, { key: 'gloves', rate: 0.0005 },
        { key: 'armor', rate: 0.0003 },
    ],
};

const MERCHANT_STOCK = [
    { key: 'potion',    price: 15 }, { key: 'scroll',    price: 12 },
    { key: 'berry',     price: 3 },  { key: 'apple',     price: 5 },
    { key: 'herb',      price: 4 },  { key: 'sword',     price: 40 },
    { key: 'shield',    price: 35 }, { key: 'helm',      price: 30 },
    { key: 'armor',     price: 50 }, { key: 'boots',     price: 20 },
    { key: 'bow',       price: 45 }, { key: 'ring',      price: 25 },
    { key: 'spellbook', price: 55 },
    { key: 'wand',      price: 35 },
    { key: 'meat',      price: 8 },
    { key: 'bread',     price: 4 },
    { key: 'wine',      price: 10 },
    { key: 'torch',     price: 6 },
    { key: 'antidote',  price: 12 },
    { key: 'iron',      price: 20 },
    { key: 'campfire',  price: 8 },
    { key: 'sapling',   price: 4 },
    { key: 'wall',      price: 5 },
];

const RECIPES = [
    { name: 'Potion',        inputs: ['herb', 'mushroom'],       output: 'potion' },
    { name: 'Strong Potion', inputs: ['herb', 'herb', 'berry'],  output: 'potion' },
    { name: 'Scroll',        inputs: ['flower', 'herb'],         output: 'scroll' },
    { name: 'Ring',          inputs: ['gem', 'gold'],            output: 'ring' },
    { name: 'Necklace',      inputs: ['gem', 'gem', 'gold'],    output: 'necklace' },
    { name: 'Dagger',        inputs: ['stone', 'stone'],         output: 'dagger' },
    { name: 'Axe',           inputs: ['stone', 'stone', 'herb'], output: 'axe' },
    { name: 'Shield',        inputs: ['stone', 'stone', 'stone'], output: 'shield' },
    { name: 'Helm',          inputs: ['stone', 'stone', 'gold'], output: 'helm' },
    { name: 'Boots',         inputs: ['herb', 'herb', 'stone'],  output: 'boots' },
    { name: 'Armor',         inputs: ['stone', 'stone', 'stone', 'gold'], output: 'armor' },
    { name: 'Bow',           inputs: ['herb', 'herb', 'herb', 'stone'],   output: 'bow' },
    { name: 'Crown',         inputs: ['gem', 'gem', 'gem', 'gold'],       output: 'crown' },
    { name: 'Wand',          inputs: ['wood', 'gem'],                    output: 'wand' },
    { name: 'Torch',         inputs: ['wood', 'herb'],                   output: 'torch' },
    { name: 'Spellbook',     inputs: ['wood', 'feather', 'gem'],         output: 'spellbook' },
    { name: 'Antidote',      inputs: ['herb', 'mushroom', 'berry'],     output: 'antidote' },
    { name: 'Meat',          inputs: ['wood', 'berry'],                 output: 'meat' },
    { name: 'Canoe',         inputs: ['wood', 'wood', 'wood', 'herb'],  output: 'canoe' },
    { name: 'Sailboat',      inputs: ['wood', 'wood', 'wood', 'wood', 'feather'], output: 'sailboat' },
    { name: 'Campfire',      inputs: ['wood', 'wood'],                  output: 'campfire' },
    { name: 'Stone Wall',    inputs: ['stone', 'stone', 'stone'],       output: 'wall' },
    { name: 'Fishing Rod',   inputs: ['wood', 'wood', 'feather'],       output: 'rod' },
    { name: 'Lantern',       inputs: ['iron', 'torch'],                 output: 'lantern' },
    // Iron upgrades — stronger than stone equivalents, require mined iron.
    { name: 'Iron Sword',    inputs: ['iron', 'iron', 'wood'],          output: 'sword' },
    { name: 'Iron Armor',    inputs: ['iron', 'iron', 'iron', 'wood'],  output: 'armor' },
    { name: 'Iron Helm',     inputs: ['iron', 'iron'],                  output: 'helm' },
];

const SLOTS = [
    { key: 'head',   label: '⛑️ Head'   }, { key: 'neck',   label: '📿 Neck'   },
    { key: 'cape',   label: '🧣 Cape'   }, { key: 'chest',  label: '🦺 Chest'  },
    { key: 'hands',  label: '🧤 Hands'  }, { key: 'ring',   label: '💍 Ring'   },
    { key: 'weapon', label: '⚔️ Weapon' }, { key: 'shield', label: '🛡️ Shield'},
    { key: 'feet',   label: '🥾 Feet'   }, { key: 'book',   label: '📖 Book'   },
];

const DIALOGS = [
    'Hail, wanderer. Safe travels beyond these walls.',
    'Have ye seen the shadows grow longer at dusk?',
    'The smith needs iron. Bring some if ye find any.',
    "The forest whispers of old ruins eastward.",
    'Gold buys bread; courage buys tales.',
    'Stay out of the deep caves. Nothing good lives there.',
    'A traveller once told me the sea hides an island of spires.',
    'Do not trust mushrooms that glow.',
    'At night the fae dance in forest clearings.',
    'I dreamt of a dragon last night. Wasn\'t friendly.',
    'Beware the scorpions in the sand dunes. Their sting burns.',
    'I heard howling from the mountains last night. Could be trolls.',
    'The fountain in the village square can heal any wound.',
    'Unicorns roam the deepest forests. They flee at the sight of man.',
    'Wood and feathers — that\'s all ye need for a proper spellbook.',
    'Sharks patrol the deep waters. Stay close to shore!',
    'A wise mage always carries an antidote. Snakes are everywhere.',
    'The caves hold treasures, but also terrible creatures.',
    'Craft yourself some armour before venturing far. Stones are plenty.',
    'They say a demon lurks in the deepest dungeon chamber.',
];

// Sprite sizes by emoji — used by the renderer. Scaled for 24px tiles:
// large props (trees/buildings) cap near TILE_SIZE×1.4 so they read as
// "bigger than a walkable cell" without drowning neighbors; actors fit
// inside one tile; pickups sit ~half-tile.
const SPRITE_SIZES = {
    '🌲': 35, '🌳': 35, '🌴': 32,
    '🌱': 14,
    '🪨': 11, '🌿': 11, '🌾': 12, '🍄': 11, '⛄': 18,
    '⛪': 33, '🏛️': 33, '🏰': 35, '🏠': 29, '🏡': 29, '🛖': 27,
    '🐑': 17, '🐇': 14, '🦊': 17, '🦌': 20, '🐗': 18, '🦉': 14, '🦝': 17,
    '🦀': 14, '🦎': 14, '🐟': 15, '🐠': 15, '🐺': 18,
    '🧙': 21, '🧝': 20, '🧑‍🌾': 20, '🧑‍🍳': 20, '🧑‍💼': 21,
    '🪙':  9, '💎': 11, '🍓':  9, '🍎': 11, '🌸':  9,
    '🗝️': 11, '🧪': 11, '📜': 11,
    '⚔️': 15, '🪓': 15, '🏹': 17, '🗡️': 14, '🛡️': 17,
    '⛑️': 15, '👑': 14, '🎩': 15, '🦺': 17, '🥼': 17,
    '🧤': 12, '🥾': 14, '👡': 12, '🧣': 14, '📿': 12,
    '💍':  9, '📖': 15,
    '🕳️': 24, '🏚️': 29, '🪜': 23, '🧰': 18,
    '💀': 20, '👻': 18, '🦇': 15, '🕷️': 17, '⛰️': 27,
    '🐻': 21, '🐍': 15, '🐉': 32, '🐸': 12,
    '🐲': 29, '👹': 26, '🧟': 21,
    '🦅': 17, '🦈': 20, '🐊': 18, '🦂': 14, '🐄': 20, '🐴': 21, '🦄': 23,
    '🧛': 21, '🧌': 23, '👿': 27, '🐓': 12, '🦆': 14, '💂': 21,
    '🪄': 15, '🍖': 12, '🥩': 12, '🍞': 12, '🍷': 12, '🪶': 11, '🪵': 14,
    '🔮': 17, '🔦': 14, '🧭': 12, '🔩': 11, '🗺️': 14, '🎣': 16, '🏮': 16,
    '⛲': 26, '🪦': 17, '⛺': 24, '🕯️': 12, '🗿': 23, '🕸️': 14, '⚗️': 12,
    '🛶': 21, '⛵': 24,
    '🔥': 22, '🧱': 22,
};
/* ╔══════════════════════════════════════════════════════════╗
 * ║  ULTIMA ARUTA — engine.js                                  ║
 * ║  Noise, World class, dungeon gen, rendering, iso math,     ║
 * ║  day/night, fog-of-war, SFX, floaters, stars.              ║
 * ║  Call setup(dataModule) before using — sets constant refs.  ║
 * ╚══════════════════════════════════════════════════════════╝ */


