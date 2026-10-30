# World streaming on large battlefields

This report covers the audit and the changes made to loading the 4 km battlefields. The largest
battlefield is the battle royale island (128 × 128 chunks of 32 m), which warfare plays too.

**Priority:** stable memory first, then seamless streaming, then visual quality, then maximum detail.

## 1. Architecture

```
            SERVER (authoritative)                                     CLIENT (render only)
 ┌───────────────────────────────────────────┐            ┌─────────────────────────────────────────┐
 │ WorldService (per map)                    │            │ chunk store  (cells held, per LOD)      │
 │  LRU cache ── baked on disk ── workers    │            │   │                                     │
 │  (Loaded/Cached)  (Baked)     (Loading)   │  chunks    │   ├─ build queue  (≤ budget ms / frame) │
 │        ▲                                  │ ─────────▶ │   │      │                              │
 │ ChunkStreamer (per player)                │  unload    │   │      ▼                              │
 │  rings LOD0 ≤3 · LOD1 ≤7 · LOD2 ≤14 cells │ ─────────▶ │   │   meshes (Active, GPU-only buffers) │
 │  ≤ 6 chunks & 128 KB per tick             │            │   ├─ props: instanced, distance-culled  │
 │  pauses under socket backpressure         │            │   └─ vegetation: instanced, LOD'd       │
 │ PhysicsChunkManager (collision, LOD0)     │            │ far models (flat-shaded far LOD)        │
 └───────────────────────────────────────────┘            └─────────────────────────────────────────┘
```

### Cell lifecycle

| State | Where | What it is |
|---|---|---|
| Unloaded | — | Not generated, not held. |
| Loading | server worker queue (4 priorities, bounded at 20 000) | Being generated, or read from the bake. |
| Cached | server LRU (`CHUNK_CACHE_SIZE`) and **disk bake (new)** | Generated once, served to every player without regenerating. |
| Loaded | client chunk store | Its data has arrived, within the player's rings. |
| Active | client mesh | Built within the frame budget, nearest first. Vertex buffers live on the GPU only (new). |
| Unloading | server unload message | The client removes it and disposes its geometry. |

- **Gameplay authority:** the server's own collision is never evicted on fixed maps.
- **Bounded:** what a client holds is the rings round the player (rings 3, 7 and 14 chunks), never the whole map.

## 2. Measurements

Measured on real chunks of the 4 km island: `STREAMING_BENCH=1 vitest run apps/web/src/game/world/streaming-budget.test.ts`.

**One chunk, by level of detail:**

| LOD | Data | Mesh (vertex + index) | Props | Generation |
|---|---|---|---|---|
| 0 (≤ 96 m) | 9.1 KB | 89 KB | 8 | **113 ms** |
| 1 (≤ 224 m) | 2.7 KB | 25.6 KB | 8 | 4.2 ms |
| 2 (≤ 450 m) | 1.0 KB | 8.2 KB | 8 | 1.7 ms |

**A vehicle crossing the island at 25 m/s (3 km in 2 minutes):**

| | Measured |
|---|---|
| Chunks held at peak | 75 LOD0 + 208 LOD1 + 672 LOD2 = **955** (bounded whatever the distance) |
| Terrain RAM at peak | **1.9 MB** data + **17.1 MB** mesh |
| Chunk deliveries | 10 063 (up to 841 in the first second) |
| Detailed chunks generated | 907 × 113 ms ≈ **102 s of worker time in 120 s** |
| Whole map, LOD2 everywhere | 147 MB |
| Whole map, LOD0 everywhere | **1 570 MB** |

### Findings

1. **Loading the whole battlefield into the client cannot fit on a weak PC.** At full detail it
   is 1.6 GB of terrain alone. Generating it on the client was tried and reverted: its generator
   (hydrology for the whole island) ran players out of RAM.
2. **What a client holds while streaming is small and bounded** (about 19 MB of terrain). Client
   terrain is not where the memory goes.
3. **The real bottleneck was the server.** A detailed chunk costs 113 ms to generate, and
   battlefields have one generator worker. A fast vehicle needs about one second of generation per
   1.3 s driven, so the worker saturates, terrain arrives late (gaps) and the queue backs up.
4. **Churn.** Each chunk is delivered at several levels of detail as the player approaches and
   leaves it. A 3-chunk downgrade hysteresis would remove only about 9% of deliveries, and
   look-ahead centring did not reduce them. Neither is worth its cost compared with item 3.

## 3. Implemented

- **Baked fixed maps** (`WorldService.bakeTo` and `bake`, `CHUNK_BAKE_DIR`, default `data/chunk-bake`).
  - Every generated chunk of a battlefield is written to disk as its deflated wire body. It is
    read back in under a millisecond instead of being regenerated. This survives restarts.
  - A background bake fills the whole map, every LOD:
    - one chunk at a time;
    - only while nothing is queued or generating, so it never competes with play;
    - chunks already baked are skipped.
  - Once baked, a detailed chunk costs a file read and an inflate instead of 113 ms of a worker.
  - The disk cost is roughly a few KB per chunk per LOD, about 100 MB for a 4 km map. Each world
    has its own directory, named by its generator configuration and version, so an edited map
    bakes afresh.
  - Covered by `apps/server/src/world/world-bake.test.ts`.
- **GPU-only terrain buffers** (`gpuOnly` in the engine). Once a chunk's terrain or water mesh is
  uploaded, the JavaScript copy of its vertices is released (the three.js `onUpload` pattern). This
  saves about 90 KB of RAM per detailed chunk, up to 17 MB at the measured peak.
- **Telemetry** (F3 panel): chunks held per LOD, meshes built, and chunks waiting to be built,
  next to the frame-time and heap figures already there.
- **Kept from before:**
  - the server-driven rings, the per-tick send budget and backpressure;
  - the client's per-frame build budget, nearest first;
  - instanced and distance-culled props, and instanced vegetation;
  - off-screen characters not posed;
  - collision not evicted on fixed maps.
- **Reverted:** client-side generation of the whole map (out of memory on 8 GB machines).

## 4. Not done yet

- **HLOD beyond 450 m.** A single low-resolution mesh of the whole island would fill the
  horizon. Built from LOD2 it is about 147 MB, so it needs its own coarser source (an 8–16 m
  grid) to fit a weak PC.
- **Texture streaming and GPU-compressed textures** (KTX2, Basis).
- **Client RAM and VRAM budgets** that drop the farthest cells under pressure. The rings bound
  memory today; the budgets would bound it on any map size.
- **In-game stress test.** The figures above come from the benchmark on real generated chunks.
  The test on the live map with a weak PC, long sessions and repeated crossings still has to be run.
