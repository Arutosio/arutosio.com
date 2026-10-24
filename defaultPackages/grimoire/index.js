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

function validName(name) {
    name = String(name || '').trim();
    return !!name && name !== '.' && name !== '..' && !/[/\x00-\x1f\x7f]/.test(name);
}

// ── Small, safe Markdown renderer for the Preview tab ────────────
function safeMarkdownURL(raw) {
    const url = String(raw || '').trim();
    if (!/^(https?:|mailto:)/i.test(url)) return '';
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' ? u.href : '';
    } catch { return ''; }
}

function renderMarkdownInline(raw) {
    const codes = [];
    let s = escapeHTML(raw);
    s = s.replace(/`([^`]+)`/g, (_, code) => {
        codes.push(code);
        return '\u0000' + (codes.length - 1) + '\u0000';
    });
    // shortcut: URLs containing ")" stop the match, fine for a small preview
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, url) => {
        const safe = safeMarkdownURL(url.replace(/&amp;/g, '&'));
        return safe ? `<img src="${escapeHTML(safe)}" alt="${alt}" loading="lazy">` : match;
    });
    s = s.replace(/(^|[^!])\[([^\]]+)\]\(([^)\s]+)\)/g, (match, pre, label, url) => {
        const safe = safeMarkdownURL(url.replace(/&amp;/g, '&'));
        return safe ? pre + `<a href="${escapeHTML(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>` : match;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)] ?? ''}</code>`);
    return s;
}

function renderMarkdown(raw) {
    const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const para = [];
    let listType = '';
    let inCode = false;
    let codeLang = '';
    let code = [];
    let inQuote = false;

    const flushPara = () => {
        if (para.length) { out.push(`<p>${renderMarkdownInline(para.join(' '))}</p>`); para.length = 0; }
    };
    const flushList = () => {
        if (listType) { out.push(`</${listType}>`); listType = ''; }
    };
    const flushQuote = () => {
        if (inQuote) { out.push('</blockquote>'); inQuote = false; }
    };

    for (const line of lines) {
        if (inCode) {
            if (/^```/.test(line)) {
                out.push(`<pre><code${codeLang ? ` class="language-${escapeHTML(codeLang)}"` : ''}>${escapeHTML(code.join('\n'))}</code></pre>`);
                inCode = false; code = []; codeLang = '';
            } else code.push(line);
            continue;
        }
        const fence = /^```\s*([\w-]*)\s*$/.exec(line);
        if (fence) {
            flushPara(); flushList(); flushQuote();
            inCode = true; codeLang = fence[1]; code = [];
            continue;
        }
        if (!line.trim()) { flushPara(); flushList(); flushQuote(); continue; }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
            flushPara(); flushList(); flushQuote();
            const n = heading[1].length;
            out.push(`<h${n}>${renderMarkdownInline(heading[2])}</h${n}>`);
            continue;
        }
        if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
            flushPara(); flushList(); flushQuote();
            out.push('<hr>');
            continue;
        }
        const quote = /^>\s?(.*)$/.exec(line);
        if (quote) {
            flushPara(); flushList();
            if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
            out.push(`<p>${renderMarkdownInline(quote[1])}</p>`);
            continue;
        }
        const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
        const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        if (ul || ol) {
            flushPara(); flushQuote();
            const type = ul ? 'ul' : 'ol';
            if (listType !== type) {
                flushList();
                out.push(`<${type}>`);
                listType = type;
            }
            out.push(`<li>${renderMarkdownInline((ul || ol)[1])}</li>`);
            continue;
        }
        flushList(); flushQuote();
        para.push(line);
    }
    if (inCode) out.push(`<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`);
    flushPara(); flushList(); flushQuote();
    return out.join('\n');
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
        if (!src || !destDir || !destDir.handle) return;
        const srcParentPath = fromPath.split('/').slice(0, -1).join('/');
        if (srcParentPath === toParentPath) return;
        if (src.isDir) throw new Error('directory_move_unsupported');
        const existing = await destDir.handle.getFileHandle(src.name, { create: false }).catch(() => null);
        if (existing) throw new Error('exists');
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
            this._saveTimer = null;
            this.flush().catch(e => console.warn('[grimoire] virtualFS save failed', e));
        }, 200);
    }

    async flush() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        await this.ctx.storage.set('virtualFS', { name: this._name, tree: this._tree });
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
        if (src.isDir && (toParentPath === fromPath || toParentPath.startsWith(fromPath + '/'))) {
            throw new Error('cannot_move_into_self');
        }
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

