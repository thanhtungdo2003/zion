import type { ModelDoc } from './doc';
import { evaluate, transformPoint } from './evaluate';

/**
 * Pictures of a model without a GPU: every part's triangles projected orthographically from one
 * side, depth-tested, flat-shaded in its material colour. Used to look at what was really built
 * (from the front, the sides, above, at an angle), for the agent and for the checks — not for
 * looks, so there are no textures or shadows.
 */

export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'iso';
export interface ViewImage { view: ViewName; width: number; height: number; rgb: Uint8Array; /** Share of the frame the model covers (0..1). */ coverage: number }

const DIRS: Record<ViewName, [number, number, number]> = {
  // Where the camera looks (towards), y up.
  front: [0, 0, -1], back: [0, 0, 1], left: [1, 0, 0], right: [-1, 0, 0], top: [0, -1, 0], iso: [-.6, -.5, -.62],
};

function basis(d: [number, number, number]): { r: [number, number, number]; u: [number, number, number]; f: [number, number, number] } {
  const l = Math.hypot(...d), f: [number, number, number] = [d[0] / l, d[1] / l, d[2] / l];
  const up: [number, number, number] = Math.abs(f[1]) > .99 ? [0, 0, -1] : [0, 1, 0];
  const r: [number, number, number] = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
  const rl = Math.hypot(...r);
  r[0] /= rl; r[1] /= rl; r[2] /= rl;
  const u: [number, number, number] = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { r, u, f };
}

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** Renders the model from each view (`size` pixels on the long side). */
export function renderViews(doc: ModelDoc, views: ViewName[] = ['front', 'right', 'back', 'left', 'top', 'iso'], size = 256): ViewImage[] {
  const ev = evaluate(doc);
  const colours = new Map(doc.materials.map((m) => [m.id, hex(m.color)]));
  // World triangles once.
  const tris: Array<{ p: Array<[number, number, number]>; c: [number, number, number] }> = [];
  for (const d of ev.draws) {
    const pos = d.mesh.positions, idx = d.mesh.indices, c = colours.get(d.material) ?? [180, 180, 180];
    const world: Array<[number, number, number]> = [];
    for (let i = 0; i < pos.length; i += 3) world.push(transformPoint(d.matrix, pos[i]!, pos[i + 1]!, pos[i + 2]!));
    for (let i = 0; i + 2 < idx.length; i += 3) tris.push({ p: [world[idx[i]!]!, world[idx[i + 1]!]!, world[idx[i + 2]!]!], c });
  }
  const light = (() => { const l: [number, number, number] = [.4, .8, .45], n = Math.hypot(...l); return l.map((v) => v / n) as [number, number, number]; })();
  return views.map((view) => {
    const { r, u, f } = basis(DIRS[view]);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const proj = tris.map((t) => t.p.map((p) => {
      const x = p[0] * r[0] + p[1] * r[1] + p[2] * r[2], y = p[0] * u[0] + p[1] * u[1] + p[2] * u[2], z = p[0] * f[0] + p[1] * f[1] + p[2] * f[2];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      return [x, y, z] as [number, number, number];
    }));
    const span = Math.max(x1 - x0, y1 - y0, 1e-3) * 1.08, W = size, H = size, s = W / span;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rgb = new Uint8Array(W * H * 3).fill(236), depth = new Float32Array(W * H).fill(Infinity);
    let covered = 0;
    proj.forEach((q, k) => {
      const t = tris[k]!, a = t.p[0]!, b = t.p[1]!, c = t.p[2]!;
      // Flat shading by the face normal against a fixed light, both faces lit.
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!], nl = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      const shade = .35 + .65 * Math.abs((n[0]! * light[0] + n[1]! * light[1] + n[2]! * light[2]) / nl);
      const P = q.map(([x, y, z]) => [(x - cx) * s + W / 2, H / 2 - (y - cy) * s, z] as const);
      const minX = Math.max(0, Math.floor(Math.min(P[0]![0], P[1]![0], P[2]![0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(P[0]![0], P[1]![0], P[2]![0])));
      const minY = Math.max(0, Math.floor(Math.min(P[0]![1], P[1]![1], P[2]![1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(P[0]![1], P[1]![1], P[2]![1])));
      const area = (P[1]![0] - P[0]![0]) * (P[2]![1] - P[0]![1]) - (P[2]![0] - P[0]![0]) * (P[1]![1] - P[0]![1]);
      if (Math.abs(area) < 1e-9) return;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + .5, py = y + .5;
        const w0 = ((P[1]![0] - px) * (P[2]![1] - py) - (P[2]![0] - px) * (P[1]![1] - py)) / area;
        const w1 = ((P[2]![0] - px) * (P[0]![1] - py) - (P[0]![0] - px) * (P[2]![1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * P[0]![2] + w1 * P[1]![2] + w2 * P[2]![2], i = y * W + x;
        if (z >= depth[i]!) continue;
        if (depth[i] === Infinity) covered++;
        depth[i] = z;
        rgb[i * 3] = Math.min(255, t.c[0] * shade); rgb[i * 3 + 1] = Math.min(255, t.c[1] * shade); rgb[i * 3 + 2] = Math.min(255, t.c[2] * shade);
      }
    });
    return { view, width: W, height: H, rgb, coverage: covered / (W * H) };
  });
}
