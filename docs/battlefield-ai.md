# Battlefield AI

Battlefield bots run on the server (authoritative, 30 Hz). The AI has three layers, each over
what Zion already had; nothing is duplicated.

```
 WarfareDirector (per match, every few s)           ── squads, tasks, roles, leader, retreat
   │ objective per bot
   ▼
 BattleBotDirector.decide (each bot every 3rd tick, staggered)
   │  perception (sight cone, line of sight, smoke, flash, hearing)
   │  memory (last seen enemy, alert) · squad blackboard (sightings shared)
   │  utility tactics (personality) ── bot-brain: chooseTactic, tacticalPosition
   ▼
 BattleBotDirector.move (every tick)
   │  long way:  CoarseNav (4 m grid, HPA*-style) ── bot-brain: routeStep
   │  next stretch: WalkingSearch (0.5 m cells, doors, stairs, ladders) ── navigation.ts
   │  separation from teammates (Reynolds) · cover / firing-position movement
   ▼
 CharacterController (the same physics as players)
```

## Navigation (`apps/server/src/game/bot-brain.ts`)

- **Before:** the fine local search alone could not find any way that strayed more than 18 m
  off the straight line. A bot sent past a long fence walked into it, then turned a random 75° for
  a second, again and again.
- **Coarse planner.** A grid of 4 m cells over the terrain.
  - **Edges are tested once, lazily, against the physics world:** rays at step and chest height
    across the edge, so a fence, wall or house blocks it. Slopes steeper than 40° and deep water
    block it too.
  - **Shared by every bot** of the server: what one bot learned, all reuse.
  - **A\*** over the grid finds the way round, hundreds of metres long. Diagonals are never cut
    through a wall's end. Paths are string-pulled.
  - **Budget:** searches are time-sliced under one budget per tick for all bots (700 nodes and
    2.5 ms).
- **Hierarchy.** The bot hands its next waypoint (within about 14 m) to the fine search, which
  threads doors, stairs and ladders.
- **Recovery:**
  - When a bot makes no headway for 3 s, the edge ahead is marked bad for everyone for 25 s and
    the route is planned again without it.
  - After five failures the goal is reported unreachable for 8 s rather than walked at blindly.
  - The old random sidestep only runs when the bot has no planned route.
- **Separation:** teammates closer than 1.8 m push each other apart, so bots do not bunch up in
  doorways or files.

## Individual intelligence

- **Perception (kept):**
  - sight within a cone and range, by line of sight, blocked by smoke and blinded by flashbangs;
  - gunshots heard give a direction, never a target through walls.

  A bot never knows where an enemy is unless it saw it or a squadmate called it.
- **Memory (new):** an enemy that drops out of sight leaves its last known position. The bot goes
  to look there for up to 9 s, then forgets it.
- **Personality (new):** each bot is aggressive, defensive, tactical or cautious, decided by its
  id. Personality sets its aggression, caution, flanking, preferred range and the health at which
  it falls back.
- **Utility AI (new).** Every 2 s in a fight the bot scores the tactics below for its personality
  and situation, and keeps the current one unless another is clearly better:
  - the tactics: hold, cover, flank, push, fall back;
  - the situation: health, range, reload, teammates and enemies about, how long the fight has
    lasted, when it was last hit.
- **Tactical position scoring (new).** For flank and push, candidate positions on rings round the
  bot are scored on:
  - seeing the target;
  - a low wall in front of it;
  - the preferred range;
  - spacing from teammates;
  - distance to go;
  - for a flank, being off the line of fire.

  The bot moves there through the fine search while it keeps facing and shooting the target.
- **Cover (kept):** shielded spots searched within budget, prone, or running off when hurt.

## Squads (`warfare-director.ts`)

- **Squads of 3–4 with a leader:**
  - the leader is re-elected when it falls;
  - the others keep a wedge on the leader on the way.
- **Tasks per squad**, from the commander: attack, defend, reinforce, scout.
- **Blackboard:** while a member sees an enemy, its squadmates are kept posted on the position.
- **Roles by class:**
  - **On attack (new):**
    - support lies at the near edge, covering;
    - recon watches from a flank;
    - assault pushes into the ring.
  - **On defence (kept):** each class takes its own Studio points (sniper and overwatch for recon).
- **Retreat (kept):** badly hurt bots fall back to the nearest held zone.

## Performance

- Each bot thinks every third tick, staggered (a third of the bots per tick).
- Every per-tick search has a budget:
  - coarse routes: 2.5 ms;
  - fine routes: 3 ms;
  - cover searches: 3 per tick;
  - tactical-position searches: 2 per tick.
- Edge tests are cached for the whole server.
- In the integration test, four bots plus their routing never take a tick over 60 ms on a dev
  machine; the bound is checked.

## Debug: `/aidebug`

Type `/aidebug` in chat to draw the bots near you:
- **Routes:** yellow.
- **Goal:** green.
- **Target:** red.
- **Cover:** blue cross.
- **Chosen firing position:** magenta cross.
- **Label over each bot:** mode, tactic, personality, role, squad and health, plus whether it is
  planning a route or has found none.

On live servers only your own side's bots are shown, so it can never be used to see the enemy.

## Tests

- **`bot-brain.test.ts`:**
  - round a 140 m fence by its far gap, where the fine search gives up;
  - out of a dead-end pocket and round houses;
  - a snag the grid did not see: edges are blamed and the goal is reported unreachable, never
    looped on;
  - 40 bots planning at once within the per-tick budget;
  - personalities choosing differently;
  - tactic hysteresis;
  - firing-position scoring;
  - separation.
- **`battle-bots-nav.test.ts`:** real bots (`BattleBotDirector`) of a squad sent past a long
  fence, out of a pocket and round houses. They go through the far gap, all arrive, stay apart and
  keep the tick bounded.

## Not done

- **GOAP and HTN.** The squad layer is a task allocator and the individual layer is a utility
  selector. A full action planner would add little over them for the current action set.
- **D\* Lite.** Replanning from scratch on the coarse grid is cheap enough.
- **Influence maps.** Position scoring uses direct line-of-sight tests instead.
