const HLJS_SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
const HLJS_THEME  = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css';

const EXT_TO_LANG = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    py: 'python', pyw: 'python',
    cs: 'csharp',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp', c: 'cpp',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin', kts: 'kotlin',
    swift: 'swift',
    php: 'php', phtml: 'php',
    rb: 'ruby',
    sql: 'sql',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    ps1: 'powershell', psm1: 'powershell',
    html: 'html', htm: 'html',
    css: 'css', scss: 'css', sass: 'css',
    json: 'json',
    yaml: 'yaml', yml: 'yaml',
    xml: 'xml', svg: 'xml',
    md: 'markdown', markdown: 'markdown', mdown: 'markdown',
    txt: 'plaintext', log: 'plaintext',
};

function langFromFilename(name) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
    if (!m) return 'plaintext';
    return EXT_TO_LANG[m[1].toLowerCase()] || 'plaintext';
}

const LANGS = [
    { id: 'plaintext', label: 'Plain' },
    { id: 'javascript', label: 'JavaScript' },
    { id: 'typescript', label: 'TypeScript' },
    { id: 'python', label: 'Python' },
    { id: 'csharp', label: 'C#' },
    { id: 'cpp', label: 'C++' },
    { id: 'rust', label: 'Rust' },
    { id: 'go', label: 'Go' },
    { id: 'java', label: 'Java' },
    { id: 'kotlin', label: 'Kotlin' },
    { id: 'swift', label: 'Swift' },
    { id: 'php', label: 'PHP' },
    { id: 'ruby', label: 'Ruby' },
    { id: 'sql', label: 'SQL' },
    { id: 'bash', label: 'Bash' },
    { id: 'powershell', label: 'PowerShell' },
    { id: 'html', label: 'HTML' },
    { id: 'css', label: 'CSS' },
    { id: 'json', label: 'JSON' },
    { id: 'yaml', label: 'YAML' },
    { id: 'xml', label: 'XML' },
    { id: 'markdown', label: 'Markdown' },
];

const DEFAULT_SETTINGS = {
    activeLine:    true,
    lineNumbers:   true,
    grid:          false,
    liveHighlight: true,
    wrap:          false,
    tabWidth:      4,
};

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.DS_Store', 'dist', 'build', '.next', '.cache', '.idea', '.vscode']);
const SKIP_FILES_RE = /\.(lock|log|map|pyc|class|so|dll|exe|bin|zip|gz|tar|jar|war|pdf|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|mp[34]|wav|mov|mp4|webm)$/i;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('failed to load ' + src));
        document.head.appendChild(s);
    });
}
function loadCSS(href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── CRC32 (precomputed table) ────────────────────
const _CRC32_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = _CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── ZIP encoder (STORE only, method 0) ───────────
// Minimal spec: PKZIP APPNOTE. One local file header + data per entry,
// then a central directory + end-of-central-directory record at the tail.
function encodeZip(entries) {
    // entries: [{ path, content }] — content is a string.
    const te = new TextEncoder();
    const files = entries.map(e => {
        const nameBytes = te.encode(e.path);
        const data = te.encode(e.content || '');
        return { nameBytes, data, crc: crc32(data), size: data.length };
    });
    // Compute sizes.
    let localSize = 0;
    for (const f of files) localSize += 30 + f.nameBytes.length + f.size;
    let centralSize = 0;
    for (const f of files) centralSize += 46 + f.nameBytes.length;
    const total = localSize + centralSize + 22;

    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    let off = 0;
    const offsets = new Array(files.length);

    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        offsets[i] = off;
        dv.setUint32(off, 0x04034b50, true); off += 4;      // local header sig
        dv.setUint16(off, 20, true);         off += 2;      // version
        dv.setUint16(off, 0x0800, true);     off += 2;      // flags (UTF-8)
        dv.setUint16(off, 0, true);          off += 2;      // method STORE
        dv.setUint16(off, 0, true);          off += 2;      // modtime
        dv.setUint16(off, 0x21, true);       off += 2;      // moddate (1980-01-01)
        dv.setUint32(off, f.crc, true);      off += 4;
        dv.setUint32(off, f.size, true);     off += 4;      // compressed size
        dv.setUint32(off, f.size, true);     off += 4;      // uncompressed size
        dv.setUint16(off, f.nameBytes.length, true); off += 2;
        dv.setUint16(off, 0, true);          off += 2;      // extra len
        out.set(f.nameBytes, off);           off += f.nameBytes.length;
        out.set(f.data, off);                off += f.size;
    }

    const centralStart = off;
    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        dv.setUint32(off, 0x02014b50, true); off += 4;      // central dir sig
        dv.setUint16(off, 20, true);         off += 2;      // version made by
        dv.setUint16(off, 20, true);         off += 2;      // version needed
        dv.setUint16(off, 0x0800, true);     off += 2;      // flags
        dv.setUint16(off, 0, true);          off += 2;      // method
        dv.setUint16(off, 0, true);          off += 2;      // modtime
        dv.setUint16(off, 0x21, true);       off += 2;      // moddate
        dv.setUint32(off, f.crc, true);      off += 4;
        dv.setUint32(off, f.size, true);     off += 4;
        dv.setUint32(off, f.size, true);     off += 4;
        dv.setUint16(off, f.nameBytes.length, true); off += 2;
        dv.setUint16(off, 0, true);          off += 2;      // extra
        dv.setUint16(off, 0, true);          off += 2;      // comment
        dv.setUint16(off, 0, true);          off += 2;      // disk number
        dv.setUint16(off, 0, true);          off += 2;      // internal attrs
        dv.setUint32(off, 0, true);          off += 4;      // external attrs
        dv.setUint32(off, offsets[i], true); off += 4;      // local header offset
        out.set(f.nameBytes, off);           off += f.nameBytes.length;
    }

    // End-of-central-directory record.
    dv.setUint32(off, 0x06054b50, true); off += 4;
    dv.setUint16(off, 0, true);          off += 2;          // disk
    dv.setUint16(off, 0, true);          off += 2;          // cd disk
    dv.setUint16(off, files.length, true); off += 2;
    dv.setUint16(off, files.length, true); off += 2;
    dv.setUint32(off, centralSize, true); off += 4;
    dv.setUint32(off, centralStart, true); off += 4;
    dv.setUint16(off, 0, true);          off += 2;          // comment len
    return out;
}

