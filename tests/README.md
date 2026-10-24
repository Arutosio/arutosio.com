# End-to-end checks

`e2e.mjs` starts a throwaway `arutosiod`, opens the site in headless Chromium
and checks the Files and Grimoire packages: file icons, search, folder-first
sorting, drag-to-move, OS drop upload, Files → Grimoire handoff, and the
Markdown preview.

```sh
# build the daemon first (release build is fine too)
(cd server && go build -o arutosiod .)

npm i playwright-core
node tests/e2e.mjs
```

Environment:

- `ARUTOSIOD` — daemon binary (default `server/arutosiod`).
- `CHROME_PATH` — Chrome/Chromium binary. Defaults to the newest
  `~/.cache/ms-playwright/chromium-*` download; run `npx playwright install
  chromium` if none is present.
- `NODE_PATH` — point it at a `node_modules` that has `playwright-core` when
  the package is installed outside the repo.

The script creates its own temp root and data directory, so it never touches
real files. It prints one line per check and exits non-zero if any failed.
