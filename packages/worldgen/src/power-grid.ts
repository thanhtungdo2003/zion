import { CHUNK_SIZE, hash3, quantizeHeight, quantizeLocal, quantizeRotation, quantizeScale, smoothstep, type PropInstance } from '@zion/shared';
import { CAMP_ASSET, GRID_ASSET } from '@zion/assets';
import { CAMP_PAD, campDistance } from './camp';
import { makeColumnSample, type WorldGenerator } from './generator';
import type { PowerCable } from './maps/authored';
import type { RoadQuery, RoadSegment } from './roads';
import { structuresNear } from './structures';

/** Distance between poles along a line (m). */
const SPACING = 36;
/** The camp utility pole, scaled up to carry a road-side distribution line. */
const POLE_SCALE = 1.5;
/** Where the four conductors leave each pole: offsets along its cross-arm and their height. */
const ARMS = [-1.25, -.625, .625, 1.25].map((x) => x * POLE_SCALE);
const ARM_HEIGHT = 5.86 * POLE_SCALE;
/** Gap between the carriageway edge and a pole (m). */
const VERGE = 2.6;
const TOWN_VERGE = 1.3;
const SALT = 0x9071d;

export type PoleState = 'standing' | 'leaning' | 'fallen';
export interface GridPole { x: number; y: number; z: number; yaw: number; state: PoleState; ivy: boolean; line: number; live: boolean }

/**
 * A seeded distribution grid strung along the survival road network: one pole line per road
 * stretch, on one side of it. Some lines still carry their cables, others were stripped long ago;
 * poles lean, lie snapped in the verge, and ivy and moss climb the ones still standing.
 */
export class PowerGrid {
  readonly poles: GridPole[] = [];
  private readonly chunks = new Map<string, PropInstance[]>();
  private readonly wires: PowerCable[] = [];

  constructor(private readonly gen: WorldGenerator, segments: readonly RoadSegment[]) {
    const probe: RoadQuery = { roadDistance: 0, roadHeight: 0, roadAlong: 0 };
    const ground = makeColumnSample();
    chains(segments).forEach((chain, line) => {
      const roll = (k: number, salt: number) => (hash3(gen.seed, line, k, SALT + salt) >>> 0) % 100;
      const side = roll(0, 1) < 50 ? 1 : -1, live = roll(0, 2) < 55;
      // A run of consecutive standing poles: the cables hang between them.
      let run: GridPole[] = [], broken: GridPole | null = null;
      const close = () => { if (run.length > 1 && live) this.string(run); run = []; };
      for (const [k, station] of stations(chain, SPACING).entries()) {
        const { x: cx, z: cz, dx, dz, segment } = station;
        const nx = -dz * side, nz = dx * side;
        const width = segment.widthA === undefined ? segment.halfWidth : Math.max(segment.widthA, segment.widthB ?? segment.widthA);
        // In town the poles stand on the pavement, in front of the houses.
        const verge = structuresNear(gen, cx, cz, 0).some((s) => s.kind === 'town') ? TOWN_VERGE : VERGE;
        const x = cx + nx * (width + verge), z = cz + nz * (width + verge);
        if (!this.standable(x, z, probe, ground)) { close(); broken = null; continue; }
        const r = roll(k + 1, 3);
        let state: PoleState = live ? (r < 82 ? 'standing' : r < 92 ? 'leaning' : 'fallen') : r < 62 ? 'standing' : r < 82 ? 'leaning' : 'fallen';
        const jitter = (roll(k + 1, 4) / 100 - .5) * (state === 'fallen' ? 1 : state === 'leaning' ? .6 : 0);
        // Local +Z runs along the road; local +X points away from it for side −1 (lean outward).
        const along = Math.atan2(dx, dz);
        let yaw = state === 'standing' ? along : along + (side > 0 ? Math.PI : 0) + jitter;
        // A broken pole must not fall across a carriageway (bends, junctions): tip it the other way,
        // or leave it standing.
        if (state !== 'standing' && this.blocksRoad(x, z, yaw, state, probe)) {
          if (!this.blocksRoad(x, z, yaw + Math.PI, state, probe)) yaw += Math.PI;
          else { state = 'standing'; yaw = along; }
        }
        const pole: GridPole = { x, y: ground.height, z, yaw, state, ivy: roll(k + 1, 5) < (live ? 40 : 62), line, live };
        this.poles.push(pole);
        this.place(pole);
        if (state === 'standing') {
          // Cables torn off a broken pole hang from both of its standing neighbours.
          if (live && !run.length && broken) this.dangle(pole, broken);
          run.push(pole);
        } else {
          if (live && run.length) this.dangle(run[run.length - 1]!, pole);
          close(); broken = pole;
        }
      }
      close();
    });
  }

  /** Dry, gentle ground off every carriageway, outside buildings, away from the camp. */
  private standable(x: number, z: number, probe: RoadQuery, ground: ReturnType<typeof makeColumnSample>): boolean {
    const gen = this.gen;
    if (x < 8 || z < 8 || x > gen.worldSize - 8 || z > gen.worldSize - 8) return false;
    if (gen.camp && campDistance(gen.camp, x, z) < CAMP_PAD + 10) return false;
    // Town streets keep their poles; any other site's yard does not.
    if (structuresNear(gen, x, z, 1).some((s) => s.kind !== 'town')) return false;
    gen.sampleColumn(x, z, ground);
    if (ground.height < gen.seaLevel + .5 || (ground.water === ground.water && ground.water > ground.height - .2)) return false;
    if (gen.slopeAt(x, z, ground.height) > .7) return false;
    probe.roadDistance = Infinity;
    const roads = gen.roads;
    if (!roads) return false;
    roads.query(x, z, probe);
    return !probe.roadBridge && probe.roadDistance > (probe.roadHalfWidth ?? 2.4) + 1.2;
  }

