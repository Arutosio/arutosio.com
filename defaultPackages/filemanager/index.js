// File Explorer — browse 4 sources (Virtual / Profile folder / External folder / Packages)
// with CRUD on the first three (+ read-only on Packages), inline preview, and
// "Open in Grimoire" handoff for text files.

const TEXT_EXT = /\.(md|markdown|txt|json|js|mjs|cjs|ts|jsx|tsx|css|scss|html|htm|xml|yml|yaml|csv|log|ini|toml|env|sh|bash|py|rb|rs|go|c|h|cpp|hpp|java|kt|swift)$/i;
const TEXT_MIME = /^text\/|application\/(json|xml|javascript|x-sh)|\+xml$|\+json$/;
function isTextLike(name, mime) {
    if (mime && TEXT_MIME.test(mime)) return true;
    return TEXT_EXT.test(name);
}
function mimeFromName(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || ''); const ext = m ? m[1].toLowerCase() : '';
    const map = { txt:'text/plain', md:'text/markdown', json:'application/json', js:'text/javascript',
        css:'text/css', html:'text/html', xml:'application/xml', yml:'text/yaml', csv:'text/csv',
        png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml',
        mp4:'video/mp4', webm:'video/webm', mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg',
        pdf:'application/pdf', zip:'application/zip' };
    return map[ext] || 'application/octet-stream';
}
function fmtSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
}
function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function sortEntries(arr) {
    arr.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return arr;
}

// ── Virtual backend (ctx.storage under 'virtualFS') ─────────────────────
class VirtualBackend {
    static key = 'virtualFS';
    constructor(ctx, tree) {
        this.ctx = ctx;
        this._tree = tree || { name: '', path: '', isDir: true, children: [] };
        this._saveTimer = null;
    }
    get kind() { return 'virtual'; }
    isWritable() { return true; }
    _persist() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this.ctx.storage.set(VirtualBackend.key, this._tree).catch(e => console.warn('[filemanager] persist', e));
        }, 200);
    }
    _find(path, node = this._tree) {
        if (node.path === path) return node;
        if (node.isDir) for (const c of node.children) { const r = this._find(path, c); if (r) return r; }
        return null;
    }
    async list(path) {
        const node = this._find(path || '');
        if (!node || !node.isDir) return [];
        return sortEntries(node.children.map(c => ({
            name: c.name, kind: c.isDir ? 'dir' : 'file',
            size: c.isDir ? 0 : ((c.content && c.content.byteLength) || (typeof c.content === 'string' ? c.content.length : 0)),
            mime: c.mime || '',
        })));
    }
    async readFile(path) {
        const n = this._find(path);
        if (!n || n.isDir) throw new Error('not_found');
        let bytes;
        if (n.content instanceof Uint8Array) bytes = n.content;
        else if (typeof n.content === 'string') bytes = new TextEncoder().encode(n.content);
        else bytes = new Uint8Array(0);
        return { bytes, mime: n.mime || mimeFromName(n.name) };
    }
    async writeFile(path, bytes, mime) {
        const n = this._find(path);
        if (!n || n.isDir) throw new Error('not_found');
        n.content = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes || '');
        n.mime = mime || n.mime || mimeFromName(n.name);
        this._persist();
    }
    async createFile(parentPath, name, content, mime) {
        const p = this._find(parentPath || '');
        if (!p || !p.isDir) throw new Error('no_parent');
        if (p.children.some(c => c.name === name)) throw new Error('exists');
        const np = parentPath ? parentPath + '/' + name : name;
        const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(content || '');
        p.children.push({ name, path: np, isDir: false, content: bytes, mime: mime || mimeFromName(name) });
        this._persist();
        return np;
    }
    async createDir(parentPath, name) {
        const p = this._find(parentPath || '');
        if (!p || !p.isDir) throw new Error('no_parent');
        if (p.children.some(c => c.name === name)) throw new Error('exists');
        const np = parentPath ? parentPath + '/' + name : name;
        p.children.push({ name, path: np, isDir: true, children: [] });
        this._persist();
    }
    async deleteNode(path) {
        const parentPath = path.split('/').slice(0, -1).join('/');
        const parent = this._find(parentPath);
        if (!parent) throw new Error('no_parent');
        parent.children = parent.children.filter(c => c.path !== path);
        this._persist();
    }
    async rename(path, newName) {
        const n = this._find(path);
        if (!n) throw new Error('not_found');
        const parentPath = path.split('/').slice(0, -1).join('/');
        const parent = this._find(parentPath);
        if (parent && parent.children.some(c => c.name === newName)) throw new Error('exists');
        const np = parentPath ? parentPath + '/' + newName : newName;
        const rewrite = (node, newPath) => {
            node.name = newPath.split('/').pop() || newPath;
            node.path = newPath;
            if (node.isDir) for (const c of node.children) rewrite(c, newPath ? newPath + '/' + c.name : c.name);
        };
        rewrite(n, np);
        this._persist();
    }
}

