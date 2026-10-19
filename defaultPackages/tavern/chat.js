// Tavern chat helper — wraps Trystero P2P signaling so ui.js and widget.js
// share one connection logic. Bundled inline by the host iframe loader.
// Trystero exposes joinRoom/selfId via globalThis.__trystero (added at the
// end of trystero.min.js after we strip the ESM exports).

const TAVERN_APP_ID = 'aruta-tavern';
const TAVERN_DEFAULT_ROOM = 'public';
const TAVERN_NICK_KEY = 'nickname';
const TAVERN_NICK_COLOR_KEY = 'nickColor';
const TAVERN_ROOM_KEY = 'room';
const TAVERN_ROOMS_KEY = 'rooms';
const TAVERN_SIDE_KEY = 'sidebarSide';
const TAVERN_STRATEGY_KEY = 'strategy';
const TAVERN_STRATEGIES = ['torrent'];
const TAVERN_STRATEGY_DEFAULT = 'torrent';
const TAVERN_PASSWORD_KEY = 'password';       // legacy: last-used password
const TAVERN_ROOM_PWDS_KEY = 'roomPasswords'; // { [roomName]: passwordString }
const TAVERN_ROOM_LOGS_KEY = 'roomLogs';      // { [roomName]: htmlString } — persisted chat history
const TAVERN_ENTERED_KEY   = '_entered';      // true once user has completed setup at least once
const TAVERN_ROOM_LOG_MAX  = 200000;          // per-room html cap (matches in-memory cap)
const TAVERN_KEYPAIR_KEY   = '_keyPair';      // { pub: jwk, priv: jwk }
const TAVERN_BLOCKLIST_KEY = '_blockedKeys';  // array of public key thumbprints
const TAVERN_RATE_LIMIT_MS = 200;             // drop msgs from same peer faster than this
const TAVERN_TS_WINDOW_MS  = 5 * 60 * 1000;   // anti-replay: ±5 min tolerance
const TAVERN_MAX_TEXT_LEN  = 1000;
const TAVERN_MAX_NICK_LEN  = 32;
const TAVERN_CRYPTO_ALGO   = { name: 'ECDSA', namedCurve: 'P-256' };
const TAVERN_SIGN_ALGO     = { name: 'ECDSA', hash: 'SHA-256' };

/**
 * Canonical JSON stringify — sorted keys, so independent peers
 * serialize the same object to the same bytes for signing/verifying.
 */
function tavernCanonical(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(tavernCanonical).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + tavernCanonical(obj[k])).join(',') + '}';
}

/**
 * Strip characters used for display spoofing + CSS/DOM tampering:
 *  - \u202A-\u202E / \u2066-\u2069: bidi overrides (RLO/LRO/PDF) that
 *    reverse the apparent order of a string — classic phishing
 *    technique ("abc@evil.com" rendered as "moc.live@cba").
 *  - \u200B-\u200D / \uFEFF: zero-width spaces / joiners — used to
 *    make two nicks look identical while having different code points.
 *  - \u0000-\u001F / \u007F: ASCII control chars — should never
 *    appear in user-facing text; they can break rendering or log
 *    layout (newlines in a nick, null bytes, etc.).
 */
function tavernSanitize(s, maxLen) {
    const stripped = String(s || '').replace(
        /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF\u0000-\u001F\u007F]/g,
        ''
    );
    return stripped.slice(0, maxLen);
}

/** Allow only canonical CSS color forms — no ";" so attribute context
 *  can't be escaped, no "url(", no JS keywords. */
const TAVERN_COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|hsla?\(\s*[-0-9.,%\s]+\)|rgba?\(\s*[-0-9.,%\s]+\))$/;
function tavernValidColor(s) {
    if (typeof s !== 'string') return false;
    if (s.length === 0 || s.length > 48) return false;
    return TAVERN_COLOR_RE.test(s);
}

