/* ╔══════════════════════════════════════════════════════════╗
 * ║  CONTENT — Cards, Projects, Clips, Live, Countdown     ║
 * ║  All dynamic content builders and the live section      ║
 * ╚══════════════════════════════════════════════════════════╝ */

/* ────────────────────────────────
 * § LINK CARDS
 * Renders social link cards from the SOCIALS array in config.js.
 * Each card has an icon, platform name, handle, and hover arrow.
 * ──────────────────────────────── */

/** Build and inject social link cards into #link-cards */
function buildLinkCards() {
    document.getElementById('link-cards').innerHTML = SOCIALS.map(s =>
        `<a href="${s.href}" class="link-card ${s.id}" target="_blank" rel="noopener" aria-label="${s.platform} — ${s.handle}">
            ${s.icon}
            <div class="link-card-text">
                <span class="link-card-platform">${s.platform}</span>
                <span class="link-card-handle">${s.handle}</span>
            </div>
            <i class="fas fa-arrow-right link-card-arrow" aria-hidden="true"></i>
        </a>`
    ).join('');
}

/* ────────────────────────────────
 * § INTEREST GRID
 * Renders the interest cards (gaming, anime, coding, etc.)
 * from the INTERESTS array with translated names.
 * ──────────────────────────────── */

/**
 * Build and inject interest cards into #interest-grid
 * @param {string} lang — current language code
 */
function buildInterestGrid(lang) {
    const t = i18n[lang];
    document.getElementById('interest-grid').innerHTML = INTERESTS.map(item =>
        `<div class="interest-card">
            <span class="interest-icon">${item.icon}</span>
            <div class="interest-body">
                <span class="interest-name">${t[item.key]}</span>
                <span class="interest-detail">${item.detail}</span>
            </div>
        </div>`
    ).join('');
}

/* ────────────────────────────────
 * § CLIP GALLERY
 * Lazy-loading clip embed gallery. Shows placeholder cards
 * that load the actual iframe only on click (saves bandwidth).
 * Supports Twitch clips and YouTube videos.
 * ──────────────────────────────── */

/** Build clip gallery cards with lazy iframe loading */
function buildClipGallery() {
    const grid = document.getElementById('clips-grid');
    if (!grid || !CLIPS || !CLIPS.length) return;
    grid.innerHTML = '';

    CLIPS.forEach(clip => {
        const card = document.createElement('div');
        card.className = 'clip-card';
        card.innerHTML = `
            <div class="clip-embed">
                <div class="clip-placeholder" data-clip-id="${clip.embedId}" data-platform="${clip.platform}">
                    <span class="clip-play-icon">\u25B6</span>
                    <span class="clip-title">${clip.title}</span>
                </div>
            </div>
        `;
        // Click to load iframe (lazy — don't load all iframes at once)
        card.querySelector('.clip-placeholder').addEventListener('click', function() {
            const p = this.dataset.platform;
            const id = this.dataset.clipId;
            let src = '';
            if (p === 'twitch') src = `https://clips.twitch.tv/embed?clip=${id}&parent=${location.hostname}`;
            else if (p === 'youtube') src = `https://www.youtube.com/embed/${id}?autoplay=1`;
            this.outerHTML = `<iframe src="${src}" allowfullscreen allow="autoplay" title="${clip.title}"></iframe>`;
        });
        grid.appendChild(card);
    });
}

/* ────────────────────────────────
 * § PROJECT CARDS (GitHub API)
 * Fetches repo data from the GitHub API for each slug in the
 * PROJECTS array (config.js). Shows stars, forks, commit count,
 * language, topics, and dates. Caches results after first fetch.
 * ──────────────────────────────── */

/** Language → dot color mapping for project cards */
const LANG_COLORS = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', 'C#': '#178600', Python: '#3572A5',
    Java: '#b07219', Go: '#00ADD8', Rust: '#dea584', Ruby: '#701516', PHP: '#4F5D95',
    Shell: '#89e051', Groovy: '#4298b8', HTML: '#e34c26', CSS: '#563d7c', Kotlin: '#A97BFF',
    Swift: '#F05138', Dart: '#00B4AB', Lua: '#000080', C: '#555555', 'C++': '#f34b7d'
};

let projectCache = null;

