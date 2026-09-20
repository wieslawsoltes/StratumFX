# @stratum-fx/core · 0.1.0

Validated procedural graph, deterministic cooking, safe expressions and operation-based editing.

MIT licensed. No runtime package dependencies. Written in plain JavaScript; the package includes TypeScript declarations, a self-contained ES module and a browser global bundle. The package does not import the Stratum FX application.

## Install an included archive

```sh
npm install /path/to/stratum-fx-core-0.1.0.tgz
```

Import the named exports from `@stratum-fx/core`. Browser applications may import `dist/index.js` directly from their own static server. Controls and rendering require the DOM; geometry and core also execute under Node 22.13+.

For a classic script, load `dist/standalone.js` and await `globalThis.StratumCoreReady`; the resolved object is also exposed as `globalThis.StratumCore`. Do not assume an asynchronous bundle is initialized until that promise resolves.

## API and examples

The root repository contains `docs/API.md`, `docs/guide.html`, standalone examples in `examples/`, and tests. `types/index.d.ts` documents the public interfaces. Each ES module bundles its internal dependencies, so it can be shipped without the other packages. Mesh interoperability is structural rather than based on a package-specific constructor identity.

## Qualification and boundaries

This is an initial 0.1 release, not a claim of complete Houdini compatibility or production certification. Native WebGPU and WebGL driver paths require hardware/browser qualification. The accompanying test report records the executed software-preview browser checks. No package has been published to npm by this delivery; the archives are ready for local installation and evaluation.
