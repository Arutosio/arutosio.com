// Parse duration: "30" = 30s, "5m" = 5 minutes, "2h" = 2 hours
function parseDuration(s) {
    const m = /^(\d+)\s*([smh]?)$/i.exec(s);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const unit = (m[2] || 's').toLowerCase();
    return n * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1);
}

function fmt(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + sec + 's';
    return sec + 's';
}

export default {
    async run(args, ctx) {
        const dur = parseDuration(args[0] || '');
        if (!dur || dur < 1 || dur > 24 * 3600) {
            await ctx.print('usage: timer <n>[s|m|h] [message]  (max 24h)'); return;
        }
        const msg = args.slice(1).join(' ') || 'Timer done';
        await ctx.print('⏳ timer started: ' + fmt(dur) + (args.slice(1).length ? ' — ' + msg : ''));
        setTimeout(async () => {
            await ctx.toast('⏳ ' + msg, 'success');
            // also try to print if terminal still reachable
            try { await ctx.print('⏳ ' + msg); } catch {}
        }, dur * 1000);
    }
};
