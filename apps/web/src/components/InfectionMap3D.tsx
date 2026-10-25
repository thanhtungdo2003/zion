'use client';
import { useEffect, useRef, useState } from 'react';
import { AmbientLight, Color, CylinderGeometry, DirectionalLight, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Object3D } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AssetRegistry } from '@zion/assets';
import { EntityFlags, type InfectionMapDef } from '@zion/shared';
import type { InfectionMapPreview } from '@/lib/api';
import { loadPlayerCharacter, type CharacterTemplate } from '@/game/render/character-model';
import { Avatar } from '@/game/render/avatars';
import { buildInfectionMapScene } from '@/studio/infection-map-scene';
import { Spinner } from './Spinner';

type Point = { x: number; z: number; y?: number };
/** Survivor figures drawn at the spawn points (beyond this many, plain pins). */
const MAX_FIGURES = 40;

/**
 * The whole Infection map in 3D, with survivors standing at the spawn points (true size, to judge
 * the map model's scale against them) and red-tinted ones at the zombie points. With the spawn
 * tools, a click on any surface of the map (a floor, a roof, a stair) places a point there in 3D;
 * a click on an existing point of that kind removes it.
 */
export default function InfectionMap3D({ preview, draft, registry, buildKey, tool, onPoint }: {
  preview: InfectionMapPreview; draft: InfectionMapDef; registry: AssetRegistry; buildKey: string;
  tool: 'spawn' | 'zombie' | null; onPoint: (kind: 'spawn' | 'zombie', p: { x: number; y: number; z: number } | null, remove: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<{ scene: Scene; map: Group; markers: Group; camera: PerspectiveCamera; renderer: WebGLRenderer; character: CharacterTemplate | null; avatars: Avatar[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const live = useRef({ tool, onPoint, draft, preview }); live.current = { tool, onPoint, draft, preview };
  const [ready, setReady] = useState(0);

  // Renderer, camera and controls: once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, frame = 0;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = SRGBColorSpace; renderer.setClearColor(new Color(0x9fb3c4));
    el.appendChild(renderer.domElement);
    const scene = new Scene(), map = new Group(), markers = new Group();
    scene.add(map, markers, new AmbientLight(0xffffff, 1.4));
    const sun = new DirectionalLight(0xffffff, 2.2); sun.position.set(60, 120, 40); scene.add(sun);
    const camera = new PerspectiveCamera(50, 1, .1, 3000);
    camera.position.set(0, 60, 90);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0); controls.update();
    stage.current = { scene, map, markers, camera, renderer, character: null, avatars: [] };
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const loop = () => { if (disposed) return; renderer.render(scene, camera); frame = requestAnimationFrame(loop); };
    frame = requestAnimationFrame(loop);
    void loadPlayerCharacter().then((c) => { if (!disposed && stage.current) { stage.current.character = c; setReady((n) => n + 1); } }).catch(() => undefined);
    // A click (not a drag) with a spawn tool: the surface under the cursor.
    let downAt: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
    const up = (e: PointerEvent) => {
      const { tool: t, onPoint: place, draft: d } = live.current;
      if (!t || !downAt || e.button !== 0 || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ray = new Raycaster(); ray.setFromCamera(new Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      // An existing point of this kind under the cursor: removed.
      const list = t === 'spawn' ? d.spawns : d.zombieSpawns;
      const markerHit = ray.intersectObjects(markers.children, true).find((h) => (h.object.userData.kind ?? h.object.parent?.userData.kind) === t);
      const index = markerHit ? Number(markerHit.object.userData.index ?? markerHit.object.parent?.userData.index) : -1;
      if (index >= 0 && index < list.length) { place(t, null, index); return; }
      const hit = ray.intersectObject(map, true)[0];
      if (!hit) return;
      place(t, { x: +hit.point.x.toFixed(2), y: +hit.point.y.toFixed(2), z: +hit.point.z.toFixed(2) }, -1);
    };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up);
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      for (const a of stage.current?.avatars ?? []) a.dispose(scene);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); stage.current = null;
    };
  }, []);

  // The map itself: rebuilt when its layout changes.
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    let stale = false;
    setLoading(true);
    void buildInfectionMapScene(preview, draft, registry).then((root: Object3D) => {
      if (stale || !stage.current) return;
      st.map.clear(); st.map.add(root);
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `buildKey` stands for the layout.
  }, [buildKey]);

  // Survivors at the spawn points (zombie points tinted red): rebuilt when the points change.
  const pointsKey = JSON.stringify([draft.spawns, draft.zombieSpawns, preview.spawns.length, ready]);
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    for (const a of st.avatars) a.dispose(st.scene);
    st.avatars = []; st.markers.clear();
    const ground = preview.ground ?? 0;
    const heightAt = (p: Point) => {
      if (p.y !== undefined) return p.y;
      // Not placed in 3D: on the highest surface there (as the server would find a floor).
      const ray = new Raycaster(new Vector3(p.x, ground + 80, p.z), new Vector3(0, -1, 0));
      return ray.intersectObject(st.map, true)[0]?.point.y ?? ground;
    };
    const shown: Array<[Point, 'spawn' | 'zombie', number]> = [
      ...(draft.spawns.length ? draft.spawns : preview.spawns).map((p, i) => [p, 'spawn', draft.spawns.length ? i : -1] as [Point, 'spawn', number]),
      ...draft.zombieSpawns.map((p, i) => [p, 'zombie', i] as [Point, 'zombie', number]),
    ];
    // With no spawn point yet: one survivor in the middle, for scale.
    if (!shown.length) shown.push([{ x: 0, z: 0 }, 'spawn', -1]);
    shown.forEach(([p, kind, index], n) => {
      const y = heightAt(p);
      const pin = new Group(); pin.userData = { kind, index };
      const color = kind === 'spawn' ? 0x3fa4ff : 0xff3b30;
      const stick = new Mesh(new CylinderGeometry(.08, .08, 2.6, 8), new MeshBasicMaterial({ color, transparent: true, opacity: .55 }));
      stick.position.set(p.x, y + 1.3, p.z); stick.userData = { kind, index };
      const ring = new Mesh(new CylinderGeometry(.55, .55, .05, 24), new MeshBasicMaterial({ color, transparent: true, opacity: .6 }));
      ring.position.set(p.x, y + .03, p.z); ring.userData = { kind, index };
      pin.add(stick, ring);
      st.markers.add(pin);
      if (st.character && n < MAX_FIGURES) {
        const avatar = new Avatar(st.character, false);
        avatar.addTo(st.scene);
        for (let i = 0; i < 3; i++) avatar.update(p.x, y, p.z, 0, EntityFlags.Grounded, 1 / 30, i / 30);
        if (kind === 'zombie') avatar.setInfected(true);
        st.avatars.push(avatar);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pointsKey` stands for the points.
  }, [pointsKey, buildKey, loading]);

  return <div className="ix-plan-3d" ref={host} style={{ cursor: tool ? 'crosshair' : 'grab' }}>
    {loading && <div className="ws-viewer-state"><Spinner /> Đang dựng bản đồ…</div>}
    <div className="ws-viewer-hint" style={{ top: 'auto', bottom: 10 }}>
      {tool ? `Nhấp lên bề mặt bản đồ để đặt điểm ${tool === 'spawn' ? 'người chơi' : 'zombie'} · nhấp lại điểm cũ để xóa` : 'Kéo để xoay · chuột phải kéo để dời · lăn để thu phóng · chọn công cụ điểm xuất hiện để đặt trong 3D'} · nhân vật cao ~1,8 m
    </div>
  </div>;
}
