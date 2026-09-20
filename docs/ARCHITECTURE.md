# Architecture

## Data path

A `GraphStore` owns a version-1 JSON document. All user document changes are validated operation batches. The inspector, node editor and timeline publish DOM events; the application translates them into operations rather than reaching into geometry buffers. History contains compensating operations, not snapshots of GPU resources.

The cooking service sends the current document/frame to a dedicated worker. `Engine` evaluates output dependencies, rejects cycles, evaluates parameter expressions/keyframes and caches each operator by parameters, input versions and relevant time. Nodes receive cloned/evaluated parameters and a persistent per-node simulation state. Worker responses clone/transfer typed-array output buffers; cached worker meshes remain intact. Non-geometric name/layout/title edits do not request a fresh cook in the app.

The viewport consumes a structural mesh contract and is independent of document history, HTTP, custom elements or the studio. It uploads geometry and instance data for the GPU backends. A dirty-frame requestAnimationFrame loop avoids redrawing an idle viewport. Geometry uploads are currently recreated for new outputs; persistent pooled uploads, subrange updates and multi-million-instance scene management remain future work. CPU picking uses median-split triangle BVHs plus instance transforms.

## Mesh contract

Right-handed coordinates; Y up; column-major matrices; rotations in degrees in graph transform parameters. Each mesh has three-float positions/normals/colors, two-float UVs, and uint32 triangle indices. Instances use 20 floats: a column-major 4×4 affine matrix followed by RGBA. A mesh also stores a roughness/metallic pair and optional metadata attributes. `bounds()` includes instance transforms. `realize()` expands instances and recomputes normals within the vertex budget.

The library contracts are structural so independently bundled packages do not depend on one shared JavaScript constructor identity. This is important because each package bundle includes the internal modules it needs. Only `core` and `geometry` are intended for headless Node use; controls require a DOM, renderer needs canvas/DOM, and collaboration persistence needs browser storage.

## Collaboration path

1. A local store commit is appended to a client pending queue, persisted to localStorage when available and optimistically visible.
2. A JSON POST sends an idempotency ID and operation batch. The server checks session, membership and role, validates the whole resulting graph, then atomically persists graph/revision/operation to SQLite.
3. SSE delivers the commit and presence to current members. Clients update the authoritative document and replay unacknowledged operations over it.
4. A revision gap fetches a fresh authoritative snapshot. Retries reuse the batch ID. Epoch guards discard responses from disconnected/switched projects.
5. Rejected batches are reported and retained as local rejected records where storage permits. Same-field edits are server-arrival-wins, not CRDT merges.

Project switching clears local undo history. Undo is a new shared operation and may overwrite a newer remote value in the same field. Browser session/queue persistence needs a normal, storage-enabled same origin. The server is a single process: its in-memory SSE connection map is not a distributed event bus.

## Storage

IndexedDB contains local project documents/checkpoints, not login secrets. SQLite contains users, salted scrypt hashes, hashed session/invitation tokens, memberships, project documents, operation records and checkpoints. WAL mode supports concurrent reads while the server serializes transactional writes. The synchronous SQLite API can block the Node event loop under large workloads; this release is not a high-scale server architecture.

## Packaging

Source uses static named ES modules and platform APIs. `scripts/bundle.js` is a small repository-specific dependency-free bundler. It is not intended to parse arbitrary user JavaScript. Package builds expose ESM plus asynchronous browser globals. The studio build embeds the worker text in a Blob and writes one HTML file. The website still includes ordinary modular app files and independent library examples.

All backend secrets, databases and backup files must stay out of the static deployment root and release archives. Static hosting serves an editor and local database; it does not emulate the Node team backend.
