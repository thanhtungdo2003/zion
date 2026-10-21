export type GameMode = 'survival' | 'battle-royale' | 'infection';
export const BATTLE_MAP = { id: 'red-island-03', name: 'Đảo Thung lũng Đỏ', seed: 'zion-red-valley-02', sizeChunks: 128, maxPlayers: 48, minPlayers: 2 } as const;
export interface BattleCircle { x: number; z: number; radius: number }
/** Fixed battle royale clock (14:00) as a fraction of the day. */
export const BATTLE_TIME_OF_DAY = 14 / 24;
export const BATTLE_FLIGHT = { altitude: 650, durationMs: 55_000, autoDeployHeight: 120, deployDelayMs: 10_000 } as const;
/** The pre-match lobby: everyone waits inside a small red ring until the plane takes off. */
export const BATTLE_LOBBY_RADIUS = 16;
/** Keeps a body on the ground inside `fence` (the lobby ring): pushed back to the edge, no outward speed. */
export function keepInCircle(s: { x: number; z: number; vx: number; vz: number }, fence: BattleCircle, margin = .4): void {
  const dx = s.x - fence.x, dz = s.z - fence.z, d = Math.hypot(dx, dz), max = fence.radius - margin;
  if (d <= max || d === 0) return;
  const nx = dx / d, nz = dz / d;
  s.x = fence.x + nx * max; s.z = fence.z + nz * max;
  const out = s.vx * nx + s.vz * nz;
  if (out > 0) { s.vx -= out * nx; s.vz -= out * nz; }
}
export interface BattlePlane { x: number; y: number; z: number; yaw: number; remainingMs: number }
export function battlePlaneAt(size: number, elapsedMs: number): BattlePlane {
  const t = Math.max(0, Math.min(1, elapsedMs / BATTLE_FLIGHT.durationMs));
  return { x: size * (.12 + t * .76), y: BATTLE_FLIGHT.altitude, z: size * (.28 + t * .44), yaw: Math.atan2(-.76, -.44), remainingMs: Math.max(0, BATTLE_FLIGHT.durationMs - elapsedMs) };
}
export interface BattleState {
  t: 'battle';
  phase: 'waiting' | 'countdown' | 'running' | 'finished';
  map: string;
  alive: number;
  total: number;
  stage: number;
  shrinking: boolean;
  remainingMs: number;
  circle: BattleCircle;
  nextCircle: BattleCircle;
  damagePerSecond: number;
  /** Last player standing, or the surviving squad (`squad` names it). */
  winner: { id: number; name: string; squad?: string } | null;
  placement?: number;
  drop?: { phase: 'boarding' | 'falling' | 'parachute' | 'landed'; altitude: number; parachuteOpen: boolean; deployIn?: number; speed?: number; heading?: number };
  plane?: BattlePlane;
  /** Final places so far (entrant id → place, 1 = the winning side): sent once you are out or it is over. */
  placements?: Record<number, number>;
  /** Waiting / countdown: the lobby ring nobody can leave. */
  lobby?: BattleCircle;
  /** Waiting / countdown: everyone in the lobby (shown by name). */
  lobbyNames?: string[];
}

/**
 * The safe circle `sinceMs` after a battle snapshot. The server shrinks it linearly towards
 * `nextCircle`, ending when `remainingMs` runs out, so clients can animate it every frame.
 */
export function battleCircleAt(state: BattleState, sinceMs: number): BattleCircle {
  if (state.phase !== 'running' || !state.shrinking || state.remainingMs <= 0) return state.circle;
  const t = Math.max(0, Math.min(1, sinceMs / state.remainingMs)), a = state.circle, b = state.nextCircle;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, radius: a.radius + (b.radius - a.radius) * t };
}
