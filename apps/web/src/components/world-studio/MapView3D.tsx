'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping, BoxGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, IcosahedronGeometry, type Material, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, Fog, Group, HemisphereLight, InstancedMesh,
  Line, LineBasicMaterial, MOUSE, Matrix4, Mesh, MeshLambertMaterial, PerspectiveCamera, PlaneGeometry, Quaternion, Raycaster, SRGBColorSpace, Scene, Shape, ShapeGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createDefaultRegistry } from '@zion/assets';
import { registerStudioModels } from '@/lib/studio-models';
import { Surface } from '@zion/shared';
import { climateTint, compositeParts, floraGroup, riverLevels, type FloraItem, type BrushSettings, type Heightfield, type SettlementResult, type WorldMapDoc } from '@zion/worldgen/editor';
import { AssetLibrary } from '@/game/render/asset-library';
import { SkySystem } from '@/game/render/sky';
import { EnvironmentSystem } from '@/game/render/environment';
import { emptySample, readEnvironment, sampleEnvironment, zonesInOrder, resolveWeather } from '@zion/shared';
import { isBrush, type Tool } from './types';
import s from './world-studio.module.css';

const RGB: Record<number, [number, number, number]> = {
  [Surface.Grass]: [.36, .48, .27], [Surface.DryGrass]: [.55, .52, .33], [Surface.ForestFloor]: [.27, .35, .22], [Surface.Sand]: [.76, .7, .52], [Surface.Dirt]: [.47, .39, .29],
  [Surface.Mud]: [.35, .29, .22], [Surface.Gravel]: [.5, .49, .46], [Surface.Rock]: [.45, .44, .42], [Surface.Snow]: [.9, .91, .93], [Surface.Asphalt]: [.28, .28, .29],
};
const MAX_INSTANCES = 120000;

/**
 * 3D preview of the map: the edited terrain (one vertex per few grid cells), sea, lakes and
 * rivers at their water levels, and every generated building and prop with its real model from
 * the game's asset library. Terrain brushes work here too.
 */
