import { validateWarfareLayout, type WarfareLayout, type WarfareVehicleSpawn, type WarfareZone } from '@zion/shared';
import type { WorldMapDoc } from './document';

/** A place worth fighting over: a village, a city district, a base, a cluster of the template's buildings. */
interface Site { name: string; x: number; z: number; radius: number; weight: number; military: boolean }

const LETTERS = 'ABCDEFGHIJKLMNOP';
const MAX_ZONES = 12;

/** Spread of points round their centre (for a zone radius). */
function spread(pts: ReadonlyArray<{ x: number; z: number }>, cx: number, cz: number): number {
  if (!pts.length) return 0;
  let s = 0;
  for (const p of pts) s += (p.x - cx) ** 2 + (p.z - cz) ** 2;
  return Math.sqrt(s / pts.length);
}

/** Groups points by distance (single link, `gap` metres). */
function clusters<T extends { x: number; z: number }>(pts: readonly T[], gap: number): T[][] {
  const out: T[][] = [], seen = new Set<number>();
  for (let i = 0; i < pts.length; i++) {
    if (seen.has(i)) continue;
    const group = [pts[i]!], stack = [i];
    seen.add(i);
    while (stack.length) {
      const a = pts[stack.pop()!]!;
      for (let j = 0; j < pts.length; j++) if (!seen.has(j) && Math.hypot(pts[j]!.x - a.x, pts[j]!.z - a.z) <= gap) { seen.add(j); stack.push(j); group.push(pts[j]!); }
    }
    out.push(group);
  }
  return out;
}

/**
 * The map's settlements as candidate zones: a small place is one zone; a town or city with
 * districts gives one zone per district (its buildings around that district's centre); a large
 * place without districts is split into clusters of buildings. The template's own building pads
 * count too.
 */
function sites(doc: WorldMapDoc): Site[] {
  const out: Site[] = [];
  for (const r of doc.regions) {
    const res = r.result;
    if (!res?.buildings.length) continue;
    const military = r.preset === 'military-base';
    const b = res.buildings;
    const districts = res.districts?.filter((d) => d.cls !== 'green') ?? [];
    if (districts.length > 1) {
      const groups = districts.map(() => [] as typeof b);
      for (const h of b) {
        let best = 0, bd = Infinity;
        districts.forEach((d, i) => { const dd = Math.hypot(h.x - d.x, h.z - d.z); if (dd < bd) { bd = dd; best = i; } });
        groups[best]!.push(h);
      }
      groups.forEach((g, i) => {
        if (g.length < 4) return;
        const cx = g.reduce((s, h) => s + h.x, 0) / g.length, cz = g.reduce((s, h) => s + h.z, 0) / g.length;
        out.push({ name: r.name, x: cx, z: cz, radius: spread(g, cx, cz), weight: g.length, military: military || districts[i]!.cls === 'military' });
      });
      continue;
    }
    for (const g of clusters(b, 45)) {
      if (g.length < 3) continue;
      const cx = g.reduce((s, h) => s + h.x, 0) / g.length, cz = g.reduce((s, h) => s + h.z, 0) / g.length;
      out.push({ name: r.name, x: cx, z: cz, radius: spread(g, cx, cz), weight: g.length, military });
    }
  }
  for (const g of clusters(doc.base.structures, 45)) {
    if (g.length < 3) continue;
    const cx = g.reduce((s, h) => s + h.x, 0) / g.length, cz = g.reduce((s, h) => s + h.z, 0) / g.length;
    out.push({ name: 'Khu nhà', x: cx, z: cz, radius: spread(g, cx, cz), weight: g.length, military: false });
  }
  // Big sites are cut into pieces a squad can hold (about 90 m across).
  const split: Site[] = [];
  for (const s of out) {
    if (s.radius <= 55) { split.push(s); continue; }
    const n = Math.min(4, Math.round(s.radius / 40));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      split.push({ ...s, x: s.x + Math.cos(a) * s.radius * .6, z: s.z + Math.sin(a) * s.radius * .6, radius: s.radius / Math.sqrt(n), weight: s.weight / n });
    }
  }
  return split;
}

/** The densest square of the map (`half` at most 400 m) holding the most settlement. */
function chooseArea(all: readonly Site[], size: number): { x: number; z: number; half: number } {
  let best = all[0]!, score = -1;
  for (const c of all) {
    let w = 0;
    for (const s of all) if (Math.abs(s.x - c.x) < 330 && Math.abs(s.z - c.z) < 330) w += s.weight;
    if (w > score) { score = w; best = c; }
  }
  const inside = all.filter((s) => Math.abs(s.x - best.x) < 330 && Math.abs(s.z - best.z) < 330);
  const x0 = Math.min(...inside.map((s) => s.x)), x1 = Math.max(...inside.map((s) => s.x));
  const z0 = Math.min(...inside.map((s) => s.z)), z1 = Math.max(...inside.map((s) => s.z));
  const half = Math.round(Math.min(400, Math.max(160, Math.max(x1 - x0, z1 - z0) / 2 + 90)));
  const clamp = (v: number) => Math.round(Math.max(half + 8, Math.min(size - half - 8, v)));
  return { x: clamp((x0 + x1) / 2), z: clamp((z0 + z1) / 2), half };
}

