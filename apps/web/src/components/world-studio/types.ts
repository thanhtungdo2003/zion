import type { BrushSettings, Circle, SettlementResult, TerrainTool, Vec2 } from '@zion/worldgen/editor';

export type EditorTab = 'terrain' | 'settlement' | 'gameplay' | 'settings';
export type ShapeType = 'region' | 'lake' | 'river' | 'nogo' | 'spawnzone';
export type PointType = 'spawn' | 'loot' | 'hotspot' | 'poi' | 'rare';
export type DrawTool = 'draw-region' | 'draw-lake' | 'draw-river' | 'draw-nogo' | 'draw-spawnzone';
export type PlaceTool = 'place-spawn' | 'place-loot' | 'place-hotspot' | 'place-poi' | 'place-rare' | 'place-playarea';
export type FloraTool = 'trees' | 'biome';
export type Tool = 'select' | 'pan' | TerrainTool | FloraTool | DrawTool | PlaceTool;

export const BRUSH_TOOLS: readonly string[] = ['raise', 'lower', 'smooth', 'flatten', 'sculpt', 'noise', 'erosion', 'paint', 'trees', 'biome'];
export const isBrush = (t: Tool): t is TerrainTool | FloraTool => BRUSH_TOOLS.includes(t);
export const isFlora = (t: Tool): t is FloraTool => t === 'trees' || t === 'biome';
export const isDraw = (t: Tool): t is DrawTool => t.startsWith('draw-');
export const isPlace = (t: Tool): t is PlaceTool => t.startsWith('place-');
export const drawShape = (t: DrawTool): ShapeType => t.slice(5) as ShapeType;

export type Selection =
  | { kind: 'shape'; shape: ShapeType; id: string; vertex?: number }
  | { kind: 'building' | 'prop'; region: string; id: string }
  | { kind: 'point'; point: PointType; id: string }
  | { kind: 'play-area' }
  | { kind: 'phase'; index: number };

export const sameSelection = (a: Selection | null, b: Selection | null): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface Layers { base: boolean; water: boolean; regions: boolean; buildings: boolean; props: boolean; gameplay: boolean; contours: boolean }

/** What the 2D view draws on top of the terrain besides the document itself. */
export interface Overlay {
  preview: { region: string; result: SettlementResult } | null;
  zones: Circle[] | null;
  markers: Array<{ x: number; z: number; severity: 'error' | 'warning' | 'info' }>;
  brush: BrushSettings | null;
  draft: { tool: DrawTool; points: Vec2[] } | null;
}
