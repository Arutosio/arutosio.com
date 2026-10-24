# End-to-end checks

`e2e.mjs` starts a throwaway `arutosiod`, opens the site in headless Chromium
and checks the Files and Grimoire packages: file icons, search, folder-first
sorting, drag-to-move, OS drop upload, context-menu placement, the custom
cursor over app frames, the Files settings panel (preview off, hidden files,
start folder, go-to-path, persistence), multi-selection, keyboard shortcuts,
copy/cut/paste across sources (files and folders), favorites, history, grid
thumbnails, subfolder search, type filters, properties, bulk rename, the
conflict dialog, Files → Grimoire handoff, the Markdown preview, find &
replace, the outline, stats, spellcheck and focus mode.

```sh
# build the daemon first (release build is fine too)
(cd server && go build -o arutosiod .)

npm i playwright-core
node tests/e2e.mjs
```

Environment:

- `ARUTOSIOD` — daemon binary (default `server/arutosiod`).
- `ARUTOSIO_WEB` — asset tree to serve (default: the repo root). Point it at
  an extracted release `web/` to test the shipped packages.
- `CHROME_PATH` — Chrome/Chromium binary. Defaults to the newest
  `~/.cache/ms-playwright/chromium-*` download; run `npx playwright install
  chromium` if none is present.
- `NODE_PATH` — point it at a `node_modules` that has `playwright-core` when
  the package is installed outside the repo.

The script creates its own temp root and data directory, so it never touches
real files. It prints one line per check and exits non-zero if any failed.
