export type GameMode = 'survival' | 'battle-royale';
export const BATTLE_MAP = { id: 'red-island-03', name: 'Đảo Thung lũng Đỏ', seed: 'zion-red-valley-02', sizeChunks: 128, maxPlayers: 32, minPlayers: 2 } as const;
export interface BattleCircle { x: number; z: number; radius: number }
export const BATTLE_FLIGHT = { altitude: 650, durationMs: 55_000, autoDeployHeight: 120 } as const;
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
  winner: { id: number; name: string } | null;
  placement?: number;
  drop?: { phase: 'boarding' | 'falling' | 'parachute' | 'landed'; altitude: number; parachuteOpen: boolean; speed?: number; heading?: number };
  plane?: BattlePlane;
}
