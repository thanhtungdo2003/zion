import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';
import {
  BLUEPRINT_BY_ID,
  MATERIAL_COLOR,
  SUPPLY_ZONE_RADIUS,
  VEHICLES,
  structureToWorld,
  type BlueprintDef,
  type StructureState,
  type SupplyMessage,
  type TreesMessage,
} from '@zion/shared';
import { piecesOf } from '@zion/physics';
import type { AssetLibrary } from './asset-library';
import { BB_UNITS_PER_METER, loadCharacterModel, sampleTrack, type CharacterTemplate } from './character-model';
import type { DebrisSystem } from './debris';

const box = new BoxGeometry(1, 1, 1);

/* -------------------------------------- felled trees ------------------------------------- */

interface Trunk { key: string; root: Group; pivot: Group; angle: number; speed: number; settled: boolean; length: number; logs: number }

/**
 * Felled trees: the tree's own model swings down about its base with real rod-pivot dynamics
 * (θ'' = 3g/2L · sin θ), bounces once and lies where it fell until its logs are gathered.
 */
export class FelledTrees {
  private readonly trunks = new Map<string, Trunk>();
  constructor(private readonly scene: Scene, private readonly library: AssetLibrary) {}

  get list(): ReadonlyMap<string, { x: number; z: number; y: number; dir: number; length: number; logs: number }> {
    const out = new Map<string, { x: number; z: number; y: number; dir: number; length: number; logs: number }>();
    for (const [k, t] of this.trunks) out.set(k, { x: t.root.position.x, y: t.root.position.y, z: t.root.position.z, dir: t.pivot.rotation.y, length: t.length, logs: t.logs });
    return out;
  }

  apply(msg: TreesMessage, fresh: boolean): void {
    const keep = new Set(msg.trunks.map((t) => t.key));
    for (const [k, t] of this.trunks) if (!keep.has(k)) { this.scene.remove(t.root); this.trunks.delete(k); }
    for (const t of msg.trunks) {
      const known = this.trunks.get(t.key);
      if (known) { known.logs = t.logs; continue; }
      const visual = this.library.get(t.asset);
      if (!visual) { void this.library.load(t.asset); continue; }
      const root = new Group(), pivot = new Group(), model = new Group();
      for (const part of visual.parts) {
        const m = new Mesh(part.geometry, part.material);
        m.castShadow = true;
        model.add(m);
      }
      pivot.rotation.order = 'YXZ';
      pivot.rotation.y = t.dir;
      model.rotation.y = t.rotY - t.dir;
      model.scale.setScalar(t.scale);
      pivot.add(model);
      root.add(pivot);
      root.position.set(t.x, t.y, t.z);
      this.scene.add(root);
      const height = ((visual.def.bounds.height || 6) * t.scale);
      // A tree that was already down when we arrived starts lying.
      const lying = !fresh;
      const trunk: Trunk = { key: t.key, root, pivot, angle: lying ? Math.PI / 2 - .04 : .02, speed: 0, settled: lying, length: Math.max(2, height), logs: t.logs };
      pivot.rotation.x = trunk.angle;
      this.trunks.set(t.key, trunk);
    }
  }

  update(dt: number): void {
    for (const t of this.trunks.values()) {
      if (t.settled) continue;
      const step = Math.min(dt, 1 / 30);
      t.speed += (3 * 9.81 / (2 * t.length)) * Math.sin(t.angle) * step;
      t.angle += t.speed * step;
      const rest = Math.PI / 2 - .04;
      if (t.angle >= rest) {
        t.angle = rest;
        // One heavy bounce on the branches, then it lies still.
        if (t.speed > 1) t.speed = -t.speed * .18; else { t.speed = 0; t.settled = true; }
      }
      t.pivot.rotation.x = t.angle;
    }
  }

  dispose(): void {
    for (const t of this.trunks.values()) this.scene.remove(t.root);
    this.trunks.clear();
  }
}

/* --------------------------------------- structures -------------------------------------- */

interface StructureVisual { state: StructureState; root: Group; pieces: Array<Mesh | null>; light: PointLight | null; core: Mesh | null }

const crackTexture = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#2a2420'; g.lineWidth = 1.4;
  for (let i = 0; i < 9; i++) {
    let x = Math.random() * 64, y = Math.random() * 64;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (Math.random() - .5) * 22; y += (Math.random() - .5) * 22; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new CanvasTexture(c);
  return t;
})();

