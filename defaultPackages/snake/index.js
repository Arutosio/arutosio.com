// Snake — grid adapts to window, snake wraps around edges.

const CELL = 20;           // px per cell — grid recomputed from canvas size
const TICK_MS = 110;       // snake speed (ms per step)
const MIN_COLS = 10;
const MIN_ROWS = 10;

function mod(a, b) { return ((a % b) + b) % b; }

export default {
    async mount(root, ctx) {
        root.innerHTML = `
            <div class="wrap">
                <div class="hud">
                    <span class="score">Score: <b>0</b></span>
                    <span class="best">Best: <b>0</b></span>
                    <button class="pause-btn" type="button">Pause</button>
                </div>
                <div class="board-wrap">
                    <canvas class="board"></canvas>
                    <div class="overlay">
                        <div class="title">🐍 SNAKE</div>
                        <div class="sub">Click or press any arrow to start</div>
                        <div class="hint">Arrows / WASD to move · Space to pause<br>Walls wrap around</div>
                    </div>
                </div>
            </div>
        `;

        const $wrap     = root.querySelector('.wrap');
        const $boardBox = root.querySelector('.board-wrap');
        const $canvas   = root.querySelector('canvas.board');
        const $overlay  = root.querySelector('.overlay');
        const $overTitle= $overlay.querySelector('.title');
        const $overSub  = $overlay.querySelector('.sub');
        const $score    = root.querySelector('.hud .score b');
        const $best     = root.querySelector('.hud .best b');
        const $pauseBtn = root.querySelector('.pause-btn');

        const gctx = $canvas.getContext('2d');

        // Theme-aware palette — host syncs data-theme on <html> and pushes
        // {type:'theme'} messages on change. Read it live so the canvas
        // matches the surrounding chrome.
        const PALETTES = {
            dark:  { bg: '#0a0515', grid: 'rgba(255,200,87,0.06)', food: '#fb7185', head: '#ffc857', body: '#a78bfa' },
            light: { bg: '#f5efdc', grid: 'rgba(139,105,20,0.10)',  food: '#c23a4f', head: '#8b6914', body: '#7a4e06' },
        };
        function palette() {
            return PALETTES[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
        }

        let cols = MIN_COLS, rows = MIN_ROWS;
        let snake;          // [{x,y}, ...] head first
        let dir;            // {x,y}
        let nextDir;        // buffered next direction
        let food;           // {x,y}
        let score = 0;
        let best  = Number((await ctx.storage.get('best')) || 0);
        let state = 'idle'; // idle | running | paused | over
        let tickHandle = null;

        $best.textContent = String(best);

        function resize() {
            const r = $boardBox.getBoundingClientRect();
            const w = Math.max(MIN_COLS * CELL, Math.floor(r.width));
            const h = Math.max(MIN_ROWS * CELL, Math.floor(r.height));
            // Canvas backing store in device pixels, CSS size fills the box.
            const dpr = window.devicePixelRatio || 1;
            $canvas.width  = Math.floor(w * dpr);
            $canvas.height = Math.floor(h * dpr);
            gctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            cols = Math.max(MIN_COLS, Math.floor(w / CELL));
            rows = Math.max(MIN_ROWS, Math.floor(h / CELL));

            // Keep snake in-bounds if the window got smaller.
            if (snake) {
                snake = snake.map(s => ({ x: mod(s.x, cols), y: mod(s.y, rows) }));
                if (food) food = { x: mod(food.x, cols), y: mod(food.y, rows) };
            }
            draw();
        }

        function randEmptyCell() {
            const taken = new Set(snake.map(s => s.x + ',' + s.y));
            // Try random picks first; fall back to scan if grid is crowded.
            for (let i = 0; i < 200; i++) {
                const x = Math.floor(Math.random() * cols);
                const y = Math.floor(Math.random() * rows);
                if (!taken.has(x + ',' + y)) return { x, y };
            }
            for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
                if (!taken.has(x + ',' + y)) return { x, y };
            }
            return null; // board full — win condition
        }

        function reset() {
            const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
            snake = [ { x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy } ];
            dir = { x: 1, y: 0 };
            nextDir = dir;
            food = randEmptyCell();
            score = 0;
            $score.textContent = '0';
        }

        function showOverlay(title, sub) {
            $overTitle.textContent = title;
            $overSub.textContent = sub;
            $overlay.style.display = 'flex';
        }
        function hideOverlay() { $overlay.style.display = 'none'; }

        function start() {
            if (state === 'running') return;
            if (state === 'over' || state === 'idle') reset();
            state = 'running';
            hideOverlay();
            $pauseBtn.textContent = 'Pause';
            if (tickHandle) clearInterval(tickHandle);
            tickHandle = setInterval(tick, TICK_MS);
        }
        function pause() {
            if (state !== 'running') return;
            state = 'paused';
            clearInterval(tickHandle); tickHandle = null;
            showOverlay('Paused', 'Click or press Space to resume');
            $pauseBtn.textContent = 'Resume';
        }
        function gameOver() {
            state = 'over';
            clearInterval(tickHandle); tickHandle = null;
            if (score > best) {
                best = score;
                $best.textContent = String(best);
                ctx.storage.set('best', best).catch(e => console.warn('[snake] save best failed', e));
            }
            showOverlay('Game Over', `Score: ${score} · Best: ${best}`);
            $pauseBtn.textContent = 'Pause';
        }

        function tick() {
            dir = nextDir;
            const head = snake[0];
            // Wrap edges — this is the core feature the user asked for.
            const nx = mod(head.x + dir.x, cols);
            const ny = mod(head.y + dir.y, rows);

            // Self-collision (note: allow moving into the current tail cell,
            // since that tail will step away this same tick).
            for (let i = 0; i < snake.length - 1; i++) {
                if (snake[i].x === nx && snake[i].y === ny) return gameOver();
            }

            snake.unshift({ x: nx, y: ny });
            if (food && nx === food.x && ny === food.y) {
                score++;
                $score.textContent = String(score);
                food = randEmptyCell();
                if (!food) return gameOver(); // perfect game — stop
            } else {
                snake.pop();
            }
            draw();
        }

        function draw() {
            const w = cols * CELL, h = rows * CELL;
            const p = palette();
            // Fill, then draw a subtle grid.
            gctx.fillStyle = p.bg;
            gctx.fillRect(0, 0, w, h);

            gctx.strokeStyle = p.grid;
            gctx.lineWidth = 1;
            gctx.beginPath();
            for (let x = 0; x <= cols; x++) {
                gctx.moveTo(x * CELL + 0.5, 0);
                gctx.lineTo(x * CELL + 0.5, h);
            }
            for (let y = 0; y <= rows; y++) {
                gctx.moveTo(0, y * CELL + 0.5);
                gctx.lineTo(w, y * CELL + 0.5);
            }
            gctx.stroke();

            if (food) {
                gctx.fillStyle = p.food;
                const fx = food.x * CELL, fy = food.y * CELL;
                gctx.beginPath();
                gctx.arc(fx + CELL / 2, fy + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
                gctx.fill();
            }

            if (snake) {
                for (let i = 0; i < snake.length; i++) {
                    const s = snake[i];
                    gctx.fillStyle = i === 0 ? p.head : p.body;
                    gctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
                }
            }
        }

        function setDir(dx, dy) {
            // No 180° reversals.
            if (dir.x === -dx && dir.y === -dy) return;
            if (dx === 0 && dy === 0) return;
            nextDir = { x: dx, y: dy };
        }

        const keyHandler = (e) => {
            // Only act if the focus is inside Grimoire-free territory — but
            // since we're inside our own iframe, any keydown here is ours.
            let handled = true;
            switch (e.key) {
                case 'ArrowUp': case 'w': case 'W': setDir(0, -1); break;
                case 'ArrowDown': case 's': case 'S': setDir(0, 1); break;
                case 'ArrowLeft': case 'a': case 'A': setDir(-1, 0); break;
                case 'ArrowRight': case 'd': case 'D': setDir(1, 0); break;
                case ' ':
                    if (state === 'running') pause();
                    else start();
                    break;
                default: handled = false;
            }
            if (handled) {
                e.preventDefault();
                if (state === 'idle' || state === 'over') start();
            }
        };
        window.addEventListener('keydown', keyHandler);

        // Touch swipes for mobile.
        let tStart = null;
        $boardBox.addEventListener('touchstart', (e) => {
            const t = e.changedTouches[0];
            tStart = { x: t.clientX, y: t.clientY };
        }, { passive: true });
        $boardBox.addEventListener('touchend', (e) => {
            if (!tStart) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - tStart.x, dy = t.clientY - tStart.y;
            tStart = null;
            if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
                // Tap — start/pause.
                if (state === 'running') pause(); else start();
                return;
            }
            if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
            else setDir(0, dy > 0 ? 1 : -1);
            if (state === 'idle' || state === 'over') start();
        }, { passive: true });

        $overlay.addEventListener('click', () => {
            if (state === 'running') return;
            start();
        });
        $pauseBtn.addEventListener('click', () => {
            if (state === 'running') pause();
            else start();
        });

        // Adapt grid live — ResizeObserver tracks window + sidebar resizes.
        const ro = new ResizeObserver(() => resize());
        ro.observe($boardBox);
        resize();

        // Repaint when the host pushes a theme change. Sandbox forwards
        // {type:'theme', value} via postMessage; the SDK already mirrors
        // it onto <html data-theme>, so we just need to redraw.
        const themeHandler = (e) => {
            const d = e.data;
            if (d && d.__aruta_sdk && d.type === 'theme') draw();
        };
        window.addEventListener('message', themeHandler);

        // Idle state: show some snake on the board as a teaser.
        reset();
        draw();
        showOverlay('🐍 SNAKE', 'Click or press any arrow to start');

        // Expose cleanup so the host can stop the loop, free the listener,
        // and disconnect the observer when the iframe is unmounted.
        return {
            unmount() {
                if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
                window.removeEventListener('keydown', keyHandler);
                window.removeEventListener('message', themeHandler);
                ro.disconnect();
            }
        };
    },
};
