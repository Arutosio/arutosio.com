/* ╔══════════════════════════════════════════════════════════╗
 * ║  TERMINAL — Built-in shell with command parser + history ║
 * ╚══════════════════════════════════════════════════════════╝ */

const HISTORY_KEY = 'arutosio_term_history';
const HISTORY_MAX = 200;

let _output, _input, _prompt, _overlay;
let _machineEl, _xterm, _fit, _ws, _ro, _modeSelect, _statusEl, _reconnectBtn, _machineSend;
let _mode = 'virtual';
let _history = [];
let _historyIdx = -1;
let _initialized = false;
let _cwd = ''; // session-local working directory, relative to linked profile folder root

// Reverse-i-search state (Ctrl-R). `active` is the flag; when non-null the
// terminal is in search mode and the overlay renders `(reverse-i-search)`.
// `matchIdx` is the index into _history of the newest match at or before
// `cursorIdx` — Ctrl-R repeatedly decrements cursorIdx to cycle older matches.
let _revSearch = null;

// ── Filesystem helpers ────────────────────────────────────
// Normalize target path against cwd. Throws on '..' above home.
// Returns path without leading slash (empty string = home).
function resolvePath(target, cwd) {
    target = String(target || '');
    const absolute = target.startsWith('/') || target.startsWith('~');
    if (target.startsWith('~')) target = target.slice(1);
    if (target.startsWith('/')) target = target.slice(1);
    const stack = absolute ? [] : (cwd ? cwd.split('/').filter(Boolean) : []);
    const segs = target.split('/');
    for (const s of segs) {
        if (!s || s === '.') continue;
        if (s === '..') {
            if (stack.length === 0) throw new Error('cannot go above home');
            stack.pop();
        } else {
            stack.push(s);
        }
    }
    return stack.join('/');
}

// Walk from root handle along slash-separated path, returning the final dir handle.
async function walkToDir(handle, path) {
    if (!path) return handle;
    let dir = handle;
    for (const seg of path.split('/').filter(Boolean)) {
        dir = await dir.getDirectoryHandle(seg, { create: false });
    }
    return dir;
}

// Return the linked handle or print a friendly error + return null.
async function requireLinked() {
    const fn = window.profile?.getLinkedHandle;
    if (typeof fn !== 'function') {
        termPrint('no profile folder linked. Open Settings → Profile to pick one.', 'term-error');
        return null;
    }
    const h = await fn();
    if (!h) {
        termPrint('no profile folder linked. Open Settings → Profile to pick one.', 'term-error');
        return null;
    }
    return h;
}

function _updatePromptUI() {
    if (_prompt) _prompt.textContent = _promptText();
}

function _loadHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        _history = raw ? JSON.parse(raw) : [];
    } catch { _history = []; }
}

// Load history at module load so programmatic `window.terminal.run(...)`
// before initTerminal() still has access to prior session history.
if (typeof localStorage !== 'undefined') {
    try { _loadHistory(); } catch (_) {}
}

function _saveHistory() {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(_history.slice(-HISTORY_MAX)));
    } catch {}
}

function _scroll() {
    if (_output) _output.scrollTop = _output.scrollHeight;
}

function termPrint(text, cls = '') {
    if (!_output) return;
    const line = document.createElement('div');
    line.className = 'term-line ' + cls;
    line.textContent = text;
    _output.appendChild(line);
    _scroll();
}

function termPrintHTML(html) {
    if (!_output) return;
    const line = document.createElement('div');
    line.className = 'term-line';
    line.innerHTML = html;
    _output.appendChild(line);
    _scroll();
}

function termClear() {
    if (_output) _output.innerHTML = '';
}

function _parseLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    // Simple split with quoted-string support
    const tokens = [];
    let cur = '';
    let quote = null;
    for (let i = 0; i < trimmed.length; i++) {
        const c = trimmed[i];
        if (quote) {
            if (c === quote) { quote = null; }
            else cur += c;
        } else if (c === '"' || c === "'") { quote = c; }
        else if (c === ' ') { if (cur) { tokens.push(cur); cur = ''; } }
        else cur += c;
    }
    if (cur) tokens.push(cur);
    return { name: tokens[0], args: tokens.slice(1) };
}

