# ZION — The Last Light

A multiplayer 3D zombie-survival game for the browser, built as an authoritative-server monorepo.

- **Client:** Next.js, TypeScript, Three.js. It only renders, reads input, predicts the local player and interpolates everyone else.
- **Server:** Node.js and TypeScript. It owns all game state: movement, collision, combat, world streaming and the day/night clock.
- **Data:** PostgreSQL stores accounts, sessions, worlds, player state and the audit log. Redis holds WebSocket tickets and rate limits; you need it once you run more than one instance.
- **Network:** a WebSocket carries gameplay traffic: binary frames for snapshots and chunks, JSON for control messages and events. HTTP serves auth and health checks.

Milestone 1 is a playable prototype. The server builds a deterministic world from a seed and streams it in chunks. The client renders terrain, water, vegetation, props, clouds and a day/night sky. You walk the world with real collision against terrain, trees and rocks, and you can see other players and hit them with melee.

---

## Quick start

Requirements: Node 22 or newer, pnpm 9, and Docker for Postgres and Redis.

```bash
pnpm install
docker compose up -d db redis          # Postgres on 127.0.0.1:5433, Redis on 6379
cp .env.example apps/server/.env       # dev defaults; change JWT_SECRET for anything shared
pnpm dev                               # server :4000 + web :3000 (migrations run on start)
```

Open http://localhost:3000 and click **Play as guest**. Then click into the canvas to capture the mouse.

| Keys | |
|---|---|
| `W A S D` | move (`Shift` sprint, `Space` jump) |
| Mouse | look; `LMB` melee |
| `V` | third/first-person camera |
| `Enter` / `T` | chat |
| `Esc` | release mouse |

To run everything in containers instead, use `docker compose --profile app up --build`.

### Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev` | server (tsx watch) + web (next dev) |
| `pnpm test` | all unit tests (vitest) |
| `pnpm typecheck` / `pnpm lint` | strict TS for every package / ESLint (type-aware) |
| `pnpm check` | typecheck + lint + test |
| `pnpm db:migrate` | apply SQL migrations |
| `pnpm world:preview -- --seed my-seed` | render a top-down PNG of a world + hydrology/biome stats |
| `pnpm assets:build` | validate models in `assets/source`, write the hashed manifest |
| `pnpm --filter @zion/server smoke` | end-to-end test against a running server (auth → WS → stream → move → abuse checks) |
| `pnpm build` | production builds (server bundled with tsup, web as Next standalone) |

---

## Repository layout

```
packages/
  shared/    protocol (zod schemas + binary codecs), chunk format, deterministic hash/RNG, constants
  physics/   collision system: shapes, layers/masks, heightfield, spatial hash, raycasts,
             character controller, hitbox rigs — used by server AND client prediction
  assets/    asset registry (zod-validated definitions), collider builder, bbmodel schema,
             asset pipeline (scripts/build-manifest.ts)
  worldgen/  seed → world: noise, climate, terrain, hydrology (rivers/lakes), biomes,
             surfaces, prop scattering, spawn finding, PNG preview tool
apps/
  server/    Fastify HTTP API, WebSocket gateway, simulation, Postgres repositories, migrations
  web/       Next.js app, Three.js engine (src/game), HUD (src/components)
assets/source/   source models (.glb / .bbmodel) consumed by the asset pipeline
```

Dependency direction: `shared ← physics ← assets ← worldgen ← server`, and `web` depends on `shared`, `physics` and `assets`. **The client never imports `worldgen`.** It cannot generate the world; it only sees what the server streams to it.

---

## Architecture

```
 Browser (presentation only)                         Server (authoritative)
 ┌─────────────────────────────┐   HTTPS (auth)   ┌──────────────────────────────────────┐
 │ Next.js UI ── api.ts ───────┼─────────────────►│ Fastify: helmet, CORS, rate limit,   │
 │                             │                  │ zod validation, JWT + refresh rotate │
 │ GameEngine                  │   WS (ticket)    │ GameGateway: origin/IP/conn limits,  │
 │  input → LocalPlayer ───────┼── input cmds ───►│  heartbeat, msg rate, schema checks  │
 │  (shared CharacterController│                  │ GameServer @30 Hz                    │
 │   + local CollisionWorld)   │◄─ snapshots ─────│  input budget → CharacterController  │
 │  RemoteEntity interpolation │◄─ chunks/unload ─│  combat (lag-comp hitboxes, LOS)     │
 │  Terrain/Water/Sky/Clouds/  │                  │  InterestGrid → per-client snapshots │
 │  Vegetation/Props renderers │                  │  ChunkStreamer (server-driven LOD)   │
 └─────────────────────────────┘                  │  PhysicsChunkManager (only near      │
                                                  │   players) ◄─ WorldService (LRU +    │
                                                  │   worker-thread generator pool)      │
                                                  └───────┬───────────────┬──────────────┘
                                                      PostgreSQL        Redis
```

