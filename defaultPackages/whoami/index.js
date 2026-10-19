function platform() {
    const ua = navigator.userAgent;
    if (ua.includes('Win')) return 'Windows';
    if (ua.includes('Mac')) return 'macOS';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    if (ua.includes('Linux')) return 'Linux';
    return 'Unknown';
}

export default {
    async run(args, ctx) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const lang = navigator.language;
        const cores = navigator.hardwareConcurrency || '?';
        const mem = navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'unknown';

        await ctx.print('🧙  Who art thou, wanderer?');
        await ctx.print('');
        await ctx.print('  platform   ' + platform());
        await ctx.print('  locale     ' + lang);
        await ctx.print('  timezone   ' + tz);
        await ctx.print('  cores      ' + cores);
        await ctx.print('  memory     ' + mem);
        await ctx.print('  viewport   ' + window.innerWidth + '×' + window.innerHeight);
        await ctx.print('  online     ' + (navigator.onLine ? 'yes' : 'no'));
        try {
            const r = await ctx.fetch('https://ipapi.co/json/');
            const d = await r.json();
            await ctx.print('  ip         ' + (d.ip || '?'));
            await ctx.print('  location   ' + [d.city, d.region, d.country_name].filter(Boolean).join(', '));
            await ctx.print('  isp        ' + (d.org || '?'));
        } catch (e) {
            await ctx.print('  (network info unavailable: ' + (e.message || e) + ')');
        }
    }
};
