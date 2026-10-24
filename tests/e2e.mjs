// End-to-end checks for the bundled Files and Grimoire packages.
//
//   npm i playwright-core        (once)
//   node tests/e2e.mjs
//
// Set ARUTOSIOD to a built binary (default: server/arutosiod) and CHROME_PATH
// to a Chrome/Chromium binary (default: the Playwright download cache).
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';

// createRequire keeps the script working with a global install (NODE_PATH).
const { chromium } = createRequire(import.meta.url)('playwright-core');

const repo = path.resolve(import.meta.dirname, '..');
const bin = process.env.ARUTOSIOD || path.join(repo, 'server', 'arutosiod');
const token = 'e2e-token';
const port = 18000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
const tmp = await mkdtemp(path.join(os.tmpdir(), 'arutosio-e2e-'));
const root = path.join(tmp, 'root');
const data = path.join(tmp, 'data');

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

function chromePath() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
    if (!existsSync(cache)) return undefined;
    for (const dir of readdirSync(cache).filter(d => d.startsWith('chromium-')).sort().reverse()) {
        for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
            const p = path.join(cache, dir, rel);
            if (existsSync(p)) return p;
        }
    }
    return undefined;
}

async function waitForHealth() {
    for (let i = 0; i < 60; i++) {
        try {
            const res = await fetch(base + '/api/health');
            if (res.ok) return;
        } catch {}
        await sleep(250);
    }
    throw new Error('daemon did not become healthy');
}

if (!existsSync(bin)) {
    console.error(`missing daemon binary: ${bin}\nbuild it with: (cd server && go build -o arutosiod .)`);
    process.exit(2);
}

await mkdir(path.join(root, 'src'), { recursive: true });
await mkdir(data, { recursive: true });
await writeFile(path.join(root, 'README.md'), '# Readme\n');
await writeFile(path.join(root, 'notes.md'), '# Heading\n\nSome **bold** text and `code`.\n\n- a\n- b\n');
await writeFile(path.join(root, 'package.json'), '{}\n');
await writeFile(path.join(root, 'style.css'), 'body{}\n');
await writeFile(path.join(root, 'src', 'main.js'), 'console.log(1)\n');
await symlink('README.md', path.join(root, 'link.md'));

const daemon = spawn(bin, [
    '-web', repo, '-root', root, '-data', data,
    '-token', token, '-listen', `127.0.0.1:${port}`,
], { stdio: ['ignore', 'pipe', 'pipe'] });
let daemonLog = '';
daemon.stdout.on('data', d => { daemonLog += d; });
daemon.stderr.on('data', d => { daemonLog += d; });

