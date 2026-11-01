import { z } from 'zod';
import { BATTLE_COUNTDOWN_MS, BATTLE_INITIAL_RADIUS, BATTLE_LOBBY_WAIT_MS, BATTLE_MAP, BATTLE_STAGES } from '@zion/shared';
import { pointInPolygon, type Vec2 } from './geometry';
import { stream, type Heightfield } from './heightfield';
import { waterLevelAt, type WaterData } from './water';

const coord = z.number().finite().min(0).max(8192);
const pt = z.tuple([coord, coord]);
const id = z.string().min(1).max(64);

export const LOOT_CATEGORIES = [
  { id: 'weapons', name: 'Vũ khí' }, { id: 'ammo', name: 'Đạn dược' }, { id: 'medical', name: 'Y tế' },
  { id: 'armor', name: 'Giáp' }, { id: 'food', name: 'Thức ăn' }, { id: 'tools', name: 'Công cụ' },
] as const;
export type LootCategory = typeof LOOT_CATEGORIES[number]['id'];
const lootCategory = z.enum(['weapons', 'ammo', 'medical', 'armor', 'food', 'tools']);

export const battlePhaseSchema = z.object({
  /** Safe circle radius at the end of this phase (m). */
  radius: z.number().min(0).max(8192),
  /** Fixed centre, or null for a random one inside the previous circle (on land). */
  center: pt.nullable(),
  waitSec: z.number().min(0).max(3600),
  shrinkSec: z.number().min(1).max(3600),
  damagePerSec: z.number().min(0).max(200),
}).strict();
export type BattlePhase = z.infer<typeof battlePhaseSchema>;

export const battleConfigSchema = z.object({
  id, name: z.string().min(1).max(80),
  maxPlayers: z.number().int().min(2).max(200),
  minPlayers: z.number().int().min(1).max(200),
  squadSize: z.number().int().min(1).max(4),
  /** The playable circle at the start (first safe zone). */
  playArea: z.object({ x: coord, z: coord, radius: z.number().min(50).max(8192) }).strict(),
  lobbyWaitSec: z.number().min(0).max(1800),
  countdownSec: z.number().min(0).max(600),
  phases: z.array(battlePhaseSchema).min(1).max(16),
  /** Hard end of the match (s after the drop); 0 = none. */
  timeLimitSec: z.number().min(0).max(14_400),
  winRule: z.enum(['last-standing', 'last-squad']),
  /** At the time limit: who wins. */
  timeoutRule: z.enum(['most-kills', 'closest-to-zone', 'draw']),
  spawnMode: z.enum(['plane-drop', 'spawn-points']),
  minSpawnSpacing: z.number().min(0).max(2000),
  spawnPoints: z.array(z.object({ id, x: coord, z: coord }).strict()).max(512),
  spawnZones: z.array(z.object({ id, name: z.string().max(80), polygon: z.array(pt).min(3).max(64) }).strict()).max(64),
  loot: z.object({
    density: z.number().min(0).max(3),
    categories: z.record(lootCategory, z.number().min(0).max(10)),
    points: z.array(z.object({ id, x: coord, z: coord, category: lootCategory, tier: z.number().int().min(1).max(3) }).strict()).max(4000),
    rareAreas: z.array(z.object({ id, name: z.string().max(80), x: coord, z: coord, radius: z.number().min(5).max(2000) }).strict()).max(64),
  }).strict(),
  hotspots: z.array(z.object({ id, name: z.string().max(80), x: coord, z: coord, radius: z.number().min(5).max(2000), danger: z.number().int().min(1).max(5) }).strict()).max(128),
  noGoZones: z.array(z.object({ id, name: z.string().max(80), kind: z.enum(['no-go', 'unplayable']), polygon: z.array(pt).min(3).max(64) }).strict()).max(64),
  pois: z.array(z.object({ id, name: z.string().min(1).max(80), kind: z.string().max(32), x: coord, z: coord, radius: z.number().min(5).max(2000) }).strict()).max(256),
  /** The fewest vehicles a match has (parked by the roads, at the settlements). */
  vehicles: z.number().int().min(0).max(120).optional(),
}).strict();
export type BattleConfig = z.infer<typeof battleConfigSchema>;

