import { BinaryReadError, BinaryReader, BinaryWriter } from './binary';
import { CHUNK_SIZE, LOD_COUNT, dequantizeHeight, lodStep, lodVerts } from './world';

export const CHUNK_FORMAT_VERSION = 1;
export const MAX_PROPS_PER_CHUNK = 4096;

/**
 * A placed asset instance in canonical (quantized) form. Server collision and client rendering
 * both derive transforms from these exact integers, guaranteeing identical colliders.
 */
export interface PropInstance {
  /** Stable numeric asset id from the asset registry. */
  asset: number;
  /** Chunk-local X, quantized: x = lx * CHUNK_SIZE / 65535. */
  lx: number;
  /** Chunk-local Z, quantized. */
  lz: number;
  /** Base height, quantized like terrain heights. */
  yq: number;
  /** Yaw in 1/256ths of a turn. */
  rot: number;
  /** Uniform scale: 0.5 + s / 255 * 1.5. */
  scale: number;
  /**
   * Structure group (0 = none): pieces of one building/wall share it, so they fade together when
   * the building hides the player.
   */
  group?: number;
}

export interface PropTransform {
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
}

export interface ChunkData {
  cx: number;
  cz: number;
  lod: number;
  /** Vertices per side (without border). */
  verts: number;
  /** Quantized heights on a (verts+2)^2 grid that includes a one-vertex border ring. */
  heights: Uint16Array;
  /** Quantized inland water surface per vertex (verts^2); 0 = no inland water. Sea is implicit. */
  water: Uint16Array;
  biome: Uint8Array;
  surface: Uint8Array;
  /** Temperature 0..255 (cold → hot). */
  temperature: Uint8Array;
  /** Humidity 0..255 (dry → wet). */
  humidity: Uint8Array;
  props: PropInstance[];
  /** Seed for cosmetic, gameplay-irrelevant scatter (grass, flowers) on the client. */
  cosmeticSeed: number;
}

export function propTransform(chunk: Pick<ChunkData, 'cx' | 'cz'>, p: PropInstance): PropTransform {
  return {
    x: chunk.cx * CHUNK_SIZE + (p.lx * CHUNK_SIZE) / 65535,
    y: dequantizeHeight(p.yq),
    z: chunk.cz * CHUNK_SIZE + (p.lz * CHUNK_SIZE) / 65535,
    rotY: (p.rot / 256) * Math.PI * 2,
    scale: 0.5 + (p.scale / 255) * 1.5,
  };
}

export function quantizeLocal(local: number): number {
  return Math.max(0, Math.min(65535, Math.round((local / CHUNK_SIZE) * 65535)));
}

export function quantizeScale(scale: number): number {
  return Math.max(0, Math.min(255, Math.round(((scale - 0.5) / 1.5) * 255)));
}

export function quantizeRotation(rotY: number): number {
  const turns = rotY / (Math.PI * 2);
  return ((Math.round((turns - Math.floor(turns)) * 256) % 256) + 256) % 256;
}

/** Height index helper for the bordered grid: (i, j) in [-1, verts]. */
export function heightIndex(verts: number, i: number, j: number): number {
  return (j + 1) * (verts + 2) + (i + 1);
}

export function chunkHeightAt(chunk: ChunkData, i: number, j: number): number {
  return dequantizeHeight(chunk.heights[heightIndex(chunk.verts, i, j)]!);
}

export function chunkCellSize(chunk: Pick<ChunkData, 'lod'>): number {
  return lodStep(chunk.lod);
}

function writeDelta16(w: BinaryWriter, arr: Uint16Array): void {
  let prev = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]!;
    w.u16((v - prev) & 0xffff);
    prev = v;
  }
}

function readDelta16(r: BinaryReader, n: number): Uint16Array {
  const out = new Uint16Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev = (prev + r.u16()) & 0xffff;
    out[i] = prev;
  }
  return out;
}

/**
 * Serialises chunk content (everything except cx/cz/lod, which travel in the message header).
 * Grids are delta-coded so that the subsequent deflate pass compresses them well.
 */
export function encodeChunkBody(c: ChunkData): Uint8Array {
  const n = c.verts;
  const w = new BinaryWriter(n * n * 10 + c.props.length * 14 + 64);
  w.u8(CHUNK_FORMAT_VERSION);
  w.u16(n);
  w.u32(c.cosmeticSeed);
  writeDelta16(w, c.heights);
  writeDelta16(w, c.water);
  w.bytesRaw(c.biome);
  w.bytesRaw(c.surface);
  w.bytesRaw(c.temperature);
  w.bytesRaw(c.humidity);
  w.u16(c.props.length);
  for (const p of c.props) {
    w.u16(p.asset).u16(p.lx).u16(p.lz).u16(p.yq).u8(p.rot).u8(p.scale).u32(p.group ?? 0);
  }
  return w.finish();
}

export function decodeChunkBody(body: Uint8Array, cx: number, cz: number, lod: number): ChunkData {
  if (!Number.isInteger(lod) || lod < 0 || lod >= LOD_COUNT) throw new BinaryReadError(`invalid lod ${lod}`);
  const r = new BinaryReader(body);
  const version = r.u8();
  if (version !== CHUNK_FORMAT_VERSION) throw new BinaryReadError(`unsupported chunk format ${version}`);
  const n = r.u16();
  if (n !== lodVerts(lod)) throw new BinaryReadError(`vertex count ${n} does not match lod ${lod}`);
  const cosmeticSeed = r.u32();
  const heights = readDelta16(r, (n + 2) * (n + 2));
  const water = readDelta16(r, n * n);
  const biome = r.bytes(n * n).slice();
  const surface = r.bytes(n * n).slice();
  const temperature = r.bytes(n * n).slice();
  const humidity = r.bytes(n * n).slice();
  const propCount = r.u16();
  if (propCount > MAX_PROPS_PER_CHUNK) throw new BinaryReadError(`too many props (${propCount})`);
  const props: PropInstance[] = new Array<PropInstance>(propCount);
  for (let i = 0; i < propCount; i++) {
    props[i] = { asset: r.u16(), lx: r.u16(), lz: r.u16(), yq: r.u16(), rot: r.u8(), scale: r.u8(), group: r.u32() };
  }
  if (r.remaining !== 0) throw new BinaryReadError('trailing bytes in chunk body');
  return { cx, cz, lod, verts: n, heights, water, biome, surface, temperature, humidity, props, cosmeticSeed };
}