function tavernB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}
function tavernUnB64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** Stable short thumbprint of a public key JWK — used to identify peers. */
async function tavernThumbprint(jwk) {
    if (!jwk || typeof jwk !== 'object') return '';
    // RFC 7638: canonical form of kty, crv, x, y for EC keys.
    const canonical = tavernCanonical({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
    const bytes = new TextEncoder().encode(canonical);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return tavernB64(new Uint8Array(hash)).replace(/=+$/, '');
}

async function tavernLoadRooms(ctx) {
    const stored = await ctx.storage.get(TAVERN_ROOMS_KEY);
    if (Array.isArray(stored) && stored.every(r => typeof r === 'string')) return stored;
    return [TAVERN_DEFAULT_ROOM];
}

async function tavernSaveRooms(ctx, rooms) {
    const cleaned = Array.from(new Set(
        rooms.map(r => String(r || '').trim().slice(0, 64)).filter(Boolean)
    ));
    if (cleaned.length === 0) cleaned.push(TAVERN_DEFAULT_ROOM);
    await ctx.storage.set(TAVERN_ROOMS_KEY, cleaned);
    return cleaned;
}

async function tavernLoadRoomPwds(ctx) {
    const stored = await ctx.storage.get(TAVERN_ROOM_PWDS_KEY);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        const out = {};
        for (const [k, v] of Object.entries(stored)) {
            if (typeof v === 'string') out[String(k).slice(0, 64)] = v;
        }
        return out;
    }
    return {};
}

async function tavernSaveRoomPwds(ctx, map) {
    const clean = {};
    for (const [k, v] of Object.entries(map || {})) {
        if (typeof v === 'string' && v !== '') clean[String(k).slice(0, 64)] = v;
    }
    await ctx.storage.set(TAVERN_ROOM_PWDS_KEY, clean);
    return clean;
}

async function tavernLoadRoomLogs(ctx) {
    const stored = await ctx.storage.get(TAVERN_ROOM_LOGS_KEY);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        const out = {};
        for (const [k, v] of Object.entries(stored)) {
            if (typeof v === 'string') out[String(k).slice(0, 64)] = v.slice(-TAVERN_ROOM_LOG_MAX);
        }
        return out;
    }
    return {};
}

async function tavernSaveRoomLogs(ctx, map) {
    const clean = {};
    for (const [k, v] of Object.entries(map || {})) {
        if (typeof v === 'string' && v) {
            clean[String(k).slice(0, 64)] = v.slice(-TAVERN_ROOM_LOG_MAX);
        }
    }
    await ctx.storage.set(TAVERN_ROOM_LOGS_KEY, clean);
    return clean;
}

async function tavernLoadSide(ctx) {
    const s = await ctx.storage.get(TAVERN_SIDE_KEY);
    if (s === 'left')  return 'left';
    if (s === 'right') return 'right';
    return 'right'; // default right per user preference
}

async function tavernSaveSide(ctx, side) {
    await ctx.storage.set(TAVERN_SIDE_KEY, side === 'right' ? 'right' : 'left');
}

function tavernRandNick() {
    const adj = ['Wandering', 'Mystic', 'Silent', 'Lone', 'Crimson', 'Frost', 'Shadow', 'Iron', 'Wild', 'Old'];
    const noun = ['Mage', 'Bard', 'Druid', 'Knight', 'Rogue', 'Seer', 'Smith', 'Wraith', 'Pilgrim', 'Sage'];
    // Cryptographically random picks — avoid Math.random for identity-ish bits.
    const buf = new Uint32Array(3);
    crypto.getRandomValues(buf);
    const a = adj[buf[0] % adj.length];
    const n = noun[buf[1] % noun.length];
    const num = 100 + (buf[2] % 900);
    return a + n + num;
}

function tavernNickColor(nick) {
    // Legacy helper — kept for back-compat on initial profile bootstrap,
    // but the display color now comes from tavernIdentityColor() keyed on
    // the peer's public-key thumbprint so two peers sharing a nick are
    // still visually distinguishable.
    let h = 0;
    for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ', 70%, 65%)';
}

/**
 * Stable HSL color derived from a peer's public-key thumbprint. Two peers
 * sharing the same nick will have DIFFERENT colors because their keypairs
 * are distinct — this is the only anti-impersonation signal the user can
 * perceive at a glance, besides the ⚠ spoof badge.
 */
function tavernIdentityColor(thumbprint) {
    const s = String(thumbprint || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    // Bigger hue range + slightly varied lightness so adjacent peers don't
    // collide visually when their hashes happen to land close together.
    const hue = h % 360;
    const light = 60 + ((h >>> 8) % 12); // 60-71%
    return 'hsl(' + hue + ', 70%, ' + light + '%)';
}

function tavernEscapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}

function tavernFmtTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
}

