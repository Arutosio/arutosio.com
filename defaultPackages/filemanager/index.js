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
function validName(name) {
    name = String(name || '').trim();
    return !!name && name !== '.' && name !== '..' && !/[/\x00-\x1f\x7f]/.test(name);
}

// ── File icons (curated vscode-icons subset, MIT) ────────────────
// Sources are loaded from the package (icons/<id>.svg); fall back to
// the legacy emoji when an asset is unavailable.
const ICON_EXT = {
    "js": "js",
    "mjs": "js",
    "cjs": "js",
    "jsx": "reactjs",
    "ts": "typescript",
    "tsx": "reactts",
    "mts": "typescript",
    "cts": "typescript",
    "json": "json",
    "json5": "json",
    "jsonc": "json",
    "jsonl": "json",
    "ndjson": "json",
    "html": "html",
    "htm": "html",
    "xhtml": "html",
    "css": "css",
    "pcss": "css",
    "postcss": "css",
    "scss": "scss",
    "sass": "sass",
    "less": "less",
    "yaml": "yaml",
    "yml": "yaml",
    "toml": "toml",
    "xml": "xml",
    "svg": "svg",
    "png": "image",
    "jpg": "image",
    "jpeg": "image",
    "gif": "image",
    "webp": "image",
    "ico": "image",
    "bmp": "image",
    "avif": "image",
    "tif": "image",
    "tiff": "image",
    "mp4": "video",
    "webm": "video",
    "mov": "video",
    "mkv": "video",
    "avi": "video",
    "m4v": "video",
    "mp3": "audio",
    "wav": "audio",
    "ogg": "audio",
    "flac": "audio",
    "m4a": "audio",
    "aac": "audio",
    "pdf": "pdf",
    "zip": "zip",
    "tar": "zip",
    "gz": "zip",
    "tgz": "zip",
    "bz2": "zip",
    "xz": "zip",
    "rar": "zip",
    "7z": "zip",
    "zst": "zip",
    "woff": "font",
    "woff2": "font",
    "ttf": "font",
    "otf": "font",
    "eot": "font",
    "csv": "csv",
    "xls": "excel",
    "xlsx": "excel",
    "ods": "excel",
    "doc": "word",
    "docx": "word",
    "odt": "word",
    "rtf": "word",
    "ppt": "powerpoint",
    "pptx": "powerpoint",
    "odp": "powerpoint",
    "py": "python",
    "pyw": "python",
    "pyi": "python",
    "rb": "ruby",
    "rake": "ruby",
    "gemspec": "ruby",
    "go": "go",
    "rs": "rust",
    "java": "java",
    "kt": "kotlin",
    "kts": "kotlin",
    "swift": "swift",
    "cs": "csharp",
    "fs": "csharp",
    "vb": "csharp",
    "c": "cpp",
    "cc": "cpp",
    "cpp": "cpp",
    "cxx": "cpp",
    "hpp": "cppheader",
    "h": "cppheader",
    "php": "php",
    "phtml": "php",
    "sql": "sql",
    "sqlite": "sqlite",
    "sqlite3": "sqlite",
    "db": "db",
    "sh": "shell",
    "bash": "shell",
    "zsh": "shell",
    "fish": "shell",
    "ksh": "shell",
    "ps1": "shell",
    "psm1": "shell",
    "bat": "shell",
    "cmd": "shell",
    "dockerfile": "docker",
    "dockerignore": "docker",
    "gitignore": "git",
    "gitattributes": "git",
    "gitmodules": "git",
    "gitkeep": "git",
    "npmrc": "npm",
    "npmignore": "npm",
    "nvmrc": "node",
    "lock": "config",
    "cfg": "ini",
    "conf": "config",
    "config": "config",
    "ini": "ini",
    "md": "markdown",
    "markdown": "markdown",
    "mdown": "markdown",
    "mdx": "markdown",
    "rst": "text",
    "txt": "text",
    "log": "log",
    "env": "env",
    "editorconfig": "editorconfig",
    "graphql": "graphql",
    "gql": "graphql",
    "prisma": "prisma",
    "wasm": "wasm",
    "tf": "terraform",
    "tfvars": "terraform",
    "tfstate": "terraform",
    "vue": "vue",
    "svelte": "svelte",
    "astro": "astro",
    "cmake": "cmake",
    "gradle": "gradle",
    "pom": "maven",
    "mysql": "mysql",
    "pgsql": "pgsql",
};
const ICON_COMPOUND = {
    "d.ts": "typescriptdef",
    "d.mts": "typescriptdef",
    "d.cts": "typescriptdef",
    "tar.gz": "zip",
    "tar.bz2": "zip",
    "tar.xz": "zip",
    "tar.zst": "zip",
    "min.js": "js",
    "min.css": "css",
    "min.mjs": "js",
};
const ICON_NAMES = {
    "package.json": "npm",
    "package-lock.json": "npm",
    "npm-shrinkwrap.json": "npm",
    "yarn.lock": "yarn",
    "pnpm-lock.yaml": "pnpm",
    "pnpm-workspace.yaml": "pnpm",
    "tsconfig.json": "tsconfig",
    "jsconfig.json": "jsconfig",
    "dockerfile": "docker",
    "docker-compose.yml": "docker",
    "docker-compose.yaml": "docker",
    "compose.yml": "docker",
    "compose.yaml": "docker",
    ".dockerignore": "docker",
    "makefile": "cmake",
    "gnumakefile": "cmake",
    "cmakelists.txt": "cmake",
    "go.mod": "go",
    "go.sum": "go",
    "go.work": "go",
    "cargo.toml": "rust",
    "cargo.lock": "rust",
    "requirements.txt": "python",
    "pyproject.toml": "python",
    "pipfile": "python",
    "pipfile.lock": "python",
    "setup.py": "python",
    "setup.cfg": "python",
    "tox.ini": "python",
    "gemfile": "ruby",
    "gemfile.lock": "ruby",
    "rakefile": "ruby",
    "composer.json": "php",
    "composer.lock": "php",
    "pom.xml": "maven",
    "build.gradle": "gradle",
    "settings.gradle": "gradle",
    "gradlew": "gradle",
    "readme": "readme",
    "readme.md": "readme",
    "readme.txt": "readme",
    "readme.rst": "readme",
    "license": "license",
    "license.md": "license",
    "license.txt": "license",
    "copying": "license",
    "copying.md": "license",
    "notice": "license",
    ".editorconfig": "editorconfig",
    ".gitignore": "git",
    ".gitattributes": "git",
    ".gitmodules": "git",
    ".gitkeep": "git",
    ".npmrc": "npm",
    ".nvmrc": "node",
    ".bashrc": "shell",
    ".zshrc": "shell",
    ".bash_profile": "shell",
    ".profile": "shell",
    ".zprofile": "shell",
    ".htaccess": "config",
    "nginx.conf": "config",
    "vite.config.js": "config",
    "vite.config.ts": "config",
    "vite.config.mjs": "config",
    "webpack.config.js": "config",
    "webpack.config.ts": "config",
    "rollup.config.js": "config",
    "rollup.config.ts": "config",
    "next.config.js": "config",
    "next.config.ts": "config",
    "next.config.mjs": "config",
    "nuxt.config.ts": "config",
    "svelte.config.js": "config",
    "astro.config.mjs": "config",
    "tailwind.config.js": "config",
    "tailwind.config.ts": "config",
    "postcss.config.js": "config",
    "postcss.config.cjs": "config",
    "babel.config.js": "config",
    ".babelrc": "config",
    "jest.config.js": "config",
    "jest.config.ts": "config",
    "vitest.config.ts": "config",
    "playwright.config.ts": "config",
    "eslint.config.js": "config",
    "eslint.config.mjs": "config",
    ".eslintrc": "config",
    ".prettierrc": "config",
    "prettier.config.js": "config",
};
const ICON_PREFIXES = [
    [
        "dockerfile",
        "docker"
    ],
    [
        "docker-compose",
        "docker"
    ],
    [
        ".env",
        "env"
    ],
    [
        "tsconfig.",
        "tsconfig"
    ],
    [
        "jsconfig.",
        "jsconfig"
    ],
    [
        "eslint.config.",
        "config"
    ],
    [
        ".eslintrc",
        "config"
    ],
    [
        "prettier.config.",
        "config"
    ],
    [
        ".prettierrc",
        "config"
    ],
    [
        "vite.config.",
        "config"
    ],
    [
        "webpack.config.",
        "config"
    ],
    [
        "rollup.config.",
        "config"
    ],
    [
        "next.config.",
        "config"
    ],
    [
        "nuxt.config.",
        "config"
    ],
    [
        "svelte.config.",
        "config"
    ],
    [
        "astro.config.",
        "config"
    ],
    [
        "tailwind.config.",
        "config"
    ],
    [
        "postcss.config.",
        "config"
    ],
    [
        "babel.config.",
        "config"
    ],
    [
        "jest.config.",
        "config"
    ],
    [
        "vitest.config.",
        "config"
    ],
    [
        "playwright.config.",
        "config"
    ],
    [
        "gemfile",
        "ruby"
    ],
    [
        "cargo.",
        "rust"
    ],
    [
        "go.",
        "go"
    ]
];
const ICON_FOLDERS = {
    "src": "folder-src",
    "source": "folder-src",
    "node_modules": "folder-node",
    "node": "folder-node",
    ".git": "folder-git",
    "git": "folder-git",
    ".github": "folder-github",
    "github": "folder-github",
    "config": "folder-config",
    "configs": "folder-config",
    ".config": "folder-config",
    "test": "folder-test",
    "tests": "folder-test",
    "__tests__": "folder-test",
    "spec": "folder-test",
    "specs": "folder-test",
    "docs": "folder-docs",
    "doc": "folder-docs",
    "documentation": "folder-docs",
    "public": "folder-public",
    "static": "folder-public",
    "assets": "folder-asset",
    "asset": "folder-asset",
    "images": "folder-images",
    "image": "folder-images",
    "img": "folder-images",
    "media": "folder-images",
    "css": "folder-css",
    "styles": "folder-style",
    "style": "folder-style",
    "scss": "folder-sass",
    "sass": "folder-sass",
    "js": "folder-js",
    "json": "folder-json",
    "scripts": "folder-script",
    "script": "folder-script",
    "dist": "folder-dist",
    "build": "folder-dist",
    "out": "folder-dist",
    "coverage": "folder-dist",
    "components": "folder-component",
    "component": "folder-component",
    "hooks": "folder-hook",
    "hook": "folder-hook",
    "lib": "folder-library",
    "libs": "folder-library",
    "library": "folder-library",
    "packages": "folder-package",
    "package": "folder-package",
    "packages-local": "folder-package",
    "server": "folder-server",
    "backend": "folder-server",
    "api": "folder-server",
    "video": "folder-video",
    "videos": "folder-video",
    "audio": "folder-audio",
    "sounds": "folder-audio",
    "music": "folder-audio",
    "bin": "folder-binary",
    "binary": "folder-binary",
};
const ICON_FOLDER_OPEN = new Set([
    "folder",
    "folder-asset",
    "folder-audio",
    "folder-binary",
    "folder-component",
    "folder-config",
    "folder-css",
    "folder-dist",
    "folder-docs",
    "folder-git",
    "folder-github",
    "folder-hook",
    "folder-images",
    "folder-js",
    "folder-json",
    "folder-library",
    "folder-node",
    "folder-package",
    "folder-public",
    "folder-sass",
    "folder-script",
    "folder-server",
    "folder-src",
    "folder-style",
    "folder-test",
    "folder-video"
]);