const BUILTINS = {
    help: {
        desc: 'Show available commands',
        run() {
            const t = window.t();
            termPrint(t.term_help_header || 'Built-in commands:', 'term-info');
            const max = Math.max(...Object.keys(BUILTINS).map(k => k.length));
            for (const [name, def] of Object.entries(BUILTINS)) {
                termPrintHTML(`  <span class="term-key">${_escape(name.padEnd(max + 2))}</span><span class="term-muted">${_escape(def.desc || '')}</span>`);
            }
            const customCmds = window.registry?.listCommands() || [];
            if (customCmds.length) {
                termPrint('');
                termPrint(t.term_help_custom || 'Installed commands:', 'term-info');
                for (const c of customCmds) {
                    const key = c.commandAlias || c.id;
                    termPrintHTML(`  <span class="term-key">${_escape(key.padEnd(max + 2))}</span><span class="term-muted">${_escape(c.name || '')}</span>`);
                }
            }
        }
    },
    clear: { desc: 'Clear the screen', run() { termClear(); } },
    echo:  { desc: 'Print text', run(args) { termPrint(args.join(' ')); } },
    apps:  {
        desc: 'List installed apps',
        run() {
            const apps = (window.registry?.list() || []).filter(m => m.roles?.includes('app'));
            if (!apps.length) { termPrint('(no apps installed)', 'term-dim'); return; }
            for (const a of apps) {
                termPrintHTML(`${_escape(a.icon || '📦')} <span class="term-key">${_escape(a.id.padEnd(20))}</span><span class="term-muted">${_escape(a.name)}</span>`);
            }
        }
    },
    commands: {
        desc: 'List installed commands',
        run() {
            const cs = window.registry?.listCommands() || [];
            if (!cs.length) { termPrint('(no commands installed)', 'term-dim'); return; }
            for (const c of cs) {
                // Prefer the terminal alias (commandAlias) over the package id
                // — that's the name the user actually types.
                const key = c.commandAlias || c.id;
                termPrintHTML(`<span class="term-success">⚡</span> <span class="term-key">${_escape(key.padEnd(20))}</span><span class="term-muted">${_escape(c.name)}</span>`);
            }
        }
    },
    install: {
        desc: 'Install a .zip package (opens file picker)',
        async run() { await window.installer?.installPrompt(); }
    },
    uninstall: {
        desc: 'Uninstall a package by id',
        async run(args) {
            const id = args[0];
            if (!id) { termPrint('usage: uninstall <id>', 'term-error'); return; }
            if (!window.registry?.isInstalled(id)) { termPrint('not installed: ' + id, 'term-error'); return; }
            await window.registry.uninstall(id);
            termPrint('uninstalled: ' + id, 'term-success');
        }
    },
    open: {
        desc: 'Open a window by id',
        run(args) {
            const id = args[0];
            if (!id) { termPrint('usage: open <id>', 'term-error'); return; }
            if (typeof openWindow !== 'function') return;
            openWindow(id);
            termPrint('opened: ' + id, 'term-success');
        }
    },
    close: {
        desc: 'Close a window by id',
        run(args) {
            const id = args[0];
            if (!id) { termPrint('usage: close <id>', 'term-error'); return; }
            if (typeof closeWindow !== 'function') return;
            closeWindow(id);
            termPrint('closed: ' + id, 'term-success');
        }
    },
    permissions: {
        desc: 'Show or edit permissions for an app',
        run(args) {
            const id = args[0];
            if (!id) { termPrint('usage: permissions <id>', 'term-error'); return; }
            const m = window.registry?.getManifest(id);
            if (!m) { termPrint('not installed: ' + id, 'term-error'); return; }
            const perms = JSON.parse(localStorage.getItem('arutosio_perms_' + id) || '{}');
            termPrintHTML(`<span class="term-info">${_escape(m.name)}</span> <span class="term-muted">(</span><span class="term-value">${_escape(id)}</span><span class="term-muted">)</span>`);
            const decl = m.permissions || [];
            const all = Array.from(new Set([...decl, ...Object.keys(perms)]));
            if (!all.length) { termPrint('  (no permissions)', 'term-dim'); return; }
            for (const p of all) {
                const state = perms[p] || 'ask';
                const stateCls = state === 'granted' ? 'term-success' : state === 'denied' ? 'term-error' : 'term-muted';
                termPrintHTML(`  <span class="term-key">${_escape(p.padEnd(16))}</span><span class="${stateCls}">${state}</span>`);
            }
        }
    },
    history: {
        desc: 'Show command history',
        run() { _history.forEach((h, i) => termPrint(String(i + 1).padStart(3) + '  ' + h)); }
    },
    theme: {
        desc: 'Toggle theme: theme [dark|light]',
        run(args) {
            if (typeof toggleTheme !== 'function') return;
            const target = args[0];
            if (target && target !== window.currentTheme) toggleTheme();
            else if (!target) toggleTheme();
            termPrint('theme: ' + window.currentTheme, 'term-success');
        }
    },
    lang: {
        desc: 'Switch language: lang <it|en|es|ja|fn>',
        run(args) {
            if (!args[0]) { termPrint('current: ' + window.currentLang, 'term-info'); return; }
            if (typeof switchLanguage === 'function') { switchLanguage(args[0]); termPrint('lang: ' + args[0], 'term-success'); }
        }
    },
    pwd: {
        desc: 'Print working directory',
        async run() {
            if (!(await requireLinked())) return;
            termPrint('~' + (_cwd ? '/' + _cwd : ''));
        }
    },
    cd: {
        desc: 'Change directory: cd [path]',
        async run(args) {
            const handle = await requireLinked();
            if (!handle) return;
            const arg = args[0];
            if (!arg || arg === '~') { _cwd = ''; _updatePromptUI(); return; }
            let target;
            try { target = resolvePath(arg, _cwd); }
            catch (e) { termPrint('cd: ' + (e.message || e), 'term-error'); return; }
            try { await walkToDir(handle, target); }
            catch { termPrint('cd: no such directory: ' + arg, 'term-error'); return; }
            _cwd = target;
            _updatePromptUI();
        }
    },
    ls: {
        desc: 'List directory: ls [-a] [path]',
        async run(args) {
            const handle = await requireLinked();
            if (!handle) return;
            let showAll = false;
            const rest = [];
            for (const a of (args || [])) {
                if (a === '-a' || a === '--all') showAll = true;
                else rest.push(a);
            }
            let target = _cwd;
            if (rest[0]) {
                try { target = resolvePath(rest[0], _cwd); }
                catch (e) { termPrint('ls: ' + (e.message || e), 'term-error'); return; }
            }
            let dir;
            try { dir = await walkToDir(handle, target); }
            catch { termPrint('ls: no such directory: ' + (rest[0] || ('~' + (target ? '/' + target : ''))), 'term-error'); return; }
            const dirs = [];
            const files = [];
            try {
                for await (const [name, entry] of dir.entries()) {
                    if (!showAll && name.startsWith('.')) continue;
                    if (entry.kind === 'directory') dirs.push(name);
                    else files.push(name);
                }
            } catch (e) { termPrint('ls: ' + (e.message || e), 'term-error'); return; }
            dirs.sort((a, b) => a.localeCompare(b));
            files.sort((a, b) => a.localeCompare(b));
            for (const n of dirs) termPrintHTML(`<span class="term-key">${_escape(n)}/</span>`);
            for (const n of files) termPrintHTML(`<span class="term-value">${_escape(n)}</span>`);
        }
    },
};