// ── Profile-folder backend (via ctx.profile) ────────────────────────────
class ProfileBackend {
    constructor(ctx) { this.ctx = ctx; }
    get kind() { return 'profile'; }
    async available() { return !!(await this.ctx.profile.isLinked()); }
    isWritable() { return true; }
    async list(path) {
        const items = await this.ctx.profile.list(path || '');
        return sortEntries(items.map(it => ({ ...it, mime: it.kind === 'file' ? mimeFromName(it.name) : '' })));
    }
    async readFile(path) {
        const r = await this.ctx.profile.read(path);
        return { bytes: r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes || []), mime: r.mime || mimeFromName(path) };
    }
    async writeFile(path, bytes, mime) {
        await this.ctx.profile.write(path, bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes || ''), mime || mimeFromName(path));
    }
    async createFile(parentPath, name, content) {
        const np = parentPath ? parentPath + '/' + name : name;
        const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(content || '');
        await this.ctx.profile.write(np, bytes, mimeFromName(name));
        return np;
    }
    async createDir() { throw new Error('profile_mkdir_unsupported'); }
    async deleteNode(path) { await this.ctx.profile.remove(path); }
    async rename(path, newName) {
        const parentPath = path.split('/').slice(0, -1).join('/');
        const np = parentPath ? parentPath + '/' + newName : newName;
        const r = await this.ctx.profile.read(path);
        await this.ctx.profile.write(np, r.bytes, r.mime);
        await this.ctx.profile.remove(path);
    }
}

// ── External-folder backend (FS Access) ─────────────────────────────────
class ExternalBackend {
    constructor(rootHandle) { this.root = rootHandle; this.name = rootHandle?.name || 'folder'; }
    get kind() { return 'external'; }
    isWritable() { return true; }
    async _dir(path, create = false) {
        const parts = path ? path.split('/').filter(Boolean) : [];
        let dir = this.root;
        for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
        return dir;
    }
    async list(path) {
        const dir = await this._dir(path || '');
        const out = [];
        for await (const [name, entry] of dir.entries()) {
            if (entry.kind === 'file') {
                let size = 0; try { size = (await entry.getFile()).size; } catch {}
                out.push({ name, kind: 'file', size, mime: mimeFromName(name) });
            } else {
                out.push({ name, kind: 'dir', mime: '' });
            }
        }
        return sortEntries(out);
    }
    async readFile(path) {
        const parts = path.split('/'); const name = parts.pop();
        const dir = await this._dir(parts.join('/'));
        const fh = await dir.getFileHandle(name, { create: false });
        const f = await fh.getFile();
        return { bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type || mimeFromName(name) };
    }
    async writeFile(path, bytes) {
        const parts = path.split('/'); const name = parts.pop();
        const dir = await this._dir(parts.join('/'), true);
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes || ''));
        await w.close();
    }
    async createFile(parentPath, name, content) {
        const np = parentPath ? parentPath + '/' + name : name;
        await this.writeFile(np, content || new Uint8Array(0));
        return np;
    }
    async createDir(parentPath, name) {
        const dir = await this._dir(parentPath || '', true);
        await dir.getDirectoryHandle(name, { create: true });
    }
    async deleteNode(path) {
        const parts = path.split('/'); const name = parts.pop();
        const dir = await this._dir(parts.join('/'));
        await dir.removeEntry(name, { recursive: true });
    }
    async rename(path, newName) {
        const parts = path.split('/'); const oldName = parts.pop();
        const dir = await this._dir(parts.join('/'), true);
        // FS Access API has no atomic rename — copy + delete.
        const oldFH = await dir.getFileHandle(oldName, { create: false }).catch(() => null);
        if (!oldFH) throw new Error('rename_dir_unsupported');
        const f = await oldFH.getFile();
        const bytes = new Uint8Array(await f.arrayBuffer());
        const newFH = await dir.getFileHandle(newName, { create: true });
        const w = await newFH.createWritable();
        await w.write(bytes); await w.close();
        await dir.removeEntry(oldName);
    }
}

