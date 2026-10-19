export default {
    async run(args, ctx) {
        if (args.length === 0) {
            const s = await ctx.clipboard.read();
            if (s == null) return; // denied or empty
            await ctx.print('📋 clipboard: ' + s);
            return;
        }
        const text = args.join(' ');
        const ok = await ctx.clipboard.write(text);
        if (ok) await ctx.print('📋 copied: ' + (text.length > 60 ? text.slice(0, 60) + '…' : text));
    }
};