// ── ZIP decoder (STORE only) ─────────────────────
// Scans the end-of-central-directory record, then iterates central entries
// to pull out STORE-method files. Compressed (deflate, method 8) entries
// are skipped and reported to the caller.
function decodeZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Find EOCD — scan backwards up to 64KiB from the end for signature.
    let eocd = -1;
    const maxScan = Math.min(bytes.length, 65557);
    for (let i = bytes.length - 22; i >= bytes.length - maxScan && i >= 0; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file');
    const cdOffset = dv.getUint32(eocd + 16, true);
    const cdCount  = dv.getUint16(eocd + 10, true);
    const td = new TextDecoder('utf-8');
    let off = cdOffset;
    const entries = [];
    let skippedCompressed = 0;
    for (let i = 0; i < cdCount; i++) {
        if (dv.getUint32(off, true) !== 0x02014b50) break;
        const method     = dv.getUint16(off + 10, true);
        const compSize   = dv.getUint32(off + 20, true);
        const nameLen    = dv.getUint16(off + 28, true);
        const extraLen   = dv.getUint16(off + 30, true);
        const commentLen = dv.getUint16(off + 32, true);
        const localOff   = dv.getUint32(off + 42, true);
        const name = td.decode(bytes.subarray(off + 46, off + 46 + nameLen));
        off += 46 + nameLen + extraLen + commentLen;
        if (method !== 0) { skippedCompressed++; continue; }
        if (name.endsWith('/')) continue; // directory entry
        // Parse the local header at localOff to find actual data offset.
        const lhNameLen  = dv.getUint16(localOff + 26, true);
        const lhExtraLen = dv.getUint16(localOff + 28, true);
        const dataOff = localOff + 30 + lhNameLen + lhExtraLen;
        const data = bytes.subarray(dataOff, dataOff + compSize);
        entries.push({ path: name, content: td.decode(data) });
    }
    return { entries, skippedCompressed };
}

function sortChildren(n) {
    if (!n || !n.children) return;
    n.children.sort((a, b) => (a.isDir === b.isDir) ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1));
    n.children.forEach(sortChildren);
}

// ╔══════════════════════════════════════════════════════════╗
// ║  Folder backends                                          ║
// ║  All three expose the same interface so the UI layer can  ║
// ║  stay backend-agnostic.                                   ║
// ╚══════════════════════════════════════════════════════════╝

// DiskBackend — wraps the File System Access API. Writable when we got a
// real DirectoryHandle from showDirectoryPicker(). Read-only when we fell
// back to <input webkitdirectory> (File objects, no handles).
class DiskBackend {
    constructor({ rootHandle = null, fallbackFiles = null, rootNameFallback = 'folder' }) {
        this.rootHandle = rootHandle;
        this.fallbackFiles = fallbackFiles;
        this._name = rootHandle?.name || rootNameFallback;
        this._tree = null;
    }
    static kind = 'disk';
    get kind() { return 'disk'; }
    isWritable() { return !!this.rootHandle; }
    rootName() { return this._name; }

    async list() {
        if (this.rootHandle) {
            this._tree = await this._buildFromHandle(this.rootHandle);
        } else {
            this._tree = this._buildFromFiles(this.fallbackFiles || [], this._name);
        }
        return this._tree;
    }

    async _buildFromHandle(dirHandle, path = '') {
        const node = { name: dirHandle.name, path, isDir: true, handle: dirHandle, children: [] };
        try {
            const q = await dirHandle.queryPermission?.({ mode: 'read' });
            if (q !== 'granted' && dirHandle.requestPermission) {
                const r = await dirHandle.requestPermission({ mode: 'read' });
                if (r !== 'granted') throw new Error('read permission denied');
            }
        } catch (e) { /* entries() will throw if truly blocked */ }
        try {
            for await (const [name, h] of dirHandle.entries()) {
                if (h.kind === 'directory') {
                    if (SKIP_DIRS.has(name)) continue;
                    const childPath = path ? path + '/' + name : name;
                    try { node.children.push(await this._buildFromHandle(h, childPath)); }
                    catch (e) { console.warn('[grimoire] skipped dir', childPath, e); }
                } else {
                    if (SKIP_FILES_RE.test(name)) continue;
                    const childPath = path ? path + '/' + name : name;
                    node.children.push({ name, path: childPath, isDir: false, handle: h });
                }
            }
        } catch (e) {
            console.error('[grimoire] entries() failed for', path || '(root)', e);
            throw e;
        }
        sortChildren(node);
        return node;
    }

    _buildFromFiles(files, rootName) {
        const root = { name: rootName, path: '', isDir: true, children: [] };
        const byPath = new Map([['', root]]);
        for (const f of files) {
            const rel = f.webkitRelativePath || f.name;
            if (SKIP_FILES_RE.test(f.name)) continue;
            const parts = rel.split('/');
            if (!root.name || root.name === 'folder') root.name = parts[0];
            let cur = root, curPath = '';
            for (let i = 1; i < parts.length; i++) {
                const seg = parts[i];
                if (i === parts.length - 1) {
                    cur.children.push({ name: seg, path: curPath ? curPath + '/' + seg : seg, isDir: false, file: f });
                } else {
                    if (SKIP_DIRS.has(seg)) { cur = null; break; }
                    curPath = curPath ? curPath + '/' + seg : seg;
                    let child = byPath.get(curPath);
                    if (!child) {
                        child = { name: seg, path: curPath, isDir: true, children: [] };
                        cur.children.push(child);
                        byPath.set(curPath, child);
                    }
                    cur = child;
                }
            }
        }
        sortChildren(root);
        return root;
    }

    _findNode(path, node = this._tree) {
        if (!node) return null;
        if (node.path === path) return node;
        if (node.children) for (const c of node.children) { const r = this._findNode(path, c); if (r) return r; }
        return null;
    }

    async readFile(path) {
        const node = this._findNode(path);
        if (!node || node.isDir) return '';
        let file = node.file;
        if (node.handle) file = await node.handle.getFile();
        return file ? await file.text() : '';
    }

    async writeFile(path, content) {
        if (!this.isWritable()) throw new Error('read_only');
        const node = this._findNode(path);
        if (!node || node.isDir || !node.handle) throw new Error('not_found');
        const w = await node.handle.createWritable();
        await w.write(content ?? '');
        await w.close();
    }

