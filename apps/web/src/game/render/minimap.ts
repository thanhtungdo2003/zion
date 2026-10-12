import gameIcons from '@iconify-json/game-icons/icons.json';
import { BIOME_MAP_COLORS, Surface, CHUNK_SIZE, dequantizeHeight, heightIndex, propTransform, type Biome, type ChunkData } from '@zion/shared';
import type { AssetDefinition, AssetRegistry } from '@zion/assets';
import type { MapLocation } from '../world-map';
import { drawLocationIcon } from './location-icon';

/** Chunk raster resolution (px per metre): enough for trees, rocks and building outlines. */
const PX_PER_M = 2;

/** Rotate a world offset with the map and keep distant markers on its edge. */
export function mapMarker(ox: number, oz: number, yaw: number, edge: number): { x: number; y: number; off: boolean } {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let x = ox * c - oz * s, y = ox * s + oz * c;
  const off = Math.max(Math.abs(x), Math.abs(y)) > edge;
  if (off) { const k = edge / Math.max(Math.abs(x), Math.abs(y)); x *= k; y *= k; }
  return { x, y, off };
}

type PropShape = { kind: 'tree' | 'shrub' | 'rock' | 'dot'; r: number } | { kind: 'boxes'; deck?: boolean; boxes: Array<{ cx: number; cz: number; hx: number; hz: number; yaw: number }> };

const TREE_GENERATORS = new Set(['spruce', 'broadleaf', 'birch', 'jungle', 'palm', 'dead', 'willow', 'cactus']);

/** How a placed asset is drawn on the map: trees/shrubs/rocks as blobs, solid structures as outlines. */
function shapeOf(def: AssetDefinition): PropShape {
  const layer = def.placement?.layer;
  const gen = def.model.kind === 'procedural' ? def.model.generator : null;
  if (layer === 'trees' || (gen && TREE_GENERATORS.has(gen))) return { kind: 'tree', r: Math.min(3, Math.max(0.9, def.bounds.radius * 0.55)) };
  if (gen === 'rock' || gen === 'slab') return { kind: 'rock', r: Math.min(3, Math.max(0.5, def.bounds.radius * 0.8)) };
  if (layer === 'shrubs' || gen === 'bush' || gen === 'fern' || gen === 'reeds') return { kind: 'shrub', r: Math.min(1.2, Math.max(0.4, def.bounds.radius * 0.6)) };
  if (layer === 'rocks') return { kind: 'rock', r: Math.min(3, Math.max(0.5, def.bounds.radius * 0.8)) };
  const boxes = def.colliders.flatMap((c) => (c.type === 'box' ? [{ cx: c.center[0], cz: c.center[2], hx: c.halfExtents[0], hz: c.halfExtents[2], yaw: c.yaw }] : []));
  if (boxes.length) return { kind: 'boxes', boxes, deck: def.tags.includes('bridge-deck') };
  return { kind: 'dot', r: Math.min(1.5, Math.max(0.35, def.bounds.radius * 0.6)) };
}

const PROP_FILL: Record<string, string> = { tree: '#1f4a22', shrub: '#3f6e34', rock: '#8c8a84', dot: '#a2937a', boxes: '#7b6a55' };

const VIEW_METERS = 50;

/**
 * Square minimap rotated to match the camera view, rendered from the biome grids of streamed chunks (no extra network data).
 * Each chunk is rasterised once into a tiny cached canvas with hillshading.
 */
export class Minimap {
  private readonly cache = new Map<ChunkData, HTMLCanvasElement>();
  private readonly ctx: CanvasRenderingContext2D;

  private readonly shapes = new Map<number, PropShape | null>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly seaLevel: number,
    private readonly registry: AssetRegistry | null = null,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  forget(chunk: ChunkData): void {
    this.cache.delete(chunk);
  }

