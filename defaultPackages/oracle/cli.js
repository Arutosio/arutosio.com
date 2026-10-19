const QUOTES = [
    ['The only way to do great work is to love what you do.', 'Steve Jobs'],
    ['Any sufficiently advanced technology is indistinguishable from magic.', 'Arthur C. Clarke'],
    ['Wizards and programmers both wield words of power.', '—'],
    ['There are only two hard things in Computer Science: cache invalidation and naming things.', 'Phil Karlton'],
    ['Not all those who wander are lost.', 'J.R.R. Tolkien'],
    ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
    ['The function of good software is to make the complex appear to be simple.', 'Grady Booch'],
    ['Code is read much more often than it is written.', 'Guido van Rossum'],
    ['It is our choices that show what we truly are, far more than our abilities.', 'J.K. Rowling'],
    ['Do or do not. There is no try.', 'Yoda'],
    ['Everything should be made as simple as possible, but no simpler.', 'Albert Einstein'],
    ['The journey of a thousand miles begins with a single step.', 'Lao Tzu'],
    ['First, solve the problem. Then, write the code.', 'John Johnson'],
    ['Magic is just science we don\u2019t understand yet.', 'Arthur C. Clarke'],
    ['The best error message is the one that never shows up.', 'Thomas Fuchs'],
    ['Talk is cheap. Show me the code.', 'Linus Torvalds'],
    ['Real magic can never be made by offering someone else\u2019s liver.', 'Terry Pratchett'],
    ['Programs must be written for people to read, and only incidentally for machines to execute.', 'Harold Abelson'],
    ['A wizard is never late, nor is he early. He arrives precisely when he means to.', 'Gandalf'],
    ['Make it work, make it right, make it fast.', 'Kent Beck'],
    ['The future is already here — it\u2019s just not evenly distributed.', 'William Gibson'],
];

export default {
    async run(args, ctx) {
        const [q, author] = QUOTES[Math.floor(Math.random() * QUOTES.length)];
        await ctx.print('');
        await ctx.print('  ✦ ' + q);
        await ctx.print('      — ' + author);
        await ctx.print('');
    }
};