// MachineBackend — edits a single file opened from Files on this machine.
// The full tree browser is Files; Grimoire only needs the selected path.
class MachineBackend {
    constructor(ctx, ref) {
        this.ctx = ctx;
        this._path = String(ref.path || '');
        this._name = String(ref.name || this._path.split('/').pop() || 'file');
        this._etag = String(ref.etag || '');
        this._tree = this._buildTree(this._path);
    }
    static kind = 'machine';
    get kind() { return 'machine'; }
    isWritable() { return true; }
    rootName() { return 'This machine'; }

    _buildTree(path) {
        const root = { name: 'This machine', path: '', isDir: true, children: [] };
        const parts = String(path || '').split('/').filter(Boolean);
        let cur = root;
        let curPath = '';
        for (let i = 0; i < parts.length; i++) {
            curPath = curPath ? curPath + '/' + parts[i] : parts[i];
            const last = i === parts.length - 1;
            const node = last
                ? { name: parts[i], path: curPath, isDir: false }
                : { name: parts[i], path: curPath, isDir: true, children: [] };
            cur.children.push(node);
            cur = node;
        }
        return root;
    }

    async list() { return this._tree; }

    async readFile(path) {
        const r = await this.ctx.fs.read(path, 8 * 1024 * 1024);
        this._etag = r.etag || '';
        return new TextDecoder().decode(r.bytes);
    }

    async writeFile(path, content) {
        try {
            const r = await this.ctx.fs.write(path, new TextEncoder().encode(content || ''), this._etag);
            this._etag = r.etag || this._etag;
        } catch (e) {
            const msg = String(e.message || e);
            if (msg.includes('file changed') || msg.includes('409')) {
                const err = new Error('File changed on disk — reopen it before saving.');
                err.code = 'conflict';
                throw err;
            }
            throw e;
        }
    }

