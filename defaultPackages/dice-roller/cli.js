// Dice notation parser: NdS[+M|-M], e.g. "2d6", "1d20+5", "4d8-2"
function parse(spec) {
    const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(spec.trim());
    if (!m) return null;
    return { n: parseInt(m[1] || '1', 10), s: parseInt(m[2], 10), mod: parseInt(m[3] || '0', 10) };
}

export default {
    async run(args, ctx) {
        const spec = args[0] || '1d20';
        const p = parse(spec);
        if (!p) { await ctx.print('usage: roll <NdS[+M]>  (e.g. 2d6, 1d20+5)'); return; }
        if (p.n < 1 || p.n > 100 || p.s < 2 || p.s > 1000) {
            await ctx.print('out of range: n in [1..100], sides in [2..1000]'); return;
        }
        const rolls = [];
        for (let i = 0; i < p.n; i++) rolls.push(1 + Math.floor(Math.random() * p.s));
        const sum = rolls.reduce((a, b) => a + b, 0) + p.mod;
        const modStr = p.mod ? (p.mod > 0 ? '+' + p.mod : p.mod) : '';
        const rollsStr = p.n > 1 ? ' [' + rolls.join(', ') + ']' : '';
        const crit = p.n === 1 && p.s === 20 && rolls[0] === 20 ? ' ✨ CRIT!' : '';
        const fumble = p.n === 1 && p.s === 20 && rolls[0] === 1 ? ' 💀 FUMBLE' : '';
        await ctx.print(`🎲 ${p.n}d${p.s}${modStr} → ${sum}${rollsStr}${crit}${fumble}`);
    }
};
