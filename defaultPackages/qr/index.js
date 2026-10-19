// QR generation in ASCII is non-trivial without a dedicated library.
// Instead this command fetches a pre-rendered QR from a public API
// and surfaces the URL + opens it in a new tab so the user can scan.
export default {
    async run(args, ctx) {
        const text = args.join(' ').trim();
        if (!text) { await ctx.print('usage: qr <text>'); return; }
        if (text.length > 900) { await ctx.print('text too long (max 900 chars)'); return; }
        const url = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(text);
        await ctx.print('▣  QR for: ' + text);
        await ctx.print('   ' + url);
        // commands run in main thread, not in sandbox — window.open is available
        try { window.open(url, '_blank', 'noopener'); } catch {}
    }
};
