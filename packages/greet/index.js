export default {
    async run(args, ctx) {
        const name = args[0] || 'wanderer';
        const line = '═'.repeat(name.length + 16);
        await ctx.print(line);
        await ctx.print('  ✦ Greetings, ' + name + '! ✦');
        await ctx.print(line);
        await ctx.print('');
        await ctx.print('The arcane terminal salutes you.');
        await ctx.print('Invocation timestamp: ' + new Date().toISOString());
        await ctx.toast('Greeted ' + name, 'success');
    }
};