### Authority model

- Clients send **intent only**: `{seq, mx, mz, yaw, pitch, buttons, rt?}`. The protocol has no field for a position, a velocity, a hit or an inventory change, so the most common cheats cannot be expressed.
- The server runs the same `CharacterController` the client uses for prediction. It runs it against its own collision world, built from the same quantized chunk data. In the normal case, reconciliation produces no visible correction.
- Each player earns **one simulation step per server tick**, with a small burst cap. A client that sends inputs faster than real time (a speed hack) gets no extra movement. The excess inputs queue and are then dropped and flagged.
- Combat is resolved entirely on the server. The attacker's eye position and aim come from server state. Targets are rewound to the client's render time, clamped to 250 ms. The ray is then tested against per-body-part hitboxes and against world geometry for occlusion.

---

## World generation (milestone 1)

Generation is a pure function of `(seed, config, generatorVersion)`. It uses only IEEE-754 basic arithmetic and 32-bit integer hashing: no `Math.random`, and no transcendental functions in generation paths. The same seed reproduces the same world on any machine, in any chunk order, at any LOD. Tests enforce this by hashing chunks generated in different orders by different generator instances.

1. **Continent and climate fields** (`fields.ts`): a domain-warped fBm continentalness value, blended with an island falloff so the map is ringed by ocean. Temperature combines a latitude gradient (cold north, hot south) with noise, minus an altitude lapse rate. Humidity combines noise with a coastal boost and later a boost near water.
2. **Landforms:** a continentalness-to-height spline sets the shelf, beach and gentle inland rise. A broad mask gates ridged-multifractal mountain ranges. Hills are added on top. Swamps flatten low, warm, very wet ground. Deserts grow wind-shaped dunes.
3. **Hydrology** (`hydrology.ts`, a coarse 16 m grid computed once per world):
   - A priority-flood fills depressions. The filled cells become **lakes**, and each lake's surface is its spill height. Oversized basins get a breached outlet, which caps lake size.
   - An ε-filled surface plus D8 steepest descent gives a drainage tree that routes through lakes to the sea.
   - Rainfall-weighted flow accumulation marks **rivers**. Width and depth grow with drainage area, and the water surface strictly decreases downstream.
   - River paths are jittered and smoothed, indexed per chunk, then carved into the fine terrain with a bed and bank profile.
4. **Biomes** come from altitude, slope, temperature and humidity: Ocean, Coast, Plains, Forest, Spruce Forest, Desert, Swamp, Jungle, Mountain, Snow Peaks, River and Lake. **Surface materials** (grass, dry grass, forest floor, sand, sandstone, mud, gravel, rock, snow, seabed) follow from biome and slope.
5. **Props** are scattered on world-aligned grids per placement layer (`decor`, `rocks`, `trees`, `shrubs`). Each grid cell's RNG is keyed by `(seed, cell, layer)`, so props never depend on chunk boundaries or LOD. Rules come from the asset registry: biome densities, slope, altitude, temperature, water clearance, clustering and sink. Settlement layers (cities, roads, farms, bases) plug in ahead of natural scatter and will reserve footprints.

Preview a world with `pnpm world:preview -- --seed zion-alpha`. The default 4 km × 4 km world has hydrology ready in about 0.2 s, and a LOD-0 chunk generates in about 3–5 ms.

### Chunks, LOD and streaming

- A chunk is 32 m × 32 m. LOD 0 has 33×33 vertices at 1 m spacing; LOD 1 uses 2 m spacing and LOD 2 uses 4 m. Every vertex carries a quantized height (1 cm), inland water level, biome, surface, temperature and humidity. A one-vertex border ring gives seamless normals.
- **Server-driven streaming:** the client cannot request chunks, which removes an amplification vector. The server sends what each client needs, nearest first: LOD 0 within 3 chunks, LOD 1 within 7, LOD 2 within 14. It works under a per-tick byte budget, pauses on socket backpressure and sends explicit unloads. Bodies are delta-coded and deflated, cached once and shared by every client.
- **Generation** runs in a worker-thread pool (`WORLDGEN_WORKERS`) behind an LRU cache. The pool has a priority queue: physics-critical chunks first, then LOD 0, 1 and 2.
- **Simulation scope:** the server's collision world only holds LOD-0 chunks within a couple of chunks of some player. A player whose surroundings are not loaded yet is frozen instead of being simulated against missing terrain.

---

## Collision system (`packages/physics`)

Collision is independent of rendering:

- **Shapes:** sphere, capsule, and yaw-rotated box (an AABB when yaw is 0), plus chunked **heightfield** terrain. The renderer uses the heightfield's exact triangulation, so the visible terrain and the collision terrain match.
- **Layers and masks:** `Terrain, Static, Vegetation, Water, Player, Zombie, Projectile, Trigger, Hitbox`. Query masks include `CharacterMovement`, `LineOfSight`, `Weapon`, `Camera` and `Placement`.
- **Queries:** capsule contacts (closest-point tests, alternating projection for boxes, sphere-cover for terrain), an XZ spatial hash broadphase, and raycasts. Raycasts walk the grid with a DDA over terrain cells and broadphase cells, using Möller–Trumbore, slab and capsule intersection tests.
- **Character controller:** collide-and-slide with depenetration, sub-stepping (no tunnelling at any speed), step-up, ground snapping, a slope limit (you cannot climb steep terrain), swimming and wading.
  - Hard guarantees: the player never ends a tick below the heightfield (no terrain clipping), never inside solid geometry (the move is rolled back), and never outside the world bounds.
  - Repeated rollbacks trigger a server-side unstuck that searches for a free spot.
- **Spawn validation:** a spawn point must be on loaded terrain, inside the bounds, on a walkable slope, no deeper than wading depth in water, with the capsule free of overlap. Blocked candidates are nudged outward in a spiral.
- **Hitboxes:** per-zone rigs (head, torso, arms, legs) with damage multipliers, separate from the movement capsule.
- **Zombie navigation:** server-side incremental A* on a 0.5 m grid, with capsule-clear shortcuts, step/slope/headroom checks and route updates for moving targets or newly blocked paths. Searches share a rotating 512-node budget per tick. Walking routes avoid deep water and unloaded chunks; searches cover the start/goal rectangle plus 18 m, capped at 12,000 visited nodes. This is local, single-surface navigation; if no route is found, mobs stop and retry. Melee requires clear line of sight and vertical reach.

---

## Security

| Area | Implementation |
|---|---|
| Input validation | zod schemas, strict (unknown keys rejected), for HTTP bodies, WS messages and env config. Binary decoders are bounds-checked. |
| Auth | scrypt password hashes (parameters encoded, timing-safe compare, dummy hash for unknown users). Account lockout after repeated failures. HS256 JWT access tokens (15 min), with issuer, audience and algorithm pinned. |
| Sessions | Refresh tokens are 256-bit opaque values, stored as SHA-256 hashes in an httpOnly, SameSite=Strict cookie. They rotate on every use; **reusing an old token revokes the whole token family**. |
| CSRF | Cookie endpoints require the `x-zion-csrf` header, which forces a CORS preflight, plus an origin allowlist check. |
| WebSocket auth | A single-use 30 s ticket (GETDEL in Redis) is sent in the first message, never in the URL. Auth has a 5 s timeout and requires a protocol version match. |
| SQL | Parameterized queries only, including batched `unnest()` upserts. Migrations run under an advisory lock with checksum verification. |
| Headers | `@fastify/helmet` on the API (CSP `default-src 'none'`). Next.js sends CSP, XFO, nosniff, referrer and permissions policies, and HSTS in production. |
| CORS | Exact-origin allowlist with credentials, also enforced on WS upgrades. |
| DDoS (application layer) | HTTP rate limits: global plus per route (auth 10/min, guest 5/min, ticket 20/min), Redis-backed when configured. Body limit 16 KB and request timeouts. On WebSockets: a global connection cap, per-IP connection cap, per-IP upgrade rate, 1 KB max payload, no per-message deflate, a per-connection message token bucket, a strike counter for malformed traffic, ping/pong heartbeat, backpressure (snapshots dropped, then streaming paused, and slow consumers disconnected past 8 MB) and bounded queues everywhere. |
| Anti-replay | Strictly increasing input sequence numbers, single-use tickets and rotating refresh tokens. |
| Anti-cheat | Intent-only protocol, real-time input budget, movement anomaly checks, clamped lag compensation, server-side hit resolution with line of sight, and chat sanitizing (control and bidi characters) with duplicate and spam detection. Weighted suspicion decays over time; crossing the threshold kicks the player and writes a critical audit event. |
| Logging | pino structured JSON with secrets redacted. A batched, bounded, append-only `audit_log` table records register, login, lockout, refresh-token reuse, WS auth failures, kicks and unstuck events. |
| Secrets | Read from the environment only. Placeholder or short `JWT_SECRET` values and `CORS_ORIGINS=*` are refused in production. Containers run as non-root. |

Edge-level protection (TLS termination, volumetric DDoS scrubbing, WAF) still belongs in front of the service: a load balancer or CDN. Set `TRUST_PROXY=true` only behind a trusted proxy.

---

## Operations

