# Warfare (Chiến trường)

Warfare is a two-sided ticket battle played on a published Studio map. The admin turns it on
for the map. The two sides are Blue (attackers) and Red (defenders). They fight over capture zones
with players and bots:

- every fallen soldier costs their side one ticket;
- the side holding more zones bleeds the other side's tickets;
- the first side to reach 0 tickets loses.

## Where things live

| Part | File |
|---|---|
| Rules and config (one validated source, safe defaults) | `packages/shared/src/warfare.ts`: `warfareConfigSchema`, `parseWarfareConfig` |
| Map layout: zones, bases, deploy and tactical points, links, vehicle spawns | `warfareLayoutSchema`, `validateWarfareLayout`, `autoWarfareLayout` |
| Tickets (each death charged once), capture, bleed | `TicketLedger`, `ZoneCapture`, `bleedRate` |
| Active cap, side balance, respawn queue | `sideCaps`, `pickSide`, `RespawnQueue`, `respawnAt` |
| Class loadouts built from the real inventory grid | `WARFARE_KITS`, `sanitizeWarfareLoadout`, `warfareInventory` |
| Vehicle slot lifecycle | `VehicleSlot` |
| Match phases (lobby → countdown → fighting → over) and end conditions | `apps/server/src/game/warfare.ts` (`WarfareMatch`) |
| AI commander and squads | `apps/server/src/game/warfare-director.ts` |
| Server integration (join, deploy, damage, death, G, emotes, vehicles, state) | `apps/server/src/game/game-server.ts`, section `warfare` |
| Public rooms per map | `apps/server/src/game/warfare-rooms.ts`, `index.ts`, `gateway.ts` (`?mode=warfare&map=`) |
| Menu, HUD, deploy screen, results | `apps/web/src/app/page.tsx`, `components/WarfareHud.tsx` |
| G / Z / Y keys, hand signals on the avatar | `game/input.ts`, `game/engine.ts` (`warfareKey`), `render/avatars.ts` (`gesture`) |
| Studio editor | `components/WarfareStudioPanel.tsx` and the plan in `components/InfectionStudio.tsx` |

## Studio

Open a map in the Studio's map editor. In the Chiến trường section:

1. Tick *Dùng bản đồ này cho chế độ Chiến trường*.
2. Lay out the battlefield. Either press *Tạo bố cục tự động*, or use the tools:
   - **flag:** add or select a zone;
   - **shield / castle:** set the Blue / Red base;
   - **pin:** add or remove a deploy point of the selected zone;
   - **crosshair:** add or remove a tactical point (cover, overwatch, sniper, defend);
   - **car:** add or remove a vehicle spawn.
3. Edit the selected zone: name, radius, starting owner, tactical value and links to neighbouring
   zones.
4. Set the match rules under *Luật trận đấu*:
   - tickets, active cap, respawn time;
   - followers per player, AI squad size;
   - capture time, bleed rates and minimum lead;
   - time limit, all-zones win, deploy rule;
   - bot fill, and the vehicle limits and timers.

The layout and rules are saved with the map. Saving does not regenerate the map's terrain: the
world key leaves Warfare out. A published map with Warfare on is refused when its layout is
invalid. A map with no layout, or an invalid one, plays the automatic layout, and the server logs
why.

## Rules

- **Tickets:** 300 per side. Each death costs one, charged at most once per life (the key is
  `death:<unit>:<life>`).
- **Bleed:** the side behind by at least `bleedMinLead` zones loses
  `bleedPerZone × lead` tickets per second, up to `bleedMaxPerSecond`. Bleed only runs while the
  fight is on and only after `bleedGraceSeconds`.
- **Active cap:** 50 units on the field. Each side gets half; humans count against their side and
  bots fill the rest. Respawns wait in the queue while the field is full. Bots above their side's
  share stay down and are retired. A humans-only side can borrow the other side's bot share.
- **Respawn:** 7 s after death, only while the side has tickets and the field has room, and only at
  a safe point:
  - the base;
  - a held, uncontested zone with no enemy within `spawnSafeRadius`;
  - a squadmate who is not in a contested zone.
  The point is checked again when the unit deploys. A point lost in the meantime falls back to
  another safe one.
- **End of match:**
  - a side at 0 tickets loses;
  - optionally, holding every zone for `allZonesSeconds` wins;
  - when the time limit runs out, the side with more tickets wins;
  - with no humans for `emptyGraceSeconds`, the match is forfeited.

  After the result screen the room closes. Players are sent out, and the room's bots, vehicles,
  queues and orders are cleared.