    async createFile() { throw new Error('Use Files to create files on this machine.'); }
    async createDir() { throw new Error('Use Files to create folders on this machine.'); }
    async deleteNode() { throw new Error('Use Files to delete files on this machine.'); }
    async renameNode() { throw new Error('Use Files to rename files on this machine.'); }
    async moveNode() { throw new Error('Use Files to move files on this machine.'); }
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
        $saveInd.addEventListener('click', () => {
            const d = active();
            if (d?._conflict) resolveConflict(d).catch(() => {});
            else if (d?._dirty) saveDoc(d).catch(() => {});
        });
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
        let openSeq = 0;

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
                    d._dirty = true;
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
                        d._dirty = true;
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
                if (lang === 'markdown') {
                    $body.innerHTML = '<div class="preview preview-md"></div>';
                    $body.querySelector('.preview').innerHTML = renderMarkdown(content);
                } else {
                    await hljsReady;
                    $body.innerHTML = '<div class="preview"><pre><code></code></pre></div>';
                    const codeEl = $body.querySelector('code');
                    codeEl.textContent = content;
                    if (window.hljs && lang !== 'plaintext') {
                        codeEl.className = 'language-' + lang;
                        try { window.hljs.highlightElement(codeEl); } catch {}
                    }
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

        function setSaveIndicator(d) {
            if (!d) {
                $saveInd.textContent = '';
                $saveInd.title = '';
                $saveInd.style.cursor = 'default';
                return;
            }
            if (d._conflict) {
                $saveInd.textContent = 'conflict — reload';
                $saveInd.title = 'The file changed on disk. Click to reload the disk version.';
                $saveInd.style.cursor = 'pointer';
            } else if (d._dirty) {
                $saveInd.textContent = 'unsaved';
                $saveInd.title = 'Unsaved changes — click to save now.';
                $saveInd.style.cursor = 'pointer';
            } else {
                $saveInd.textContent = '';
                $saveInd.title = '';
                $saveInd.style.cursor = 'default';
            }
        }

        async function resolveConflict(d, b = backend, path = d?.id?.slice(5)) {
            if (!d || !b || !path) return;
            if (!window.confirm('This file changed on disk. Reload the disk version? Your local changes will be lost.')) return;
            try {
                const content = await b.readFile(path);
                d.content = content;
                d._conflict = false;
                d._dirty = false;
                if (active() === d) {
                    setSaveIndicator(d);
                    await renderBody();
                } else {
                    setSaveIndicator(active());
                }
            } catch (e) {
                alert('Could not reload the file: ' + (e.message || e));
            }
        }

        async function saveDoc(d, b = backend, path = d?.id?.slice(5)) {
            if (!d || !b || !path || !b.isWritable() || d._conflict) return false;
            if (active() === d) $saveInd.textContent = 'saving…';
            try {
                await b.writeFile(path, d.content || '');
                d._dirty = false;
                d.updatedAt = Date.now();
                if (active() === d) {
                    $saveInd.textContent = 'saved';
                    setTimeout(() => {
                        if (active() === d && !d._dirty && !d._conflict) $saveInd.textContent = '';
                    }, 1400);
                }
                return true;
            } catch (e) {
                console.warn('[grimoire] autosave failed', e);
                const conflict = e?.code === 'conflict' || /conflict|file changed/i.test(String(e?.message || e));
                d._dirty = true;
                if (conflict) {
                    d._conflict = true;
                    if (active() === d) setSaveIndicator(d);
                    Promise.resolve(ctx.toast?.('File changed on disk — click the save indicator to reload it.', 'warning')).catch(() => {});
                } else if (active() === d) {
                    $saveInd.textContent = 'save failed';
                }
                return false;
            }
        }

        function scheduleFileSave() {
            const d = active();
            if (!d || !backend || !backend.isWritable() || d._conflict) return;
            d._dirty = true;
            if (fileSaveTimer) clearTimeout(fileSaveTimer);
            const b = backend;
            const path = d.id.slice(5);
            if (active() === d) $saveInd.textContent = 'saving…';
            fileSaveTimer = setTimeout(() => {
                fileSaveTimer = null;
                saveDoc(d, b, path);
            }, 450);
        }

        async function flushPendingSave() {
            if (fileSaveTimer) {
                clearTimeout(fileSaveTimer);
                fileSaveTimer = null;
            }
            const d = active();
            if (!d) return true;
            if (d._conflict) return false;
            if (!d._dirty) return true;
            if (!backend?.isWritable()) return true;
            return await saveDoc(d, backend, d.id.slice(5));
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
        async function showLauncher() {
            const canPicker = !ctx.local && 'showDirectoryPicker' in window;
            const saved = await ctx.storage.get('virtualFS').catch(() => null);
            const hasSaved = !!(saved?.tree?.children?.length);
            const parts = [];
            if (canPicker) parts.push('<button class="launcher-btn" data-launch="disk">📁 Open real folder</button>');
            if (hasSaved) parts.push('<button class="launcher-btn" data-launch="virtual-saved">📝 Continue saved workspace</button>');
            parts.push('<button class="launcher-btn" data-launch="virtual">📝 New virtual workspace</button>');
            if (!ctx.local && !canPicker) parts.push('<button class="launcher-btn" data-launch="webkit">📁 Open folder (read-only)</button>');
            const hint = ctx.local
                ? 'Open a file from Files → This machine, or use a virtual workspace in your browser.'
                : (canPicker
                    ? 'Real folders sync to disk. Virtual workspaces live in your browser.'
                    : 'This browser lacks the File System Access API. Virtual workspaces are fully editable and can be exported as a .zip.');
            $folderTree.innerHTML = `
                <div class="launcher">
                    <div class="launcher-title">Open a workspace</div>
                    ${parts.join('')}
                    <div class="launcher-hint">${hint}</div>
                </div>
            `;
            $folderTree.querySelectorAll('[data-launch]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const kind = btn.dataset.launch;
                    if (kind === 'disk') await openDiskPicker();
                    else if (kind === 'webkit') openWebkitDirInput();
                    else if (kind === 'virtual-saved') await openVirtualWorkspace(saved);
                    else if (kind === 'virtual') {
                        if (hasSaved && !window.confirm('Starting a new virtual workspace replaces the saved one. Continue?')) return;
                        await openVirtualWorkspace();
                    }
                });
            });
        }

        function updateHeaderControls() {
            const writable = !!backend && backend.isWritable() && backend.kind !== 'machine';
            $folderNewFile.style.display = writable ? '' : 'none';
            $folderNewDir.style.display  = writable ? '' : 'none';
            if (backend) {
                const prefix = backend.kind === 'virtual' ? '📝 ' : (backend.kind === 'machine' ? '🖥 ' : '📂 ');
                const suffix = backend.isWritable() ? '' : ' (read-only)';
                $folderLabel.textContent = prefix + backend.rootName() + suffix;
            } else {
                $folderLabel.textContent = '📁 Grimoire';
            }
            renderMenu();
        }

        async function setBackend(b) {
            let nextTree;
            try {
                nextTree = await b.list();
            } catch (e) {
                alert('Could not open folder: ' + (e.message || e));
                return false;
            }
            if (!(await flushPendingSave())) {
                alert('Could not save the current file. Resolve the conflict before switching folder.');
                return false;
            }
            try { await backend?.flush?.(); } catch (e) { console.warn('[grimoire] flush failed', e); }
            openSeq++;
            backend = b;
            tree = nextTree;
            expanded.clear();
            _fileDocs.clear();
            activeId = null;
            setSaveIndicator(null);
            updateHeaderControls();
            renderFolderTree();
            await renderBody();
            await persistActive();
            return true;
        }

        async function closeFolder() {
            // Virtual workspace persists automatically — clearing UI state
            // only; user's virtualFS stays in ctx.storage for next boot.
            if (!(await flushPendingSave())) {
                alert('Could not save the current file. Resolve the conflict before closing the folder.');
                return;
            }
            try { await backend?.flush?.(); } catch (e) { console.warn('[grimoire] flush failed', e); }
            openSeq++;
            backend = null; tree = null;
            expanded.clear();
            _fileDocs.clear();
            activeId = null;
            setSaveIndicator(null);
            try { await ctx.storage.remove('machineFile'); } catch {}
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
                if (!(await setBackend(b))) return;
                try { await ctx.storage.remove('machineFile'); } catch {}
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
                if (!(await setBackend(b))) return;
                try { await ctx.storage.remove('machineFile'); } catch {}
            });
            input.click();
        }

        async function openVirtualWorkspace(initial) {
            const b = new VirtualBackend(ctx, initial);
            if (!(await setBackend(b))) return false;
            try { await ctx.storage.remove('machineFile'); } catch {}
            // Ensure an initial persist so reloads pick it up.
            b._persist();
            return true;
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
            const canWrite = backend?.isWritable() && backend.kind !== 'machine';
            if (node.isDir) {
                const collapsed = !isRoot && !expanded.has(node.path);
                const kids = (node.children || []).map(c => renderNode(c, depth + 1, false)).join('');
                const actions = canWrite ? `
                    <button class="ftree-act" data-action="new-file" data-path="${escapeHTML(node.path)}" title="New file here">📄＋</button>
                    <button class="ftree-act" data-action="new-dir"  data-path="${escapeHTML(node.path)}" title="New folder here">📁＋</button>
                ` : '';
                const icon = iconHTML(ctx, folderIconId(node.name, !collapsed, isRoot), 'ftree-icon-img', isRoot ? '📂' : '📁');
                return `
                    <div class="ftree-dir ${collapsed ? 'is-collapsed' : ''}" data-path="${escapeHTML(node.path)}">
                        <div class="ftree-item ftree-drop" data-kind="dir" data-path="${escapeHTML(node.path)}">
                            <span class="ftree-chev">▾</span>
                            <span class="ftree-icon">${icon}</span>
                            <span class="ftree-name">${escapeHTML(node.name)}</span>
                            ${actions}
                        </div>
                        <div class="ftree-children">${kids || '<div class="ftree-empty">empty</div>'}</div>
                    </div>
                `;
            } else {
                const isActive = activeId === 'file:' + node.path;
                const icon = iconHTML(ctx, fileIconId(node.name), 'ftree-icon-img', '📄');
                return `
                    <div class="ftree-file" data-path="${escapeHTML(node.path)}">
                        <div class="ftree-item ${isActive ? 'ftree-active' : ''}" data-kind="file" data-path="${escapeHTML(node.path)}" ${canWrite ? 'draggable="true"' : ''}>
                            <span class="ftree-chev"></span>
                            <span class="ftree-icon">${icon}</span>
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
                        e.stopPropagation();
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
            const name = (window.prompt('New file name (e.g. notes.md)') || '').trim();
            if (!validName(name)) {
                if (name) alert('Invalid file name.');
                return;
            }
            if (backend?._findNode?.(parentPath)?.children?.some(c => c.name === name)) {
                alert('A file with that name already exists.');
                return;
            }
            try {
                const newPath = await backend.createFile(parentPath, name);
                expanded.add(parentPath);
                await refreshTree();
                await openFileFromTree(newPath);
            } catch (e) { alert('Could not create file: ' + (e.message || e)); }
        }
        async function promptAndCreateDir(parentPath) {
            const name = (window.prompt('New folder name') || '').trim();
            if (!validName(name)) {
                if (name) alert('Invalid folder name.');
                return;
            }
            if (backend?._findNode?.(parentPath)?.children?.some(c => c.name === name)) {
                alert('A folder with that name already exists.');
                return;
            }
            try {
                const newPath = await backend.createDir(parentPath, name);
                expanded.add(parentPath);
                expanded.add(newPath);
                await refreshTree();
            } catch (e) { alert('Could not create folder: ' + (e.message || e)); }
        }
        async function doMove(fromPath, toParentPath) {
            try {
                if (!(await flushPendingSave())) {
                    alert('Could not save the current file. Resolve the conflict before moving it.');
                    return;
                }
                const newPath = await backend.moveNode(fromPath, toParentPath);
                if (newPath && newPath !== fromPath) remapDocPaths(fromPath, newPath);
                await refreshTree();
                await persistActive();
                if (active()) setSaveIndicator(active());
            } catch (e) { alert('Could not move: ' + (e.message || e)); }
        }

        function remapDocPaths(oldPath, newPath) {
            for (const [path, doc] of Array.from(_fileDocs.entries())) {
                let next = null;
                if (path === oldPath) next = newPath;
                else if (path.startsWith(oldPath + '/')) next = newPath + path.slice(oldPath.length);
                if (next == null) continue;
                _fileDocs.delete(path);
                doc.id = 'file:' + next;
                _fileDocs.set(next, doc);
                if (activeId === 'file:' + path) activeId = doc.id;
            }
        }

        async function openFileFromTree(path) {
            if (!backend) return;
            const seq = ++openSeq;
            await flushPendingSave();
            if (seq !== openSeq) return;
            let doc = _fileDocs.get(path);
            try {
                if (!doc || (!doc._dirty && !doc._conflict)) {
                    const content = await backend.readFile(path);
                    if (seq !== openSeq) return;
                    if (typeof content === 'string' && content.length > 8 * 1024 * 1024) {
                        alert('This file is larger than 8 MB; open it from Files instead.');
                        return;
                    }
                    const name = path.split('/').pop();
                    const title = name.replace(/\.[^.]+$/, '');
                    const lang = langFromFilename(name);
                    doc = {
                        id: 'file:' + path,
                        title: doc?.title || name,
                        lang: doc?.lang || lang,
                        content,
                        updatedAt: Date.now(),
                        displayTitle: doc?.displayTitle || title,
                        _dirty: false,
                        _conflict: false,
                    };
                    _fileDocs.set(path, doc);
                }
            } catch (e) {
                if (seq !== openSeq) return;
                alert('Could not open file: ' + (e.message || e));
                return;
            }
            if (seq !== openSeq) return;
            activeId = doc.id;
            view = 'edit';
            $tabs.forEach(x => x.classList.toggle('active', x.dataset.view === 'edit'));
            renderFolderTree();
            setSaveIndicator(doc);
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
        // Restore the last machine file on this machine, else the last
        // virtual workspace, else the launcher.
        let restored = false;
        const savedMachine = ctx.local ? await ctx.storage.get('machineFile') : null;
        if (savedMachine && savedMachine.path) {
            try {
                const b = new MachineBackend(ctx, savedMachine);
                if (await setBackend(b)) {
                    await openFileFromTree(savedMachine.path);
                    restored = true;
                }
            } catch (e) {
                console.warn('[grimoire] machine restore failed', e);
                try { await ctx.storage.remove('machineFile'); } catch {}
            }
        }
        if (!restored) {
            const savedVirtual = await ctx.storage.get('virtualFS');
            if (savedVirtual && savedVirtual.tree) {
                restored = await openVirtualWorkspace(savedVirtual);
            }
            if (!restored) {
                activeId = null;
                await persistActive();
                showLauncher();
                await renderBody();
            }
        }

        // ── Handoff consumption (e.g. "Open in Grimoire" from Files) ──
        // Host writes the payload under `arutosio_handoff_grimoire` before
        // opening the window and also posts a live event when we are already
        // mounted. Both routes land here; the key is cleared on first use.
        async function handleHandoff(payload) {
            if (!payload) return;
            try { localStorage.removeItem('arutosio_handoff_grimoire'); } catch {}
            if (payload.type === 'machineFile') {
                if (!ctx.local) {
                    Promise.resolve(ctx.toast?.('This machine is not connected.', 'warning')).catch(() => {});
                    return;
                }
                const b = new MachineBackend(ctx, payload);
                if (!(await setBackend(b))) return;
                await openFileFromTree(payload.path);
                try {
                    await ctx.storage.set('machineFile', {
                        path: payload.path,
                        name: payload.name || payload.path.split('/').pop(),
                        mime: payload.mime || '',
                    });
                } catch {}
                Promise.resolve(ctx.toast?.('Opened ' + (payload.name || payload.path) + ' from Files', 'info')).catch(() => {});
                return;
            }
            if (payload.type === 'file' && typeof payload.name === 'string') {
                const content = typeof payload.content === 'string' ? payload.content : '';
                if (!(backend instanceof VirtualBackend)) {
                    const existing = await ctx.storage.get('virtualFS');
                    if (!(await openVirtualWorkspace(existing || { name: 'inbox', tree: { name: 'inbox', path: '', isDir: true, children: [] } }))) return;
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
                await openFileFromTree(newPath);
                Promise.resolve(ctx.toast?.('Opened ' + name + ' from Files', 'info')).catch(() => {});
            }
        }

        if (!ctx.local) {
            try {
                const raw = localStorage.getItem('arutosio_handoff_grimoire');
                if (raw) {
                    localStorage.removeItem('arutosio_handoff_grimoire');
                    await handleHandoff(JSON.parse(raw));
                }
            } catch (e) { console.warn('[grimoire] handoff failed', e); }
        }

        document.addEventListener('arutosio:handoff', (e) => {
            handleHandoff(e.detail).catch((err) => console.warn('[grimoire] handoff failed', err));
        });

        function isEditableFile(name, mime) {
            const ext = String(name || '').split('.').pop().toLowerCase();
            return Object.prototype.hasOwnProperty.call(EXT_TO_LANG, ext) || /^text\//.test(mime || '');
        }

        async function importDroppedFiles(files) {
            if (!files.length) {
                Promise.resolve(ctx.toast?.('Drop files, not folders', 'warning')).catch(() => {});
                return;
            }
            if (!backend) {
                if (!(await openVirtualWorkspace())) return;
            }
            if (backend.kind === 'machine') {
                Promise.resolve(ctx.toast?.('Use Files to add files on this machine', 'warning')).catch(() => {});
                return;
            }
            let imported = 0;
            let lastPath = null;
            for (const f of files) {
                if (!isEditableFile(f.name, f.type)) {
                    Promise.resolve(ctx.toast?.(f.name + ' is not a text file', 'warning')).catch(() => {});
                    continue;
                }
                if (f.size > 2 * 1024 * 1024) {
                    Promise.resolve(ctx.toast?.(f.name + ' is too large (max 2 MB)', 'warning')).catch(() => {});
                    continue;
                }
                let name = f.name;
                const dot = name.lastIndexOf('.');
                const base = dot > 0 ? name.slice(0, dot) : name;
                const ext = dot > 0 ? name.slice(dot) : '';
                let n = 1;
                while ((tree?.children || []).some(c => c.name === name)) {
                    name = base + '-' + n + ext;
                    n++;
                }
                const text = await f.text();
                const path = await backend.createFile('', name);
                await backend.writeFile(path, text);
                tree = await backend.list();
                lastPath = path;
                imported++;
            }
            if (imported) {
                renderFolderTree();
                if (lastPath) await openFileFromTree(lastPath);
                Promise.resolve(ctx.toast?.('Imported ' + imported + ' file' + (imported === 1 ? '' : 's'), 'success')).catch(() => {});
            }
        }

        const dropZone = root.querySelector('.wrap') || root;
        const hasInternalDrop = (ev) => Array.from(ev.dataTransfer?.types || []).includes('application/x-arutosio-file');
        const hasFilesDrop = (ev) => Array.from(ev.dataTransfer?.types || []).includes('Files');
        dropZone.addEventListener('dragover', (ev) => {
            if (!hasInternalDrop(ev) && !hasFilesDrop(ev)) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'copy';
            dropZone.classList.add('grimoire-drop');
        });
        dropZone.addEventListener('dragleave', (ev) => {
            if (ev.target === dropZone) dropZone.classList.remove('grimoire-drop');
        });
        dropZone.addEventListener('drop', async (ev) => {
            if (!hasInternalDrop(ev) && !hasFilesDrop(ev)) return;
            ev.preventDefault();
            dropZone.classList.remove('grimoire-drop');
            const raw = ev.dataTransfer.getData('application/x-arutosio-file');
            if (raw) {
                try {
                    const p = JSON.parse(raw);
                    if (p?.source === 'machine' && ctx.local && p.path) {
                        await handleHandoff({ type: 'machineFile', path: p.path, name: p.name || p.path.split('/').pop(), mime: '' });
                    } else {
                        Promise.resolve(ctx.toast?.('Use Files → Open in Grimoire for this source', 'warning')).catch(() => {});
                    }
                } catch (e) { console.warn('[grimoire] drop payload', e); }
                return;
            }
            await importDroppedFiles(Array.from(ev.dataTransfer.files || []));
        });
        const preventBrowserFileDrop = (ev) => {
            if (hasFilesDrop(ev)) ev.preventDefault();
        };
        window.addEventListener('dragover', preventBrowserFileDrop);
        window.addEventListener('drop', preventBrowserFileDrop);

        const flushOnHide = () => {
            flushPendingSave().catch(() => {});
            Promise.resolve(backend?.flush?.()).catch(() => {});
        };
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushOnHide();
        });
        window.addEventListener('pagehide', flushOnHide);
        root.__grimoireFlush = async () => {
            await flushPendingSave();
            await backend?.flush?.();
        };
    },

    async unmount(root) {
        try { await root.__grimoireFlush?.(); } catch {}
    }
};
