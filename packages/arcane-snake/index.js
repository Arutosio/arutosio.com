export default {
    async mount(root, ctx) {
        root.innerHTML = `
            <div class="wrap">
                <h1>🐍 ARCANE SNAKE</h1>
                <div class="scores">
                    <span>Score: <strong id="score">0</strong></span>
                    <span>Best: <strong id="best">0</strong></span>
                </div>
                <div class="board-wrap"><canvas id="game"></canvas></div>
                <div class="controls">
                    <button id="btn-start">▶ Start</button>
                    <button id="btn-pause">⏸ Pause</button>
                    <button id="btn-reset">↻ Reset</button>
                </div>
                <div class="dpad">
                    <button class="up"    data-dir="up">▲</button>
                    <button class="left"  data-dir="left">◀</button>
                    <button class="right" data-dir="right">▶</button>
                    <button class="down"  data-dir="down">▼</button>
                </div>
                <div class="hint">Arrow keys / WASD / D-pad</div>
            </div>
        `;

        const canvas = root.querySelector('#game');
        const boardWrap = root.querySelector('.board-wrap');
        const g = canvas.getContext('2d');
        const scoreEl = root.querySelector('#score');
        const bestEl  = root.querySelector('#best');

        const GRID = 20;
        let CELL = 16;

        function fitCanvas() {
            const rect = boardWrap.getBoundingClientRect();
            const size = Math.max(120, Math.floor(Math.min(rect.width, rect.height)));
            const snapped = Math.floor(size / GRID) * GRID;
            canvas.width = snapped;
            canvas.height = snapped;
            canvas.style.width = snapped + 'px';
            canvas.style.height = snapped + 'px';
            CELL = snapped / GRID;
            draw();
        }

        const ro = new ResizeObserver(fitCanvas);
        ro.observe(boardWrap);
        window.addEventListener('resize', fitCanvas);

        let snake, dir, nextDir, food, score, best, tickMs, last, running, paused;

        best = Number(await ctx.storage.get('best')) || 0;
        bestEl.textContent = best;

        function reset() {
            snake = [{ x: 10, y: 10 }];
            dir = { x: 1, y: 0 };
            nextDir = dir;
            score = 0;
            tickMs = 130;
            last = 0;
            running = false;
            paused = false;
            spawnFood();
            scoreEl.textContent = score;
            draw();
        }

        function spawnFood() {
            while (true) {
                const f = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
                if (!snake.some(s => s.x === f.x && s.y === f.y)) { food = f; return; }
            }
        }

        function step() {
            dir = nextDir;
            const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
            if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID) return gameOver();
            if (snake.some(s => s.x === head.x && s.y === head.y)) return gameOver();
            snake.unshift(head);
            if (head.x === food.x && head.y === food.y) {
                score++;
                scoreEl.textContent = score;
                if (tickMs > 60) tickMs -= 2;
                spawnFood();
            } else {
                snake.pop();
            }
        }

        async function gameOver() {
            running = false;
            if (score > best) {
                best = score;
                bestEl.textContent = best;
                await ctx.storage.set('best', best);
                await ctx.toast('🏆 New best: ' + best, 'success');
            } else {
                await ctx.toast('💀 Game Over — score ' + score, 'warning');
            }
        }

        function draw() {
            if (!snake || !food) return;
            g.fillStyle = '#05030e';
            g.fillRect(0, 0, canvas.width, canvas.height);
            // grid glimmer
            g.strokeStyle = 'rgba(167, 139, 250, 0.06)';
            for (let i = 1; i < GRID; i++) {
                g.beginPath(); g.moveTo(i * CELL, 0); g.lineTo(i * CELL, canvas.height); g.stroke();
                g.beginPath(); g.moveTo(0, i * CELL); g.lineTo(canvas.width, i * CELL); g.stroke();
            }
            // food
            g.fillStyle = '#fb7185';
            g.shadowColor = '#fb7185';
            g.shadowBlur = 12;
            g.beginPath();
            g.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 1, 0, Math.PI * 2);
            g.fill();
            g.shadowBlur = 0;
            // snake
            snake.forEach((s, i) => {
                const t = i / snake.length;
                g.fillStyle = i === 0 ? '#ffc857' : `rgba(167, 139, 250, ${1 - t * 0.6})`;
                g.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
            });
            // pause overlay
            if (paused) {
                g.fillStyle = 'rgba(0, 0, 0, 0.6)';
                g.fillRect(0, 0, canvas.width, canvas.height);
                g.fillStyle = '#ffc857';
                g.font = 'bold 24px Cinzel, serif';
                g.textAlign = 'center';
                g.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
            }
        }

        function loop(ts) {
            if (!running) return;
            if (!paused) {
                if (ts - last >= tickMs) { step(); last = ts; }
            }
            draw();
            requestAnimationFrame(loop);
        }

        function setDir(d) {
            const map = {
                up:    { x: 0, y: -1 },
                down:  { x: 0, y:  1 },
                left:  { x: -1, y: 0 },
                right: { x: 1, y:  0 },
            };
            const nd = map[d];
            if (!nd) return;
            if (nd.x === -dir.x && nd.y === -dir.y) return;
            nextDir = nd;
        }

        function onKey(e) {
            const k = e.key;
            if (k === 'ArrowUp'    || k === 'w' || k === 'W') setDir('up');
            else if (k === 'ArrowDown'  || k === 's' || k === 'S') setDir('down');
            else if (k === 'ArrowLeft'  || k === 'a' || k === 'A') setDir('left');
            else if (k === 'ArrowRight' || k === 'd' || k === 'D') setDir('right');
            else if (k === ' ') togglePause();
            else return;
            e.preventDefault();
        }
        window.addEventListener('keydown', onKey);

        root.querySelectorAll('.dpad button').forEach(b => {
            b.addEventListener('click', () => setDir(b.dataset.dir));
        });

        // Swipe on canvas
        let sx = 0, sy = 0;
        canvas.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
        canvas.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - sx;
            const dy = e.changedTouches[0].clientY - sy;
            if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
            if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 'right' : 'left');
            else setDir(dy > 0 ? 'down' : 'up');
        }, { passive: true });

        function togglePause() {
            if (!running) return;
            paused = !paused;
            draw();
        }

        root.querySelector('#btn-start').addEventListener('click', () => {
            if (running) return;
            reset();
            running = true;
            last = performance.now();
            requestAnimationFrame(loop);
        });
        root.querySelector('#btn-pause').addEventListener('click', togglePause);
        root.querySelector('#btn-reset').addEventListener('click', reset);

        fitCanvas();
        reset();
    },
    unmount() {
        // window.removeEventListener handled at iframe teardown
    }
};
