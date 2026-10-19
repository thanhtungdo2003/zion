import {
  Color, LinearFilter, OrthographicCamera, SRGBColorSpace, Vector3, WebGLRenderTarget,
  type Fog, type Scene, type WebGLRenderer,
} from 'three';
import { CHUNK_SIZE, dequantizeHeight, type ChunkData } from '@zion/shared';
import type { SkySystem } from './sky';

/**
 * The map drawn from the world itself: every streamed chunk is photographed straight down with an
 * orthographic camera (the real terrain, buildings, trees and rocks), under a fixed low
 * north-west light for relief, then toned to a near-grey with a hint of its colour. The minimap
 * and the world map draw these where the player has been.
 */
export const MAP_LAYER = 7;
export const MAP_CAPTURE_PX = 128;
const LIMIT = 900;

/** Grey with a hint of colour, a little contrast, a cool shadow and a warm light. */
export function mapTone(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const k = Math.min(255, Math.max(0, (l - 128) * 1.12 + 132));
    const t = k / 255;
    data[i] = Math.min(255, k * 0.74 + r * 0.26 + (t - 0.5) * 6);
    data[i + 1] = Math.min(255, k * 0.74 + g * 0.26);
    data[i + 2] = Math.min(255, k * 0.74 + b * 0.26 - (t - 0.5) * 8);
  }
}

/** Captured chunks, shared by the minimap and the world map (newest kept, oldest dropped). */
class MapCaptures {
  private readonly tiles = new Map<string, HTMLCanvasElement>();
  private readonly listeners = new Set<() => void>();
  revision = 0;
  get(cx: number, cz: number): HTMLCanvasElement | undefined { return this.tiles.get(`${cx}:${cz}`); }
  has(cx: number, cz: number): boolean { return this.tiles.has(`${cx}:${cz}`); }
  set(cx: number, cz: number, canvas: HTMLCanvasElement): void {
    const key = `${cx}:${cz}`;
    this.tiles.delete(key);
    this.tiles.set(key, canvas);
    if (this.tiles.size > LIMIT) this.tiles.delete(this.tiles.keys().next().value!);
    this.revision++;
    for (const l of this.listeners) l();
  }
  entries(): IterableIterator<[string, HTMLCanvasElement]> { return this.tiles.entries(); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  clear(): void { this.tiles.clear(); this.revision++; }
}
export const mapCaptures = new MapCaptures();

/** Photographs one chunk per call, nearest first, once its models have had time to load. */
export class MapCartographer {
  private readonly target = new WebGLRenderTarget(MAP_CAPTURE_PX, MAP_CAPTURE_PX, { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true });
  private readonly camera = new OrthographicCamera(0, CHUNK_SIZE, CHUNK_SIZE, 0, 1, 600);
  private readonly pixels = new Uint8Array(MAP_CAPTURE_PX * MAP_CAPTURE_PX * 4);
  /** When each chunk was first seen at full detail, and whether it was photographed again later. */
  private readonly seen = new Map<string, { at: number; shots: number }>();
  private readonly saved = { light: new Vector3(), target: new Vector3(), intensity: 0, color: new Color(), shadow: 1, hemi: 0, sky: new Color(), ground: new Color(), near: 0, far: 0 };

  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene, private readonly sky: () => SkySystem | null) {
    this.target.texture.colorSpace = SRGBColorSpace;
    this.camera.layers.set(MAP_LAYER);
    this.camera.up.set(0, 0, -1);
  }

  update(chunks: Iterable<ChunkData>, px: number, pz: number, now: number): void {
    let best: ChunkData | null = null, bestD = Infinity;
    for (const c of chunks) {
      if (c.lod !== 0) continue;
      const key = `${c.cx}:${c.cz}`;
      let s = this.seen.get(key);
      if (!s) { this.seen.set(key, s = { at: now, shots: mapCaptures.has(c.cx, c.cz) ? 1 : 0 }); continue; }
      // First shot once the models have streamed in, a second one later for slow assets.
      const due = s.shots === 0 ? now - s.at > 2500 : s.shots === 1 ? now - s.at > 20000 : false;
      if (!due) continue;
      const d = (c.cx * CHUNK_SIZE + CHUNK_SIZE / 2 - px) ** 2 + (c.cz * CHUNK_SIZE + CHUNK_SIZE / 2 - pz) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) { this.capture(best); this.seen.get(`${best.cx}:${best.cz}`)!.shots++; }
  }

