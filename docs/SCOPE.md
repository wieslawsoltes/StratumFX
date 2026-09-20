# Scope and compatibility — 0.1.0

This is an independently implemented procedural browser studio. “Implemented” is not a claim of commercial feature parity, certification or production readiness.

## Operators

| Category | Registered operator identifiers |
| --- | --- |
| Sources | `box`, `sphere`, `grid`, `torus`, `cylinder`, `helix`, `terrain`, `obj` |
| Geometry | `transform`, `noise`, `twist`, `taper`, `subdivide`, `smooth`, `normals`, `realize` |
| Assembly / attributes | `color`, `scatter`, `copy`, `merge`, `switch`, `wrangle` |
| Output / pass-through | `output`, `null` |
| Simulation | `particles`, `cloth`, `rigid` |

Subdivision is **linear triangle refinement**, not Catmull–Clark or a production subdivision-surface implementation. Smoothing is Laplacian. Terrain is a procedural mesh heightfield, not a tiled terrain system. Wrangle evaluates constrained scalar mathematical expressions per point; it is not VEX and cannot execute arbitrary code. Copy preserves a single source mesh with instance matrices/colors; realize expands those instances subject to budgets.

## Geometry, files and material limitations

Geometry is triangular and in-memory. Colors/normals/UVs have explicit typed buffers. Arbitrary `attributes` metadata exists, but operators do not guarantee arbitrary attribute interpolation/preservation. Merge uses one material rather than a complete multi-material topology. No selection groups, editable UV islands, texture painting, image-texture maps, mesh Boolean/NURBS or robust CAD topology kernel are supplied.

OBJ import supports positions, optional UVs/normals, positive/negative face indices and fan triangulation of polygons. It does not load MTL, textures, external resources, multiple named scene objects, or guarantee concave polygon tessellation. OBJ/STL export realizes instances. STL has no colors or materials. PNG is a viewport capture, not an offline/high-resolution physical render. Native JSON stores the graph and inline OBJ content, not arbitrary GPU state or a commercial scene format.

## Render paths

| Capability | WebGPU implementation | WebGL2 implementation | Software fallback |
| --- | --- | --- | --- |
| Actual geometry / instances | GPU indexed/instanced draw | GPU indexed/instanced draw | CPU-transformed/rasterized triangles |
| Lighting | GGX/Schlick-based analytic lighting and approximate studio ambient | Simplified GGX analytic lighting | Approximate vertex lighting; not PBR parity |
| Shadowing | 1536×1536 directional depth map with PCF | No shadow map | Planar projected shadows; not self-shadowing |
| Anti-aliasing | 4× MSAA | Context-dependent default framebuffer | Internal resolution capped; no MSAA parity |
| Picking | CPU object-space BVH and per-instance transforms | Same | Same |
| Release browser execution | **Not available / not qualified** | **Not available / not qualified** | **Executed in Chromium** |

No path tracing, ray-tracing API pipeline, physically calibrated HDR environment workflow, spectral rendering, material node shader compiler, texture streaming, LOD/occlusion-culling system, USD stage or render-farm scheduling is included. Device loss is surfaced; automatic GPU device reconstruction is not implemented. Driver limits and large-scene memory/performance require separate testing.

## Simulation limits

Particles are deterministic ballistic trajectories with a simple first bounce/floor treatment; they do not interact as a fluid. Cloth is a small CPU position-based constraint model with pinned top corners, wind, floor and a fixed sphere. Rigid Rain simulates equal-mass spheres with a fixed-step, discrete spatial-hash collision model. It does not implement arbitrary polyhedral bodies, joints, continuous collision detection or robust stacking certification.

A backwards seek resets/replays state deterministically. Cloth simulation time is capped at **15 seconds (900 steps)**; rigid simulation at **20 seconds (2400 steps)**. Beyond the cap, those simulations remain at the capped state. These are bounded demonstrations, not complete DOP/Vellum/Pyro/FLIP/MPM replacements.

## Explicit safety/performance budgets

- 500 nodes per document; 1,000 operations per submitted batch; 2,000 keys per animated channel.
- 1,500,000 realized vertices and 20,000 instances; some individual operator schema limits are lower.
- Approximate graph-cache buffer budget 192 MiB; this is not a hard cap on process memory or GPU allocations.
- Local OBJ text limit 24 MB; collaboration request limit 4 MB. Large inline assets may therefore work locally but be too large for team transfer.
- CPU preview resolution at most 1000×650; GPU drawing caps device pixel ratio at 2.
- Session lifetime seven days, invitation lifetime seven days, at most eight SSE connections per user/project.

There is no established frame-rate guarantee, physical-GPU benchmark, enterprise load test, exhaustive fuzzing, compatibility guarantee for all files, or third-party security audit.

## Collaboration and persistence

Implemented: authenticated memberships, owner/editor/viewer permissions, server-ordered validated batches, optimistic rebasing, SSE presence, deduplication, revision recovery, SQLite persistence, and checkpoints. Not implemented: true CRDT/OT text collaboration, distributed replicas, server render synchronization, comments/chat, asset streaming, branching/version-control merge UI, organizations, SSO/MFA, email delivery, account recovery, backup retention administration, moderation, billing, compliance or multi-region availability. UI camera/selection state is local; only submitted graph operations and limited presence are shared.

## UI compatibility

The studio provides an original node-based DCC layout, linked viewport/network/inspector, geometry spreadsheet and timeline. It is not a pixel-perfect replica of Houdini menus, every pane, every shortcut or docking system. There is no native window manager or plug-in ABI. No proprietary project, shelf, digital-asset or scripting compatibility is claimed.
