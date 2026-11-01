import type { SettlementInput, SettlementIssue, SettlementResult, TerrainSettings, WaterData, WorldMapDoc } from '@zion/worldgen/editor';
import type { NewMapRequest } from '@zion/worldgen/editor/templates';

/** Settlement input as it crosses to the worker: the terrain travels as plain arrays. */
export type SettlementJobInput = Omit<SettlementInput, 'terrain' | 'catalog'> & { terrain: { size: number; cell: number; heights: ArrayBuffer; surface: ArrayBuffer } };

export type WorkerJob =
  | { kind: 'new-map'; req: NewMapRequest }
  | { kind: 'terrain'; settings: TerrainSettings }
  | { kind: 'settlement'; input: SettlementJobInput };

export type WorkerResult =
  | { kind: 'map'; doc: WorldMapDoc; heights: ArrayBuffer; surface: ArrayBuffer }
  /** `water`: the lakes and rivers the new terrain drains into (their beds are cut into the heights). */
  | { kind: 'terrain'; heights: ArrayBuffer; surface: ArrayBuffer; water: WaterData }
  | { kind: 'settlement'; result: SettlementResult };

export type WorkerReply =
  | { id: number; progress: { label: string; value: number } }
  | { id: number; done: WorkerResult }
  | { id: number; error: string; issues?: SettlementIssue[] };