// Expand history designators (`!!`, `!N`, `!prefix`). Returns the expanded
// line, or the original if no expansion applies. Returns `null` if an
// expansion was attempted but no match exists (callers surface an error).
function _expandHistory(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('!') || trimmed.length < 2) return line;
    const spec = trimmed.slice(1);
    // !!
    if (spec === '!') {
        if (!_history.length) return null;
        return _history[_history.length - 1];
    }
    // !N (1-based index into history)
    if (/^\d+$/.test(spec)) {
        const n = parseInt(spec, 10);
        if (n < 1 || n > _history.length) return null;
        return _history[n - 1];
    }
    // !prefix — most-recent entry starting with prefix
    for (let i = _history.length - 1; i >= 0; i--) {
        if (_history[i].startsWith(spec)) return _history[i];
    }
    return null;
}

async function termRun(line) {
    // In machine mode the PTY owns parsing, quoting and job control.
    if (_mode === 'machine' && _machineSend) {
        _machineSend(String(line));
        return;
    }
    // A pasted blob may contain newlines — run each non-empty line in order
    // so "cmd1\ncmd2" pasted into the input dispatches both commands.
    if (typeof line === 'string' && /\r?\n/.test(line)) {
        const parts = line.split(/\r?\n/);
        for (const p of parts) {
            if (p.trim()) await termRun(p);
        }
        return;
    }
    // History-expansion pass before parsing so `!!` resolves to a real command.
    const expanded = _expandHistory(line);
    if (expanded === null) {
        termPrintHTML(`<span class="term-prompt">${_promptText()}</span><span class="term-cmd">${_escape(line)}</span>`);
        termPrint((window.t().term_history_nomatch || 'no history match:') + ' ' + line, 'term-error');
        return;
    }
    if (expanded !== line) {
        line = expanded;
    }
    const parsed = _parseLine(line);
    if (!parsed) return;
    const t = window.t();

    _history.push(line);
    if (_history.length > HISTORY_MAX) _history = _history.slice(-HISTORY_MAX);
    _saveHistory();
    _historyIdx = _history.length;

    termPrintHTML(`<span class="term-prompt">${_promptText()}</span><span class="term-cmd">${_escape(line)}</span>`);

    const builtin = BUILTINS[parsed.name];
    if (builtin) {
        try { await builtin.run(parsed.args); }
        catch (e) { termPrint('error: ' + (e.message || e), 'term-error'); }
        return;
    }
    // Commands can be invoked by alias (commandAlias) or by package id.
    const cmdManifest = window.registry?.getCommand?.(parsed.name)
        || (window.registry?.isInstalled(parsed.name) ? window.registry.getManifest(parsed.name) : null);
    if (cmdManifest && cmdManifest.roles?.includes('command')) {
        try { await window.sandbox.runCommand(cmdManifest.id, parsed.args); }
        catch (e) { termPrint('error: ' + (e.message || e), 'term-error'); }
        return;
    }
    if (window.registry?.isInstalled(parsed.name)) {
        const m = window.registry.getManifest(parsed.name);
        if (m.roles?.includes('app')) {
            if (typeof openWindow === 'function') openWindow(parsed.name);
            return;
        }
    }
    termPrint((t.term_unknown || 'unknown command:') + ' ' + parsed.name, 'term-error');
}

