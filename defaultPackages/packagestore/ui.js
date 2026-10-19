/* ╔══════════════════════════════════════════════════════════╗
 * ║  PACKAGE STORE — browse + install packages from remote    ║
 * ║  repositories. Repo = JSON index pointing to .zip files.  ║
 * ╚══════════════════════════════════════════════════════════╝ */

const PREFS_KEY = 'prefs';

function escapeHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// Hybrid-aware role label: prefer the modern `roles` array joined with `+`,
// fall back to the legacy `type` string, then to a generic `app` label.
function rolesLabel(m) {
    if (m && Array.isArray(m.roles) && m.roles.length) return m.roles.join(' + ');
    return (m && m.type) || 'app';
}

function resolveURL(base, maybeRelative) {
    try { return new URL(maybeRelative, base).toString(); }
    catch { return maybeRelative; }
}

function cmpVersion(a, b) {
    // naive semver-ish compare: split on non-digits, compare numerically where
    // possible. Returns +1 if a > b, -1 if a < b, 0 if equal or uncomparable.
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

export default {
    async mount(root, ctx) {
        const state = {
            repos: [],
            prefs: { sortBy: 'name', showOnlyUpdates: false, showOnlyInstalled: false, filter: 'all' },
            installed: new Map(), // id -> version
            installedFull: [], // full manifest list (id, name, icon, version, type, _origin)
            filter: '',
            category: '',
            selectedPkg: null,
            busy: new Set(), // package ids currently installing
            view: 'browse', // 'browse' | 'installed'
            installedFilter: '',
            defaultsList: [], // [{id,name,icon,version,installed,blacklisted}]
            defaultsBusy: new Set(),
            // Cache of default-package ids derived locally from installedFull.
            // Kept as a Set so the install-change broadcast handler can update
            // counts/rows without hitting any permission-gated host API.
            defaultIds: new Set(),
            // Serialize install-change broadcast handlers so rapid sequential
            // events don't stomp each other's async refresh.
            _installChangeInFlight: null,
        };
        const SELF_IDS = new Set(['packagestore', 'pkg']);

        // ── Persist ───────────────────────────────────────────
        // Repos now live in the system module (window.repos / ctx.repos). We
        // pull them on demand and write through with `ctx.repos.update` so all
        // consumers (pkg CLI, future apps) see the same state.
        async function reloadRepos() {
            try { state.repos = await ctx.repos.list() || []; }
            catch (e) { console.warn('[packagestore] repos.list failed', e); state.repos = []; }
        }
        async function persistRepoFields(url, patch) {
            try { await ctx.repos.update(url, patch); }
            catch (e) { console.warn('[packagestore] repos.update failed', e); }
        }
        async function savePrefs() { await ctx.storage.set(PREFS_KEY, state.prefs); }

        // Legacy migration now runs in JavaScript/repos.js at boot (one-shot,
        // silent) so the package-store no longer has to do it at mount time.

        async function loadState() {
            await reloadRepos();
            const prefs = await ctx.storage.get(PREFS_KEY);
            if (prefs && typeof prefs === 'object') state.prefs = { ...state.prefs, ...prefs };
            await refreshInstalled();
        }

        async function refreshInstalled() {
            try {
                const list = await ctx.listInstalled();
                state.installed.clear();
                state.installedFull = list || [];
                for (const m of list || []) state.installed.set(m.id, m.version);
                // Derive default ids locally from the (already permission-gated)
                // listInstalled payload — `_origin === 'default'` is authoritative,
                // so we do NOT need a second ctx.defaults.list() call in the
                // broadcast path. This avoids the permission-prompt loop that
                // fired on every `aruta:installChanged`.
                state.defaultIds = new Set(
                    (list || []).filter(m => m._origin === 'default').map(m => m.id)
                );
            } catch (e) {
                console.warn('[packagestore] listInstalled failed', e);
            }
        }

        // Host fires this when an install/uninstall happens anywhere (Settings,
        // terminal, another iframe). Re-query + re-render so our rows stay in
        // sync. We serialize concurrent handlers so rapid sequential events
        // don't stomp each other's async work, and we derive default state
        // locally (no extra permission-gated calls).
        async function onInstallChanged() {
            if (state._installChangeInFlight) {
                try { await state._installChangeInFlight; } catch (_) {}
            }
            const p = (async () => {
                await refreshInstalled();
                // Also refresh the defaults list so uninstalled defaults appear
                // in the unified Installed view as Reinstall rows (otherwise a
                // just-uninstalled default would silently vanish).
                try { await refreshDefaults(); } catch (_) {}
                if (typeof renderAll === 'function') renderAll();
            })();
            state._installChangeInFlight = p;
            try { await p; }
            finally {
                if (state._installChangeInFlight === p) state._installChangeInFlight = null;
            }
        }
        state._onInstallChanged = onInstallChanged;
        document.addEventListener('aruta:installChanged', onInstallChanged);

        // ── Network ───────────────────────────────────────────
        async function fetchRepo(repo) {
            const headers = {};
            if (repo.etag) headers['If-None-Match'] = repo.etag;
            let resp;
            try {
                resp = await ctx.fetch(repo.url, { headers });
            } catch (e) {
                repo.lastError = String(e.message || e);
                return;
            }
            if (resp.status === 304) {
                repo.lastFetched = Date.now();
                repo.lastError = null;
                return;
            }
            if (!resp.ok) {
                repo.lastError = 'HTTP ' + resp.status + ' ' + (resp.statusText || '');
                return;
            }
            let data;
            try { data = await resp.json(); }
            catch (e) { repo.lastError = 'Invalid JSON: ' + e.message; return; }
            if (!data || !Array.isArray(data.packages)) {
                repo.lastError = 'Missing "packages" array';
                return;
            }
            // Resolve relative package urls against the repo url
            for (const p of data.packages) {
                if (p && typeof p.url === 'string') {
                    p.url = resolveURL(repo.url, p.url);
                }
            }
            repo.cachedIndex = data;
            repo.lastFetched = Date.now();
            repo.lastError = null;
            if (resp.headers && typeof resp.headers.get === 'function') {
                repo.etag = resp.headers.get('etag') || repo.etag;
            }
            // Also harvest repo metadata
            if (data.name && !repo.nameLocked) repo.displayName = data.name;
            if (data.description) repo.description = data.description;
        }

        async function refreshAllRepos() {
            const enabled = state.repos.filter(r => r.enabled);
            await Promise.all(enabled.map(r => fetchRepo(r)));
            // Push fetched fields back to the system module for each repo.
            for (const r of enabled) {
                await persistRepoFields(r.url, {
                    lastFetched: r.lastFetched,
                    etag: r.etag,
                    cachedIndex: r.cachedIndex,
                    description: r.description,
                });
            }
        }

        // ── Derived ───────────────────────────────────────────
        function getAllPackages() {
            const seen = new Map(); // id -> { pkg, repoName }
            for (const repo of state.repos) {
                if (!repo.enabled || !repo.cachedIndex) continue;
                for (const pkg of repo.cachedIndex.packages || []) {
                    if (!pkg || !pkg.id) continue;
                    if (!seen.has(pkg.id)) {
                        seen.set(pkg.id, { pkg, repoName: repo.displayName || repo.name || repo.url });
                    }
                }
            }
            return Array.from(seen.values());
        }

        function installedState(pkg) {
            const v = state.installed.get(pkg.id);
            if (v === undefined) return { status: 'available' };
            if (cmpVersion(pkg.version, v) > 0) return { status: 'update', installedVersion: v };
            return { status: 'installed', installedVersion: v };
        }

        function filteredPackages() {
            const q = state.filter.trim().toLowerCase();
            const cat = state.category;
            const all = getAllPackages();
            let out = all.filter(({ pkg }) => {
                if (q) {
                    const hay = (pkg.name + ' ' + (pkg.author || '') + ' ' + (pkg.description || '') + ' ' + pkg.id).toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                if (cat && pkg.category !== cat) return false;
                const st = installedState(pkg);
                if (state.prefs.showOnlyUpdates && st.status !== 'update') return false;
                if (state.prefs.showOnlyInstalled && st.status === 'available') return false;
                return true;
            });
            const sort = state.prefs.sortBy;
            out.sort((a, b) => {
                if (sort === 'author') return (a.pkg.author || '').localeCompare(b.pkg.author || '');
                if (sort === 'category') return (a.pkg.category || '').localeCompare(b.pkg.category || '');
                return (a.pkg.name || a.pkg.id).localeCompare(b.pkg.name || b.pkg.id);
            });
            return out;
        }

        function getCategories() {
            const set = new Set();
            for (const { pkg } of getAllPackages()) {
                if (pkg.category) set.add(pkg.category);
            }
            return Array.from(set).sort();
        }

        // ── Actions ───────────────────────────────────────────
        async function uninstallPackage(pkg) {
            if (!pkg || !pkg.id) return;
            if (!confirm('Uninstall ' + (pkg.name || pkg.id) + '?')) return;
            try {
                const ok = await ctx.uninstall(pkg.id);
                if (ok) ctx.toast('Uninstalled ' + (pkg.name || pkg.id), 'success');
                else ctx.toast('Not installed', 'info');
            } catch (e) {
                console.warn('[packagestore] uninstall failed', e);
                ctx.toast(String(e.message || e), 'error');
            } finally {
                await refreshInstalled();
                renderAll();
            }
        }

        function updatesAvailableCount() {
            let n = 0;
            for (const { pkg } of getAllPackages()) {
                if (installedState(pkg).status === 'update') n++;
            }
            return n;
        }

        async function installPackage(pkg) {
            if (!pkg || !pkg.url) {
                ctx.toast('Missing package URL', 'error');
                return;
            }
            if (state.busy.has(pkg.id)) return;
            state.busy.add(pkg.id);
            renderPackages();
            renderDetails();
            try {
                // Pass binary:true so the host fetch handler returns a raw Blob
                // instead of text — zips are binary, text round-tripping corrupts them.
                const resp = await ctx.fetch(pkg.url, { binary: true });
                if (!resp.ok) throw new Error('Download failed: HTTP ' + resp.status);
                const blob = await resp.blob();
                const result = await ctx.installZip(blob, { filename: (pkg.id || 'remote') + '.zip' });
                if (result) {
                    await ctx.toast('Installed ' + (pkg.name || pkg.id), 'success');
                } else {
                    await ctx.toast('Install cancelled', 'info');
                }
            } catch (e) {
                console.warn('[packagestore] install failed', e);
                await ctx.toast(String(e.message || e), 'error');
            } finally {
                state.busy.delete(pkg.id);
                await refreshInstalled();
                renderPackages();
                renderDetails();
            }
        }

        async function addRepo() {
            const url = prompt('Repository index URL (JSON):', 'https://');
            if (!url) return;
            if (!/^https?:\/\//i.test(url)) {
                ctx.toast('URL must start with http(s)://', 'error');
                return;
            }
            if (!/^https:/i.test(url)) {
                if (!confirm('This URL is NOT HTTPS. Continue anyway?')) return;
            }
            if (state.repos.some(r => r.url === url)) {
                ctx.toast('Repo already added', 'info');
                return;
            }
            const name = prompt('Display name (optional):', '') || new URL(url).hostname;
            try {
                await ctx.repos.add(url, { name, enabled: true });
            } catch (e) {
                ctx.toast(String(e.message || e), 'error');
                return;
            }
            await reloadRepos();
            renderRepos();
            const r = state.repos.find(x => x.url === url);
            if (r) {
                await fetchRepo(r);
                await persistRepoFields(r.url, {
                    lastFetched: r.lastFetched, etag: r.etag,
                    cachedIndex: r.cachedIndex, description: r.description,
                });
            }
            renderAll();
        }

        async function installFromURL() {
            const url = prompt('Package .zip URL:', 'https://');
            if (!url) return;
            if (!/^https?:\/\//i.test(url)) {
                ctx.toast('URL must start with http(s)://', 'error');
                return;
            }
            if (!/^https:/i.test(url)) {
                if (!confirm('This URL is NOT HTTPS. Continue anyway?')) return;
            }
            try {
                ctx.toast('Downloading…', 'info');
                const resp = await ctx.fetch(url, { binary: true });
                if (!resp.ok) throw new Error('Download failed: HTTP ' + resp.status);
                const blob = await resp.blob();
                const filename = (url.split('/').pop() || 'remote.zip').split('?')[0];
                const result = await ctx.installZip(blob, { filename });
                if (result) ctx.toast('Installed ' + (result.name || result.id), 'success');
                else ctx.toast('Install cancelled', 'info');
            } catch (e) {
                console.warn('[packagestore] sideload failed', e);
                ctx.toast(String(e.message || e), 'error');
            } finally {
                await refreshInstalled();
                renderAll();
            }
        }

        async function removeRepo(url) {
            if (!confirm('Remove this repository?')) return;
            await ctx.repos.remove(url);
            await reloadRepos();
            renderAll();
        }

        async function toggleRepo(url) {
            const r = state.repos.find(x => x.url === url);
            if (!r) return;
            r.enabled = !r.enabled;
            await ctx.repos.setEnabled(url, r.enabled);
            renderRepos();
            if (r.enabled && !r.cachedIndex) {
                await fetchRepo(r);
                await persistRepoFields(r.url, {
                    lastFetched: r.lastFetched, etag: r.etag,
                    cachedIndex: r.cachedIndex, description: r.description,
                });
            }
            renderPackages();
        }

        async function refreshRepo(url) {
            const r = state.repos.find(x => x.url === url);
            if (!r) return;
            r.busy = true;
            renderRepos();
            await fetchRepo(r);
            r.busy = false;
            await persistRepoFields(r.url, {
                lastFetched: r.lastFetched, etag: r.etag,
                cachedIndex: r.cachedIndex, description: r.description,
            });
            renderAll();
        }

        // ── Render ────────────────────────────────────────────
        root.innerHTML = `
            <div class="ps-wrap">
                <aside class="ps-sidebar">
                    <nav class="ps-nav">
                        <button class="ps-nav-item is-active" data-view="browse">
                            <span class="ps-nav-ic">🛒</span>
                            <span class="ps-nav-lbl">Browse</span>
                            <span class="ps-nav-count ps-nav-browse-count"></span>
                        </button>
                        <button class="ps-nav-item" data-view="installed">
                            <span class="ps-nav-ic">📥</span>
                            <span class="ps-nav-lbl">Installed</span>
                            <span class="ps-nav-count ps-nav-installed-count"></span>
                        </button>
                    </nav>
                    <div class="ps-side-head">
                        <span class="ps-side-title">Sources</span>
                        <button class="ps-btn ps-btn-ghost" data-action="refresh-all" title="Refresh all">⟳</button>
                    </div>
                    <div class="ps-repos"></div>
                    <div class="ps-side-foot">
                        <button class="ps-btn" data-action="add-repo">+ Add Repository</button>
                        <button class="ps-btn ps-btn-util" data-action="install-url" title="Sideload a .zip from any URL">⇣ Install from URL</button>
                    </div>
                </aside>
                <section class="ps-main ps-main-browse">
                    <div class="ps-toolbar">
                        <input type="search" class="ps-search" placeholder="Search packages…" />
                        <select class="ps-cat"><option value="">All categories</option></select>
                        <select class="ps-sort">
                            <option value="name">Sort: Name</option>
                            <option value="author">Sort: Author</option>
                            <option value="category">Sort: Category</option>
                        </select>
                        <label class="ps-chip"><input type="checkbox" class="ps-only-updates" /> Updates only</label>
                        <label class="ps-chip"><input type="checkbox" class="ps-only-installed" /> Installed</label>
                        <span class="ps-count"></span>
                    </div>
                    <div class="ps-packages"></div>
                </section>
                <section class="ps-main ps-main-installed" hidden>
                    <div class="ps-toolbar">
                        <input type="search" class="ps-installed-search" placeholder="Search installed…" />
                        <div class="ps-filter-chips" role="tablist" aria-label="Filter">
                            <button class="ps-filter-chip is-active" data-filter="all" role="tab">All</button>
                            <button class="ps-filter-chip" data-filter="user" role="tab">User</button>
                            <button class="ps-filter-chip" data-filter="defaults" role="tab">Defaults</button>
                            <button class="ps-filter-chip" data-filter="updates" role="tab">Updates</button>
                        </div>
                        <span class="ps-installed-count"></span>
                    </div>
                    <div class="ps-installed-list"></div>
                </section>
                <aside class="ps-details"></aside>
            </div>
        `;

        const $repos = root.querySelector('.ps-repos');
        const $pkgs = root.querySelector('.ps-packages');
        const $details = root.querySelector('.ps-details');
        const $search = root.querySelector('.ps-search');
        const $cat = root.querySelector('.ps-cat');
        const $sort = root.querySelector('.ps-sort');
        const $onlyUpd = root.querySelector('.ps-only-updates');
        const $onlyInst = root.querySelector('.ps-only-installed');
        const $count = root.querySelector('.ps-count');
        const $mainBrowse = root.querySelector('.ps-main-browse');
        const $mainInstalled = root.querySelector('.ps-main-installed');
        const $navItems = root.querySelectorAll('.ps-nav-item');
        const $navBrowseCount = root.querySelector('.ps-nav-browse-count');
        const $navInstalledCount = root.querySelector('.ps-nav-installed-count');
        const $installedList = root.querySelector('.ps-installed-list');
        const $installedSearch = root.querySelector('.ps-installed-search');
        const $installedCount = root.querySelector('.ps-installed-count');
        const $filterChips = root.querySelectorAll('.ps-filter-chip');

        function setView(v) {
            state.view = v;
            $navItems.forEach(n => n.classList.toggle('is-active', n.dataset.view === v));
            $mainBrowse.hidden = v !== 'browse';
            $mainInstalled.hidden = v !== 'installed';
            // details pane is only useful in Browse (needs repo-pkg data).
            $details.hidden = v !== 'browse';
            if (v === 'installed') renderInstalled();
        }

        function findRepoPkg(id) {
            return getAllPackages().find(x => x.pkg.id === id) || null;
        }

        // Build the unified row list: every installed package + every
        // uninstalled default. Rows are normalized to a common shape so the
        // row template doesn't have to branch on origin.
        function unifiedRows() {
            const byId = new Map();
            for (const m of state.installedFull || []) {
                byId.set(m.id, {
                    id: m.id,
                    name: m.name || m.id,
                    icon: m.icon,
                    version: m.version,
                    roles: rolesLabel(m),
                    installed: true,
                    isDefault: m._origin === 'default' || state.defaultIds.has(m.id),
                });
            }
            for (const d of state.defaultsList || []) {
                if (d.installed) continue;
                if (byId.has(d.id)) continue;
                byId.set(d.id, {
                    id: d.id,
                    name: d.name || d.id,
                    icon: d.icon,
                    version: d.version,
                    roles: '',
                    installed: false,
                    isDefault: true,
                });
            }
            return Array.from(byId.values())
                .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        }

        function rowHasUpdate(row) {
            if (!row.installed) return false;
            const rp = findRepoPkg(row.id);
            return !!(rp && cmpVersion(rp.pkg.version, row.version) > 0);
        }

        function renderInstalled() {
            const q = state.installedFilter.trim().toLowerCase();
            const filter = state.prefs.filter || 'all';
            const all = unifiedRows();
            const rows = all.filter(r => {
                if (filter === 'user' && r.isDefault) return false;
                if (filter === 'defaults' && !r.isDefault) return false;
                if (filter === 'updates' && !rowHasUpdate(r)) return false;
                if (q) {
                    const hay = (r.name + ' ' + r.id + ' ' + (r.roles || '')).toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });

            $installedCount.textContent = rows.length + ' of ' + all.length + ' shown';
            $filterChips.forEach(c => c.classList.toggle('is-active', c.dataset.filter === filter));

            if (!rows.length) {
                $installedList.innerHTML = '<div class="ps-empty">No packages match.</div>';
                return;
            }

            $installedList.innerHTML = rows.map(r => {
                const repoPkg = r.installed ? findRepoPkg(r.id) : null;
                const hasUpdate = !!(repoPkg && cmpVersion(repoPkg.pkg.version, r.version) > 0);
                const busy = state.busy.has(r.id) || state.defaultsBusy.has(r.id);
                const isSelf = SELF_IDS.has(r.id);
                let actions = '';
                if (!r.installed) {
                    // Uninstalled default → Reinstall
                    actions = `<button class="ps-btn ps-act ps-btn-primary" data-action="reinstall-default" data-id="${escapeHTML(r.id)}" ${busy ? 'disabled' : ''}>${busy ? 'Reinstalling…' : '⟳ Reinstall'}</button>`;
                } else {
                    const updateBtn = hasUpdate && !busy
                        ? `<button class="ps-btn ps-act ps-act-update" data-action="update" data-id="${escapeHTML(r.id)}">↑ Update → v${escapeHTML(repoPkg.pkg.version)}</button>`
                        : '';
                    const uninstallBtn = isSelf
                        ? `<button class="ps-btn ps-act ps-btn-ghost ps-danger" disabled title="Core system package — cannot uninstall from here">🗑 Uninstall</button>`
                        : `<button class="ps-btn ps-act ps-btn-ghost ps-danger" data-action="uninstall-installed" data-id="${escapeHTML(r.id)}" title="Uninstall">🗑 Uninstall</button>`;
                    actions = updateBtn + uninstallBtn;
                }
                const statusChip = !r.installed
                    ? '<span class="ps-tag ps-chip-uninstalled">Uninstalled</span>'
                    : '';
                return `
                    <div class="ps-pkg ps-installed-row" data-id="${escapeHTML(r.id)}">
                        <span class="ps-pkg-icon">${escapeHTML(r.icon || '📦')}</span>
                        <div class="ps-pkg-main">
                            <div class="ps-pkg-title">
                                <strong>${escapeHTML(r.name)}</strong>
                                ${r.version ? `<span class="ps-pkg-ver">v${escapeHTML(r.version)}</span>` : ''}
                                ${r.isDefault ? '<span class="ps-tag ps-tag-default">default</span>' : ''}
                                ${statusChip}
                                ${hasUpdate ? `<span class="ps-tag ps-tag-update">↑ update ${escapeHTML(repoPkg.pkg.version)}</span>` : ''}
                            </div>
                            <div class="ps-pkg-meta">
                                ${r.roles ? `<span class="ps-meta">${escapeHTML(r.roles)}</span>` : ''}
                                <span class="ps-meta">id: ${escapeHTML(r.id)}</span>
                            </div>
                        </div>
                        <div class="ps-pkg-actions">
                            ${actions}
                        </div>
                    </div>
                `;
            }).join('');
        }

        async function uninstallById(id) {
            if (!id || SELF_IDS.has(id)) return;
            const m = state.installedFull.find(x => x.id === id);
            const label = m ? (m.name || id) : id;
            if (!confirm('Uninstall ' + label + '?')) return;
            try {
                const ok = await ctx.uninstall(id);
                if (ok) ctx.toast('Uninstalled ' + label, 'success');
                else ctx.toast('Not installed', 'info');
            } catch (e) {
                console.warn('[packagestore] uninstall failed', e);
                ctx.toast(String(e.message || e), 'error');
            } finally {
                await refreshInstalled();
                renderAll();
            }
        }

        // ── Defaults (internal) ───────────────────────────────
        // Pulls the full defaults list so the unified Installed view can
        // surface uninstalled-default rows with a Reinstall action. No
        // dedicated view any more — everything renders through renderInstalled().
        async function refreshDefaults() {
            try {
                state.defaultsList = await ctx.defaults.list() || [];
            } catch (e) {
                console.warn('[packagestore] defaults.list failed', e);
                state.defaultsList = [];
            }
            if (state.view === 'installed') renderInstalled();
            renderNavCounts();
        }

        async function reinstallDefault(id) {
            if (state.defaultsBusy.has(id)) return;
            state.defaultsBusy.add(id);
            renderInstalled();
            try {
                const m = await ctx.defaults.restore(id);
                ctx.toast('Reinstalled ' + (m?.name || id), 'success');
            } catch (e) {
                console.warn('[packagestore] defaults.restore failed', e);
                ctx.toast(String(e.message || e), 'error');
            } finally {
                state.defaultsBusy.delete(id);
                // installChanged broadcast will refresh installed; re-list defaults
                // explicitly so the chip flips immediately even if the broadcast
                // arrives a tick later.
                await refreshInstalled();
                await refreshDefaults();
                renderAll();
            }
        }

        function renderRepos() {
            if (!state.repos.length) {
                $repos.innerHTML = '<div class="ps-empty">No repositories yet.</div>';
                return;
            }
            $repos.innerHTML = state.repos.map(r => {
                const label = escapeHTML(r.displayName || r.name || r.url);
                const meta = r.busy ? 'refreshing…'
                    : r.lastError ? ('error: ' + escapeHTML(r.lastError))
                    : r.lastFetched ? ('updated ' + new Date(r.lastFetched).toLocaleDateString())
                    : 'never fetched';
                const count = r.cachedIndex?.packages?.length || 0;
                return `
                    <div class="ps-repo ${r.enabled ? 'is-on' : 'is-off'}" data-url="${escapeHTML(r.url)}">
                        <label class="ps-repo-main">
                            <input type="checkbox" ${r.enabled ? 'checked' : ''} data-action="toggle-repo" />
                            <span class="ps-repo-label">
                                <strong>${label}</strong>
                                <small>${count} pkg · ${meta}</small>
                            </span>
                        </label>
                        <div class="ps-repo-acts">
                            <button class="ps-btn ps-btn-ghost" data-action="refresh-repo" title="Refresh">⟳</button>
                            <button class="ps-btn ps-btn-ghost ps-danger" data-action="remove-repo" title="Remove">×</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function renderCategories() {
            const current = state.category;
            const cats = getCategories();
            $cat.innerHTML = '<option value="">All categories</option>' +
                cats.map(c => `<option value="${escapeHTML(c)}" ${c === current ? 'selected' : ''}>${escapeHTML(c)}</option>`).join('');
        }

        function renderPackages() {
            const list = filteredPackages();
            const updates = updatesAvailableCount();
            const countText = list.length + ' package' + (list.length === 1 ? '' : 's');
            $count.innerHTML = (updates > 0
                ? `<span class="ps-updates-chip" title="Updates available">↑ ${updates} update${updates === 1 ? '' : 's'}</span> `
                : '') + escapeHTML(countText);
            if (!list.length) {
                const hasAnyEnabled = state.repos.some(r => r.enabled);
                $pkgs.innerHTML = `<div class="ps-empty">
                    ${hasAnyEnabled ? 'No packages match your filters.' : 'Enable or add a repository to browse packages.'}
                </div>`;
                return;
            }
            $pkgs.innerHTML = list.map(({ pkg, repoName }) => {
                const st = installedState(pkg);
                const busy = state.busy.has(pkg.id);
                const primaryLabel = busy ? 'Installing…'
                    : st.status === 'update' ? ('↑ Update → v' + escapeHTML(pkg.version || '?'))
                    : st.status === 'installed' ? ('✓ Installed v' + escapeHTML(st.installedVersion || ''))
                    : 'Install';
                const primaryAction = st.status === 'installed' ? '' : 'install';
                const primaryDisabled = busy || st.status === 'installed' ? 'disabled' : '';
                const primaryCls = st.status === 'installed'
                    ? 'ps-act ps-chip-installed'
                    : st.status === 'update' ? 'ps-btn ps-act ps-act-update'
                    : 'ps-btn ps-act';
                const sel = state.selectedPkg === pkg.id ? 'is-selected' : '';
                const isSelf = pkg.id === 'packagestore';
                const uninstallBtn = (st.status === 'installed' || st.status === 'update') && !busy
                    ? (isSelf
                        ? '<button class="ps-btn ps-act ps-btn-ghost ps-danger" data-action="uninstall" title="Cannot uninstall the Package Store from itself — use Settings → Permissions." disabled>Uninstall</button>'
                        : '<button class="ps-btn ps-act ps-btn-ghost ps-danger" data-action="uninstall" title="Uninstall">Uninstall</button>')
                    : '';
                return `
                    <div class="ps-pkg ${sel}" data-id="${escapeHTML(pkg.id)}">
                        <span class="ps-pkg-icon">${escapeHTML(pkg.icon || '📦')}</span>
                        <div class="ps-pkg-main">
                            <div class="ps-pkg-title">
                                <strong>${escapeHTML(pkg.name || pkg.id)}</strong>
                                <span class="ps-pkg-ver">v${escapeHTML(pkg.version || '—')}</span>
                                ${st.status === 'update' ? '<span class="ps-badge">↑</span>' : ''}
                                ${st.status === 'installed' ? '<span class="ps-badge ps-badge-ok">✓</span>' : ''}
                            </div>
                            <div class="ps-pkg-sub">
                                ${escapeHTML(pkg.description || '')}
                            </div>
                            <div class="ps-pkg-meta">
                                ${pkg.category ? `<span class="ps-tag">${escapeHTML(pkg.category)}</span>` : ''}
                                ${pkg.author ? `<span class="ps-meta">by ${escapeHTML(pkg.author)}</span>` : ''}
                                <span class="ps-meta">${escapeHTML(repoName)}</span>
                            </div>
                        </div>
                        <div class="ps-pkg-actions">
                            ${primaryAction
                                ? `<button class="${primaryCls}" data-action="${primaryAction}" ${primaryDisabled}>${primaryLabel}</button>`
                                : `<span class="${primaryCls}">${primaryLabel}</span>`}
                            ${uninstallBtn}
                        </div>
                    </div>
                `;
            }).join('');
        }

        function renderDetails() {
            const id = state.selectedPkg;
            if (!id) {
                $details.innerHTML = '<div class="ps-empty">Select a package to see details.</div>';
                return;
            }
            const found = getAllPackages().find(x => x.pkg.id === id);
            if (!found) {
                $details.innerHTML = '<div class="ps-empty">Package no longer available.</div>';
                return;
            }
            const { pkg, repoName } = found;
            const st = installedState(pkg);
            const busy = state.busy.has(pkg.id);
            const actLabel = busy ? 'Installing…'
                : st.status === 'update' ? 'Update to ' + (pkg.version || '?')
                : st.status === 'installed' ? 'Installed'
                : 'Install';
            const actDisabled = busy || st.status === 'installed' ? 'disabled' : '';
            const perms = Array.isArray(pkg.permissions) ? pkg.permissions : [];
            $details.innerHTML = `
                <div class="ps-det-head">
                    <div class="ps-det-icon">${escapeHTML(pkg.icon || '📦')}</div>
                    <div class="ps-det-title">
                        <strong>${escapeHTML(pkg.name || pkg.id)}</strong>
                        <small>v${escapeHTML(pkg.version || '—')}${(Array.isArray(pkg.roles) && pkg.roles.length) || pkg.type ? ' · ' + escapeHTML(rolesLabel(pkg)) : ''}</small>
                    </div>
                </div>
                ${pkg.description ? `<p class="ps-det-desc">${escapeHTML(pkg.description)}</p>` : ''}
                <dl class="ps-det-meta">
                    <dt>ID</dt><dd>${escapeHTML(pkg.id)}</dd>
                    ${pkg.author ? `<dt>Author</dt><dd>${escapeHTML(pkg.author)}</dd>` : ''}
                    ${pkg.category ? `<dt>Category</dt><dd>${escapeHTML(pkg.category)}</dd>` : ''}
                    ${pkg.homepage ? `<dt>Homepage</dt><dd><a href="${escapeHTML(pkg.homepage)}" target="_blank" rel="noopener">${escapeHTML(pkg.homepage)}</a></dd>` : ''}
                    <dt>Source</dt><dd>${escapeHTML(repoName)}</dd>
                    ${pkg.size ? `<dt>Size</dt><dd>${(pkg.size / 1024).toFixed(1)} KB</dd>` : ''}
                    ${st.installedVersion ? `<dt>Installed</dt><dd>v${escapeHTML(st.installedVersion)}</dd>` : ''}
                </dl>
                ${perms.length ? `
                    <div class="ps-det-perms">
                        <div class="ps-det-h">Permissions</div>
                        <ul>${perms.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul>
                    </div>
                ` : ''}
                ${pkg.allowOrigin ? '<div class="ps-warn">Requests relaxed sandbox (allowOrigin)</div>' : ''}
                <div class="ps-det-actions">
                    <button class="ps-btn ps-btn-primary" data-action="install-detail" ${actDisabled}>${actLabel}</button>
                    ${(st.status === 'installed' || st.status === 'update') && !busy
                        ? '<button class="ps-btn ps-danger" data-action="uninstall-detail">Uninstall</button>'
                        : ''}
                </div>
            `;
        }

        function renderNavCounts() {
            const browseN = getAllPackages().length;
            if ($navBrowseCount) $navBrowseCount.textContent = browseN ? '(' + browseN + ')' : '';
            if ($navInstalledCount) {
                // Count rows visible under the current filter (unified model:
                // installed + uninstalled defaults).
                const visibleN = unifiedRows().filter(r => {
                    const f = state.prefs.filter || 'all';
                    if (f === 'user' && r.isDefault) return false;
                    if (f === 'defaults' && !r.isDefault) return false;
                    if (f === 'updates' && !rowHasUpdate(r)) return false;
                    return true;
                }).length;
                const updates = unifiedRows().filter(rowHasUpdate).length;
                $navInstalledCount.textContent = updates
                    ? '(' + visibleN + ' · ↑' + updates + ')'
                    : '(' + visibleN + ')';
            }
        }

        function renderAll() {
            renderRepos();
            renderCategories();
            renderPackages();
            renderDetails();
            renderNavCounts();
            if (state.view === 'installed') renderInstalled();
        }

        // ── Wire events ───────────────────────────────────────
        root.querySelector('[data-action="add-repo"]').addEventListener('click', addRepo);
        root.querySelector('[data-action="install-url"]').addEventListener('click', installFromURL);
        root.querySelector('[data-action="refresh-all"]').addEventListener('click', async () => {
            const btn = root.querySelector('[data-action="refresh-all"]');
            btn.disabled = true;
            for (const r of state.repos) if (r.enabled) r.busy = true;
            renderRepos();
            await refreshAllRepos();
            for (const r of state.repos) r.busy = false;
            btn.disabled = false;
            renderAll();
        });

        $repos.addEventListener('click', async (e) => {
            const row = e.target.closest('.ps-repo');
            if (!row) return;
            const url = row.dataset.url;
            const action = e.target.dataset.action;
            if (action === 'toggle-repo') await toggleRepo(url);
            else if (action === 'refresh-repo') await refreshRepo(url);
            else if (action === 'remove-repo') await removeRepo(url);
        });

        $pkgs.addEventListener('click', async (e) => {
            const row = e.target.closest('.ps-pkg');
            if (!row) return;
            const id = row.dataset.id;
            const action = e.target.dataset.action;
            if (action === 'install') {
                const found = getAllPackages().find(x => x.pkg.id === id);
                if (found) await installPackage(found.pkg);
                return;
            }
            if (action === 'uninstall') {
                const found = getAllPackages().find(x => x.pkg.id === id);
                if (found) await uninstallPackage(found.pkg);
                return;
            }
            state.selectedPkg = id;
            renderPackages();
            renderDetails();
        });

        $details.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            if (action !== 'install-detail' && action !== 'uninstall-detail') return;
            const id = state.selectedPkg;
            const found = getAllPackages().find(x => x.pkg.id === id);
            if (!found) return;
            if (action === 'install-detail') await installPackage(found.pkg);
            else await uninstallPackage(found.pkg);
        });

        $search.addEventListener('input', () => {
            state.filter = $search.value;
            renderPackages();
        });
        $cat.addEventListener('change', () => {
            state.category = $cat.value;
            renderPackages();
        });
        $sort.addEventListener('change', async () => {
            state.prefs.sortBy = $sort.value;
            await savePrefs();
            renderPackages();
        });
        $onlyUpd.addEventListener('change', async () => {
            state.prefs.showOnlyUpdates = $onlyUpd.checked;
            await savePrefs();
            renderPackages();
        });
        $onlyInst.addEventListener('change', async () => {
            state.prefs.showOnlyInstalled = $onlyInst.checked;
            await savePrefs();
            renderPackages();
        });

        // ── Installed view events ─────────────────────────────
        $navItems.forEach(n => {
            n.addEventListener('click', () => setView(n.dataset.view));
        });
        $installedSearch.addEventListener('input', () => {
            state.installedFilter = $installedSearch.value;
            renderInstalled();
        });
        $filterChips.forEach(chip => {
            chip.addEventListener('click', async () => {
                const f = chip.dataset.filter || 'all';
                if (state.prefs.filter === f) return;
                state.prefs.filter = f;
                await savePrefs();
                renderInstalled();
                renderNavCounts();
            });
        });

        $installedList.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const id = btn.dataset.id;
            const action = btn.dataset.action;
            if (action === 'uninstall-installed') {
                await uninstallById(id);
            } else if (action === 'update') {
                const found = findRepoPkg(id);
                if (found) await installPackage(found.pkg);
                await refreshInstalled();
                renderAll();
            } else if (action === 'reinstall-default') {
                await reinstallDefault(id);
            }
        });

        // ── Boot ──────────────────────────────────────────────
        await loadState();
        $sort.value = state.prefs.sortBy;
        $onlyUpd.checked = !!state.prefs.showOnlyUpdates;
        $onlyInst.checked = !!state.prefs.showOnlyInstalled;
        // Reflect the persisted filter on the chip group (defaults to 'all').
        $filterChips.forEach(c => c.classList.toggle('is-active', c.dataset.filter === (state.prefs.filter || 'all')));
        renderAll();
        // Pull the defaults list once so the sidebar badge ("Defaults (N)") is
        // accurate even before the user opens that view.
        refreshDefaults().catch(e => console.warn('[packagestore] defaults boot', e));
        // auto-refresh enabled repos on first open
        refreshAllRepos().then(() => renderAll()).catch(e => console.warn(e));

        // Stash state on root so unmount() can find it if the host calls
        // unmount after teardown notification. (Vanilla, no framework.)
        root.__packagestoreState = state;
    },
    // Called by the host (sandbox IFRAME_BOOT `teardown` message) before the
    // iframe is removed. Detaches the install-change listener so we don't
    // accumulate handlers across remounts.
    async unmount(root /*, ctx */) {
        const state = root && root.__packagestoreState;
        if (state && state._onInstallChanged) {
            document.removeEventListener('aruta:installChanged', state._onInstallChanged);
            state._onInstallChanged = null;
        }
    },
};