/**
 * Fetch total commit count for a repo using the Link header trick
 * @param {string} slug — repo slug (owner/name)
 * @returns {Promise<number>} total commit count
 */
function fetchWithTimeout(url, ms = 7000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}
async function fetchCommitCount(slug) {
    try {
        const r = await fetchWithTimeout(`https://api.github.com/repos/${slug}/commits?per_page=1`);
        if (!r.ok) return 0;
        const link = r.headers.get('Link');
        if (!link) return 1;
        const match = link.match(/page=(\d+)>;\s*rel="last"/);
        return match ? parseInt(match[1], 10) : 1;
    } catch { return 0; }
}

/**
 * Fetch all project data in parallel, caching results
 * @returns {Promise<Array>} array of repo objects (or error markers)
 */
async function fetchProjects() {
    if (projectCache) return projectCache;
    try {
        const results = await Promise.allSettled(
            PROJECTS.map(async slug => {
                const [repoRes, commits] = await Promise.all([
                    fetchWithTimeout(`https://api.github.com/repos/${slug}`).then(r => r.ok ? r.json() : Promise.reject(new Error('GitHub API ' + r.status))),
                    fetchCommitCount(slug)
                ]);
                repoRes._commits = commits;
                return repoRes;
            })
        );
        projectCache = results.map((r, i) => r.status === 'fulfilled' ? r.value : { _error: true, _slug: PROJECTS[i] });
    } catch {
        projectCache = PROJECTS.map(slug => ({ _error: true, _slug: slug }));
    }
    return projectCache;
}

/**
 * Format an ISO date string for display
 * @param {string} iso — ISO date string
 * @param {string} lang — language code for locale
 * @returns {string} formatted date
 */
function fmtDate(iso, lang) {
    const loc = lang === 'fn' ? 'en' : lang;
    return new Date(iso).toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Render project cards HTML into #projects-grid
 * @param {Array} repos — array of repo data objects
 * @param {string} lang — current language code
 */
function renderProjectCards(repos, lang) {
    const t = i18n[lang];
    const grid = document.getElementById('projects-grid');
    if (!grid) return;

    grid.innerHTML = repos.map(repo => {
        if (repo._error) {
            return `<div class="project-card project-card--error">
                <span class="project-error-icon">\u26A0</span>
                <span class="project-error-text">${t.proj_error}: ${repo._slug}</span>
            </div>`;
        }

        const langDot = repo.language && LANG_COLORS[repo.language]
            ? `<span class="proj-lang-dot" style="background:${LANG_COLORS[repo.language]}"></span>`
            : '';
        const langName = repo.language || '\u2014';
        const createdStr = fmtDate(repo.created_at, lang);
        const updatedStr = fmtDate(repo.pushed_at, lang);
        const topics = (repo.topics || []).slice(0, 4);
        const topicsHtml = topics.length
            ? `<div class="proj-topics">${topics.map(t => `<span class="proj-topic">${t}</span>`).join('')}</div>`
            : '';

        return `<a href="${repo.html_url}" class="project-card" target="_blank" rel="noopener" aria-label="${repo.name}">
            <div class="project-header">
                <i class="fab fa-github project-gh-icon" aria-hidden="true"></i>
                <span class="project-name">${repo.name}</span>
                ${repo.archived ? '<span class="proj-badge proj-badge--archived">archived</span>' : ''}
                ${repo.private ? '<span class="proj-badge proj-badge--private"><i class="fas fa-lock"></i></span>' : ''}
            </div>
            <p class="project-desc">${repo.description || '\u2014'}</p>
            ${topicsHtml}
            <div class="project-stats">
                <span class="proj-stat">${langDot} ${langName}</span>
                <span class="proj-stat"><i class="fas fa-star" aria-hidden="true"></i> ${repo.stargazers_count}</span>
                <span class="proj-stat"><i class="fas fa-code-branch" aria-hidden="true"></i> ${repo.forks_count}</span>
                <span class="proj-stat"><i class="fas fa-code-commit" aria-hidden="true"></i> ${repo._commits} ${t.proj_commits}</span>
                <span class="proj-stat"><i class="fas fa-circle-exclamation" aria-hidden="true"></i> ${repo.open_issues_count} ${t.proj_issues}</span>
            </div>
            <div class="project-dates">
                <span class="proj-date"><i class="fas fa-calendar-plus" aria-hidden="true"></i> ${t.proj_created} ${createdStr}</span>
                <span class="proj-date"><i class="fas fa-clock" aria-hidden="true"></i> ${t.proj_updated} ${updatedStr}</span>
            </div>
        </a>`;
    }).join('');
}

/**
 * Build project cards — shows loading state, fetches data, then renders
 * @param {string} lang — current language code
 */
async function buildProjectCards(lang) {
    const grid = document.getElementById('projects-grid');
    if (!grid) return;
    const t = i18n[lang];
    grid.innerHTML = `<div class="project-card project-card--loading"><span class="proj-loading-rune">\u25C8</span> ${t.proj_loading}</div>`;
    const repos = await fetchProjects();
    renderProjectCards(repos, lang);
}

/* ────────────────────────────────
 * § CARD ENTRANCE (CSS-based, smooth)
 * Staggered fade-in + slide-up animation for card grids.
 * Uses double-rAF to batch reflow, then applies CSS transitions.
 * Cleans inline styles after animation completes.
 * ──────────────────────────────── */

/**
 * Reveal cards with staggered entrance animation
 * @param {string} selector — CSS selector for cards
 * @param {number} delay — initial delay in ms
 */
function revealCards(selector, delay) {
    const els = document.querySelectorAll(selector);
    if (!els.length) return;

    // Set initial hidden state without forcing reflow
    els.forEach(el => {
        el.style.transition = 'none';
        el.style.opacity = '0';
        el.style.transform = 'translateY(24px) scale(0.97)';
    });

    // Single rAF to batch the reflow, then apply transitions
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            els.forEach((el, i) => {
                el.style.transition = `opacity 0.5s cubic-bezier(0.22,1,0.36,1) ${delay + i * 60}ms, transform 0.5s cubic-bezier(0.22,1,0.36,1) ${delay + i * 60}ms`;
                el.style.opacity = '1';
                el.style.transform = 'translateY(0) scale(1)';
            });
        });
    });

    // Clean inline styles after all animations done
    const totalTime = delay + els.length * 60 + 600;
    setTimeout(() => {
        els.forEach(el => {
            el.style.opacity = '';
            el.style.transform = '';
            el.style.transition = '';
        });
    }, totalTime);
}