class TavernChat {
    constructor(ctx) {
        this.ctx = ctx;
        this.room = null;
        this.isConnected = false;
        this.sendMsg = null;
        this.getMsg = null;
        this.onPeerJoinCb = null;
        this.onPeerLeaveCb = null;
        this.onMessageCb = null;
        this.onSpoofCb = null;
        this.peerCount = 0;
        this.nick = '';
        this.color = '';
        this.roomName = TAVERN_DEFAULT_ROOM;
        this.password = '';
        // Crypto identity: persistent ECDSA keypair tied to this app's
        // storage. Other peers verify messages against our public key.
        this.privKey = null;
        this.pubKey = null;
        this.pubKeyJwk = null;
        this.selfThumbprint = '';
        // Per-session state
        this.peerFirstNick = new Map();   // peerId -> first declared nick
        this.peerLastMsgTs = new Map();   // peerId -> last msg timestamp
        this.peerKeys = new Map();        // peerId -> { pub, jwk, thumbprint }
        this.blockedPeers = new Set();    // peerIds muted this session
        // Persistent blocklist — public key thumbprints so a mute
        // survives peerId changes between sessions.
        this.blockedThumbs = new Set();
    }

    /**
     * Load or generate the peer identity keypair + persistent blocklist.
     * Called once during loadProfile. Private key stays inside app-scoped
     * IndexedDB (ctx.storage namespace) — never broadcast, never exposed
     * to the page.
     */
    async _initCrypto() {
        if (!(globalThis.crypto && globalThis.crypto.subtle)) {
            throw new Error('WebCrypto not available — Tavern requires HTTPS');
        }
        let stored = await this.ctx.storage.get(TAVERN_KEYPAIR_KEY);
        if (stored && stored.pub && stored.priv) {
            try {
                this.pubKey = await crypto.subtle.importKey('jwk', stored.pub, TAVERN_CRYPTO_ALGO, true, ['verify']);
                this.privKey = await crypto.subtle.importKey('jwk', stored.priv, TAVERN_CRYPTO_ALGO, false, ['sign']);
                this.pubKeyJwk = stored.pub;
            } catch (_) {
                stored = null; // corrupt — regenerate below
            }
        }
        if (!stored) {
            const kp = await crypto.subtle.generateKey(TAVERN_CRYPTO_ALGO, true, ['sign', 'verify']);
            this.pubKey = kp.publicKey;
            this.privKey = kp.privateKey;
            this.pubKeyJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
            const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
            await this.ctx.storage.set(TAVERN_KEYPAIR_KEY, { pub: this.pubKeyJwk, priv: privJwk });
        }
        this.selfThumbprint = await tavernThumbprint(this.pubKeyJwk);
        // Display color now keyed on the permanent identity, not the nick —
        // two users with the same nick still render in different colors so
        // the audience can tell them apart.
        this.color = tavernIdentityColor(this.selfThumbprint);
        const blocklist = await this.ctx.storage.get(TAVERN_BLOCKLIST_KEY);
        this.blockedThumbs = new Set(Array.isArray(blocklist) ? blocklist : []);
    }

    async _sign(obj) {
        const bytes = new TextEncoder().encode(tavernCanonical(obj));
        const sig = await crypto.subtle.sign(TAVERN_SIGN_ALGO, this.privKey, bytes);
        return tavernB64(new Uint8Array(sig));
    }

    async _verify(peerJwk, obj, sigB64) {
        if (!peerJwk || !sigB64) return false;
        try {
            const key = await crypto.subtle.importKey('jwk', peerJwk, TAVERN_CRYPTO_ALGO, true, ['verify']);
            const bytes = new TextEncoder().encode(tavernCanonical(obj));
            const sig = tavernUnB64(sigB64);
            return await crypto.subtle.verify(TAVERN_SIGN_ALGO, key, sig, bytes);
        } catch (_) {
            return false;
        }
    }

    async _persistBlocklist() {
        try { await this.ctx.storage.set(TAVERN_BLOCKLIST_KEY, Array.from(this.blockedThumbs)); }
        catch (_) {}
    }

