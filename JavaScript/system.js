/* ╔══════════════════════════════════════════════════════════╗
 * ║  SYSTEM — This-machine overview, processes, services,      ║
 * ║  terminal sessions and trash. Local mode only.             ║
 * ╚══════════════════════════════════════════════════════════╝ */
(function () {
    const IT = {
        overview: 'Panoramica', processes: 'Processi', services: 'Servizi',
        terminals: 'Sessioni terminale', trash: 'Cestino', refresh: 'Aggiorna',
        host: 'Host', platform: 'Piattaforma', version: 'Versione', uptime: 'Uptime',
        cpus: 'CPU', load: 'Load', memory: 'Memoria', disk: 'Disco',
        profile: 'Profilo', data: 'Dati', shell: 'Shell', tmux: 'tmux',
        yes: 'sì', no: 'no', kill: 'Termina', start: 'Avvia', stop: 'Ferma',
        restart: 'Riavvia', empty: 'Svuota cestino', restore: 'Ripristina',
        noEntries: 'Nessun elemento nel cestino.', restored: 'Elemento ripristinato',
        deletedAt: 'Eliminato', notLocal: 'Questa macchina non è collegata. Installa arutosiod con: cd server && ./install.sh',
        notAuth: 'Accedi per gestire questa macchina.', unavailable: 'Non disponibile',
        noProcesses: 'Nessun processo.', noServices: 'Nessun servizio utente disponibile (systemd --user non attivo).',
        noTerms: 'Nessuna sessione terminale.', noTrash: 'Cestino vuoto.',
        pid: 'PID', user: 'Utente', cpu: 'CPU', mem: 'MEM', rss: 'RSS', command: 'Comando',
        name: 'Nome', size: 'Dimensione', confirmRestore: 'Ripristinare {name}?',
        updates: 'Aggiornamenti', currentVersion: 'Versione attuale', latestVersion: 'Ultima versione',
        checkNow: 'Controlla', applyUpdate: 'Aggiorna ora', upToDate: 'Il sistema è aggiornato.',
        checkFailed: 'Controllo aggiornamenti non riuscito', releaseNotes: 'Note di rilascio',
        updateAvailable: 'Aggiornamento {version} disponibile', updateApplying: 'Download e verifica…',
        updateRestarting: 'Riavvio di arutosiod…', updateTimeout: 'Il daemon non ha risposto. Ricarica la pagina o riavvia arutosiod.',
        updateUnavailable: 'Aggiornamento automatico non disponibile.', updateManual: 'Aggiorna manualmente:',
        confirmUpdate: 'Scaricare e installare {version}? arutosiod si riavvierà.', releasePage: 'Pagina release',
        checkedAt: 'Controllato', noRelease: 'Nessuna release pubblicata.', errorLabel: 'Errore',
        unit: 'Unità', active: 'Stato', idle: 'Inattivo', clients: 'Client', created: 'Creata',
        confirmKill: 'Terminare il processo {pid}?', confirmStop: 'Fermare {name}?',
        confirmRestart: 'Riavviare {name}?', confirmEmpty: 'Svuotare definitivamente il cestino?',
        protectedUnit: 'protetto', bytes: 'B', kb: 'KB', mb: 'MB', gb: 'GB',
        killed: 'Processo terminato', emptied: 'Cestino svuotato', actionDone: 'Fatto'
    };
    const EN = {
        overview: 'Overview', processes: 'Processes', services: 'Services',
        terminals: 'Terminal sessions', trash: 'Trash', refresh: 'Refresh',
        host: 'Host', platform: 'Platform', version: 'Version', uptime: 'Uptime',
        cpus: 'CPU', load: 'Load', memory: 'Memory', disk: 'Disk',
        profile: 'Profile', data: 'Data', shell: 'Shell', tmux: 'tmux',
        yes: 'yes', no: 'no', kill: 'Kill', start: 'Start', stop: 'Stop',
        restart: 'Restart', empty: 'Empty trash', restore: 'Restore',
        noEntries: 'No items in the trash.', restored: 'Item restored',
        deletedAt: 'Deleted', notLocal: 'This machine is not connected. Install arutosiod with: cd server && ./install.sh',
        notAuth: 'Sign in to manage this machine.', unavailable: 'Unavailable',
        noProcesses: 'No processes.', noServices: 'No user services available (systemd --user not active).',
        noTerms: 'No terminal sessions.', noTrash: 'Trash is empty.',
        pid: 'PID', user: 'User', cpu: 'CPU', mem: 'MEM', rss: 'RSS', command: 'Command',
        name: 'Name', size: 'Size', confirmRestore: 'Restore {name}?',
        updates: 'Updates', currentVersion: 'Current version', latestVersion: 'Latest version',
        checkNow: 'Check now', applyUpdate: 'Update now', upToDate: 'The system is up to date.',
        checkFailed: 'Update check failed', releaseNotes: 'Release notes',
        updateAvailable: 'Update {version} available', updateApplying: 'Downloading and verifying…',
        updateRestarting: 'Restarting arutosiod…', updateTimeout: 'The daemon did not answer. Reload the page or restart arutosiod.',
        updateUnavailable: 'Automatic update unavailable.', updateManual: 'Update manually:',
        confirmUpdate: 'Download and install {version}? arutosiod will restart.', releasePage: 'Release page',
        checkedAt: 'Checked', noRelease: 'No releases published.', errorLabel: 'Error',
        unit: 'Unit', active: 'State', idle: 'Idle', clients: 'Clients', created: 'Created',
        confirmKill: 'Kill process {pid}?', confirmStop: 'Stop {name}?',
        confirmRestart: 'Restart {name}?', confirmEmpty: 'Permanently empty the trash?',
        protectedUnit: 'protected', bytes: 'B', kb: 'KB', mb: 'MB', gb: 'GB',
        killed: 'Process killed', emptied: 'Trash emptied', actionDone: 'Done'
    };
    let L = EN;
    let content = null;
    let activeTab = 'overview';
    let timer = null;
    let tickCount = 0;

    function esc(v) { return window.escapeHTML ? window.escapeHTML(String(v ?? '')) : String(v ?? ''); }
    function toast(msg, type) { try { window.showToast?.(msg, type || 'info'); } catch (_) {} }
    function confirmDialog(msg, okText) {
        if (typeof window.showConfirm === 'function') {
            return window.showConfirm(msg, { type: 'warning', okText: okText || 'OK', cancelText: 'Cancel' });
        }
        return Promise.resolve(window.confirm(msg));
    }
    function fmtBytes(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + ' ' + L.bytes;
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' ' + L.kb;
        if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' ' + L.mb;
        return (n / 1024 / 1024 / 1024).toFixed(2) + ' ' + L.gb;
    }
    function fmtDuration(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        if (d) return d + 'd ' + h + 'h';
        if (h) return h + 'h ' + m + 'm';
        return m + 'm';
    }
    function bar(used, total) {
        const p = total > 0 ? Math.max(0, Math.min(100, Math.round(used / total * 100))) : 0;
        return `<div class="sys-bar"><span style="width:${p}%"></span></div><small>${p}%</small>`;
    }

    function tabButton(id, label) {
        return `<button class="sys-tab" data-sys-tab="${id}">${esc(label)}</button>`;
    }

    function renderShell() {
        content.innerHTML = `
            <div class="sys-shell">
                <div class="sys-tabs">
                    ${tabButton('overview', L.overview)}
                    ${tabButton('processes', L.processes)}
                    ${tabButton('services', L.services)}
                    ${tabButton('terminals', L.terminals)}
                    ${tabButton('updates', L.updates)}
                    ${tabButton('trash', L.trash)}
                    <button class="sys-refresh" data-sys-refresh title="${esc(L.refresh)}">⟳</button>
                </div>
                <div class="sys-body">
                    <section class="sys-pane" data-sys-pane="overview"></section>
                    <section class="sys-pane" data-sys-pane="processes" hidden></section>
                    <section class="sys-pane" data-sys-pane="services" hidden></section>
                    <section class="sys-pane" data-sys-pane="terminals" hidden></section>
                    <section class="sys-pane" data-sys-pane="updates" hidden></section>
                    <section class="sys-pane" data-sys-pane="trash" hidden></section>
                </div>
            </div>
        `;
        content.querySelectorAll('[data-sys-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.sysTab;
                content.querySelectorAll('[data-sys-tab]').forEach(b => b.classList.toggle('active', b === btn));
                content.querySelectorAll('[data-sys-pane]').forEach(p => { p.hidden = p.dataset.sysPane !== activeTab; });
                refreshActive();
            });
        });
        content.querySelector('[data-sys-refresh]')?.addEventListener('click', () => refreshActive());
        setActiveTab(activeTab);
    }

    function setActiveTab(id) {
        activeTab = id;
        content.querySelectorAll('[data-sys-tab]').forEach(b => b.classList.toggle('active', b.dataset.sysTab === id));
        content.querySelectorAll('[data-sys-pane]').forEach(p => { p.hidden = p.dataset.sysPane !== id; });
    }

    function localReady() {
        return !!(window.arutosioLocal?.isLocal && window.arutosioLocal?.authenticated);
    }

    function showInstallNotice() {
        content.innerHTML = `<div class="sys-notice">${esc(L.notLocal)}</div>`;
    }

    async function refreshOverview() {
        const pane = content.querySelector('[data-sys-pane="overview"]');
        if (!pane) return;
        if (!localReady()) {
            pane.innerHTML = `<div class="sys-notice">${esc(window.arutosioLocal?.isLocal ? L.notAuth : L.notLocal)}</div>`;
            return;
        }
        try {
            const info = await window.arutosioLocal.system.info();
            const mem = info.memory || {};
            const disk = info.disk || {};
            const profile = info.profile || {};
            const trash = info.trash || {};
            const load = (info.load || []).map(n => Number(n).toFixed(2)).join(' · ');
            pane.innerHTML = `
                <div class="sys-grid">
                    <div class="sys-card"><span>${esc(L.host)}</span><strong>${esc(info.hostname || '—')}</strong><small>${esc(info.platform || '')}</small></div>
                    <div class="sys-card"><span>${esc(L.version)}</span><strong>arutosiod ${esc(info.version || '')}</strong><small>${esc(L.uptime)}: ${fmtDuration(info.uptime)}</small></div>
                    <div class="sys-card"><span>${esc(L.cpus)}</span><strong>${esc(info.cpus || 0)} cores</strong><small>${esc(L.load)}: ${esc(load || '—')}</small></div>
                    <div class="sys-card"><span>${esc(L.memory)}</span><strong>${fmtBytes(mem.used)} / ${fmtBytes(mem.total)}</strong>${bar(mem.used, mem.total)}</div>
                    <div class="sys-card"><span>${esc(L.disk)}</span><strong>${fmtBytes((disk.total || 0) - (disk.free || 0))} / ${fmtBytes(disk.total)}</strong>${bar((disk.total || 0) - (disk.free || 0), disk.total)}<small>${esc(disk.path || '')}</small></div>
                    <div class="sys-card"><span>${esc(L.profile)}</span><strong>${fmtBytes(profile.bytes)}</strong><small>${esc(profile.files || 0)} files</small></div>
                    <div class="sys-card"><span>${esc(L.trash)}</span><strong>${fmtBytes(trash.bytes)}</strong><small>${esc(trash.files || 0)} files</small></div>
                    <div class="sys-card"><span>${esc(L.terminals)}</span><strong>${esc(info.termSessions || 0)}</strong><small>${esc(L.tmux)}: ${info.tmux ? esc(L.yes) : esc(L.no)}</small></div>
                </div>
                <div class="sys-paths">
                    <div><strong>root</strong><code>${esc(info.root || '')}</code></div>
                    <div><strong>data</strong><code>${esc(info.dataDir || '')}</code></div>
                    <div><strong>shell</strong><code>${esc(info.shell || '')}</code></div>
                </div>
            `;
        } catch (e) {
            pane.innerHTML = `<div class="sys-notice">${esc(e.message || e)}</div>`;
        }
    }

    async function refreshProcesses() {
        const pane = content.querySelector('[data-sys-pane="processes"]');
        if (!pane) return;
        if (!localReady()) {
            pane.innerHTML = `<div class="sys-notice">${esc(window.arutosioLocal?.isLocal ? L.notAuth : L.notLocal)}</div>`;
            return;
        }
        try {
            const data = await window.arutosioLocal.system.processes();
            const list = data.processes || [];
            if (!list.length) { pane.innerHTML = `<div class="sys-notice">${esc(L.noProcesses)}</div>`; return; }
            pane.innerHTML = `
                <table class="sys-table">
                    <thead><tr><th>${esc(L.pid)}</th><th>${esc(L.user)}</th><th>${esc(L.cpu)}</th><th>${esc(L.mem)}</th><th>${esc(L.rss)}</th><th>${esc(L.command)}</th><th></th></tr></thead>
                    <tbody>${list.map(p => `
                        <tr>
                            <td>${esc(p.pid)}</td>
                            <td>${esc(p.user)}</td>
                            <td>${esc((Number(p.cpu) || 0).toFixed(1))}%</td>
                            <td>${esc((Number(p.memory) || 0).toFixed(1))}%</td>
                            <td>${fmtBytes(p.rss)}</td>
                            <td class="sys-command" title="${esc(p.command)}">${esc(p.command)}</td>
                            <td><button class="sys-btn sys-danger" data-kill="${esc(p.pid)}">${esc(L.kill)}</button></td>
                        </tr>`).join('')}</tbody>
                </table>
            `;
            pane.querySelectorAll('[data-kill]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const pid = btn.dataset.kill;
                    if (!(await confirmDialog(L.confirmKill.replace('{pid}', pid), L.kill))) return;
                    try {
                        await window.arutosioLocal.system.kill(pid);
                        toast(L.killed, 'success');
                        refreshProcesses();
                    } catch (e) { toast(e.message || e, 'error'); }
                });
            });
        } catch (e) {
            pane.innerHTML = `<div class="sys-notice">${esc(e.message || e)}</div>`;
        }
    }

    async function refreshServices() {
        const pane = content.querySelector('[data-sys-pane="services"]');
        if (!pane) return;
        if (!localReady()) {
            pane.innerHTML = `<div class="sys-notice">${esc(window.arutosioLocal?.isLocal ? L.notAuth : L.notLocal)}</div>`;
            return;
        }
        try {
            const data = await window.arutosioLocal.system.services();
            if (!data.available) { pane.innerHTML = `<div class="sys-notice">${esc(L.noServices)}</div>`; return; }
            const list = data.services || [];
            if (!list.length) { pane.innerHTML = `<div class="sys-notice">${esc(L.noServices)}</div>`; return; }
            pane.innerHTML = `
                <table class="sys-table">
                    <thead><tr><th>${esc(L.unit)}</th><th>${esc(L.active)}</th><th>${esc(L.command)}</th><th></th></tr></thead>
                    <tbody>${list.map(s => `
                        <tr>
                            <td><code>${esc(s.unit)}</code>${s.protected ? ` <small>(${esc(L.protectedUnit)})</small>` : ''}</td>
                            <td>${esc(s.active)}${s.sub ? ' / ' + esc(s.sub) : ''}</td>
                            <td class="sys-command">${esc(s.description || '')}</td>
                            <td class="sys-actions">
                                ${s.protected ? '' : `
                                    <button class="sys-btn" data-svc="${esc(s.unit)}" data-act="start">${esc(L.start)}</button>
                                    <button class="sys-btn" data-svc="${esc(s.unit)}" data-act="stop">${esc(L.stop)}</button>
                                    <button class="sys-btn" data-svc="${esc(s.unit)}" data-act="restart">${esc(L.restart)}</button>`}
                            </td>
                        </tr>`).join('')}</tbody>
                </table>
            `;
            pane.querySelectorAll('[data-svc]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const name = btn.dataset.svc;
                    const action = btn.dataset.act;
                    if (action !== 'start') {
                        const msg = (action === 'stop' ? L.confirmStop : L.confirmRestart).replace('{name}', name);
                        if (!(await confirmDialog(msg, L[action]))) return;
                    }
                    try {
                        await window.arutosioLocal.system.service(name, action);
                        toast(L.actionDone, 'success');
                        refreshServices();
                    } catch (e) { toast(e.message || e, 'error'); }
                });
            });
        } catch (e) {
            pane.innerHTML = `<div class="sys-notice">${esc(e.message || e)}</div>`;
        }
    }

    async function refreshTerms() {
        const pane = content.querySelector('[data-sys-pane="terminals"]');
        if (!pane) return;
        if (!localReady()) {
            pane.innerHTML = `<div class="sys-notice">${esc(window.arutosioLocal?.isLocal ? L.notAuth : L.notLocal)}</div>`;
            return;
        }
        try {
            const data = await window.arutosioLocal.system.terms();
            const list = data.sessions || [];
            if (!list.length) { pane.innerHTML = `<div class="sys-notice">${esc(L.noTerms)}</div>`; return; }
            pane.innerHTML = `
                <table class="sys-table">
                    <thead><tr><th>ID</th><th>${esc(L.pid)}</th><th>${esc(L.clients)}</th><th>${esc(L.idle)}</th><th>${esc(L.created)}</th><th></th></tr></thead>
                    <tbody>${list.map(t => `
                        <tr>
                            <td><code>${esc(t.id)}</code></td>
                            <td>${esc(t.pid)}</td>
                            <td>${esc(t.clients)}</td>
                            <td>${fmtDuration(t.idleSeconds)}</td>
                            <td>${esc(new Date(t.created).toLocaleString())}</td>
                            <td><button class="sys-btn sys-danger" data-term="${esc(t.id)}">${esc(L.kill)}</button></td>
                        </tr>`).join('')}</tbody>
                </table>
                <p class="sys-hint">${esc(L.terminals)}: ${esc(data.idleSeconds ? fmtDuration(data.idleSeconds) : '∞')}</p>
            `;
            pane.querySelectorAll('[data-term]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.term;
                    if (!(await confirmDialog(L.confirmKill.replace('{pid}', id), L.kill))) return;
                    try {
                        await window.arutosioLocal.system.killTerm(id);
                        toast(L.killed, 'success');
                        refreshTerms();
                    } catch (e) { toast(e.message || e, 'error'); }
                });
            });
        } catch (e) {
            pane.innerHTML = `<div class="sys-notice">${esc(e.message || e)}</div>`;
        }
    }

    async function refreshUpdates(force) {
        const pane = content.querySelector('[data-sys-pane="updates"]');
        if (!pane) return;
        if (!localReady()) {
            pane.innerHTML = `<div class="sys-notice">${esc(window.arutosioLocal?.isLocal ? L.notAuth : L.notLocal)}</div>`;
            return;
        }
        if (force) pane.innerHTML = `<div class="sys-notice">${esc(L.updateApplying)}</div>`;
        else if (!pane.querySelector('.sys-update')) pane.innerHTML = `<div class="sys-notice">…</div>`;
        let st;
        try {
            st = await window.arutosioLocal.updates.check(!!force);
        } catch (e) {
            pane.innerHTML = `<div class="sys-notice">${esc(L.checkFailed)}: ${esc(e.message || e)}</div>`;
            return;
        }
        const current = st.current || window.arutosioLocal.version || '—';
        const latest = st.latest || '';
        const checked = st.checkedAt ? new Date(st.checkedAt).toLocaleString() : '';
        const notes = st.notes ? `<div class="sys-update-notes"><strong>${esc(L.releaseNotes)}</strong><pre>${esc(st.notes)}</pre></div>` : '';
        const link = st.url ? `<a class="sys-link" href="${esc(st.url)}" target="_blank" rel="noopener">${esc(L.releasePage)} ↗</a>` : '';
        let body;
        if (st.error) {
            body = `<div class="sys-notice">${esc(L.checkFailed)}: ${esc(st.error)}</div>`;
        } else if (st.available) {
            body = `
                <p class="sys-update-title">${esc(L.updateAvailable.replace('{version}', latest))}</p>
                ${notes}
                <div class="sys-actions sys-update-actions">
                    ${st.canApply ? `<button class="sys-btn sys-primary" data-update-apply>${esc(L.applyUpdate)}</button>` : ''}
                    <button class="sys-btn" data-update-check>${esc(L.checkNow)}</button>
                    ${link}
                </div>
                ${st.canApply ? '' : `
                <div class="sys-update-manual">
                    <strong>${esc(L.updateUnavailable)}</strong>
                    ${st.reason ? `<small>${esc(st.reason)}</small>` : ''}
                    <p>${esc(L.updateManual)}</p>
                    <code>cd server &amp;&amp; ./install.sh</code>
                </div>`}
            `;
        } else {
            body = `
                <p class="sys-update-title">${esc(st.reason === 'no releases published' ? L.noRelease : L.upToDate)}</p>
                <div class="sys-actions sys-update-actions">
                    <button class="sys-btn" data-update-check>${esc(L.checkNow)}</button>
                    ${link}
                </div>
            `;
        }
        pane.innerHTML = `
            <div class="sys-update">
                <div class="sys-grid">
                    <div class="sys-card"><span>${esc(L.currentVersion)}</span><strong>v${esc(current)}</strong></div>
                    <div class="sys-card"><span>${esc(L.latestVersion)}</span><strong>${latest ? 'v' + esc(latest) : '—'}</strong><small>${esc(L.checkedAt)}: ${esc(checked)}</small></div>
                </div>
                ${body}
            </div>
        `;
        pane.querySelector('[data-update-check]')?.addEventListener('click', () => refreshUpdates(true));
        pane.querySelector('[data-update-apply]')?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            if (!(await confirmDialog(L.confirmUpdate.replace('{version}', latest), L.applyUpdate))) return;
            btn.disabled = true;
            pane.innerHTML = `<div class="sys-notice">${esc(L.updateApplying)}</div>`;
            const before = current;
            try {
                await window.arutosioLocal.updates.apply();
            } catch (e) {
                toast(e.message || e, 'error');
                refreshUpdates(true);
                return;
            }
            pane.innerHTML = `<div class="sys-notice">${esc(L.updateRestarting)}</div>`;
            for (let i = 0; i < 60; i++) {
                await new Promise(resolve => setTimeout(resolve, 750));
                try {
                    const res = await fetch('/api/health', { cache: 'no-store' });
                    if (!res.ok) continue;
                    const health = await res.json();
                    if (health.version && health.version !== before) {
                        location.reload();
                        return;
                    }
                } catch (_) {}
            }
            toast(L.updateTimeout, 'error', 10000);
            refreshUpdates(true);
        });
    }

    async function refreshTrash() {
        const pane = content.querySelector('[data-sys-pane="trash"]');
        if (!pane) return;
        if (!localReady()) {
            pane.innerHTML = `<div class="sys-notice">${esc(window.arutosioLocal?.isLocal ? L.notAuth : L.notLocal)}</div>`;
            return;
        }
        try {
            const data = await window.arutosioLocal.system.trash();
            const listed = await window.arutosioLocal.system.trashList();
            const entries = listed.entries || [];
            pane.innerHTML = `
                <div class="sys-grid">
                    <div class="sys-card"><span>${esc(L.trash)}</span><strong>${fmtBytes(data.bytes)}</strong><small>${esc(data.files || 0)} files</small></div>
                </div>
                <div class="sys-paths"><div><strong>path</strong><code>${esc(data.path || '')}</code></div></div>
                ${entries.length ? `
                <table class="sys-table">
                    <thead><tr><th>${esc(L.name)}</th><th>${esc(L.deletedAt)}</th><th>${esc(L.size)}</th><th></th></tr></thead>
                    <tbody>${entries.map(e => `
                        <tr>
                            <td><code>${esc(e.original || e.name)}</code></td>
                            <td>${esc(e.deletedAt ? new Date(e.deletedAt).toLocaleString() : '')}</td>
                            <td>${fmtBytes(e.bytes)}</td>
                            <td><button class="sys-btn" data-restore="${esc(e.id)}" data-name="${esc(e.name)}">${esc(L.restore)}</button></td>
                        </tr>`).join('')}</tbody>
                </table>` : `<div class="sys-notice">${esc(L.noEntries)}</div>`}
                <button class="sys-btn sys-danger" data-empty ${data.files ? '' : 'disabled'}>${esc(L.empty)}</button>
            `;
            pane.querySelectorAll('[data-restore]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.restore;
                    if (!(await confirmDialog(L.confirmRestore.replace('{name}', btn.dataset.name || id), L.restore))) return;
                    try {
                        await window.arutosioLocal.system.restoreTrash(id);
                        toast(L.restored, 'success');
                        refreshTrash();
                    } catch (e) { toast(e.message || e, 'error'); }
                });
            });
            pane.querySelector('[data-empty]')?.addEventListener('click', async () => {
                if (!(await confirmDialog(L.confirmEmpty, L.empty))) return;
                try {
                    await window.arutosioLocal.system.emptyTrash();
                    toast(L.emptied, 'success');
                    refreshTrash();
                } catch (e) { toast(e.message || e, 'error'); }
            });
        } catch (e) {
            pane.innerHTML = `<div class="sys-notice">${esc(e.message || e)}</div>`;
        }
    }

    function refreshActive() {
        if (activeTab === 'overview') refreshOverview();
        else if (activeTab === 'processes') refreshProcesses();
        else if (activeTab === 'services') refreshServices();
        else if (activeTab === 'terminals') refreshTerms();
        else if (activeTab === 'updates') refreshUpdates();
        else if (activeTab === 'trash') refreshTrash();
    }

    function init() {
        const win = document.getElementById('win-system');
        if (!win) return;
        L = (typeof currentLang !== 'undefined' && currentLang === 'it') ? IT : EN;
        content = win.querySelector('.win-content');
        if (!content) return;
        if (!window.arutosioLocal?.isLocal) {
            showInstallNotice();
            return;
        }
        if (!content.querySelector('.sys-shell')) renderShell();
        refreshActive();
        if (!timer) {
            timer = setInterval(() => {
                if (document.visibilityState !== 'visible') return;
                if (!win || win.style.display === 'none') return;
                if (!localReady()) return;
                if (activeTab === 'overview') {
                    if (++tickCount % 2 === 0) refreshOverview();
                } else if (activeTab === 'processes') {
                    refreshProcesses();
                } else if (activeTab === 'terminals') {
                    refreshTerms();
                }
            }, 4000);
        }
    }

    window.systemApp = { init, refresh: refreshActive };
})();