  private raster(c: ChunkData): HTMLCanvasElement {
    let cv = this.cache.get(c);
    if (cv) return cv;
    const n = c.verts;
    const terrain = document.createElement('canvas');
    terrain.width = n;
    terrain.height = n;
    const tctx = terrain.getContext('2d')!;
    const img = tctx.createImageData(n, n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const surface = c.surface[k];
        const col = surface === Surface.DirtRoad ? 0x9a805a : surface === Surface.WheelTrack ? 0x827050 : surface === Surface.RoadVerge ? 0x67754a : BIOME_MAP_COLORS[c.biome[k]! as Biome] ?? 0xff00ff;
        const h = dequantizeHeight(c.heights[heightIndex(n, i, j)]!);
        const hl = dequantizeHeight(c.heights[heightIndex(n, i - 1, j - 1)]!);
        let shade = 1 + Math.max(-0.35, Math.min(0.35, (hl - h) * 0.08));
        if (h < this.seaLevel) shade = 0.75 + 0.25 * Math.max(0, 1 + (h - this.seaLevel) / 40);
        img.data[k * 4] = Math.min(255, ((col >> 16) & 255) * shade);
        img.data[k * 4 + 1] = Math.min(255, ((col >> 8) & 255) * shade);
        img.data[k * 4 + 2] = Math.min(255, (col & 255) * shade);
        img.data[k * 4 + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0);
    // Upscale the terrain, then draw the chunk's props on top (baked once per chunk).
    const size = CHUNK_SIZE * PX_PER_M;
    cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    // Vertices sit on chunk corners: expand by half a texel so neighbours meet without seams.
    const texel = size / (n - 1);
    ctx.drawImage(terrain, -texel / 2, -texel / 2, size + texel, size + texel);
    this.drawProps(ctx, c);
    this.cache.set(c, cv);
    return cv;
  }

  private shape(asset: number): PropShape | null {
    if (this.shapes.has(asset)) return this.shapes.get(asset)!;
    const def = this.registry?.byNumericId(asset);
    const s = def && !(def.tags.includes('bridge') && !def.tags.includes('bridge-deck')) ? shapeOf(def) : null;
    this.shapes.set(asset, s);
    return s;
  }

  private drawProps(ctx: CanvasRenderingContext2D, c: ChunkData): void {
    const ox = c.cx * CHUNK_SIZE;
    const oz = c.cz * CHUNK_SIZE;
    // Draw low things first so trees and buildings sit on top.
    const order = { shrub: 0, dot: 1, rock: 2, boxes: 3, tree: 4 } as const;
    const list = c.props
      .map((p) => ({ t: propTransform(c, p), s: this.shape(p.asset) }))
      .filter((e): e is { t: ReturnType<typeof propTransform>; s: PropShape } => e.s !== null)
      .sort((a, b) => (a.s.kind === 'boxes' && a.s.deck ? -1 : order[a.s.kind]) - (b.s.kind === 'boxes' && b.s.deck ? -1 : order[b.s.kind]));
    ctx.lineWidth = 1;
    for (const { t, s } of list) {
      const x = (t.x - ox) * PX_PER_M;
      const z = (t.z - oz) * PX_PER_M;
      ctx.fillStyle = PROP_FILL[s.kind]!;
      if (s.kind === 'boxes') {
        if (s.deck) ctx.fillStyle = '#92978e';
        ctx.strokeStyle = 'rgba(30,24,18,0.85)';
        for (const b of s.boxes) {
          // three.js yaw about +Y maps (x, z) → (x cos + z sin, −x sin + z cos): canvas angle is −yaw.
          const cos = Math.cos(t.rotY);
          const sin = Math.sin(t.rotY);
          const bx = (b.cx * cos + b.cz * sin) * t.scale;
          const bz = (-b.cx * sin + b.cz * cos) * t.scale;
          ctx.save();
          ctx.translate(x + bx * PX_PER_M, z + bz * PX_PER_M);
          ctx.rotate(-(t.rotY + b.yaw));
          const w = Math.max(1, b.hx * 2 * t.scale * PX_PER_M);
          const h = Math.max(1, b.hz * 2 * t.scale * PX_PER_M);
          ctx.fillRect(-w / 2, -h / 2, w, h);
          if (!s.deck) ctx.strokeRect(-w / 2, -h / 2, w, h);
          ctx.restore();
        }
        continue;
      }
      const r = Math.max(0.6, s.r * t.scale * PX_PER_M);
      ctx.beginPath();
      ctx.arc(x, z, r, 0, Math.PI * 2);
      ctx.fill();
      if (s.kind === 'tree') {
        // A lighter crown highlight reads as foliage from above.
        ctx.fillStyle = 'rgba(90,140,70,0.55)';
        ctx.beginPath();
        ctx.arc(x - r * 0.25, z - r * 0.25, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.kind === 'rock') {
        ctx.strokeStyle = 'rgba(40,40,38,0.6)';
        ctx.stroke();
      }
    }
  }

  /**
   * @param tint  CSS colour multiplied over the terrain: the current daylight (white at noon,
   *              warm at dusk/dawn, deep blue at night).
   */
  draw(
    chunks: Iterable<ChunkData>,
    px: number,
    pz: number,
    yaw: number,
    others: Array<{ x: number; z: number }>,
    zombies: Array<{ x: number; z: number }> = [],
    tint = '#ffffff',
    /** Map rotation so it matches the screen: world yaw that points straight up. */
    upYaw = 0,
    npcs: ReadonlyArray<{ role: string; x: number; z: number; quest?: boolean }> = [],
    /** The spawn camp: always shown, pinned to the map edge (pointing at it) when far away. */
    spawn: { x: number; z: number } | null = null,
    teammates: ReadonlyArray<{ x: number; z: number }> = [],
    locations?: ReadonlyArray<MapLocation>,
    arrows = true,
  ): void {
    const W = this.canvas.width;
    const scale = W / VIEW_METERS;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, W);
    ctx.clip();
    ctx.fillStyle = '#1d4f7a';
    ctx.fillRect(0, 0, W, W);
    // Rotate the world so the camera's "up" direction is up on the map.
    ctx.translate(W / 2, W / 2);
    ctx.rotate(upYaw);
    ctx.translate(-W / 2, -W / 2);
    ctx.imageSmoothingEnabled = true;
    const half = VIEW_METERS / 2;
    const reach = VIEW_METERS * 0.75; // culling radius covering the rotated corners
    for (const c of chunks) {
      const x0 = c.cx * CHUNK_SIZE;
      const z0 = c.cz * CHUNK_SIZE;
      if (x0 + CHUNK_SIZE < px - reach || x0 > px + reach || z0 + CHUNK_SIZE < pz - reach || z0 > pz + reach) continue;
      const sx = (x0 - (px - half)) * scale;
      const sz = (z0 - (pz - half)) * scale;
      const size = CHUNK_SIZE * scale;
      // Overlap a hair so neighbouring chunks meet without seams.
      ctx.drawImage(this.raster(c), sx - 0.25, sz - 0.25, size + 0.5, size + 0.5);
    }
    // Daylight: multiply the map by the light colour of the current time of day.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = tint;
    ctx.fillRect(-W, -W, 3 * W, 3 * W);
    ctx.restore();
    ctx.fillStyle = '#ff3b30';
    for (const o of zombies) {
      const ox = (o.x - (px - half)) * scale;
      const oz = (o.z - (pz - half)) * scale;
      if (ox < -W || oz < -W || ox > 2 * W || oz > 2 * W) continue;
      ctx.fillRect(ox - 1.5, oz - 1.5, 3, 3);
    }
    ctx.fillStyle = '#ffb000';
    for (const o of others) {
      const ox = (o.x - (px - half)) * scale;
      const oz = (o.z - (pz - half)) * scale;
      if (ox < -W || oz < -W || ox > 2 * W || oz > 2 * W) continue;
      ctx.beginPath();
      ctx.arc(ox, oz, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Camp NPCs: a gun for the weapon merchant, a red cross for the medic (kept upright on screen).
    for (const n of npcs) {
      if (locations && n.role !== 'sos') continue;
      const ox = (n.x - (px - half)) * scale;
      const oz = (n.z - (pz - half)) * scale;
      if (ox < -W || oz < -W || ox > 2 * W || oz > 2 * W) continue;
      ctx.save();
      ctx.translate(ox, oz);
      ctx.rotate(-upYaw);
      drawNpcIcon(ctx, n.role, 7, n.quest);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(W / 2, W / 2);
    // Still inside the map's rotation (world frame): yaw 0 faces −Z and positive yaw turns left
    // (counter-clockwise), so the arrow turns by −yaw.
    ctx.rotate(-yaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0b0c0d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    if (spawn && !locations) this.drawSpawn(ctx, W, (spawn.x - px) * scale, (spawn.z - pz) * scale, upYaw);
    const mapLocations = locations ? [...locations, ...npcs.filter((n) => n.role === 'target').map((n, i) => ({ ...n, id: `mission:${i}`, icon: 'lucide:crosshair', guide: true }))] : [];
    for (const location of mapLocations) {
      const { x, y, off } = mapMarker((location.x - px) * scale, (location.z - pz) * scale, upYaw, W / 2 - 12);
      const sx = W / 2 + x, sy = W / 2 + y;
      if (arrows && location.guide && off) {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.atan2(y, x)); ctx.fillStyle = '#ffb000';
        ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(5, -4); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      drawLocationIcon(ctx, location.icon, sx, sy, location.id === 'base:home' ? 7 : 5);
      if (location.quest) { ctx.fillStyle = '#ffd000'; ctx.font = 'bold 10px monospace'; ctx.fillText('!', sx + 5, sy - 5); }
    }
    teammates.forEach((mate, i) => {
      const { x, y, off } = mapMarker((mate.x - px) * scale, (mate.z - pz) * scale, upYaw, W / 2 - 10);
      ctx.save(); ctx.translate(W / 2 + x, W / 2 + y);
      ctx.fillStyle = '#5fe089'; ctx.strokeStyle = '#0b0c0d'; ctx.lineWidth = 1.5;
      if (off) {
        ctx.save(); ctx.rotate(Math.atan2(y, x)); ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(4, -4); ctx.lineTo(4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      ctx.beginPath(); ctx.arc(0, 0, off ? 5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#092414'; ctx.fillText(String(i + 1), 0, 0);
      ctx.restore();
    });
  }

  /** Spawn marker in screen space: on the map if visible, else on the border pointing towards it. */
  private drawSpawn(ctx: CanvasRenderingContext2D, W: number, ox: number, oz: number, upYaw: number): void {
    const { x, y, off } = mapMarker(ox, oz, upYaw, W / 2 - 9);
    ctx.save();
    ctx.translate(W / 2 + x, W / 2 + y);
    if (off) {
      ctx.save();
      ctx.rotate(Math.atan2(y, x));
      ctx.fillStyle = '#ffd56a';
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(5, -4);
      ctx.lineTo(5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#2f7d4a';
    ctx.strokeStyle = '#0b0c0d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f4efe4';
    ctx.beginPath();
    ctx.moveTo(0, -4.5);
    ctx.lineTo(4.5, -0.5);
    ctx.lineTo(3, -0.5);
    ctx.lineTo(3, 3.5);
    ctx.lineTo(-3, 3.5);
    ctx.lineTo(-3, -0.5);
    ctx.lineTo(-4.5, -0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** Map/guide icon for a camp NPC centred on the origin: a white disc with a gun or a red cross. */
const NPC_ICONS: Record<string, string> = { farmer: 'wheat', chef: 'cooking-pot', colonel: 'rank-3', target: 'on-target', storage: 'locked-chest', sos: 'medical-pack', nurse: 'medical-pack', merchant: 'pistol-gun' };
const npcImages = new Map<string, HTMLImageElement>();
function npcImage(role: string): HTMLImageElement | undefined {
  const name = NPC_ICONS[role] ?? 'compass';
  const cached = npcImages.get(name);
  if (cached) return cached.complete && cached.naturalWidth ? cached : undefined;
  const data = gameIcons.icons[name as keyof typeof gameIcons.icons];
  if (!data) return undefined;
  const img = new Image();
  img.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" color="#233024">${data.body}</svg>`)}`;
  npcImages.set(name, img);
  return undefined;
}

export function drawNpcIcon(ctx: CanvasRenderingContext2D, role: string, r: number, quest = false): void {
  drawNpcDisc(ctx, role, r);
  if (!quest) return;
  // Yellow "!" badge: this NPC has a quest to offer or to hand in.
  ctx.fillStyle = '#ffd000';
  ctx.strokeStyle = '#0b0c0d';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(r * 1.05, -r * 0.95, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#0b0c0d';
  ctx.font = `900 ${Math.round(r * 1.05)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', r * 1.05, -r * 0.9);
}

function drawNpcDisc(ctx: CanvasRenderingContext2D, role: string, r: number): void {
  ctx.fillStyle = '#f4efe4';
  ctx.strokeStyle = '#0b0c0d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const img = npcImage(role);
  if (img) ctx.drawImage(img, -r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
}