/**
 * A battlefield drawn round the map's own villages, towns, cities and bases: one capture zone per
 * settlement (one per district of a city), lettered from the blue base to the red one, linked to
 * their nearest neighbours; the bases at the two ends of the line the settlements spread along.
 * Null when the map has no settlement to fight over.
 */
export function settlementWarfareLayout(doc: WorldMapDoc): WarfareLayout | null {
  const all = sites(doc);
  if (!all.length) return null;
  const area = doc.warfare?.area ?? chooseArea(all, doc.terrain.size);
  const lim = area.half - 24;
  // Into the area's frame, merging places that would overlap.
  let cand = all.map((s) => ({ ...s, x: s.x - area.x, z: s.z - area.z, radius: Math.max(14, Math.min(40, s.radius * .9 + 6)) }))
    .filter((s) => Math.abs(s.x) <= lim && Math.abs(s.z) <= lim)
    .sort((a, b) => b.weight - a.weight);
  const kept: typeof cand = [];
  for (const s of cand) {
    const near = kept.find((k) => Math.hypot(k.x - s.x, k.z - s.z) < k.radius + s.radius + 12);
    if (near) { near.weight += s.weight; near.military ||= s.military; continue; }
    kept.push(s);
    if (kept.length >= MAX_ZONES) break;
  }
  cand = kept;
  if (!cand.length) return null;
  // The battle's axis: the direction the zones spread most along.
  const mx = cand.reduce((s, c) => s + c.x, 0) / cand.length, mz = cand.reduce((s, c) => s + c.z, 0) / cand.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const c of cand) { sxx += (c.x - mx) ** 2; szz += (c.z - mz) ** 2; sxz += (c.x - mx) * (c.z - mz); }
  const angle = cand.length > 1 ? .5 * Math.atan2(2 * sxz, sxx - szz) : 0;
  const ax = Math.cos(angle), az = Math.sin(angle);
  // Bases at the two ends, as far out as the area allows, pushed clear of every zone.
  const reach = lim / Math.max(Math.abs(ax), Math.abs(az));
  const base = (dir: 1 | -1) => {
    const t = reach;
    const at = () => ({ x: Math.round(Math.max(-lim, Math.min(lim, ax * t * dir)) * 10) / 10, z: Math.round(Math.max(-lim, Math.min(lim, az * t * dir)) * 10) / 10 });
    let p = at();
    for (let i = 0; i < 20 && cand.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < c.radius + 10); i++) {
      // Slide sideways along the edge until clear.
      const side = (i % 2 ? 1 : -1) * Math.ceil((i + 1) / 2) * 15;
      p = { x: Math.round(Math.max(-lim, Math.min(lim, ax * t * dir - az * side)) * 10) / 10, z: Math.round(Math.max(-lim, Math.min(lim, az * t * dir + ax * side)) * 10) / 10 };
    }
    return p;
  };
  const blue = base(-1), red = base(1);
  // Lettered from blue to red; each zone named after its place.
  cand.sort((a, b) => (a.x * ax + a.z * az) - (b.x * ax + b.z * az));
  const zones: WarfareZone[] = cand.map((c, i) => {
    const letter = LETTERS[i]!;
    return {
      id: letter.toLowerCase(), name: `${letter} ${c.name}`.slice(0, 32), x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10, radius: Math.round(c.radius),
      owner: null, spawns: [], points: [], links: [], value: c.military ? 2 : c.weight > 30 ? 1.5 : 1,
    };
  });
  // Neighbours: the three nearest of each zone, both ways.
  for (const z of zones) {
    const near = zones.filter((o) => o !== z).sort((a, b) => Math.hypot(a.x - z.x, a.z - z.z) - Math.hypot(b.x - z.x, b.z - z.z)).slice(0, 3);
    for (const o of near) { if (!z.links.includes(o.id) && z.links.length < 8) z.links.push(o.id); if (!o.links.includes(z.id) && o.links.length < 8) o.links.push(z.id); }
  }
  const yaw = (from: { x: number; z: number }) => Math.atan2(-(mx - from.x), -(mz - from.z));
  const vehicles: WarfareVehicleSpawn[] = [];
  for (const [side, p] of [['blue', blue], ['red', red]] as const) {
    const px = -az, pz = ax, out = side === 'blue' ? -1 : 1;
    const spot = (k: WarfareVehicleSpawn['kind'], off: number, back: number) => vehicles.push({
      side, kind: k, x: Math.round(Math.max(-lim, Math.min(lim, p.x + px * off + ax * back * out)) * 10) / 10,
      z: Math.round(Math.max(-lim, Math.min(lim, p.z + pz * off + az * back * out)) * 10) / 10, yaw: yaw(p),
    });
    spot('jeep', 9, 0); spot('quad', -9, 0); spot('marauder', 0, -12);
  }
  const layout: WarfareLayout = { enabled: doc.warfare?.enabled ?? true, area, zones, bases: { blue, red }, vehicleSpawns: vehicles, ...(doc.warfare?.config ? { config: doc.warfare.config } : {}) };
  // A zone the bases could not get clear of is dropped rather than leaving the layout invalid.
  const errs = validateWarfareLayout(layout);
  if (errs.length) layout.zones = layout.zones.filter((z) => !errs.some((e) => e.includes(`"${z.id}"`)));
  for (const z of layout.zones) z.links = z.links.filter((l) => layout.zones.some((o) => o.id === l));
  return layout.zones.length ? layout : null;
}
