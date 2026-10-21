import type { BattleConfig, BrushSettings, CellRect, Circle, Heightfield, LootCategory, Region, SettlementLayer, SettlementResult, TerrainPatch, WorldMapDoc } from '@zion/worldgen/editor';
import type { Selection, Tool } from './types';

/** What the inspector panels may read and do; implemented by MapEditor. */
export interface EditorApi {
  doc: WorldMapDoc;
  terrain: Heightfield;
  gameplay: BattleConfig | undefined;
  tool: Tool;
  setTool: (t: Tool) => void;
  brush: BrushSettings;
  setBrush: (b: BrushSettings) => void;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  /** Deletes the selected item (with a confirmation for whole regions). */
  removeSelection: (target?: Selection) => void;
  /** Replace the document as one undo step; `key` folds quick repeats (slider drags) together. */
  commit: (label: string, next: WorldMapDoc, opts?: { terrain?: { before: TerrainPatch; after: TerrainPatch }; key?: string }) => void;
  updateRegion: (label: string, id: string, fn: (r: Region) => Region, key?: string) => void;
  updateGameplay: (label: string, fn: (g: BattleConfig) => void, key?: string) => void;
  /** Runs a terrain operation as one undo step (plus an optional document change). */
  terrainOp: (label: string, op: (hf: Heightfield) => CellRect | null, docChange?: (d: WorldMapDoc) => WorldMapDoc) => void;
  generateRegion: (id: string, from: SettlementLayer) => void;
  preview: { region: string; result: SettlementResult; from: SettlementLayer } | null;
  applyPreview: () => void;
  discardPreview: () => void;
  regenerateTerrain: () => void;
  zones: Circle[] | null;
  setZones: (z: Circle[] | null) => void;
  pickPhase: number | null;
  setPickPhase: (i: number | null) => void;
  lootCategory: LootCategory;
  setLootCategory: (c: LootCategory) => void;
  riverWidth: number;
  setRiverWidth: (w: number) => void;
  busy: boolean;
  flash: (msg: string, error?: boolean) => void;
  centerOn: (x: number, z: number, span?: number) => void;
  confirm: (title: string, message: string, onConfirm: () => void, label?: string) => void;
}