function _escape(s) { return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function _promptText() { return '⚜ arutosio:~' + (_cwd ? '/' + _cwd : '') + '$ '; }

function _findReverseMatch(query, before) {
    // Walk history newest-first starting at index `before` (inclusive),
    // return the first entry that contains `query`. Returns -1 on miss.
    if (!query) return before >= 0 ? before : -1;
    for (let i = Math.min(before, _history.length - 1); i >= 0; i--) {
        if (_history[i].includes(query)) return i;
    }
    return -1;
}

function _exitReverseSearch(commit) {
    if (!_revSearch) return;
    if (commit && _revSearch.matchIdx >= 0) {
        _input.value = _history[_revSearch.matchIdx];
        _input.setSelectionRange(_input.value.length, _input.value.length);
    } else if (!commit) {
        _input.value = _revSearch.originalInput || '';
    }
    _revSearch = null;
    _renderOverlay();
}

function _onKey(e) {
    // Reverse-i-search captures all keys while active.
    if (_revSearch) {
        if (e.key === 'c' && e.ctrlKey) { _exitReverseSearch(false); e.preventDefault(); return; }
        if (e.key === 'Escape') { _exitReverseSearch(false); e.preventDefault(); return; }
        if (e.key === 'Enter') {
            _exitReverseSearch(true);
            if (_input.value) {
                const v = _input.value;
                _input.value = '';
                termRun(v);
                _renderOverlay();
            }
            e.preventDefault();
            return;
        }
        if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
            // Cycle to the next older match.
            const next = _findReverseMatch(_revSearch.query, _revSearch.matchIdx - 1);
            if (next >= 0) _revSearch.matchIdx = next;
            _renderOverlay();
            e.preventDefault();
            return;
        }
        if (e.key === 'Backspace') {
            _revSearch.query = _revSearch.query.slice(0, -1);
            _revSearch.matchIdx = _findReverseMatch(_revSearch.query, _history.length - 1);
            _renderOverlay();
            e.preventDefault();
            return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            _revSearch.query += e.key;
            _revSearch.matchIdx = _findReverseMatch(_revSearch.query, _history.length - 1);
            _renderOverlay();
            e.preventDefault();
            return;
        }
        // Any other key (arrow, tab, etc.) commits current match and falls
        // through to normal handling — mirrors bash/zsh behavior.
        _exitReverseSearch(true);
        // don't preventDefault so arrow keys still move the caret
    }
    if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
        _revSearch = {
            query: '',
            matchIdx: _history.length - 1,
            originalInput: _input.value,
        };
        _renderOverlay();
        e.preventDefault();
        return;
    }
    if (e.key === 'Enter') {
        const v = _input.value;
        _input.value = '';
        termRun(v);
        _renderOverlay();
        e.preventDefault();
    } else if (e.key === 'Tab') {
        const sug = _currentSuggestion();
        if (sug && sug !== _input.value) {
            _input.value = sug;
            _input.setSelectionRange(sug.length, sug.length);
            _renderOverlay();
        }
        e.preventDefault();
    } else if (e.key === 'ArrowRight') {
        const atEnd = _input.selectionStart === _input.value.length
                   && _input.selectionEnd === _input.value.length;
        const sug = _currentSuggestion();
        if (atEnd && sug && sug !== _input.value) {
            _input.value = sug;
            _input.setSelectionRange(sug.length, sug.length);
            _renderOverlay();
            e.preventDefault();
        }
    } else if (e.key === 'ArrowUp') {
        if (_history.length === 0) return;
        _historyIdx = Math.max(0, _historyIdx - 1);
        _input.value = _history[_historyIdx] || '';
        _renderOverlay();
        e.preventDefault();
    } else if (e.key === 'ArrowDown') {
        if (_historyIdx < _history.length - 1) {
            _historyIdx++;
            _input.value = _history[_historyIdx];
        } else {
            _historyIdx = _history.length;
            _input.value = '';
        }
        _renderOverlay();
        e.preventDefault();
    } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
        termClear();
        e.preventDefault();
    }
}