    async createFile(parentPath, name) {
        if (!this.isWritable()) throw new Error('read_only');
        const dir = this._findNode(parentPath);
        if (!dir || !dir.isDir) throw new Error('no_parent');
        const h = await dir.handle.getFileHandle(name, { create: true });
        const w = await h.createWritable();
        await w.write('');
        await w.close();
        await this.list();
        return parentPath ? parentPath + '/' + name : name;
    }

    async createDir(parentPath, name) {
        if (!this.isWritable()) throw new Error('read_only');
        const dir = this._findNode(parentPath);
        if (!dir || !dir.isDir) throw new Error('no_parent');
        await dir.handle.getDirectoryHandle(name, { create: true });
        await this.list();
        return parentPath ? parentPath + '/' + name : name;
    }

    async deleteNode(path) {
        if (!this.isWritable()) throw new Error('read_only');
        const parentPath = path.split('/').slice(0, -1).join('/');
        const name = path.split('/').pop();
        const parent = this._findNode(parentPath);
        if (!parent || !parent.handle) throw new Error('no_parent');
        await parent.handle.removeEntry(name, { recursive: true });
        await this.list();
    }

    async renameNode(path, newName) {
        if (!this.isWritable()) throw new Error('read_only');
        throw new Error('rename_not_implemented');
    }

    async moveNode(fromPath, toParentPath) {
        if (!this.isWritable()) throw new Error('read_only');
        if (fromPath === toParentPath) return;
        const src = this._findNode(fromPath);
        const destDir = this._findNode(toParentPath);
        if (!src || !destDir) return;
        const srcParentPath = fromPath.split('/').slice(0, -1).join('/');
        if (srcParentPath === toParentPath) return;
        if (src.handle && typeof src.handle.move === 'function') {
            try {
                await src.handle.move(destDir.handle, src.name);
                await this.list();
                return toParentPath ? toParentPath + '/' + src.name : src.name;
            } catch (e) { console.warn('[grimoire] native move failed, falling back', e); }
        }
        const file = await src.handle.getFile();
        const newH = await destDir.handle.getFileHandle(src.name, { create: true });
        const w = await newH.createWritable();
        await w.write(file);
        await w.close();
        const srcParent = this._findNode(srcParentPath);
        if (srcParent) await srcParent.handle.removeEntry(src.name);
        await this.list();
        return toParentPath ? toParentPath + '/' + src.name : src.name;
    }
}

// VirtualBackend — in-memory tree persisted to ctx.storage. Writable.
// Persistence key: 'virtualFS' → { name, tree }
class VirtualBackend {
    constructor(ctx, initial) {
        this.ctx = ctx;
        this._tree = initial?.tree || { name: initial?.name || 'workspace', path: '', isDir: true, children: [] };
        this._name = this._tree.name || 'workspace';
        this._saveTimer = null;
    }
    static kind = 'virtual';
    get kind() { return 'virtual'; }
    isWritable() { return true; }
    rootName() { return this._name; }

    async list() { return this._tree; }

    _findNode(path, node = this._tree) {
        if (!node) return null;
        if (node.path === path) return node;
        if (node.children) for (const c of node.children) { const r = this._findNode(path, c); if (r) return r; }
        return null;
    }

    _persist() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this.ctx.storage.set('virtualFS', { name: this._name, tree: this._tree }).catch(e => console.warn('[grimoire] virtualFS save failed', e));
        }, 200);
    }

    async readFile(path) {
        const n = this._findNode(path);
        if (!n || n.isDir) return '';
        return n.content || '';
    }

    async writeFile(path, content) {
        const n = this._findNode(path);
        if (!n || n.isDir) throw new Error('not_found');
        n.content = content ?? '';
        this._persist();
    }

    async createFile(parentPath, name) {
        const parent = this._findNode(parentPath);
        if (!parent || !parent.isDir) throw new Error('no_parent');
        if (parent.children.some(c => c.name === name)) throw new Error('exists');
        const newPath = parentPath ? parentPath + '/' + name : name;
        parent.children.push({ name, path: newPath, isDir: false, content: '' });
        sortChildren(parent);
        this._persist();
        return newPath;
    }

    async createDir(parentPath, name) {
        const parent = this._findNode(parentPath);
        if (!parent || !parent.isDir) throw new Error('no_parent');
        if (parent.children.some(c => c.name === name)) throw new Error('exists');
        const newPath = parentPath ? parentPath + '/' + name : name;
        parent.children.push({ name, path: newPath, isDir: true, children: [] });
        sortChildren(parent);
        this._persist();
        return newPath;
    }

    async deleteNode(path) {
        const parentPath = path.split('/').slice(0, -1).join('/');
        const parent = this._findNode(parentPath);
        if (!parent) throw new Error('no_parent');
        parent.children = parent.children.filter(c => c.path !== path);
        this._persist();
    }

    async renameNode(path, newName) {
        const n = this._findNode(path);
        if (!n) throw new Error('not_found');
        const parentPath = path.split('/').slice(0, -1).join('/');
        const parent = this._findNode(parentPath);
        if (parent && parent.children.some(c => c.name === newName)) throw new Error('exists');
        const newPath = parentPath ? parentPath + '/' + newName : newName;
        _rewritePaths(n, newPath);
        n.name = newName;
        if (parent) sortChildren(parent);
        this._persist();
        return newPath;
    }

    async moveNode(fromPath, toParentPath) {
        if (fromPath === toParentPath) return;
        const src = this._findNode(fromPath);
        const destDir = this._findNode(toParentPath);
        if (!src || !destDir || !destDir.isDir) return;
        const srcParentPath = fromPath.split('/').slice(0, -1).join('/');
        if (srcParentPath === toParentPath) return;
        const srcParent = this._findNode(srcParentPath);
        if (!srcParent) return;
        if (destDir.children.some(c => c.name === src.name)) throw new Error('exists');
        srcParent.children = srcParent.children.filter(c => c.path !== fromPath);
        const newPath = toParentPath ? toParentPath + '/' + src.name : src.name;
        _rewritePaths(src, newPath);
        destDir.children.push(src);
        sortChildren(destDir);
        this._persist();
        return newPath;
    }

    // Walk the whole tree, yielding files as {path, content}. Used by zip.
    *iterFiles(node = this._tree, prefix = '') {
        if (!node) return;
        if (!node.isDir) { yield { path: node.path, content: node.content || '' }; return; }
        for (const c of (node.children || [])) yield* this.iterFiles(c);
    }
}