// ── Packages backend (read-only) ────────────────────────────────────────
class PackagesBackend {
    constructor(ctx) { this.ctx = ctx; }
    get kind() { return 'packages'; }
    isWritable() { return false; }
    async list(path) {
        if (!path) {
            const apps = await this.ctx.listInstalled();
            return apps.map(a => ({ name: a.id, kind: 'dir', mime: '' }));
        }
        const [appId, ...rest] = path.split('/');
        const prefix = rest.join('/');
        const files = await this.ctx.install.listFiles(appId);
        // Filter to entries directly under the current prefix.
        const seen = new Set();
        const out = [];
        for (const f of files) {
            if (prefix && !f.path.startsWith(prefix + '/')) continue;
            const rel = prefix ? f.path.slice(prefix.length + 1) : f.path;
            if (!rel) continue;
            const slash = rel.indexOf('/');
            if (slash >= 0) {
                const dn = rel.slice(0, slash);
                if (!seen.has(dn)) { seen.add(dn); out.push({ name: dn, kind: 'dir' }); }
            } else {
                out.push({ name: rel, kind: 'file', size: f.size, mime: f.mime });
            }
        }
        return sortEntries(out);
    }
    async readFile(path) {
        const [appId, ...rest] = path.split('/');
        const inner = rest.join('/');
        const r = await this.ctx.install.readFile(appId, inner);
        return { bytes: r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes || []), mime: r.mime || mimeFromName(inner) };
    }
}