function _knownCommands() {
    const set = new Set(Object.keys(BUILTINS));
    try {
        const list = window.registry?.list?.() || [];
        for (const m of list) {
            if (!m || !m.id) continue;
            // Apps are openable by id; commands answer to their alias (if any)
            // or their id. Include all reachable tokens so the tab-completer
            // and "ok/bad" highlight match terminal dispatch.
            if (m.roles?.includes('app')) set.add(m.id);
            if (m.roles?.includes('command')) set.add(m.commandAlias || m.id);
            if (!m.roles) set.add(m.id); // ultra-legacy safety net
        }
    } catch {}
    return set;
}

function _isKnownCommand(name) {
    if (!name) return false;
    return _knownCommands().has(name);
}

function _splitFirstToken(value) {
    // Preserves leading whitespace and keeps the raw rest as typed (incl. spaces).
    const m = /^(\s*)(\S+)(.*)$/.exec(value);
    if (!m) return { lead: value, first: '', rest: '' };
    return { lead: m[1], first: m[2], rest: m[3] };
}

function _findSuggestion(value) {
    if (!value) return '';
    // 1) most-recent history match that is strictly longer
    for (let i = _history.length - 1; i >= 0; i--) {
        const h = _history[i];
        if (h && h.length > value.length && h.startsWith(value)) return h;
    }
    // 2) if still typing first token (no space), try command names alphabetically
    if (!/\s/.test(value)) {
        const names = Array.from(_knownCommands()).sort();
        for (const n of names) {
            if (n.length > value.length && n.startsWith(value)) return n;
        }
    }
    return '';
}

function _currentSuggestion() {
    const v = _input ? _input.value : '';
    return _findSuggestion(v);
}

