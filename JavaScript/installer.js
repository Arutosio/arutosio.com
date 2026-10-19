/* ╔══════════════════════════════════════════════════════════╗
 * ║  INSTALLER — .zip package import flow                     ║
 * ║  Lazy-loads JSZip, validates manifest, confirms install   ║
 * ╚══════════════════════════════════════════════════════════╝ */

const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
let _jszipPromise = null;

function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (_jszipPromise) return _jszipPromise;
    _jszipPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = JSZIP_CDN;
        s.onload = () => resolve(window.JSZip);
        s.onerror = () => reject(new Error('Failed to load JSZip from CDN'));
        document.head.appendChild(s);
    });
    return _jszipPromise;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/;
const TYPES = ['app', 'command'];
const KNOWN_ROLES = ['app', 'command', 'widget'];
const KNOWN_CATEGORIES = ['info', 'games', 'tools', 'creativity', 'system', 'other'];

function _knownPermissions() {
    // Derive from the live PERM_REQUIRED map in sandbox.js: every unique
    // permission string declared as a gate for some ctx.* method.
    const set = new Set();
    const perms = window.sandbox?.PERM_REQUIRED || {};
    for (const v of Object.values(perms)) if (v) set.add(v);
    return set;
}

function validateManifest(m) {
    if (!m || typeof m !== 'object') return 'manifest is not an object';
    if (!ID_RE.test(m.id || '')) return 'invalid id (a-z, 0-9, _-, 2-41 chars)';
    if (!m.version || typeof m.version !== 'string') return 'version is required (non-empty string)';
    // Role validation: modern manifests declare `roles: [...]`, legacy ones
    // declare `type: "app"|"command"`. Accept either, reject if neither is
    // valid or if any role string is unknown.
    if (Array.isArray(m.roles)) {
        if (m.roles.length === 0) return 'roles must be a non-empty array';
        for (const r of m.roles) {
            if (typeof r !== 'string') return 'roles entries must be strings';
            if (!KNOWN_ROLES.includes(r)) return 'unknown role: "' + r + '"';
        }
    } else if (m.roles != null) {
        return 'roles must be an array';
    } else if (!TYPES.includes(m.type)) {
        return 'type must be "app" or "command" (or declare roles[])';
    }
    // When a manifest declares BOTH roles[] and type, they must agree:
    // `type` has to appear in `roles`. A mismatch is almost always a copy-paste
    // bug and would silently confuse downstream role checks.
    if (Array.isArray(m.roles) && typeof m.type === 'string') {
        if (!m.roles.includes(m.type)) {
            return 'type "' + m.type + '" must be included in roles array';
        }
        if (m.roles.length > 1) {
            // Legacy `type` paired with modern multi-role `roles` — valid but
            // discouraged. `type` should be dropped from hybrid manifests.
            console.warn('[installer] manifest declares both roles[] and type; prefer roles-only for hybrid packages (' + m.id + ')');
        }
    }
    if (!m.name || typeof m.name !== 'string') return 'name is required';
    if (m.entry && typeof m.entry !== 'string') return 'entry must be a string';
    if (m.entries != null) {
        if (typeof m.entries !== 'object' || Array.isArray(m.entries)) return 'entries must be an object';
        const declaredRoles = Array.isArray(m.roles) ? m.roles : (TYPES.includes(m.type) ? [m.type] : []);
        for (const [k, v] of Object.entries(m.entries)) {
            if (!declaredRoles.includes(k)) return 'entries key "' + k + '" is not a declared role';
            if (!v || typeof v !== 'string') return 'entries["' + k + '"] must be a non-empty string';
        }
    }
    if (m.commandAlias != null) {
        if (typeof m.commandAlias !== 'string' || !m.commandAlias) return 'commandAlias must be a non-empty string';
    }
    if (m.permissions != null) {
        if (!Array.isArray(m.permissions)) return 'permissions must be an array';
        const known = _knownPermissions();
        for (const p of m.permissions) {
            if (typeof p !== 'string') return 'permissions must be strings';
            if (known.size && !known.has(p)) return 'unknown permission: "' + p + '"';
        }
    }
    if (m.allowOrigin != null && typeof m.allowOrigin !== 'boolean') {
        return 'allowOrigin must be a boolean';
    }
    if (m.unmountOnClose != null && typeof m.unmountOnClose !== 'boolean') {
        return 'unmountOnClose must be a boolean';
    }
    // Widget options block — only valid when 'widget' role is declared.
    if (m.widget != null) {
        if (typeof m.widget !== 'object' || Array.isArray(m.widget)) return 'widget must be an object';
        const declaredRoles = Array.isArray(m.roles) ? m.roles : (TYPES.includes(m.type) ? [m.type] : []);
        if (!declaredRoles.includes('widget')) return 'widget block requires "widget" in roles[]';
        const w = m.widget;
        const numKeys = ['defaultWidth', 'defaultHeight', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight'];
        for (const k of numKeys) {
            if (w[k] != null && (typeof w[k] !== 'number' || w[k] <= 0)) {
                return 'widget.' + k + ' must be a positive number';
            }
        }
        if (w.defaultAnchor != null) {
            const anchors = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
            if (!anchors.includes(w.defaultAnchor)) return 'widget.defaultAnchor must be one of ' + anchors.join(', ');
        }
    }
    if (m.category != null) {
        if (typeof m.category !== 'string') return 'category must be a string';
        if (!KNOWN_CATEGORIES.includes(m.category)) {
            // Warn-only — unknown categories fall back to an "other" bucket
            // and don't block install. Author still gets the console heads-up.
            console.warn('[installer] unknown category "' + m.category + '" — falling back to "other"');
        }
    }
    // SDK / minSdk: reject when the package needs a newer host contract.
    const reqSdk = Number(m.minSdk ?? m.sdk);
    if (Number.isFinite(reqSdk) && reqSdk > 0) {
        const hostSdk = Number(window.sandbox?.SDK_VERSION) || 1;
        if (reqSdk > hostSdk) {
            return 'package requires SDK v' + reqSdk + ', host provides v' + hostSdk;
        }
    }
    return null;
}

async function _confirmInstall(manifest, isUpdate) {
    const t = window.t();
    const titleTpl = isUpdate ? (t.install_update_title || 'Update {name}?') : (t.install_title || 'Install {name}?');
    const title = titleTpl.replace('{name}', manifest.name);
    const permsList = (manifest.permissions || []).map(p => '• ' + (window.permissions?.label(p) || p)).join('\n');
    const rolesLabel = Array.isArray(manifest.roles) && manifest.roles.length
        ? manifest.roles.join(' + ')
        : (manifest.type || '—');
    const body = (t.install_body || 'Type: {type}\nID: {id}\nVersion: {version}\nAuthor: {author}\n\nDeclared permissions:\n{perms}')
        .replace('{type}', rolesLabel)
        .replace('{id}', manifest.id)
        .replace('{version}', manifest.version || '—')
        .replace('{author}', manifest.author || '—')
        .replace('{perms}', permsList || (t.install_no_perms || '(none)'));

    return new Promise(resolve => {
        const backdrop = document.createElement('div');
        backdrop.className = 'confirm-backdrop perm-backdrop';
        const modal = document.createElement('div');
        modal.className = 'confirm-modal install-modal';
        modal.innerHTML = `
            <div class="perm-header"><span class="perm-icon"></span><div class="perm-title"></div></div>
            <pre class="install-body"></pre>
            <div class="confirm-actions">
                <button class="confirm-btn confirm-cancel"></button>
                <button class="confirm-btn confirm-ok"></button>
            </div>
        `;
        modal.querySelector('.perm-icon').textContent = manifest.icon || '📦';
        modal.querySelector('.perm-title').textContent = title;
        modal.querySelector('.install-body').textContent = body;
        modal.querySelector('.confirm-cancel').textContent = t.confirm_cancel || 'Cancel';
        modal.querySelector('.confirm-ok').textContent = isUpdate ? (t.install_update || 'Update') : (t.install_install || 'Install');
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        requestAnimationFrame(() => backdrop.classList.add('confirm-show'));
        const close = (ok) => {
            backdrop.classList.remove('confirm-show');
            setTimeout(() => backdrop.remove(), 250);
            resolve(ok);
        };
        modal.querySelector('.confirm-ok').addEventListener('click', () => close(true));
        modal.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
        backdrop.addEventListener('click', e => { if (e.target === backdrop) close(false); });
    });
}

async function installFromFile(file, opts) {
    const t = window.t();
    const sandboxOrigin = !!(opts && opts.sandboxOrigin);
    const callerAppId = (opts && opts.callerAppId) || null;
    if (!file) throw new Error('no file');
    // Accept a raw Blob too (e.g. from ctx.installZip). JSZip only needs
    // something blob-like with .arrayBuffer(); the filename check is purely
    // a UX guard for drag-drop, so skip it when the caller gave us a Blob.
    if (file.name && !/\.zip$/i.test(file.name)) {
        if (window.showToast) showToast(t.install_err_not_zip || 'File must be a .zip', 'error');
        throw new Error('not a zip');
    }
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(file);

    const manifestEntry = zip.file('manifest.json');
    if (!manifestEntry) throw new Error('manifest.json missing');
    const manifestText = await manifestEntry.async('string');
    let manifest;
    try { manifest = JSON.parse(manifestText); }
    catch (e) { throw new Error('manifest.json invalid JSON: ' + e.message); }

    const err = validateManifest(manifest);
    if (err) {
        if (window.showToast) showToast((t.install_err_invalid || 'Invalid manifest') + ': ' + err, 'error');
        throw new Error(err);
    }

    // Verify every declared role has a resolvable entry inside the zip.
    // `entries[role]` wins, then the shared `entry`, then `index.js` default.
    const rolesToCheck = Array.isArray(manifest.roles) && manifest.roles.length
        ? manifest.roles
        : (TYPES.includes(manifest.type) ? [manifest.type] : []);
    const checkedPaths = new Set();
    for (const role of rolesToCheck) {
        const p = (manifest.entries && manifest.entries[role]) || manifest.entry || 'index.js';
        if (checkedPaths.has(p)) continue;
        checkedPaths.add(p);
        if (!zip.file(p)) throw new Error('entry not found: ' + p);
    }

    // Sandbox-originated installs of allowOrigin packages need an explicit
    // extra gesture — a sandboxed app should not be able to hand the user a
    // relaxed-sandbox package without a second, plain-language consent.
    if (sandboxOrigin && manifest.allowOrigin === true) {
        const warn = '⚠ The package "' + (manifest.name || manifest.id) + '" requests same-origin iframe sandbox (allowOrigin). This breaks the usual isolation. Install anyway?'
            + (callerAppId ? '\n\nRequested by: ' + callerAppId : '');
        const approved = (typeof window.showConfirm === 'function')
            ? await window.showConfirm(warn)
            : window.confirm(warn);
        if (!approved) throw new Error('allowOrigin_consent_denied');
    }
    const isUpdate = window.registry.isInstalled(manifest.id);
    const ok = await _confirmInstall(manifest, isUpdate);
    if (!ok) return false;

    // Read all files as Blobs
    const files = {};
    const filePromises = [];
    zip.forEach((path, entry) => {
        if (entry.dir) return;
        if (path === 'manifest.json') return;
        filePromises.push(entry.async('blob').then(blob => {
            // Set blob type from extension for proper module loading
            const ext = path.split('.').pop().toLowerCase();
            const mime = ext === 'js' ? 'text/javascript'
                : ext === 'css' ? 'text/css'
                : ext === 'json' ? 'application/json'
                : ext === 'html' ? 'text/html'
                : blob.type || 'application/octet-stream';
            files[path] = blob.type === mime ? blob : new Blob([blob], { type: mime });
        }));
    });
    await Promise.all(filePromises);

    await window.registry.saveManifest(manifest, files);
    if (window.showToast) showToast(((isUpdate ? (t.install_updated || '{name} updated') : (t.install_installed || '{name} installed'))).replace('{name}', manifest.name), 'success');
    return manifest;
}

function pickFile() {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,application/zip';
        input.onchange = () => resolve(input.files?.[0] || null);
        input.click();
    });
}

