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
        if (!node || !node.isDir) throw new Error('not_found');
        return sortEntries(node.children.map(c => ({
            name: c.name, kind: c.isDir ? 'dir' : 'file',
            size: c.isDir ? 0 : ((c.content && c.content.byteLength) || (typeof c.content === 'string' ? c.content.length : 0)),
            mtime: c.mtime || '',
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
        n.mtime = new Date().toISOString();
        this._persist();
    }
    async createFile(parentPath, name, content, mime) {
        const p = this._find(parentPath || '');
        if (!p || !p.isDir) throw new Error('no_parent');
        if (p.children.some(c => c.name === name)) throw new Error('exists');
        const np = parentPath ? parentPath + '/' + name : name;
        const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(content || '');
        p.children.push({ name, path: np, isDir: false, content: bytes, mime: mime || mimeFromName(name), mtime: new Date().toISOString() });
        this._persist();
        return np;
    }
    async createDir(parentPath, name) {
        const p = this._find(parentPath || '');
        if (!p || !p.isDir) throw new Error('no_parent');
        if (p.children.some(c => c.name === name)) throw new Error('exists');
        const np = parentPath ? parentPath + '/' + name : name;
        p.children.push({ name, path: np, isDir: true, children: [], mtime: new Date().toISOString() });
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
            node.mtime = new Date().toISOString();
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
            mtime: it.mtime || '',
            mode: it.mode || '',
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
                    <button class="fm-btn" data-act="back" title="Back (Alt+←)" aria-label="Back">←</button>
                    <button class="fm-btn" data-act="forward" title="Forward (Alt+→)" aria-label="Forward">→</button>
                    <button class="fm-btn" data-act="up" title="Up (Backspace)">↑</button>
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
                        <option value="mtime">Modified</option>
                    </select>
                    <select id="fm-type" class="fm-sort" aria-label="Filter by type">
                        <option value="all">All types</option>
                        <option value="folders">Folders</option>
                        <option value="images">Images</option>
                        <option value="text">Text</option>
                        <option value="docs">Documents</option>
                        <option value="media">Audio/Video</option>
                        <option value="archives">Archives</option>
                    </select>
                    <button class="fm-btn" data-act="deep" title="Search subfolders" aria-label="Search subfolders">⌕</button>
                    <span class="fm-busy" id="fm-busy" hidden></span>
                    <span class="fm-spacer"></span>
                    <span class="fm-breadcrumb" id="fm-crumb">/</span>
                    <button class="fm-btn" data-act="view" title="Grid view" aria-label="Toggle grid view">▦</button>
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
                    <label class="fm-set-row">
                        <span>Colored icons</span>
                        <input type="checkbox" id="fm-set-icons">
                    </label>
                    <label class="fm-set-row">
                        <span>Grid view</span>
                        <input type="checkbox" id="fm-set-grid">
                    </label>
                    <label class="fm-set-row" for="fm-set-thumb"><span>Thumbnail size</span></label>
                    <select id="fm-set-thumb" class="fm-set-input">
                        <option value="s">Small</option>
                        <option value="m">Medium</option>
                        <option value="l">Large</option>
                    </select>
                    <label class="fm-set-row">
                        <span>Favorites</span>
                        <button class="fm-btn" data-act="pin">📌 Pin current</button>
                    </label>
                    <div id="fm-favs" class="fm-favs"></div>
                    <small>Pinned folders for the current source. Click to open.</small>
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
        let selected = null;  // primary item ({ name, kind, size, mime }) relative to cwd
        let selection = new Set();  // names of every selected entry in cwd
        let anchorIdx = -1;         // shift-click anchor in visibleItems
        let visibleItems = [];      // last rendered order
        let previewURL = null;
        let previewToken = 0;
        let currentItems = [];
        let filterText = '';
        let sortMode = 'name';
        let history = [];
        let historyIdx = -1;
        let clipboard = null;       // { mode, source, items }
        let thumbToken = 0;
        let thumbURLs = [];
        let typeFilter = 'all';
        let deepSearch = false;
        let searchResults = null;
        let searchSeq = 0;
        let searchTimer = 0;

        const THUMB_PX = { s: 64, m: 88, l: 128 };
        const DEFAULT_SETTINGS = { preview: true, hidden: false, startPath: '', view: 'list', thumbSize: 'm', icons: true, favorites: {} };
        let settings = { ...DEFAULT_SETTINGS };
        try {
            const saved = await ctx.storage.get('settings');
            if (saved && typeof saved === 'object') settings = { ...DEFAULT_SETTINGS, ...saved };
        } catch (e) { console.warn('[filemanager] settings', e); }
        if (!settings.favorites || typeof settings.favorites !== 'object') settings.favorites = {};

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
            const $g = root.querySelector('#fm-set-grid');
            const $t = root.querySelector('#fm-set-thumb');
            const $i = root.querySelector('#fm-set-icons');
            if ($p) $p.checked = !!settings.preview;
            if ($h) $h.checked = !!settings.hidden;
            if ($i) $i.checked = settings.icons !== false;
            if ($g) $g.checked = settings.view === 'grid';
            if ($t) $t.value = settings.thumbSize;
            applyView();
        }

        function applyView() {
            $tree.classList.toggle('fm-grid', settings.view === 'grid');
            $tree.style.setProperty('--fm-thumb-size', (THUMB_PX[settings.thumbSize] || THUMB_PX.m) + 'px');
            const btn = root.querySelector('[data-act="view"]');
            if (btn) {
                const grid = settings.view === 'grid';
                btn.textContent = grid ? '☰' : '▦';
                btn.title = grid ? 'List view' : 'Grid view';
            }
        }

        // Paths are source-root relative; ".." would escape the root.
        function normalizePath(raw) {
            const parts = String(raw || '').replace(/\\/g, '/').split('/').filter(p => p && p !== '.');
            if (parts.includes('..')) return null;
            return parts.join('/');
        }

        function joinPath(dir, name) { return dir ? dir + '/' + name : name; }
        function parentPath(p) { return p.split('/').slice(0, -1).join('/'); }
        function itemPath(it) { return joinPath(cwd, it.name); }

        function favoritesFor(source) {
            const all = settings.favorites || {};
            return Array.isArray(all[source]) ? all[source] : [];
        }

        function renderFavorites() {
            const $favs = root.querySelector('#fm-favs');
            if (!$favs) return;
            const list = favoritesFor(currentSource);
            $favs.innerHTML = list.length ? list.map(p => `
                <div class="fm-fav">
                    <button class="fm-fav-go" data-fav="${escapeHTML(p)}" title="${escapeHTML(p || '/')}">📌 ${escapeHTML(p || '/')}</button>
                    <button class="fm-fav-del" data-fav-del="${escapeHTML(p)}" title="Remove">✕</button>
                </div>`).join('') : `<div class="fm-fav-empty">No favorites in this source yet.</div>`;
            $favs.querySelectorAll('[data-fav]').forEach(el => {
                el.addEventListener('click', async () => { if (await navigate(el.dataset.fav)) closeSettings(); });
            });
            $favs.querySelectorAll('[data-fav-del]').forEach(el => {
                el.addEventListener('click', () => {
                    const p = el.dataset.favDel;
                    settings.favorites[currentSource] = favoritesFor(currentSource).filter(x => x !== p);
                    saveSettings();
                    renderFavorites();
                });
            });
        }

        function pinCurrent() {
            if (!currentSource) return;
            const list = favoritesFor(currentSource).slice();
            if (list.includes(cwd)) { ctx.toast?.('Already in favorites', 'info'); return; }
            list.push(cwd);
            settings.favorites[currentSource] = list;
            saveSettings();
            renderFavorites();
            ctx.toast?.('Folder pinned', 'success');
        }

        async function navigate(path, push = true) {
            if (!backend) return false;
            const p = normalizePath(path);
            if (p === null) { ctx.toast?.('Path cannot contain ".."', 'error'); return false; }
            try { await backend.list(p); }
            catch (e) { ctx.toast?.('Cannot open "' + (p || '/') + '": ' + (e.message || e), 'error'); return false; }
            cwd = p;
            if (push) {
                history = history.slice(0, historyIdx + 1);
                if (history[historyIdx] !== cwd) history.push(cwd);
                historyIdx = history.length - 1;
            }
            await refresh();
            updateToolbar();
            const $path = root.querySelector('#fm-set-path');
            if ($path && !$settings.hidden) $path.value = cwd;
            return true;
        }

        async function goBack() {
            if (historyIdx <= 0) return;
            historyIdx -= 1;
            await navigate(history[historyIdx], false);
        }

        async function goForward() {
            if (historyIdx >= history.length - 1) return;
            historyIdx += 1;
            await navigate(history[historyIdx], false);
        }

        function selectedItems() { return visibleItems.filter(v => selection.has(v.name)); }
        function singleSelected() { return selection.size === 1 ? (selectedItems()[0] || null) : null; }

        function clearSelection() {
            selection.clear();
            selected = null;
            anchorIdx = -1;
            resetPreview();
        }

        function paintSelection() {
            $tree.querySelectorAll('.fm-entry').forEach(el => {
                const it = visibleItems[Number(el.dataset.idx)];
                if (!it) return;
                el.classList.toggle('fm-selected', selection.has(it.name));
                el.classList.toggle('active', !!selected && it.name === selected.name);
                const cut = !!(clipboard && clipboard.mode === 'cut' && clipboard.source === currentSource
                    && clipboard.items.some(x => x.name === it.name));
                el.classList.toggle('fm-cut', cut);
            });
        }

        function selectAll() {
            if (!visibleItems.length) return;
            selection = new Set(visibleItems.map(v => v.name));
            selected = visibleItems.find(v => v.kind === 'file') || visibleItems[0];
            anchorIdx = 0;
            paintSelection();
            if (selected?.kind === 'file') renderPreview();
        }

        function handleEntryClick(it, ev) {
            const idx = visibleItems.indexOf(it);
            if (ev.shiftKey && anchorIdx >= 0) {
                const a = Math.min(anchorIdx, idx), b = Math.max(anchorIdx, idx);
                selection = new Set(visibleItems.slice(a, b + 1).map(v => v.name));
            } else if (ev.ctrlKey || ev.metaKey) {
                if (selection.has(it.name)) selection.delete(it.name);
                else selection.add(it.name);
                anchorIdx = idx;
            } else {
                selection = new Set([it.name]);
                anchorIdx = idx;
            }
            selected = selection.has(it.name) ? it : (visibleItems.find(v => selection.has(v.name)) || null);
            paintSelection();
            if (selected?.kind === 'file') {
                renderPreview();
                if (settings.preview && $shell.classList.contains('fm-narrow')) $shell.classList.add('fm-preview-open');
            } else {
                resetPreview();
            }
        }

        function movePrimary(delta) {
            if (!visibleItems.length) return;
            let idx = selected ? visibleItems.findIndex(v => v.name === selected.name) : -1;
            idx = Math.max(0, Math.min(visibleItems.length - 1, idx + delta));
            const it = visibleItems[idx];
            selection = new Set([it.name]);
            selected = it;
            anchorIdx = idx;
            paintSelection();
            $tree.querySelector(`.fm-entry[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
            if (it.kind === 'file') renderPreview();
            else resetPreview();
        }

        function fmtDate(iso) {
            if (!iso) return '—';
            const d = new Date(iso);
            return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
        }

        function showModal({ title, bodyHTML, buttons }) {
            return new Promise((resolve) => {
                const overlay = document.createElement('div');
                overlay.className = 'fm-modal-overlay';
                overlay.innerHTML = `
                    <div class="fm-modal" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
                        <div class="fm-modal-head">
                            <strong>${escapeHTML(title)}</strong>
                            <button class="fm-btn" data-modal-close title="Close">✕</button>
                        </div>
                        <div class="fm-modal-body">${bodyHTML}</div>
                        <div class="fm-modal-actions"></div>
                    </div>`;
                const actions = overlay.querySelector('.fm-modal-actions');
                (buttons || [{ id: 'ok', label: 'Close', primary: true }]).forEach(b => {
                    const btn = document.createElement('button');
                    btn.className = 'fm-btn' + (b.primary ? ' fm-primary' : '') + (b.danger ? ' fm-danger' : '');
                    btn.textContent = b.label;
                    btn.addEventListener('click', () => close(b.id));
                    actions.appendChild(btn);
                });
                function close(value) {
                    overlay.remove();
                    document.removeEventListener('keydown', onKey, true);
                    resolve(value);
                }
                function onKey(ev) {
                    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(null); }
                }
                overlay.querySelector('[data-modal-close]').addEventListener('click', () => close(null));
                overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) close(null); });
                document.addEventListener('keydown', onKey, true);
                root.appendChild(overlay);
                actions.querySelector('.fm-btn')?.focus();
            });
        }

        async function showProperties(it) {
            const path = it.path || itemPath(it);
            let stat = null;
            if (backend?.kind === 'machine' && ctx.fs?.stat) {
                try { stat = await ctx.fs.stat(path); } catch {}
            }
            const rows = [
                ['Name', it.name],
                ['Path', '/' + path],
                ['Type', it.kind === 'dir' ? 'Folder' : (it.mime || mimeFromName(it.name))],
                ['Size', it.kind === 'dir' ? '—' : fmtSize(it.size ?? stat?.size ?? 0)],
                ['Modified', fmtDate(it.mtime || stat?.mtime)],
                ['Mode', it.mode || stat?.mode || '—'],
            ];
            if (it.symlink) rows.push(['Link target', it.link || '—']);
            const body = `<dl class="fm-props">${rows.map(([k, v]) => `<dt>${escapeHTML(k)}</dt><dd>${escapeHTML(String(v))}</dd>`).join('')}</dl>`;
            await showModal({ title: 'Properties', bodyHTML: body, buttons: [{ id: 'ok', label: 'Close', primary: true }] });
        }

        async function bulkRename() {
            const items = selectedItems();
            if (!items.length || !backend?.isWritable?.()) return;
            if (items.some(it => it.kind === 'dir' && backend.kind === 'profile')) {
                ctx.toast?.('Folders cannot be renamed in this source', 'warning');
                return;
            }
            const pattern = (prompt('Rename pattern. Use {name}, {ext}, {n}:', '{name}') || '').trim();
            if (!pattern) return;
            const pad = String(items.length).length;
            const plan = items.map((it, i) => {
                const dot = it.name.lastIndexOf('.');
                const base = dot > 0 ? it.name.slice(0, dot) : it.name;
                const ext = dot > 0 ? it.name.slice(dot) : '';
                const name = pattern
                    .replace(/\{name\}/g, base)
                    .replace(/\{ext\}/g, ext)
                    .replace(/\{n\}/g, String(i + 1).padStart(pad, '0'));
                return { it, name };
            });
            const bad = plan.find(p => !validName(p.name));
            if (bad) { ctx.toast?.('Pattern produced an invalid name: ' + bad.name, 'error'); return; }
            if (new Set(plan.map(p => p.name)).size !== plan.length) {
                ctx.toast?.('Pattern produces duplicate names', 'error');
                return;
            }
            const preview = plan.slice(0, 12).map(p => `${p.it.name} → ${p.name}`).join('\n')
                + (plan.length > 12 ? `\n…and ${plan.length - 12} more` : '');
            if (!confirm(`Rename ${plan.length} item${plan.length === 1 ? '' : 's'}?\n\n${preview}`)) return;
            let done = 0;
            const errors = [];
            for (const p of plan) {
                if (p.name === p.it.name) continue;
                if (await nameExists(backend, cwd, p.name)) { errors.push(p.name + ': already exists'); continue; }
                try { await backend.rename(itemPath(p.it), p.name); done++; }
                catch (e) { errors.push(p.it.name + ': ' + (e.message || e)); }
            }
            await refresh();
            if (errors.length) ctx.toast?.(`${done} renamed, ${errors.length} failed: ${errors[0]}`, 'error');
            else ctx.toast?.(`Renamed ${done} item${done === 1 ? '' : 's'}`, 'success');
        }

        async function chooseConflict(name) {
            const choice = await showModal({
                title: 'Name already exists',
                bodyHTML: `<p><strong>${escapeHTML(name)}</strong> is already in this folder.</p>
                    <p class="fm-modal-note">Folders are always copied as a new “name (n)” folder.</p>`,
                buttons: [
                    { id: 'overwrite', label: 'Overwrite all', danger: true },
                    { id: 'keep', label: 'Keep both', primary: true },
                    { id: 'skip', label: 'Skip' },
                    { id: 'cancel', label: 'Cancel' },
                ],
            });
            return choice;
        }

        async function uniqueName(name, b, dir) {
            const dot = name.lastIndexOf('.');
            const base = dot > 0 ? name.slice(0, dot) : name;
            const ext = dot > 0 ? name.slice(dot) : '';
            let n = 1;
            let candidate = `${base} (${n})${ext}`;
            while (await nameExists(b, dir, candidate)) {
                n += 1;
                candidate = `${base} (${n})${ext}`;
                if (n > 500) break;
            }
            return candidate;
        }

        async function deleteSelection() {
            const items = selectedItems();
            if (!items.length) return;
            if (!backend?.isWritable?.() || currentSource === 'packages') { ctx.toast?.('This source is read-only', 'warning'); return; }
            const msg = items.length === 1
                ? (items[0].kind === 'dir' ? `Delete folder "${items[0].name}" and its contents?` : `Delete "${items[0].name}"?`)
                : `Delete ${items.length} selected items?`;
            if (!confirm(msg)) return;
            let done = 0;
            const errors = [];
            for (const it of items) {
                try { await backend.deleteNode(itemPath(it)); done++; }
                catch (e) { errors.push(it.name + ': ' + (e.message || e)); }
            }
            await refresh();
            if (errors.length) ctx.toast?.(`${done} deleted, ${errors.length} failed: ${errors[0]}`, 'error');
            else ctx.toast?.(`Deleted ${done} item${done === 1 ? '' : 's'}`, 'success');
        }

        function setClipboard(mode) {
            const items = selectedItems();
            if (!items.length) return;
            clipboard = {
                mode,
                source: currentSource,
                items: items.map(it => ({ path: itemPath(it), name: it.name, kind: it.kind })),
            };
            paintSelection();
            ctx.toast?.((mode === 'cut' ? 'Cut ' : 'Copied ') + items.length + ' item' + (items.length === 1 ? '' : 's'), 'info');
        }

        async function copyTreeFrom(srcB, srcDir, dstB, dstDir, name, budget, depth) {
            if (depth > 16) throw new Error('folder nested too deeply');
            if (budget.files >= 2000) throw new Error('more than 2000 files');
            await dstB.createDir(dstDir, name);
            const newDir = joinPath(dstDir, name);
            const children = await srcB.list(srcDir);
            for (const it of children) {
                budget.files += 1;
                if (budget.files > 2000) throw new Error('more than 2000 files');
                const childSrc = joinPath(srcDir, it.name);
                if (it.kind === 'dir') {
                    await copyTreeFrom(srcB, childSrc, dstB, newDir, it.name, budget, depth + 1);
                } else {
                    const data = await srcB.readFile(childSrc);
                    budget.bytes += data.bytes.byteLength;
                    if (budget.bytes > 512 * 1024 * 1024) throw new Error('copy is larger than 512 MB');
                    await dstB.createFile(newDir, it.name, data.bytes);
                }
            }
            return newDir;
        }

        async function pasteClipboard() {
            if (!clipboard?.items?.length) return;
            if (!backend?.isWritable?.() || currentSource === 'packages') { ctx.toast?.('This source is read-only', 'warning'); return; }
            const src = clipboard.source;
            const srcBackend = src === currentSource ? backend : await backendForSource(src);
            if (!srcBackend) { ctx.toast?.('The original source is not available', 'warning'); return; }
            const clip = clipboard;
            const sameSource = src === currentSource;
            const budget = { files: 0, bytes: 0 };
            let policy = null;
            let done = 0;
            const errors = [];
            for (let i = 0; i < clip.items.length; i++) {
                const item = clip.items[i];
                setBusy(`Pasting ${i + 1}/${clip.items.length}…`);
                if (clip.mode === 'cut' && sameSource && item.kind !== 'dir') {
                    if (parentPath(item.path) === cwd) continue;
                    try { await backend.move(item.path, cwd); done++; }
                    catch (e) { errors.push(item.name + ': ' + (e.message || e)); }
                    continue;
                }
                if (clip.mode === 'cut' && sameSource && item.kind === 'dir') {
                    if (parentPath(item.path) === cwd) continue;
                    try { await backend.move(item.path, cwd); done++; }
                    catch (e) { errors.push(item.name + ': ' + (e.message || e)); }
                    continue;
                }
                try {
                    let name = item.name;
                    const exists = await nameExists(backend, cwd, name);
                    const sameDirCopy = clip.mode === 'copy' && sameSource && parentPath(item.path) === cwd;
                    if (exists && sameDirCopy) {
                        name = await uniqueName(name, backend, cwd);
                    } else if (exists) {
                        if (item.kind === 'dir') {
                            // Never merge folders: keep both.
                            name = await uniqueName(name, backend, cwd);
                        } else if (policy === 'overwrite') {
                            // write below
                        } else if (policy === 'skip') {
                            continue;
                        } else if (policy === 'keep') {
                            name = await uniqueName(name, backend, cwd);
                        } else {
                            policy = await chooseConflict(name);
                            if (!policy || policy === 'cancel') { clipboard = null; setBusy(''); await refresh(); return; }
                            if (policy === 'skip') { if (clip.items.length === 1) { clipboard = null; await refresh(); return; } continue; }
                            if (policy === 'keep') name = await uniqueName(name, backend, cwd);
                        }
                    }
                    if (item.kind === 'dir') {
                        await copyTreeFrom(srcBackend, item.path, backend, cwd, name, budget, 0);
                    } else {
                        const data = await srcBackend.readFile(item.path);
                        const bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes || []);
                        const mime = data.mime || mimeFromName(name);
                        if (name === item.name && exists) await backend.writeFile(joinPath(cwd, name), bytes, mime);
                        else await backend.createFile(cwd, name, bytes);
                    }
                    if (clip.mode === 'cut') await srcBackend.deleteNode(item.path);
                    done++;
                } catch (e) { errors.push(item.name + ': ' + (e.message || e)); }
            }
            setBusy('');
            clipboard = null;
            await refresh();
            if (errors.length) ctx.toast?.(`${done} done, ${errors.length} failed: ${errors[0]}`, 'error');
            else if (done) ctx.toast?.(`${clip.mode === 'cut' ? 'Moved' : 'Pasted'} ${done} item${done === 1 ? '' : 's'}`, 'success');
        }

        function resetThumbs() {
            thumbToken++;
            for (const u of thumbURLs) { try { URL.revokeObjectURL(u); } catch {} }
            thumbURLs = [];
        }

        async function loadThumbs(items) {
            if (settings.view !== 'grid') return;
            resetThumbs();
            const token = thumbToken;
            let loaded = 0;
            for (let i = 0; i < items.length; i++) {
                if (token !== thumbToken) return;
                const it = items[i];
                if (it.kind !== 'file' || !/^image\//.test(mimeFromName(it.name)) || it.size > 8 * 1024 * 1024) continue;
                if (loaded >= 120) break;
                try {
                    const data = await backend.readFile(itemPath(it), 8 * 1024 * 1024);
                    if (token !== thumbToken) return;
                    const url = URL.createObjectURL(new Blob([data.bytes], { type: data.mime || mimeFromName(it.name) }));
                    // Skip files the browser cannot decode; the file icon stays.
                    const probe = new Image();
                    probe.src = url;
                    await probe.decode().catch(() => {});
                    if (!probe.naturalWidth) { URL.revokeObjectURL(url); continue; }
                    if (token !== thumbToken) { URL.revokeObjectURL(url); return; }
                    thumbURLs.push(url);
                    const icon = $tree.querySelector(`.fm-entry[data-idx="${i}"] .fm-entry-icon`);
                    if (icon) icon.innerHTML = `<img class="fm-thumb" src="${url}" alt="">`;
                    loaded++;
                } catch {}
            }
        }

        async function goToPath(raw) {
            if (!(await navigate(raw))) return false;
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
            selection.clear(); anchorIdx = -1;
            filterText = '';
            history = []; historyIdx = -1;
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
                history = [cwd]; historyIdx = 0;
                await refresh();
            } catch (e) {
                console.warn('[filemanager]', e);
                $tree.innerHTML = `<div class="fm-empty">Failed to open source: ${escapeHTML(e.message || e)}</div>`;
            }
            if (!$settings.hidden) renderFavorites();
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
                selection.clear(); anchorIdx = -1;
                history = ['']; historyIdx = 0;
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
                if (act === 'back') b.disabled = historyIdx <= 0;
                if (act === 'forward') b.disabled = historyIdx >= history.length - 1;
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
                el.addEventListener('click', async () => { await navigate(el.dataset.crumb); });
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
                    for (let i = 0; i < entries.length; i++) {
                        const entry = entries[i];
                        setBusy(`Dropping ${i + 1}/${entries.length}…`);
                        if (entry.isFile) {
                            const f = await new Promise((res, rej) => entry.file(res, rej));
                            if (await uploadOneFile(f, destDir, f.name)) uploaded++;
                        } else if (entry.isDirectory) {
                            await uploadDirectory(entry, destDir);
                            uploaded++;
                        }
                    }
                } else {
                    const files = Array.from(dt.files || []);
                    for (let i = 0; i < files.length; i++) {
                        setBusy(`Dropping ${i + 1}/${files.length}…`);
                        if (await uploadOneFile(files[i], destDir, files[i].name)) uploaded++;
                    }
                }
            } catch (e) {
                ctx.toast?.('Upload failed: ' + (e.message || e), 'error');
            }
            setBusy('');
            await refresh();
            if (uploaded) ctx.toast?.(`Uploaded ${uploaded} item${uploaded === 1 ? '' : 's'}`, 'success');
        }

        async function moveEntry(payload, destDir) {
            if (!payload || payload.source !== currentSource) return false;
            if (!backend?.move) {
                ctx.toast?.('Move is not supported for this source', 'warning');
                return false;
            }
            const items = payload.items?.length ? payload.items : [payload];
            const dest = destDir || '';
            let moved = 0;
            const errors = [];
            for (const item of items) {
                if (item.kind === 'dir' && (dest === item.path || dest.startsWith(item.path + '/'))) {
                    errors.push(item.name + ': cannot move a folder into itself');
                    continue;
                }
                if (parentPath(item.path) === dest) continue;
                try { await backend.move(item.path, dest); moved++; }
                catch (e) { errors.push(item.name + ': ' + (e.message || e)); }
            }
            if (moved) await refresh();
            if (errors.length) ctx.toast?.('Move failed: ' + errors[0] + (errors.length > 1 ? ` (+${errors.length - 1})` : ''), 'error');
            else if (moved) ctx.toast?.(`Moved ${moved} item${moved === 1 ? '' : 's'}`, 'success');
            return moved > 0;
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
            const items = payload.items?.length ? payload.items : [payload];
            try {
                const target = await backendForSource(targetSource);
                if (!target) {
                    ctx.toast?.('Open the target source first (External) or choose another source', 'warning');
                    return;
                }
                if (!target.isWritable?.()) {
                    ctx.toast?.('Target source is read-only', 'warning');
                    return;
                }
                let copied = 0;
                const budget = { files: 0, bytes: 0 };
                const errors = [];
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    setBusy(`Copying ${i + 1}/${items.length}…`);
                    try {
                        const exists = await nameExists(target, '', item.name);
                        if (item.kind === 'dir') {
                            const name = exists ? await uniqueName(item.name, target, '') : item.name;
                            await copyTreeFrom(backend, item.path, target, '', name, budget, 0);
                            copied++;
                            continue;
                        }
                        if (exists && !confirm(`Overwrite "${item.name}"?`)) continue;
                        const data = await backend.readFile(item.path);
                        const bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes || []);
                        if (exists) await target.writeFile(item.name, bytes, data.mime || mimeFromName(item.name));
                        else await target.createFile('', item.name, bytes);
                        copied++;
                    } catch (e) { errors.push(item.name + ': ' + (e.message || e)); }
                }
                setBusy('');
                if (typeof target.flush === 'function') await target.flush();
                await selectSource(targetSource);
                if (errors.length) ctx.toast?.(`${copied} copied, ${errors.length} failed: ${errors[0]}`, 'error');
                else if (copied) ctx.toast?.(`Copied ${copied} item${copied === 1 ? '' : 's'} to ${targetSource}`, 'success');
            } catch (e) {
                setBusy('');
                ctx.toast?.('Copy failed: ' + (e.message || e), 'error');
            }
        }

        // ── Tree rendering ─────────────────────────────────────
        function sortedForUI(items) {
            const copy = items.slice();
            copy.sort((a, b) => {
                if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
                if (sortMode === 'size') return (b.size || 0) - (a.size || 0);
                if (sortMode === 'mtime') {
                    const at = Date.parse(a.mtime || '') || 0;
                    const bt = Date.parse(b.mtime || '') || 0;
                    if (at !== bt) return bt - at;
                }
                const cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
                return sortMode === 'name-desc' ? -cmp : cmp;
            });
            return copy;
        }

        function matchesType(it) {
            const mime = it.kind === 'file' ? (it.mime || mimeFromName(it.name)) : '';
            switch (typeFilter) {
                case 'folders': return it.kind === 'dir';
                case 'images': return /^image\//.test(mime);
                case 'text': return it.kind === 'file' && isTextLike(it.name, mime);
                case 'docs': return it.kind === 'file' && /\.(pdf|docx?|odt|rtf|xlsx?|ods|pptx?|odp|csv|epub)$/i.test(it.name);
                case 'media': return /^(audio|video)\//.test(mime);
                case 'archives': return it.kind === 'file' && /\.(zip|tar|gz|tgz|bz2|xz|rar|7z|zst)$/i.test(it.name);
                default: return true;
            }
        }

        function renderList() {
            const q = filterText.trim().toLowerCase();
            if (deepSearch && q.length >= 2) {
                scheduleDeepSearch(q);
                return;
            }
            if (searchResults !== null) {
                searchResults = null;
                searchSeq++;
            }
            const items = sortedForUI(currentItems.filter(it => {
                if (!settings.hidden && it.name.startsWith('.')) return false;
                if (!matchesType(it)) return false;
                return !q || it.name.toLowerCase().includes(q);
            }));
            visibleItems = items;
            let html = '';
            if (currentSource === 'profile') {
                html += `<div class="fm-warn">⚠ Changes sync to your linked folder immediately.</div>`;
            } else if (currentSource === 'machine') {
                html += `<div class="fm-warn">⚠ Changes are written directly to this machine.</div>`;
            }
            if (items.length) {
                html += `<div class="fm-list">${renderEntries(items)}</div>`;
            } else if (q) {
                html += `<div class="fm-empty">No matches for “${escapeHTML(filterText)}”.</div>`;
            } else {
                html += `<div class="fm-empty">${currentSource === 'virtual' || currentSource === 'packages' ? 'Empty.' : 'Empty folder.'}</div>`;
            }
            $tree.innerHTML = html;
            wireEntries(items);
            paintSelection();
            loadThumbs(items);
        }

        function setBusy(text) {
            const $busy = root.querySelector('#fm-busy');
            if (!$busy) return;
            $busy.hidden = !text;
            $busy.textContent = text || '';
        }

        function scheduleDeepSearch(q) {
            clearTimeout(searchTimer);
            setBusy('Searching…');
            searchTimer = setTimeout(() => runDeepSearch(q), 300);
        }

        async function runDeepSearch(q) {
            const seq = ++searchSeq;
            const found = [];
            let scanned = 0, read = 0, bytes = 0;
            const MAX_ENTRIES = 3000, MAX_RESULTS = 200, MAX_DEPTH = 10, MAX_READ = 200, MAX_BYTES = 8 * 1024 * 1024;
            async function walk(dir, depth) {
                if (seq !== searchSeq || found.length >= MAX_RESULTS || scanned >= MAX_ENTRIES) return;
                let items;
                try { items = await backend.list(dir); } catch { return; }
                for (const it of items) {
                    if (seq !== searchSeq) return;
                    if (scanned++ >= MAX_ENTRIES) return;
                    if (!settings.hidden && it.name.startsWith('.')) continue;
                    const full = dir ? dir + '/' + it.name : it.name;
                    if (it.name.toLowerCase().includes(q)) {
                        found.push({ ...it, dir, path: full, snippet: '' });
                    } else if (it.kind === 'file' && read < MAX_READ && (it.size || 0) <= 256 * 1024
                        && bytes < MAX_BYTES && isTextLike(it.name, it.mime || mimeFromName(it.name))) {
                        read++;
                        try {
                            const data = await backend.readFile(full, 256 * 1024);
                            if (seq !== searchSeq) return;
                            bytes += data.bytes.byteLength;
                            const text = new TextDecoder().decode(data.bytes);
                            const at = text.toLowerCase().indexOf(q);
                            if (at >= 0) {
                                const start = Math.max(0, at - 40);
                                const snippet = text.slice(start, at + q.length + 60).replace(/\s+/g, ' ').trim();
                                found.push({ ...it, dir, path: full, snippet });
                            }
                        } catch {}
                    }
                    if (found.length >= MAX_RESULTS || scanned >= MAX_ENTRIES) return;
                    if (it.kind === 'dir' && depth < MAX_DEPTH) await walk(full, depth + 1);
                }
            }
            await walk(cwd, 0);
            if (seq !== searchSeq) return;
            setBusy('');
            searchResults = found;
            renderSearchResults(q);
        }

        function renderSearchResults(q) {
            const items = searchResults || [];
            let html = `<div class="fm-warn">Subfolders: ${items.length} result${items.length === 1 ? '' : 's'} for “${escapeHTML(q)}”.</div>`;
            if (items.length) {
                html += `<div class="fm-list">` + items.map((it, i) => {
                    const fallback = it.kind === 'dir' ? '📁' : '📄';
                    const where = it.snippet ? escapeHTML(it.snippet) : escapeHTML(it.dir || '/');
                    return `<div class="fm-entry fm-search-result" data-sres="${i}">
                        <span class="fm-entry-icon">${entryIcon(it.name, it.kind, it.symlink, fallback)}</span>
                        <span class="fm-entry-name">${escapeHTML(it.name)}</span>
                        <span class="fm-entry-meta fm-search-where" title="${escapeHTML(it.path)}">${where}</span>
                        <button class="fm-row-more" data-sres-more title="More actions">⋯</button>
                    </div>`;
                }).join('') + '</div>';
            } else {
                html += `<div class="fm-empty">Nothing matched in this folder and its subfolders.</div>`;
            }
            $tree.innerHTML = html;
            visibleItems = items;
            $tree.querySelectorAll('[data-sres]').forEach(el => {
                const it = items[Number(el.dataset.sres)];
                el.addEventListener('click', async (ev) => {
                    if (ev.target.closest('[data-sres-more]')) return;
                    await revealResult(it);
                });
                el.querySelector('[data-sres-more]')?.addEventListener('click', async (ev) => {
                    ev.stopPropagation();
                    const r = ev.target.getBoundingClientRect();
                    const choice = await ctx.contextMenu.show({ x: r.left, y: r.bottom, items: [
                        { id: 'reveal', label: 'Show in folder', icon: '📍' },
                        { id: 'props', label: 'Properties', icon: 'ℹ' },
                    ] });
                    if (choice === 'reveal') await revealResult(it);
                    else if (choice === 'props') await showProperties(it);
                });
            });
        }

        async function revealResult(it) {
            deepSearch = false;
            root.querySelector('[data-act="deep"]')?.classList.remove('fm-active');
            searchResults = null;
            searchSeq += 1;
            filterText = '';
            const $s = root.querySelector('#fm-search');
            if ($s) $s.value = '';
            if (it.kind === 'dir') { await navigate(it.path); return; }
            await navigate(it.dir);
            const idx = visibleItems.findIndex(v => v.name === it.name);
            if (idx < 0) return;
            selection = new Set([it.name]);
            selected = visibleItems[idx];
            anchorIdx = idx;
            paintSelection();
            $tree.querySelector(`.fm-entry[data-idx="${idx}"]`)?.scrollIntoView({ block: 'center' });
            if (selected.kind === 'file') renderPreview();
        }

        async function refresh() {
            if (!backend) return;
            selection.clear();
            selected = null;
            anchorIdx = -1;
            resetPreview();
            resetThumbs();
            try {
                currentItems = await backend.list(cwd);
                renderList();
                updateToolbar();
            } catch (e) {
                console.warn('[filemanager] list', e);
                currentItems = [];
                visibleItems = [];
                $tree.innerHTML = `<div class="fm-empty">Could not list: ${escapeHTML(e.message || e)}</div>`;
            }
        }

        function rowActionsHTML(it, writable) {
            if (it.kind === 'dir' && !writable) return '';
            return `<button class="fm-row-more" data-row-more title="More actions">⋯</button>`;
        }

        async function openRowMenu(it, x, y) {
            const writable = !!backend && backend.isWritable?.() && currentSource !== 'packages';
            if (!selection.has(it.name)) {
                selection = new Set([it.name]);
                selected = it;
                anchorIdx = visibleItems.indexOf(it);
                paintSelection();
            }
            const multi = selection.size > 1;
            const count = selection.size;
            const canHandoff = !multi && it.kind === 'file' && isTextLike(it.name, it.mime) && currentSource !== 'packages';
            const items = [];
            if (multi) {
                items.push({ id: 'copy', label: `Copy ${count} items`, icon: '⧉' });
                if (writable) items.push({ id: 'cut', label: `Cut ${count} items`, icon: '✂' });
                if (writable) items.push({ id: 'bulkRename', label: `Rename ${count} items`, icon: '✎' });
                if (writable) items.push({ separator: true });
                if (writable) items.push({ id: 'delete', label: `Delete ${count} items`, icon: '🗑', danger: true });
            } else {
                if (it.kind === 'file') items.push({ id: 'download', label: 'Download', icon: '⬇' });
                if (canHandoff) items.push({ id: 'openGrimoire', label: 'Open in Grimoire', icon: '📜' });
                if (items.length) items.push({ separator: true });
                items.push({ id: 'copy', label: 'Copy', icon: '⧉' });
                items.push({ id: 'props', label: 'Properties', icon: 'ℹ' });
                if (writable) {
                    const canRename = it.kind === 'file' || backend.kind === 'virtual' || backend.kind === 'machine';
                    items.push({ id: 'cut', label: 'Cut', icon: '✂' });
                    if (canRename) items.push({ id: 'rename', label: 'Rename', icon: '✎' });
                    items.push({ id: 'delete', label: 'Delete', icon: '🗑', danger: true });
                }
            }
            if (!items.length) return;
            const choice = await ctx.contextMenu.show({ x, y, items });
            if (!choice) return;
            if (choice === 'copy' || choice === 'cut') { setClipboard(choice); return; }
            if (choice === 'delete' && multi) { await deleteSelection(); return; }
            if (choice === 'bulkRename') { await bulkRename(); return; }
            if (choice === 'props') { await showProperties(it); return; }
            await runRowAction(choice, it);
        }

        async function openBlankMenu(x, y) {
            const writable = !!backend?.isWritable?.() && currentSource !== 'packages';
            const items = [];
            if (writable) {
                items.push({ id: 'newfile', label: 'New file', icon: '📄' });
                items.push({ id: 'newdir', label: 'New folder', icon: '📁' });
                items.push({ separator: true });
                items.push({ id: 'paste', label: 'Paste', icon: '📋', disabled: !clipboard?.items?.length });
            }
            items.push({ id: 'selectAll', label: 'Select all', icon: '▣' });
            items.push({ id: 'refresh', label: 'Refresh', icon: '⟳' });
            const choice = await ctx.contextMenu.show({ x, y, items });
            if (choice === 'newfile') await createFileHere();
            else if (choice === 'newdir') await createDirHere();
            else if (choice === 'paste') await pasteClipboard();
            else if (choice === 'selectAll') selectAll();
            else if (choice === 'refresh') { resetPreview(); await refresh(); }
        }

        function entryIcon(name, kind, symlink, fallback) {
            if (settings.icons === false) return `<span class="fm-emoji">${fallback}</span>`;
            const iconId = kind === 'dir'
                ? folderIconId(name, false, false)
                : fileIconId(name, { symlink: !!symlink });
            return iconHTML(ctx, iconId, 'fm-icon', fallback);
        }

        function renderEntries(items) {
            const writable = !!backend && backend.isWritable?.() && currentSource !== 'packages';
            return items.map((it, i) => {
                const fallback = it.kind === 'dir' ? '📁' : '📄';
                const hiddenCls = it.name.startsWith('.') ? ' fm-hidden-entry' : '';
                return `
                <div class="fm-entry${hiddenCls}" data-idx="${i}">
                    <span class="fm-entry-icon">${entryIcon(it.name, it.kind, it.symlink, fallback)}</span>
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
                    ev.stopPropagation();
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
                    handleEntryClick(it, ev);
                });
                el.addEventListener('dblclick', async (ev) => {
                    if (ev.target.closest('[data-row-more]')) return;
                    if (it.kind !== 'dir') return;
                    filterText = '';
                    const search = root.querySelector('#fm-search');
                    if (search) search.value = '';
                    await navigate(itemPath(it));
                });

                const writable = !!backend?.isWritable?.() && currentSource !== 'packages';
                if (writable && backend?.move) {
                    el.draggable = true;
                    el.addEventListener('dragstart', (ev) => {
                        if (ev.target.closest('[data-row-more]')) { ev.preventDefault(); return; }
                        if (!selection.has(it.name)) {
                            selection = new Set([it.name]);
                            selected = it;
                            anchorIdx = visibleItems.indexOf(it);
                            paintSelection();
                        }
                        const picked = selectedItems().map(x => ({ path: itemPath(x), name: x.name, kind: x.kind }));
                        const first = picked[0] || { path: itemPath(it), name: it.name, kind: it.kind };
                        const payload = { source: currentSource, items: picked, path: first.path, name: first.name, kind: first.kind };
                        ev.dataTransfer.setData(INTERNAL_MIME, JSON.stringify(payload));
                        ev.dataTransfer.setData('text/plain', picked.map(x => x.path).join('\n'));
                        ev.dataTransfer.effectAllowed = 'move';
                        $tree.querySelectorAll('.fm-entry.fm-selected').forEach(x => x.classList.add('fm-dragging'));
                    });
                    el.addEventListener('dragend', () => $tree.querySelectorAll('.fm-dragging').forEach(x => x.classList.remove('fm-dragging')));
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
        root.querySelector('#fm-type').addEventListener('change', (ev) => {
            typeFilter = ev.target.value;
            renderList();
        });
        root.querySelector('[data-act="deep"]').addEventListener('click', () => {
            deepSearch = !deepSearch;
            root.querySelector('[data-act="deep"]').classList.toggle('fm-active', deepSearch);
            renderList();
            if (deepSearch) $search.focus();
        });
        root.querySelector('[data-act="back"]').addEventListener('click', goBack);
        root.querySelector('[data-act="forward"]').addEventListener('click', goForward);
        root.querySelector('[data-act="up"]').addEventListener('click', async () => {
            if (!cwd) return;
            await navigate(parentPath(cwd));
        });
        root.querySelector('[data-act="refresh"]').addEventListener('click', async () => { resetPreview(); await refresh(); });

        async function createFileHere() {
            if (!backend?.isWritable?.()) return;
            const name = (prompt('New file name:') || '').trim();
            if (!validName(name)) { if (name) ctx.toast?.('Invalid name', 'error'); return; }
            if (await nameExists(backend, cwd, name)) { ctx.toast?.('A file or folder with that name already exists', 'error'); return; }
            try { await backend.createFile(cwd, name, ''); await refresh(); }
            catch (e) { ctx.toast?.('Create failed: ' + (e.message || e), 'error'); }
        }
        async function createDirHere() {
            if (!backend?.isWritable?.()) return;
            const name = (prompt('New folder name:') || '').trim();
            if (!validName(name)) { if (name) ctx.toast?.('Invalid name', 'error'); return; }
            if (await nameExists(backend, cwd, name)) { ctx.toast?.('A file or folder with that name already exists', 'error'); return; }
            try { await backend.createDir(cwd, name); await refresh(); }
            catch (e) { ctx.toast?.('Create failed: ' + (e.message || e), 'error'); }
        }
        root.querySelector('[data-act="newfile"]').addEventListener('click', createFileHere);
        root.querySelector('[data-act="newdir"]').addEventListener('click', createDirHere);
        root.querySelector('[data-act="view"]').addEventListener('click', () => {
            settings.view = settings.view === 'grid' ? 'list' : 'grid';
            saveSettings();
            applySettings();
            renderList();
        });
        root.querySelector('[data-act="upload"]').addEventListener('click', () => $uploadInput.click());
        $uploadInput.addEventListener('change', async () => {
            if (!backend?.isWritable?.()) return;
            const files = Array.from($uploadInput.files || []);
            $uploadInput.value = '';
            for (let i = 0; i < files.length; i++) {
                setBusy(`Uploading ${i + 1}/${files.length}…`);
                try { await uploadOneFile(files[i], cwd, files[i].name); }
                catch (e) { ctx.toast?.('Upload failed: ' + files[i].name + ' — ' + (e.message || e), 'error'); }
            }
            setBusy('');
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
            renderFavorites();
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
            selection.clear();
            selected = null;
            anchorIdx = -1;
            resetPreview();
            renderList();
        });
        root.querySelector('#fm-set-icons').addEventListener('change', (ev) => {
            settings.icons = ev.target.checked;
            saveSettings();
            renderList();
        });
        root.querySelector('#fm-set-grid').addEventListener('change', (ev) => {
            settings.view = ev.target.checked ? 'grid' : 'list';
            saveSettings();
            applySettings();
            renderList();
        });
        root.querySelector('#fm-set-thumb').addEventListener('change', (ev) => {
            settings.thumbSize = ['s', 'm', 'l'].includes(ev.target.value) ? ev.target.value : 'm';
            saveSettings();
            applySettings();
            if (settings.view === 'grid') renderList();
        });
        root.querySelector('[data-act="pin"]').addEventListener('click', pinCurrent);
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
        function isTypingTarget(ev) {
            const t = ev.target;
            return !!(t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
        }

        document.addEventListener('keydown', async (ev) => {
            if (ev.key === 'Escape') {
                if (!$settings.hidden) closeSettings();
                else if (selection.size) { clearSelection(); paintSelection(); }
                return;
            }
            if (isTypingTarget(ev)) return;
            const mod = ev.ctrlKey || ev.metaKey;
            if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); selectAll(); return; }
            if (mod && ev.key.toLowerCase() === 'c') { ev.preventDefault(); setClipboard('copy'); return; }
            if (mod && ev.key.toLowerCase() === 'x') { ev.preventDefault(); setClipboard('cut'); return; }
            if (mod && ev.key.toLowerCase() === 'v') { ev.preventDefault(); await pasteClipboard(); return; }
            if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); await goBack(); return; }
            if (ev.altKey && ev.key === 'ArrowRight') { ev.preventDefault(); await goForward(); return; }
            if (ev.key === 'F2') {
                ev.preventDefault();
                const it = singleSelected();
                if (it) await runRowAction('rename', it);
                return;
            }
            if (ev.key === 'Delete') { ev.preventDefault(); await deleteSelection(); return; }
            if (ev.key === 'Backspace') { ev.preventDefault(); if (cwd) await navigate(parentPath(cwd)); return; }
            if (ev.key === 'Enter') {
                const it = singleSelected();
                if (it?.kind === 'dir') await navigate(itemPath(it));
                return;
            }
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                movePrimary(ev.key === 'ArrowDown' ? 1 : -1);
                return;
            }
            if (!mod && !ev.altKey && ev.key.length === 1 && /\S/.test(ev.key)) {
                // Type anywhere to filter.
                ev.preventDefault();
                $search.value = $search.value + ev.key;
                filterText = $search.value;
                renderList();
                $search.focus();
            }
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
        $tree.addEventListener('contextmenu', (ev) => {
            if (ev.target.closest('.fm-entry')) return;
            ev.preventDefault();
            openBlankMenu(ev.clientX, ev.clientY);
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