function _renderOverlay() {
    if (!_overlay || !_input) return;
    // Reverse-i-search mode: repaint the prompt and overlay with the search
    // state. The real prompt is temporarily replaced; we restore on exit.
    if (_prompt) {
        _prompt.textContent = _revSearch
            ? '(reverse-i-search)`' + _revSearch.query + "': "
            : _promptText();
    }
    if (_revSearch) {
        const match = _revSearch.matchIdx >= 0 ? _history[_revSearch.matchIdx] : '';
        _overlay.textContent = '';
        if (match) {
            const span = document.createElement('span');
            span.className = 'term-cmd-ok';
            span.textContent = match;
            _overlay.appendChild(span);
        } else if (_revSearch.query) {
            const span = document.createElement('span');
            span.className = 'term-cmd-bad';
            span.textContent = '(no match)';
            _overlay.appendChild(span);
        }
        // Hide the real <input> value while in search — we're painting the
        // matched history entry in the overlay instead.
        return;
    }
    const value = _input.value;
    _overlay.textContent = '';
    if (!value) return;

    const { lead, first, rest } = _splitFirstToken(value);
    if (lead) _overlay.appendChild(document.createTextNode(lead));
    if (first) {
        const span = document.createElement('span');
        span.className = _isKnownCommand(first) ? 'term-cmd-ok' : 'term-cmd-bad';
        span.textContent = first;
        _overlay.appendChild(span);
    }
    if (rest) _overlay.appendChild(document.createTextNode(rest));

    const suggestion = _findSuggestion(value);
    if (suggestion && suggestion.startsWith(value) && suggestion.length > value.length) {
        const tail = suggestion.slice(value.length);
        const ghost = document.createElement('span');
        ghost.className = 'term-ghost';
        ghost.textContent = tail;
        _overlay.appendChild(ghost);
    }
}

function _loadXtermCSS(href) {
    return new Promise((resolve, reject) => {
        if (document.querySelector('link[data-arutosio-xterm]')) { resolve(); return; }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.arutosioXterm = '1';
        link.onload = () => resolve();
        link.onerror = () => reject(new Error('xterm css failed'));
        document.head.appendChild(link);
    });
}

function _loadXtermScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('xterm script failed'));
        document.head.appendChild(script);
    });
}

function _termSessionId() {
    let id = null;
    try { id = localStorage.getItem('arutosio_term_session'); } catch (_) {}
    if (!id) {
        const device = localStorage.getItem('arutosio_device_id') || Math.random().toString(36).slice(2);
        id = 'term-' + String(device).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 48);
        try { localStorage.setItem('arutosio_term_session', id); } catch (_) {}
    }
    return id;
}

function _connectMachine() {
    if (!window.arutosioLocal?.isLocal) {
        if (_statusEl) _statusEl.textContent = 'local mode required';
        return;
    }
    if (!_xterm) return;
    try { _ws?.close(); } catch {}
    _ws = window.arutosioLocal.openTerm(_xterm.cols, _xterm.rows, _termSessionId());
    _ws.binaryType = 'arraybuffer';
    if (_statusEl) _statusEl.textContent = 'connecting…';
    if (_reconnectBtn) _reconnectBtn.hidden = true;
    _ws.onopen = () => {
        if (_statusEl) _statusEl.textContent = 'connected';
        try { _xterm.focus(); } catch {}
    };
    _ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'exit') {
                    _xterm.write('\r\n\x1b[33m[exit ' + msg.code + ']\x1b[0m\r\n');
                    return;
                }
            } catch {}
            _xterm.write(e.data);
            return;
        }
        _xterm.write(new Uint8Array(e.data));
    };
    _ws.onclose = () => {
        if (_statusEl) _statusEl.textContent = 'disconnected';
        if (_reconnectBtn) _reconnectBtn.hidden = false;
        try { _xterm.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n'); } catch {}
    };
    _ws.onerror = () => { if (_statusEl) _statusEl.textContent = 'error'; };
}

async function _ensureMachine() {
    if (_xterm) {
        try { _fit.fit(); _xterm.focus(); } catch {}
        if (!_ws || _ws.readyState > 1) _connectMachine();
        return;
    }
    try {
        if (!window.Terminal) {
            await _loadXtermCSS('/term/xterm.css');
            await _loadXtermScript('/term/xterm.js');
        }
        if (!window.FitAddon) await _loadXtermScript('/term/addon-fit.js');
        _xterm = new Terminal({
            cursorBlink: true,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
            fontSize: 14,
            scrollback: 5000,
            theme: {
                background: '#0c0a1a',
                foreground: '#e8e6f0',
                cursor: '#ffc857',
                selectionBackground: '#3a2a0f'
            }
        });
        _fit = new FitAddon.FitAddon();
        _xterm.loadAddon(_fit);
        _xterm.open(_machineEl);
        _fit.fit();
        _xterm.onData((data) => {
            if (_ws && _ws.readyState === 1) _ws.send(new TextEncoder().encode(data));
        });
        _xterm.onResize(({ cols, rows }) => {
            if (_ws && _ws.readyState === 1) _ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        });
        _machineSend = (line) => {
            if (_ws && _ws.readyState === 1) {
                const text = line.endsWith('\n') ? line : line + '\n';
                _ws.send(new TextEncoder().encode(text));
            }
        };
        _ro = new ResizeObserver(() => { try { _fit.fit(); } catch {} });
        _ro.observe(_machineEl);
        requestAnimationFrame(() => { try { _fit.fit(); } catch {} });
        _connectMachine();
    } catch (e) {
        console.warn('[terminal] xterm failed', e);
        if (_statusEl) _statusEl.textContent = 'xterm unavailable';
        _setTermMode('virtual');
    }
}

