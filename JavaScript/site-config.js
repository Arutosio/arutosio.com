/* ╔══════════════════════════════════════════════════════════╗
 * ║  SITE CONFIG — Per-site branding and default backgrounds. ║
 * ║  This is arutosio.com's own copy; aruta.sh's              ║
 * ║  tools/sync-arutosio.sh never touches it. Loaded before   ║
 * ║  appearance.js.                                            ║
 * ╚══════════════════════════════════════════════════════════╝ */
window.SITE_CONFIG = {
    name: 'Arutosio',
    backgrounds: {
        // Defaults used until the user picks their own in Settings → Appearance.
        mode: 'time',       // 'interval' | 'time'
        intervalMin: 10,    // minutes between backgrounds in interval mode
        items: [
            { src: './Backgrounds/Toaru-Kagaku-no-Railgun.webm',     kind: 'video', slot: 'dawn' },
            { src: './Backgrounds/Toaru-Majutsu-no-Index2.webm',     kind: 'video', slot: 'noon' },
            { src: './Backgrounds/Toaru-Majutsu-no-Index1.webm',     kind: 'video', slot: 'sunset' },
            { src: './Backgrounds/Toaru-Kagaku-no-Accelerator.webm', kind: 'video', slot: 'night' },
        ],
    },
    // Per-site defaults for Settings → Performance toggles. The user's own
    // choice in Settings always wins. Keep the desktop clean over the videos.
    effects: {
        'settings-hero': false,     // center portrait + magic circle
        'settings-bgrings': false,  // background rings
        'settings-intro': false,    // summoning screen + flying letters
    },
};
