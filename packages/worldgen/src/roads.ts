import { CHUNK_SIZE, Surface, hash3, quantizeHeight, quantizeLocal, quantizeRotation, quantizeScale, smoothstep, type PropInstance } from '@zion/shared';
import { CAMP_ASSET } from '@zion/assets';
import { CAMP_PAD, campDistance } from './camp';
import { makeColumnSample, type WorldGenerator } from './generator';
import { IndexHeap } from './heap';
import { allStructures, insideStructure } from './structures';

export const ROAD_HALF_WIDTH = 2.4;
export const ROAD_SHOULDER = 2;
export const ROAD_MAX_GRADE = .24;
interface Node { x: number; z: number; y: number; fixed: boolean }
export interface RoadSegment { a: Node; b: Node; length: number }
export interface RoadQuery { roadDistance: number; roadHeight: number; roadAlong: number }

/** A seeded, shared tree of graded routes from the camp gate to dry-land settlements. */
export class RoadNetwork {
  readonly segments: RoadSegment[] = [];
  readonly connectedSites: Array<{ x: number; z: number }> = [];
  private readonly buckets = new Map<string, RoadSegment[]>();
  private readonly fences = new Map<string, PropInstance[]>();

  constructor(gen: WorldGenerator) {
    if (!gen.camp) return;
    // Site probing must not depend on the road network currently being constructed.
    const raw = gen.rawTerrain;
    gen.rawTerrain = true;
    try { this.build(gen); this.buildFences(gen); }
    finally { gen.rawTerrain = raw; }
  }