    async loadProfile() {
        let nick = await this.ctx.storage.get(TAVERN_NICK_KEY);
        if (!nick) {
            nick = tavernRandNick();
            await this.ctx.storage.set(TAVERN_NICK_KEY, nick);
        }
        this.nick = nick;
        let color = await this.ctx.storage.get(TAVERN_NICK_COLOR_KEY);
        if (!color) {
            color = tavernNickColor(nick);
            await this.ctx.storage.set(TAVERN_NICK_COLOR_KEY, color);
        }
        this.color = color;
        const room = await this.ctx.storage.get(TAVERN_ROOM_KEY);
        if (room) this.roomName = room;
        const strategy = await this.ctx.storage.get(TAVERN_STRATEGY_KEY);
        this.strategy = TAVERN_STRATEGIES.includes(strategy) ? strategy : TAVERN_STRATEGY_DEFAULT;
        this.roomPasswords = await tavernLoadRoomPwds(this.ctx);
        // If a password is explicitly saved for the current room use it;
        // otherwise fall back to the legacy global TAVERN_PASSWORD_KEY so
        // existing installs keep working on first load.
        const saved = this.roomPasswords[this.roomName];
        if (typeof saved === 'string') {
            this.password = saved;
        } else {
            const pwd = await this.ctx.storage.get(TAVERN_PASSWORD_KEY);
            this.password = typeof pwd === 'string' ? pwd : '';
        }
        await this._initCrypto();
    }

    async setPassword(pwd) {
        const trimmed = String(pwd || '');
        if (trimmed === this.password) return;
        this.password = trimmed;
        await this.ctx.storage.set(TAVERN_PASSWORD_KEY, trimmed);
        if (this.room) {
            try { await this.room.leave(); } catch (_) {}
        }
        await this._connect();
    }

    blockPeer(peerId) {
        if (!peerId || peerId === 'self') return;
        this.blockedPeers.add(peerId);
        // Persistent block: add the peer's public key thumbprint so the
        // mute survives peerId churn between sessions.
        const info = this.peerKeys.get(peerId);
        if (info?.thumbprint) {
            this.blockedThumbs.add(info.thumbprint);
            this._persistBlocklist();
        }
    }
    unblockPeer(peerId) {
        this.blockedPeers.delete(peerId);
        const info = this.peerKeys.get(peerId);
        if (info?.thumbprint) {
            this.blockedThumbs.delete(info.thumbprint);
            this._persistBlocklist();
        }
    }
    isBlocked(peerId) {
        if (this.blockedPeers.has(peerId)) return true;
        const info = this.peerKeys.get(peerId);
        return !!(info?.thumbprint && this.blockedThumbs.has(info.thumbprint));
    }

    async setStrategy(name) {
        const trimmed = TAVERN_STRATEGIES.includes(name) ? name : TAVERN_STRATEGY_DEFAULT;
        if (trimmed === this.strategy) return;
        this.strategy = trimmed;
        await this.ctx.storage.set(TAVERN_STRATEGY_KEY, trimmed);
        if (this.room) {
            try { await this.room.leave(); } catch (_) {}
        }
        await this._connect();
    }

    async setNick(newNick) {
        const trimmed = tavernSanitize(newNick, TAVERN_MAX_NICK_LEN).trim();
        if (!trimmed || trimmed === this.nick) return;
        this.nick = trimmed;
        // Color is now identity-derived — don't change it on rename.
        await this.ctx.storage.set(TAVERN_NICK_KEY, trimmed);
    }

    async setRoom(newRoom, newPwd) {
        const trimmed = tavernSanitize(newRoom, 64).trim() || TAVERN_DEFAULT_ROOM;
        // If a password is explicitly provided for this room, remember it
        // so later switches back to the same room reuse it automatically.
        let pwdChanged = false;
        if (typeof newPwd === 'string') {
            const cleaned = newPwd.slice(0, 128);
            if (cleaned) this.roomPasswords[trimmed] = cleaned;
            else delete this.roomPasswords[trimmed];
            this.roomPasswords = await tavernSaveRoomPwds(this.ctx, this.roomPasswords);
            pwdChanged = (this.roomPasswords[trimmed] || '') !== this.password;
        }
        if (trimmed === this.roomName && !pwdChanged) return;
        this.roomName = trimmed;
        this.password = this.roomPasswords[trimmed] || '';
        await this.ctx.storage.set(TAVERN_ROOM_KEY, trimmed);
        await this.ctx.storage.set(TAVERN_PASSWORD_KEY, this.password);
        if (this.room) {
            try { await this.room.leave(); } catch (_) {}
        }
        await this._connect();
    }