/**
 * Player structures: one box per piece in its material's colour, darker and cracked as it loses
 * health, doors swung open, a glowing nuclear core inside; destroyed pieces burst into debris.
 */
export class StructureRenderer {
  private readonly visuals = new Map<number, StructureVisual>();
  private readonly materials = new Map<string, MeshLambertMaterial>();
  private readonly coreMat = new MeshLambertMaterial({ color: '#2b3a2f', emissive: new Color('#39ff8a'), emissiveIntensity: 1.6 });
  private readonly coreGlass = new MeshBasicMaterial({ color: '#7dffb8', transparent: true, opacity: .55, blending: AdditiveBlending, depthWrite: false });
  constructor(private readonly scene: Scene, private readonly debris: () => DebrisSystem | null) {}

  get states(): IterableIterator<StructureState> { return [...this.visuals.values()].map((v) => v.state).values(); }
  get(id: number): StructureState | undefined { return this.visuals.get(id)?.state; }

  private material(def: BlueprintDef, damage: number): MeshLambertMaterial {
    const level = Math.min(3, Math.floor(damage * 4));
    const key = `${def.material}:${level}`;
    let m = this.materials.get(key);
    if (!m) {
      const c = new Color(MATERIAL_COLOR[def.material]).multiplyScalar(1 - level * .16);
      m = new MeshLambertMaterial({ color: c, ...(level > 0 && crackTexture ? { map: crackTexture } : {}) });
      this.materials.set(key, m);
    }
    return m;
  }

  setAll(list: readonly StructureState[]): void {
    for (const id of [...this.visuals.keys()]) if (!list.some((s) => s.id === id)) this.remove(id, false);
    for (const s of list) this.set(s);
  }

  set(s: StructureState, hit?: { piece: number; x: number; y: number; z: number; broke: boolean }): void {
    const def = BLUEPRINT_BY_ID.get(s.blueprint);
    if (!def) return;
    let v = this.visuals.get(s.id);
    const pieces = piecesOf(s.blueprint);
    if (!v) {
      const root = new Group();
      root.position.set(s.x, s.y, s.z);
      root.rotation.y = s.yaw;
      this.scene.add(root);
      v = { state: s, root, pieces: [], light: null, core: null };
      this.visuals.set(s.id, v);
    }
    const prev = v.state;
    v.state = s;
    pieces.forEach((pc, i) => {
      const hp = s.hp[i] ?? 0;
      let mesh = v!.pieces[i] ?? null;
      if (hp <= 0) {
        if (mesh) {
          // Broke just now: the piece shatters into chunks that tumble down.
          if ((prev.hp[i] ?? 0) > 0 && (hit?.piece === i || prev !== s)) this.shatter(mesh, pc.kind === 'core' ? '#39ff8a' : MATERIAL_COLOR[def.material], hit);
          v!.root.remove(mesh);
          v!.pieces[i] = null;
          if (pc.kind === 'core' && v!.light) { v!.root.remove(v!.light); v!.light = null; }
        }
        return;
      }
      if (!mesh) {
        if (pc.kind === 'core') {
          mesh = new Mesh(box, this.coreMat);
          const glass = new Mesh(new CylinderGeometry(.22, .22, 1.3, 12), this.coreGlass);
          mesh.add(glass);
          v!.core = mesh;
          v!.light = new PointLight('#5dffa0', 6, 14, 1.6);
          v!.light.position.set(pc.x, pc.y + .9, pc.z);
          v!.root.add(v!.light);
        } else mesh = new Mesh(box, this.material(def, 0));
        mesh.position.set(pc.x, pc.y, pc.z);
        mesh.scale.set(pc.hx * 2, pc.hy * 2, pc.hz * 2);
        if (pc.kind === 'core') { const g = mesh.children[0]!; g.scale.set(1 / (pc.hx * 2), 1 / (pc.hy * 2), 1 / (pc.hz * 2)); }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        v!.root.add(mesh);
        v!.pieces[i] = mesh;
      }
      if (pc.kind !== 'core') mesh.material = this.material(def, 1 - hp / Math.max(1, pc.hp));
      if (pc.kind === 'door') {
        // Open doors swing inwards on the left jamb (drawn only; the collider is gone).
        const open = s.open?.includes(i) ?? false;
        mesh.position.set(open ? pc.x - pc.hx + .1 : pc.x, pc.y, open ? pc.z + pc.hx : pc.z);
        mesh.scale.set(open ? .1 : pc.hx * 2, pc.hy * 2, open ? pc.hx * 2 : pc.hz * 2);
      }
    });
    if (hit && !hit.broke) this.flash(v, hit.piece);
  }