// ── UI ──────────────────────────────────────────────────────────────────
export default {
    async mount(root, ctx) {
        const SOURCES = [
            { id: 'virtual',  icon: '📝', label: 'Virtual' },
            { id: 'profile',  icon: '💾', label: 'Profile' },
            { id: 'external', icon: '🗂', label: 'External' },
            { id: 'packages', icon: '📦', label: 'Packages' },
        ];

        root.innerHTML = `
            <div class="fm-shell">
                <div class="fm-toolbar">
                    <button class="fm-btn" data-act="up" title="Up">↑</button>
                    <button class="fm-btn" data-act="newfile">＋ File</button>
                    <button class="fm-btn" data-act="newdir">＋ Folder</button>
                    <button class="fm-btn" data-act="upload">Upload</button>
                    <input type="file" id="fm-upload-input" multiple style="display:none;">
                    <button class="fm-btn" data-act="refresh">⟳</button>
                    <span class="fm-spacer"></span>
                    <span class="fm-breadcrumb" id="fm-crumb">/</span>
                    <button class="fm-btn fm-toggle-preview" data-act="togglePreview" title="Toggle preview">👁</button>
                </div>
                <aside class="fm-sources" id="fm-sources">
                    ${SOURCES.map(s => `<div class="fm-source" data-source="${s.id}"><span class="fm-source-icon">${s.icon}</span>${s.label}</div>`).join('')}
                </aside>
                <section class="fm-tree" id="fm-tree"><div class="fm-empty">Select a source…</div></section>
                <aside class="fm-preview" id="fm-preview"><div class="fm-empty">Select a file to preview.</div></aside>
            </div>
        `;

        const $tree    = root.querySelector('#fm-tree');
        const $preview = root.querySelector('#fm-preview');
        const $crumb   = root.querySelector('#fm-crumb');
        const $uploadInput = root.querySelector('#fm-upload-input');

        let backend = null;
        let currentSource = null;
        let cwd = '';
        let selected = null;  // { name, kind, size, mime } relative to cwd
        let previewURL = null;

        // ── Source switching ──────────────────────────────────
        async function selectSource(id) {
            currentSource = id; cwd = ''; selected = null;
            resetPreview();
            root.querySelectorAll('.fm-source').forEach(el => el.classList.toggle('active', el.dataset.source === id));
            try {
                if (id === 'virtual') {
                    const saved = await ctx.storage.get(VirtualBackend.key);
                    backend = new VirtualBackend(ctx, saved || undefined);
                } else if (id === 'profile') {
                    const b = new ProfileBackend(ctx);
                    if (!(await b.available())) {
                        backend = null;
                        $tree.innerHTML = `<div class="fm-empty">Profile folder not linked.<br>Link one in Settings → Profile.</div>`;
                        updateToolbar();
                        return;
                    }
                    backend = b;
                } else if (id === 'external') {
                    backend = null; // lazy: need user gesture to pick
                    $tree.innerHTML = `<div class="fm-empty"><button class="fm-btn" id="fm-open-ext">Open folder…</button></div>`;
                    root.querySelector('#fm-open-ext')?.addEventListener('click', openExternal);
                    updateToolbar();
                    return;
                } else if (id === 'packages') {
                    backend = new PackagesBackend(ctx);
                }
                await refresh();
            } catch (e) {
                console.warn('[filemanager]', e);
                $tree.innerHTML = `<div class="fm-empty">Failed to open source: ${escapeHTML(e.message || e)}</div>`;
            }
            updateToolbar();
        }

        async function openExternal() {
            if (!window.showDirectoryPicker) {
                ctx.toast?.('Folder picker requires Chromium', 'warning');
                return;
            }
            try {
                const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
                backend = new ExternalBackend(handle);
                cwd = ''; selected = null;
                await refresh();
                updateToolbar();
            } catch (e) { if (e?.name !== 'AbortError') ctx.toast?.('Picker blocked: ' + (e?.message || e), 'error'); }
        }

        function updateToolbar() {
            const writable = !!backend && backend.isWritable?.() && currentSource !== 'packages';
            root.querySelectorAll('.fm-toolbar .fm-btn').forEach(b => {
                const act = b.dataset.act;
                if (['newfile', 'newdir', 'upload'].includes(act)) b.disabled = !writable;
                if (act === 'newdir' && backend?.kind === 'profile') b.disabled = true; // FS Access needs file to create dirs
                if (act === 'up') b.disabled = !cwd;
            });
            $crumb.textContent = '/' + cwd;
        }

        // ── Tree rendering ─────────────────────────────────────
        async function refresh() {
            if (!backend) return;
            selected = null;
            try {
                const items = await backend.list(cwd);
                if (currentSource === 'profile') {
                    const header = `<div class="fm-warn">⚠ Changes sync to your linked folder immediately.</div>`;
                    $tree.innerHTML = header + (items.length ? renderEntries(items) : `<div class="fm-empty">Empty folder.</div>`);
                } else {
                    $tree.innerHTML = items.length ? renderEntries(items) : `<div class="fm-empty">Empty.</div>`;
                }
                wireEntries(items);
                updateToolbar();
            } catch (e) {
                console.warn('[filemanager] list', e);
                $tree.innerHTML = `<div class="fm-empty">Could not list: ${escapeHTML(e.message || e)}</div>`;
            }
        }

        function rowActionsHTML(it, writable) {
            if (it.kind !== 'file') return '';
            // Hide the menu entirely when there's nothing actionable.
            const canHandoff = isTextLike(it.name, it.mime) && currentSource !== 'packages';
            if (!canHandoff && !writable && currentSource === 'packages') {
                // Packages still offer Download — keep the menu.
            }
            return `<button class="fm-row-more" data-row-more title="More actions">⋯</button>`;
        }

        async function openRowMenu(anchorBtn, it) {
            const writable = !!backend && backend.isWritable?.() && currentSource !== 'packages';
            const canHandoff = isTextLike(it.name, it.mime) && currentSource !== 'packages';
            const items = [];
            items.push({ id: 'download', label: 'Download', icon: '⬇' });
            if (canHandoff) items.push({ id: 'openGrimoire', label: 'Open in Grimoire', icon: '📜' });
            if (writable) items.push({ separator: true });
            if (writable) items.push({ id: 'rename', label: 'Rename', icon: '✎' });
            if (writable) items.push({ id: 'delete', label: 'Delete', icon: '🗑', danger: true });
            const r = anchorBtn.getBoundingClientRect();
            const choice = await ctx.contextMenu.show({ x: r.right, y: r.bottom, items });
            if (choice) await runRowAction(choice, it);
        }

        function renderEntries(items) {
            const writable = !!backend && backend.isWritable?.() && currentSource !== 'packages';
            return items.map((it, i) => `
                <div class="fm-entry" data-idx="${i}">
                    <span class="fm-entry-icon">${it.kind === 'dir' ? '📁' : '📄'}</span>
                    <span class="fm-entry-name">${escapeHTML(it.name)}</span>
                    <span class="fm-entry-meta">${it.kind === 'file' ? fmtSize(it.size) : ''}</span>
                    ${rowActionsHTML(it, writable)}
                </div>
            `).join('');
        }

        function wireEntries(items) {
            $tree.querySelectorAll('.fm-entry').forEach((el) => {
                const idx = Number(el.dataset.idx);
                const it = items[idx];
                el.addEventListener('contextmenu', (ev) => {
                    if (it.kind !== 'file') return;
                    ev.preventDefault();
                    openRowMenu(el, it);
                });
                el.addEventListener('click', async (ev) => {
                    const moreBtn = ev.target.closest('[data-row-more]');
                    if (moreBtn) {
                        ev.stopPropagation();
                        openRowMenu(moreBtn, it);
                        return;
                    }
                    $tree.querySelectorAll('.fm-entry').forEach(e => e.classList.remove('active'));
                    el.classList.add('active');
                    if (it.kind === 'dir') {
                        cwd = cwd ? cwd + '/' + it.name : it.name;
                        await refresh();
                    } else {
                        selected = it;
                        await renderPreview();
                        if (root.querySelector('.fm-shell').classList.contains('fm-narrow')) {
                            root.querySelector('.fm-shell').classList.add('fm-preview-open');
                        }
                    }
                });
            });
        }

        async function runRowAction(act, it) {
            const path = cwd ? cwd + '/' + it.name : it.name;
            if (act === 'rename') {
                const n = prompt('New name:', it.name);
                if (!n || n === it.name) return;
                try { await backend.rename(path, n); await refresh(); resetPreview(); }
                catch (e) { ctx.toast?.('Rename failed: ' + (e.message || e), 'error'); }
                return;
            }
            if (act === 'delete') {
                if (!confirm(`Delete "${it.name}"?`)) return;
                try { await backend.deleteNode(path); await refresh(); resetPreview(); }
                catch (e) { ctx.toast?.('Delete failed: ' + (e.message || e), 'error'); }
                return;
            }
            // Download / openGrimoire need to read the file first.
            let data;
            try { data = await backend.readFile(path); }
            catch (e) { ctx.toast?.('Read failed: ' + (e.message || e), 'error'); return; }
            const mime = data.mime || mimeFromName(it.name);
            if (act === 'download') {
                const url = URL.createObjectURL(new Blob([data.bytes], { type: mime }));
                const a = document.createElement('a');
                a.href = url; a.download = it.name;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
            } else if (act === 'openGrimoire') {
                const text = new TextDecoder().decode(data.bytes);
                try { await ctx.handoff('grimoire', { type: 'file', name: it.name, content: text, mime }); }
                catch (e) {
                    if (String(e.message).includes('payload_too_large')) ctx.toast?.('File too large for handoff', 'warning');
                    else ctx.toast?.('Handoff failed: ' + (e.message || e), 'error');
                }
            }
        }

        // ── Preview ────────────────────────────────────────────
        function resetPreview() {
            if (previewURL) { try { URL.revokeObjectURL(previewURL); } catch {} previewURL = null; }
            $preview.innerHTML = `<div class="fm-empty">Select a file to preview.</div>`;
        }
        async function renderPreview() {
            resetPreview();
            if (!selected || selected.kind !== 'file') return;
            const path = cwd ? cwd + '/' + selected.name : selected.name;
            let data;
            try { data = await backend.readFile(path); }
            catch (e) {
                $preview.innerHTML = `<div class="fm-empty">Read failed: ${escapeHTML(e.message || e)}</div>`;
                return;
            }
            const name = selected.name;
            const mime = data.mime || mimeFromName(name);
            const size = fmtSize(data.bytes.byteLength);
            const isText  = isTextLike(name, mime);
            const isImage = /^image\//.test(mime);
            const isVideo = /^video\//.test(mime);
            const isAudio = /^audio\//.test(mime);

            let body = '';
            if (isText) {
                const txt = new TextDecoder().decode(data.bytes.slice(0, 256 * 1024));
                body = `<pre>${escapeHTML(txt)}</pre>`;
            } else if (isImage || isVideo || isAudio) {
                previewURL = URL.createObjectURL(new Blob([data.bytes], { type: mime }));
                if (isImage) body = `<img src="${previewURL}" alt="">`;
                else if (isVideo) body = `<video src="${previewURL}" controls muted loop></video>`;
                else body = `<audio src="${previewURL}" controls></audio>`;
            } else {
                body = `<em>Binary file — no inline preview.</em>`;
            }

            $preview.innerHTML = `
                <div class="fm-preview-title">${escapeHTML(name)}</div>
                <div class="fm-preview-meta">${escapeHTML(mime)} · ${size}</div>
                <div class="fm-preview-body">${body}</div>
            `;
        }

        // ── Toolbar actions ────────────────────────────────────
        root.querySelector('[data-act="up"]').addEventListener('click', async () => {
            if (!cwd) return;
            cwd = cwd.split('/').slice(0, -1).join('/');
            resetPreview();
            await refresh();
        });
        root.querySelector('[data-act="refresh"]').addEventListener('click', async () => { resetPreview(); await refresh(); });
        root.querySelector('[data-act="newfile"]').addEventListener('click', async () => {
            if (!backend?.isWritable?.()) return;
            const name = prompt('New file name:');
            if (!name) return;
            try { await backend.createFile(cwd, name, ''); await refresh(); }
            catch (e) { ctx.toast?.('Create failed: ' + (e.message || e), 'error'); }
        });
        root.querySelector('[data-act="newdir"]').addEventListener('click', async () => {
            if (!backend?.isWritable?.()) return;
            const name = prompt('New folder name:');
            if (!name) return;
            try { await backend.createDir(cwd, name); await refresh(); }
            catch (e) { ctx.toast?.('Create failed: ' + (e.message || e), 'error'); }
        });
        root.querySelector('[data-act="upload"]').addEventListener('click', () => $uploadInput.click());
        $uploadInput.addEventListener('change', async () => {
            if (!backend?.isWritable?.()) return;
            const files = Array.from($uploadInput.files || []);
            $uploadInput.value = '';
            for (const f of files) {
                try {
                    const bytes = new Uint8Array(await f.arrayBuffer());
                    await backend.createFile(cwd, f.name, bytes);
                } catch (e) { ctx.toast?.('Upload failed: ' + f.name + ' — ' + (e.message || e), 'error'); }
            }
            await refresh();
        });

        // Preview overlay toggle (narrow layouts).
        const $shell = root.querySelector('.fm-shell');
        root.querySelector('[data-act="togglePreview"]').addEventListener('click', () => {
            $shell.classList.toggle('fm-preview-open');
        });
        // Click the ✕ pseudo-element area at the top-right of the overlay preview.
        root.querySelector('#fm-preview').addEventListener('click', (ev) => {
            if (!$shell.classList.contains('fm-narrow')) return;
            const r = ev.currentTarget.getBoundingClientRect();
            if (ev.clientY - r.top < 22 && r.right - ev.clientX < 28) {
                $shell.classList.remove('fm-preview-open');
            }
        });

        // Responsive: collapse preview when the window is narrow.
        const NARROW_PX = 720;
        const ro = new ResizeObserver((entries) => {
            for (const e of entries) {
                const w = e.contentRect.width;
                $shell.classList.toggle('fm-narrow', w < NARROW_PX);
                if (w >= NARROW_PX) $shell.classList.remove('fm-preview-open');
            }
        });
        ro.observe($shell);
        root.__fmRO = ro;

        // ── Boot ───────────────────────────────────────────────
        root.querySelectorAll('.fm-source').forEach(el => {
            el.addEventListener('click', () => selectSource(el.dataset.source));
        });
        await selectSource('virtual');
    },

    async unmount(root, ctx) {
        try { root.__fmRO?.disconnect(); } catch {}
        // Any popup is mounted on document.body; remove the latest if still open.
        document.querySelectorAll('.fm-popup').forEach(p => p.remove());
        const previews = root.querySelectorAll('img[src^="blob:"], video[src^="blob:"], audio[src^="blob:"]');
        previews.forEach(el => { try { URL.revokeObjectURL(el.src); } catch {} });
    }
};
