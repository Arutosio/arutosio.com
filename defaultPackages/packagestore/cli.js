/* ╔══════════════════════════════════════════════════════════╗
 * ║  pkg — apt-style package manager command                  ║
 * ║  list / search / install / update / remove / repo …       ║
 * ║  Repos come from the system module (ctx.repos.*).         ║
 * ╚══════════════════════════════════════════════════════════╝ */

function cmpVersion(a, b) {
    if (a === b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    const pa = String(a).split(/[.\-+]/);
    const pb = String(b).split(/[.\-+]/);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
        const na = parseInt(pa[i], 10);
        const nb = parseInt(pb[i], 10);
        const aNum = !isNaN(na);
        const bNum = !isNaN(nb);
        if (aNum && bNum) {
            if (na !== nb) return na > nb ? 1 : -1;
        } else {
            const sa = pa[i] || '';
            const sb = pb[i] || '';
            if (sa !== sb) return sa > sb ? 1 : -1;
        }
    }
    return 0;
}

function resolveURL(base, maybeRelative) {
    try { return new URL(maybeRelative, base).toString(); }
    catch { return maybeRelative; }
}

function pad(s, n) {
    s = String(s ?? '');
    return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// Hybrid-aware role label: prefer `roles` joined with `+`, fall back to
// legacy `type`, then to a generic `app`. Truncate long labels to keep
// the list columns readable.
function rolesLabel(m) {
    let label;
    if (m && Array.isArray(m.roles) && m.roles.length) label = m.roles.join(' + ');
    else label = (m && m.type) || 'app';
    return label.length > 18 ? label.slice(0, 17) + '…' : label;
}

function isURL(s) { return /^https?:\/\//i.test(String(s || '').trim()); }

async function fetchRepoIndex(ctx, repo) {
    let resp;
    try { resp = await ctx.fetch(repo.url); }
    catch (e) { throw new Error('Network error: ' + (e.message || e)); }
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + (resp.statusText || ''));
    let data;
    try { data = await resp.json(); }
    catch (e) { throw new Error('Invalid JSON: ' + e.message); }
    if (!data || !Array.isArray(data.packages)) throw new Error('Missing "packages" array');
    for (const p of data.packages) {
        if (p && typeof p.url === 'string') p.url = resolveURL(repo.url, p.url);
    }
    return data;
}

async function getEnabledIndexes(ctx, { useCache = true, force = false } = {}) {
    const repos = (await ctx.repos.list()) || [];
    const out = [];
    for (const repo of repos) {
        if (!repo.enabled) continue;
        let index = null;
        if (useCache && !force && repo.cachedIndex && Array.isArray(repo.cachedIndex.packages)) {
            index = repo.cachedIndex;
        } else {
            try {
                index = await fetchRepoIndex(ctx, repo);
                await ctx.repos.update(repo.url, {
                    cachedIndex: index,
                    lastFetched: Date.now(),
                    lastError: null,
                });
            } catch (e) {
                await ctx.repos.update(repo.url, { lastError: String(e.message || e) });
                await ctx.print('  ! ' + (repo.name || repo.url) + ': ' + e.message);
            }
        }
        if (index) out.push({ repo, index });
    }
    return out;
}

function findInIndexes(indexes, id) {
    let best = null;
    for (const { repo, index } of indexes) {
        for (const p of index.packages || []) {
            if (!p || p.id !== id) continue;
            if (!best || cmpVersion(p.version, best.pkg.version) > 0) {
                best = { pkg: p, repo };
            }
        }
    }
    return best;
}

async function downloadAndInstall(ctx, pkg) {
    const resp = await ctx.fetch(pkg.url, { binary: true });
    if (!resp.ok) throw new Error('Download failed: HTTP ' + resp.status);
    const blob = await resp.blob();
    const filename = (pkg.id || 'remote') + '.zip';
    return await ctx.installZip(blob, { filename });
}

// ── Subcommands ─────────────────────────────────────────────────

async function cmdHelp(ctx) {
    const lines = [
        'pkg — apt-style package manager',
        '',
        'Usage:',
        '  pkg list                       List installed packages',
        '  pkg search <query>             Search enabled repositories',
        '  pkg install <id|url>           Install by id (newest version) or by .zip URL',
        '  pkg update [<id>]              Upgrade all (or one) installed package',
        '  pkg remove <id>                Uninstall a package',
        '',
        '  pkg repo list                  List configured repositories',
        '  pkg repo add <url>             Add a repository',
        '  pkg repo remove <url>          Remove a repository',
        '  pkg repo refresh [<url>]       Re-fetch one or all enabled repositories',
        '',
        '  pkg help                       Show this message',
    ];
    for (const l of lines) await ctx.print(l);
}

async function cmdList(ctx) {
    const all = await ctx.listInstalled();
    if (!all || !all.length) { await ctx.print('No packages installed.'); return; }
    await ctx.print(pad('ID', 22) + pad('NAME', 24) + pad('VERSION', 12) + 'ROLES');
    await ctx.print('─'.repeat(78));
    for (const m of all) {
        await ctx.print(pad(m.id, 22) + pad(m.name || '', 24) + pad(m.version || '—', 12) + rolesLabel(m));
    }
    await ctx.print('');
    await ctx.print(all.length + ' package' + (all.length === 1 ? '' : 's') + ' installed.');
}

async function cmdSearch(ctx, query) {
    if (!query) { await ctx.print('Usage: pkg search <query>'); return; }
    const q = query.toLowerCase();
    const indexes = await getEnabledIndexes(ctx);
    if (!indexes.length) { await ctx.print('No enabled repositories. Add one with `pkg repo add <url>`.'); return; }
    let total = 0;
    for (const { repo, index } of indexes) {
        const matches = (index.packages || []).filter(p => {
            if (!p) return false;
            const hay = ((p.id || '') + ' ' + (p.name || '') + ' ' + (p.description || '')).toLowerCase();
            return hay.includes(q);
        });
        if (!matches.length) continue;
        await ctx.print('');
        await ctx.print('[' + (repo.name || repo.url) + ']');
        for (const p of matches) {
            await ctx.print('  ' + pad(p.id, 22) + pad('v' + (p.version || '—'), 12) + (p.description || ''));
            total++;
        }
    }
    await ctx.print('');
    await ctx.print(total + ' result' + (total === 1 ? '' : 's') + '.');
}

async function cmdInstall(ctx, target) {
    if (!target) { await ctx.print('Usage: pkg install <id|url>'); return; }
    if (isURL(target)) {
        if (!/^https:/i.test(target)) {
            await ctx.print('! Warning: URL is not HTTPS.');
        }
        await ctx.print('Downloading ' + target + '…');
        try {
            const resp = await ctx.fetch(target, { binary: true });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const blob = await resp.blob();
            const result = await ctx.installZip(blob, { filename: 'remote.zip' });
            if (result) {
                await ctx.print('Installed ' + result.name + ' v' + (result.version || '—'));
                await ctx.toast('Installed ' + result.name, 'success');
            } else {
                await ctx.print('Install cancelled.');
            }
        } catch (e) {
            await ctx.print('! ' + (e.message || e));
            await ctx.toast(String(e.message || e), 'error');
        }
        return;
    }
    const indexes = await getEnabledIndexes(ctx);
    if (!indexes.length) { await ctx.print('No enabled repositories. Add one with `pkg repo add <url>`.'); return; }
    const found = findInIndexes(indexes, target);
    if (!found) { await ctx.print('! Package not found: ' + target); return; }
    const { pkg, repo } = found;
    if (!pkg.url) { await ctx.print('! Package has no download URL.'); return; }
    if (!/^https:/i.test(pkg.url)) {
        await ctx.print('! Warning: download URL is not HTTPS (' + (repo.name || repo.url) + ').');
    }
    await ctx.print('Installing ' + (pkg.name || pkg.id) + ' v' + (pkg.version || '—') + ' from ' + (repo.name || repo.url) + '…');
    try {
        const result = await downloadAndInstall(ctx, pkg);
        if (result) {
            await ctx.print('Installed ' + (result.name || pkg.id) + ' v' + (result.version || pkg.version || '—'));
            await ctx.toast('Installed ' + (result.name || pkg.id), 'success');
        } else {
            await ctx.print('Install cancelled.');
        }
    } catch (e) {
        await ctx.print('! ' + (e.message || e));
        await ctx.toast(String(e.message || e), 'error');
    }
}

async function cmdUpdate(ctx, target) {
    const installed = await ctx.listInstalled() || [];
    if (!installed.length) { await ctx.print('No packages installed.'); return; }
    const indexes = await getEnabledIndexes(ctx);
    if (!indexes.length) { await ctx.print('No enabled repositories. Add one with `pkg repo add <url>`.'); return; }
    const targets = target
        ? installed.filter(m => m.id === target)
        : installed;
    if (target && !targets.length) { await ctx.print('! Not installed: ' + target); return; }
    let upgraded = 0, checked = 0;
    for (const m of targets) {
        const found = findInIndexes(indexes, m.id);
        if (!found) continue;
        checked++;
        if (cmpVersion(found.pkg.version, m.version) <= 0) continue;
        await ctx.print('↑ ' + m.id + ': v' + (m.version || '—') + ' → v' + found.pkg.version + ' (' + (found.repo.name || found.repo.url) + ')');
        try {
            const r = await downloadAndInstall(ctx, found.pkg);
            if (r) { upgraded++; }
            else { await ctx.print('  (cancelled)'); }
        } catch (e) {
            await ctx.print('  ! ' + (e.message || e));
        }
    }
    await ctx.print('');
    await ctx.print('Checked ' + checked + ', upgraded ' + upgraded + '.');
    if (upgraded) await ctx.toast('Upgraded ' + upgraded + ' package' + (upgraded === 1 ? '' : 's'), 'success');
}

async function cmdRemove(ctx, target) {
    if (!target) { await ctx.print('Usage: pkg remove <id>'); return; }
    // Refuse obvious self-harm before crossing the sandbox boundary. The
    // host enforces this too, but a friendly message beats a raw error.
    if (target === ctx.appId) {
        await ctx.print('! Refusing to uninstall pkg from itself. Use Settings → Permissions.');
        return;
    }
    // The old check used `window.sandbox.isMounted(...)`, but the sandbox
    // object lives on the host window — it's not reachable from inside the
    // iframe this command runs in, so that branch was always falsy. Use
    // `ctx.appId` instead: if we're being invoked from within the Package
    // Store itself, refuse with a friendlier message. (The host also enforces
    // this via sandbox.js `self_uninstall_refused`; this is just a pre-check.)
    if (target === 'packagestore' && ctx.appId === 'packagestore') {
        await ctx.print('! Package Store cannot uninstall itself. Use Settings → Permissions.');
        return;
    }
    const installed = await ctx.listInstalled() || [];
    if (!installed.some(m => m.id === target)) { await ctx.print('! Not installed: ' + target); return; }
    try {
        const ok = await ctx.uninstall(target);
        if (ok) { await ctx.print('Removed ' + target + '.'); await ctx.toast('Removed ' + target, 'success'); }
        else   { await ctx.print('! Failed to remove ' + target); }
    } catch (e) {
        await ctx.print('! ' + (e.message || e));
    }
}

async function cmdRepo(ctx, args) {
    const sub = (args[0] || '').toLowerCase();
    if (!sub || sub === 'list') {
        const repos = (await ctx.repos.list()) || [];
        if (!repos.length) { await ctx.print('No repositories configured.'); return; }
        await ctx.print(pad('STATE', 8) + pad('NAME', 24) + 'URL');
        await ctx.print('─'.repeat(72));
        for (const r of repos) {
            await ctx.print(pad(r.enabled ? 'on' : 'off', 8) + pad(r.name || '—', 24) + r.url);
        }
        return;
    }
    if (sub === 'add') {
        const url = args[1];
        if (!url) { await ctx.print('Usage: pkg repo add <url>'); return; }
        try {
            const r = await ctx.repos.add(url, { enabled: true });
            await ctx.print('Added ' + (r.name || r.url));
        } catch (e) { await ctx.print('! ' + (e.message || e)); }
        return;
    }
    if (sub === 'remove' || sub === 'rm') {
        const url = args[1];
        if (!url) { await ctx.print('Usage: pkg repo remove <url>'); return; }
        const ok = await ctx.repos.remove(url);
        await ctx.print(ok ? ('Removed ' + url) : ('! Not found: ' + url));
        return;
    }
    if (sub === 'refresh') {
        const url = args[1];
        const repos = (await ctx.repos.list()) || [];
        const targets = url ? repos.filter(r => r.url === url) : repos.filter(r => r.enabled);
        if (!targets.length) { await ctx.print('! No matching repositories.'); return; }
        for (const r of targets) {
            await ctx.print('Refreshing ' + (r.name || r.url) + '…');
            try {
                const index = await fetchRepoIndex(ctx, r);
                await ctx.repos.update(r.url, {
                    cachedIndex: index, lastFetched: Date.now(), lastError: null,
                });
                await ctx.print('  ok — ' + (index.packages || []).length + ' packages');
            } catch (e) {
                await ctx.repos.update(r.url, { lastError: String(e.message || e) });
                await ctx.print('  ! ' + (e.message || e));
            }
        }
        return;
    }
    await ctx.print('Unknown repo subcommand: ' + sub);
    await ctx.print('Try: pkg repo list | add <url> | remove <url> | refresh [<url>]');
}

// ── Entrypoint ──────────────────────────────────────────────────

export default {
    async run(args, ctx) {
        const argv = Array.isArray(args) ? args.filter(a => a != null && a !== '') : [];
        const cmd = (argv[0] || '').toLowerCase();
        const rest = argv.slice(1);
        try {
            switch (cmd) {
                case '':
                case 'help':
                case '-h':
                case '--help':
                    return await cmdHelp(ctx);
                case 'list':    return await cmdList(ctx);
                case 'search':  return await cmdSearch(ctx, rest.join(' '));
                case 'install': return await cmdInstall(ctx, rest[0]);
                case 'update':
                case 'upgrade': return await cmdUpdate(ctx, rest[0]);
                case 'remove':
                case 'uninstall':
                    return await cmdRemove(ctx, rest[0]);
                case 'repo':    return await cmdRepo(ctx, rest);
                default:
                    await ctx.print('Unknown command: ' + cmd);
                    await ctx.print('Try: pkg help');
            }
        } catch (e) {
            await ctx.print('! ' + (e.message || e));
        }
    },
};