  private flash(v: StructureVisual, piece: number): void {
    const mesh = v.pieces[piece];
    if (!mesh) return;
    mesh.position.x += (Math.random() - .5) * .03;
    mesh.position.z += (Math.random() - .5) * .03;
  }

  /** A broken piece: chunks in its colour flying apart (the debris system gives them physics). */
  private shatter(mesh: Object3D, color: string, hit?: { x: number; y: number; z: number }): void {
    const debris = this.debris();
    mesh.updateMatrixWorld(true);
    const centre = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const size = new Vector3().setFromMatrixScale(mesh.matrixWorld);
    const mat = new MeshLambertMaterial({ color });
    const n = Math.min(10, Math.max(3, Math.round(size.x * size.y * size.z * 3)));
    for (let k = 0; k < n; k++) {
      const chunk = new Mesh(box, mat);
      chunk.scale.set(Math.max(.12, size.x / 3) * (.6 + Math.random() * .6), Math.max(.12, size.y / 3) * (.6 + Math.random() * .6), Math.max(.12, size.z / 3) * (.6 + Math.random() * .6));
      chunk.position.set(centre.x + (Math.random() - .5) * size.x, centre.y + (Math.random() - .5) * size.y, centre.z + (Math.random() - .5) * size.z);
      chunk.castShadow = true;
      this.scene.add(chunk);
      const away = hit ? new Vector3(chunk.position.x - hit.x, .6, chunk.position.z - hit.z).normalize().multiplyScalar(2 + Math.random() * 3) : new Vector3((Math.random() - .5) * 3, 1.5, (Math.random() - .5) * 3);
      if (debris) debris.add(chunk, away, new Vector3((Math.random() - .5) * 6, (Math.random() - .5) * 6, (Math.random() - .5) * 6));
      else this.scene.remove(chunk);
    }
  }

  remove(id: number, burst = true): void {
    const v = this.visuals.get(id);
    if (!v) return;
    const def = BLUEPRINT_BY_ID.get(v.state.blueprint);
    if (burst && def) for (const m of v.pieces) if (m) this.shatter(m, MATERIAL_COLOR[def.material]);
    this.scene.remove(v.root);
    this.visuals.delete(id);
  }

  /** Door pieces in the world (interaction targets). */
  doors(): Array<{ id: number; piece: number; x: number; y: number; z: number; open: boolean; owner: string; ownerName: string }> {
    const out: Array<{ id: number; piece: number; x: number; y: number; z: number; open: boolean; owner: string; ownerName: string }> = [];
    for (const v of this.visuals.values()) piecesOf(v.state.blueprint).forEach((pc, i) => {
      if (pc.kind !== 'door' || (v.state.hp[i] ?? 0) <= 0) return;
      const [x, z] = structureToWorld(v.state.x, v.state.z, v.state.yaw, pc.x, pc.z);
      out.push({ id: v.state.id, piece: i, x, y: v.state.y + 1.2, z, open: v.state.open?.includes(i) ?? false, owner: v.state.owner, ownerName: v.state.ownerName });
    });
    return out;
  }

  update(time: number): void {
    const pulse = 1.3 + Math.sin(time * 2.4) * .4;
    this.coreMat.emissiveIntensity = pulse;
    for (const v of this.visuals.values()) if (v.light) v.light.intensity = 4 + pulse * 2;
  }

  dispose(): void {
    for (const id of [...this.visuals.keys()]) this.remove(id, false);
    for (const m of this.materials.values()) m.dispose();
  }
}

/* ---------------------------------- placement hologram ----------------------------------- */

/**
 * The blueprint held up: a 1:1 blue hologram of every piece with glowing edges, and the footprint
 * drawn on the ground; it turns red where the structure may not stand.
 */
export class PlacementHologram {
  readonly root = new Group();
  private readonly fill = new MeshBasicMaterial({ color: '#3aa0ff', transparent: true, opacity: .22, depthWrite: false, side: DoubleSide });
  private readonly edge = new LineBasicMaterial({ color: '#7cc4ff', transparent: true, opacity: .95 });
  private readonly foot = new MeshBasicMaterial({ color: '#3aa0ff', transparent: true, opacity: .3, depthWrite: false, side: DoubleSide });
  private def: BlueprintDef | null = null;
  constructor(private readonly scene: Scene) {
    this.root.visible = false;
    scene.add(this.root);
  }

