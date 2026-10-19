// Latin → Elder Futhark transliteration (24-rune set)
const MULTI = [
    ['th', 'ᚦ'], ['ng', 'ᛜ'], ['ei', 'ᛇ'], ['sh', 'ᛊ'], ['ch', 'ᚲ'], ['ph', 'ᚠ'], ['qu', 'ᚲᚹ'],
];
const SINGLE = {
    a: 'ᚨ', b: 'ᛒ', c: 'ᚲ', d: 'ᛞ', e: 'ᛖ', f: 'ᚠ', g: 'ᚷ', h: 'ᚺ',
    i: 'ᛁ', j: 'ᛃ', k: 'ᚲ', l: 'ᛚ', m: 'ᛗ', n: 'ᚾ', o: 'ᛟ', p: 'ᛈ',
    q: 'ᚲ', r: 'ᚱ', s: 'ᛊ', t: 'ᛏ', u: 'ᚢ', v: 'ᚹ', w: 'ᚹ', x: 'ᚲᛊ',
    y: 'ᛃ', z: 'ᛉ',
};

function transliterate(text) {
    let s = text.toLowerCase();
    for (const [from, to] of MULTI) s = s.split(from).join(to);
    let out = '';
    for (const ch of s) out += (SINGLE[ch] || ch);
    return out;
}

export default {
    async run(args, ctx) {
        if (!args.length) { await ctx.print('usage: rune <text>'); return; }
        const text = args.join(' ');
        await ctx.print(transliterate(text));
    }
};