## AI

There are three layers. Each one owns one decision, so a bot never gets two conflicting orders.

- **Battlefield director** (`WarfareDirector.think`): knows who holds which zone and who stands in
  it. Calls for reinforcements when a held zone is outnumbered (at most once every 30 s per zone).
- **Squad commander** (`assign`, every 3 s):
  - scores the zones: threatened held zones first; then attacks weighted by distance from the
    front, neutral before enemy, and finishing a capture already under way;
  - gives each squad a task, with crowding making a zone less attractive to the next squad;
  - keeps a task about 40 s unless it is done or an urgent reinforcement appears;
  - keeps one squad on defence when the side holds zones;
  - sends one squad on a flank scout when the side has four or more squads.
- **Squad AI** (`squadObjective`):
  - the leader is the first living member, re-elected when the leader falls;
  - on the way the members follow in a wedge;
  - at the zone each takes its own spot: designer tactical points by class (recon on sniper and
    overwatch points, support on defence points), otherwise a ring facing the enemy.
- **Bot** (`BattleBotDirector`): sees (field of view, line of sight, smoke), hears gunfire (a
  direction to look, never a target), fights, strafes, goes prone, reloads, heals and paths
  (navigation, doors, ladders).
  - Its `objective` is the only thing Warfare sets.
  - It retreats to a held zone when badly hurt in a fight.
  - When it makes no headway for 9 s, it takes a detour.

Bots a player recruits leave their AI squad and follow that player's orders (`ledObjective`):
follow (wedge), hold, move to a point, attack, defend, regroup. Player orders always win over the
commander.

## Player controls

| Key | What it does |
|---|---|
| **G** | Aimed at an allied bot within 25 m: recruit it. Aimed at the ground while you have followers: send them there; your avatar points, and the bots turn first, then go. Aimed at nothing: recruit the nearest idle allies. |
| **Shift+G** | Release every follower back to the AI. |
| **Z** | Wave: followers regroup on you, and nearby allies who are not fighting join you. |
| **Y** | Halt: followers hold where they stand. |
| **Tab** | Scoreboard. |

Out of the fight you see the deploy screen. On it you:

- pick a class (Assault, Medic, Engineer, Support, Recon);
- pick its main, heavy and side weapons and its gadgets (each class has its own lists, and the
  gadget limit is enforced);
- pick a deploy point on the tactical map;
- manage your squad: create, join or leave one.

The choice is saved in the browser and on the server for later deploys. Friends who come as a
party (menu team, up to 4) play on one side and in one squad. The leader's *Cả đội ra trận* takes
everyone into the same room.

## Vehicles

Each Studio vehicle spawn is one slot, and each slot goes through this cycle:

`available → spawned → active → damaged → wreck → cleanup → cooldown → available`

- A slot never spawns twice.
- A replacement only appears after the wreck has been removed and the cooldown is over.
- There is a per-side cap.
- A vehicle abandoned away from its spawn is cleaned up after `abandonSeconds`.
- A spawn spot must be clear: no unit within 4 m and validated ground.
- Riders are put down before a wreck is removed.

The vehicle kinds are the game's existing Jolt vehicles (car, jeep, quad, grizzly).

## Limits (not done)

- **Bots do not drive.** The vehicle system only seats players, so bots fight on foot; they can
  still be run over and fight around vehicles.
- **No aircraft or boats.** The engine has no flight or water vehicle physics, so they are not
  offered.
- **Ravenfield mod vehicles are not drivable.** `modelgen unity-scan <Mods>` in model-generator
  lists them (type, seats, wheels, rotors, meshes, textures, what is missing), and
  `modelgen unity` extracts their models and textures. Driving needs mapping onto a physics kind
  and placing seats and wheels, which is not automated.
- **Hand signals are survivor-character only.** The blocky character style does not show them.
- **Bot ammunition is not counted.** Bots carry their class kit and reload normally, but their
  reserve rounds are not counted.

## Tests

```
pnpm vitest run packages/shared/src/warfare.test.ts apps/server/src/game/warfare.test.ts apps/server/src/game/warfare-director.test.ts apps/server/src/game/warfare-server.test.ts
```

`warfare-server.test.ts` plays a real match on the built-in map:

- the deploy screen and the class kit (a weapon from another class is refused);
- bots never above the active cap;
- one ticket per death, even when a death is reported twice;
- respawn after 7 s and not before;
- no friendly fire;
- G recruiting and dismissing bots;
- the ticket loss;
- the room closing once, with no bots left behind.