async function installPrompt() {
    const file = await pickFile();
    if (!file) return null;
    try {
        return await installFromFile(file);
    } catch (e) {
        console.warn('[installer]', e);
        return null;
    }
}

function initDragDrop() {
    const desktop = document.getElementById('desktop');
    if (!desktop) return;
    let counter = 0;
    const overlay = document.createElement('div');
    overlay.className = 'install-dropzone';
    overlay.innerHTML = '<div class="install-dropzone-inner">📦 <span></span></div>';
    document.body.appendChild(overlay);
    const updateLabel = () => {
        const t = window.t();
        overlay.querySelector('span').textContent = t.install_drop_label || 'Drop .zip to install';
    };
    updateLabel();

    document.addEventListener('dragenter', (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
        counter++;
        updateLabel();
        overlay.classList.add('show');
    });
    document.addEventListener('dragover', (e) => {
        if (overlay.classList.contains('show')) { e.preventDefault(); }
    });
    document.addEventListener('dragleave', () => {
        counter--;
        if (counter <= 0) { counter = 0; overlay.classList.remove('show'); }
    });
    document.addEventListener('drop', async (e) => {
        if (!e.dataTransfer) return;
        const f = e.dataTransfer.files?.[0];
        if (!f) return;
        e.preventDefault();
        counter = 0;
        overlay.classList.remove('show');
        try { await installFromFile(f); }
        catch (err) { console.warn('[installer drop]', err); }
    });
}

window.installer = { installFromFile, pickFile, installPrompt, initDragDrop };
