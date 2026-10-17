import {
  DEFAULT_CHARACTER, Layer, Mask, makeRayHit,
  type CollisionWorld, type Contact,
} from '@zion/physics';

export interface NavPoint { x: number; y: number; z: number }

const CELL = 0.5;
const SAMPLE = 0.2;
const CLEARANCE = 0.04;
const MAX_NODES = 12_000;
const DETOUR_MARGIN = 18;
const NEIGHBORS = [-1, 0, 1] as const;
/** Door colliders (frames and leaves) carry the door asset id. */
const DOOR_TAG = 2202;

/** Local, single-surface walking navigation using the same solids and dimensions as physics. */
export class WalkingMap {
  private readonly hit = makeRayHit();
  private readonly contacts: Contact[] = [];

  constructor(private readonly world: CollisionWorld) {}

  /** Sample the entire capsule corridor, including support, steps, slopes and headroom. */
  trace(from: NavPoint, x: number, z: number): NavPoint | null {
    const p = DEFAULT_CHARACTER;
    const distance = Math.hypot(x - from.x, z - from.z);
    const count = Math.max(1, Math.ceil(distance / SAMPLE));
    let y = from.y;
    for (let i = 1; i <= count; i++) {
      const previousY = y;
      const px = from.x + (x - from.x) * i / count;
      const pz = from.z + (z - from.z) * i / count;
      if (px < p.boundsMargin || pz < p.boundsMargin ||
          px > this.world.worldSize - p.boundsMargin || pz > this.world.worldSize - p.boundsMargin) return null;
      const margin = p.radius + 1.5;
      if (!this.world.isAreaLoaded(px - margin, pz - margin, px + margin, pz + margin)) return null;
      // The capsule's foot bridges a narrow gap (between a stair and the floor beside it).
      if (!this.support(px, y + p.stepHeight + 0.02, pz, p.stepHeight + p.snapDistance + 0.04, p.radius * 0.8)) return null;
      if (this.hit.ny < p.walkableNormalY) return null;
      const floor = this.hit.y;
      if (this.world.waterLevel(px, pz) - floor > p.wadeDepth) return null;
      // A capsule stands slightly above the heightfield on slopes because its foot is rounded.
      y = floor + p.radius * (1 / this.hit.ny - 1) + 0.01;
      const radius = p.radius + CLEARANCE;
      // A door leaf is no wall: walkers open it on the way (bots and zombies push doors open).
      const blocked = (feet: number) => {
        const n = this.world.capsuleContacts(px, feet + radius, pz, px, feet + p.height - radius, pz, radius, Mask.CharacterMovement & ~Layer.Terrain, this.contacts);
        for (let k = 0; k < n; k++) if (this.contacts[k]!.depth > 0.04 && this.contacts[k]!.tag !== DOOR_TAG) return true;
        return false;
      };
      if (blocked(y)) {
        // The rounded foot touches a step before its centre reaches the top. Probe the leading
        // edge, as the controller does, and retain the previous height while leaving a step.
        const lead = (radius + SAMPLE / 2) / Math.max(distance, 0.001);
        let raised = Math.max(y, previousY);
        // The step's top may begin a little further on (a lip, a gap at a threshold): look ahead.
        for (const k of [1, 1.6, 2.3]) {
          if (this.down(px + (x - from.x) * lead * k, previousY + p.stepHeight + 0.02, pz + (z - from.z) * lead * k, p.stepHeight + 0.04) &&
            this.hit.ny >= p.walkableNormalY && this.hit.y + 0.01 > raised) { raised = this.hit.y + 0.01; break; }
        }
        if (raised <= y || raised - previousY > p.stepHeight + 0.01 || blocked(raised)) return null;
        y = raised;
      }
    }
    return { x, y, z };
  }

