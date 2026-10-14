export type GameMode = 'survival' | 'battle-royale';
export const BATTLE_MAP = { id: 'red-island-03', name: 'Đảo Thung lũng Đỏ', seed: 'zion-red-valley-02', sizeChunks: 128, maxPlayers: 48, minPlayers: 2 } as const;
export interface BattleCircle { x: number; z: number; radius: number }
/** Fixed battle royale clock (14:00) as a fraction of the day. */
export const BATTLE_TIME_OF_DAY = 14 / 24;
export const BATTLE_FLIGHT = { altitude: 650, durationMs: 55_000, autoDeployHeight: 120, deployDelayMs: 10_000 } as const;
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
