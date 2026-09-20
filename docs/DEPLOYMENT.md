# Deployment

## GitHub Pages

The public website is deployed from `main` by `.github/workflows/pages.yml`.
The deployment builds all five standalone packages, runs the Node tests, creates
package archives and the source ZIP, verifies local website links, and deploys
`dist/` using the official GitHub Pages actions. All browser links are relative,
so the website and editor work under the `/StratumFX/` project path.

- Website: https://wieslawsoltes.github.io/StratumFX/
- Editor: https://wieslawsoltes.github.io/StratumFX/app/
- Guide: https://wieslawsoltes.github.io/StratumFX/docs/guide.html
- Standalone HTML: https://wieslawsoltes.github.io/StratumFX/StratumFX.html

The workflow can also be run manually from the repository Actions tab. The
repository Pages source must be **GitHub Actions**. Build and package outputs
are generated from source rather than committed to the main branch.

## Local production build

Use Node.js 22.13+ and Python 3.11+ for release tooling. No runtime npm dependencies
are required. From the repository root:

```sh
npm run check
npm test
npm run pack:all
python3 scripts/release.py --site-download
python3 scripts/verify-site.py
```

`npm test` first rebuilds the reusable packages and standalone app. Serve `dist/`
with any static HTTPS host; the Python verification script validates local
navigation, stylesheets, images, examples and package/source download targets.

For browser smoke checks (development dependencies only):

```sh
python3 -m pip install playwright==1.57.0
python3 -m playwright install --with-deps chromium
STRATUM_INLINE_TEST=1 STRATUM_TEST_SOFTWARE=1 python3 tests/browser-smoke.py
STRATUM_TEST_SOFTWARE=1 python3 tests/examples-smoke.py
```

Set `CHROMIUM_PATH` to use a system Chromium installation. Otherwise the tests
use `/usr/bin/chromium` when present or Playwright's bundled Chromium. Software
browser checks do not qualify native GPU drivers or physical-GPU performance.

## Accounts and collaboration

GitHub Pages serves static files only. Local projects, graph editing and rendering
work there, but accounts, invitations and live collaboration do not. The app
explains this when its collaboration dialog is opened without a backend.

Run `node server/index.js` and open the same server's `/app/` route for team
projects. The server persists data in `.data/stratum.sqlite`; provide a private,
persistent disk, HTTPS reverse proxy and a backup/restore policy. Review
`.env.example`, `compose.yml` and `docs/SECURITY.md` before exposing it publicly.
No database, password, session, API key or real user data is committed or included
in release downloads. Do not place `.data/`, `.env` or backups in a public host.

The checked-in Docker and Compose files are deployment templates; their presence
does not establish production security or native-GPU qualification.