export default function MapView3D({ terrain, doc, version, tool, brush, onBrush, preview, envPreview }: {
  terrain: Heightfield; doc: WorldMapDoc; version: number; tool: Tool; brush: BrushSettings;
  onBrush: (phase: 'start' | 'move' | 'end', x: number, z: number) => void; preview?: SettlementResult | null;
  /** The environment's live preview: the sky, weather and climate at eye level (`before`: the plain sky). */
  envPreview?: { on: boolean; before: boolean };
}) {
  /** Called every frame while the environment preview runs. */
  const frameHook = useRef<((dt: number) => void) | null>(null);
  /** Where the preview eye stands (double-click the ground to move it). */
  const eyeAt = useRef<{ x: number; z: number } | null>(null);
  const [eyeVersion, setEyeVersion] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<{ renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; controls: OrbitControls; ground: Mesh; step: number; n: number; objects: Group; water: Group; cursor: Line; library: AssetLibrary; dirty: boolean } | null>(null);
  const live = useRef({ tool, brush, onBrush, terrain, doc });
  live.current = { tool, brush, onBrush, terrain, doc };
  const [status, setStatus] = useState('');
  const [modelsReady, setModelsReady] = useState(0);
  const envRef = useRef<EnvironmentSystem | null>(null);

  // One-time scene setup.
  useEffect(() => {
    const el = host.current!;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = .9;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    const sc = new Scene();
    sc.background = new Color('#9fb3bf'); sc.fog = new Fog('#9fb3bf', terrain.size * 1.6, terrain.size * 4);
    const fill = new HemisphereLight('#dfe9f2', '#4a4636', 1.1); fill.name = 'studio-fill'; sc.add(fill);
    const sun = new DirectionalLight('#fff2dc', 1.6); sun.position.set(-1, 1.4, -.6); sun.name = 'studio-sun'; sc.add(sun);
    const camera = new PerspectiveCamera(50, 1, 1, terrain.size * 4);
    camera.position.set(terrain.size * .5, terrain.size * .45, terrain.size * 1.15);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(terrain.size / 2, 30, terrain.size / 2); controls.maxPolarAngle = Math.PI * .48; controls.enableDamping = true;
    // Ground: a grid of at most 257² vertices.
    const step = Math.max(1, Math.ceil((terrain.cols - 1) / 256)), n = Math.floor((terrain.cols - 1) / step) + 1;
    const geo = new PlaneGeometry(1, 1, n - 1, n - 1);
    geo.setAttribute('color', new BufferAttribute(new Float32Array(n * n * 3), 3));
    const ground = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true }));
    sc.add(ground);
    const sea = new Mesh(new PlaneGeometry(terrain.size * 3, terrain.size * 3), new MeshLambertMaterial({ color: '#2f6e86', transparent: true, opacity: .82 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(terrain.size / 2, doc.terrain.seaLevel, terrain.size / 2); sea.name = 'sea';
    sc.add(sea);
    const objects = new Group(), water = new Group();
    sc.add(objects, water);
    const cursor = new Line(new BufferGeometry(), new LineBasicMaterial({ color: '#ffb000', depthTest: false }));
    cursor.renderOrder = 10; cursor.visible = false; sc.add(cursor);
    const registry = createDefaultRegistry();
    // The Model Studio's houses: drawn once their definitions are in (the buildings are redrawn then).
    void registerStudioModels(registry).then(() => setModelsReady((n) => n + 1));
    const library = new AssetLibrary(registry);
    scene.current = { renderer, scene: sc, camera, controls, ground, step, n, objects, water, cursor, library, dirty: true };
    const resize = () => { const r = el.getBoundingClientRect(); renderer.setSize(r.width, r.height); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let raf = 0, last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = performance.now(), dt = Math.min(.1, (t - last) / 1000); last = t;
      controls.update(); frameHook.current?.(dt); renderer.render(sc, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); library.dispose();
      sc.traverse((o) => { if (o instanceof Mesh || o instanceof Line || o instanceof InstancedMesh) { o.geometry.dispose(); } });
      renderer.dispose(); renderer.domElement.remove(); scene.current = null;
    };
    // The scene is rebuilt only when the map itself changes (a new terrain object).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain]);

  // Ground heights and colours.
  useEffect(() => {
    const st = scene.current;
    if (!st) return;
    const gt = climateTint(doc.terrain.climate);
    // In the environment preview the ground shows the climate: tint and wetness.
    const envOn = !!envPreview?.on && !envPreview.before, env = readEnvironment(doc.environment), ordered = zonesInOrder(env), es = emptySample();
    const wetAll = envOn ? Math.max(resolveWeather(env, 1, 0).wet, resolveWeather(env, 1, 0).rain) : 0;
    const { ground, step, n } = st, pos = ground.geometry.getAttribute('position') as BufferAttribute, col = ground.geometry.getAttribute('color') as BufferAttribute;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gi = Math.min(terrain.cols - 1, i * step), gj = Math.min(terrain.rows - 1, j * step), k = j * n + i;
      const h = terrain.get(gi, gj);
      pos.setXYZ(k, gi * terrain.cell, h, gj * terrain.cell);
      const c = RGB[terrain.surface[terrain.index(gi, gj)]!] ?? RGB[Surface.Grass]!;
      const under = h < doc.terrain.seaLevel ? .55 : 1;
      let r = c[0] * under * gt[0]!, g = c[1] * under * gt[1]!, b = c[2] * under * gt[2]!;
      if (envOn) {
        const e = sampleEnvironment(env, gi * terrain.cell, gj * terrain.cell, es, ordered), wet = 1 - .42 * Math.max(e.wetness, wetAll);
        r *= (1 + (e.tint[0] * 2 - 1) * e.tintStrength) * wet; g *= (1 + (e.tint[1] * 2 - 1) * e.tintStrength) * wet; b *= (1 + (e.tint[2] * 2 - 1) * e.tintStrength) * wet;
      }
      col.setXYZ(k, r, g, b);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    ground.geometry.computeVertexNormals(); ground.geometry.computeBoundingSphere(); ground.geometry.computeBoundingBox();
    const sea = st.scene.getObjectByName('sea'); if (sea) sea.position.y = doc.terrain.seaLevel;
  }, [terrain, version, doc.terrain.seaLevel, doc.terrain.climate, doc.environment, envPreview?.on, envPreview?.before]);

  // The environment preview: the game's own sky and weather, the eye on the ground.
  const previewOn = !!envPreview?.on, previewBefore = !!envPreview?.before;
  useEffect(() => {
    const st = scene.current;
    if (!st || !previewOn) return;
    const sc = st.scene, cam = st.camera, ctl = st.controls;
    const saved = { pos: cam.position.clone(), target: ctl.target.clone(), near: cam.near, far: cam.far, fov: cam.fov, fog: sc.fog, background: sc.background, min: ctl.minDistance, max: ctl.maxDistance, pan: ctl.enablePan, polar: ctl.maxPolarAngle };
    const studioLights = ['studio-sun', 'studio-fill'].map((name) => sc.getObjectByName(name)).filter((o) => !!o);
    for (const o of studioLights) o.visible = false;
    const sky = new SkySystem(sc, 7);
    const env = previewBefore ? null : new EnvironmentSystem(sc, readEnvironment(live.current.doc.environment), terrain.size, 1, 'high');
    envRef.current = env;
    // The eye: on the ground, looking round from where it stands.
    const at = eyeAt.current ?? { x: terrain.size / 2, z: terrain.size / 2 };
    const y = Math.max(terrain.heightAt(at.x, at.z), live.current.doc.terrain.seaLevel) + 1.7;
    ctl.target.set(at.x, y, at.z);
    cam.position.set(at.x, y, at.z + .1);
    cam.near = .1; cam.far = 2400; cam.fov = 70; cam.updateProjectionMatrix();
    ctl.minDistance = .1; ctl.maxDistance = .1; ctl.enablePan = false; ctl.maxPolarAngle = Math.PI * .97;
    const focus = new Vector3();
    let time = 0;
    frameHook.current = (dt) => {
      time += dt;
      const e = envRef.current;
      if (e) e.update(dt, cam.position, time, sky, () => false, (x, z) => terrain.heightAt(x, z)); else sky.weather = null;
      const tod = e?.timeOfDay ?? .42;
      sky.update(tod, time, focus.copy(cam.position), time);
      sky.follow(cam.position.x, cam.position.y, cam.position.z);
    };
    return () => {
      frameHook.current = null; envRef.current = null;
      env?.dispose(); sky.dispose();
      for (const o of studioLights) o.visible = true;
      sc.fog = saved.fog; sc.background = saved.background;
      cam.position.copy(saved.pos); ctl.target.copy(saved.target); cam.near = saved.near; cam.far = saved.far; cam.fov = saved.fov; cam.updateProjectionMatrix();
      ctl.minDistance = saved.min; ctl.maxDistance = saved.max; ctl.enablePan = saved.pan; ctl.maxPolarAngle = saved.polar;
    };
  }, [previewOn, previewBefore, terrain, eyeVersion]);
  // Edits show at once (a weather change eases over a few seconds).
  useEffect(() => { envRef.current?.setEnvironment(readEnvironment(doc.environment)); }, [doc.environment]);
  // Double-click the ground: stand there.
  useEffect(() => {
    const st = scene.current;
    if (!st || !previewOn) return;
    const el = st.renderer.domElement, ray = new Raycaster(), ndc = new Vector2();
    const dbl = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, st.camera);
      const p = ray.intersectObject(st.ground, false)[0]?.point;
      if (p) { eyeAt.current = { x: p.x, z: p.z }; setEyeVersion((v) => v + 1); }
    };
    el.addEventListener('dblclick', dbl);
    return () => el.removeEventListener('dblclick', dbl);
  }, [previewOn]);

  // Lakes and rivers at their own water levels.
  useEffect(() => {
    const st = scene.current;
    if (!st) return;
    for (const c of [...st.water.children]) { st.water.remove(c); (c as Mesh).geometry.dispose(); }
    const mat = new MeshLambertMaterial({ color: '#2f7896', transparent: true, opacity: .85, side: DoubleSide });
    for (const lake of doc.water.lakes) {
      const shape = new Shape(lake.polygon.map(([x, z]) => new Vector2(x, z)));
      const m = new Mesh(new ShapeGeometry(shape), mat);
      m.rotation.x = Math.PI / 2; m.position.y = lake.level; st.water.add(m);
    }
    for (const river of doc.water.rivers) {
      const lv = river.levels ?? riverLevels(terrain, river), p = river.points, pos: number[] = [], idx: number[] = [];
      p.forEach((q, i) => {
        const a = p[Math.max(0, i - 1)]!, b = p[Math.min(p.length - 1, i + 1)]!, dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1, nx = -dz / len * q.width / 2, nz = dx / len * q.width / 2;
        pos.push(q.x + nx, lv[i]! + .05, q.z + nz, q.x - nx, lv[i]! + .05, q.z - nz);
        if (i) idx.push((i - 1) * 2, i * 2, (i - 1) * 2 + 1, (i - 1) * 2 + 1, i * 2, i * 2 + 1);
      });
      const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      st.water.add(new Mesh(g, mat));
    }
  }, [doc.water, terrain, version]);

  // Buildings and props, instanced per model part.
  useEffect(() => {
    const st = scene.current;
    if (!st) return;
    let cancelled = false;
    const tint = climateTint(doc.terrain.climate);
    const tinted = (m: Material | Material[]): Material => { const mat = (Array.isArray(m) ? m[0]! : m).clone() as Material & { color?: Color }; if (mat.color) mat.color.multiply(new Color(tint[0], tint[1], tint[2])); return mat; };
    const clear = () => { for (const c of [...st.objects.children]) { st.objects.remove(c); if (c instanceof InstancedMesh) c.dispose(); else if (c instanceof Mesh) c.geometry.dispose(); } };
    const placed: Array<{ asset: number; x: number; y: number; z: number; yaw: number; scale: number; sx?: number }> = [];
    const results = [...doc.regions.map((r) => r.result).filter((r): r is SettlementResult => !!r), ...(preview ? [preview] : [])];
    for (const r of results) {
      for (const b of r.buildings) {
        // Kit buildings are rebuilt from their recipe: every brick course and concrete panel.
        if (b.recipe) for (const q of compositeParts(b.recipe, b.obb.x, b.obb.z, b.yaw)) placed.push({ asset: q.asset, x: q.x, y: b.y + q.y, z: q.z, yaw: q.yaw, scale: q.scale });
        else placed.push({ asset: b.asset, x: b.x, y: b.y, z: b.z, yaw: b.yaw, scale: 1 });
      }
      for (const p of r.props) if (placed.length < MAX_INSTANCES) placed.push({ asset: p.asset, x: p.x, y: p.y, z: p.z, yaw: p.yaw, scale: p.scale, sx: p.sx });
    }
    setStatus(placed.length ? `Đang nạp ${new Set(placed.map((p) => p.asset)).size} model…` : '');
    void (async () => {
      const assets = [...new Set(placed.map((p) => p.asset))];
      const visuals = new Map(await Promise.all(assets.map(async (a) => [a, await st.library.load(a)?.catch(() => undefined)] as const)));
      if (cancelled) return;
      clear();
      // Base structures of an imported map: plain blocks.
      if (doc.base.structures.length) {
        const box = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial({ color: '#b8ab8e' }), doc.base.structures.length);
        const m = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0);
        doc.base.structures.forEach((b, i) => { const y = terrain.heightAt(b.x, b.z); m.compose(new Vector3(b.x, y + 3, b.z), q.setFromAxisAngle(up, b.yaw), new Vector3(b.hx * 2, 6, b.hz * 2)); box.setMatrixAt(i, m); });
        st.objects.add(box);
      }
      // Roads as ribbons draped over the ground.
      const roadPos: number[] = [], roadIdx: number[] = [];
      for (const r of [...doc.base.roads, ...results.flatMap((x) => x.roads)]) {
        const pts: Array<[number, number]> = [];
        for (let i = 1; i < r.points.length; i++) {
          const [ax, az] = r.points[i - 1]!, [bx, bz] = r.points[i]!, n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 6));
          for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
        }
        pts.push(r.points[r.points.length - 1] as [number, number]);
        const base = roadPos.length / 3;
        pts.forEach(([x, z], i) => {
          const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const nx = -(b[1] - a[1]) / len * r.width / 2, nz = (b[0] - a[0]) / len * r.width / 2;
          roadPos.push(x + nx, terrain.heightAt(x + nx, z + nz) + .25, z + nz, x - nx, terrain.heightAt(x - nx, z - nz) + .25, z - nz);
          if (i) roadIdx.push(base + (i - 1) * 2, base + i * 2, base + (i - 1) * 2 + 1, base + (i - 1) * 2 + 1, base + i * 2, base + i * 2 + 1);
        });
      }
      if (roadIdx.length) {
        const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(roadPos, 3)); g.setIndex(roadIdx); g.computeVertexNormals();
        st.objects.add(new Mesh(g, new MeshLambertMaterial({ color: '#55534f', side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));
      }
      const byAsset = new Map<number, typeof placed>();
      for (const p of placed) { let l = byAsset.get(p.asset); if (!l) byAsset.set(p.asset, l = []); l.push(p); }
      const m = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), v = new Vector3(), sc = new Vector3();
      for (const [asset, list] of byAsset) {
        const vis = visuals.get(asset);
        if (!vis) continue;
        for (const part of vis.parts) {
          const inst = new InstancedMesh(part.geometry, tinted(part.material), list.length);
          list.forEach((p, i) => { m.compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), sc.set(p.scale * (p.sx ?? 1), p.scale, p.scale)); inst.setMatrixAt(i, m); });
          inst.computeBoundingSphere();
          st.objects.add(inst);
        }
      }
      // Painted and generated vegetation: light stand-ins (a trunk and a crown, a bush, a rock)
      // instanced by the tens of thousands — full models for every tree would stall the view.
      addFloraImpostors(st.objects, doc.flora, terrain, tint);
      setStatus(placed.length >= MAX_INSTANCES ? `Hiển thị ${MAX_INSTANCES} đối tượng đầu tiên.` : '');
    })();
    return () => { cancelled = true; };
  }, [doc.regions, doc.base.structures, doc.flora, doc.terrain.climate, preview, terrain, modelsReady]);

  // Brush strokes on the 3D ground; orbit with the right button while a brush is active.
  useEffect(() => {
    const st = scene.current;
    if (!st) return;
    const brushOn = isBrush(tool);
    st.controls.mouseButtons = { LEFT: brushOn ? null : MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: brushOn ? MOUSE.ROTATE : MOUSE.PAN };
    st.cursor.visible = false;
    const el = st.renderer.domElement, ray = new Raycaster(), ndc = new Vector2();
    const hit = (e: PointerEvent): Vector3 | null => {
      const r = el.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, st.camera);
      return ray.intersectObject(st.ground, false)[0]?.point ?? null;
    };
    let down = false;
    const ring = (p: Vector3) => {
      const L = live.current, pts: number[] = [];
      for (let k = 0; k <= 48; k++) { const a = k / 48 * Math.PI * 2, x = p.x + Math.cos(a) * L.brush.radius, z = p.z + Math.sin(a) * L.brush.radius; pts.push(x, L.terrain.heightAt(x, z) + 1, z); }
      st.cursor.geometry.dispose(); st.cursor.geometry = new BufferGeometry(); st.cursor.geometry.setAttribute('position', new Float32BufferAttribute(pts, 3)); st.cursor.visible = true;
    };
    const onDown = (e: PointerEvent) => { if (!brushOn || e.button !== 0) return; const p = hit(e); if (!p) return; down = true; el.setPointerCapture(e.pointerId); live.current.onBrush('start', p.x, p.z); };
    const onMove = (e: PointerEvent) => { if (!brushOn) return; const p = hit(e); if (!p) { st.cursor.visible = false; return; } ring(p); if (down) live.current.onBrush('move', p.x, p.z); };
    const onUp = (e: PointerEvent) => { if (!down) return; down = false; const p = hit(e); live.current.onBrush('end', p?.x ?? 0, p?.z ?? 0); };
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); };
  }, [tool]);

  // The renderer's canvas lives in its own element: React never touches its children.
  return <div style={{ position: 'absolute', inset: 0 }} data-testid="map-3d" onContextMenu={(e) => e.preventDefault()}>
    <div ref={host} style={{ position: 'absolute', inset: 0 }} />
    {status ? <div className={s.hint} style={{ top: 'auto', bottom: 12 }}>{status}</div> : null}
  </div>;
}