  /** Ground under (x, z), or under the foot's rim within `rim` when the centre is over a gap. */
  private support(x: number, y: number, z: number, length: number, rim: number): boolean {
    if (this.down(x, y, z, length)) return true;
    let best = -Infinity, nx = 0, ny = 0, nz = 0, hx = 0, hz = 0;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      if (this.down(x + Math.cos(a) * rim, y, z + Math.sin(a) * rim, length) && this.hit.y > best) { best = this.hit.y; nx = this.hit.nx; ny = this.hit.ny; nz = this.hit.nz; hx = this.hit.x; hz = this.hit.z; }
    }
    if (best === -Infinity) return false;
    Object.assign(this.hit, { y: best, nx, ny, nz, x: hx, z: hz });
    return true;
  }

  /** Downward ray to walkable ground that looks through door leaves (they swing open). */
  private down(x: number, y: number, z: number, length: number): boolean {
    let top = y;
    for (let i = 0; i < 24; i++) {
      if (!this.world.raycast(x, top, z, 0, -1, 0, y - length - top < 0 ? top - (y - length) : 0, Mask.CharacterMovement, this.hit)) return false;
      if (this.hit.tag !== DOOR_TAG) return true;
      top = this.hit.t > 0.001 ? this.hit.y - 0.001 : top - 0.04;
      if (top <= y - length) return false;
    }
    return false;
  }

  /** `p`, or the closest point within 0.4 m that a walker can leave from. */
  freeNear(p: NavPoint): NavPoint {
    if (this.trace(p, p.x + .01, p.z)) return p;
    for (const r of [.15, .3, .4]) for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, q = this.trace(p, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
      if (q) return q;
    }
    return p;
  }

  reaches(from: NavPoint, to: NavPoint): boolean {
    const end = this.trace(from, to.x, to.z);
    return !!end && Math.abs(end.y - to.y) <= DEFAULT_CHARACTER.stepHeight;
  }

  canStopNear(from: NavPoint, to: NavPoint): boolean {
    return distance(from, to) <= 1 && Math.abs(from.y - to.y) < 0.5 &&
      this.world.lineOfSight(from.x, from.y + 0.9, from.z, to.x, to.y + 0.9, to.z,
        Mask.LineOfSight, this.hit);
  }
}

interface Node extends NavPoint {
  key: string;
  g: number;
  h: number;
  parent: Node | null;
}

/** Immutable heap entries allow cheap decrease-key by discarding stale entries when popped. */
class OpenSet {
  private readonly entries: Node[] = [];
  push(node: Node): void {
    const a = this.entries;
    let i = a.length;
    a.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(node, a[parent]!)) break;
      a[i] = a[parent]!;
      i = parent;
    }
    a[i] = node;
  }
  pop(): Node | undefined {
    const a = this.entries;
    const first = a[0];
    const last = a.pop();
    if (a.length && last) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let child = i * 2 + 1;
        if (child + 1 < a.length && this.before(a[child + 1]!, a[child]!)) child++;
        if (!this.before(a[child]!, last)) break;
        a[i] = a[child]!;
        i = child;
      }
      a[i] = last;
    }
    return first;
  }
  private before(a: Node, b: Node): boolean {
    return a.g + a.h < b.g + b.h || (a.g + a.h === b.g + b.h && a.h < b.h);
  }
}

/** Incremental A* with distance costs on a local eight-neighbor grid and bounded work. */
export class WalkingSearch {
  private readonly open = new OpenSet();
  private readonly best = new Map<string, Node>();
  private visited = 0;
  done = false;
  path: NavPoint[] = [];

  constructor(private readonly map: WalkingMap, private start: NavPoint, readonly goal: NavPoint, private readonly maxNodes = MAX_NODES) {
    // A walker pressed against a wall has no clearance at its feet: start from the nearest free spot.
    this.start = start = map.freeNear(start);
    const first: Node = { ...start, key: 'start', g: 0, h: distance(start, goal), parent: null };
    this.open.push(first);
    this.best.set(first.key, first);
  }

  advance(budget: number): number {
    let used = 0;
    while (!this.done && used < budget) {
      const node = this.open.pop();
      if (!node || this.visited >= this.maxNodes) {
        this.done = true;
        break;
      }
      used++;
      if (this.best.get(node.key) !== node) continue;
      this.visited++;
      if (node.h <= 1 && this.map.canStopNear(node, this.goal)) {
        // A player hugging a wall may not have the extra navigation clearance at its exact feet.
        this.path = this.map.reaches(node, this.goal) ? [this.goal] : [];
        for (let n: Node | null = node; n?.parent; n = n.parent) this.path.push(n);
        this.path.reverse();
        this.done = true;
        break;
      }
      const ix = Math.round(node.x / CELL);
      const iz = Math.round(node.z / CELL);
      for (const dx of NEIGHBORS) for (const dz of NEIGHBORS) {
        if (dx === 0 && dz === 0 && node.parent) continue;
        const x = (ix + dx) * CELL;
        const z = (iz + dz) * CELL;
        if (Math.abs(x - node.x) + Math.abs(z - node.z) < 1e-6) continue;
        if (x < Math.min(this.start.x, this.goal.x) - DETOUR_MARGIN ||
            x > Math.max(this.start.x, this.goal.x) + DETOUR_MARGIN ||
            z < Math.min(this.start.z, this.goal.z) - DETOUR_MARGIN ||
            z > Math.max(this.start.z, this.goal.z) + DETOUR_MARGIN) continue;
        const g = node.g + Math.hypot(x - node.x, z - node.z);
        // Cells are per floor: a stair over the same ground as the room below is its own node.
        const point = this.map.trace(node, x, z);
        if (!point) continue;
        const key = `${ix + dx},${iz + dz},${Math.round(point.y / 0.6)}`;
        if ((this.best.get(key)?.g ?? Infinity) <= g) continue;
        const next: Node = { ...point, key, g, h: distance(point, this.goal), parent: node };
        this.best.set(key, next);
        this.open.push(next);
      }
    }
    return used;
  }
}