/* ────────────────────────────────
 * § 3D TILT (pure JS/CSS — no library)
 * Lightweight 3D perspective tilt on hover for cards and portrait.
 * Uses CSS transform: perspective + rotateX/Y. Skipped on touch.
 * ──────────────────────────────── */

/** Apply 3D tilt effect to an element */
// Shared "mobile-ish" matcher: coarse pointer OR narrow viewport.
// Kept in sync so a desktop window narrowed past the breakpoint
// behaves the same as a real phone (no tilt, no magic cursor, etc).
const _tiltMQ = window.matchMedia('(pointer: coarse), (max-width: 640px)');
_tiltMQ.addEventListener('change', () => {
    if (!_tiltMQ.matches) return;
    document.querySelectorAll('[data-tilt-bound]').forEach(el => {
        el.style.transform = '';
    });
});

function applyTilt(el, maxDeg, scale) {
    if (el._tiltBound) return;
    el._tiltBound = true;
    el.dataset.tiltBound = '1';
    el.style.transformStyle = 'preserve-3d';
    el.style.transition = 'transform 0.2s ease';

    el.addEventListener('mousemove', (e) => {
        if (_tiltMQ.matches) return;
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const rotY = (x - 0.5) * maxDeg * 2;
        const rotX = (0.5 - y) * maxDeg * 2;
        el.style.transform = `perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale})`;
    });

    el.addEventListener('mouseleave', () => {
        el.style.transform = 'perspective(600px) rotateX(0) rotateY(0) scale(1)';
    });
}

/** Initialize 3D tilt hover effect on card elements */
function initTilt() {
    if (_tiltMQ.matches) return;

    document.querySelectorAll('.interest-card, .link-card').forEach(el => {
        applyTilt(el, 5, 1.02);
    });

    document.querySelectorAll('.project-card:not(.project-card--loading):not(.project-card--error)').forEach(el => {
        applyTilt(el, 3, 1.01);
    });

    const portrait = document.querySelector('.portrait-img-wrap');
    if (portrait) applyTilt(portrait, 6, 1.03);
}

