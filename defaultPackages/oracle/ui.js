const FALLBACK = [
    { q: 'Any sufficiently advanced technology is indistinguishable from magic.', a: 'Arthur C. Clarke' },
    { q: 'Not all those who wander are lost.', a: 'J.R.R. Tolkien' },
    { q: 'The future is already here — it\u2019s just not evenly distributed.', a: 'William Gibson' },
    { q: 'Simplicity is the ultimate sophistication.', a: 'Leonardo da Vinci' },
];

export default {
    async mount(root, ctx) {
        root.innerHTML = `
            <div class="wrap">
                <div class="orb"></div>
                <blockquote class="q">The orb awakens…</blockquote>
                <div class="author">—</div>
                <button class="draw">✦ Consult the Oracle ✦</button>
                <div class="err" style="display:none;"></div>
            </div>
        `;
        const qEl = root.querySelector('.q');
        const aEl = root.querySelector('.author');
        const errEl = root.querySelector('.err');
        const btn = root.querySelector('.draw');

        async function draw() {
            qEl.classList.add('loading');
            errEl.style.display = 'none';
            btn.disabled = true;
            try {
                const r = await ctx.fetch('https://dummyjson.com/quotes/random');
                const d = await r.json();
                qEl.textContent = '"' + d.quote + '"';
                aEl.textContent = '— ' + d.author;
            } catch (e) {
                // Fallback: permission denied, offline, or API down
                const pick = FALLBACK[Math.floor(Math.random() * FALLBACK.length)];
                qEl.textContent = '"' + pick.q + '"';
                aEl.textContent = '— ' + pick.a;
                errEl.textContent = 'offline mode';
                errEl.style.display = 'block';
            } finally {
                qEl.classList.remove('loading');
                btn.disabled = false;
            }
        }

        btn.addEventListener('click', draw);
        draw();
    }
};