    async _connect() {
        const strategy = this.strategy || TAVERN_STRATEGY_DEFAULT;
        const T = globalThis.__trystero?.[strategy];
        if (!T || typeof T.joinRoom !== 'function') {
            throw new Error('Trystero strategy "' + strategy + '" not loaded');
        }
        this.peerCount = 0;
        this.peerNicks = new Map();      // peerId -> {nick, color, joinedAt}
        this.peerFirstNick = new Map();  // peerId -> first declared nick (spoof guard)
        this.peerLastMsgTs = new Map();  // peerId -> last accepted ts (rate limit)
        // Password makes the room name namespace differently inside Trystero,
        // so "public" + pwd "secret" is a distinct swarm from "public" with
        // no password. Empty string = open room.
        const config = { appId: TAVERN_APP_ID };
        if (this.password) config.password = this.password;
        // Override Trystero's default tracker list. NOTE: the option is
        // `relayUrls` — `trackerUrls` is silently ignored (that bug shipped
        // for a while and left this override inert). Public trackers rot
        // fast; list every candidate — explicit relayUrls are ALL used and
        // dead ones just retry in the background.
        if (strategy === 'torrent') {
            config.relayUrls = [
                'wss://tracker.btorrent.xyz',         // alive 2026-06
                'wss://tracker.novage.com.ua',        // alive 2026-06
                'wss://tracker.openwebtorrent.com',   // dead 2026-06, kept for revival
                'wss://tracker.webtorrent.dev',       // dead 2026-06, kept for revival
                'wss://tracker.files.fm:7073/announce',
                'wss://tracker.ghostchu-services.top',
            ];
        }
        this.room = T.joinRoom(config, this.roomName);
        this.isConnected = true;
        const [sendMsg, getMsg] = this.room.makeAction('msg');
        const [sendPresence, getPresence] = this.room.makeAction('presence');
        this.sendMsg = sendMsg;
        this.getMsg = getMsg;
        this.sendPresence = sendPresence;
        this.getMsg(async (msg, peerId) => {
            // Reject anything from blocked peers (by peerId OR thumbprint).
            if (this.isBlocked(peerId)) { console.debug('[tavern] drop: blocked', peerId); return; }

            // Payload shape validation — silent drop on anything malformed.
            if (!msg || typeof msg !== 'object') { console.debug('[tavern] drop: not object'); return; }
            if (typeof msg.text !== 'string' || typeof msg.nick !== 'string' || typeof msg.color !== 'string') { console.debug('[tavern] drop: wrong types', msg); return; }
            if (typeof msg.ts !== 'number' || typeof msg.sig !== 'string') { console.debug('[tavern] drop: missing ts/sig', msg); return; }
            if (msg.text.length === 0 || msg.text.length > TAVERN_MAX_TEXT_LEN) { console.debug('[tavern] drop: text length'); return; }
            if (msg.nick.length === 0 || msg.nick.length > TAVERN_MAX_NICK_LEN) { console.debug('[tavern] drop: nick length'); return; }
            if (!tavernValidColor(msg.color)) { console.debug('[tavern] drop: color invalid', msg.color); return; }

            // Anti-replay: reject anything too far from now.
            const now = Date.now();
            if (Math.abs(now - msg.ts) > TAVERN_TS_WINDOW_MS) { console.debug('[tavern] drop: ts outside window', msg.ts, 'vs', now); return; }

            // Must have seen this peer's public key via presence first.
            const keyInfo = this.peerKeys.get(peerId);
            if (!keyInfo) { console.debug('[tavern] drop: no key for peer', peerId); return; }

            // Per-peer rate limit (after validation so spam doesn't OOM the verify queue).
            const last = this.peerLastMsgTs.get(peerId) || 0;
            if (now - last < TAVERN_RATE_LIMIT_MS) { console.debug('[tavern] drop: rate limit'); return; }
            this.peerLastMsgTs.set(peerId, now);

            // Cryptographic verification — invalid signatures drop silently.
            const payload = { text: msg.text, nick: msg.nick, color: msg.color, ts: msg.ts };
            const ok = await this._verify(keyInfo.jwk, payload, msg.sig);
            if (!ok) { console.debug('[tavern] drop: sig verify failed'); return; }

            // Nick lock: reject display nick that differs from the
            // locked-in nick for this identity (thumbprint). Attacker
            // can't impersonate someone else even with valid signature.
            const firstNick = this.peerFirstNick.get(peerId);
            const declaredNick = msg.nick.slice(0, TAVERN_MAX_NICK_LEN);
            const spoofed = !!(firstNick && firstNick !== declaredNick);
            const nick = spoofed ? firstNick : declaredNick;

            if (typeof this.onMessageCb === 'function') {
                // Identity-based color overrides whatever the peer claimed —
                // two peers sharing a nick get different colors so the user
                // can visually tell them apart.
                this.onMessageCb({
                    text: tavernSanitize(msg.text, TAVERN_MAX_TEXT_LEN),
                    nick: tavernSanitize(nick, TAVERN_MAX_NICK_LEN),
                    color: tavernIdentityColor(keyInfo.thumbprint),
                    ts: msg.ts,
                    self: false,
                    peerId,
                    verified: true,
                    spoofed,
                });
            }
            if (spoofed && typeof this.onSpoofCb === 'function') {
                this.onSpoofCb({ peerId, declared: declaredNick, actual: firstNick });
            }
        });
        getPresence(async (info, peerId) => {
            if (!info || typeof info !== 'object') { console.debug('[tavern] presence drop: not object'); return; }
            if (typeof info.nick !== 'string' || typeof info.color !== 'string') { console.debug('[tavern] presence drop: wrong types'); return; }
            if (typeof info.ts !== 'number' || typeof info.sig !== 'string') { console.debug('[tavern] presence drop: missing ts/sig'); return; }
            if (info.type !== 'join' && info.type !== 'leave') { console.debug('[tavern] presence drop: bad type'); return; }
            if (info.nick.length === 0 || info.nick.length > TAVERN_MAX_NICK_LEN) { console.debug('[tavern] presence drop: nick len'); return; }
            if (!tavernValidColor(info.color)) { console.debug('[tavern] presence drop: color invalid', info.color); return; }
            // Public key only needed on join (leave can trust the peerId we
            // already know) but validate shape when present.
            if (info.type === 'join') {
                if (!info.pub || typeof info.pub !== 'object' || info.pub.kty !== 'EC' || info.pub.crv !== 'P-256') return;
            }

            // Anti-replay on presence too.
            const now = Date.now();
            if (Math.abs(now - info.ts) > TAVERN_TS_WINDOW_MS) return;

            // Strip any display-spoofing chars before showing — but sign
            // the ORIGINAL bytes (validate first, display sanitized).
            const nick  = tavernSanitize(info.nick, TAVERN_MAX_NICK_LEN);
            if (!nick) return;
            const color = info.color;
            const type  = info.type;

            if (type === 'join') {
                // Verify signature using the public key carried in the payload.
                const payload = { type: 'join', nick, color, ts: info.ts, pub: info.pub };
                const ok = await this._verify(info.pub, payload, info.sig);
                if (!ok) return;

                const thumbprint = await tavernThumbprint(info.pub);

                // Persistent blocklist hit — drop silently.
                if (this.blockedThumbs.has(thumbprint)) return;

                // Identity lock: once a peerId is associated with a public
                // key, later presence from the same peerId with a DIFFERENT
                // key is a spoof attempt — reject + surface warn.
                const existingKey = this.peerKeys.get(peerId);
                if (existingKey && existingKey.thumbprint !== thumbprint) {
                    if (typeof this.onSpoofCb === 'function') {
                        this.onSpoofCb({ peerId, declared: nick, actual: this.peerFirstNick.get(peerId) || '?' });
                    }
                    return;
                }

                this.peerKeys.set(peerId, { jwk: info.pub, thumbprint });
                const prev = this.peerNicks.get(peerId);
                this.peerNicks.set(peerId, {
                    nick,
                    color: tavernIdentityColor(thumbprint),
                    joinedAt: prev?.joinedAt || Date.now()
                });
                if (!this.peerFirstNick.has(peerId)) {
                    this.peerFirstNick.set(peerId, nick);
                }
            } else {
                // Leave: verify signature if we have the key already.
                const keyInfo = this.peerKeys.get(peerId);
                if (keyInfo) {
                    const payload = { type: 'leave', nick, color, ts: info.ts };
                    const ok = await this._verify(keyInfo.jwk, payload, info.sig);
                    if (!ok) return;
                }
                this.peerNicks.delete(peerId);
                this.peerFirstNick.delete(peerId);
                this.peerLastMsgTs.delete(peerId);
                this.peerKeys.delete(peerId);
            }
            if (typeof this.onPresenceCb === 'function') {
                const keyInfo = this.peerKeys.get(peerId);
                const displayColor = keyInfo ? tavernIdentityColor(keyInfo.thumbprint) : color;
                this.onPresenceCb({ type, nick, color: displayColor, peerId, ts: info.ts });
            }
        });
        this.room.onPeerJoin(async (peerId) => {
            this.peerCount++;
            // Re-announce ourselves (signed) so the new peer learns who we are.
            try {
                const ts = Date.now();
                const payload = { type: 'join', nick: this.nick, color: this.color, ts, pub: this.pubKeyJwk };
                const sig = await this._sign(payload);
                this.sendPresence({ ...payload, sig }, peerId);
            } catch (_) {}
            if (typeof this.onPeerJoinCb === 'function') this.onPeerJoinCb(peerId, this.peerCount);
        });
        this.room.onPeerLeave((peerId) => {
            this.peerCount = Math.max(0, this.peerCount - 1);
            const info = this.peerNicks.get(peerId);
            this.peerNicks.delete(peerId);
            if (typeof this.onPeerLeaveCb === 'function') this.onPeerLeaveCb(peerId, this.peerCount, info);
        });
    }