function _rewritePaths(node, newPath) {
    node.path = newPath;
    if (node.isDir && node.children) {
        for (const c of node.children) _rewritePaths(c, newPath ? newPath + '/' + c.name : c.name);
    }
}

// ╔══════════════════════════════════════════════════════════╗
// ║  Mount                                                    ║
// ╚══════════════════════════════════════════════════════════╝

export default {
    async mount(root, ctx) {
        loadCSS(HLJS_THEME);
        const hljsReady = loadScript(HLJS_SCRIPT).catch(() => null);

        root.innerHTML = `
            <div class="wrap">
                <aside class="sidebar">
                    <div class="sidebar-head">
                        <button class="folder-label" title="Folder">📁 Grimoire</button>
                        <button class="folder-new-file" style="display:none" title="New file in root">📄＋</button>
                        <button class="folder-new-dir" style="display:none" title="New folder in root">📁＋</button>
                        <button class="menu-btn" title="More">⋮</button>
                        <div class="menu-pop" style="display:none"></div>
                    </div>
                    <div class="fs-section">
                        <div class="folder-tree"></div>
                    </div>
                </aside>
                <section class="main">
                    <div class="toolbar">
                        <input class="title" type="text" placeholder="Untitled" />
                        <select class="lang">
                            ${LANGS.map(l => `<option value="${l.id}">${l.label}</option>`).join('')}
                        </select>
                        <div class="view-tabs">
                            <button class="tab-edit active" data-view="edit">Edit</button>
                            <button class="tab-preview" data-view="preview">Preview</button>
                            <button class="tab-settings" data-view="settings" title="Editor settings">⚙</button>
                        </div>
                        <span class="save-indicator"></span>
                    </div>
                    <div class="body"><div class="empty">Open a folder to start editing.</div></div>
                </section>
            </div>
        `;

        const $title   = root.querySelector('.title');
        const $lang    = root.querySelector('.lang');
        const $tabs    = root.querySelectorAll('.view-tabs button');
        const $body    = root.querySelector('.body');
        const $saveInd = root.querySelector('.save-indicator');
        const $folderLabel   = root.querySelector('.folder-label');
        const $folderNewFile = root.querySelector('.folder-new-file');
        const $folderNewDir  = root.querySelector('.folder-new-dir');
        const $folderTree    = root.querySelector('.folder-tree');
        const $menuBtn       = root.querySelector('.menu-btn');
        const $menuPop       = root.querySelector('.menu-pop');

        let activeId = (await ctx.storage.get('active')) || null;
        if (activeId && !(typeof activeId === 'string' && activeId.startsWith('file:'))) activeId = null;
        let settings = Object.assign({}, DEFAULT_SETTINGS, (await ctx.storage.get('settings')) || {});
        let view = 'edit';

        /** @type {DiskBackend|VirtualBackend|null} */
        let backend = null;
        let tree = null;
        const expanded = new Set();
        const _fileDocs = new Map(); // path → doc
        let fileSaveTimer = null;

        // Edit-view refs
        let $editor = null, $paper = null, $ta = null, $gutter = null, $activeLine = null;
        let $hlLayer = null, $hlCode = null, hlTimer = null;

        function active() {
            if (activeId && typeof activeId === 'string' && activeId.startsWith('file:')) {
                return _fileDocs.get(activeId.slice(5)) || null;
            }
            return null;
        }

        // ── Editor helpers (unchanged) ──────────────────────────
        function applyEditorSettings() {
            if (!$editor) return;
            $editor.classList.toggle('opt-activeline', settings.activeLine);
            $editor.classList.toggle('opt-linenums',   settings.lineNumbers);
            $editor.classList.toggle('opt-hl-live',    settings.liveHighlight);
            $editor.classList.toggle('opt-wrap',       settings.wrap);
            $paper.classList.toggle('opt-grid',        settings.grid);
            $ta.style.tabSize = settings.tabWidth;
            if (settings.wrap) {
                requestAnimationFrame(() => {
                    const sbw = $ta.offsetWidth - $ta.clientWidth;
                    $editor.style.setProperty('--sbw', sbw + 'px');
                    updateGutter();
                });
            } else {
                $editor.style.setProperty('--sbw', '0px');
            }
        }
        const HL_MAX_BYTES = 200 * 1024;
        function updateHighlight() {
            if (!$hlCode || !$ta) return;
            if (!settings.liveHighlight) return;
            const d = active();
            const lang = d?.lang || 'plaintext';
            const text = $ta.value + '\n';
            $hlCode.textContent = text;
            const tooBig = text.length > HL_MAX_BYTES;
            if (window.hljs && lang !== 'plaintext' && !tooBig) {
                $hlCode.className = 'language-' + lang;
                $hlCode.removeAttribute('data-highlighted');
                try { window.hljs.highlightElement($hlCode); } catch {}
            } else { $hlCode.className = ''; }
            syncHLScroll();
        }
        function scheduleHighlight() {
            if (hlTimer) clearTimeout(hlTimer);
            hlTimer = setTimeout(updateHighlight, 80);
        }
        function syncHLScroll() {
            if (!$hlCode || !$ta || !$gutter) return;
            $hlCode.style.transform = `translate(${-$ta.scrollLeft}px, ${-$ta.scrollTop}px)`;
            $gutter.style.transform = `translateY(${-$ta.scrollTop}px)`;
        }
        let $gutterMirror = null;
        function ensureGutterMirror() {
            if ($gutterMirror && $gutterMirror.isConnected) return $gutterMirror;
            $gutterMirror = document.createElement('div');
            $gutterMirror.setAttribute('aria-hidden', 'true');
            $gutterMirror.style.cssText =
                'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;' +
                'padding:0;margin:0;border:0;box-sizing:border-box;' +
                'font-family:var(--mono);font-size:var(--ed-font);line-height:var(--ed-line);' +
                'white-space:pre-wrap;word-wrap:break-word;tab-size:' + settings.tabWidth + ';';
            document.body.appendChild($gutterMirror);
            return $gutterMirror;
        }
        let _lineRows = null;
        function updateGutter() {
            if (!$gutter || !$ta) return;
            const lines = $ta.value.split('\n');
            if (!settings.wrap) {
                _lineRows = null;
                let html = '';
                for (let i = 0; i < lines.length; i++) html += (i + 1) + '\n';
                $gutter.textContent = html;
            } else {
                const mirror = ensureGutterMirror();
                const taStyle = getComputedStyle($ta);
                const padX = parseFloat(taStyle.paddingLeft) + parseFloat(taStyle.paddingRight);
                const wrapW = $ta.clientWidth - padX;
                if (wrapW <= 0) { $gutter.textContent = ''; return; }
                mirror.style.width = wrapW + 'px';
                mirror.style.tabSize = settings.tabWidth;
                const lineH = parseFloat(getComputedStyle(mirror).lineHeight) || 22;
                let html = '';
                _lineRows = new Array(lines.length);
                for (let i = 0; i < lines.length; i++) {
                    mirror.textContent = lines[i] === '' ? ' ' : lines[i];
                    const rows = Math.max(1, Math.round(mirror.clientHeight / lineH));
                    _lineRows[i] = rows;
                    html += (i + 1);
                    for (let j = 1; j < rows; j++) html += '\n';
                    html += '\n';
                }
                $gutter.textContent = html;
            }
            syncHLScroll();
        }
        function updateActiveLine() {
            if (!$activeLine || !$ta) return;
            const before = $ta.value.slice(0, $ta.selectionStart);
            const lineIdx = (before.match(/\n/g) || []).length;
            const rootStyles = getComputedStyle(document.documentElement);
            const lineH = parseFloat(rootStyles.getPropertyValue('--ed-line')) || 22;
            const padY  = parseFloat(rootStyles.getPropertyValue('--ed-pad-y')) || 12;
            let visualRow = lineIdx;
            if (settings.wrap && _lineRows) {
                let sum = 0;
                for (let i = 0; i < lineIdx && i < _lineRows.length; i++) sum += _lineRows[i];
                const mirror = ensureGutterMirror();
                const lineStart = before.lastIndexOf('\n') + 1;
                const colBefore = $ta.value.slice(lineStart, $ta.selectionStart);
                mirror.textContent = colBefore === '' ? ' ' : colBefore;
                const mLineH = parseFloat(getComputedStyle(mirror).lineHeight) || 22;
                const rowInLine = Math.max(0, Math.round(mirror.clientHeight / mLineH) - 1);
                visualRow = sum + rowInLine;
            }
            $activeLine.style.transform = `translateY(${padY + visualRow * lineH - $ta.scrollTop}px)`;
        }
        function onContentChange() { updateGutter(); updateActiveLine(); syncHLScroll(); }
        function onCaretChange()   { updateActiveLine(); syncHLScroll(); }

        // ── Body rendering ──────────────────────────
        async function renderBody() {
            const d = active();
            $title.disabled = !d || view === 'settings';
            $lang.disabled  = !d || view === 'settings';
            if (!d) {
                $body.innerHTML = tree
                    ? '<div class="empty">Select a file from the tree…</div>'
                    : '<div class="empty">Open a folder to start editing.</div>';
                $title.value = ''; return;
            }
            $title.value = d.title || '';
            $lang.value  = d.lang || 'plaintext';

            if (view === 'edit') {
                $body.innerHTML = `
                    <div class="editor">
                        <div class="gutter"><div class="gutter-inner"></div></div>
                        <div class="paper">
                            <div class="active-line"></div>
                            <pre class="hl-layer" aria-hidden="true"><code></code></pre>
                            <textarea spellcheck="false"></textarea>
                        </div>
                    </div>
                `;
                $editor     = $body.querySelector('.editor');
                $paper      = $body.querySelector('.paper');
                $ta         = $body.querySelector('textarea');
                $gutter     = $body.querySelector('.gutter-inner');
                $activeLine = $body.querySelector('.active-line');
                $hlLayer    = $body.querySelector('.hl-layer');
                $hlCode     = $hlLayer.querySelector('code');
                $ta.value = d.content || '';
                applyEditorSettings();
                updateGutter();
                updateActiveLine();
                hljsReady.then(updateHighlight);

                $ta.addEventListener('input', () => {
                    d.content = $ta.value;
                    d.updatedAt = Date.now();
                    onContentChange();
                    scheduleHighlight();
                    scheduleFileSave();
                });
                $ta.addEventListener('keyup',  onCaretChange);
                $ta.addEventListener('click',  onCaretChange);
                $ta.addEventListener('scroll', syncHLScroll);
                $ta.addEventListener('keydown', (e) => {
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        const start = $ta.selectionStart, end = $ta.selectionEnd;
                        const ins = ' '.repeat(settings.tabWidth);
                        $ta.value = $ta.value.slice(0, start) + ins + $ta.value.slice(end);
                        $ta.selectionStart = $ta.selectionEnd = start + ins.length;
                        d.content = $ta.value;
                        onContentChange();
                        scheduleHighlight();
                        scheduleFileSave();
                    }
                });
                $ta.focus();
                window.addEventListener('resize', () => { if ($editor?.isConnected) updateGutter(); });
            } else if (view === 'preview') {
                const content = d.content || '';
                const lang = d.lang || 'plaintext';
                await hljsReady;
                $body.innerHTML = '<div class="preview"><pre><code></code></pre></div>';
                const codeEl = $body.querySelector('code');
                codeEl.textContent = content;
                if (window.hljs && lang !== 'plaintext') {
                    codeEl.className = 'language-' + lang;
                    try { window.hljs.highlightElement(codeEl); } catch {}
                }
            } else if (view === 'settings') {
                $body.innerHTML = `
                    <div class="settings-pane">
                        <h3>Editor</h3>
                        <p>These apply to every file; changes save automatically.</p>
                        <div class="settings-row"><div class="label"><strong>Highlight active line</strong><small>Soft glow on the line containing the cursor.</small></div><button class="toggle" data-opt="activeLine" type="button"></button></div>
                        <div class="settings-row"><div class="label"><strong>Show line numbers</strong><small>Gutter on the left with 1, 2, 3…</small></div><button class="toggle" data-opt="lineNumbers" type="button"></button></div>
                        <div class="settings-row"><div class="label"><strong>Grid paper background</strong><small>Math-notebook ruled background.</small></div><button class="toggle" data-opt="grid" type="button"></button></div>
                        <div class="settings-row"><div class="label"><strong>Live syntax highlighting</strong><small>Colors the code as you type.</small></div><button class="toggle" data-opt="liveHighlight" type="button"></button></div>
                        <div class="settings-row"><div class="label"><strong>Wrap long lines</strong><small>Off: horizontal scroll. On: visual wrap.</small></div><button class="toggle" data-opt="wrap" type="button"></button></div>
                        <div class="settings-row"><div class="label"><strong>Tab width</strong><small>Spaces inserted by the Tab key.</small></div><input type="number" min="2" max="8" step="1" data-opt="tabWidth"></div>
                    </div>
                `;
                const pane = $body.querySelector('.settings-pane');
                pane.querySelectorAll('.toggle').forEach(btn => {
                    const k = btn.dataset.opt;
                    btn.classList.toggle('on', !!settings[k]);
                    btn.addEventListener('click', async () => {
                        settings[k] = !settings[k];
                        btn.classList.toggle('on', settings[k]);
                        await ctx.storage.set('settings', settings);
                    });
                });
                const num = pane.querySelector('input[type="number"]');
                num.value = settings.tabWidth;
                num.addEventListener('change', async () => {
                    const v = Math.max(2, Math.min(8, parseInt(num.value, 10) || 4));
                    settings.tabWidth = v; num.value = v;
                    await ctx.storage.set('settings', settings);
                });
            }
        }

        function scheduleFileSave() {
            const d = active();
            if (!d || !backend) return;
            // Only autosave writable backends.
            if (!backend.isWritable()) return;
            $saveInd.textContent = 'saving…';
            if (fileSaveTimer) clearTimeout(fileSaveTimer);
            fileSaveTimer = setTimeout(async () => {
                try {
                    const path = d.id.slice(5);
                    await backend.writeFile(path, d.content || '');
                    $saveInd.textContent = 'saved';
                    setTimeout(() => { $saveInd.textContent = ''; }, 1400);
                } catch (e) {
                    console.warn('[grimoire] autosave failed', e);
                    $saveInd.textContent = 'save failed';
                }
            }, 450);
        }

        async function persistActive() {
            if (activeId && typeof activeId === 'string' && activeId.startsWith('file:')) {
                await ctx.storage.set('active', activeId);
            } else {
                await ctx.storage.set('active', null);
            }
        }

        // ── Menu ────────────────────────────────
        function renderMenu() {
            const items = [];
            if (backend && backend.kind === 'virtual') {
                items.push({ label: '⬇ Export as .zip', action: 'export-zip' });
                items.push({ label: '⬆ Import .zip',   action: 'import-zip' });
            }
            if (backend) items.push({ label: '✕ Close folder', action: 'close-folder' });
            $menuPop.innerHTML = items.length
                ? items.map(it => `<button class="menu-item" data-action="${it.action}">${escapeHTML(it.label)}</button>`).join('')
                : '<div class="menu-empty">No actions yet.</div>';
        }
        function toggleMenu(force) {
            const show = force ?? ($menuPop.style.display === 'none');
            $menuPop.style.display = show ? '' : 'none';
        }
        $menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
        document.addEventListener('click', (e) => {
            if (!$menuPop.contains(e.target) && e.target !== $menuBtn) toggleMenu(false);
        });
        $menuPop.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            toggleMenu(false);
            const action = btn.dataset.action;
            if (action === 'close-folder') await closeFolder();
            else if (action === 'export-zip') await exportZip();
            else if (action === 'import-zip') await importZip();
        });

        async function exportZip() {
            if (!backend || backend.kind !== 'virtual') return;
            const entries = [];
            (function walk(node) {
                if (!node) return;
                if (!node.isDir) { entries.push({ path: node.path, content: node.content || '' }); return; }
                for (const c of (node.children || [])) walk(c);
            })(tree);
            if (!entries.length) {
                try { await ctx.toast('Workspace is empty — nothing to export.', 'warning'); } catch {}
                return;
            }
            const bytes = encodeZip(entries);
            const blob = new Blob([bytes], { type: 'application/zip' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (backend.rootName() || 'workspace') + '.zip';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        async function importZip() {
            if (!backend || backend.kind !== 'virtual') return;
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.zip,application/zip';
            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                    const buf = new Uint8Array(await file.arrayBuffer());
                    const { entries, skippedCompressed } = decodeZip(buf);
                    if (!entries.length) {
                        try { await ctx.toast('No STORE-method entries found in .zip.', 'warning'); } catch {}
                        return;
                    }
                    // Build a fresh in-memory tree from the entries.
                    const rootName = file.name.replace(/\.zip$/i, '') || 'workspace';
                    const fresh = { name: rootName, path: '', isDir: true, children: [] };
                    const byPath = new Map([['', fresh]]);
                    for (const { path, content } of entries) {
                        const parts = path.split('/').filter(Boolean);
                        let cur = fresh, curPath = '';
                        for (let i = 0; i < parts.length; i++) {
                            const seg = parts[i];
                            const isFile = (i === parts.length - 1);
                            const p = curPath ? curPath + '/' + seg : seg;
                            if (isFile) {
                                cur.children.push({ name: seg, path: p, isDir: false, content });
                            } else {
                                let child = byPath.get(p);
                                if (!child) {
                                    child = { name: seg, path: p, isDir: true, children: [] };
                                    cur.children.push(child);
                                    byPath.set(p, child);
                                }
                                cur = child;
                                curPath = p;
                            }
                        }
                    }
                    sortChildren(fresh);
                    // Replace backend tree in place and persist.
                    backend._tree = fresh;
                    backend._name = rootName;
                    backend._persist();
                    tree = fresh;
                    expanded.clear();
                    _fileDocs.clear();
                    activeId = null;
                    updateHeaderControls();
                    renderFolderTree();
                    await renderBody();
                    await persistActive();
                    if (skippedCompressed) {
                        try { await ctx.toast(`Imported ${entries.length} file(s); skipped ${skippedCompressed} compressed entr${skippedCompressed === 1 ? 'y' : 'ies'} (only STORE method supported).`, 'warning'); } catch {}
                    }
                } catch (e) {
                    console.warn('[grimoire] zip import failed', e);
                    alert('Could not read .zip: ' + (e.message || e));
                }
            });
            input.click();
        }

        // ── Launcher (shown when no backend is active) ───────
        function showLauncher() {
            const canPicker = 'showDirectoryPicker' in window;
            const parts = [];
            if (canPicker) parts.push('<button class="launcher-btn" data-launch="disk">📁 Open real folder</button>');
            parts.push('<button class="launcher-btn" data-launch="virtual">📝 New virtual workspace</button>');
            if (!canPicker) parts.push('<button class="launcher-btn" data-launch="webkit">📁 Open folder (read-only)</button>');
            $folderTree.innerHTML = `
                <div class="launcher">
                    <div class="launcher-title">Open a workspace</div>
                    ${parts.join('')}
                    <div class="launcher-hint">${canPicker
                        ? 'Real folders sync to disk. Virtual workspaces live in your browser.'
                        : 'This browser lacks the File System Access API. Virtual workspaces are fully editable and can be exported as a .zip.'}</div>
                </div>
            `;
            $folderTree.querySelectorAll('[data-launch]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const kind = btn.dataset.launch;
                    if (kind === 'disk') await openDiskPicker();
                    else if (kind === 'webkit') openWebkitDirInput();
                    else if (kind === 'virtual') await openVirtualWorkspace();
                });
            });
        }

        function updateHeaderControls() {
            const writable = !!backend && backend.isWritable();
            $folderNewFile.style.display = writable ? '' : 'none';
            $folderNewDir.style.display  = writable ? '' : 'none';
            if (backend) {
                const prefix = backend.kind === 'virtual' ? '📝 ' : '📂 ';
                const suffix = backend.isWritable() ? '' : ' (read-only)';
                $folderLabel.textContent = prefix + backend.rootName() + suffix;
            } else {
                $folderLabel.textContent = '📁 Grimoire';
            }
            renderMenu();
        }

        async function setBackend(b) {
            backend = b;
            tree = await backend.list();
            expanded.clear();
            _fileDocs.clear();
            activeId = null;
            updateHeaderControls();
            renderFolderTree();
            await renderBody();
            await persistActive();
        }

        async function closeFolder() {
            // Virtual workspace persists automatically — clearing UI state
            // only; user's virtualFS stays in ctx.storage for next boot.
            backend = null; tree = null;
            expanded.clear();
            _fileDocs.clear();
            activeId = null;
            updateHeaderControls();
            showLauncher();
            await renderBody();
            await persistActive();
        }

        async function openDiskPicker() {
            try {
                const handle = await window.showDirectoryPicker();
                const b = new DiskBackend({ rootHandle: handle });
                showTreeMessage('Reading folder…');
                await setBackend(b);
            } catch (e) {
                if (e?.name === 'AbortError') return;
                console.error('[grimoire] picker blocked', e);
                showTreeMessage(`Folder read blocked (${e?.name || 'error'}: ${e?.message || 'unknown'})`, true);
            }
        }

        function openWebkitDirInput() {
            const input = document.createElement('input');
            input.type = 'file';
            input.webkitdirectory = true;
            input.multiple = true;
            input.addEventListener('change', async () => {
                const files = Array.from(input.files || []);
                if (!files.length) { showTreeMessage('No files in folder.', false); return; }
                const rootName = files[0].webkitRelativePath.split('/')[0] || 'folder';
                const b = new DiskBackend({ fallbackFiles: files, rootNameFallback: rootName });
                await setBackend(b);
            });
            input.click();
        }

        async function openVirtualWorkspace(initial) {
            const b = new VirtualBackend(ctx, initial);
            await setBackend(b);
            // Ensure an initial persist so reloads pick it up.
            b._persist();
        }

        function showTreeMessage(msg, isErr) {
            $folderTree.innerHTML = `<div class="ftree-empty" style="${isErr ? 'color:#fb7185;' : ''}">${escapeHTML(msg)}</div>`;
        }

        // ── Tree render ───────────────────────────
        function renderFolderTree() {
            if (!tree) { showLauncher(); return; }
            $folderTree.innerHTML = renderNode(tree, 0, true);
            wireTreeInteractions();
        }
        function renderNode(node, depth, isRoot) {
            const canWrite = backend?.isWritable();
            if (node.isDir) {
                const collapsed = !isRoot && !expanded.has(node.path);
                const kids = (node.children || []).map(c => renderNode(c, depth + 1, false)).join('');
                const actions = canWrite ? `
                    <button class="ftree-act" data-action="new-file" data-path="${escapeHTML(node.path)}" title="New file here">📄＋</button>
                    <button class="ftree-act" data-action="new-dir"  data-path="${escapeHTML(node.path)}" title="New folder here">📁＋</button>
                ` : '';
                return `
                    <div class="ftree-dir ${collapsed ? 'is-collapsed' : ''}" data-path="${escapeHTML(node.path)}">
                        <div class="ftree-item ftree-drop" data-kind="dir" data-path="${escapeHTML(node.path)}">
                            <span class="ftree-chev">▾</span>
                            <span class="ftree-icon">${isRoot ? '📂' : '📁'}</span>
                            <span class="ftree-name">${escapeHTML(node.name)}</span>
                            ${actions}
                        </div>
                        <div class="ftree-children">${kids || '<div class="ftree-empty">empty</div>'}</div>
                    </div>
                `;
            } else {
                const isActive = activeId === 'file:' + node.path;
                return `
                    <div class="ftree-file" data-path="${escapeHTML(node.path)}">
                        <div class="ftree-item ${isActive ? 'ftree-active' : ''}" data-kind="file" data-path="${escapeHTML(node.path)}" ${canWrite ? 'draggable="true"' : ''}>
                            <span class="ftree-chev"></span>
                            <span class="ftree-icon">📄</span>
                            <span class="ftree-name">${escapeHTML(node.name)}</span>
                        </div>
                    </div>
                `;
            }
        }
        function wireTreeInteractions() {
            $folderTree.querySelectorAll('.ftree-item').forEach(el => {
                el.addEventListener('click', async (e) => {
                    const act = e.target.closest('.ftree-act');
                    if (act) {
                        e.stopPropagation();
                        const action = act.dataset.action;
                        const path = act.dataset.path;
                        if (action === 'new-file') await promptAndCreateFile(path);
                        else if (action === 'new-dir') await promptAndCreateDir(path);
                        return;
                    }
                    const path = el.dataset.path;
                    if (el.dataset.kind === 'dir') {
                        const dir = el.closest('.ftree-dir');
                        if (dir && !dir.classList.contains('is-root')) {
                            const wasCollapsed = dir.classList.toggle('is-collapsed');
                            if (wasCollapsed) expanded.delete(path);
                            else expanded.add(path);
                        }
                    } else {
                        await openFileFromTree(path);
                    }
                });
                if (el.getAttribute('draggable') === 'true') {
                    el.addEventListener('dragstart', (e) => {
                        e.dataTransfer.setData('text/grimoire-path', el.dataset.path);
                        e.dataTransfer.effectAllowed = 'move';
                        el.classList.add('ftree-dragging');
                    });
                    el.addEventListener('dragend', () => el.classList.remove('ftree-dragging'));
                }
                if (el.classList.contains('ftree-drop')) {
                    el.addEventListener('dragover', (e) => {
                        if (!e.dataTransfer.types.includes('text/grimoire-path')) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        el.classList.add('ftree-dragover');
                    });
                    el.addEventListener('dragleave', () => el.classList.remove('ftree-dragover'));
                    el.addEventListener('drop', async (e) => {
                        el.classList.remove('ftree-dragover');
                        const srcPath = e.dataTransfer.getData('text/grimoire-path');
                        if (!srcPath) return;
                        e.preventDefault();
                        await doMove(srcPath, el.dataset.path);
                    });
                }
            });
        }

        async function refreshTree() {
            if (!backend) return;
            tree = await backend.list();
            renderFolderTree();
        }

        async function promptAndCreateFile(parentPath) {
            const name = window.prompt('New file name (e.g. notes.md)');
            if (!name || !name.trim()) return;
            try {
                const newPath = await backend.createFile(parentPath, name.trim());
                expanded.add(parentPath);
                await refreshTree();
                await openFileFromTree(newPath);
            } catch (e) { alert('Could not create file: ' + (e.message || e)); }
        }
        async function promptAndCreateDir(parentPath) {
            const name = window.prompt('New folder name');
            if (!name || !name.trim()) return;
            try {
                const newPath = await backend.createDir(parentPath, name.trim());
                expanded.add(parentPath);
                expanded.add(newPath);
                await refreshTree();
            } catch (e) { alert('Could not create folder: ' + (e.message || e)); }
        }
        async function doMove(fromPath, toParentPath) {
            try {
                await backend.moveNode(fromPath, toParentPath);
                await refreshTree();
            } catch (e) { alert('Could not move: ' + (e.message || e)); }
        }

        async function openFileFromTree(path) {
            if (!backend) return;
            const content = await backend.readFile(path);
            const name = path.split('/').pop();
            const title = name.replace(/\.[^.]+$/, '');
            const lang = langFromFilename(name);
            _fileDocs.set(path, {
                id: 'file:' + path,
                title: name,
                lang,
                content,
                updatedAt: Date.now(),
                displayTitle: title,
            });
            activeId = 'file:' + path;
            view = 'edit';
            $tabs.forEach(x => x.classList.toggle('active', x.dataset.view === 'edit'));
            renderFolderTree();
            await renderBody();
            await persistActive();
        }

        // ── Sidebar buttons ────────────────────
        $folderLabel.addEventListener('click', () => {
            if (!backend) showLauncher();
        });
        $folderNewFile.addEventListener('click', () => { if (backend) promptAndCreateFile(''); });
        $folderNewDir.addEventListener('click',  () => { if (backend) promptAndCreateDir(''); });

        $title.addEventListener('input', () => {
            const d = active(); if (!d) return;
            d.title = $title.value; d.updatedAt = Date.now();
        });
        $lang.addEventListener('change', () => {
            const d = active(); if (!d) return;
            d.lang = $lang.value; d.updatedAt = Date.now();
            if (view === 'preview') renderBody();
            else if (view === 'edit') updateHighlight();
        });
        $tabs.forEach(t => t.addEventListener('click', async () => {
            $tabs.forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            view = t.dataset.view;
            await renderBody();
        }));

        // ── Boot ────────────────────────────────
        updateHeaderControls();
        // Auto-restore a saved virtual workspace if present.
        const savedVirtual = await ctx.storage.get('virtualFS');
        if (savedVirtual && savedVirtual.tree) {
            await openVirtualWorkspace(savedVirtual);
        } else {
            activeId = null;
            await persistActive();
            showLauncher();
            await renderBody();
        }

        // ── Handoff consumption (e.g. "Open in Grimoire" from File Explorer) ──
        // Host writes { type:'file', name, content, mime } to localStorage
        // under `aruta_handoff_grimoire` before opening our window. We consume
        // it exactly once: route into the current virtual workspace (creating
        // one if needed) and clear the key.
        try {
            const raw = localStorage.getItem('aruta_handoff_grimoire');
            if (raw) {
                localStorage.removeItem('aruta_handoff_grimoire');
                const payload = JSON.parse(raw);
                if (payload && payload.type === 'file' && typeof payload.name === 'string') {
                    const content = typeof payload.content === 'string' ? payload.content : '';
                    if (!(backend instanceof VirtualBackend)) {
                        const existing = await ctx.storage.get('virtualFS');
                        await openVirtualWorkspace(existing || { name: 'inbox', tree: { name: 'inbox', path: '', isDir: true, children: [] } });
                    }
                    // Unique filename if collision.
                    let name = payload.name;
                    const root = backend._tree;
                    if (root.children.some(c => c.name === name)) {
                        const dot = name.lastIndexOf('.');
                        const base = dot > 0 ? name.slice(0, dot) : name;
                        const ext  = dot > 0 ? name.slice(dot) : '';
                        let n = 1;
                        while (root.children.some(c => c.name === base + '-' + n + ext)) n++;
                        name = base + '-' + n + ext;
                    }
                    const newPath = await backend.createFile('', name);
                    await backend.writeFile(newPath, content);
                    tree = await backend.list();
                    renderFolderTree();
                    ctx.toast?.('Opened ' + name + ' from File Explorer', 'info');
                }
            }
        } catch (e) { console.warn('[grimoire] handoff failed', e); }
    }
};
