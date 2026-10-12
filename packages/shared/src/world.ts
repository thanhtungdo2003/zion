import { clamp } from './math';

/** Edge length of a chunk in metres. */
export const CHUNK_SIZE = 32;
/** Number of cells per chunk side at LOD 0 (1 m resolution). */
export const CHUNK_CELLS = 32;
/** Number of terrain LOD levels. LOD n uses a cell size of 2^n metres. */
export const LOD_COUNT = 3;

export function lodStep(lod: number): number {
  return (CHUNK_SIZE / CHUNK_CELLS) * (1 << lod);
}

/** Vertices per chunk side for a LOD (33, 17, 9). */
export function lodVerts(lod: number): number {
  return CHUNK_CELLS / (1 << lod) + 1;
}

/**
 * Heights and water levels travel as uint16: h = q * HEIGHT_QUANT + HEIGHT_OFFSET.
 * q = 0 is reserved for "no water". Range: -100 m … 555.34 m at 1 cm precision.
 * Server collision uses the *dequantized* values so client prediction sees identical terrain.
 */
export const HEIGHT_QUANT = 0.01;
export const HEIGHT_OFFSET = -100;
export const HEIGHT_MIN = HEIGHT_OFFSET + HEIGHT_QUANT;
export const HEIGHT_MAX = HEIGHT_OFFSET + 65535 * HEIGHT_QUANT;

export function quantizeHeight(h: number): number {
  return clamp(Math.round((h - HEIGHT_OFFSET) / HEIGHT_QUANT), 1, 65535);
}

export function dequantizeHeight(q: number): number {
  return q * HEIGHT_QUANT + HEIGHT_OFFSET;
}

/** Packs signed chunk coordinates into a single non-negative integer key. */
export function chunkKey(cx: number, cz: number): number {
  return ((cx & 0xffff) << 16) | (cz & 0xffff);
}

export function chunkKeyX(key: number): number {
  return ((key >>> 16) << 16) >> 16;
}

export function chunkKeyZ(key: number): number {
  return (key << 16) >> 16;
}

export function worldToChunk(v: number): number {
  return Math.floor(v / CHUNK_SIZE);
}

export enum Biome {
  Ocean = 0,
  Coast = 1,
  Plains = 2,
  Forest = 3,
  SpruceForest = 4,
  Desert = 5,
  Swamp = 6,
  Jungle = 7,
  Mountain = 8,
  SnowPeaks = 9,
  River = 10,
  Lake = 11,
}

export const BIOME_COUNT = 12;

export const BIOME_NAMES: Readonly<Record<Biome, string>> = {
  [Biome.Ocean]: 'Ocean',
  [Biome.Coast]: 'Coast',
  [Biome.Plains]: 'Plains',
  [Biome.Forest]: 'Forest',
  [Biome.SpruceForest]: 'Spruce Forest',
  [Biome.Desert]: 'Desert',
  [Biome.Swamp]: 'Swamp',
  [Biome.Jungle]: 'Jungle',
  [Biome.Mountain]: 'Mountain',
  [Biome.SnowPeaks]: 'Snow Peaks',
  [Biome.River]: 'River',
  [Biome.Lake]: 'Lake',
};

/** Flat map colours per biome (minimap, world previews). sRGB 0xRRGGBB. */
export const BIOME_MAP_COLORS: Readonly<Record<Biome, number>> = {
  [Biome.Ocean]: 0x1d4f7a,
  [Biome.Coast]: 0xe3d49a,
  [Biome.Plains]: 0x9cbf5a,
  [Biome.Forest]: 0x4f8a3a,
  [Biome.SpruceForest]: 0x2f5e44,
  [Biome.Desert]: 0xe0c27a,
  [Biome.Swamp]: 0x5a6b3a,
  [Biome.Jungle]: 0x2e8a2a,
  [Biome.Mountain]: 0x8a8278,
  [Biome.SnowPeaks]: 0xf2f4f7,
  [Biome.River]: 0x3a8fd0,
  [Biome.Lake]: 0x2f78b8,
};

/** Ground material. Drives rendering today; footsteps, movement modifiers and tracks later. */
export enum Surface {
  Grass = 0,
  DryGrass = 1,
  ForestFloor = 2,
  JungleFloor = 3,
  Sand = 4,
  Sandstone = 5,
  Dirt = 6,
  Mud = 7,
  Gravel = 8,
  Rock = 9,
  Snow = 10,
  Seabed = 11,
  DirtRoad = 12,
  WheelTrack = 13,
  RoadVerge = 14,
}

export const SURFACE_COUNT = 15;

export const SURFACE_NAMES: Readonly<Record<Surface, string>> = {
  [Surface.Grass]: 'Grass',
  [Surface.DryGrass]: 'Dry grass',
  [Surface.ForestFloor]: 'Forest floor',
  [Surface.JungleFloor]: 'Jungle floor',
  [Surface.Sand]: 'Sand',
  [Surface.Sandstone]: 'Sandstone',
  [Surface.Dirt]: 'Dirt',
  [Surface.Mud]: 'Mud',
  [Surface.Gravel]: 'Gravel',
  [Surface.Rock]: 'Rock',
  [Surface.Snow]: 'Snow',
  [Surface.Seabed]: 'Seabed',
  [Surface.DirtRoad]: 'Dirt road',
  [Surface.WheelTrack]: 'Faded wheel track',
  [Surface.RoadVerge]: 'Grassy roadside',
};

/** Public world description sent to clients (never includes the seed). */
export interface WorldInfo {
  worldId: string;
  sizeChunks: number;
  chunkSize: number;
  seaLevel: number;
  generatorVersion: number;
  dayLengthSec: number;
  /** Seed for purely cosmetic client effects (clouds); derived one-way from the world seed. */
  cosmeticSeed: number;
  /** Survivor camp centre and half size (metres), if the world has one. */
  camp?: { x: number; z: number; halfSize: number } | null;
}