For aaPanel deployments, run `pnpm install --frozen-lockfile` then `pnpm build` from the repository root. Restart the service only after the build succeeds. The web postbuild step copies `.next/static` and `public` (including game models) into the standalone app. Set the web process startup file to `apps/web/aapanel-start.mjs`, or use `pnpm --filter @zion/web start`; configure `PORT` and `HOSTNAME=127.0.0.1` to match the reverse proxy. The monorepo server entry is `.next/standalone/apps/web/server.js` inside `apps/web`. Build output is ignored by Git and must be generated or uploaded in full on each deployment. `pnpm --filter @zion/web test:standalone` checks artifact validation and asset preparation.

- `GET /health/live` is a liveness check. `GET /health/ready` checks the database, Redis or the memory store, the worldgen workers and simulation tick p99, and returns 503 when degraded.
- `GET /metrics` returns Prometheus text and requires `Authorization: Bearer $METRICS_TOKEN`. It covers connections, players, tick timing and overruns, bytes out, dropped snapshots, chunk cache and queue, rejected upgrades by reason, and anti-cheat flags and kicks.
- Graceful shutdown on SIGINT/SIGTERM stops accepting connections, notifies and saves players, persists world time, then drains the audit queue, the pools and the workers. It is forced after 15 s.
- The world seed is stored in the `worlds` table the first time the server starts, and the stored seed wins afterwards. `GENERATOR_VERSION` is stored too, so a generator upgrade cannot silently reshape a live map.

## Configuration

`RANDOM_TICK_SPEED` controls wild grass/flower regrowth after explosions or flamethrower fire. The default is `3`; higher values regrow faster and `0` pauses regrowth. Each damaged 1 m cell waits at least 15 seconds and until its fire ends, then regrows on a random server tick (an additional 60 seconds on average at the default speed). Damage is shared by all players and survives chunk unloading and reconnects during the current server session; restarting the server restores wild vegetation.

All variables are documented in [`.env.example`](.env.example). The most important ones are `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `PUBLIC_WS_URL`, `WORLD_SEED`, `WORLD_SIZE_CHUNKS`, `DAY_LENGTH_MINUTES` and `WORLDGEN_WORKERS`. The web app reads `NEXT_PUBLIC_API_URL`.

## Asset pipeline

1. Put `.glb` or `.bbmodel` files under `assets/source/` (lowercase paths).
2. Register an asset in `packages/assets/src/builtin.ts`, or in your own registry module. Give it a **permanent** numeric id, colliders in local space, bounds, render hints and optional placement rules. The registry validates everything with zod and rejects duplicate ids.
3. Run `pnpm assets:build`. It validates the files: GLB structure and size, no external buffers, and the bbmodel schema with embedded PNG textures only. It copies them to `apps/web/public/assets/models/` under content-hashed names and writes `manifest.json`. `pnpm dev` and `pnpm build` run this automatically.
4. The client's `AssetLibrary` loads procedural, Blockbench or GLB models and flattens them into instancing-friendly parts.

The supply crate (`decor.crate.supply`) is a real Blockbench model that exercises the whole path. Prefab definitions (multi-part structures with footprints) are already part of the registry schema, ready for settlement generation.

## Testing

`pnpm test` runs about 90 tests:

- **shared:** codecs, the protocol rejecting malformed and abusive input, and hashing.
- **physics:** geometry, raycasts, wall sliding, anti-tunnelling, step-up, slope limit, no terrain clipping, determinism and hitboxes.
- **worldgen:** determinism, seamless chunk edges, LOD consistency, island border, biome variety, rivers flowing downhill into the sea or lakes, lakes sitting in basins, prop placement and spawns.
- **server:** rate limiters, the input budget against speed hacks, suspicion decay, chat sanitizing, interest grid, LOD rings, lag-compensated melee (rewind window, line of sight), password hashing, JWT tamper, alg=none and audience checks, and config hardening.

`pnpm --filter @zion/server smoke` runs the live end-to-end test.

## Known limitations

- Chunk decoding and mesh building run on the browser main thread under a per-frame time budget. Moving them into a Web Worker is the next client optimization.
- Client prediction matches the server bit for bit for basic arithmetic. `Math.sin`/`cos` (used for the yaw rotation) may differ in the last ulp between JS engines; reconciliation absorbs this invisibly.
- One process simulates one world. To scale out, the natural next step is spatial sharding of the world into server-owned regions with hand-off. The interest grid and chunk-scoped physics are already designed for that.

## Roadmap

1. Settlements: roads, towns, farms, military bases and ruins as seeded placement layers built from prefabs.
2. Multi-level navigation and longer-range routing for zombie hordes.
3. Inventory, loot tables and containers, validated server-side.
4. Survival stats: hunger, thirst and temperature driven by biome and weather.
5. Region sharding and delta-compressed snapshots.
