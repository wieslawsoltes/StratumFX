# Standalone API

The declarations in `packages/*/types/index.d.ts` are the detailed public surface. APIs are version 0.1.0 and not a Houdini Engine compatibility layer. The built ESM/global bundles include dependencies and can ship separately from the app.

## Geometry and viewport

```js
import { sphere } from './packages/geometry/dist/index.js';
import { Viewport } from './packages/renderer/dist/index.js';

const viewport = await new Viewport(document.querySelector('canvas')).init();
viewport.setMesh(sphere(1, 48, 24));
viewport.frame();
viewport.addEventListener('pick', event => console.log(event.detail));
viewport.addEventListener('error', event => console.error(event.detail));
// At component unmount:
// viewport.destroy();
```

The canvas needs nonzero CSS width/height and a parent with known size. `Viewport` may replace the original canvas when falling back between graphics APIs; use `viewport.canvas` afterward. Renderer creation is asynchronous. `viewport.renderer.kind` identifies the actual backend. `snapshot()` returns a PNG Blob of the current viewport, not an offline renderer result.

`Mesh` buffers are mutable, but cooking/cache consumers should treat outputs as immutable. Clone before mutation. `transform`, `deform`, `merge`, `copyToPoints` and `realize` return meshes. Limits and interchange semantics are specified in SCOPE.md.

## Registry extension

```js
import { createRegistry, createDocument, createNode, Engine } from './packages/core/dist/index.js';
import { box } from './packages/geometry/dist/index.js';

const registry = createRegistry();
registry.register('studio_block', {
  label: 'Studio block', category: 'Custom', inputs: 0,
  params: {size: {type: 'number', label: 'Size', default: 2, min: 0.1, max: 10, step: 0.1}},
  cook(p) { return box([p.size, p.size, p.size]); }
});
const scene = createDocument('Custom operator');
const block = createNode('studio_block', {}, registry);
scene.nodes.push(block); scene.outputId = block.id;
const result = new Engine(registry).cook(scene, 1);
```

A custom definition receives evaluated parameters, cooked input meshes and `{frame,time,state,engine}`. Mark `timeDependent: true` (or a predicate) when the cook depends on time independently of expression/keyframe-evaluated parameters. Definitions are code, not JSON project assets: register them in each execution environment, worker and validating server that needs them. The shipping studio/server registry does not dynamically import untrusted plug-ins.

## Store and operations

```js
import { GraphStore, createDocument, createNode } from './packages/core/dist/index.js';
const store = new GraphStore(createDocument('Example'));
const node = createNode('box');
store.commit([{kind:'add', node}, {kind:'output', nodeId:node.id}], 'Create box');
store.commit([{kind:'param', nodeId:node.id, key:'size', value:[3,1,1]}], 'Resize');
store.undo(); store.redo();
store.addEventListener('change', e => console.log(e.detail, store.document));
```

Operation kinds: `add`, `remove`, `param`, `field`, `connect`, `output`, `title`, `timeline`, `keys`. Validate full documents with `validateDocument` before accepting external data. An invalid operation batch leaves the input document unchanged. `replace(document, false)` starts a new local history; remote replace preserves history for compensating undo. Graph positions/selection do not form geometry.

Numeric expressions start with `=` in parameter values. Variables include `f`/`$F` (frame), `t`/`$T` (seconds); wrangle also uses x/y/z/i. Arithmetic, comparisons, ternaries and a bounded math/noise function set are supported. There is no access to browser globals, object properties, arbitrary functions or scripts. Expressions are capped at 1024 characters, 256 tokens and nesting depth 32. Scalar keyframes use linear or step interpolation.

## Custom elements

Import `packages/controls/dist/index.js` once. It registers:

```html
<stratum-node-editor></stratum-node-editor>
<stratum-parameter-editor></stratum-parameter-editor>
<stratum-timeline></stratum-timeline>
```

Assign the graph document, registry and selection to the node editor and call `draw()` after changes. Parameter editor uses `setData(node, definition, frame, evaluatedValues)` and `isOutput`. Timeline uses `configure({start,end,fps,frame,keys})`.

Controls dispatch bubbling custom events. The working `examples/controls.html` shows exact wiring for operations, selection, parameters, output flags, bypass and time. Controls do not silently mutate a remote backend or know about the studio. Give each host a defined layout size. CSS custom properties offer theming; the shipping studio adds layout around these controls.

## Browser-global bundles

```html
<script src="packages/core/dist/standalone.js"></script>
<script>
(async () => {
  const Core = await StratumCoreReady;
  console.log(Core.createDocument('Global example'));
})();
</script>
```

The five readiness promises are `StratumGeometryReady`, `StratumCoreReady`, `StratumRendererReady`, `StratumControlsReady`, and `StratumCollaborationReady`. The matching globals without `Ready` are set on successful initialization. Do not assume an async global bundle is ready immediately after its script element loads.

## Worker

`packages/core/dist/worker.js` is self-contained. It implements the same message protocol used by `app/cook-service.js`; inspect that small adapter for job correlation, cloning/transfer behavior and error handling. The application keeps worker cooking separate from parameter controls and rendering. There is no SharedArrayBuffer dependency.

## Collaboration and local storage

```js
import { CollaborationClient, ProjectDatabase } from './packages/collaboration/dist/index.js';
const local = new ProjectDatabase('my-studio');
await local.save(store.document);
const team = new CollaborationClient(store); // same-origin /api
await team.login('your-account', 'your-password');
await team.connect('an-existing-project-id');
team.addEventListener('presence', e => console.log(e.detail));
// team.destroy() when the host is disposed
```

Use registration/project/invitation APIs or the studio to obtain real IDs; the strings above are placeholders, not accounts. The backend source is included separately; bundling the client does not provide a server. The client depends on fetch, EventSource and storage-enabled browser APIs. Cookies are handled by the browser. Public protocol routes and security constraints are visible in `server/index.js` and exercised by `tests/server.test.js`.