function _setTermMode(mode) {
    if (mode === 'machine' && !window.arutosioLocal?.isLocal) mode = 'virtual';
    _mode = mode;
    if (_modeSelect) _modeSelect.value = mode;
    const win = document.getElementById('win-terminal');
    const virtualEl = win?.querySelector('#term-virtual');
    const machineEl = win?.querySelector('#term-machine');
    if (virtualEl) virtualEl.hidden = mode !== 'virtual';
    if (machineEl) machineEl.hidden = mode !== 'machine';
    if (mode === 'machine') {
        _ensureMachine();
    } else {
        setTimeout(() => _input?.focus(), 0);
    }
    try { window.storage?.set('arutosio_term_mode', mode); } catch {}
}

function initTerminal() {
    if (_initialized) return;
    const win = document.getElementById('win-terminal');
    if (!win) return;
    const content = win.querySelector('.win-content');
    if (!content) return;

    const local = !!window.arutosioLocal?.isLocal;
    content.innerHTML = `
        <div class="term-shell">
            <div class="term-modebar" ${local ? '' : 'hidden'}>
                <label class="term-mode-label" for="term-mode">Mode</label>
                <select class="term-mode-select" id="term-mode">
                    <option value="virtual">Virtual</option>
                    <option value="machine">This machine</option>
                </select>
                <span class="term-mode-status" id="term-status"></span>
                <button class="term-mode-btn" id="term-reconnect" type="button" hidden>Reconnect</button>
            </div>
            <div class="term-panel term-virtual" id="term-virtual">
                <div class="term-screen">
                    <div class="term-output" id="term-output"></div>
                    <div class="term-inputline">
                        <span class="term-prompt" id="term-prompt">⚜ arutosio:~$ </span>
                        <div class="term-input-wrap">
                            <div class="term-overlay" id="term-overlay" aria-hidden="true"></div>
                            <input class="term-input" id="term-input" type="text" autocomplete="off" spellcheck="false" autocapitalize="off">
                        </div>
                    </div>
                </div>
            </div>
            <div class="term-panel term-machine" id="term-machine" hidden></div>
        </div>
    `;
    _output = content.querySelector('#term-output');
    _input = content.querySelector('#term-input');
    _prompt = content.querySelector('#term-prompt');
    _overlay = content.querySelector('#term-overlay');
    _machineEl = content.querySelector('#term-machine');
    _modeSelect = content.querySelector('#term-mode');
    _statusEl = content.querySelector('#term-status');
    _reconnectBtn = content.querySelector('#term-reconnect');

    _historyIdx = _history.length;

    const t = window.t();
    termPrint(t.term_welcome || '✦ Arutosio Terminal — type "help" for commands', 'term-info');
    termPrint('');

    _input.addEventListener('keydown', _onKey);
    _input.addEventListener('input', _renderOverlay);
    _renderOverlay();
    content.addEventListener('click', (e) => {
        if (_mode === 'machine') { _xterm?.focus(); return; }
        if (e.target.tagName !== 'INPUT' && !window.getSelection()?.toString()) _input.focus();
    });
    _modeSelect?.addEventListener('change', () => _setTermMode(_modeSelect.value));
    _reconnectBtn?.addEventListener('click', () => _connectMachine());
    window.addEventListener('pagehide', () => { try { _ws?.close(); } catch {} });

    const saved = localStorage.getItem('arutosio_term_mode');
    _setTermMode(local && saved !== 'virtual' ? 'machine' : 'virtual');

    _initialized = true;
}

window.terminal = {
    init: initTerminal,
    print: termPrint,
    printHTML: termPrintHTML,
    clear: termClear,
    run: termRun,
};
