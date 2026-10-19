// Tavern — full app UI. Adventurer's chat by the firelight.
// Anonymous P2P chat via Trystero (BitTorrent trackers, no backend).
//
// Multi-room: the user can stay connected to several rooms at once.
// Each connected room has its own TavernChat instance inside `chats`.
// Clicking a row only switches what's displayed; clicking the dot is
// the sole gesture that opens/closes a connection.

const TAVERN_WIDGET_ALIVE_KEY = '_widgetAlive';
const TAVERN_WIDGET_FRESH_MS = 20000;
const TAVERN_STRATEGY_KEY_UI = 'strategy';
const TAVERN_PASSWORD_KEY_UI = 'password';
const TAVERN_SHOW_SYS_KEY    = 'showSystemMsgs';
const TAVERN_SIDE_KEY_UI     = 'sidebarSide';

export default {
    async mount(root, ctx) {
        root.innerHTML = `
            <div class="tavern-app" data-side="left">
                <section class="tavern-setup" data-setup>
                    <p class="tavern-setup-blurb">
                        An anonymous, peer-to-peer common room. No accounts, no servers — just travelers.
                        Pick a name and a room before pushing through the door.
                    </p>
                    <label class="tavern-field">
                        <span>Nickname</span>
                        <input type="text" data-nick maxlength="32" placeholder="WanderingMage123">
                    </label>
                    <label class="tavern-field">
                        <span>Room</span>
                        <input type="text" data-room maxlength="64" placeholder="public">
                    </label>
                    <label class="tavern-field">
                        <span>Password (optional)</span>
                        <input type="password" data-password maxlength="128" placeholder="leave empty for a public room">
                        <small class="tavern-field-hint">Only peers using the exact same password land in the same swarm. Anyone without it sees a different "public" room.</small>
                    </label>
                    <input type="hidden" data-strategy value="torrent">
                    <div class="tavern-setup-warning">
                        ⚠ Tavern is peer-to-peer. Your public IP is visible to everyone connected. Avoid sharing sensitive info.
                    </div>
                    <button type="button" class="tavern-join-btn" data-join>Enter the tavern</button>
                </section>

                <div class="tavern-main" data-main style="display:none;">
                    <aside class="tavern-sidebar" data-sidebar>
                        <div class="tavern-side-head">
                            <span class="tavern-side-title">Rooms</span>
                            <button type="button" class="tavern-side-prefs" data-prefs title="Preferences">⚙</button>
                        </div>
                        <ul class="tavern-room-list" data-rooms></ul>
                        <div class="tavern-add-room" data-add>
                            <div class="tavern-add-row">
                                <input type="text" data-add-input maxlength="64" placeholder="+ add room">
                                <button type="button" class="tavern-add-btn" data-add-btn title="Add room">+</button>
                            </div>
                            <input type="password" data-add-pwd maxlength="128" placeholder="password (optional)" class="tavern-add-pwd">
                        </div>
                        <div class="tavern-side-foot">
                            <label class="tavern-field tavern-field-compact">
                                <span>Nick</span>
                                <input type="text" data-nick-live maxlength="32">
                            </label>
                            <input type="hidden" data-strategy-live value="torrent">
                        </div>
                    </aside>

                    <section class="tavern-chat-pane">
                        <div class="tavern-room-banner" data-banner>
                            <span class="tavern-room-name" data-room-name>#</span>
                            <span class="tavern-status" data-status>not connected</span>
                        </div>
                        <ul class="tavern-log" data-log></ul>
                        <div class="tavern-compose" data-compose>
                            <input type="text" data-input maxlength="1000" placeholder="Speak your piece…" autocomplete="off">
                            <button type="button" data-send>Send</button>
                        </div>
                    </section>
                </div>
            </div>
        `;

        const $app = root.querySelector('.tavern-app');
        const $status = root.querySelector('[data-status]');
        const $setup = root.querySelector('[data-setup]');
        const $main = root.querySelector('[data-main]');
        const $log = root.querySelector('[data-log]');
        const $input = root.querySelector('[data-input]');
        const $sendBtn = root.querySelector('[data-send]');
        const $nickSetup = root.querySelector('[data-nick]');
        const $roomSetup = root.querySelector('[data-room]');
        const $strategySetup = root.querySelector('[data-strategy]');
        const $passwordSetup = root.querySelector('[data-password]');
        const $joinBtn = root.querySelector('[data-join]');
        const $nickLive = root.querySelector('[data-nick-live]');
        const $roomsUl = root.querySelector('[data-rooms]');
        const $addInput = root.querySelector('[data-add-input]');
        const $addPwd = root.querySelector('[data-add-pwd]');
        const $addBtn = root.querySelector('[data-add-btn]');
        const $prefsBtn = root.querySelector('[data-prefs]');
        const $roomName = root.querySelector('[data-room-name]');

        // Shared identity (one per user): nick, keypair, passwords, side.
        // A throwaway TavernChat is spun up once to load + expose these —
        // it never connects, it's just the cheapest way to reuse the chat
        // crypto/profile loader. Connected rooms get their own instances.
        const identity = new TavernChat(ctx);
        await identity.loadProfile();

        // One TavernChat per connected room. Disconnecting tears the entry
        // down; reconnecting creates a fresh one. Identity is re-applied
        // from `identity` at create time.
        const chats = new Map();
        let rooms = [];
        let side = 'right';
        let showSystemMsgs = true;
        let started = false;
        let nickTimer = null;
        const offlineRooms = new Set();
        const roomLogs = new Map();
        let viewingRoom = '';

        rooms = await tavernLoadRooms(ctx);
        if (!rooms.includes(identity.roomName)) rooms.push(identity.roomName);
        side = await tavernLoadSide(ctx);
        $app.dataset.side = side;
        const storedSys = await ctx.storage.get(TAVERN_SHOW_SYS_KEY);
        showSystemMsgs = storedSys !== false;
        $nickSetup.value = identity.nick;
        $roomSetup.value = identity.roomName;
        $strategySetup.value = identity.strategy;
        $passwordSetup.value = identity.password || '';

        // Restore persisted chat history so closing and reopening the app
        // keeps prior messages visible even while every room is offline.
        const persistedLogs = await tavernLoadRoomLogs(ctx);
        for (const [name, html] of Object.entries(persistedLogs)) {
            roomLogs.set(name, html);
        }
        const hasEntered = await ctx.storage.get(TAVERN_ENTERED_KEY);

        function view() { return chats.get(viewingRoom); }

        function buildMsgHtml(msg) {
            const klass = 'tavern-msg'
                + (msg.self ? ' is-self' : '')
                + (msg.spoofed ? ' is-spoofed' : '')
                + (msg.verified ? ' is-verified' : '');
            const time = tavernFmtTime(msg.ts);
            const check = msg.verified ? '<span class="tavern-msg-check" title="Signature verified">✓</span>' : '';
            const li = document.createElement('li');
            li.className = klass;
            li.innerHTML = `<span class="tavern-msg-head">
                    <span class="tavern-nick" style="color:${tavernEscapeHtml(msg.color)};">${tavernEscapeHtml(msg.nick)}</span>
                    <time>${time}${check}</time>
                </span>
                <span class="tavern-msg-text"></span>`;
            li.querySelector('.tavern-msg-text').textContent = msg.text;
            return li;
        }
        function buildSystemHtml(text, kind) {
            const li = document.createElement('li');
            li.className = 'tavern-system is-' + (kind || 'info');
            li.textContent = text;
            return li;
        }
        function appendToRoom(roomName, node) {
            if (roomName === viewingRoom) {
                $log.appendChild(node);
                $log.scrollTop = $log.scrollHeight;
                while ($log.children.length > 200) $log.removeChild($log.firstChild);
            } else {
                const prev = roomLogs.get(roomName) || '';
                let next = prev + node.outerHTML;
                if (next.length > 200000) next = next.slice(next.length - 200000);
                roomLogs.set(roomName, next);
            }
            scheduleLogsSave();
        }

        // Debounced writer that flushes the per-room HTML snapshots to IDB.
        // Saving on every append would thrash the disk; the 2s window is
        // long enough to coalesce rapid-fire messages but short enough to
        // survive most tab crashes.
        let saveLogsTimer = null;
        async function flushLogsSave() {
            try {
                if (viewingRoom) roomLogs.set(viewingRoom, $log.innerHTML);
                const obj = {};
                for (const [k, v] of roomLogs) obj[k] = v;
                await tavernSaveRoomLogs(ctx, obj);
            } catch (_) {}
        }
        function scheduleLogsSave() {
            clearTimeout(saveLogsTimer);
            saveLogsTimer = setTimeout(flushLogsSave, 2000);
        }
        function appendSystem(text, kind, roomName) {
            if (!showSystemMsgs) return;
            appendToRoom(roomName || viewingRoom, buildSystemHtml(text, kind));
        }

        let statusTimers = [];
        function clearStatusTimers() { statusTimers.forEach(clearTimeout); statusTimers = []; }
        function setConnectingStatus() {
            clearStatusTimers();
            $status.textContent = 'connecting via ' + identity.strategy + '…';
            statusTimers.push(setTimeout(() => {
                const c = view();
                if (!c || c.peerCount === 0) $status.textContent = 'searching peers via ' + identity.strategy + '…';
            }, 3000));
            statusTimers.push(setTimeout(() => {
                const c = view();
                if (!c || c.peerCount === 0) $status.textContent = 'still alone — try another strategy';
            }, 15000));
        }

        function refreshStatus() {
            const c = view();
            if (!c) {
                $status.textContent = 'not connected';
            } else {
                const peers = c.peerCount;
                if (peers === 0) {
                    if ($status.textContent && $status.textContent.includes('fellow')) {
                        $status.textContent = 'alone in the tavern';
                    }
                } else {
                    clearStatusTimers();
                    $status.textContent = peers === 1 ? '1 fellow nearby' : peers + ' fellows nearby';
                }
            }
            renderRooms();
        }

        function renderRooms() {
            $roomsUl.innerHTML = '';
            for (const name of rooms) {
                const isActive = name === viewingRoom;
                const c = chats.get(name);
                const isLive = !!(c && c.isConnected);
                const hasPwd = !!(identity.roomPasswords && identity.roomPasswords[name]);
                const li = document.createElement('li');
                li.className = 'tavern-room'
                    + (isActive ? ' is-active' : '')
                    + (isLive ? ' is-live' : ' is-offline');
                li.dataset.room = name;
                const lock = hasPwd ? `<span class="tavern-room-lock" title="Password protected">🔒</span>` : '';
                const countBadge = isLive
                    ? `<button type="button" class="tavern-room-count" data-peers title="Show peers">${c.peerCount + 1}</button>`
                    : '';
                const isExplicitOff = offlineRooms.has(name);
                const dotClass = isLive ? ' is-on' : (isExplicitOff ? ' is-off' : '');
                const connLabel = isLive ? 'Disconnect' : 'Connect';
                const connBtn = `<button type="button" class="tavern-room-conn${dotClass}" data-conn title="${connLabel}" aria-label="${connLabel}"></button>`;
                li.innerHTML = `${lock}<span class="tavern-room-hash">#</span><span class="tavern-room-label"></span>${countBadge}${connBtn}<button type="button" class="tavern-room-x" title="Close">×</button>`;
                li.querySelector('.tavern-room-label').textContent = name;
                $roomsUl.appendChild(li);
            }
            const viewName = viewingRoom || identity.roomName;
            const viewChat = chats.get(viewName);
            const isViewingLive = !!(viewChat && viewChat.isConnected);
            const isViewingOff = offlineRooms.has(viewName);
            const dotClass = isViewingLive ? 'is-on' : (isViewingOff ? 'is-off' : '');
            $roomName.innerHTML = '# ' + tavernEscapeHtml(viewName) +
                ' <span class="tavern-banner-dot ' + dotClass + '" aria-hidden="true"></span>';
        }

        function fmtAgo(ts) {
            const sec = Math.max(1, Math.floor((Date.now() - Number(ts)) / 1000));
            if (sec < 60) return sec + 's';
            const min = Math.floor(sec / 60);
            if (min < 60) return min + 'm';
            const h = Math.floor(min / 60);
            return h + 'h ' + (min % 60) + 'm';
        }

        function closePeersPopover() {
            const existing = document.querySelector('.tavern-peers-popover');
            if (existing) existing.remove();
        }
        function showPeersPopover(anchor) {
            closePeersPopover();
            const c = view();
            if (!c) return;
            const peers = c.getPeers();
            const pop = document.createElement('div');
            pop.className = 'tavern-peers-popover';
            pop.innerHTML = `<div class="tavern-peers-head">In # ${tavernEscapeHtml(c.roomName)} (${peers.length})</div><ul class="tavern-peers-list"></ul>`;
            const ul = pop.querySelector('.tavern-peers-list');
            for (const p of peers) {
                const li = document.createElement('li');
                const blocked = c.isBlocked(p.peerId);
                li.className = 'tavern-peer' + (p.self ? ' is-self' : '') + (blocked ? ' is-blocked' : '');
                li.innerHTML = `<span class="tavern-peer-nick" style="color:${tavernEscapeHtml(p.color)};"></span><span class="tavern-peer-time"></span>` +
                    (p.self ? '' : `<button type="button" class="tavern-peer-block" data-peer="${tavernEscapeHtml(p.peerId)}" title="${blocked ? 'Unmute' : 'Mute'} this peer">${blocked ? '🔊' : '🔇'}</button>`);
                li.querySelector('.tavern-peer-nick').textContent = p.nick + (p.self ? ' (you)' : '');
                li.querySelector('.tavern-peer-time').textContent = fmtAgo(p.joinedAt) + ' ago';
                ul.appendChild(li);
            }
            ul.addEventListener('click', (e) => {
                const btn = e.target.closest('.tavern-peer-block');
                if (!btn) return;
                const pid = btn.dataset.peer;
                if (c.isBlocked(pid)) { c.unblockPeer(pid); appendSystem('Unmuted peer'); }
                else                   { c.blockPeer(pid);   appendSystem('Muted peer — their messages will no longer appear'); }
                showPeersPopover(anchor);
            });
            const r = anchor.getBoundingClientRect();
            pop.style.position = 'fixed';
            pop.style.left = Math.min(window.innerWidth - 220, r.left) + 'px';
            pop.style.top = (r.bottom + 6) + 'px';
            document.body.appendChild(pop);
            const offClick = (e) => {
                if (pop.contains(e.target) || anchor.contains(e.target)) return;
                closePeersPopover();
                document.removeEventListener('mousedown', offClick);
            };
            setTimeout(() => document.addEventListener('mousedown', offClick), 0);
        }

        async function widgetIsAlive() {
            try {
                const ts = await ctx.storage.get(TAVERN_WIDGET_ALIVE_KEY);
                return Number(ts) > 0 && (Date.now() - Number(ts)) < TAVERN_WIDGET_FRESH_MS;
            } catch { return false; }
        }

        /** Wire all event handlers for a freshly created TavernChat. */
        function wireChat(c) {
            c.onMessage(msg => appendToRoom(c.roomName, buildMsgHtml(msg)));
            c.onPeerJoin(() => refreshStatus());
            c.onPeerLeave((id, count, info) => {
                refreshStatus();
                if (info?.nick) appendSystem(info.nick + ' left the tavern', 'warning', c.roomName);
            });
            c.onPresence(({ type, nick }) => {
                if (type === 'join') appendSystem(nick + ' entered the tavern', 'success', c.roomName);
                else                 appendSystem(nick + ' left the tavern', 'warning', c.roomName);
                refreshStatus();
            });
            c.onSpoof(({ declared, actual }) => {
                appendSystem('⚠ A peer tried to impersonate "' + declared + '" (real nick: ' + actual + ')', 'error', c.roomName);
            });
        }

        async function connectRoom(name, pwd) {
            if (chats.has(name)) return chats.get(name);
            const c = new TavernChat(ctx);
            await c.loadProfile();
            // Honor any password provided explicitly for this add-room call.
            if (typeof pwd === 'string') {
                c.roomPasswords[name] = pwd;
                c.roomPasswords = await tavernSaveRoomPwds(ctx, c.roomPasswords);
                identity.roomPasswords = c.roomPasswords;
            }
            c.roomName = name;
            c.password = c.roomPasswords[name] || '';
            await c.ctx.storage.set('room', name);
            await c._connect();
            wireChat(c);
            c.announcePresence('join');
            chats.set(name, c);
            offlineRooms.delete(name);
            return c;
        }

        async function disconnectRoom(name) {
            const c = chats.get(name);
            if (!c) return;
            await c.destroy();
            chats.delete(name);
        }

        async function setNickEverywhere(newNick) {
            await identity.setNick(newNick);
            for (const c of chats.values()) await c.setNick(newNick);
        }

        async function removeRoom(name) {
            rooms = rooms.filter(r => r !== name);
            rooms = await tavernSaveRooms(ctx, rooms);
            // If the removed room was connected, tear it down.
            if (chats.has(name)) await disconnectRoom(name);
            offlineRooms.delete(name);
            roomLogs.delete(name);
            if (viewingRoom === name) {
                // Pick another viewable room or return to setup.
                const next = rooms[0];
                if (next) {
                    viewingRoom = next;
                    $log.innerHTML = roomLogs.get(next) || '';
                } else {
                    started = false;
                    $main.style.display = 'none';
                    $setup.style.display = '';
                    $status.textContent = 'not connected';
                    rooms = await tavernSaveRooms(ctx, []);
                }
            }
            renderRooms();
            refreshStatus();
        }

        async function doJoin() {
            await identity.setNick($nickSetup.value);
            identity.strategy = $strategySetup.value;
            await ctx.storage.set(TAVERN_STRATEGY_KEY_UI, identity.strategy);
            const firstRoom = tavernSanitize($roomSetup.value, 64).trim() || 'public';
            const pwd = String($passwordSetup.value || '');
            try {
                await connectRoom(firstRoom, pwd);
            } catch (e) {
                $status.textContent = 'connection failed';
                appendSystem('Could not reach the tavern: ' + (e.message || e), 'error', firstRoom);
                return;
            }
            started = true;
            await ctx.storage.set(TAVERN_ENTERED_KEY, true);
            setConnectingStatus();
            $setup.style.display = 'none';
            $main.style.display = '';
            $nickLive.value = identity.nick;
            if (!rooms.includes(firstRoom)) rooms.push(firstRoom);
            rooms = await tavernSaveRooms(ctx, rooms);
            viewingRoom = firstRoom;
            $log.innerHTML = roomLogs.get(firstRoom) || '';
            $log.scrollTop = $log.scrollHeight;
            renderRooms();
            refreshStatus();
            appendSystem('You entered "' + firstRoom + '" as ' + identity.nick, 'info', firstRoom);
        }
        $joinBtn.addEventListener('click', () => { doJoin(); });

        function switchView(name) {
            if (!name || name === viewingRoom) return;
            if (viewingRoom) roomLogs.set(viewingRoom, $log.innerHTML);
            viewingRoom = name;
            $log.innerHTML = roomLogs.get(name) || '';
            $log.scrollTop = $log.scrollHeight;
            renderRooms();
            refreshStatus();
        }

        const warnedEmpty = new Set();
        async function commitSend() {
            const text = $input.value;
            if (!text.trim()) return;
            const c = view();
            if (!c || !c.isConnected) {
                appendSystem('Not connected to this room. Click the dot to connect.', 'warning');
                return;
            }
            if (c.peerCount === 0 && !warnedEmpty.has(c.roomName)) {
                appendSystem('No one else is in this room yet — your message will only reach travelers who join afterwards.', 'warning', c.roomName);
                warnedEmpty.add(c.roomName);
            }
            if (c.peerCount > 0) warnedEmpty.delete(c.roomName);
            const sent = await c.send(text);
            if (sent) { appendToRoom(c.roomName, buildMsgHtml(sent)); $input.value = ''; }
        }
        $sendBtn.addEventListener('click', () => { commitSend(); });
        $input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitSend(); }
        });

        $nickLive.addEventListener('input', () => {
            clearTimeout(nickTimer);
            nickTimer = setTimeout(() => setNickEverywhere($nickLive.value), 400);
        });

        $roomsUl.addEventListener('click', async (e) => {
            const peers = e.target.closest('.tavern-room-count');
            if (peers) { e.stopPropagation(); showPeersPopover(peers); return; }
            const conn = e.target.closest('.tavern-room-conn');
            if (conn) {
                e.stopPropagation();
                const li = conn.closest('.tavern-room');
                if (!li) return;
                const name = li.dataset.room;
                const c = chats.get(name);
                if (c && c.isConnected) {
                    await disconnectRoom(name);
                    offlineRooms.add(name);
                    appendSystem('Disconnected from "' + name + '"', 'warning', name);
                    if (viewingRoom !== name) appendSystem('Disconnected from "' + name + '"', 'warning', viewingRoom);
                } else {
                    try {
                        await connectRoom(name);
                        appendSystem('Connected to "' + name + '"', 'success', name);
                        if (viewingRoom !== name) appendSystem('Connected to "' + name + '"', 'success', viewingRoom);
                    } catch (err) {
                        appendSystem('Could not connect: ' + (err.message || err), 'error', name);
                        if (viewingRoom !== name) appendSystem('Could not connect to "' + name + '": ' + (err.message || err), 'error', viewingRoom);
                    }
                }
                renderRooms();
                refreshStatus();
                return;
            }
            const x = e.target.closest('.tavern-room-x');
            if (x) {
                e.stopPropagation();
                const li = x.closest('.tavern-room');
                if (li) removeRoom(li.dataset.room);
                return;
            }
            const li = e.target.closest('.tavern-room');
            if (li) switchView(li.dataset.room);
        });

        async function commitAddRoom() {
            const name = ($addInput.value || '').trim().slice(0, 64);
            if (!name) return;
            const pwd = $addPwd ? ($addPwd.value || '') : '';
            $addInput.value = '';
            if ($addPwd) $addPwd.value = '';
            const wasNew = !rooms.includes(name);
            if (wasNew) {
                rooms.push(name);
                rooms = await tavernSaveRooms(ctx, rooms);
            }
            if ($addPwd) {
                identity.roomPasswords[name] = pwd;
                identity.roomPasswords = await tavernSaveRoomPwds(ctx, identity.roomPasswords);
            }
            try {
                await connectRoom(name, pwd);
                appendSystem('Connected to "' + name + '"', 'success', name);
                if (viewingRoom !== name) appendSystem('Connected to "' + name + '"', 'success', viewingRoom);
            } catch (err) {
                appendSystem('Could not connect: ' + (err.message || err), 'error', name);
            }
            switchView(name);
            renderRooms();
            refreshStatus();
        }
        $addBtn.addEventListener('click', () => { commitAddRoom(); });
        $addInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitAddRoom(); }
        });

        function closePrefsPopover() {
            const existing = document.querySelector('.tavern-prefs-popover');
            if (existing) existing.remove();
        }
        function openPrefsPopover() {
            closePrefsPopover();
            const pop = document.createElement('div');
            pop.className = 'tavern-prefs-popover';
            pop.innerHTML = `
                <div class="tavern-prefs-head">Preferences</div>
                <div class="tavern-prefs-section">
                    <label class="tavern-prefs-label">Sidebar side</label>
                    <div class="tavern-prefs-btn-group">
                        <button type="button" data-side-choice="left"${side === 'left' ? ' class="is-active"' : ''}>Left</button>
                        <button type="button" data-side-choice="right"${side === 'right' ? ' class="is-active"' : ''}>Right</button>
                    </div>
                </div>
                <div class="tavern-prefs-section">
                    <label class="tavern-prefs-label">Signaling strategy</label>
                    <div class="tavern-prefs-readonly">${tavernEscapeHtml(identity.strategy)} <small>(only option available)</small></div>
                </div>
                <div class="tavern-prefs-section">
                    <label class="tavern-prefs-row">
                        <span>Show activity messages</span>
                        <input type="checkbox" data-show-sys${showSystemMsgs ? ' checked' : ''}>
                    </label>
                    <small class="tavern-prefs-hint">Joins, leaves, warnings, moved rooms, etc.</small>
                </div>
                <div class="tavern-prefs-section">
                    <label class="tavern-prefs-label">Identity</label>
                    <div class="tavern-prefs-readonly">Nick: <strong>${tavernEscapeHtml(identity.nick)}</strong></div>
                    <div class="tavern-prefs-readonly">Key thumbprint: <code>${tavernEscapeHtml((identity.selfThumbprint || '').slice(0, 16))}…</code></div>
                </div>
                <div class="tavern-prefs-section">
                    <button type="button" class="tavern-prefs-close" data-close>Close</button>
                </div>
            `;
            const r = $prefsBtn.getBoundingClientRect();
            pop.style.position = 'fixed';
            pop.style.left = Math.min(window.innerWidth - 260, r.left) + 'px';
            pop.style.top = (r.bottom + 6) + 'px';
            document.body.appendChild(pop);
            pop.querySelectorAll('[data-side-choice]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const next = btn.dataset.sideChoice;
                    if (next === side) return;
                    side = next;
                    $app.dataset.side = side;
                    await tavernSaveSide(ctx, side);
                    pop.querySelectorAll('[data-side-choice]').forEach(b =>
                        b.classList.toggle('is-active', b.dataset.sideChoice === side));
                });
            });
            pop.querySelector('[data-show-sys]').addEventListener('change', async (e) => {
                showSystemMsgs = e.target.checked;
                await ctx.storage.set(TAVERN_SHOW_SYS_KEY, showSystemMsgs);
            });
            pop.querySelector('[data-close]').addEventListener('click', closePrefsPopover);
            const offClick = (e) => {
                if (pop.contains(e.target) || $prefsBtn.contains(e.target)) return;
                closePrefsPopover();
                document.removeEventListener('mousedown', offClick);
            };
            setTimeout(() => document.addEventListener('mousedown', offClick), 0);
        }
        $prefsBtn.addEventListener('click', () => {
            if (document.querySelector('.tavern-prefs-popover')) closePrefsPopover();
            else openPrefsPopover();
        });

        // Auto-enter main view on reopen: if the user has previously completed
        // setup (entered flag), skip the nick/password form and show the room
        // list with every room offline. Closing the app tears every connection
        // down (manifest.unmountOnClose + unmount below), so reopening leaves
        // the list intact but fully disconnected — the user clicks the status
        // dot on any row to reconnect. Prior chat history is restored from IDB.
        if (hasEntered && rooms.length > 0) {
            started = true;
            $setup.style.display = 'none';
            $main.style.display = '';
            $nickLive.value = identity.nick;
            viewingRoom = rooms.includes(identity.roomName) ? identity.roomName : rooms[0];
            $log.innerHTML = roomLogs.get(viewingRoom) || '';
            $log.scrollTop = $log.scrollHeight;
            renderRooms();
            refreshStatus();
        }

        return {
            async unmount() {
                clearTimeout(nickTimer);
                clearTimeout(saveLogsTimer);
                clearStatusTimers();
                // Always persist chat history, even if the user never clicked
                // "Enter" — they may have been browsing restored logs offline.
                await flushLogsSave();
                if (!started) return;
                // Tear down every live connection. If the widget heartbeat
                // is fresh we suppress the leave broadcast — user is still
                // listening through the pinned widget.
                const widgetUp = await widgetIsAlive();
                for (const c of chats.values()) {
                    if (!widgetUp) {
                        try { c.announcePresence('leave'); } catch (_) {}
                    }
                    try { await c.destroy(); } catch (_) {}
                }
                chats.clear();
            }
        };
    },
};
