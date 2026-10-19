export default {
    async run(args, ctx) {
        const city = args.join(' ').trim();
        if (!city) { await ctx.print('usage: weather <city>'); return; }
        const url = 'https://wttr.in/' + encodeURIComponent(city) + '?format=%l:+%c+%t+(feels+%f)+%w+%h&m';
        await ctx.print('⛅ consulting wttr.in…');
        try {
            const r = await ctx.fetch(url);
            const text = (await r.text()).trim();
            if (!text || text.startsWith('Unknown')) { await ctx.print('city not found: ' + city); return; }
            await ctx.print('  ' + text);
        } catch (e) {
            await ctx.print('error: ' + (e.message || e));
        }
    }
};