/** Instanced stand-ins for flora, coloured by kind and climate with a little variation. */
function addFloraImpostors(group: Group, flora: readonly FloraItem[], terrain: Heightfield, tint: readonly number[]) {
  if (!flora.length) return;
  const kinds = { tree: [] as FloraItem[], bush: [] as FloraItem[], rock: [] as FloraItem[], grass: [] as FloraItem[] };
  for (const f of flora) (kinds[(floraGroup.get(f[0]) ?? 'tree') as keyof typeof kinds] ?? kinds.tree).push(f);
  const m = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), v = new Vector3(), sc = new Vector3(), col = new Color();
  const add = (geo: BufferGeometry, list: FloraItem[], base: string, size: (f: FloraItem) => [number, number, number], lift: (f: FloraItem) => number, vary = .12) => {
    if (!list.length) return;
    const inst = new InstancedMesh(geo, new MeshLambertMaterial({ color: '#ffffff' }), list.length);
    list.forEach((f, i) => {
      const [sx, sy, sz] = size(f);
      m.compose(v.set(f[1], terrain.heightAt(f[1], f[2]) + lift(f), f[2]), q.setFromAxisAngle(up, f[3]), sc.set(sx, sy, sz));
      inst.setMatrixAt(i, m);
      const k = 1 - vary + ((f[0] * 37 + i * 13) % 100) / 100 * vary * 2;
      inst.setColorAt(i, col.set(base).multiplyScalar(k).multiply(new Color(tint[0], tint[1], tint[2])));
    });
    inst.computeBoundingSphere();
    group.add(inst);
  };
  const crown = new IcosahedronGeometry(1, 0), cone = new ConeGeometry(1, 1, 6), trunk = new CylinderGeometry(.18, .25, 1, 5);
  const conifer = (id: number) => (id >= 2448 && id <= 2452) || (id >= 2626 && id <= 2634);
  add(trunk, kinds.tree, '#5a4632', (f) => [f[4], 3.2 * f[4], f[4]], (f) => 1.6 * f[4], .05);
  add(cone, kinds.tree.filter((f) => conifer(f[0])), '#2f4f30', (f) => [2.4 * f[4], 8 * f[4], 2.4 * f[4]], (f) => 6.2 * f[4]);
  add(crown, kinds.tree.filter((f) => !conifer(f[0])), '#3f6435', (f) => [3.2 * f[4], 2.8 * f[4], 3.2 * f[4]], (f) => 5 * f[4]);
  add(crown, kinds.bush, '#4c6e3c', (f) => [1.4 * f[4], 1 * f[4], 1.4 * f[4]], (f) => .6 * f[4]);
  add(new DodecahedronGeometry(1, 0), kinds.rock, '#8a857b', (f) => [1.2 * f[4], .7 * f[4], 1 * f[4]], (f) => .2 * f[4], .08);
  add(cone, kinds.grass, '#7d9150', (f) => [.35 * f[4], .5 * f[4], .35 * f[4]], (f) => .25 * f[4]);
}
