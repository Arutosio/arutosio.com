function parse(spec) {
    const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(spec.trim());
    if (!m) return null;
    return { n: parseInt(m[1] || '1', 10), s: parseInt(m[2], 10), mod: parseInt(m[3] || '0', 10) };
}

function roll(p) {
    const rolls = [];
    for (let i = 0; i < p.n; i++) rolls.push(1 + Math.floor(Math.random() * p.s));
    const total = rolls.reduce((a, b) => a + b, 0) + p.mod;
    const crit = p.n === 1 && p.s === 20 && rolls[0] === 20;
    const fumble = p.n === 1 && p.s === 20 && rolls[0] === 1;
    return { rolls, total, crit, fumble };
}

function fmt(p) {
    return p.n + 'd' + p.s + (p.mod ? (p.mod > 0 ? '+' + p.mod : p.mod) : '');
}

const QUICK = [4, 6, 8, 10, 12, 20, 100];
const HISTORY_MAX = 50;

export default {
    async mount(root, ctx) {
        root.innerHTML = `
            <div class="wrap">
                <h1>🎲 DICE ROLLER</h1>
                <div class="quick">
                    ${QUICK.map(s => `<button data-spec="1d${s}">d${s}</button>`).join('')}
                </div>
                <form class="custom">
                    <input type="text" placeholder="e.g. 2d6+3" value="1d20" />
                    <button type="submit">Roll</button>
                </form>
                <div class="display">
                    <div class="spec">—</div>
                    <div class="total">—</div>
                    <div class="rolls"></div>
                    <div class="tag"></div>
                </div>
                <h2>History</h2>
                <ul class="history"></ul>
                <button class="clear-btn" type="button">Clear history</button>
            </div>
        `;

        const display = root.querySelector('.display');
        const specEl  = display.querySelector('.spec');
        const totalEl = display.querySelector('.total');
        const rollsEl = display.querySelector('.rolls');
        const tagEl   = display.querySelector('.tag');
        const histEl  = root.querySelector('.history');
        const input   = root.querySelector('.custom input');

        let history = (await ctx.storage.get('history')) || [];
        renderHistory();

        function renderHistory() {
            histEl.innerHTML = history.map(h =>
                `<li><span class="spec">${h.spec}</span><span class="total">${h.total}</span></li>`
            ).join('');
        }

        async function doRoll(specStr) {
            const p = parse(specStr);
            if (!p) { tagEl.textContent = 'invalid'; tagEl.style.color = '#fb7185'; return; }
            if (p.n < 1 || p.n > 100 || p.s < 2 || p.s > 1000) {
                tagEl.textContent = 'out of range'; tagEl.style.color = '#fb7185'; return;
            }
            const r = roll(p);
            const spec = fmt(p);
            specEl.textContent = spec;
            totalEl.textContent = r.total;
            rollsEl.textContent = p.n > 1 ? '[' + r.rolls.join(', ') + ']' : '';
            display.classList.remove('rolling', 'crit', 'fumble');
            void display.offsetWidth; // restart animation
            display.classList.add('rolling');
            if (r.crit)   { display.classList.add('crit');   tagEl.textContent = '✨ CRITICAL ✨'; tagEl.style.color = '#34d399'; }
            else if (r.fumble) { display.classList.add('fumble'); tagEl.textContent = '💀 FUMBLE 💀';  tagEl.style.color = '#fb7185'; }
            else { tagEl.textContent = ''; }

            history.unshift({ spec, total: r.total, at: Date.now() });
            if (history.length > HISTORY_MAX) history = history.slice(0, HISTORY_MAX);
            renderHistory();
            await ctx.storage.set('history', history);
        }

        root.querySelectorAll('.quick button').forEach(b => {
            b.addEventListener('click', () => doRoll(b.dataset.spec));
        });

        root.querySelector('.custom').addEventListener('submit', (e) => {
            e.preventDefault();
            doRoll(input.value);
        });

        root.querySelector('.clear-btn').addEventListener('click', async () => {
            history = [];
            renderHistory();
            await ctx.storage.set('history', history);
        });
    }
};
