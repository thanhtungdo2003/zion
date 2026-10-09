import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferAttribute,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { createDefaultRegistry } from '@zion/assets';
import { GUARD_MODEL_URL, MERCHANT_MODEL_URL, NURSE_MODEL_URL } from '@zion/shared';
import { AssetLibrary } from '@/game/render/asset-library';
import { Avatar } from '@/game/render/avatars';
import { loadCharacterModel, type CharacterTemplate } from '@/game/render/character-model';
import { prepareGuardModel } from '@/game/render/guard-model';
import { occlusionUniforms } from '@/game/render/occlusion-fade';

export interface ScenePart {
  uid: number;
  asset: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** NPC handles: 'merchant', 'nurse', 'guard:0'… */
export type NpcKey = string;
export interface SceneNpc {
  key: NpcKey;
  role: 'merchant' | 'nurse' | 'guard' | 'quest';
  /** Quest NPCs: their model and display name. */
  model?: string;
  label?: string;
  x: number;
  z: number;
}

export interface Terrain {
  size: number;
  step: number;
  origin: number;
  heights: number[];
  water: number;
}

/** What the gizmo is attached to. */
export type Handle = { kind: 'part'; uid: number } | { kind: 'npc'; key: NpcKey };

export interface SceneEvents {
  /** Clicked a part/NPC (null = empty ground). `additive` = Shift held. */
  pick(handle: Handle | null, additive: boolean): void;
  /** Build mode: clicked the ground here (camp-local metres). */
  place(x: number, y: number, z: number): void;
  /** Live gizmo drag of the attached object. */
  transform(handle: Handle, x: number, y: number, z: number, yaw: number): void;
  /** Gizmo drag started / finished (for undo history). */
  dragging(active: boolean): void;
  cursor(p: { x: number; y: number; z: number } | null): void;
}

const SELECT_COLOR = 0xffb000;

/**
 * The Camp Studio's 3D view: the real asset models on the real camp ground, NPC characters, an
 * orbit camera and a 3-axis move / rotate gizmo for the selected object. Camp-local coordinates
 * (x east, z south, y up from the camp floor).
 */
export class StudioScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(50, 1, 0.1, 2000);
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly library = new AssetLibrary(createDefaultRegistry());
  private readonly objects = new Map<number, { group: Group; asset: number; loaded: boolean }>();
  private readonly npcs = new Map<NpcKey, { avatar: Avatar | null; role: SceneNpc['role']; pos: SceneNpc; marker: Mesh }>();
  private readonly templates = new Map<SceneNpc['role'], CharacterTemplate>();
  /** Quest NPC models by URL (loaded on first use). */
  private readonly questTemplates = new Map<string, Promise<CharacterTemplate | null>>();
  private readonly questReady = new Map<string, CharacterTemplate>();
  private readonly highlights: LineSegments[] = [];
  private terrain: Mesh | null = null;
  private ghost: Group | null = null;
  private ghostAsset: number | null = null;
  private ghostYaw = 0;
  private selection: Handle[] = [];
  private attached: Handle | null = null;
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private down: { x: number; y: number } | null = null;
  private raf = 0;
  private disposed = false;
  private readonly resize: ResizeObserver;

  constructor(private readonly host: HTMLElement, private readonly events: SceneEvents) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    // No see-through fading in the editor.
    occlusionUniforms.uFadeRadius.value = 0;