function fileIconId(name, opts = {}) {
    if (opts.symlink) return 'link';
    const lower = String(name || '').toLowerCase();
    if (ICON_NAMES[lower]) return ICON_NAMES[lower];
    for (const [prefix, id] of ICON_PREFIXES) {
        if (lower.startsWith(prefix)) return id;
    }
    const parts = lower.split('.');
    for (let n = Math.min(3, parts.length - 1); n >= 1; n--) {
        const suffix = parts.slice(-n).join('.');
        if (ICON_COMPOUND[suffix]) return ICON_COMPOUND[suffix];
        if (ICON_EXT[suffix]) return ICON_EXT[suffix];
    }
    return 'file';
}

function folderIconId(name, open, root) {
    if (root) return open ? 'folder-root-open' : 'folder-root';
    const base = ICON_FOLDERS[String(name || '').toLowerCase()] || 'folder';
    return open && ICON_FOLDER_OPEN.has(base) ? base + '-open' : base;
}

function iconHTML(ctx, id, cls, fallback = '') {
    const url = ctx?.asset?.('icons/' + id + '.svg');
    if (!url) return fallback;
    return `<img class="${cls}" src="${url}" alt="" aria-hidden="true" loading="lazy" decoding="async">`;
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
            this._saveTimer = null;
            this.flush().catch(e => console.warn('[filemanager] persist', e));
        }, 200);
    }
    async flush() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        await this.ctx.storage.set(VirtualBackend.key, this._tree);
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
        if (newName === n.name) return;
        const parentPath = path.split('/').slice(0, -1).join('/');
        const parent = this._find(parentPath);
        if (parent && parent.children.some(c => c !== n && c.name === newName)) throw new Error('exists');
        const np = parentPath ? parentPath + '/' + newName : newName;
        const rewrite = (node, newPath) => {
            node.name = newPath.split('/').pop() || newPath;
            node.path = newPath;
            if (node.isDir) for (const c of node.children) rewrite(c, newPath ? newPath + '/' + c.name : c.name);
        };
        rewrite(n, np);
        this._persist();
    }
    async move(path, destDir) {
        const node = this._find(path);
        const dest = this._find(destDir || '');
        if (!node || !dest || !dest.isDir) throw new Error('no_parent');
        const parentPath = path.split('/').slice(0, -1).join('/');
        if (parentPath === (destDir || '')) return;
        if (node.isDir && ((destDir || '') === path || (destDir || '').startsWith(path + '/'))) {
            throw new Error('cannot_move_into_self');
        }
        if (dest.children.some(c => c.name === node.name)) throw new Error('exists');
        const parent = this._find(parentPath);
        if (!parent) throw new Error('no_parent');
        parent.children = parent.children.filter(c => c !== node);
        const np = destDir ? destDir + '/' + node.name : node.name;
        const rewrite = (n, p) => {
            n.path = p;
            if (n.isDir) for (const c of n.children) rewrite(c, p ? p + '/' + c.name : c.name);
        };
        rewrite(node, np);
        dest.children.push(node);
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
        const items = await this.ctx.profile.list(parentPath);
        if (items.some(it => it.name === newName)) throw new Error('exists');
        const np = parentPath ? parentPath + '/' + newName : newName;
        const r = await this.ctx.profile.read(path);
        await this.ctx.profile.write(np, r.bytes, r.mime);
        await this.ctx.profile.remove(path);
    }
    async move(path, destDir) {
        const name = path.split('/').pop();
        const parentPath = path.split('/').slice(0, -1).join('/');
        if (parentPath === (destDir || '')) return;
        const items = await this.ctx.profile.list(destDir || '');
        if (items.some(it => it.name === name)) throw new Error('exists');
        const r = await this.ctx.profile.read(path);
        const np = destDir ? destDir + '/' + name : name;
        await this.ctx.profile.write(np, r.bytes, r.mime);
        await this.ctx.profile.remove(path);
    }
}

