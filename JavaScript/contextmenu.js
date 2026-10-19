/* ╔══════════════════════════════════════════════════════════╗
 * ║  CONTEXT MENU — shared host popup menu (right-click etc.) ║
 * ║  Single global singleton so only one menu shows at once.  ║
 * ║  Consumed by host code and by apps via ctx.contextMenu.   ║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    let _current = null;   // { el, resolve, cleanup, focused }

    function closeMenu(chosenId = null) {
        if (!_current) return;
        const c = _current; _current = null;
        try { c.cleanup(); } catch {}
        try { c.el.remove(); } catch {}
        try { c.resolve(chosenId); } catch {}
    }

    function _escapeHTML(s) {
        return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
    }

    /**
     * Show a context menu.
     * @param {object} opts
     *   - x, y (viewport coords, required)
     *   - items: Array<{id, label, icon?, danger?, disabled?, separator?}>
     * @returns {Promise<string|null>} chosen item id, or null on dismiss
     */
    function show({ x = 0, y = 0, items = [] } = {}) {
        closeMenu(null); // singleton
        return new Promise((resolve) => {
            const el = document.createElement('div');
            el.className = 'ctx-menu';
            el.setAttribute('role', 'menu');
            el.tabIndex = -1;

            el.innerHTML = items.map((it, i) => {
                if (it && it.separator) return `<div class="ctx-sep" role="separator"></div>`;
                const icon = it.icon ? `<span class="ctx-icon">${_escapeHTML(it.icon)}</span>` : `<span class="ctx-icon"></span>`;
                const cls = ['ctx-item'];
                if (it.danger) cls.push('ctx-danger');
                if (it.disabled) cls.push('ctx-disabled');
                return `<div class="${cls.join(' ')}" role="menuitem" data-idx="${i}" ${it.disabled ? 'aria-disabled="true"' : 'tabindex="-1"'}>${icon}<span class="ctx-label">${_escapeHTML(it.label || '')}</span></div>`;
            }).join('');
            document.body.appendChild(el);

            // Position + viewport clamp
            const w = el.offsetWidth, h = el.offsetHeight;
            const vw = window.innerWidth, vh = window.innerHeight;
            let left = x, top = y;
            if (left + w > vw - 4) left = Math.max(4, vw - w - 4);
            if (top  + h > vh - 4) top  = Math.max(4, vh - h - 4);
            if (left < 4) left = 4;
            if (top  < 4) top  = 4;
            el.style.left = left + 'px';
            el.style.top  = top  + 'px';

            // Hover / click / keyboard wiring
            const usable = items
                .map((it, i) => ({ it, i }))
                .filter(({ it }) => !it.separator && !it.disabled);
            let focusedIdx = -1;

            function focusItem(idx) {
                const node = el.querySelector(`.ctx-item[data-idx="${idx}"]`);
                if (!node) return;
                el.querySelectorAll('.ctx-item.focus').forEach(n => n.classList.remove('focus'));
                node.classList.add('focus');
                node.focus?.();
                focusedIdx = idx;
            }

            function chooseByIdx(idx) {
                const it = items[idx];
                if (!it || it.separator || it.disabled) return;
                closeMenu(it.id != null ? String(it.id) : null);
            }

            el.addEventListener('click', (ev) => {
                const node = ev.target.closest('.ctx-item');
                if (!node) return;
                chooseByIdx(Number(node.dataset.idx));
            });
            el.addEventListener('mousemove', (ev) => {
                const node = ev.target.closest('.ctx-item');
                if (node && !node.classList.contains('ctx-disabled')) focusItem(Number(node.dataset.idx));
            });

            // Global dismiss — installed on next tick so the triggering
            // event doesn't immediately close the menu.
            function onDocDown(ev) {
                if (!el.contains(ev.target)) closeMenu(null);
            }
            function onKey(ev) {
                if (ev.key === 'Escape') { ev.preventDefault(); closeMenu(null); return; }
                if (ev.key === 'Enter' || ev.key === ' ') {
                    if (focusedIdx >= 0) { ev.preventDefault(); chooseByIdx(focusedIdx); }
                    return;
                }
                if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                    ev.preventDefault();
                    if (!usable.length) return;
                    const order = ev.key === 'ArrowDown' ? usable : usable.slice().reverse();
                    const cur = order.findIndex(u => u.i === focusedIdx);
                    const next = order[(cur + 1) % order.length];
                    focusItem(next.i);
                }
            }
            function onScroll() { closeMenu(null); }
            function onBlur()   { closeMenu(null); }

            const cleanup = () => {
                document.removeEventListener('mousedown', onDocDown, true);
                document.removeEventListener('contextmenu', onDocDown, true);
                document.removeEventListener('keydown', onKey, true);
                window.removeEventListener('scroll', onScroll, true);
                window.removeEventListener('blur', onBlur);
            };
            _current = { el, resolve, cleanup, focused: -1 };

            setTimeout(() => {
                document.addEventListener('mousedown', onDocDown, true);
                document.addEventListener('contextmenu', onDocDown, true);
                document.addEventListener('keydown', onKey, true);
                window.addEventListener('scroll', onScroll, true);
                window.addEventListener('blur', onBlur);
                // Focus first usable item for keyboard users.
                if (usable.length) focusItem(usable[0].i);
            }, 0);
        });
    }

    window.contextMenu = { show, close: () => closeMenu(null) };
})();
