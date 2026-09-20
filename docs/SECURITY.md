# Security and deployment

## Status

This is a development release, not an audited enterprise service. Test with non-sensitive assets until the application, dependencies/runtime, deployment and workflows are reviewed for your threat model. Password login and project roles are implemented; SSO/MFA, recovery, abuse administration and compliance controls are not.

## Existing protections

Passwords are salted and derived using scrypt. Sessions use randomly generated opaque tokens whose hashes are stored in SQLite. Cookies are HttpOnly, SameSite=Strict, and Secure when `NODE_ENV=production`. Mutating endpoints validate the request origin. Membership/role checks apply to every project endpoint and SSE session/membership is rechecked on heartbeats. Operations are validated as atomic graph batches with finite/size/schema checks. The expression parser does not use `eval`, `Function` or property access. HTML-rendered user fields are escaped in controls. Uploaded OBJ text is parsed as data, not executable script.

The backend limits JSON bodies to 4 MB and applies in-memory per-IP rate limits. Static routes use a directory allowlist and reject path traversal; database/server files are not static content. SSE backpressure and connection limits keep individual connections bounded. These measures are not substitutes for security review, WAF/proxy limits, deployment patching or adversarial testing.

## Local deployment

```sh
node server/index.js
# Defaults: HOST=127.0.0.1 PORT=4173 DATA_DIR=<repo>/.data
```

The environment file is not loaded automatically. Use your platform's environment configuration. `HOST=0.0.0.0` exposes the service to other hosts and should only be used intentionally with appropriate network controls.

## HTTPS production deployment template

Run one Node process with a persistent private volume. Place it behind an HTTPS reverse proxy and set:

```
HOST=0.0.0.0
PORT=4173
DATA_DIR=/private/persistent/stratum
NODE_ENV=production
ALLOWED_ORIGIN=https://your-actual-studio-domain.example
```

Replace the example origin with the exact external origin, without a trailing slash. The Secure cookie cannot be used over an ordinary non-HTTPS external origin. Keep the application and API on the same origin; cross-origin authenticated deployment is not a supported release workflow.

For `/api/projects/*/events`, disable proxy response buffering, allow long-lived connections and preserve `text/event-stream`. Allow normal request timeouts for JSON endpoints and set appropriate limits. The server's rate limiting uses the direct socket IP and does not trust arbitrary X-Forwarded-For headers; a reverse proxy can therefore make users share one limit. Configure deployment-level protections accordingly. Do not run multiple application replicas without implementing shared presence/event delivery and reviewing SQLite topology.

The Docker/Compose files are templates, not an executed deployment test. Production should pin and regularly patch a supported Node runtime/container image rather than relying indefinitely on the original tested minor version.

## Backups

```sh
node scripts/backup.js backups/manual.sqlite
```

This performs SQLite `VACUUM INTO` for a consistent backup. Set `DATA_DIR` when the live database is elsewhere. The destination must not already exist. Store backups privately/encrypted according to your deployment requirements. For restore, stop the server, archive the old database and WAL/SHM files, replace `stratum.sqlite` with a validated backup, then restart and verify. No automated retention, encryption key management or restore administrator UI is included. Test your backup and restoration procedures before relying on them.

## Known limitations

Session revocation is supported by logout; account/password recovery, MFA, email verification and invitation revocation UI are absent. Invitation codes expire after seven days but can be reused while valid. There is no per-organization separation, IP reputation service, distributed rate limiter or comprehensive account lifecycle administration. The operation log is not a tamper-evident compliance audit. Initial owners cannot be demoted by ordinary member updates. Rendering and cooking are client-side and can consume significant CPU/GPU resources on deliberately expensive documents despite input budgets.

Projects can contain inline geometry. Exported JSON, browser storage, source packages, and screenshots may reveal project data; handle them accordingly. Never upload `.data/`, database backups, session values, invitation codes or a real `.env` file to public static hosting or repositories.

## Reporting

No hosted issue tracker or security contact has been published with this source delivery. Coordinate disclosure privately with the operator of your deployed instance; do not publish exploitable user/project data in a public report.