/** The live match rules (packages/shared BATTLE_*), scaled to a map of `size` metres. */
export function defaultBattleConfig(size: number, name = 'Cấu hình mặc định', configId = 'br-default'): BattleConfig {
  const initial = size * BATTLE_INITIAL_RADIUS;
  return {
    id: configId, name, maxPlayers: BATTLE_MAP.maxPlayers, minPlayers: BATTLE_MAP.minPlayers, squadSize: 1,
    playArea: { x: size / 2, z: size / 2, radius: Math.round(initial) },
    lobbyWaitSec: BATTLE_LOBBY_WAIT_MS / 1000, countdownSec: BATTLE_COUNTDOWN_MS / 1000,
    phases: BATTLE_STAGES.map((s) => ({ radius: Math.round(initial * s.ratio), center: null, waitSec: s.wait / 1000, shrinkSec: s.shrink / 1000, damagePerSec: s.damage })),
    timeLimitSec: 0, winRule: 'last-standing', timeoutRule: 'closest-to-zone', spawnMode: 'plane-drop', minSpawnSpacing: 120,
    spawnPoints: [], spawnZones: [],
    loot: { density: 1, categories: { weapons: 3, ammo: 3, medical: 2, armor: 1, food: 1, tools: 1 }, points: [], rareAreas: [] },
    hotspots: [], noGoZones: [], pois: [], vehicles: 36,
  };
}

export interface Circle { x: number; z: number; radius: number }
export interface GameplayIssue { severity: 'error' | 'warning' | 'info'; code: string; message: string; x?: number; z?: number }

export interface GameplayContext { terrain: Heightfield; water: WaterData; seaLevel: number }
const isWet = (ctx: GameplayContext, x: number, z: number) => waterLevelAt(ctx.terrain, ctx.water, ctx.seaLevel, x, z) !== null;
const inNoGo = (cfg: BattleConfig, x: number, z: number) => cfg.noGoZones.some((n) => pointInPolygon(x, z, n.polygon));
const landShare = (ctx: GameplayContext, c: Circle) => {
  let land = 0, total = 0;
  for (const r of [0, .35, .7]) for (let k = 0; k < (r ? 8 : 1); k++) {
    const a = k / 8 * Math.PI * 2; total++;
    if (!isWet(ctx, c.x + Math.cos(a) * r * c.radius, c.z + Math.sin(a) * r * c.radius)) land++;
  }
  return land / total;
};

/**
 * One possible sequence of safe circles, as the server would draw them: each random centre is
 * inside the previous circle, kept on land where it can be. Deterministic for a preview seed.
 */
export function simulateZones(cfg: BattleConfig, ctx: GameplayContext, previewSeed: string): Circle[] {
  const rng = stream(previewSeed, 'zones'), size = ctx.terrain.size;
  let circle: Circle = { ...cfg.playArea };
  const out: Circle[] = [{ ...circle }];
  for (const ph of cfg.phases) {
    if (ph.center) { circle = { x: ph.center[0], z: ph.center[1], radius: ph.radius }; out.push(circle); continue; }
    const room = Math.max(0, circle.radius - ph.radius);
    let best: Circle | null = null, bestScore = -1;
    for (let i = 0; i < 24; i++) {
      const a = rng.next() * Math.PI * 2, travel = room * Math.sqrt(rng.next()), edge = Math.min(ph.radius, size * .45);
      const x = Math.max(edge, Math.min(size - edge, circle.x + Math.cos(a) * travel)), z = Math.max(edge, Math.min(size - edge, circle.z + Math.sin(a) * travel));
      const c = { x, z, radius: ph.radius }, score = landShare(ctx, c) + (isWet(ctx, x, z) || inNoGo(cfg, x, z) ? 0 : 1);
      if (score > bestScore) { best = c; bestScore = score; }
      if (score >= 1.85) break;
    }
    circle = best!; out.push(circle);
  }
  return out;
}

export function matchDuration(cfg: BattleConfig): number {
  return cfg.phases.reduce((s, p) => s + p.waitSec + p.shrinkSec, 0);
}