    async init() {
        await this.loadProfile();
        await this._connect();
    }

    /** Broadcast a signed presence event so other peers can render the join/leave note. */
    async announcePresence(type) {
        if (!this.sendPresence) return;
        if (type === 'join') this.selfJoinedAt = Date.now();
        try {
            const ts = Date.now();
            const payload = type === 'join'
                ? { type: 'join', nick: this.nick, color: this.color, ts, pub: this.pubKeyJwk }
                : { type: 'leave', nick: this.nick, color: this.color, ts };
            const sig = await this._sign(payload);
            this.sendPresence({ ...payload, sig });
        } catch (_) {}
    }

    async send(text) {
        const trimmed = tavernSanitize(text, TAVERN_MAX_TEXT_LEN).trim();
        if (!trimmed) { console.debug('[tavern] send: empty'); return null; }
        if (!this.sendMsg) { console.warn('[tavern] send: not connected'); return null; }
        if (!this.privKey) { console.warn('[tavern] send: no privkey'); return null; }
        const payload = {
            text: trimmed,
            nick: this.nick,
            color: this.color,
            ts: Date.now(),
        };
        try {
            const sig = await this._sign(payload);
            this.sendMsg({ ...payload, sig });
            console.debug('[tavern] sent', { nick: this.nick, len: trimmed.length });
        } catch (e) {
            console.warn('[tavern] send failed', e);
            return null;
        }
        return { ...payload, self: true, verified: true };
    }