// ── Machine backend (arutosiod via ctx.fs) ──────────────────────────────
class MachineBackend {
    constructor(ctx) { this.ctx = ctx; }
    get kind() { return 'machine'; }
    isWritable() { return true; }
    async list(path) {
        const r = await this.ctx.fs.list(path || '');
        return sortEntries((r.entries || []).map(it => ({
            name: it.name,
            kind: it.kind === 'dir' ? 'dir' : 'file',
            size: it.size || 0,
            mime: it.kind === 'file' ? mimeFromName(it.name) : '',
            symlink: it.kind === 'symlink',
            link: it.link || '',
        })));
    }
    async readFile(path, max) {
        const r = await this.ctx.fs.read(path, max || 0);
        return {
            bytes: r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes || []),
            mime: r.mime || mimeFromName(path),
            etag: r.etag || '',
        };
    }
    async writeFile(path, bytes, mime, etag) {
        const data = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes || '');
        return await this.ctx.fs.write(path, data, etag || '');
    }
    async createFile(parentPath, name, content) {
        const np = parentPath ? parentPath + '/' + name : name;
        const data = content instanceof Uint8Array ? content : new TextEncoder().encode(content || '');
        // '*' is create-only: never clobber an existing machine file.
        await this.ctx.fs.write(np, data, '*');
        return np;
    }
    async createDir(parentPath, name) {
        const np = parentPath ? parentPath + '/' + name : name;
        await this.ctx.fs.mkdir(np);
    }
    async deleteNode(path) {
        await this.ctx.fs.delete(path, { trash: true });
    }
    async rename(path, newName) {
        const parentPath = path.split('/').slice(0, -1).join('/');
        const np = parentPath ? parentPath + '/' + newName : newName;
        await this.ctx.fs.rename(path, np);
    }
    async move(path, destDir) {
        const name = path.split('/').pop();
        const parentPath = path.split('/').slice(0, -1).join('/');
        if (parentPath === (destDir || '')) return;
        const np = destDir ? destDir + '/' + name : name;
        await this.ctx.fs.rename(path, np);
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
        const existing = await dir.getFileHandle(newName, { create: false })
            .then(() => true)
            .catch(e => e?.name === 'TypeMismatchError');
        if (existing) throw new Error('exists');
        const f = await oldFH.getFile();
        const bytes = new Uint8Array(await f.arrayBuffer());
        const newFH = await dir.getFileHandle(newName, { create: true });
        const w = await newFH.createWritable();
        await w.write(bytes); await w.close();
        await dir.removeEntry(oldName);
    }
    async move(path, destDir) {
        const name = path.split('/').pop();
        const parentPath = path.split('/').slice(0, -1).join('/');
        if (parentPath === (destDir || '')) return;
        const dest = await this._dir(destDir || '');
        const existing = await dest.getFileHandle(name, { create: false })
            .then(() => true)
            .catch(e => e?.name === 'TypeMismatchError');
        if (existing) throw new Error('exists');
        let data;
        try { data = await this.readFile(path); }
        catch { throw new Error('directory_move_unsupported'); }
        const np = destDir ? destDir + '/' + name : name;
        await this.writeFile(np, data.bytes, data.mime);
        await this.deleteNode(path);
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
        const SOURCES = ctx.local ? [
            { id: 'machine',  icon: '🖥', label: 'This machine' },
            { id: 'virtual',  icon: '📝', label: 'Virtual' },
            { id: 'packages', icon: '📦', label: 'Packages' },
        ] : [
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
                    <input id="fm-search" class="fm-search" type="search" placeholder="Filter…" aria-label="Filter files">
                    <select id="fm-sort" class="fm-sort" aria-label="Sort files">
                        <option value="name">Name A–Z</option>
                        <option value="name-desc">Name Z–A</option>
                        <option value="size">Size</option>
                    </select>
                    <span class="fm-spacer"></span>
                    <span class="fm-breadcrumb" id="fm-crumb">/</span>
                    <button class="fm-btn fm-toggle-preview" data-act="togglePreview" title="Toggle preview">👁</button>
                    <button class="fm-btn" data-act="settings" title="Files settings" aria-label="Files settings">⚙</button>
                </div>
                <aside class="fm-sources" id="fm-sources">
                    ${SOURCES.map(s => `<div class="fm-source" data-source="${s.id}"><span class="fm-source-icon">${s.icon}</span>${s.label}</div>`).join('')}
                </aside>
                <section class="fm-tree" id="fm-tree"><div class="fm-empty">Select a source…</div></section>
                <aside class="fm-preview" id="fm-preview"><div class="fm-empty">Select a file to preview.</div></aside>
                <aside class="fm-settings" id="fm-settings" hidden>
                    <div class="fm-set-head">
                        <strong>Files settings</strong>
                        <button class="fm-btn" data-act="closeSettings" title="Close">✕</button>
                    </div>
                    <label class="fm-set-row">
                        <span>File preview</span>
                        <input type="checkbox" id="fm-set-preview">
                    </label>
                    <small>Show the preview pane. Off keeps the list wider.</small>
                    <label class="fm-set-row">
                        <span>Hidden files</span>
                        <input type="checkbox" id="fm-set-hidden">
                    </label>
                    <small>Names starting with a dot, like .gitignore.</small>
                    <label class="fm-set-row" for="fm-set-start"><span>Start folder</span></label>
                    <input id="fm-set-start" class="fm-set-input" placeholder="e.g. projects/site" spellcheck="false">
                    <small>Opened when you switch source. Relative to the source root.</small>
                    <label class="fm-set-row" for="fm-set-path"><span>Go to path</span></label>
                    <div class="fm-set-go">
                        <input id="fm-set-path" class="fm-set-input" placeholder="/" spellcheck="false">
                        <button class="fm-btn" data-act="goPath">Go</button>
                    </div>
                </aside>
            </div>
        `;

        const $tree    = root.querySelector('#fm-tree');
        const $preview = root.querySelector('#fm-preview');
        const $crumb   = root.querySelector('#fm-crumb');
        const $shell   = root.querySelector('.fm-shell');
        const $settings = root.querySelector('#fm-settings');
        const $uploadInput = root.querySelector('#fm-upload-input');

        let backend = null;
        let currentSource = null;
        let cwd = '';
        let selected = null;  // { name, kind, size, mime } relative to cwd
        let previewURL = null;
        let previewToken = 0;
        let currentItems = [];
        let filterText = '';
        let sortMode = 'name';

        const DEFAULT_SETTINGS = { preview: true, hidden: false, startPath: '' };
        let settings = { ...DEFAULT_SETTINGS };
        try {
            const saved = await ctx.storage.get('settings');
            if (saved && typeof saved === 'object') settings = { ...DEFAULT_SETTINGS, ...saved };
        } catch (e) { console.warn('[filemanager] settings', e); }

        function saveSettings() {
            Promise.resolve(ctx.storage.set('settings', settings)).catch((e) => console.warn('[filemanager] settings', e));
        }

        function applySettings() {
            $shell.classList.toggle('fm-no-preview', !settings.preview);
            if (!settings.preview) {
                $shell.classList.remove('fm-preview-open');
                resetPreview();
            }
            const $p = root.querySelector('#fm-set-preview');
            const $h = root.querySelector('#fm-set-hidden');
            if ($p) $p.checked = !!settings.preview;
            if ($h) $h.checked = !!settings.hidden;
        }

        // Paths are source-root relative; ".." would escape the root.
        function normalizePath(raw) {
            const parts = String(raw || '').replace(/\\/g, '/').split('/').filter(p => p && p !== '.');
            if (parts.includes('..')) return null;
            return parts.join('/');
        }

        async function goToPath(raw) {
            if (!backend) return false;
            const path = normalizePath(raw);
            if (path === null) {
                ctx.toast?.('Path cannot contain ".."', 'error');
                return false;
            }
            try {
                await backend.list(path);
            } catch (e) {
                ctx.toast?.('Cannot open "' + (path || '/') + '": ' + (e.message || e), 'error');
                return false;
            }
            cwd = path;
            selected = null;
            resetPreview();
            await refresh();
            const $path = root.querySelector('#fm-set-path');
            if ($path) $path.value = cwd;
            return true;
        }

        // ── Source switching ──────────────────────────────────
        async function selectSource(id) {
            if (backend?.kind === 'virtual') {
                try { await backend.flush(); } catch (e) { console.warn('[filemanager] flush', e); }
            }
            currentSource = id; cwd = ''; selected = null;
            filterText = '';
            const search = root.querySelector('#fm-search');
            if (search) search.value = '';
            resetPreview();
            root.querySelectorAll('.fm-source').forEach(el => el.classList.toggle('active', el.dataset.source === id));
            try {
                if (id === 'machine') {
                    backend = new MachineBackend(ctx);
                } else if (id === 'virtual') {
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
                if (settings.startPath) {
                    try { await backend.list(settings.startPath); cwd = settings.startPath; } catch {}
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
            renderBreadcrumb();
        }

        function renderBreadcrumb() {
            const segs = cwd ? cwd.split('/') : [];
            let html = `<span class="fm-crumb-seg" data-crumb="">/</span>`;
            segs.forEach((seg, i) => {
                const p = segs.slice(0, i + 1).join('/');
                if (i > 0) html += `<span class="fm-crumb-sep">/</span>`;
                html += `<span class="fm-crumb-seg" data-crumb="${escapeHTML(p)}">${escapeHTML(seg)}</span>`;
            });
            $crumb.innerHTML = html;
            $crumb.querySelectorAll('[data-crumb]').forEach(el => {
                el.addEventListener('click', async () => {
                    cwd = el.dataset.crumb;
                    selected = null;
                    resetPreview();
                    await refresh();
                });
                el.addEventListener('dragover', (ev) => {
                    if (!hasInternalDrag(ev) && !hasFileDrag(ev)) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    el.classList.add('fm-crumb-drop');
                });
                el.addEventListener('dragleave', () => el.classList.remove('fm-crumb-drop'));
                el.addEventListener('drop', async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    el.classList.remove('fm-crumb-drop');
                    const payload = readDragPayload(ev);
                    if (payload) { await moveEntry(payload, el.dataset.crumb); return; }
                    if (hasFileDrag(ev)) await uploadDataTransfer(ev.dataTransfer, el.dataset.crumb);
                });
            });
        }

        async function nameExists(b, parentPath, name) {
            if (b?.kind === 'machine') {
                try {
                    await ctx.fs.stat(parentPath ? parentPath + '/' + name : name);
                    return true;
                } catch { return false; }
            }
            try {
                const items = await b.list(parentPath || '');
                return items.some(it => it.name === name);
            } catch { return false; }
        }

        const INTERNAL_MIME = 'application/x-arutosio-file';
        function hasInternalDrag(ev) {
            return Array.from(ev.dataTransfer?.types || []).includes(INTERNAL_MIME);
        }
        function hasFileDrag(ev) {
            return Array.from(ev.dataTransfer?.types || []).includes('Files');
        }
        function readDragPayload(ev) {
            try { return JSON.parse(ev.dataTransfer?.getData(INTERNAL_MIME) || 'null'); } catch { return null; }
        }

        async function uploadOneFile(f, destDir, name) {
            const displayName = name || f.name;
            const np = destDir ? destDir + '/' + displayName : displayName;
            let exists = await nameExists(backend, destDir, displayName);
            if (exists && !confirm(`Overwrite "${displayName}"?`)) return false;
            try {
                if (backend.kind === 'machine' && ctx.fs.upload) {
                    await ctx.fs.upload(np, f, exists);
                } else {
                    const bytes = new Uint8Array(await f.arrayBuffer());
                    const mime = f.type || mimeFromName(displayName);
                    if (exists) await backend.writeFile(np, bytes, mime);
                    else await backend.createFile(destDir, displayName, bytes);
                }
                return true;
            } catch (e) {
                const msg = String(e.message || e);
                if (!exists && /exists|already exists|409/i.test(msg) && confirm(`Overwrite "${displayName}"?`)) {
                    if (backend.kind === 'machine' && ctx.fs.upload) {
                        await ctx.fs.upload(np, f, true);
                    } else {
                        const bytes = new Uint8Array(await f.arrayBuffer());
                        await backend.writeFile(np, bytes, f.type || mimeFromName(displayName));
                    }
                    return true;
                }
                throw e;
            }
        }

        async function uploadDirectory(entry, destDir, depth = 0, budget = { n: 0 }) {
            if (depth > 20) throw new Error('folder nested too deeply');
            const name = entry.name;
            const path = destDir ? destDir + '/' + name : name;
            const exists = await nameExists(backend, destDir, name);
            if (!exists) {
                try { await backend.createDir(destDir, name); }
                catch (e) {
                    if (!/exists/i.test(String(e.message || e))) throw e;
                }
            }
            const reader = entry.createReader();
            while (true) {
                const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
                if (!batch.length) break;
                for (const child of batch) {
                    budget.n++;
                    if (budget.n > 5000) throw new Error('too many files in the dropped folder');
                    if (child.isFile) {
                        const file = await new Promise((res, rej) => child.file(res, rej));
                        await uploadOneFile(file, path, child.name);
                    } else if (child.isDirectory) {
                        await uploadDirectory(child, path, depth + 1, budget);
                    }
                }
            }
        }

        async function uploadDataTransfer(dt, destDir) {
            if (!backend?.isWritable?.() || currentSource === 'packages') return;
            const entries = [];
            for (const item of Array.from(dt.items || [])) {
                if (item.kind !== 'file') continue;
                const entry = item.webkitGetAsEntry?.();
                if (entry) entries.push(entry);
            }
            let uploaded = 0;
            try {
                if (entries.length) {
                    for (const entry of entries) {
                        if (entry.isFile) {
                            const f = await new Promise((res, rej) => entry.file(res, rej));
                            if (await uploadOneFile(f, destDir, f.name)) uploaded++;
                        } else if (entry.isDirectory) {
                            await uploadDirectory(entry, destDir);
                            uploaded++;
                        }
                    }
                } else {
                    for (const f of Array.from(dt.files || [])) {
                        if (await uploadOneFile(f, destDir, f.name)) uploaded++;
                    }
                }
            } catch (e) {
                ctx.toast?.('Upload failed: ' + (e.message || e), 'error');
            }
            await refresh();
            if (uploaded) ctx.toast?.(`Uploaded ${uploaded} item${uploaded === 1 ? '' : 's'}`, 'success');
        }

        async function moveEntry(payload, destDir) {
            if (!payload || payload.source !== currentSource) return false;
            if (!backend?.move) {
                ctx.toast?.('Move is not supported for this source', 'warning');
                return false;
            }
            const dest = destDir || '';
            if (payload.kind === 'dir' && (dest === payload.path || dest.startsWith(payload.path + '/'))) {
                ctx.toast?.('Cannot move a folder into itself', 'error');
                return false;
            }
            const parent = payload.path.split('/').slice(0, -1).join('/');
            if (parent === dest) return false;
            try {
                await backend.move(payload.path, dest);
                await refresh();
                resetPreview();
                return true;
            } catch (e) {
                ctx.toast?.('Move failed: ' + (e.message || e), 'error');
                return false;
            }
        }

        async function backendForSource(id) {
            if (id === 'machine') return new MachineBackend(ctx);
            if (id === 'virtual') {
                const saved = await ctx.storage.get(VirtualBackend.key);
                return new VirtualBackend(ctx, saved || undefined);
            }
            if (id === 'profile') {
                const b = new ProfileBackend(ctx);
                return (await b.available()) ? b : null;
            }
            return null;
        }

        async function copyToSource(payload, targetSource) {
            if (!payload || !backend || payload.source === targetSource) return;
            if (payload.kind !== 'file') {
                ctx.toast?.('Only files can be copied between sources', 'warning');
                return;
            }
            try {
                const data = await backend.readFile(payload.path);
                const target = await backendForSource(targetSource);
                if (!target) {
                    ctx.toast?.('Open the target source first (External) or choose another source', 'warning');
                    return;
                }
                if (!target.isWritable?.()) {
                    ctx.toast?.('Target source is read-only', 'warning');
                    return;
                }
                const exists = await nameExists(target, '', payload.name);
                if (exists && !confirm(`Overwrite "${payload.name}"?`)) return;
                const bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes || []);
                if (exists) await target.writeFile(payload.name, bytes, data.mime);
                else await target.createFile('', payload.name, bytes);
                if (typeof target.flush === 'function') await target.flush();
                await selectSource(targetSource);
                ctx.toast?.(`Copied "${payload.name}" to ${targetSource}`, 'success');
            } catch (e) {
                ctx.toast?.('Copy failed: ' + (e.message || e), 'error');
            }
        }

        // ── Tree rendering ─────────────────────────────────────
        function sortedForUI(items) {
            const copy = items.slice();
            copy.sort((a, b) => {
                if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
                if (sortMode === 'size') return (b.size || 0) - (a.size || 0);
                const cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
                return sortMode === 'name-desc' ? -cmp : cmp;
            });
            return copy;
        }

        function renderList() {
            const q = filterText.trim().toLowerCase();
            const items = sortedForUI(currentItems.filter(it => {
                if (!settings.hidden && it.name.startsWith('.')) return false;
                return !q || it.name.toLowerCase().includes(q);
            }));
            let html = '';
            if (currentSource === 'profile') {
                html += `<div class="fm-warn">⚠ Changes sync to your linked folder immediately.</div>`;
            } else if (currentSource === 'machine') {
                html += `<div class="fm-warn">⚠ Changes are written directly to this machine.</div>`;
            }
            if (items.length) {
                html += renderEntries(items);
            } else if (q) {
                html += `<div class="fm-empty">No matches for “${escapeHTML(filterText)}”.</div>`;
            } else {
                html += `<div class="fm-empty">${currentSource === 'virtual' || currentSource === 'packages' ? 'Empty.' : 'Empty folder.'}</div>`;
            }
            $tree.innerHTML = html;
            wireEntries(items);
        }

        async function refresh() {
            if (!backend) return;
            selected = null;
            resetPreview();
            try {
                currentItems = await backend.list(cwd);
                renderList();
                updateToolbar();
            } catch (e) {
                console.warn('[filemanager] list', e);
                currentItems = [];
                $tree.innerHTML = `<div class="fm-empty">Could not list: ${escapeHTML(e.message || e)}</div>`;
            }
        }

        function rowActionsHTML(it, writable) {
            if (it.kind === 'dir' && !writable) return '';
            return `<button class="fm-row-more" data-row-more title="More actions">⋯</button>`;
        }

        async function openRowMenu(it, x, y) {
            const writable = !!backend && backend.isWritable?.() && currentSource !== 'packages';
            const canHandoff = it.kind === 'file' && isTextLike(it.name, it.mime) && currentSource !== 'packages';
            const items = [];
            if (it.kind === 'file') items.push({ id: 'download', label: 'Download', icon: '⬇' });
            if (canHandoff) items.push({ id: 'openGrimoire', label: 'Open in Grimoire', icon: '📜' });
            if (writable) {
                const canRename = it.kind === 'file' || backend.kind === 'virtual' || backend.kind === 'machine';
                if (items.length) items.push({ separator: true });
                if (canRename) items.push({ id: 'rename', label: 'Rename', icon: '✎' });
                items.push({ id: 'delete', label: 'Delete', icon: '🗑', danger: true });
            }
            if (!items.length) return;
            const choice = await ctx.contextMenu.show({ x, y, items });
            if (choice) await runRowAction(choice, it);
        }

        function renderEntries(items) {
            const writable = !!backend && backend.isWritable?.() && currentSource !== 'packages';
            return items.map((it, i) => {
                const fallback = it.kind === 'dir' ? '📁' : '📄';
                const iconId = it.kind === 'dir'
                    ? folderIconId(it.name, false, false)
                    : fileIconId(it.name, { symlink: !!it.symlink });
                const hiddenCls = it.name.startsWith('.') ? ' fm-hidden-entry' : '';
                return `
                <div class="fm-entry${hiddenCls}" data-idx="${i}">
                    <span class="fm-entry-icon">${iconHTML(ctx, iconId, 'fm-icon', fallback)}</span>
                    <span class="fm-entry-name">${escapeHTML(it.name)}</span>
                    <span class="fm-entry-meta">${it.kind === 'file' ? fmtSize(it.size) : ''}</span>
                    ${rowActionsHTML(it, writable)}
                </div>
            `;
            }).join('');
        }

        function wireEntries(items) {
            $tree.querySelectorAll('.fm-entry').forEach((el) => {
                const idx = Number(el.dataset.idx);
                const it = items[idx];
                el.addEventListener('contextmenu', (ev) => {
                    if (it.kind === 'dir' && !(backend?.isWritable?.() && currentSource !== 'packages')) return;
                    ev.preventDefault();
                    openRowMenu(it, ev.clientX, ev.clientY);
                });
                el.addEventListener('click', async (ev) => {
                    const moreBtn = ev.target.closest('[data-row-more]');
                    if (moreBtn) {
                        ev.stopPropagation();
                        const r = moreBtn.getBoundingClientRect();
                        openRowMenu(it, r.left, r.bottom);
                        return;
                    }
                    $tree.querySelectorAll('.fm-entry').forEach(e => e.classList.remove('active'));
                    el.classList.add('active');
                    if (it.kind === 'dir') {
                        filterText = '';
                        const search = root.querySelector('#fm-search');
                        if (search) search.value = '';
                        cwd = cwd ? cwd + '/' + it.name : it.name;
                        await refresh();
                    } else {
                        selected = it;
                        await renderPreview();
                        if (settings.preview && $shell.classList.contains('fm-narrow')) {
                            $shell.classList.add('fm-preview-open');
                        }
                    }
                });

                const writable = !!backend?.isWritable?.() && currentSource !== 'packages';
                if (writable && backend?.move) {
                    el.draggable = true;
                    el.addEventListener('dragstart', (ev) => {
                        if (ev.target.closest('[data-row-more]')) { ev.preventDefault(); return; }
                        const path = cwd ? cwd + '/' + it.name : it.name;
                        const payload = { source: currentSource, kind: it.kind, path, name: it.name };
                        ev.dataTransfer.setData(INTERNAL_MIME, JSON.stringify(payload));
                        ev.dataTransfer.setData('text/plain', path);
                        ev.dataTransfer.effectAllowed = 'move';
                        el.classList.add('fm-dragging');
                    });
                    el.addEventListener('dragend', () => el.classList.remove('fm-dragging'));
                }
                if (it.kind === 'dir') {
                    el.addEventListener('dragover', (ev) => {
                        if (!hasInternalDrag(ev) && !hasFileDrag(ev)) return;
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.dataTransfer.dropEffect = hasInternalDrag(ev) ? 'move' : 'copy';
                        el.classList.add('fm-drop-target');
                    });
                    el.addEventListener('dragleave', () => el.classList.remove('fm-drop-target'));
                    el.addEventListener('drop', async (ev) => {
                        el.classList.remove('fm-drop-target');
                        const targetPath = cwd ? cwd + '/' + it.name : it.name;
                        const payload = readDragPayload(ev);
                        if (payload) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            await moveEntry(payload, targetPath);
                            return;
                        }
                        if (hasFileDrag(ev)) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            await uploadDataTransfer(ev.dataTransfer, targetPath);
                        }
                    });
                }
            });
        }

        async function runRowAction(act, it) {
            const path = cwd ? cwd + '/' + it.name : it.name;
            if (act === 'rename') {
                const n = (prompt('New name:', it.name) || '').trim();
                if (!n || n === it.name) return;
                if (!validName(n)) { ctx.toast?.('Invalid name', 'error'); return; }
                if (await nameExists(backend, cwd, n)) { ctx.toast?.('A file or folder with that name already exists', 'error'); return; }
                try { await backend.rename(path, n); await refresh(); resetPreview(); }
                catch (e) { ctx.toast?.('Rename failed: ' + (e.message || e), 'error'); }
                return;
            }
            if (act === 'delete') {
                const msg = it.kind === 'dir'
                    ? `Delete folder "${it.name}" and its contents?`
                    : `Delete "${it.name}"?`;
                if (!confirm(msg)) return;
                try { await backend.deleteNode(path); await refresh(); resetPreview(); }
                catch (e) { ctx.toast?.('Delete failed: ' + (e.message || e), 'error'); }
                return;
            }
            if (currentSource === 'machine' && act === 'download') {
                try { await ctx.fs.download(path); }
                catch (e) { ctx.toast?.('Download failed: ' + (e.message || e), 'error'); }
                return;
            }
            if (currentSource === 'machine' && act === 'openGrimoire') {
                try {
                    await ctx.handoff('grimoire', {
                        type: 'machineFile',
                        path,
                        name: it.name,
                        mime: mimeFromName(it.name),
                    });
                } catch (e) {
                    ctx.toast?.('Handoff failed: ' + (e.message || e), 'error');
                }
                return;
            }
            // Other sources hand off text, so read the file first.
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
            previewToken++;
            if (previewURL) { try { URL.revokeObjectURL(previewURL); } catch {} previewURL = null; }
            $preview.innerHTML = `<div class="fm-empty">Select a file to preview.</div>`;
        }
        async function renderPreview() {
            resetPreview();
            const token = previewToken;
            if (!settings.preview || !selected || selected.kind !== 'file') return;
            const path = cwd ? cwd + '/' + selected.name : selected.name;
            const name = selected.name;
            const mime = mimeFromName(name);
            const isText  = isTextLike(name, mime);
            const isImage = /^image\//.test(mime);
            const isVideo = /^video\//.test(mime);
            const isAudio = /^audio\//.test(mime);

            if (backend?.kind === 'machine') {
                if (!isText && !isImage && !isVideo && !isAudio) {
                    $preview.innerHTML = `
                        <div class="fm-preview-title">${escapeHTML(name)}</div>
                        <div class="fm-preview-meta">${escapeHTML(mime)} · ${fmtSize(selected.size)}</div>
                        <div class="fm-preview-body"><em>Binary file — use Download to open it.</em></div>
                    `;
                    return;
                }
                const max = isText ? 256 * 1024 : 32 * 1024 * 1024;
                if (selected.size > max) {
                    $preview.innerHTML = `
                        <div class="fm-preview-title">${escapeHTML(name)}</div>
                        <div class="fm-preview-meta">${escapeHTML(mime)} · ${fmtSize(selected.size)}</div>
                        <div class="fm-preview-body"><em>File too large for inline preview — use Download.</em></div>
                    `;
                    return;
                }
            }

            let data;
            try { data = await backend.readFile(path, isText ? 256 * 1024 : 32 * 1024 * 1024); }
            catch (e) {
                if (token !== previewToken) return;
                $preview.innerHTML = `<div class="fm-empty">Read failed: ${escapeHTML(e.message || e)}</div>`;
                return;
            }
            if (token !== previewToken) return;
            const size = fmtSize(data.bytes.byteLength);

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
        const $search = root.querySelector('#fm-search');
        const $sort = root.querySelector('#fm-sort');
        $search?.addEventListener('input', () => {
            filterText = $search.value;
            renderList();
        });
        $sort?.addEventListener('change', () => {
            sortMode = $sort.value;
            renderList();
        });
        root.querySelector('[data-act="up"]').addEventListener('click', async () => {
            if (!cwd) return;
            cwd = cwd.split('/').slice(0, -1).join('/');
            resetPreview();
            await refresh();
        });
        root.querySelector('[data-act="refresh"]').addEventListener('click', async () => { resetPreview(); await refresh(); });
        root.querySelector('[data-act="newfile"]').addEventListener('click', async () => {
            if (!backend?.isWritable?.()) return;
            const name = (prompt('New file name:') || '').trim();
            if (!validName(name)) { if (name) ctx.toast?.('Invalid name', 'error'); return; }
            if (await nameExists(backend, cwd, name)) { ctx.toast?.('A file or folder with that name already exists', 'error'); return; }
            try { await backend.createFile(cwd, name, ''); await refresh(); }
            catch (e) { ctx.toast?.('Create failed: ' + (e.message || e), 'error'); }
        });
        root.querySelector('[data-act="newdir"]').addEventListener('click', async () => {
            if (!backend?.isWritable?.()) return;
            const name = (prompt('New folder name:') || '').trim();
            if (!validName(name)) { if (name) ctx.toast?.('Invalid name', 'error'); return; }
            if (await nameExists(backend, cwd, name)) { ctx.toast?.('A file or folder with that name already exists', 'error'); return; }
            try { await backend.createDir(cwd, name); await refresh(); }
            catch (e) { ctx.toast?.('Create failed: ' + (e.message || e), 'error'); }
        });
        root.querySelector('[data-act="upload"]').addEventListener('click', () => $uploadInput.click());
        $uploadInput.addEventListener('change', async () => {
            if (!backend?.isWritable?.()) return;
            const files = Array.from($uploadInput.files || []);
            $uploadInput.value = '';
            for (const f of files) {
                try { await uploadOneFile(f, cwd, f.name); }
                catch (e) { ctx.toast?.('Upload failed: ' + f.name + ' — ' + (e.message || e), 'error'); }
            }
            await refresh();
        });

        // Preview overlay toggle (narrow layouts).
        root.querySelector('[data-act="togglePreview"]').addEventListener('click', () => {
            $shell.classList.toggle('fm-preview-open');
        });

        // ── Settings ───────────────────────────────────────────
        function openSettings() {
            $settings.hidden = false;
            const $path = root.querySelector('#fm-set-path');
            const $start = root.querySelector('#fm-set-start');
            if ($path) $path.value = cwd;
            if ($start) $start.value = settings.startPath;
            applySettings();
        }
        function closeSettings() { $settings.hidden = true; }
        root.querySelector('[data-act="settings"]').addEventListener('click', () => {
            if ($settings.hidden) openSettings(); else closeSettings();
        });
        root.querySelector('[data-act="closeSettings"]').addEventListener('click', closeSettings);
        root.querySelector('#fm-set-preview').addEventListener('change', (ev) => {
            settings.preview = ev.target.checked;
            saveSettings();
            applySettings();
            if (settings.preview && selected) renderPreview();
        });
        root.querySelector('#fm-set-hidden').addEventListener('change', (ev) => {
            settings.hidden = ev.target.checked;
            saveSettings();
            selected = null;
            resetPreview();
            renderList();
        });
        root.querySelector('#fm-set-start').addEventListener('change', async (ev) => {
            const path = normalizePath(ev.target.value);
            if (path === null) {
                ctx.toast?.('Path cannot contain ".."', 'error');
                ev.target.value = settings.startPath;
                return;
            }
            if (path && backend) {
                try { await backend.list(path); }
                catch { ctx.toast?.('Folder not found in this source', 'error'); ev.target.value = settings.startPath; return; }
            }
            settings.startPath = path;
            saveSettings();
            ctx.toast?.(path ? 'Start folder saved' : 'Start folder reset', 'success');
        });
        const goPath = async () => {
            const $path = root.querySelector('#fm-set-path');
            if (await goToPath($path?.value || '')) closeSettings();
        };
        root.querySelector('[data-act="goPath"]').addEventListener('click', goPath);
        root.querySelector('#fm-set-path').addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); goPath(); }
        });
        root.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && !$settings.hidden) closeSettings();
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
        const flushOnHide = () => {
            Promise.resolve(backend?.flush?.()).catch(() => {});
        };
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushOnHide();
        });
        window.addEventListener('pagehide', flushOnHide);
        root.__fmFlush = async () => { await backend?.flush?.(); };

        root.querySelectorAll('.fm-source').forEach(el => {
            el.addEventListener('click', () => selectSource(el.dataset.source));
            el.addEventListener('dragover', (ev) => {
                const payload = readDragPayload(ev);
                if (!payload || payload.source === el.dataset.source) return;
                ev.preventDefault();
                ev.stopPropagation();
                ev.dataTransfer.dropEffect = 'copy';
                el.classList.add('fm-source-drop');
            });
            el.addEventListener('dragleave', () => el.classList.remove('fm-source-drop'));
            el.addEventListener('drop', async (ev) => {
                el.classList.remove('fm-source-drop');
                const payload = readDragPayload(ev);
                if (!payload || payload.source === el.dataset.source) return;
                ev.preventDefault();
                ev.stopPropagation();
                await copyToSource(payload, el.dataset.source);
            });
        });

        $tree.addEventListener('dragover', (ev) => {
            if (!hasInternalDrag(ev) && !hasFileDrag(ev)) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = hasInternalDrag(ev) ? 'move' : 'copy';
            $tree.classList.add('fm-drop-root');
        });
        $tree.addEventListener('dragleave', (ev) => {
            if (ev.target === $tree) $tree.classList.remove('fm-drop-root');
        });
        $tree.addEventListener('drop', async (ev) => {
            if (ev.target.closest('.fm-entry')) return;
            if (!hasInternalDrag(ev) && !hasFileDrag(ev)) return;
            ev.preventDefault();
            $tree.classList.remove('fm-drop-root');
            const payload = readDragPayload(ev);
            if (payload) { await moveEntry(payload, cwd); return; }
            if (hasFileDrag(ev)) await uploadDataTransfer(ev.dataTransfer, cwd);
        });

        const preventFileDrop = (ev) => {
            if (hasFileDrag(ev)) ev.preventDefault();
        };
        window.addEventListener('dragover', preventFileDrop);
        window.addEventListener('drop', preventFileDrop);

        applySettings();
        await selectSource(ctx.local ? 'machine' : 'virtual');
    },

    async unmount(root, ctx) {
        try { await root.__fmFlush?.(); } catch {}
        try { root.__fmRO?.disconnect(); } catch {}
        // Any popup is mounted on document.body; remove the latest if still open.
        document.querySelectorAll('.fm-popup').forEach(p => p.remove());
        const previews = root.querySelectorAll('img[src^="blob:"], video[src^="blob:"], audio[src^="blob:"]');
        previews.forEach(el => { try { URL.revokeObjectURL(el.src); } catch {} });
    }
};
