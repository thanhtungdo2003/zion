import { CHUNK_SIZE, Surface, hash3, quantizeHeight, quantizeLocal, quantizeRotation, quantizeScale, smoothstep, type PropInstance } from '@zion/shared';
import { CAMP_ASSET } from '@zion/assets';
import { CAMP_PAD, campDistance } from './camp';
import { makeColumnSample, type WorldGenerator } from './generator';
import { IndexHeap } from './heap';
import { allStructures, insideStructure } from './structures';
import { bridgeProp, buildBridgeProps, type BridgeSpan } from './bridges';

export const ROAD_HALF_WIDTH = 2.4;
export const ROAD_SHOULDER = 2;
export const ROAD_MAX_GRADE = .24;
interface Node { x: number; z: number; y: number; fixed: boolean }
export interface RoadSegment { a: Node; b: Node; length: number; halfWidth: number; bridge?: BridgeSpan }
export interface RoadQuery { roadDistance: number; roadHeight: number; roadAlong: number; roadBridge?: boolean; roadHalfWidth?: number; roadBridgeEnd?: number }
interface Crossing { water: number; large: boolean }

/** A seeded, shared tree of graded routes from the camp gate to dry-land settlements. */
export class RoadNetwork {
  readonly segments: RoadSegment[] = [];
  readonly connectedSites: Array<{ x: number; z: number }> = [];
  readonly bridges: BridgeSpan[] = [];
  loopCount = 0;
  private readonly buckets = new Map<string, RoadSegment[]>();
  private readonly fences = new Map<string, PropInstance[]>();

