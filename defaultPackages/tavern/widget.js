// Tavern widget — compact chat pinned on the desktop.
// Auto-joins on mount (widget = always-on by design). Sets a heartbeat
// flag in ctx.storage so the full app knows whether to suppress the
// "left the tavern" broadcast on close: if the widget is alive, the
// user is still listening — no leave message is sent.

const TAVERN_WIDGET_ALIVE_KEY = '_widgetAlive';
const TAVERN_WIDGET_HEARTBEAT_MS = 8000;

export default {
    async mount(root, ctx) {
        root.innerHTML = `
            <div class="tavern-widget">
                <div class="tavern-widget-status" data-status>connecting…</div>
                <ul class="tavern-widget-log" data-log></ul>
                <div class="tavern-widget-compose" data-compose>
                    <input type="text" data-input maxlength="500" placeholder="Speak…" autocomplete="off">
                </div>
            </div>
        `;
        const $status = root.querySelector('[data-status]');
        const $log = root.querySelector('[data-log]');
        const $form = root.querySelector('[data-compose]');
        const $input = root.querySelector('[data-input]');

        const chat = new TavernChat(ctx);

        function append(msg) {
            const li = document.createElement('li');
            li.className = 'tavern-widget-msg' + (msg.self ? ' is-self' : '');
            li.innerHTML = `<span class="tavern-widget-nick" style="color:${tavernEscapeHtml(msg.color)};">${tavernEscapeHtml(msg.nick)}</span><span class="tavern-widget-text"></span>`;
            li.querySelector('.tavern-widget-text').textContent = msg.text;
            $log.appendChild(li);
            $log.scrollTop = $log.scrollHeight;
            // Mini view keeps only the last ~20 entries.
            while ($log.children.length > 20) $log.removeChild($log.firstChild);
        }

        function appendSystem(text) {
            const li = document.createElement('li');
            li.className = 'tavern-widget-system';
            li.textContent = text;
            $log.appendChild(li);
            $log.scrollTop = $log.scrollHeight;
            while ($log.children.length > 20) $log.removeChild($log.firstChild);
        }

        function refreshStatus() {
            $status.textContent = chat.roomName + ' · ' + (chat.peerCount === 0 ? 'no one' : chat.peerCount + ' nearby');
        }

        // Heartbeat: stamps a recent timestamp so the full app can tell the
        // widget is still alive (and suppress the "left" broadcast on close).
        async function heartbeat() {
            try { await ctx.storage.set(TAVERN_WIDGET_ALIVE_KEY, Date.now()); } catch (_) {}
        }
        await heartbeat();
        const hbTimer = setInterval(heartbeat, TAVERN_WIDGET_HEARTBEAT_MS);

        try {
            await chat.init();
        } catch (e) {
            $status.textContent = 'offline';
            return;
        }
        refreshStatus();

        chat.onMessage(append);
        chat.onPeerJoin(refreshStatus);
        chat.onPeerLeave((id, count, info) => {
            refreshStatus();
            if (info?.nick) appendSystem(info.nick + ' left');
        });
        chat.onPresence(({ type, nick }) => {
            if (type === 'join') appendSystem(nick + ' joined');
            else                 appendSystem(nick + ' left');
            refreshStatus();
        });
        chat.announcePresence('join');

        async function commitSend() {
            const text = $input.value;
            const sent = await chat.send(text);
            if (sent) { append(sent); $input.value = ''; }
        }
        $input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitSend();
            }
        });

        return {
            async unmount() {
                clearInterval(hbTimer);
                try { await ctx.storage.set(TAVERN_WIDGET_ALIVE_KEY, 0); } catch (_) {}
                chat.announcePresence('leave');
                await chat.destroy();
            }
        };
    },
};