    this.scene.background = new Color(0x9fc2e6);
    this.scene.add(new HemisphereLight(0xdfeeff, 0x4a4030, 1.1));
    const sun = new DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(60, 120, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 400 });
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    this.camera.position.set(0, 70, 75);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0, 0);
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.minDistance = 3;
    this.orbit.maxDistance = 260;
    this.orbit.enableDamping = true;

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      const active = Boolean((e as unknown as { value: boolean }).value);
      this.orbit.enabled = !active;
      this.events.dragging(active);
    });
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    this.scene.add(this.gizmo.getHelper());

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerleave', () => this.events.cursor(null));
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
    void this.loadCharacters();
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ----------------------------------------------------------------------------- terrain */

  setTerrain(t: Terrain): void {
    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.terrain.geometry.dispose();
    }
    const n = t.size;
    const len = (n - 1) * t.step;
    const geo = new PlaneGeometry(len, len, n - 1, n - 1).rotateX(-Math.PI / 2);
    geo.translate(t.origin + len / 2, 0, t.origin + len / 2);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const grass = new Color(0x5d7a3a);
    const dirt = new Color(0x8a7656);
    const sand = new Color(0xc9b98a);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const gi = Math.round((x - t.origin) / t.step);
      const gj = Math.round((z - t.origin) / t.step);
      const h = t.heights[gj * n + gi] ?? 0;
      pos.setY(i, h);
      // The camp pad is dirt; beyond it grass, sand near water.
      const pad = Math.max(Math.abs(x), Math.abs(z)) <= 54;
      c.copy(pad ? dirt : h < t.water + 1.2 ? sand : grass);
      const shade = 0.9 + ((i * 2654435761) % 1000) / 10000;
      colors.set([c.r * shade, c.g * shade, c.b * shade], i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.terrain = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true }));
    this.terrain.receiveShadow = true;
    this.terrain.userData.ground = true;
    this.scene.add(this.terrain);
    if (t.water > -60) {
      const water = new Mesh(new PlaneGeometry(len, len).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x3a6f9a, transparent: true, opacity: 0.6 }));
      water.position.set(t.origin + len / 2, t.water, t.origin + len / 2);
      this.scene.add(water);
    }
    for (const n2 of this.npcs.values()) this.placeNpc(n2.pos);
  }

  private groundAt(x: number, z: number): number {
    if (!this.terrain) return 0;
    this.ray.set(new Vector3(x, 200, z), new Vector3(0, -1, 0));
    const hit = this.ray.intersectObject(this.terrain, false)[0];
    return hit ? hit.point.y : 0;
  }

  /* ------------------------------------------------------------------------------- parts */

  /** Mirrors the editor state: creates, moves or removes part objects. */
  syncParts(parts: readonly ScenePart[]): void {
    const seen = new Set<number>();
    for (const p of parts) {
      seen.add(p.uid);
      let o = this.objects.get(p.uid);
      if (o && o.asset !== p.asset) {
        this.scene.remove(o.group);
        this.objects.delete(p.uid);
        o = undefined;
      }
      if (!o) {
        o = { group: this.buildGroup(p.asset), asset: p.asset, loaded: false };
        o.group.userData.uid = p.uid;
        this.scene.add(o.group);
        this.objects.set(p.uid, o);
      }
      if (this.isDragging(p.uid)) continue;
      o.group.position.set(p.x, p.y, p.z);
      o.group.rotation.set(0, p.yaw, 0);
      o.group.scale.setScalar(p.scale);
    }
    for (const [uid, o] of this.objects) {
      if (seen.has(uid)) continue;
      this.scene.remove(o.group);
      this.objects.delete(uid);
    }
    this.refreshSelection();
  }

  private isDragging(uid: number): boolean {
    return this.gizmo.dragging && this.attached?.kind === 'part' && this.attached.uid === uid;
  }

  /** A group holding the asset's model (a placeholder box until it has loaded). */
  private buildGroup(asset: number): Group {
    const g = new Group();
    const fill = (target: Group) => {
      const v = this.library.get(asset);
      if (!v) return false;
      target.clear();
      for (const part of v.parts) {
        const m = new Mesh(part.geometry, part.material);
        m.castShadow = true;
        m.receiveShadow = true;
        target.add(m);
      }
      return true;
    };
    if (!fill(g)) {
      const box = new Mesh(new BoxGeometry(0.6, 0.6, 0.6).translate(0, 0.3, 0), new MeshLambertMaterial({ color: 0x999999 }));
      g.add(box);
      void this.library.load(asset)?.then(() => {
        fill(g);
        this.refreshSelection();
      });
    }
    return g;
  }

  /* -------------------------------------------------------------------------------- NPCs */

  private async loadCharacters(): Promise<void> {
    try {
      const survivor = await loadCharacterModel();
      const [guard, merchant, nurse] = await Promise.all([GUARD_MODEL_URL, MERCHANT_MODEL_URL, NURSE_MODEL_URL].map((u) => loadCharacterModel(u)));
      this.templates.set('guard', prepareGuardModel(guard!, survivor));
      this.templates.set('merchant', prepareGuardModel(merchant!, survivor));
      this.templates.set('nurse', prepareGuardModel(nurse!, survivor));
    } catch (err) {
      console.warn('studio: NPC models failed to load', err);
    }
    for (const n of this.npcs.values()) this.ensureAvatar(n.pos.key);
  }

  syncNpcs(list: readonly SceneNpc[]): void {
    const seen = new Set<NpcKey>();
    for (const n of list) {
      seen.add(n.key);
      let e = this.npcs.get(n.key);
      if (!e) {
        // A tall translucent pick column, so NPCs are easy to click even before models load.
        const marker = new Mesh(new BoxGeometry(0.8, 1.9, 0.8).translate(0, 0.95, 0), new MeshBasicMaterial({ color: n.role === 'nurse' ? 0xff4b4b : n.role === 'merchant' ? 0xffd56a : n.role === 'quest' ? 0x7dff9a : 0x9fd0ff, transparent: true, opacity: 0.18, depthWrite: false }));
        marker.userData.npc = n.key;
        this.scene.add(marker);
        e = { avatar: null, role: n.role, pos: { ...n }, marker };
        this.npcs.set(n.key, e);
        this.ensureAvatar(n.key);
      }
      e.pos = { ...n };
      if (!(this.gizmo.dragging && this.attached?.kind === 'npc' && this.attached.key === n.key)) this.placeNpc(n);
    }
    for (const [key, e] of this.npcs) {
      if (seen.has(key)) continue;
      e.avatar?.dispose(this.scene);
      this.scene.remove(e.marker);
      this.npcs.delete(key);
    }
    this.refreshSelection();
  }

  private ensureAvatar(key: NpcKey): void {
    const e = this.npcs.get(key);
    if (e && !e.avatar && e.role === 'quest' && e.pos.model && !this.questReady.has(e.pos.model)) {
      const url = e.pos.model;
      if (!this.questTemplates.has(url)) {
        this.questTemplates.set(url, loadCharacterModel(url).then((t) => {
          this.questReady.set(url, t);
          for (const [k, n] of this.npcs) if (n.pos.model === url) this.ensureAvatar(k);
          return t;
        }).catch(() => null));
      }
      return;
    }
    const t = e && (e.role === 'quest' ? this.questReady.get(e.pos.model ?? '') : this.templates.get(e.role));
    if (!e || e.avatar || !t) return;
    e.avatar = new Avatar(t, false);
    if (e.role === 'guard') e.avatar.setStance('rifle');
    e.avatar.addTo(this.scene);
    this.placeNpc(e.pos);
  }

  private placeNpc(n: SceneNpc): void {
    const e = this.npcs.get(n.key);
    if (!e) return;
    const y = this.groundAt(n.x, n.z);
    e.marker.position.set(n.x, y, n.z);
    e.avatar?.update(n.x, y, n.z, Math.PI, 1, 0.016, 0);
  }

  /* --------------------------------------------------------------------------- selection */

  /** Selected objects get an outline; the gizmo goes on the primary (last) one. */
  setSelection(handles: Handle[], mode: 'translate' | 'rotate'): void {
    this.selection = handles;
    // Mid-drag: keep the gizmo as it is (re-attaching would interrupt the drag).
    if (this.gizmo.dragging) return;
    this.gizmo.setMode(mode);
    const primary = handles[handles.length - 1] ?? null;
    const obj = primary ? this.objectOf(primary) : null;
    const npc = primary?.kind === 'npc';
    if (obj && !(npc && mode === 'rotate')) {
      this.attached = primary;
      this.gizmo.attach(obj);
      // Move: three axis arrows (NPCs walk on the ground, so no Y). Rotate: around Y only.
      this.gizmo.showX = mode === 'translate';
      this.gizmo.showZ = mode === 'translate';
      this.gizmo.showY = mode === 'rotate' || !npc;
    } else {
      this.attached = null;
      this.gizmo.detach();
    }
    this.refreshSelection();
  }

  setSnap(step: number): void {
    this.gizmo.setTranslationSnap(step > 0 ? step : null);
    this.gizmo.setRotationSnap((15 * Math.PI) / 180);
  }

  private objectOf(h: Handle): Object3D | null {
    if (h.kind === 'part') return this.objects.get(h.uid)?.group ?? null;
    return this.npcs.get(h.key)?.marker ?? null;
  }

  private refreshSelection(): void {
    for (const l of this.highlights) {
      l.removeFromParent();
      l.geometry.dispose();
    }
    this.highlights.length = 0;
    for (const h of this.selection) {
      const obj = this.objectOf(h);
      if (!obj) continue;
      obj.traverse((m) => {
        if (!(m instanceof Mesh) || m.userData.outline) return;
        const edges = new LineSegments(new EdgesGeometry(m.geometry, 30), new LineBasicMaterial({ color: SELECT_COLOR, depthTest: false, transparent: true, opacity: 0.9 }));
        edges.userData.outline = true;
        edges.renderOrder = 10;
        m.add(edges);
        this.highlights.push(edges);
      });
    }
  }

  private onGizmoChange(): void {
    const h = this.attached;
    const obj = h && this.objectOf(h);
    if (!h || !obj) return;
    if (h.kind === 'npc') {
      obj.position.y = this.groundAt(obj.position.x, obj.position.z);
      const e = this.npcs.get(h.key);
      if (e) e.avatar?.update(obj.position.x, obj.position.y, obj.position.z, Math.PI, 1, 0.016, 0);
    }
    this.events.transform(h, obj.position.x, obj.position.y, obj.position.z, obj.rotation.y);
  }

  /* ------------------------------------------------------------------------------ build */

  /** Build mode: a translucent copy of the asset follows the cursor (null = off). */
  setGhost(asset: number | null, yaw: number): void {
    this.ghostYaw = yaw;
    if (asset !== this.ghostAsset) {
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = null;
      this.ghostAsset = asset;
      if (asset !== null) {
        this.ghost = this.buildGroup(asset);
        this.ghost.traverse((m) => {
          if (m instanceof Mesh) {
            m.material = (m.material as MeshLambertMaterial).clone();
            Object.assign(m.material, { transparent: true, opacity: 0.5, depthWrite: false });
          }
        });
        this.ghost.visible = false;
        this.scene.add(this.ghost);
      }
    }
    if (this.ghost) this.ghost.rotation.y = yaw;
  }

  /* ------------------------------------------------------------------------------ input */

  private pick(e: PointerEvent): { handle: Handle | null; ground: Vector3 | null } {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const targets: Object3D[] = [...[...this.objects.values()].map((o) => o.group), ...[...this.npcs.values()].map((n) => n.marker)];
    if (this.terrain) targets.push(this.terrain);
    for (const hit of this.ray.intersectObjects(targets, true)) {
      let o: Object3D | null = hit.object;
      while (o) {
        if (o.userData.uid !== undefined) return { handle: { kind: 'part', uid: o.userData.uid as number }, ground: hit.point };
        if (o.userData.npc !== undefined) return { handle: { kind: 'npc', key: o.userData.npc as string }, ground: hit.point };
        if (o.userData.ground) return { handle: null, ground: hit.point };
        if (o.userData.outline) break;
        o = o.parent;
      }
    }
    return { handle: null, ground: null };
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || this.gizmo.dragging || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || e.button !== 0) return;
    const { handle, ground } = this.pick(e);
    if (this.ghostAsset !== null) {
      if (ground) this.events.place(ground.x, Math.max(0, ground.y), ground.z);
      return;
    }
    this.events.pick(handle, e.shiftKey);
  };

  private onMove = (e: PointerEvent) => {
    const { ground } = this.pick(e);
    this.events.cursor(ground ? { x: ground.x, y: ground.y, z: ground.z } : null);
    if (this.ghost) {
      this.ghost.visible = !!ground;
      if (ground) this.ghost.position.set(ground.x, Math.max(0, ground.y), ground.z);
      this.ghost.rotation.y = this.ghostYaw;
    }
  };

  /** Moves the build ghost to the snapped spot the editor will use. */
  snapGhost(x: number, z: number): void {
    if (this.ghost) this.ghost.position.set(x, this.ghost.position.y, z);
  }

  focus(x: number, z: number): void {
    const off = this.camera.position.clone().sub(this.orbit.target);
    this.orbit.target.set(x, 0, z);
    this.camera.position.copy(this.orbit.target).add(off);
  }

  /* ------------------------------------------------------------------------------ loop */

  private fit(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    this.orbit.update();
    // Keep the NPCs' idle animation running.
    for (const e of this.npcs.values()) {
      const m = e.marker.position;
      e.avatar?.update(m.x, m.y, m.z, Math.PI, 1, 0.016, 0);
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