    onMessage(cb) { this.onMessageCb = cb; }
    onPeerJoin(cb) { this.onPeerJoinCb = cb; }
    onPeerLeave(cb) { this.onPeerLeaveCb = cb; }
    onPresence(cb) { this.onPresenceCb = cb; }
    onSpoof(cb) { this.onSpoofCb = cb; }

    /**
     * Snapshot of everyone in the room from this client's perspective.
     * Self is always included as the first entry; remote peers follow
     * (whose nicks are known from received presence broadcasts).
     */
    getPeers() {
        const list = [{
            peerId: 'self',
            nick: this.nick,
            color: this.color,
            joinedAt: this.selfJoinedAt || Date.now(),
            self: true,
        }];
        for (const [peerId, info] of this.peerNicks.entries()) {
            list.push({ peerId, nick: info.nick, color: info.color, joinedAt: info.joinedAt, self: false });
        }
        return list;
    }

    async destroy() {
        if (this.room) {
            try { await this.room.leave(); } catch (_) {}
        }
        this.room = null;
        this.isConnected = false;
        this.sendMsg = null;
        this.getMsg = null;
    }

    /** Leave Trystero without wiping crypto / state — user can later
     *  reconnect by calling reconnect(). */
    async disconnect() {
        if (this.room) {
            try { this.announcePresence('leave'); } catch (_) {}
            try { await this.room.leave(); } catch (_) {}
        }
        this.room = null;
        this.isConnected = false;
        this.sendMsg = null;
        this.getMsg = null;
        this.peerCount = 0;
        this.peerNicks = new Map();
        this.peerKeys = new Map();
        this.peerLastMsgTs = new Map();
        this.peerFirstNick = new Map();
    }

    async reconnect() {
        if (this.isConnected) return;
        await this._connect();
        this.announcePresence('join');
    }
}