/* ────────────────────────────────
 * § LIVE SECTION
 * Multi-platform live streaming embed with Twitch, Kick, and
 * YouTube tabs. Switches player and chat iframes on tab click.
 * ──────────────────────────────── */

/** Platform configuration for live embeds */
const LIVE_PLATFORMS = {
    twitch: {
        player: (channel) => `https://player.twitch.tv/?channel=${channel}&parent=${location.hostname}&muted=true`,
        chat: (channel) => `https://www.twitch.tv/embed/${channel}/chat?parent=${location.hostname}&darkpopout`,
        channel: 'aruta.sh'
    },
    kick: {
        player: (channel) => `https://player.kick.com/${channel}`,
        chat: (channel) => `https://kick.com/${channel}/chatroom`,
        channel: 'aruta_sh'
    },
    youtube: {
        player: (channel) => `https://www.youtube.com/embed/live_stream?channel=${channel}&autoplay=1&mute=1`,
        chat: (channel) => `https://www.youtube.com/live_chat?v=live_stream&embed_domain=${location.hostname}`,
        channel: 'UC_CHANNEL_ID'
    }
};

/** Initialize live section platform tabs and iframe switching */
function initLiveSection() {
    const tabs = document.querySelectorAll('.live-tab');
    const playerEl = document.getElementById('live-player');
    const chatEl = document.getElementById('live-chat');

    if (!tabs.length || !playerEl || !chatEl) return;

    function switchPlatform(platform) {
        const config = LIVE_PLATFORMS[platform];
        if (!config) return;

        tabs.forEach(t => t.classList.toggle('active', t.dataset.platform === platform));

        playerEl.innerHTML = `<iframe
            src="${config.player(config.channel)}"
            allowfullscreen
            allow="autoplay"
            title="${platform} player"
        ></iframe>`;

        chatEl.innerHTML = `<iframe
            src="${config.chat(config.channel)}"
            title="${platform} chat"
        ></iframe>`;
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchPlatform(tab.dataset.platform));
    });

    // Placeholder — iframes load lazily when Live window opens (see os.js openWindow)
    if (playerEl) playerEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-style:italic;font-family:inherit;">Select a platform above</div>';
    if (chatEl) chatEl.innerHTML = '';
    window._liveLoaded = false;
}

/* ────────────────────────────────
 * § STREAM COUNTDOWN
 * Counts down to the next scheduled stream based on a weekly
 * schedule (Tue 21:00, Thu 21:00, Sat 16:00 CET).
 * Updates every second.
 * ──────────────────────────────── */

/** Initialize the stream countdown timer */
function initCountdown() {
    const el = document.getElementById('live-countdown');
    if (!el) return;

    // Schedule: Tue 21:00, Thu 21:00, Sat 16:00 (CET = UTC+1, CEST = UTC+2)
    const SCHEDULE = [
        { day: 2, hour: 21, min: 0 },  // Tuesday
        { day: 4, hour: 21, min: 0 },  // Thursday
        { day: 6, hour: 16, min: 0 },  // Saturday
    ];

    /** Find the next upcoming stream time */
    function getNextStream() {
        const now = new Date();
        const candidates = [];
        for (let weekOffset = 0; weekOffset < 2; weekOffset++) {
            for (const s of SCHEDULE) {
                const d = new Date(now);
                d.setDate(d.getDate() + ((s.day - d.getDay() + 7) % 7) + weekOffset * 7);
                d.setHours(s.hour, s.min, 0, 0);
                if (d > now) candidates.push(d);
            }
        }
        candidates.sort((a, b) => a - b);
        return candidates[0] || null;
    }

    function update() {
        const next = getNextStream();
        if (!next) { el.textContent = ''; return; }
        const diff = next - Date.now();
        if (diff <= 0) { el.textContent = '\u2726 NOW \u2726'; return; }
        const days = Math.floor(diff / 86400000);
        const hrs  = Math.floor((diff % 86400000) / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);

        let text = '';
        if (days > 0) text += `${days}d `;
        text += `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
        el.textContent = text;
    }

    update();
    setInterval(update, 1000);
}