  constructor(gen: WorldGenerator) {
    if (!gen.camp) return;
    // Site probing must not depend on the road network currently being constructed.
    const raw = gen.rawTerrain;
    gen.rawTerrain = true;
    try {
      this.build(gen); this.buildFences(gen);
      buildBridgeProps(gen, this.bridges, (x, y, z, asset, yaw, scale) => {
        const { key, prop } = bridgeProp(x, y, z, asset, yaw, scale);
        let list = this.fences.get(key); if (!list) this.fences.set(key, list = []); list.push(prop);
      });
    }
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
    const enhanced = gen.config.generatorVersion >= 4;
    const wet = new Uint8Array(count);
    const parentBridge = new Map<number, Crossing>();
    const crossings = new Map<string, Crossing | null | false>();
    const reservedBridges: Array<{ k: number; next: number; width: number }> = [];
    const bridgeConflict = (k: number, next: number, crossing: Crossing) => {
      const ax = (k % n) * step, az = Math.floor(k / n) * step, bx = (next % n) * step, bz = Math.floor(next / n) * step;
      const width = crossing.large ? 16 : 3;
      return reservedBridges.some(span => {
        if ((span.k === k && span.next === next) || (span.k === next && span.next === k)) return false;
        const cx = (span.k % n) * step, cz = Math.floor(span.k / n) * step, dx = (span.next % n) * step, dz = Math.floor(span.next / n) * step;
        const gap = width + span.width + 2;
        return Math.min(ax, bx) < Math.max(cx, dx) + gap && Math.max(ax, bx) > Math.min(cx, dx) - gap
          && Math.min(az, bz) < Math.max(cz, dz) + gap && Math.max(az, bz) > Math.min(cz, dz) - gap;
      });
    };
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const k = z * n + x, wx = x * step, wz = z * step;
      gen.sampleColumn(wx, wz, sample);
      heights[k] = Math.max(sample.height, Number.isFinite(sample.water) ? sample.water + .2 : -Infinity);
      wet[k] = sample.height < gen.seaLevel + .6 || (Number.isFinite(sample.water) && (enhanced ? sample.height < sample.water + .6 : sample.water - sample.height > .65)) ? 1 : 0;
      if (wet[k] || campDistance(camp, wx, wz) < CAMP_PAD) blocked[k] = 1;
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
    const crossingAt = (k: number, next: number): Crossing | null | false => {
      if (!enhanced) return null;
      const key = `${Math.min(k, next)}:${Math.max(k, next)}`;
      if (crossings.has(key)) return crossings.get(key)!;
      const x = (k % n) * step, z = Math.floor(k / n) * step;
      const dx = (next % n) * step - x, dz = Math.floor(next / n) * step - z;
      const length = Math.hypot(dx, dz), probes = Math.ceil(length / 3);
      let water = -Infinity, sea = false;
      for (let i = 1; i < probes; i++) {
        gen.sampleColumn(x + dx * i / probes, z + dz * i / probes, sample);
        const level = Number.isFinite(sample.water) ? sample.water : gen.seaLevel;
        if (sample.height < level + .15) { water = Math.max(water, level); sea ||= sample.height < gen.seaLevel; }
      }
      const crossing = Number.isFinite(water) ? { water: water + .5, large: length >= 48 || (sea && length >= 32) } : null;
      if (crossing) {
        const minimum = crossing.water + (crossing.large ? 5 : 1.5);
        // Reserve enough dry land for ramps before any level foundation or camp entrance.
        if (sites.some(s => Math.min(Math.hypot(s.x - x, s.z - z), Math.hypot(s.x - x - dx, s.z - z - dz))
          < s.radius + 24 + Math.abs(minimum - s.y) / ROAD_MAX_GRADE)
          || Math.min(campDistance(camp, x, z), campDistance(camp, x + dx, z + dz)) < CAMP_PAD + 32 + Math.abs(minimum - camp.y) / ROAD_MAX_GRADE) {
          crossings.set(key, false); return false;
        }
      }
      crossings.set(key, crossing); return crossing;
    };
    while (heap.size) {
      const k = heap.pop();
      if (closed[k]) continue;
      const incoming = parentBridge.get(k);
      if (incoming && bridgeConflict(k, parent[k]!, incoming)) {
        // Another finalized crossing has reserved this channel. Leave this shore open for
        // a later land approach or a different crossing, rather than creating a sea junction.
        costs[k] = Infinity; parent[k] = -1; parentBridge.delete(k); continue;
      }
      if (!Number.isFinite(costs[k]!)) continue;
      if (incoming) reservedBridges.push({ k, next: parent[k]!, width: incoming.large ? 16 : 3 });
      closed[k] = 1;
      const x = k % n, z = Math.floor(k / n);
      for (const [dx, dz] of directions) {
        let nx = x + dx, nz = z + dz;
        if (nx < 1 || nz < 1 || nx >= n - 1 || nz >= n - 1) continue;
        // Jump straight from shore to shore. Never turn or place a junction over water.
        if (enhanced && wet[nz * n + nx]) {
          for (let jump = 1; jump * step <= 512 && wet[nz * n + nx]; jump++) { nx += dx; nz += dz; if (nx < 1 || nz < 1 || nx >= n - 1 || nz >= n - 1) break; }
        }
        if (nx < 1 || nz < 1 || nx >= n - 1 || nz >= n - 1 || Math.hypot(nx - x, nz - z) * step > 512) continue;
        const next = nz * n + nx;
        if (blocked[next] || closed[next]) continue;
        const distance = step * Math.hypot(nx - x, nz - z);
        const crossing = crossingAt(k, next);
        if (crossing === false) continue;
        if (crossing && bridgeConflict(k, next, crossing)) continue;
        const grade = Math.abs(heights[next]! - heights[k]!) / distance;
        // Strongly prefer contour routes over climbing straight up a ridge.
        const cost = costs[k]! + distance * ((crossing ? 3.5 : 1) + grade * grade * 80 + Math.max(0, grade - .18) * 180) + (crossing ? 35 : 0);
        if (cost >= costs[next]!) continue;
        costs[next] = cost; parent[next] = k; heap.push(next, cost);
        if (crossing) parentBridge.set(next, crossing); else parentBridge.delete(next);
      }
    }
    const nodes = new Map<number, Node>(), edges: Array<[Node, Node]> = [], used = new Set<number>();
    const bridgeEdges: Array<{ a: Node; b: Node; crossing: Crossing }> = [];
    const node = (k: number): Node => {
      let value = nodes.get(k);
      if (!value) { value = { x: (k % n) * step, z: Math.floor(k / n) * step, y: heights[k]!, fixed: false }; nodes.set(k, value); }
      return value;
    };
    const addEdge = (k: number, next: number, crossing: Crossing | null = null) => {
      const a = node(k), b = node(next); edges.push([a, b]);
      if (crossing) {
        const deck = Math.max(a.y, b.y, crossing.water + (crossing.large ? 5 : 1.5));
        a.y = b.y = deck;
        bridgeEdges.push({ a, b, crossing });
      }
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
        if (parent[k]! >= 0) addEdge(k, parent[k]!, parentBridge.get(k) ?? null);
      }
    }
    if (enhanced) {
      used.add(root);
      // Alternate links rejoin a different ancestor, making real loops rather than parallel stubs.
      const linked = new Set(edges.map(([a, b]) => [a.x, a.z, b.x, b.z].join(':')));
      for (const k of [...used].sort((a, b) => a - b)) {
        if (this.loopCount >= Math.max(3, Math.floor(sites.length / 5))) break;
        if (hash3(gen.seed, k, 0, 0x100b) % 5 !== 0) continue;
        const x = k % n, z = Math.floor(k / n);
        for (const [dx, dz] of directions) {
          const nx = x + dx, nz = z + dz, next = nz * n + nx;
          if (nx < 1 || nz < 1 || nx >= n - 1 || nz >= n - 1 || blocked[next] || parent[k] === next || parent[next] === k) continue;
          const path = [next]; let cursor = next;
          for (let hops = 0; !used.has(cursor) && parent[cursor]! >= 0 && hops < 16; hops++) { cursor = parent[cursor]!; path.push(cursor); }
          if (!used.has(cursor) || cursor === k) continue;
          let ancestor = k, detour = 0;
          for (; ancestor >= 0 && ancestor !== cursor && detour < 80; detour++) ancestor = parent[ancestor]!;
          if (ancestor === cursor && detour < path.length + 5) continue;
          if (Math.abs(heights[k]! - heights[next]!) / step > .35) continue;
          const a = node(k), b = node(next), key = [a.x, a.z, b.x, b.z].join(':'), reverse = [b.x, b.z, a.x, a.z].join(':');
          if (linked.has(key) || linked.has(reverse)) continue;
          const crossing = crossingAt(k, next); if (crossing === false) continue;
          if (crossing && bridgeConflict(k, next, crossing)) continue;
          addEdge(k, next, crossing); linked.add(key);
          if (crossing) reservedBridges.push({ k, next, width: crossing.large ? 16 : 3 });
          for (let i = 0; i < path.length - 1; i++) {
            const p = path[i]!;
            if (!used.has(p)) { addEdge(p, path[i + 1]!, parentBridge.get(p) ?? null); used.add(p); }
          }
          this.loopCount++; break;
        }
      }
    }
    const shoreNodes = new Set(bridgeEdges.flatMap(e => [e.a, e.b]));
    const neighbours = new Map<Node, Node[]>();
    for (const [a, b] of edges) for (const [u, v] of [[a, b], [b, a]]) {
      let list = neighbours.get(u!); if (!list) neighbours.set(u!, list = []); list.push(v!);
    }
    // Round bends without moving junctions or entrances; smooth the roadbed heights.
    for (let pass = 0; pass < 4; pass++) {
      const updates: Array<[Node, number, number, number]> = [];
      for (const [point, near] of neighbours) if (!point.fixed && !shoreNodes.has(point) && near.length === 2) {
        updates.push([point, point.x * .75 + (near[0]!.x + near[1]!.x) * .125,
          point.z * .75 + (near[0]!.z + near[1]!.z) * .125, point.y * .5 + (near[0]!.y + near[1]!.y) * .25]);
      }
      for (const [point, x, z, y] of updates) { point.x = x; point.z = z; point.y = y; }
    }
    // Project onto a bounded grade while preserving foundation heights at entrances.
    if (enhanced) {
      // Lipschitz envelopes grade the entire cyclic network in O(E log V). Bridge edges
      // have zero vertical cost, keeping a perfectly level deck and flexible shore ramps.
      const points = [...neighbours.keys()], ids = new Map(points.map((p, i) => [p, i]));
      const adjacency: Array<Array<[number, number]>> = points.map(() => []);
      const spanPairs = new Map<Node, Set<Node>>();
      for (const { a, b } of bridgeEdges) { let set = spanPairs.get(a); if (!set) spanPairs.set(a, set = new Set()); set.add(b); }
      for (const [a, b] of edges) {
        const distance = spanPairs.get(a)?.has(b) ? 0 : Math.hypot(b.x - a.x, b.z - a.z) * ROAD_MAX_GRADE;
        adjacency[ids.get(a)!]!.push([ids.get(b)!, distance]); adjacency[ids.get(b)!]!.push([ids.get(a)!, distance]);
      }
      const project = (values: Float64Array) => {
        const queue = new IndexHeap(points.length);
        const done = new Uint8Array(points.length);
        values.forEach((value, i) => { if (Number.isFinite(value)) queue.push(i, value); });
        while (queue.size) {
          const k = queue.pop(); if (done[k]) continue; done[k] = 1;
          for (const [next, limit] of adjacency[k]!) if (values[next]! > values[k]! + limit) {
            values[next] = values[k]! + limit; queue.push(next, values[next]!);
          }
        }
        return values;
      };
      const upper = new Float64Array(points.length).fill(Infinity), lower = new Float64Array(points.length).fill(Infinity);
      points.forEach((p, i) => { if (p.fixed) { upper[i] = p.y; lower[i] = -p.y; } });
      for (const { a, b, crossing } of bridgeEdges) for (const p of [a, b]) {
        const i = ids.get(p)!; lower[i] = Math.min(lower[i]!, -crossing.water - (crossing.large ? 5 : 1.5));
      }
      project(upper); project(lower);
      const fitted = project(Float64Array.from(points, (p, i) => Math.min(upper[i]!, Math.max(-lower[i]!, p.y))));
      points.forEach((p, i) => { p.y = fitted[i]!; });
    } else for (let pass = 0; pass < 2048; pass++) {
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
      const crossing = bridgeEdges.find(e => e.a === a && e.b === b)?.crossing;
      const bridge: BridgeSpan | undefined = crossing ? { a, b, length, halfWidth: crossing.large ? 8 : 3, clearHalfWidth: crossing.large ? 4 : 2,
        kind: crossing.large ? 'large' : (['wood', 'stone', 'asphalt'] as const)[hash3(gen.seed, Math.round(a.x), Math.round(a.z), 0xb12) % 3]! } : undefined;
      if (bridge?.kind === 'large' && length >= 96 && hash3(gen.seed, this.bridges.length, 0, 0xcab) % 3 !== 0) {
        const start = Math.floor(length * .5 / 4) * 4 - 24;
        bridge.bay = { side: this.bridges.length % 2 ? -1 : 1, start, end: start + 48 };
      }
      if (bridge) this.bridges.push(bridge);
      const distanceFromCamp = Math.hypot((a.x + b.x) * .5 - gen.camp!.x, (a.z + b.z) * .5 - gen.camp!.z);
      const halfWidth = bridge?.halfWidth ?? (gen.config.generatorVersion >= 5 ? 1.5 + 1.9 * (1 - smoothstep(150, 1400, distanceFromCamp)) : ROAD_HALF_WIDTH);
      const segment: RoadSegment = { a, b, length, halfWidth, ...(bridge ? { bridge } : {}) };
      this.segments.push(segment);
      const margin = halfWidth + (bridge?.bay ? 8 : 0) + ROAD_SHOULDER;
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
    out.roadBridge = false; out.roadHalfWidth = ROAD_HALF_WIDTH; out.roadBridgeEnd = Infinity;
    for (const { a, b, length, bridge, halfWidth } of this.buckets.get(`${Math.floor(x / CHUNK_SIZE)}:${Math.floor(z / CHUNK_SIZE)}`) ?? []) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (length * length)));
      const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      if (distance >= out.roadDistance) continue;
      out.roadDistance = distance; out.roadHeight = a.y + (b.y - a.y) * t; out.roadAlong = t * length;
      out.roadBridge = !!bridge; out.roadHalfWidth = halfWidth;
      if (bridge?.bay && t * length >= bridge.bay.start && t * length <= bridge.bay.end) out.roadHalfWidth += 8;
      out.roadBridgeEnd = bridge ? Math.min(t * length, (1 - t) * length) : Infinity;
    }
  }

  surface(sample: RoadQuery, x: number, z: number): Surface | null {
    if (sample.roadBridge) return null;
    const d = sample.roadDistance;
    const width = sample.roadHalfWidth ?? ROAD_HALF_WIDTH;
    if (d > width + ROAD_SHOULDER) return null;
    if (d > width) return Surface.RoadVerge;
    // Broad, faded ruts; broken patches keep the track from looking freshly painted.
    const worn = .25 + .15 * Math.sin(x * .17 + z * .13);
    return Math.abs(d - .95) < worn ? Surface.WheelTrack : Surface.DirtRoad;
  }

  blend(sample: RoadQuery): number {
    if (sample.roadBridge) return 0;
    const width = sample.roadHalfWidth ?? ROAD_HALF_WIDTH;
    return 1 - smoothstep(width, width + ROAD_SHOULDER, sample.roadDistance);
  }

  private buildFences(gen: WorldGenerator): void {
    const left = makeColumnSample(), right = makeColumnSample();
    const query: RoadQuery = { roadDistance: 0, roadHeight: 0, roadAlong: 0 };
    for (let index = 0; index < this.segments.length; index++) {
      const { a, b, length, bridge, halfWidth } = this.segments[index]!;
      if (bridge) continue;
      const nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
      for (let d = 2; d < length; d += 4) {
        const t = d / length, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
        if (gen.camp && campDistance(gen.camp, x, z) < CAMP_PAD + 12) continue;
        if (insideStructure(gen, x, z, 8)) continue;
        gen.sampleColumn(x + nx * 8, z + nz * 8, left);
        gen.sampleColumn(x - nx * 8, z - nz * 8, right);
        const side = left.height < right.height ? 1 : -1;
        if (y - Math.min(left.height, right.height) < 2.5) continue;
        const fx = x + nx * side * (halfWidth + 1), fz = z + nz * side * (halfWidth + 1);
        this.query(fx, fz, query);
        if (query.roadDistance < (query.roadHalfWidth ?? ROAD_HALF_WIDTH) + .65) continue; // Leave junctions and bridge approaches open.
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