/** Rules, circles, spawn spacing and the placement of every gameplay point. */
export function validateBattleConfig(cfg: BattleConfig, ctx: GameplayContext): GameplayIssue[] {
  const out: GameplayIssue[] = [];
  const parsed = battleConfigSchema.safeParse(cfg);
  if (!parsed.success) return parsed.error.issues.slice(0, 8).map((i) => ({ severity: 'error' as const, code: 'schema', message: `${i.path.join('.')}: ${i.message}` }));
  const size = ctx.terrain.size, pa = cfg.playArea;
  if (cfg.minPlayers > cfg.maxPlayers) out.push({ severity: 'error', code: 'players', message: 'Số người tối thiểu lớn hơn số người tối đa.' });
  if (cfg.maxPlayers % cfg.squadSize) out.push({ severity: 'warning', code: 'squads', message: `${cfg.maxPlayers} người không chia hết cho đội ${cfg.squadSize} người.` });
  if (pa.x - pa.radius < -size * .25 || pa.z - pa.radius < -size * .25 || pa.x + pa.radius > size * 1.25 || pa.z + pa.radius > size * 1.25) out.push({ severity: 'warning', code: 'play-area', message: 'Vùng chơi ban đầu tràn khá xa ra ngoài bản đồ.' });
  if (landShare(ctx, pa) < .4) out.push({ severity: 'warning', code: 'play-area-water', message: 'Hơn một nửa vùng chơi ban đầu là nước.' });
  let prev: Circle = pa;
  cfg.phases.forEach((ph, i) => {
    if (ph.radius >= prev.radius) out.push({ severity: 'error', code: 'phase-radius', message: `Phase ${i + 1}: bán kính ${ph.radius} m phải nhỏ hơn phase trước (${Math.round(prev.radius)} m).` });
    if (ph.center) {
      const d = Math.hypot(ph.center[0] - prev.x, ph.center[1] - prev.z);
      if (d + ph.radius > prev.radius + 1) out.push({ severity: 'error', code: 'phase-nesting', message: `Phase ${i + 1}: vòng bo mới phải nằm trọn trong vòng trước.`, x: ph.center[0], z: ph.center[1] });
      if (isWet(ctx, ph.center[0], ph.center[1])) out.push({ severity: 'warning', code: 'phase-water', message: `Phase ${i + 1}: tâm vòng bo nằm trên nước.`, x: ph.center[0], z: ph.center[1] });
      prev = { x: ph.center[0], z: ph.center[1], radius: ph.radius };
    } else prev = { ...prev, radius: ph.radius };
    if (i && ph.damagePerSec < cfg.phases[i - 1]!.damagePerSec) out.push({ severity: 'warning', code: 'phase-damage', message: `Phase ${i + 1}: sát thương thấp hơn phase trước.` });
  });
  const duration = matchDuration(cfg);
  if (cfg.timeLimitSec && cfg.timeLimitSec < duration) out.push({ severity: 'warning', code: 'time-limit', message: `Giới hạn ${Math.round(cfg.timeLimitSec / 60)} phút ngắn hơn tổng thời gian bo (${Math.round(duration / 60)} phút): trận sẽ kết thúc trước khi bo đóng.` });
  if (cfg.winRule === 'last-squad' && cfg.squadSize === 1) out.push({ severity: 'warning', code: 'win-rule', message: 'Thắng theo đội nhưng đội chỉ có 1 người.' });
  // Spawns: on land, in the play area, outside no-go zones, spaced apart.
  const spawns = cfg.spawnPoints;
  let tooClose = 0;
  for (let i = 0; i < spawns.length; i++) {
    const s = spawns[i]!;
    if (isWet(ctx, s.x, s.z)) out.push({ severity: 'error', code: 'spawn-water', message: 'Điểm spawn nằm dưới nước.', x: s.x, z: s.z });
    if (Math.hypot(s.x - pa.x, s.z - pa.z) > pa.radius) out.push({ severity: 'error', code: 'spawn-outside', message: 'Điểm spawn nằm ngoài vùng chơi.', x: s.x, z: s.z });
    if (inNoGo(cfg, s.x, s.z)) out.push({ severity: 'error', code: 'spawn-no-go', message: 'Điểm spawn nằm trong vùng cấm.', x: s.x, z: s.z });
    if (ctx.terrain.slopeAt(s.x, s.z) > .8) out.push({ severity: 'warning', code: 'spawn-steep', message: 'Điểm spawn trên sườn dốc.', x: s.x, z: s.z });
    for (let j = i + 1; j < spawns.length; j++) if (Math.hypot(s.x - spawns[j]!.x, s.z - spawns[j]!.z) < cfg.minSpawnSpacing) tooClose++;
  }
  if (tooClose) out.push({ severity: 'warning', code: 'spawn-spacing', message: `${tooClose} cặp điểm spawn gần nhau hơn ${cfg.minSpawnSpacing} m.` });
  if (cfg.spawnMode === 'spawn-points' && spawns.length < Math.ceil(cfg.maxPlayers / cfg.squadSize)) out.push({ severity: 'error', code: 'spawn-count', message: `Cần ít nhất ${Math.ceil(cfg.maxPlayers / cfg.squadSize)} điểm spawn (có ${spawns.length}).` });
  for (const p of cfg.loot.points) {
    if (isWet(ctx, p.x, p.z)) out.push({ severity: 'warning', code: 'loot-water', message: 'Điểm loot nằm dưới nước.', x: p.x, z: p.z });
    else if (inNoGo(cfg, p.x, p.z)) out.push({ severity: 'warning', code: 'loot-no-go', message: 'Điểm loot nằm trong vùng cấm.', x: p.x, z: p.z });
  }
  if (Object.values(cfg.loot.categories).every((w) => !w)) out.push({ severity: 'error', code: 'loot-categories', message: 'Cần ít nhất một loại loot có tỷ trọng > 0.' });
  for (const h of cfg.hotspots) if (Math.hypot(h.x - pa.x, h.z - pa.z) > pa.radius) out.push({ severity: 'warning', code: 'hotspot-outside', message: `Điểm nóng "${h.name}" nằm ngoài vùng chơi.`, x: h.x, z: h.z });
  for (const p of cfg.pois) if (p.x < 0 || p.z < 0 || p.x > size || p.z > size) out.push({ severity: 'error', code: 'poi-outside', message: `POI "${p.name}" nằm ngoài bản đồ.` });
  // The playable land left after no-go zones.
  let usable = 0, total = 0;
  for (let k = 0; k < 400; k++) {
    const a = k * 2.399963, r = Math.sqrt((k + .5) / 400) * pa.radius, x = pa.x + Math.cos(a) * r, zz = pa.z + Math.sin(a) * r;
    total++;
    if (x >= 0 && zz >= 0 && x <= size && zz <= size && !isWet(ctx, x, zz) && !inNoGo(cfg, x, zz)) usable++;
  }
  out.push({ severity: usable / total < .25 ? 'error' : 'info', code: 'playable', message: `${Math.round(usable / total * 100)}% vùng chơi ban đầu là đất chơi được.` });
  out.push({ severity: 'info', code: 'duration', message: `Tổng thời gian bo: ${Math.round(duration / 60)} phút qua ${cfg.phases.length} phase.` });
  return out;
}