export class NavigationState {
  path: NavPoint[] = [];
  search: WalkingSearch | null = null;
  goal: NavPoint | null = null;
  refreshAt = 0;
  progressAt = 0;
  progress: NavPoint | null = null;
}

/** Per-director budget prevents a horde of blocked mobs from searching an entire map in one tick. */
export class ZombieNavigation {
  readonly map: WalkingMap;
  private readonly pending = new Set<NavigationState>();

  /** `budget`: search nodes per tick for everyone, `perAgent`: for one walker per tick. */
  constructor(world: CollisionWorld, private readonly budget = 512, private readonly perAgent = 64, private readonly maxNodes = MAX_NODES) { this.map = new WalkingMap(world); }

  beginTick(): void {
    let budget = this.budget;
    // Rotate the queue so later mobs also get time when the whole horde is blocked.
    for (const nav of [...this.pending]) {
      if (budget <= 0) break;
      this.pending.delete(nav);
      if (nav.search && !nav.search.done) {
        budget -= nav.search.advance(Math.min(this.perAgent, budget));
        if (!nav.search.done) this.pending.add(nav);
      }
    }
  }

  clear(nav: NavigationState): void {
    this.pending.delete(nav);
    nav.path = [];
    nav.search = null;
    nav.goal = null;
    nav.progress = null;
    nav.refreshAt = 0;
  }

  steer(nav: NavigationState, from: NavPoint, goal: NavPoint, now: number): NavPoint | null {
    if (![goal.x, goal.y, goal.z].every(Number.isFinite)) {
      this.clear(nav);
      return null;
    }
    const moved = !nav.goal || distance(nav.goal, goal) > 1.5 || Math.abs(nav.goal.y - goal.y) > 0.5;
    if (nav.search && (distance(nav.search.goal, goal) > 8 || Math.abs(nav.search.goal.y - goal.y) > 1.5)) {
      this.pending.delete(nav);
      nav.search = null;
    }
    if (!nav.search && now >= nav.refreshAt) {
      nav.refreshAt = now + 750;
      if (this.map.reaches(from, goal)) {
        nav.goal = { ...goal };
        nav.path = [{ ...goal }];
      }
      else if (moved || nav.path.length === 0) {
        nav.goal = { ...goal };
        nav.search = new WalkingSearch(this.map, { ...from }, { ...goal }, this.maxNodes);
        this.pending.add(nav);
      }
    }
    if (nav.search?.done) {
      nav.path = nav.search.path;
      nav.search = null;
      nav.progress = null;
      nav.refreshAt = now + (nav.path.length ? 750 : 1500);
    }
    while (nav.path.length && distance(from, nav.path[0]!) < 0.2) nav.path.shift();
    if (!nav.path.length) return null;

    // Skip nearby waypoints only when the whole capsule can take the shortcut.
    for (let i = Math.min(nav.path.length - 1, 6); i > 0; i--) {
      if (this.map.reaches(from, nav.path[i]!)) {
        nav.path.splice(0, i);
        break;
      }
    }
    const next = nav.path[0]!;
    // Validate the immediate corridor every tick so newly placed solids stop the mob promptly.
    const d = distance(from, next);
    const fraction = Math.min(1, 0.8 / Math.max(d, 0.001));
    if (!this.map.trace(from, from.x + (next.x - from.x) * fraction, from.z + (next.z - from.z) * fraction)) {
      nav.path = [];
      nav.refreshAt = Math.min(nav.refreshAt, now + 200);
      return null;
    }
    if (!nav.progress || now >= nav.progressAt) {
      if (nav.progress && distance(from, nav.progress) < 0.15 && d > 0.3) {
        nav.path = [];
        this.pending.delete(nav);
        nav.search = null;
        nav.refreshAt = now + 200;
      }
      nav.progress = { ...from };
      nav.progressAt = now + 1200;
    }
    return nav.path.length ? next : null;
  }
}

function distance(a: NavPoint, b: NavPoint): number { return Math.hypot(a.x - b.x, a.z - b.z); }
