import { Surface } from '@zion/shared';
import type { CellRect, Heightfield } from '@zion/worldgen/editor';

/** Map colours per game surface (tactical-map palette: muted, readable under overlays). */
const SURFACE_RGB: Record<number, [number, number, number]> = {
  [Surface.Grass]: [86, 112, 66], [Surface.DryGrass]: [134, 128, 82], [Surface.ForestFloor]: [62, 82, 52], [Surface.JungleFloor]: [56, 86, 50],
  [Surface.Sand]: [190, 176, 132], [Surface.Sandstone]: [176, 150, 112], [Surface.Dirt]: [118, 98, 72], [Surface.Mud]: [86, 72, 56],
  [Surface.Gravel]: [126, 124, 116], [Surface.Rock]: [112, 110, 106], [Surface.Snow]: [226, 230, 234], [Surface.Seabed]: [74, 82, 72],
  [Surface.DirtRoad]: [140, 116, 84], [Surface.WheelTrack]: [128, 108, 80], [Surface.RoadVerge]: [104, 104, 84], [Surface.Asphalt]: [70, 72, 74],
  [Surface.MossyAsphalt]: [76, 84, 70], [Surface.BrokenAsphalt]: [88, 86, 82], [Surface.GravelRoad]: [132, 126, 112],
};

/**
 * The terrain as an image, one pixel per grid vertex: surface colour, hill shading, depth-tinted
 * sea and contour lines. Brush strokes repaint only the cells they touched.
 */
export class TerrainRaster {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  contours = true;
  /** Climate colour cast (warm and sandy, cold and blue…), multiplied into the land colours. */
  tint: readonly number[] = [1, 1, 1];

  constructor(private terrain: Heightfield, private seaLevel: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = terrain.cols; this.canvas.height = terrain.rows;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
    this.update();
  }

  reset(terrain: Heightfield, seaLevel: number): void {
    this.terrain = terrain; this.seaLevel = seaLevel;
    if (this.canvas.width !== terrain.cols) { this.canvas.width = terrain.cols; this.canvas.height = terrain.rows; }
    this.update();
  }

  update(rect?: CellRect | null): void {
    const t = this.terrain, sea = this.seaLevel;
    // One cell of margin: shading and contours read the neighbours.
    const r = rect ? { i0: Math.max(0, rect.i0 - 1), j0: Math.max(0, rect.j0 - 1), i1: Math.min(t.cols - 1, rect.i1 + 1), j1: Math.min(t.rows - 1, rect.j1 + 1) } : { i0: 0, j0: 0, i1: t.cols - 1, j1: t.rows - 1 };
    const w = r.i1 - r.i0 + 1, h = r.j1 - r.j0 + 1;
    const img = this.ctx.createImageData(w, h), d = img.data, H = t.heights, S = t.surface, cols = t.cols, cell = t.cell;
    const interval = cell <= 2 ? 5 : 10;
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
      const k = j * cols + i, z = H[k]!;
      const l = H[j * cols + Math.max(0, i - 1)]!, rr = H[j * cols + Math.min(cols - 1, i + 1)]!;
      const u = H[Math.max(0, j - 1) * cols + i]!, dn = H[Math.min(t.rows - 1, j + 1) * cols + i]!;
      // Light from the north-west.
      const shade = Math.max(.5, Math.min(1.4, 1 + ((l - rr) + (u - dn)) / (2 * cell) * .9));
      let R: number, G: number, B: number;
      if (z < sea) {
        const depth = Math.min(1, (sea - z) / 30);
        R = 34 - depth * 18; G = 72 - depth * 34; B = 88 - depth * 30;
        if (z > sea - 1.2) { R += 16; G += 22; B += 20; }
      } else {
        const c = SURFACE_RGB[S[k]!] ?? SURFACE_RGB[Surface.Grass]!;
        const lift = Math.min(.18, (z - sea) / 1600);
        const [tr, tg, tb] = this.tint;
        R = (c[0] + 255 * lift) * shade * tr!; G = (c[1] + 255 * lift) * shade * tg!; B = (c[2] + 255 * lift) * shade * tb!;
        if (this.contours) {
          const band = Math.floor(z / interval);
          if (band !== Math.floor(rr / interval) || band !== Math.floor(dn / interval)) {
            const major = band % 5 === 0 ? .72 : .86;
            R *= major; G *= major; B *= major;
          }
        }
      }
      const o = ((j - r.j0) * w + (i - r.i0)) * 4;
      d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = 255;
    }
    this.ctx.putImageData(img, r.i0, r.j0);
  }
}
