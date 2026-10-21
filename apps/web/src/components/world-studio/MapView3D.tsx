'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping, BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, Fog, Group, HemisphereLight, InstancedMesh,
  Line, LineBasicMaterial, MOUSE, Matrix4, Mesh, MeshLambertMaterial, PerspectiveCamera, PlaneGeometry, Quaternion, Raycaster, SRGBColorSpace, Scene, Shape, ShapeGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createDefaultRegistry } from '@zion/assets';
import { Surface } from '@zion/shared';
import { compositeParts, riverLevels, type BrushSettings, type Heightfield, type SettlementResult, type WorldMapDoc } from '@zion/worldgen/editor';
import { AssetLibrary } from '@/game/render/asset-library';
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
export default function MapView3D({ terrain, doc, version, tool, brush, onBrush, preview }: {
  terrain: Heightfield; doc: WorldMapDoc; version: number; tool: Tool; brush: BrushSettings;
  onBrush: (phase: 'start' | 'move' | 'end', x: number, z: number) => void; preview?: SettlementResult | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<{ renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; controls: OrbitControls; ground: Mesh; step: number; n: number; objects: Group; water: Group; cursor: Line; library: AssetLibrary; dirty: boolean } | null>(null);
  const live = useRef({ tool, brush, onBrush, terrain });
  live.current = { tool, brush, onBrush, terrain };
  const [status, setStatus] = useState('');

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
    sc.add(new HemisphereLight('#dfe9f2', '#4a4636', 1.1));
    const sun = new DirectionalLight('#fff2dc', 1.6); sun.position.set(-1, 1.4, -.6); sc.add(sun);
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
    const library = new AssetLibrary(createDefaultRegistry());
    scene.current = { renderer, scene: sc, camera, controls, ground, step, n, objects, water, cursor, library, dirty: true };
    const resize = () => { const r = el.getBoundingClientRect(); renderer.setSize(r.width, r.height); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(sc, camera); };
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
    const { ground, step, n } = st, pos = ground.geometry.getAttribute('position') as BufferAttribute, col = ground.geometry.getAttribute('color') as BufferAttribute;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gi = Math.min(terrain.cols - 1, i * step), gj = Math.min(terrain.rows - 1, j * step), k = j * n + i;
      const h = terrain.get(gi, gj);
      pos.setXYZ(k, gi * terrain.cell, h, gj * terrain.cell);
      const c = RGB[terrain.surface[terrain.index(gi, gj)]!] ?? RGB[Surface.Grass]!;
      const under = h < doc.terrain.seaLevel ? .55 : 1;
      col.setXYZ(k, c[0] * under, c[1] * under, c[2] * under);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    ground.geometry.computeVertexNormals(); ground.geometry.computeBoundingSphere(); ground.geometry.computeBoundingBox();
    const sea = st.scene.getObjectByName('sea'); if (sea) sea.position.y = doc.terrain.seaLevel;
  }, [terrain, version, doc.terrain.seaLevel]);

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
    const clear = () => { for (const c of [...st.objects.children]) { st.objects.remove(c); if (c instanceof InstancedMesh) c.dispose(); else if (c instanceof Mesh) c.geometry.dispose(); } };
    const placed: Array<{ asset: number; x: number; y: number; z: number; yaw: number; scale: number; sx?: number }> = [];
    for (const f of doc.flora) if (placed.length < MAX_INSTANCES) placed.push({ asset: f[0], x: f[1], y: terrain.heightAt(f[1], f[2]), z: f[2], yaw: f[3], scale: f[4] });
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
          const inst = new InstancedMesh(part.geometry, part.material, list.length);
          list.forEach((p, i) => { m.compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), sc.set(p.scale * (p.sx ?? 1), p.scale, p.scale)); inst.setMatrixAt(i, m); });
          inst.computeBoundingSphere();
          st.objects.add(inst);
        }
      }
      setStatus(placed.length >= MAX_INSTANCES ? `Hiển thị ${MAX_INSTANCES} đối tượng đầu tiên.` : '');
    })();
    return () => { cancelled = true; };
  }, [doc.regions, doc.base.structures, doc.flora, preview, terrain]);

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