  /** Chunks that left the view can be photographed afresh when they come back. */
  forget(cx: number, cz: number): void {
    const s = this.seen.get(`${cx}:${cz}`);
    if (s && s.shots > 0) s.shots = 2;
    else this.seen.delete(`${cx}:${cz}`);
  }

  private capture(c: ChunkData): void {
    let top = -Infinity;
    for (const q of c.heights) top = Math.max(top, dequantizeHeight(q));
    const x0 = c.cx * CHUNK_SIZE, z0 = c.cz * CHUNK_SIZE;
    const cam = this.camera;
    cam.position.set(x0 + CHUNK_SIZE / 2, top + 45, z0 + CHUNK_SIZE / 2);
    cam.left = -CHUNK_SIZE / 2; cam.right = CHUNK_SIZE / 2; cam.top = CHUNK_SIZE / 2; cam.bottom = -CHUNK_SIZE / 2;
    cam.near = 1; cam.far = top + 45 + 200;
    cam.lookAt(cam.position.x, cam.position.y - 1, cam.position.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // Fixed map lighting: a low sun from the north-west, soft sky fill, no fog, no shadows.
    const sky = this.sky(), s = this.saved;
    if (sky) {
      // Lights obey the camera's layers too: the sun and the sky fill join the map layer.
      sky.light.layers.enable(MAP_LAYER); sky.hemi.layers.enable(MAP_LAYER);
      s.light.copy(sky.light.position); s.target.copy(sky.light.target.position); s.intensity = sky.light.intensity; s.color.copy(sky.light.color);
      s.shadow = sky.light.shadow.intensity; s.hemi = sky.hemi.intensity; s.sky.copy(sky.hemi.color); s.ground.copy(sky.hemi.groundColor);
      sky.light.target.position.set(cam.position.x, top - 45, cam.position.z);
      sky.light.position.set(cam.position.x - 120, top + 160, cam.position.z - 120);
      sky.light.target.updateMatrixWorld();
      sky.light.intensity = 2.6; sky.light.color.set(0xfff4e6); sky.light.shadow.intensity = 0;
      sky.hemi.intensity = 1.1; sky.hemi.color.set(0xdfe8f0); sky.hemi.groundColor.set(0x4a4438);
    }
    const fog = this.scene.fog as Fog | null;
    if (fog) { s.near = fog.near; s.far = fog.far; fog.near = 1e5; fog.far = 1e5 + 1; }
    const prevTarget = this.renderer.getRenderTarget(), autoClear = this.renderer.autoClear, shadowUpdate = this.renderer.shadowMap.autoUpdate;
    const clear = this.renderer.getClearColor(new Color()), clearAlpha = this.renderer.getClearAlpha();
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x1d4f7a, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, MAP_CAPTURE_PX, MAP_CAPTURE_PX, this.pixels);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearColor(clear, clearAlpha);
    this.renderer.autoClear = autoClear;
    this.renderer.shadowMap.autoUpdate = shadowUpdate;
    if (fog) { fog.near = s.near; fog.far = s.far; }
    if (sky) {
      sky.light.position.copy(s.light); sky.light.target.position.copy(s.target); sky.light.target.updateMatrixWorld();
      sky.light.intensity = s.intensity; sky.light.color.copy(s.color); sky.light.shadow.intensity = s.shadow;
      sky.hemi.intensity = s.hemi; sky.hemi.color.copy(s.sky); sky.hemi.groundColor.copy(s.ground);
    }

    // Rows come bottom-up from the GPU; the map wants north (−Z) at the top.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = MAP_CAPTURE_PX;
    const ctx = canvas.getContext('2d')!, img = ctx.createImageData(MAP_CAPTURE_PX, MAP_CAPTURE_PX), row = MAP_CAPTURE_PX * 4;
    for (let y = 0; y < MAP_CAPTURE_PX; y++) img.data.set(this.pixels.subarray((MAP_CAPTURE_PX - 1 - y) * row, (MAP_CAPTURE_PX - y) * row), y * row);
    mapTone(img.data);
    ctx.putImageData(img, 0, 0);
    mapCaptures.set(c.cx, c.cz, canvas);
  }

  dispose(): void { this.target.dispose(); }
}