let browser;
try {
    await waitForHealth();
    browser = await chromium.launch({
        executablePath: chromePath(),
        headless: true,
        args: ['--no-sandbox'],
    });
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.addInitScript(() => {
        sessionStorage.setItem('arutosio_summoned', '1');
        const perms = { storage: 'granted', notifications: 'granted', windows: 'granted', install: 'granted', 'fs.read': 'granted', 'fs.write': 'granted', 'fs.delete': 'granted' };
        localStorage.setItem('arutosio_perms_filemanager', JSON.stringify(perms));
        localStorage.setItem('arutosio_perms_grimoire', JSON.stringify(perms));
    });
    await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.arutosioLocal?.authenticated && document.getElementById('app')?.classList.contains('visible'), null, { timeout: 30000 });
    await sleep(4000);

    // ── Files ─────────────────────────────────────────────
    await page.evaluate(() => { window.openWindow('filemanager'); const w = document.getElementById('win-filemanager'); if (w) window.toggleMaximize(w); });
    const fm = page.frameLocator('#win-filemanager .sandbox-iframe');
    await fm.locator('.fm-entry', { hasText: 'README.md' }).waitFor({ timeout: 20000 });
    await sleep(700);

    const icons = await fm.locator('.fm-entry-icon img').evaluateAll(imgs => imgs.map(i => i.naturalWidth));
    ok(icons.length >= 5 && icons.every(w => w > 0), `file icons rendered (${icons.length})`);

    const names = await fm.locator('.fm-entry-name').allInnerTexts();
    ok(names.includes('src') && names.indexOf('src') < names.indexOf('README.md'), 'folders sort before files');

    await fm.locator('#fm-search').fill('READ');
    await sleep(250);
    const filtered = await fm.locator('.fm-entry-name').allInnerTexts();
    ok(filtered.length === 1 && filtered[0] === 'README.md', 'search filters the list');
    await fm.locator('#fm-search').fill('');
    await sleep(250);

    // Drag a file onto a folder (same source).
    await fm.locator('.fm-entry', { hasText: 'README.md' }).evaluate((file) => {
        const dir = Array.from(document.querySelectorAll('.fm-entry')).find(el => el.querySelector('.fm-entry-name')?.textContent === 'src');
        const dt = new DataTransfer();
        file.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dir.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dir.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await sleep(800);
    const moved = await readFile(path.join(root, 'src', 'README.md'), 'utf8').catch(() => null);
    ok(moved === '# Readme\n' && !existsSync(path.join(root, 'README.md')), 'drag moves a file into a folder');

    // Drop a file from the OS.
    await fm.locator('#fm-tree').evaluate((tree) => {
        const dt = new DataTransfer();
        dt.items.add(new File(['dropped content'], 'dropped.txt', { type: 'text/plain' }));
        tree.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await sleep(1000);
    ok((await readFile(path.join(root, 'dropped.txt'), 'utf8').catch(() => null)) === 'dropped content', 'OS drop uploads into the current folder');

    // ── Grimoire ──────────────────────────────────────────
    await page.evaluate(() => { window.openWindow('grimoire'); const w = document.getElementById('win-grimoire'); if (w) window.toggleMaximize(w); });
    const gr = page.frameLocator('#win-grimoire .sandbox-iframe');
    await sleep(2500);
    await gr.locator('.wrap').evaluate((wrap) => {
        const dt = new DataTransfer();
        dt.setData('application/x-arutosio-file', JSON.stringify({ source: 'machine', kind: 'file', path: 'notes.md', name: 'notes.md' }));
        wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await gr.locator('.ftree-item', { hasText: 'notes.md' }).first().waitFor({ timeout: 15000 });
    await sleep(600);
    ok((await gr.locator('textarea').inputValue()).startsWith('# Heading'), 'dropping a machine file opens it');

    const treeIcons = await gr.locator('.ftree-icon img').evaluateAll(imgs => imgs.map(i => i.naturalWidth));
    ok(treeIcons.length >= 1 && treeIcons.every(w => w > 0), `tree icons rendered (${treeIcons.length})`);

    await gr.locator('.tab-preview').click();
    await gr.locator('.body .preview').waitFor({ timeout: 10000 });
    const md = await gr.locator('.preview-md').evaluate(el => ({
        h1: el.querySelector('h1')?.textContent,
        strong: el.querySelector('strong')?.textContent,
        items: el.querySelectorAll('li').length,
        scripts: el.querySelectorAll('script').length,
    }));
    ok(md.h1 === 'Heading' && md.strong === 'bold' && md.items === 2 && md.scripts === 0, 'markdown preview renders safely');

    // Sandboxed frames cannot read sessionStorage; the app tolerates it.
    const realErrors = errors.filter(e => !e.includes('sessionStorage'));
    ok(realErrors.length === 0, 'no page errors' + (realErrors.length ? ': ' + realErrors.join(' | ') : ''));
} catch (e) {
    failures.push(e.message);
    console.error(e);
    if (daemonLog) console.error(daemonLog.slice(-2000));
} finally {
    await browser?.close();
    daemon.kill();
    await rm(tmp, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