  show(def: BlueprintDef): void {
    if (this.def?.id !== def.id) {
      this.root.clear();
      this.def = def;
      const edges = new EdgesGeometry(box);
      for (const pc of piecesOf(def.id)) {
        const m = new Mesh(box, this.fill);
        m.position.set(pc.x, Math.max(pc.y, pc.hy * .5 - .2), pc.z);
        // Only the part above ground is drawn (walls reach down into slopes).
        const top = pc.y + pc.hy, bottom = Math.max(pc.y - pc.hy, -.05);
        m.position.y = (top + bottom) / 2;
        m.scale.set(pc.hx * 2, Math.max(.05, top - bottom), pc.hz * 2);
        m.renderOrder = 6;
        const line = new LineSegments(edges, this.edge);
        m.add(line);
        this.root.add(m);
      }
      const ground = new Mesh(new PlaneGeometry(def.w + .6, def.d + .6), this.foot);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = .06;
      ground.renderOrder = 5;
      this.root.add(ground);
    }
    this.root.visible = true;
  }

  place(x: number, y: number, z: number, yaw: number, ok: boolean, time: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    const color = ok ? '#3aa0ff' : '#ff3b3b';
    this.fill.color.set(color);
    this.foot.color.set(color);
    this.edge.color.set(ok ? '#9ed4ff' : '#ff9a9a');
    this.fill.opacity = .16 + Math.sin(time * 4) * .05;
  }

  hide(): void { this.root.visible = false; }

  dispose(): void { this.scene.remove(this.root); this.fill.dispose(); this.edge.dispose(); this.foot.dispose(); }
}

/* ------------------------------------- supply drops -------------------------------------- */

/**
 * Supply drops: the transport planes on their way, crates and vehicles coming down under red and
 * white canopies, and the red X painted on the drop zone beside the camp.
 */
export class SupplyRenderer {
  private planeTemplate: CharacterTemplate | null = null;
  private crateTemplate: CharacterTemplate | null = null;
  private readonly planes = new Map<number, Group>();
  private readonly drops = new Map<number, Group>();
  private zone: Group | null = null;
  private state: SupplyMessage = { t: 'supply', planes: [], drops: [] };
  private readonly vec: [number, number, number] = [0, 0, 0];
  private readonly canopyCloth = new MeshLambertMaterial({ color: '#e9ece6', side: DoubleSide });
  private readonly canopyStripe = new MeshLambertMaterial({ color: '#d62b2b', side: DoubleSide });
  private readonly cord = new LineBasicMaterial({ color: '#d5d0ba' });
  constructor(private readonly scene: Scene, private readonly library: AssetLibrary) {
    void Promise.all([loadCharacterModel('/models/dists/heavy-transport-plane.bbmodel'), loadCharacterModel('/models/dists/supply-crate.bbmodel')])
      .then(([plane, crate]) => { this.planeTemplate = plane; this.crateTemplate = crate; })
      .catch((err: unknown) => console.error('supply models failed', err));
  }

  get message(): SupplyMessage { return this.state; }

  /** The red X and the zone's edge, laid on the levelled ground. */
  setZone(zone: { x: number; y: number; z: number } | null | undefined): void {
    if (this.zone) { this.scene.remove(this.zone); this.zone = null; }
    if (!zone) return;
    const g = new Group();
    const red = new MeshBasicMaterial({ color: '#d81f1f', transparent: true, opacity: .9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new Mesh(new PlaneGeometry(SUPPLY_ZONE_RADIUS * 1.5, 2.2), red);
      bar.rotation.set(-Math.PI / 2, 0, a);
      bar.position.y = .07;
      bar.renderOrder = 3;
      g.add(bar);
    }
    const ring = new Mesh(new CylinderGeometry(SUPPLY_ZONE_RADIUS, SUPPLY_ZONE_RADIUS, .08, 48, 1, true), new MeshBasicMaterial({ color: '#d81f1f', transparent: true, opacity: .55, side: DoubleSide, depthWrite: false }));
    ring.position.y = .05;
    g.add(ring);
    // Corner beacons so the zone reads from afar.
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      const post = new Mesh(new CylinderGeometry(.08, .08, 2.2, 6), new MeshLambertMaterial({ color: '#d81f1f', emissive: new Color('#7a0d0d') }));
      post.position.set(Math.cos(a) * SUPPLY_ZONE_RADIUS, 1.1, Math.sin(a) * SUPPLY_ZONE_RADIUS);
      const lamp = new Mesh(new SphereGeometry(.16, 8, 6), new MeshBasicMaterial({ color: '#ff4b3b' }));
      lamp.position.set(0, 1.2, 0);
      post.add(lamp);
      g.add(post);
    }
    g.position.set(zone.x, zone.y, zone.z);
    this.scene.add(g);
    this.zone = g;
  }