  /** Does a leaning or fallen pole at (x, z), tipped along its local +X, reach over a road? */
  blocksRoad(x: number, z: number, yaw: number, state: PoleState, probe: RoadQuery): boolean {
    const reach = state === 'fallen' ? 8.6 : 3.6, c = Math.cos(yaw), s = Math.sin(yaw);
    for (const t of [.35, .7, 1]) {
      probe.roadDistance = Infinity;
      this.gen.roads?.query(x + c * reach * t, z - s * reach * t, probe);
      if (probe.roadDistance < (probe.roadHalfWidth ?? 2.4) + .6) return true;
    }
    return false;
  }

  private place(p: GridPole): void {
    const cx = Math.floor(p.x / CHUNK_SIZE), cz = Math.floor(p.z / CHUNK_SIZE), key = `${cx}:${cz}`;
    let list = this.chunks.get(key); if (!list) this.chunks.set(key, list = []);
    const put = (asset: number, y: number) => list!.push({ asset, lx: quantizeLocal(p.x - cx * CHUNK_SIZE), lz: quantizeLocal(p.z - cz * CHUNK_SIZE), yq: quantizeHeight(y), rot: quantizeRotation(p.yaw), scale: quantizeScale(POLE_SCALE) });
    if (p.state === 'standing') { put(CAMP_ASSET['utility-pole'], p.y - .1); if (p.ivy) put(GRID_ASSET.ivy, p.y - .1); }
    else if (p.state === 'leaning') put(GRID_ASSET.poleLeaning, p.y - .15);
    else { put(GRID_ASSET.poleFallen, p.y - .05); if (p.ivy) put(GRID_ASSET.ivyFallen, p.y - .05); }
  }

  /** World position of one conductor's insulator on a standing pole. */
  private arm(p: GridPole, offset: number): [number, number, number] {
    // Local x → (cos, −sin).
    return [+(p.x + offset * Math.cos(p.yaw)).toFixed(2), +(p.y - .1 + ARM_HEIGHT).toFixed(2), +(p.z - offset * Math.sin(p.yaw)).toFixed(2)];
  }

  private string(run: GridPole[]): void {
    for (const offset of ARMS) this.wires.push({ kind: 'hframe', points: run.map((p) => this.arm(p, offset)) });
  }

  /** Snapped conductors hanging from the last good pole down into the grass towards a broken one. */
  private dangle(from: GridPole, broken: GridPole): void {
    const span = Math.hypot(broken.x - from.x, broken.z - from.z);
    if (span < 1) return;
    ARMS.forEach((offset, i) => {
      const [ax, ay, az] = this.arm(from, offset);
      const reach = .3 + .15 * i + smoothstep(0, 1, (hash3(this.gen.seed, Math.round(from.x), Math.round(from.z), SALT + i) >>> 0) / 0xffffffff) * .2;
      const x = ax + (broken.x - from.x) * reach, z = az + (broken.z - from.z) * reach;
      this.wires.push({ kind: 'hframe', points: [[ax, ay, az], [+x.toFixed(2), +(this.gen.heightAt(x, z) + .05).toFixed(2), +z.toFixed(2)]] });
    });
  }

  chunkProps(cx: number, cz: number): readonly PropInstance[] { return this.chunks.get(`${cx}:${cz}`) ?? []; }
  cables(): readonly PowerCable[] { return this.wires; }
}

/** Maximal runs of road between junctions, dead ends and bridges, as ordered segment lists. */
function chains(segments: readonly RoadSegment[]): RoadSegment[][] {
  type Node = RoadSegment['a'];
  const land = segments.filter((s) => !s.bridge);
  const at = new Map<Node, RoadSegment[]>();
  for (const s of land) for (const n of [s.a, s.b]) { let list = at.get(n); if (!list) at.set(n, list = []); list.push(s); }
  const used = new Set<RoadSegment>(), out: RoadSegment[][] = [];
  const walk = (start: Node, first: RoadSegment) => {
    const chain: RoadSegment[] = [];
    let node = start, seg: RoadSegment | undefined = first;
    while (seg && !used.has(seg)) {
      used.add(seg);
      // Orient every segment in walking order.
      chain.push(seg.a === node ? seg : { ...seg, a: seg.b, b: seg.a, widthA: seg.widthB, widthB: seg.widthA });
      node = seg.a === node ? seg.b : seg.a;
      const next: RoadSegment[] = at.get(node) ?? [];
      seg = next.length === 2 ? next.find((s) => s !== seg) : undefined;
    }
    if (chain.length) out.push(chain);
  };
  // Ends and junctions first, then any closed loops left over.
  for (const s of land) for (const n of [s.a, s.b]) if ((at.get(n)?.length ?? 0) !== 2) for (const t of at.get(n)!) if (!used.has(t)) walk(n, t);
  for (const s of land) if (!used.has(s)) walk(s.a, s);
  return out;
}

interface Station { x: number; z: number; dx: number; dz: number; segment: RoadSegment }
/** Evenly spaced points along a chain, starting a few metres in from its first node. */
function stations(chain: readonly RoadSegment[], spacing: number): Station[] {
  const out: Station[] = [];
  let next = 8;
  let travelled = 0;
  for (const segment of chain) {
    const { a, b, length } = segment;
    const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
    while (next <= travelled + length) {
      const t = next - travelled;
      out.push({ x: a.x + dx * t, z: a.z + dz * t, dx, dz, segment });
      next += spacing;
    }
    travelled += length;
  }
  // Leave the last few metres before a junction clear.
  while (out.length && travelled - (next - spacing) < 6 && out.length > 1) { out.pop(); next -= spacing; }
  return out;
}
