# Stratum FX 0.1.0 — release qualification

## Result summary

| Check | Observed result |
| --- | --- |
| Node test runner | **110 passed, 0 failed, 0 skipped** (count includes the backend integration parent test) |
| Main studio, actual Chromium interactions | **27 checks passed, 0 page errors** |
| Independent package examples, website and guide | **12 checks passed, 0 page errors** |
| JavaScript syntax | All authored JavaScript source files passed `node --check` |
| Type declarations | All five package declaration entry points passed `tsc --noEmit` with ES2022 + DOM libraries |
| Local package installation | All five `.tgz` archives installed offline; installed headless exports and geometry cooking passed |
| Backup utility | A real SQLite `VACUUM INTO` smoke test preserved fixture data |
| Independent package build | Five self-contained ESM + browser-global libraries, core worker, and one-file HTML application built |
| Rendering backend executed in browser checks | **Software preview** only |

Runtime used: **Node 22.16.0**, Python 3.13, installed Python Playwright and system Chromium. This is functional development qualification, not commercial feature parity, certification or a performance/SLA guarantee.

## Actual coverage

The Node suite exercises vector/matrix math, typed buffers, finite/integer data validation, primitive generation, transforms and realization, subdivision/smoothing, seeded scattering, instance budgets, OBJ parsing/export, STL encoding, BVH picking, deterministic bounded cloth/rigid/particle behavior, expressions, parser limits, DAG cycle/input validation, transactional operations, undo/redo, animation, time/FPS cache invalidation, all 27 registered operators and the seven scene studies.

Package tests exercise cross-bundle geometry/core interoperability, browser-global readiness semantics, public build/declaration files and a dependency-free package manifest. Collaboration state tests deliberately mock asynchronous responses to reproduce project-switch/disconnect races and viewer rollback. These mocks are not represented as transport qualification.

The backend suite starts real Node servers with temporary SQLite databases and actual loopback HTTP/SSE connections. It covers registration/login/cookies, authentication failure, invitation/membership access, owner/editor/viewer enforcement, concurrent independent edits, live SSE delivery/presence, operation deduplication, invalid batch rollback, checkpoints and restore, membership updates/audit access, process restart persistence, logout invalidation, malformed input and static route protections. Temporary test databases are removed.

The 27 main-app browser checks operate on real UI controls: worker cooking, actual nonuniform rendered pixels, scene-tree selection, parameter changes, keyboard undo/redo, shelf creation, keyframes and evaluated inspector values, Shift-key removal, animation listing, palette auto-wiring, expressions changing geometric bounds, pointer node dragging and port connections, spreadsheet/performance panes, camera and shading changes, theme switching, transform handles, camera orbit, OBJ file import, cloth/timeline output and PNG blob capture.

The 12 independent-example/site checks load the distributed package bundles without the studio runtime, cook/cached-cook geometry, render an instanced field, change shading, edit/undo graph nodes, scrub the timeline, and check desktop layout. The landing page is checked with real screenshot/image assets at 1440px and 390px; the guide is checked at 390px. A mobile package-list overflow was fixed during this process.

## Browser environment boundary

The installed browser has a managed navigation restriction and exposed neither WebGPU nor a working WebGL2 context. Tests therefore load the generated standalone HTML (or inline local example assets) in a document harness rather than navigating to HTTP. No browser security/managed policy was modified. These are actual application execution and interaction tests, not static screenshot comparisons or mocked geometry.

That harness is an opaque, non-secure origin. **IndexedDB/localStorage durability, browser session cookies, browser EventSource reconnection, and multi-user browser-to-browser collaboration were not qualified there.** The application catches blocked-storage errors and keeps manual export available. The backend's actual HTTP/SSE/SQLite behavior is independently tested over loopback as described above.

## Not performed / not established

**Native WebGPU and WebGL2 shader/driver execution has not been tested in this environment.** Their implementations must be qualified on supported browsers and physical GPUs. In particular, no GPU timing, frame-rate guarantee, shader conformance result, memory-pressure benchmark or device-loss recovery qualification is claimed. A wireframe mesh-descriptor issue in the unexecuted WebGL path was corrected during static review; that review does not replace a driver test.

No sustained production concurrency test, complete fuzz campaign, security audit, Windows/macOS/native UI integration, browser compatibility matrix, production asset interchange certification, complete accessibility audit, full IndexedDB integration test, Docker execution, GitHub Actions run, registry publication or public-host deployment was performed. The shipped workflows/container files are templates.

## Reproduce

```sh
npm run check
npm test                  # pretest rebuilds the five packages and application
npm run pack:all
# Optional when a TypeScript compiler is separately installed:
tsc --noEmit --skipLibCheck false --target ES2022 --module ESNext \
  --lib ES2022,DOM packages/*/types/index.d.ts

# Install test-only Playwright separately; it is not a runtime dependency.
# With a normally accessible local server:
node server/index.js
python tests/browser-smoke.py

# Exact restricted-document harness used in this delivery:
STRATUM_INLINE_TEST=1 python tests/browser-smoke.py
python tests/examples-smoke.py
```

Evidence lives in `artifacts/node-tests.txt`, `artifacts/browser-report.json`, `artifacts/examples-report.json`, `artifacts/package-install-check.txt`, `artifacts/backup-check.txt`, logs and actual app/site screenshots. Test results apply to the bounded implementation described in SCOPE.md, not to unimplemented Houdini functionality.
