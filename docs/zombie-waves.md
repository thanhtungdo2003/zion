# Zombie Wave Survival

A party of up to four real players, or one player with zero to three bots, holds out against
waves of zombies on a published Infection map. Results go to eight leaderboards per map.

## What it is built from

| Need | Reused | Added |
|---|---|---|
| Match server | `GameServer` with `mode: 'waves'`: arena rules (no persistence, no coins, no base building), Infection map worlds, spawn spots and doors | `stepWaves`, wave HUD state, arena lock, result recording |
| Private rooms | `MatchPool`'s rejoin idea | `WaveRooms` (`apps/server/src/game/wave-rooms.ts`): one room per party launch or per solo player, at most 24 at once, closed when the match is over and empty |
| Parties | `TeamService` (create, join by code, ready, kick, leader, launch) | A separate wave lobby (limit 4), a `map` op for the leader, and launches that skip the leader's own ready |
| Bots | `BattleBotDirector` (aim settle, spread, line of sight, nav, follow) | `targets` / `hitOther` hooks so bots fight zombies; bots are never hostile to the team |
| Zombies | `ZombieDirector` (AI, limbs, bites, kinds and their fixed health) | No ambient spawns in this mode, `spawnAt(pos, kind)`, horde targeting (a wave zombie always knows where the nearest survivor is), bites on bots |
| Rules | none | `WaveMatch` (`apps/server/src/game/waves.ts`): lobby, countdown, then fighting and break in turn, then over |
| Difficulty | zombie kinds | `wavePlan` (`packages/shared/src/waves.ts`) |
| Leaderboards | none per mode | `wave_scores` table (migration 031) with `WaveScoreRepository`, plus `GET /api/waves/maps` and `GET /api/waves/leaderboard` |
| Menu | Mode picker, design tokens, `.mode-modal` and `.br-results` styles | `WaveLobby` (switch, four slots, map cards, PLAY), `WaveBoards`, and `WaveHud` with its results card |

## Rules

- **Difficulty.** Each wave adds zombies, spawns them faster and in bigger bursts, and brings them
  in from more sides at once (up to four). The mix gets nastier: Gaunt runners join from wave 2,
  Brutes from wave 4 and Crimson leapers from wave 6.
- **Team size.** Each extra member adds 45 % to a wave's count, and up to 36 zombies are alive at
  once.
- **Zombie health is fixed per kind** (Rotting/Gaunt 70, Crimson 50, Brute 200) and never grows.
- **Kit.** Everyone starts with a GL18 pistol, a machete, three boxes of 9 mm and a medkit.
- **Breaks.** A 20 s break follows every cleared wave. Supplies drop at the team's feet: ammo,
  medkits, and a better gun every other wave. Downed (not dead) players get back up.
- **Damage.** There is no friendly fire, and nothing hurts before wave 1.
- **Going down.** A player who drops goes down while any teammate (player or bot) still stands;
  a downed player can be revived. When the whole team is down the match is over.
- **The arena is locked.** Anyone past the map's walls is put back at a spawn point.

## Boards

`waveBoard(playMode, humans, bots)` places each team on one board:

- **Bot mode:** Solo, Duo Bot, Trio Bot or Squad Bot, by 1 + bots.
- **Friends mode:** Solo Player, Duo Players, Trio Players or Full Squad, by real players.

A friends party never has bots. A team that does not fit a board is not ranked.

The board is decided by the team that started wave 1, not by who is left at the end. The server
decides everything: it counts the waves, takes the times from its own clock, and fixes the team
when wave 1 starts. Nothing the client sends is trusted.

Ranking is by waves cleared, then by the time it took to clear the last one, then by date. Each
team keeps one row per board, its best: a team is its sorted account ids plus its bot count. A
match is recorded once (`match_id` is the primary key). Boards are a column, so a new map needs
no schema change.

## Room states and failures

- **States.** A room is in the lobby until the party is in, or until 25 s have passed. It then
  counts down for 8 s, and runs waves and breaks until the team is down.
- **After the match.** The results stay up for 45 s, then the room closes.
- **Reconnects.** A dropped connection rejoins its room through the arena grace period. A
  finished room is never rejoined.
- **Play again** (solo) opens a fresh room. A party goes back through its leader's lobby.
- **Who may start.** Only the party leader can start, and every member must be online and ready.
  Members follow a launch within 20 s. A launch more than a minute old is refused, and so is one
  onto another map.
- **Refusals.** The gateway answers 404 for an unknown or unpublished map, a bot count outside
  0–3, or bots in a party. It answers 503 when a room cannot be made.
- **Double starts.** PLAY is disabled while a match is being created. A party is keyed by its
  launch id, so two clicks cannot make two rooms.

## Tests

| File | Covers | Database |
|---|---|---|
| `apps/server/src/game/waves.test.ts` | Board rules (including that three bots never reach Solo or Full Squad), difficulty growth with fixed health, the full match flow, the party gather timeout | No |
| `apps/server/src/game/waves-server.test.ts` | A real game server with one player and two bots: kit, no damage before wave 1, zombies hunting bots, a break with supplies, the result recorded once on Trio Bot | No |
| `apps/server/src/repositories/wave-scores.integration.test.ts` | Ranking, one row per team, boards and maps kept apart, one record per match | Opt-in: `ZION_WAVES_INTEGRATION=1` and `DATABASE_URL` |

`node apps/web/scripts/wave-lobby-e2e.mjs` renders the lobby (bots, party, join and mobile views)
and the boards with a mocked API, through a disposable Edge debugging session on port 9444.

## Known limits

- **Maps.** Only published Infection maps are offered. Maps have no thumbnails yet, so the cards
  show the mode image.
- **Bots** fire unlimited ammo, like Infection bots. They do not pick up supplies or revive
  anyone.
- **Inviting** a friend works by room code. There is no friends-list invite.
- **Database test.** The leaderboard SQL has a test against PostgreSQL, but it has not been run:
  Docker was not running on the development machine.
- **Bot mode with more than one player.** A party in bot mode is not possible, and a friends
  party with bots is rejected. If either is ever allowed it stays unranked: such a team fits no
  board, so it would need its own boards.
