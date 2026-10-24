/**
 * Survival tick benchmark: one player runs out of the camp into the wilderness (shooting now and
 * then, so zombies come), and the server's tick is timed phase by phase.
 *
 *   pnpm --filter @zion/server exec tsx scripts/bench-survival.ts [seconds=60] [workers=2]
 */
import { createDefaultRegistry } from '@zion/assets';
import { Buttons, TICK_RATE, type ClientMessage, type ServerJsonMessage } from '@zion/shared';
import { GENERATOR_VERSION, normalizeSeed } from '@zion/worldgen';
import { createLogger } from '../src/logger';
import { Metrics } from '../src/metrics';
import type { AppConfig } from '../src/config';
import type { AuditLog } from '../src/repositories/audit';
import type { PlayerStateRepository } from '../src/repositories/player-states';
import type { WorldRepository } from '../src/repositories/worlds';
import { WorldService } from '../src/world/world-service';
import { GameServer } from '../src/game/game-server';
import type { ClientSession } from '../src/game/session';

const seconds = Number(process.argv[2] ?? 60), workers = Number(process.argv[3] ?? 2);
const logger = createLogger('silent', false), registry = createDefaultRegistry();
const world = new WorldService({ seed: normalizeSeed('zion'), sizeChunks: 128, generatorVersion: GENERATOR_VERSION, seaLevel: 20 }, registry, workers, 12_000, logger);
const repository = { load: async () => null, saveMany: async () => undefined, loadChest: async () => null, saveChestAndPlayer: async () => undefined, loadTeams: async () => [] };
const config = { DAY_LENGTH_MINUTES: 25, RANDOM_TICK_SPEED: 3 } as unknown as AppConfig;
const game = new GameServer({ world, registry, config, logger, metrics: new Metrics(), audit: { record: () => undefined } as unknown as AuditLog, playerStates: repository as unknown as PlayerStateRepository, worlds: {} as WorldRepository, worldId: 'bench', initialWorldTimeMs: 0 });

// ---- timing: every step*/send*/sync* method of the server and the big members' step/update ----
const times = new Map<string, { total: number; max: number; calls: number }>();
const timed = (label: string, obj: Record<string, unknown>, name: string) => {
  const fn = obj[name] as ((...a: unknown[]) => unknown) | undefined;
  if (typeof fn !== 'function') return;
  obj[name] = function (this: unknown, ...args: unknown[]) {
    const t = performance.now();
    try { return fn.apply(this, args); } finally {
      const d = performance.now() - t, e = times.get(label) ?? { total: 0, max: 0, calls: 0 };
      e.total += d; e.max = Math.max(e.max, d); e.calls++; times.set(label, e);
    }
  };
};
const proto = GameServer.prototype as unknown as Record<string, unknown>;
for (const name of Object.getOwnPropertyNames(GameServer.prototype)) {
  if (/^(step|send|sync|collect|expire|apply|broadcast|try|damage|hitZombie)/.test(name) && name !== 'step') timed(name, proto, name);
}
const g = game as unknown as Record<string, Record<string, unknown>> & { step(): void; serverTime: number };
for (const [member, method] of [['zombies', 'step'], ['guards', 'step'], ['physics', 'update'], ['vehicles', 'step'], ['vegetation', 'step'], ['chests', 'step']] as const) {
  const obj = g[member];
  if (obj) timed(`${member}.${method}`, obj, method);
}

const session = { id: 1, open: true, buffered: 0, state: 'joining', account: { accountId: 'bench', username: 'Bench' }, sendJson: (m: ServerJsonMessage) => void m, sendText: () => undefined, sendBinary: () => true, sendError: () => undefined, close: () => undefined } as unknown as ClientSession;

try {
  await world.start();
  await game.join(session);
  game.handleMessage(session, { t: 'ready' } as ClientMessage);
  const p = session.player!;
  for (let i = 0; i < 300 && !p.active; i++) { g.step(); await new Promise((r) => setTimeout(r, 5)); }
  p.inv.add('ak47'); p.inv.add('ammo_762', 300);
  const ak = p.inv.items.find((i) => i.itemId === 'ak47');
  if (ak) p.inv.equip(ak.uid);
  // Out of the camp, into the wilds.
  const spawns = (game as unknown as { spawns: { validateLoaded(x: number, z: number): Promise<{ x: number; y: number; z: number }> } }).spawns;
  let out: { x: number; y: number; z: number } | null = null;
  for (let k = 0; k < 40 && !out; k++) out = await spawns.validateLoaded(p.state.x + 300 + k * 37, p.state.z + 200 - k * 23);
  if (!out) throw new Error('no open ground found');
  Object.assign(p.state, { x: out.x, y: out.y, z: out.z, vx: 0, vy: 0, vz: 0 });
  console.log(`spawned at ${p.state.x.toFixed(0)}, ${p.state.z.toFixed(0)}; running ${seconds}s with ${workers} worldgen workers`);
  const ticks: number[] = [];
  let seq = 1, yaw = .3;
  const total = seconds * TICK_RATE;
  for (let tick = 0; tick < total; tick++) {
    // Run, turning slowly, firing a burst every few seconds.
    if (tick % (TICK_RATE * 8) === 0) yaw += .6;
    const firing = tick % (TICK_RATE * 5) < 10 && tick % 2 === 0;
    game.handleMessage(session, { t: 'in', s: seq++, mx: 0, mz: 1, yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), pitch: 0, b: Buttons.Sprint | (firing ? Buttons.Attack : 0), w: 1 } as ClientMessage);
    const t = performance.now();
    g.step();
    ticks.push(performance.now() - t);
    // Real time between ticks lets the worldgen workers deliver chunks.
    await new Promise((r) => setTimeout(r, 1000 / TICK_RATE));
  }
  ticks.sort((a, b) => a - b);
  const q = (f: number) => ticks[Math.min(ticks.length - 1, Math.floor(ticks.length * f))]!.toFixed(2);
  console.log(`tick ms: median ${q(.5)}  p95 ${q(.95)}  p99 ${q(.99)}  max ${q(1)}  over ${(1000 / TICK_RATE).toFixed(1)} ms: ${ticks.filter((t) => t > 1000 / TICK_RATE).length}/${ticks.length}`);
  console.log(`zombies alive: ${[...(g.zombies as unknown as { zombies: Map<number, { dead: boolean }> }).zombies.values()].filter((z) => !z.dead).length}; player at ${p.state.x.toFixed(0)}, ${p.state.z.toFixed(0)}`);
  console.log('phase                      total ms   per tick   max ms   calls');
  for (const [label, e] of [...times].sort((a, b) => b[1].total - a[1].total).slice(0, 25)) {
    console.log(`${label.padEnd(26)} ${e.total.toFixed(1).padStart(9)} ${(e.total / total).toFixed(3).padStart(10)} ${e.max.toFixed(2).padStart(8)} ${String(e.calls).padStart(7)}`);
  }
} finally {
  await game.stop();
  await world.close();
}