  private build(gen: WorldGenerator): void {
    const camp = gen.camp!;
    const sites = allStructures(gen);
    const step = Math.max(12, gen.worldSize / 256);
    const n = Math.ceil(gen.worldSize / step) + 1, count = n * n;
    const heights = new Float64Array(count), costs = new Float64Array(count).fill(Infinity);
    const parent = new Int32Array(count).fill(-1), blocked = new Uint8Array(count), closed = new Uint8Array(count);
    const sample = makeColumnSample();
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const k = z * n + x, wx = x * step, wz = z * step;
      gen.sampleColumn(wx, wz, sample);
      heights[k] = Math.max(sample.height, Number.isFinite(sample.water) ? sample.water + .2 : -Infinity);
      if (sample.height < gen.seaLevel + .6 || (Number.isFinite(sample.water) && sample.water - sample.height > .65)
        || campDistance(camp, wx, wz) < CAMP_PAD) blocked[k] = 1;
    }
    // Routes approach the outside of compounds, rather than crossing their buildings.
    for (const s of sites) {
      const radius = s.radius + 2;
      for (let gz = Math.max(0, Math.floor((s.z - radius) / step)); gz <= Math.min(n - 1, Math.ceil((s.z + radius) / step)); gz++) {
        for (let gx = Math.max(0, Math.floor((s.x - radius) / step)); gx <= Math.min(n - 1, Math.ceil((s.x + radius) / step)); gx++) {
          if (Math.hypot(gx * step - s.x, gz * step - s.z) < radius) blocked[gz * n + gx] = 1;
        }
      }
    }
    const root = Math.round((camp.z + CAMP_PAD + step) / step) * n + Math.round(camp.x / step);
    blocked[root] = 0; costs[root] = 0;
    const heap = new IndexHeap(count); heap.push(root, 0);
    // Cardinal edges avoid two diagonal routes crossing at different elevations.
    // Degree-two nodes are rounded below, producing curved contour roads.
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    while (heap.size) {
      const k = heap.pop();
      if (closed[k]) continue;
      closed[k] = 1;
      const x = k % n, z = Math.floor(k / n);
      for (const [dx, dz] of directions) {
        const nx = x + dx, nz = z + dz;
        if (nx < 1 || nz < 1 || nx >= n - 1 || nz >= n - 1) continue;
        const next = nz * n + nx;
        if (blocked[next] || closed[next]) continue;
        if (dx && dz && (blocked[z * n + nx] || blocked[nz * n + x])) continue;
        const distance = step * Math.hypot(dx, dz);
        const grade = Math.abs(heights[next]! - heights[k]!) / distance;
        // Strongly prefer contour routes over climbing straight up a ridge.
        const cost = costs[k]! + distance * (1 + grade * grade * 80 + Math.max(0, grade - .18) * 180);
        if (cost >= costs[next]!) continue;
        costs[next] = cost; parent[next] = k; heap.push(next, cost);
      }
    }
    const nodes = new Map<number, Node>(), edges: Array<[Node, Node]> = [], used = new Set<number>();
    const node = (k: number): Node => {
      let value = nodes.get(k);
      if (!value) { value = { x: (k % n) * step, z: Math.floor(k / n) * step, y: heights[k]!, fixed: false }; nodes.set(k, value); }
      return value;
    };
    edges.push([{ x: camp.x, z: camp.z + 50, y: camp.y, fixed: true }, node(root)]);
    for (const site of sites) {
      const distance = Math.hypot(camp.x - site.x, camp.z - site.z);
      const x = site.x + (camp.x - site.x) / distance * (site.radius + 5);
      const z = site.z + (camp.z - site.z) / distance * (site.radius + 5);
      let goal = -1, best = Infinity;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const gx = Math.round(x / step) + dx, gz = Math.round(z / step) + dz;
        if (gx < 0 || gz < 0 || gx >= n || gz >= n) continue;
        const k = gz * n + gx, d = Math.hypot(gx * step - x, gz * step - z);
        if (!Number.isFinite(costs[k]!) || d >= best) continue;
        best = d; goal = k;
      }
      if (goal < 0) continue; // Separate islands retain their natural shore.
      this.connectedSites.push({ x: site.x, z: site.z });
      edges.push([node(goal), { x, z, y: site.y, fixed: true }]);
      for (let k = goal; k !== root && k >= 0 && !used.has(k); k = parent[k]!) {
        used.add(k);
        if (parent[k]! >= 0) edges.push([node(k), node(parent[k]!)]);
      }
    }
    const neighbours = new Map<Node, Node[]>();
    for (const [a, b] of edges) for (const [u, v] of [[a, b], [b, a]]) {
      let list = neighbours.get(u!); if (!list) neighbours.set(u!, list = []); list.push(v!);
    }
    // Round bends without moving junctions or entrances; smooth the roadbed heights.
    for (let pass = 0; pass < 4; pass++) {
      const updates: Array<[Node, number, number, number]> = [];
      for (const [point, near] of neighbours) if (!point.fixed && near.length === 2) {
        updates.push([point, point.x * .75 + (near[0]!.x + near[1]!.x) * .125,
          point.z * .75 + (near[0]!.z + near[1]!.z) * .125, point.y * .5 + (near[0]!.y + near[1]!.y) * .25]);
      }
      for (const [point, x, z, y] of updates) { point.x = x; point.z = z; point.y = y; }
    }
    // Project onto a bounded grade while preserving foundation heights at entrances.
    for (let pass = 0; pass < 2048; pass++) {
      let maximumExcess = 0;
      for (const [a, b] of edges) {
        const limit = Math.hypot(b.x - a.x, b.z - a.z) * ROAD_MAX_GRADE;
        const difference = b.y - a.y, excess = Math.max(0, Math.abs(difference) - limit) * Math.sign(difference);
        if (!excess) continue;
        maximumExcess = Math.max(maximumExcess, Math.abs(excess));
        if (a.fixed && !b.fixed) b.y -= excess;
        else if (b.fixed && !a.fixed) a.y += excess;
        else if (!a.fixed && !b.fixed) { a.y += excess * .5; b.y -= excess * .5; }
      }
      if (maximumExcess < .001) break;
    }
    for (const [a, b] of edges) {
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < .1) continue;
      const segment = { a, b, length };
      this.segments.push(segment);
      const margin = ROAD_HALF_WIDTH + ROAD_SHOULDER;
      for (let z = Math.floor((Math.min(a.z, b.z) - margin) / CHUNK_SIZE); z <= Math.floor((Math.max(a.z, b.z) + margin) / CHUNK_SIZE); z++) {
        for (let x = Math.floor((Math.min(a.x, b.x) - margin) / CHUNK_SIZE); x <= Math.floor((Math.max(a.x, b.x) + margin) / CHUNK_SIZE); x++) {
          const key = `${x}:${z}`;
          let list = this.buckets.get(key); if (!list) this.buckets.set(key, list = []); list.push(segment);
        }
      }
    }
  }

  query(x: number, z: number, out: RoadQuery): void {
    out.roadDistance = Infinity; out.roadHeight = 0; out.roadAlong = 0;
    for (const { a, b, length } of this.buckets.get(`${Math.floor(x / CHUNK_SIZE)}:${Math.floor(z / CHUNK_SIZE)}`) ?? []) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (length * length)));
      const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      if (distance >= out.roadDistance) continue;
      out.roadDistance = distance; out.roadHeight = a.y + (b.y - a.y) * t; out.roadAlong = t * length;
    }
  }

  surface(sample: RoadQuery, x: number, z: number): Surface | null {
    const d = sample.roadDistance;
    if (d > ROAD_HALF_WIDTH + ROAD_SHOULDER) return null;
    if (d > ROAD_HALF_WIDTH) return Surface.RoadVerge;
    // Broad, faded ruts; broken patches keep the track from looking freshly painted.
    const worn = .25 + .15 * Math.sin(x * .17 + z * .13);
    return Math.abs(d - .95) < worn ? Surface.WheelTrack : Surface.DirtRoad;
  }

  blend(sample: RoadQuery): number {
    return 1 - smoothstep(ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + ROAD_SHOULDER, sample.roadDistance);
  }

  private buildFences(gen: WorldGenerator): void {
    const left = makeColumnSample(), right = makeColumnSample();
    const query: RoadQuery = { roadDistance: 0, roadHeight: 0, roadAlong: 0 };
    for (let index = 0; index < this.segments.length; index++) {
      const { a, b, length } = this.segments[index]!;
      const nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
      for (let d = 2; d < length; d += 4) {
        const t = d / length, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
        if (gen.camp && campDistance(gen.camp, x, z) < CAMP_PAD + 12) continue;
        if (insideStructure(gen, x, z, 8)) continue;
        gen.sampleColumn(x + nx * 8, z + nz * 8, left);
        gen.sampleColumn(x - nx * 8, z - nz * 8, right);
        const side = left.height < right.height ? 1 : -1;
        if (y - Math.min(left.height, right.height) < 2.5) continue;
        const fx = x + nx * side * (ROAD_HALF_WIDTH + 1), fz = z + nz * side * (ROAD_HALF_WIDTH + 1);
        this.query(fx, fz, query);
        if (query.roadDistance < ROAD_HALF_WIDTH + .65) continue; // Leave junctions open.
        const cx = Math.floor(fx / CHUNK_SIZE), cz = Math.floor(fz / CHUNK_SIZE), key = `${cx}:${cz}`;
        const blend = this.blend(query);
        gen.sampleColumn(fx, fz, left);
        const fy = left.height + (query.roadHeight - left.height) * blend;
        const tin = (hash3(gen.seed, index, Math.floor(d / 4), 0x712) % 5) === 0;
        const prop: PropInstance = { asset: CAMP_ASSET[tin ? 'rusty-corrugated-sheet' : 'wooden-fence'], lx: quantizeLocal(fx - cx * CHUNK_SIZE), lz: quantizeLocal(fz - cz * CHUNK_SIZE), yq: quantizeHeight(fy), rot: quantizeRotation(Math.atan2(-(b.z - a.z), b.x - a.x)), scale: quantizeScale(tin ? .8 : .55) };
        let list = this.fences.get(key); if (!list) this.fences.set(key, list = []); list.push(prop);
      }
    }
  }

  chunkProps(cx: number, cz: number): PropInstance[] { return this.fences.get(`${cx}:${cz}`) ?? []; }
}
