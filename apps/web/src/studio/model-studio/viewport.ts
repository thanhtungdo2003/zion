import {
  ACESFilmicToneMapping, AmbientLight, Box3, Box3Helper, BufferAttribute, BufferGeometry, CanvasTexture, Color, DataTexture, DirectionalLight, DoubleSide, Euler, FrontSide,
  GridHelper, Group, HemisphereLight, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, MeshStandardMaterial, NoColorSpace, type Object3D, PCFSoftShadowMap, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, Raycaster, RepeatWrapping, RGBAFormat, Scene, ShadowMaterial, SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer, type Material,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createDefaultRegistry, type AssetRegistry } from '@zion/assets';
import { collides, materialTextures, nodeMeshes, type MeshData, type ModelDoc, type ModelMaterial, type ModelNode, type Transform } from '@zion/assets/model-studio';
import { AssetLibrary } from '@/game/render/asset-library';
import { studioFetch } from '@/lib/api';

/**
 * The Model Studio's 3D view: the project drawn as the game will draw it (PBR materials with
 * their generated base colour, normal, roughness, metalness and occlusion maps under an image-
 * based environment), game models from the shared asset library, imported files; orbit/pan/zoom,
 * pick, move/rotate/scale with grid and angle snapping, drop onto the surface below, and check
 * modes (clay, wireframe, UV checker, collision). Only parts whose data changed are rebuilt;
 * textures are generated a few per frame so a large model never freezes the page.
 */
export type DisplayMode = 'lit' | 'clay' | 'wire' | 'uv' | 'collision';
export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface ViewportCallbacks {
  pick(id: string | null, additive: boolean): void;
  /** A transform drag finished: the node's new local transform. */
  transform(id: string, t: Transform): void;
  stats(s: { triangles: number; meshes: number; pendingTextures: number }): void;
}

interface Built { key: string; object: Group; meshes: Mesh[] }

const PREVIEW_TEX = 256;

function geometry(m: MeshData, uvScale: number): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  const uv = new Float32Array(m.uvs.length), k = 1 / Math.max(.01, uvScale);
  for (let i = 0; i < uv.length; i++) uv[i] = m.uvs[i]! * k;
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