  private canopy(): Group {
    const g = new Group();
    for (let i = 0; i < 10; i++) {
      const panel = new Mesh(new BoxGeometry(.9, .12, 3.6), i % 2 ? this.canopyStripe : this.canopyCloth);
      const x = (i - 4.5) * .88;
      panel.position.set(x, 6.4 - Math.pow(x / 4.6, 2) * 1.4, 0);
      panel.rotation.z = -x / 9;
      g.add(panel);
    }
    const lines: number[] = [];
    for (let i = 0; i < 10; i++) { const x = (i - 4.5) * .88; for (const z of [-1.6, 1.6]) lines.push(x, 6.3 - Math.pow(x / 4.6, 2) * 1.4, z, 0, .9, 0); }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(lines, 3));
    g.add(new LineSegments(geo, this.cord));
    return g;
  }

  apply(msg: SupplyMessage): void {
    this.state = msg;
    for (const [id, g] of this.planes) if (!msg.planes.some((p) => p.id === id)) { this.scene.remove(g); this.planes.delete(id); }
    for (const [id, g] of this.drops) if (!msg.drops.some((d) => d.id === id && !d.landed)) { this.scene.remove(g); this.drops.delete(id); }
    for (const p of msg.planes) {
      let g = this.planes.get(p.id);
      if (!g && this.planeTemplate) {
        g = this.planeTemplate.root.clone(true);
        g.scale.setScalar(BB_UNITS_PER_METER / 1.5);
        this.scene.add(g);
        this.planes.set(p.id, g);
      }
      if (g) { g.userData.target = [p.x, p.y, p.z]; g.rotation.y = p.yaw; if (!g.userData.placed) { g.position.set(p.x, p.y, p.z); g.userData.placed = true; } }
    }
    for (const d of msg.drops) {
      if (d.landed) continue;
      let g = this.drops.get(d.id);
      if (!g) {
        g = new Group();
        const load = new Group();
        if (d.kind === 'vehicle' && d.vehicle) {
          const asset = VEHICLES[d.vehicle]?.asset;
          const visual = asset ? this.library.get(asset) : undefined;
          if (visual) for (const part of visual.parts) load.add(new Mesh(part.geometry, part.material));
          else if (asset) void this.library.load(asset);
        } else if (this.crateTemplate) {
          const crate = this.crateTemplate.root.clone(true);
          crate.scale.setScalar(BB_UNITS_PER_METER / 16 * 1.4);
          load.add(crate);
        }
        g.add(load, this.canopy());
        if (d.kind === 'vehicle') g.children[1]!.scale.setScalar(1.6);
        this.scene.add(g);
        this.drops.set(d.id, g);
      }
      g.userData.target = [d.x, d.y, d.z];
      if (!g.userData.placed) { g.position.set(d.x, d.y, d.z); g.userData.placed = true; }
    }
  }

  update(dt: number, elapsed: number): void {
    const k = Math.min(1, dt * 6);
    for (const g of [...this.planes.values(), ...this.drops.values()]) {
      const t = g.userData.target as [number, number, number] | undefined;
      if (!t) continue;
      g.position.x += (t[0] - g.position.x) * k;
      g.position.y += (t[1] - g.position.y) * k;
      g.position.z += (t[2] - g.position.z) * k;
    }
    for (const [, g] of this.drops) g.rotation.y += dt * .3;
    if (this.planeTemplate) for (const g of this.planes.values()) {
      for (const [bone, tracks] of this.planeTemplate.clips.get('propellers_spin')?.bones ?? []) {
        const node = g.getObjectByName(bone);
        if (!node || !tracks.rotation) continue;
        sampleTrack(tracks.rotation, elapsed % .2, this.vec);
        node.rotation.set(this.vec[0] * Math.PI / 180, this.vec[1] * Math.PI / 180, this.vec[2] * Math.PI / 180);
      }
    }
  }

  dispose(): void {
    for (const g of [...this.planes.values(), ...this.drops.values()]) this.scene.remove(g);
    this.planes.clear(); this.drops.clear();
    if (this.zone) this.scene.remove(this.zone);
  }
}