/** Spread spawn points over dry, gentle, allowed ground (deterministic for the seed). */
export function autoSpawnPoints(cfg: BattleConfig, ctx: GameplayContext, seed: string, count: number): BattleConfig['spawnPoints'] {
  const rng = stream(seed, 'spawns'), pa = cfg.playArea, out: Array<{ id: string; x: number; z: number }> = [];
  const zones = cfg.spawnZones;
  let spacing = cfg.minSpawnSpacing;
  for (let attempt = 0; out.length < count && attempt < count * 400; attempt++) {
    if (attempt && attempt % (count * 80) === 0) spacing *= .8;
    let x: number, z: number;
    if (zones.length) {
      const zone = zones[attempt % zones.length]!, xs = zone.polygon.map((p) => p[0]), zs = zone.polygon.map((p) => p[1]);
      x = Math.min(...xs) + rng.next() * (Math.max(...xs) - Math.min(...xs)); z = Math.min(...zs) + rng.next() * (Math.max(...zs) - Math.min(...zs));
      if (!pointInPolygon(x, z, zone.polygon)) continue;
    } else {
      const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * pa.radius * .95;
      x = pa.x + Math.cos(a) * r; z = pa.z + Math.sin(a) * r;
    }
    if (x < 8 || z < 8 || x > ctx.terrain.size - 8 || z > ctx.terrain.size - 8) continue;
    if (Math.hypot(x - pa.x, z - pa.z) > pa.radius || isWet(ctx, x, z) || inNoGo(cfg, x, z) || ctx.terrain.slopeAt(x, z) > .5) continue;
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < spacing)) continue;
    out.push({ id: `sp${out.length}`, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
  }
  return out;
}

/** Loot spots at buildings: categories by district, rare tier in rare areas and hot spots. */
export function autoLootPoints(cfg: BattleConfig, buildings: Array<{ x: number; z: number; cls: string; door: Vec2 }>, seed: string): BattleConfig['loot']['points'] {
  const rng = stream(seed, 'loot'), out: BattleConfig['loot']['points'] = [];
  const weights = Object.entries(cfg.loot.categories) as Array<[LootCategory, number]>;
  const bias: Record<string, Partial<Record<LootCategory, number>>> = { military: { weapons: 3, ammo: 3, armor: 3 }, industrial: { tools: 3, ammo: 1.5 }, commercial: { food: 2.5, medical: 2 }, residential: { food: 1.5, medical: 1.5 } };
  for (const b of buildings) {
    const n = Math.max(0, Math.round(cfg.loot.density * (b.cls === 'military' ? 3 : 1.6) * (.5 + rng.next())));
    for (let k = 0; k < n && out.length < 4000; k++) {
      const w = weights.map(([c, v]) => [c, v * (bias[b.cls]?.[c] ?? 1)] as const), total = w.reduce((s, [, v]) => s + v, 0);
      let roll = rng.next() * total, category: LootCategory = 'ammo';
      for (const [c, v] of w) if ((roll -= v) <= 0) { category = c; break; }
      const rare = cfg.loot.rareAreas.some((a) => Math.hypot(a.x - b.x, a.z - b.z) < a.radius) || cfg.hotspots.some((h) => h.danger >= 4 && Math.hypot(h.x - b.x, h.z - b.z) < h.radius);
      const tier = rare ? (rng.next() < .5 ? 3 : 2) : rng.next() < .15 ? 2 : 1;
      out.push({ id: `lt${out.length}`, x: Math.round((b.x + (rng.next() - .5) * 4) * 10) / 10, z: Math.round((b.z + (rng.next() - .5) * 4) * 10) / 10, category, tier });
    }
  }
  return out;
}