function dataTexture(bytes: Uint8Array, size: number, srgb: boolean): DataTexture {
  const t = new DataTexture(bytes as Uint8Array<ArrayBuffer>, size, size, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function checker(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#e8e8e8' : '#3a76d8'; g.fillRect(x * 32, y * 32, 32, 32); }
  g.fillStyle = '#d33'; g.font = 'bold 40px sans-serif'; g.fillText('UV', 96, 140);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace;
  return t;
}

export class ModelViewport {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, .05, 2000);
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly root = new Group();
  private readonly built = new Map<string, Built>();
  private readonly materials = new Map<string, { key: string; material: MeshStandardMaterial; textured: boolean }>();
  private readonly textureQueue: string[] = [];
  private readonly library: AssetLibrary;
  readonly registry: AssetRegistry;
  private readonly gltf = new GLTFLoader();
  private readonly imports = new Map<string, Promise<Object3D | null>>();
  private readonly grid = new GridHelper(100, 100, 0x55606a, 0x2a3036);
  private readonly selectionBox = new Box3Helper(new Box3(), new Color(0xffb020));
  private readonly ray = new Raycaster();
  private doc: ModelDoc | null = null;
  private selected: string[] = [];
  private mode: DisplayMode = 'lit';
  private disposed = false;
  private raf = 0;
  private dragging = false;
  private readonly special: Record<'clay' | 'wire' | 'uv' | 'hit' | 'miss', Material>;
  private readonly resize: ResizeObserver;

  constructor(private readonly host: HTMLElement, private readonly cb: ViewportCallbacks) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = .82;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.registry = createDefaultRegistry();
    this.library = new AssetLibrary(this.registry);

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    this.scene.environmentIntensity = .7;
    this.scene.background = new Color(0x1b1f23);
    this.scene.add(new HemisphereLight(0xcfe3ff, 0x3a3226, .35), new AmbientLight(0xffffff, .05));
    const sun = new DirectionalLight(0xfff1dc, 1.5);
    sun.position.set(18, 30, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
    sun.shadow.bias = -.0005; sun.shadow.normalBias = .02;
    this.scene.add(sun);
    const shadowCatcher = new Mesh(new PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new ShadowMaterial({ opacity: .35 }));
    shadowCatcher.receiveShadow = true;
    shadowCatcher.position.y = -.001;
    this.scene.add(shadowCatcher, this.grid, this.root, this.selectionBox);
    this.selectionBox.visible = false;

    this.camera.position.set(14, 10, 18);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.target.set(0, 2, 0);
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.dragging = !!(e as unknown as { value: boolean }).value;
      this.orbit.enabled = !this.dragging;
      if (!this.dragging) this.commitGizmo();
    });
    this.scene.add(this.gizmo.getHelper());

    const clay = new MeshStandardMaterial({ color: 0xd8d4cc, roughness: .8 });
    this.special = {
      clay, wire: new MeshBasicMaterial({ color: 0x9fd2ff, wireframe: true }),
      uv: new MeshStandardMaterial({ map: checker(), roughness: .7 }),
      hit: new MeshStandardMaterial({ color: 0xe0563f, roughness: .9, transparent: true, opacity: .85 }),
      miss: new MeshBasicMaterial({ color: 0x4fb3ff, wireframe: true, transparent: true, opacity: .35 }),
    };

    let down: { x: number; y: number } | null = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || this.dragging || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
      down = null;
      this.cb.pick(this.pickAt(e.clientX, e.clientY), e.shiftKey || e.ctrlKey);
    });
    this.renderer.domElement.addEventListener('dblclick', () => this.focusSelection());
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.orbit.update();
      this.pumpTextures();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private fit(): void {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.library.dispose();
    for (const b of this.built.values()) for (const m of b.meshes) m.geometry.dispose();
    for (const m of this.materials.values()) { m.material.map?.dispose(); m.material.normalMap?.dispose(); m.material.roughnessMap?.dispose(); m.material.dispose(); }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /* --------------------------------------------------------------- materials */

  private materialFor(m: ModelMaterial | undefined): MeshStandardMaterial {
    if (!m) return this.special.clay as MeshStandardMaterial;
    const key = JSON.stringify(m);
    const have = this.materials.get(m.id);
    if (have && have.key === key) return have.material;
    const mat = have?.material ?? new MeshStandardMaterial();
    mat.color.set(m.color);
    mat.roughness = m.roughness; mat.metalness = m.metalness;
    mat.transparent = m.opacity < .99; mat.opacity = m.opacity; mat.depthWrite = m.opacity >= .99;
    mat.side = m.doubleSided ? DoubleSide : FrontSide;
    if (m.emissive) { mat.emissive.set(m.emissive); mat.emissiveIntensity = m.emissiveIntensity ?? 1; }
    mat.needsUpdate = true;
    this.materials.set(m.id, { key, material: mat, textured: false });
    if (!this.textureQueue.includes(m.id)) this.textureQueue.push(m.id);
    return mat;
  }

  private readonly fileTextures = new Map<string, Promise<Texture | null>>();

  /** An image file of the project as a texture (fetched once, shared by every material). */
  private fileTexture(id: string, srgb: boolean): Promise<Texture | null> {
    const key = `${id}:${srgb ? 's' : 'l'}`;
    let p = this.fileTextures.get(key);
    if (!p) {
      p = studioFetch(`/api/studio/models/files/${id}`).then((r) => r.blob()).then((b) => createImageBitmap(b, { imageOrientation: 'none' })).then((bmp) => {
        const t = new Texture(bmp);
        t.flipY = false; // glTF convention, as the exported GLB reads it
        t.wrapS = t.wrapT = RepeatWrapping;
        t.anisotropy = 8;
        t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
        t.needsUpdate = true;
        return t;
      }).catch(() => null);
      this.fileTextures.set(key, p);
    }
    return p;
  }

  /** A real texture set (downloaded or painted) on a material, once its images have loaded. */
  private async applyFiles(m: ModelMaterial, key: string): Promise<void> {
    const [albedo, normal, orm] = await Promise.all([this.fileTexture(m.maps!.albedo, true), m.maps!.normal ? this.fileTexture(m.maps!.normal, false) : null, m.maps!.orm ? this.fileTexture(m.maps!.orm, false) : null]);
    const entry = this.materials.get(m.id);
    if (!entry || entry.key !== key || this.disposed) return;
    const mat = entry.material;
    disposeGenerated(mat);
    mat.map = albedo; mat.normalMap = normal; mat.roughnessMap = orm; mat.metalnessMap = orm; mat.aoMap = orm;
    mat.color.set(0xffffff);
    mat.roughness = orm ? 1 : m.roughness; mat.metalness = orm ? 1 : m.metalness; mat.aoMapIntensity = m.aoStrength;
    mat.needsUpdate = true;
    entry.textured = true;
  }

  /** Generates queued texture sets, a time slice per frame. */
  private pumpTextures(): void {
    const start = performance.now();
    while (this.textureQueue.length && performance.now() - start < 12) {
      const id = this.textureQueue.shift()!;
      const m = this.doc?.materials.find((x) => x.id === id), entry = this.materials.get(id);
      if (!m || !entry) continue;
      if (m.maps) { void this.applyFiles(m, entry.key); continue; }
      const set = materialTextures(m, PREVIEW_TEX);
      const mat = entry.material;
      disposeGenerated(mat);
      const orm = dataTexture(set.orm, set.size, false);
      mat.map = dataTexture(set.albedo, set.size, true);
      mat.normalMap = dataTexture(set.normal, set.size, false);
      mat.roughnessMap = orm; mat.metalnessMap = orm; mat.aoMap = orm;
      // The texture carries the colour, roughness and metalness; factors stay neutral.
      mat.color.set(0xffffff); mat.roughness = 1; mat.metalness = 1; mat.aoMapIntensity = m.aoStrength;
      mat.needsUpdate = true;
      entry.textured = true;
    }
    this.cb.stats({ ...this.counts(), pendingTextures: this.textureQueue.length });
  }

  private counts(): { triangles: number; meshes: number } {
    let triangles = 0, meshes = 0;
    for (const b of this.built.values()) for (const m of b.meshes) { triangles += (m.geometry.index?.count ?? 0) / 3; meshes++; }
    return { triangles: Math.round(triangles), meshes };
  }

  /* -------------------------------------------------------------------- scene */

  /** Brings the view up to date with the document (only changed parts are rebuilt). */
  setDoc(doc: ModelDoc): void {
    this.doc = doc;
    for (const m of doc.materials) this.materialFor(m);
    const alive = new Set(doc.nodes.map((n) => n.id));
    for (const [id, b] of this.built) if (!alive.has(id)) { b.object.removeFromParent(); for (const m of b.meshes) m.geometry.dispose(); this.built.delete(id); }
    for (const n of doc.nodes) {
      const { transform: _t, name: _n, parent: _p, visible: _v, locked: _l, ...shape } = n as ModelNode & { locked?: boolean };
      const mats = 'material' in n ? [n.material, n.kind === 'wall' ? n.innerMaterial : undefined].map((id) => (id ? doc.materials.find((m) => m.id === id)?.texture.scale : undefined)) : [];
      const key = JSON.stringify([shape, mats, n.kind === 'asset' || n.kind === 'import' ? null : collides(doc, n)]);
      let b = this.built.get(n.id);
      if (!b || b.key !== key) {
        const object = b?.object ?? new Group();
        for (const m of b?.meshes ?? []) { m.removeFromParent(); m.geometry.dispose(); }
        object.userData.node = n.id;
        const meshes: Mesh[] = [];
        if (n.kind === 'asset') this.addAsset(object, n.asset);
        else if (n.kind === 'import') void this.addImport(object, n.file);
        else for (const p of nodeMeshes(n)) {
          const mat = doc.materials.find((m) => m.id === p.material);
          const mesh = new Mesh(geometry(p.mesh, mat?.texture.scale ?? 1), this.materialFor(mat));
          mesh.castShadow = true; mesh.receiveShadow = true;
          mesh.userData.material = p.material;
          mesh.userData.collides = collides(doc, n);
          object.add(mesh);
          meshes.push(mesh);
        }
        b = { key, object, meshes };
        this.built.set(n.id, b);
      }
      const o = b.object;
      o.name = n.name;
      o.position.set(...n.transform.position);
      o.rotation.set(...n.transform.rotation);
      o.scale.set(...n.transform.scale);
      o.visible = n.visible !== false;
    }
    // Hierarchy.
    for (const n of doc.nodes) {
      const o = this.built.get(n.id)!.object, parent = n.parent ? this.built.get(n.parent)?.object : this.root;
      if (o.parent !== (parent ?? this.root)) (parent ?? this.root).add(o);
    }
    this.applyMode();
    this.refreshSelection();
  }

  private addAsset(target: Group, asset: number): void {
    const fill = () => {
      const v = this.library.get(asset);
      if (!v) return false;
      for (const c of [...target.children]) if (c.userData.placeholder) c.removeFromParent();
      for (const part of v.parts) { const m = new Mesh(part.geometry, part.material); m.castShadow = true; m.receiveShadow = true; m.userData.asset = asset; target.add(m); }
      this.applyMode();
      return true;
    };
    if (fill()) return;
    const def = this.registry.byNumericId(asset);
    const r = def?.bounds.radius ?? .5, h = def?.bounds.height ?? 1;
    const ph = new Box3Helper(new Box3(new Vector3(-r * .7, 0, -r * .7), new Vector3(r * .7, h, r * .7)), new Color(0x8899aa));
    ph.userData.placeholder = true;
    target.add(ph);
    void this.library.load(asset)?.then(fill).catch(() => undefined);
  }

  private async addImport(target: Group, file: string): Promise<void> {
    let p = this.imports.get(file);
    if (!p) {
      p = studioFetch(`/api/studio/models/files/${file}`).then((r) => r.arrayBuffer()).then((buf) => new Promise<Object3D | null>((resolve) => this.gltf.parse(buf, '', (g) => resolve(g.scene), () => resolve(null)))).catch(() => null);
      this.imports.set(file, p);
    }
    const scene = await p;
    if (!scene || this.disposed) return;
    const copy = scene.clone(true);
    copy.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    target.add(copy);
    this.applyMode();
  }

  setMode(mode: DisplayMode): void { this.mode = mode; this.applyMode(); }
  setGrid(on: boolean, step = 1): void { this.grid.visible = on; this.grid.scale.setScalar(step); }

  private applyMode(): void {
    for (const b of this.built.values()) b.object.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.userData.original ??= m.material;
      const orig = m.userData.original as Material;
      const collidesHere = m.userData.collides !== false;
      m.material = this.mode === 'lit' ? (m.userData.material ? this.materials.get(m.userData.material as string)?.material ?? orig : orig)
        : this.mode === 'clay' ? this.special.clay : this.mode === 'wire' ? this.special.wire : this.mode === 'uv' ? this.special.uv : collidesHere ? this.special.hit : this.special.miss;
    });
  }

  /* --------------------------------------------------------------- selection */

  private pickAt(cx: number, cy: number): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new Vector2((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1), this.camera);
    const hits = this.ray.intersectObject(this.root, true);
    for (const h of hits) {
      if (!h.object.visible) continue;
      // The topmost unlocked group the hit belongs to, under the current selection's level:
      // a click picks the leaf part; clicking again on a selected part goes up to its parent.
      let o: Object3D | null = h.object, leaf: string | null = null;
      while (o && o !== this.root) { if (o.userData.node) { leaf = o.userData.node as string; break; } o = o.parent; }
      if (!leaf) continue;
      if (this.selected.includes(leaf)) {
        const parent = this.doc?.nodes.find((n) => n.id === leaf)?.parent;
        return parent ?? leaf;
      }
      return leaf;
    }
    return null;
  }

  select(ids: string[], gizmo: GizmoMode, space: 'local' | 'world', snap: { move: number; angle: number; scale: number } | null): void {
    this.selected = ids;
    const last = ids[ids.length - 1];
    const node = last ? this.doc?.nodes.find((n) => n.id === last) : undefined;
    const obj = last ? this.built.get(last)?.object : undefined;
    if (obj && node && !node.locked) { this.gizmo.attach(obj); this.gizmo.setMode(gizmo); this.gizmo.setSpace(space); }
    else this.gizmo.detach();
    this.gizmo.setTranslationSnap(snap ? snap.move : null);
    this.gizmo.setRotationSnap(snap ? snap.angle * Math.PI / 180 : null);
    this.gizmo.setScaleSnap(snap ? snap.scale : null);
    this.refreshSelection();
  }

  private refreshSelection(): void {
    const box = new Box3();
    for (const id of this.selected) { const o = this.built.get(id)?.object; if (o) box.expandByObject(o); }
    this.selectionBox.box.copy(box);
    this.selectionBox.visible = !box.isEmpty();
  }

  private commitGizmo(): void {
    const o = this.gizmo.object;
    const id = o?.userData.node as string | undefined;
    if (!o || !id) return;
    const e = new Euler().copy(o.rotation);
    this.cb.transform(id, { position: [o.position.x, o.position.y, o.position.z].map(r4) as Transform['position'], rotation: [e.x, e.y, e.z].map(r4) as Transform['rotation'], scale: [o.scale.x, o.scale.y, o.scale.z].map(r4) as Transform['scale'] });
    this.refreshSelection();
  }

  /** Bounds of a node in model space (or of everything). */
  boundsOf(id?: string): Box3 {
    const box = new Box3();
    if (id) { const o = this.built.get(id)?.object; if (o) box.expandByObject(o); }
    else box.expandByObject(this.root);
    return box;
  }

  focusSelection(): void {
    const box = this.selected.length ? this.selected.reduce((b, id) => b.union(this.boundsOf(id)), new Box3()) : this.boundsOf();
    if (box.isEmpty()) return;
    const c = box.getCenter(new Vector3()), r = Math.max(.5, box.getSize(new Vector3()).length() / 2);
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dir, r / Math.tan(this.camera.fov * Math.PI / 360) * 1.1);
    this.camera.near = Math.max(.01, r / 200); this.camera.far = r * 200 + 200; this.camera.updateProjectionMatrix();
  }

  /**
   * How far a node must move down (−) or up (+) to rest on the surface under it (other parts
   * or the ground plane at y = 0), in model space.
   */
  dropDistance(id: string): number | null {
    const o = this.built.get(id)?.object;
    if (!o) return null;
    const box = this.boundsOf(id);
    if (box.isEmpty()) return null;
    const own = new Set<Object3D>();
    o.traverse((x) => own.add(x));
    let floor = 0; // the ground
    for (const [fx, fz] of [[.5, .5], [.2, .2], [.8, .2], [.2, .8], [.8, .8]] as const) {
      const x = box.min.x + (box.max.x - box.min.x) * fx, z = box.min.z + (box.max.z - box.min.z) * fz;
      this.ray.set(new Vector3(x, box.min.y + .01, z), new Vector3(0, -1, 0));
      for (const h of this.ray.intersectObject(this.root, true)) if (!own.has(h.object) && h.object.visible) { floor = Math.max(floor, h.point.y); break; }
    }
    return floor - box.min.y;
  }

  /** A PNG thumbnail of the current view. */
  snapshot(): string { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Frees a material's generated maps (file textures are shared and stay). */
function disposeGenerated(mat: MeshStandardMaterial): void {
  for (const t of new Set([mat.map, mat.normalMap, mat.roughnessMap])) if (t instanceof DataTexture) t.dispose();
}
