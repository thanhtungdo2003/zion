'use client';

import { useEffect, useRef, useState } from 'react';
import { AmbientLight, Box3, BoxHelper, Color, DirectionalLight, GridHelper, Mesh, PerspectiveCamera, PointLight, Raycaster, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Euler, type Material, type MeshStandardMaterial, type Object3D } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { gltfLoader } from '@/game/render/gltf-loader';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

/**
 * The blocks of an imported map model, one by one: click a block to move, turn or stretch it with
 * the gizmo, recolour it, or make it glow and light the area round it like a lamp (an emissive
 * surface plus a point light saved in the model). Saved as a new version of the model: the
 * collision is computed again from it, and the map switches to it.
 */
type Mode = 'translate' | 'rotate' | 'scale';
interface Glow { color: string; power: number; range: number }

export default function GlbBlockEditor({ url, name, onSave, onClose }: { url: string; name: string; onSave: (glb: ArrayBuffer) => Promise<void>; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<{ scene: Scene; root: Object3D; gizmo: TransformControls; box: BoxHelper; camera: PerspectiveCamera; renderer: WebGLRenderer; controls: OrbitControls } | null>(null);
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState<Mesh | null>(null);
  const [mode, setMode] = useState<Mode>('translate');
  const [, bump] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(0);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, raf = 0;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = SRGBColorSpace; renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(new Color(0x1c232a));
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 1.1));
    const sun = new DirectionalLight(0xffffff, 1.8); sun.position.set(30, 60, 20); scene.add(sun);
    const camera = new PerspectiveCamera(55, 1, .05, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; });
    gizmo.addEventListener('objectChange', () => { box.update(); setChanged((n) => n + 1); });
    scene.add(gizmo.getHelper());
    const box = new BoxHelper(new Mesh(), 0x4fc3ff); box.visible = false; scene.add(box);
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    void gltfLoader().loadAsync(url).then((gltf) => {
      if (disposed) return;
      const root = gltf.scene;
      scene.add(root);
      // Each block its own materials (a colour or glow given to one never paints the others).
      root.traverse((o) => { const m = o as Mesh; if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone(); });
      const b = new Box3().setFromObject(root), size = b.getSize(new Vector3()).length() || 10, c = b.getCenter(new Vector3());
      camera.position.copy(c).add(new Vector3(.6, .5, .6).multiplyScalar(size)); controls.target.copy(c); camera.far = size * 20; camera.updateProjectionMatrix(); controls.update();
      scene.add(new GridHelper(size * 2, 40, 0x3a4650, 0x2a333a)).position.y = b.min.y;
      stage.current = { scene, root, gizmo, box, camera, renderer, controls };
      setReady(true);
    }).catch((e: unknown) => setError(`Không mở được model: ${(e as Error).message}`));
    const frame = () => { raf = requestAnimationFrame(frame); controls.update(); renderer.render(scene, camera); };
    raf = requestAnimationFrame(frame);
    return () => { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); gizmo.dispose(); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [url]);

  useEffect(() => { stage.current?.gizmo.setMode(mode); }, [mode]);

  // Click a block (not a drag of the view).
  const down = useRef<{ x: number; y: number } | null>(null);
  const pick = (e: React.PointerEvent) => {
    const st = stage.current, el = host.current, d = down.current;
    if (!st || !el || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || st.gizmo.dragging) return;
    const r = el.getBoundingClientRect(), ray = new Raycaster();
    ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), st.camera);
    const hit = ray.intersectObject(st.root, true).find((h) => (h.object as Mesh).isMesh && h.object.visible);
    const mesh = (hit?.object as Mesh | undefined) ?? null;
    setPicked(mesh);
    if (mesh) { st.gizmo.attach(mesh); st.box.setFromObject(mesh); st.box.visible = true; } else { st.gizmo.detach(); st.box.visible = false; }
  };

  const materials = (m: Mesh): MeshStandardMaterial[] => (Array.isArray(m.material) ? m.material : [m.material]).filter((x: Material): x is MeshStandardMaterial => 'color' in x);
  const colourOf = (m: Mesh) => `#${materials(m)[0]?.color.getHexString() ?? 'ffffff'}`;
  const glowOf = (m: Mesh): Glow | null => {
    const light = m.children.find((c): c is PointLight => (c as PointLight).isPointLight);
    return light ? { color: `#${light.color.getHexString()}`, power: light.intensity, range: light.distance } : null;
  };
  const setColour = (m: Mesh, hex: string) => { for (const x of materials(m)) x.color.set(hex); setChanged((n) => n + 1); bump((n) => n + 1); };
  /** Glowing: the block's surface lit from within, and a lamp at its middle lighting the area round it. */
  const setGlow = (m: Mesh, g: Glow | null) => {
    let light = m.children.find((c): c is PointLight => (c as PointLight).isPointLight);
    for (const x of materials(m)) { x.emissive.set(g ? g.color : '#000000'); x.emissiveIntensity = g ? Math.min(4, .6 + g.power * .25) : 1; }
    if (!g) { if (light) m.remove(light); }
    else {
      if (!light) {
        light = new PointLight(g.color, g.power, g.range, 2); light.name = 'block-light';
        // At the block's middle (in its own frame).
        m.geometry.computeBoundingBox(); m.geometry.boundingBox!.getCenter(light.position);
        m.add(light);
      }
      light.color.set(g.color); light.intensity = g.power; light.distance = g.range;
    }
    setChanged((n) => n + 1); bump((n) => n + 1);
  };
  const resetBlock = (m: Mesh) => { m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1); stage.current?.box.update(); setChanged((n) => n + 1); };

  const save = async () => {
    const st = stage.current;
    if (!st) return;
    setSaving(true); setError('');
    try {
      st.gizmo.detach(); st.box.visible = false;
      const glb = await new GLTFExporter().parseAsync(st.root, { binary: true }) as ArrayBuffer;
      await onSave(glb);
      onClose();
    } catch (e) { setError(`Không lưu được: ${(e as Error).message}`); if (picked) st.gizmo.attach(picked); }
    finally { setSaving(false); }
  };

  const glow = picked ? glowOf(picked) : null;
  const deg = (v: number) => Math.round(v * 180 / Math.PI);
  const vec = (label: string, v: Vector3 | Euler, toShow: (n: number) => number, fromShow: (n: number) => number, step: number) => (
    <div className="gbe-vec"><span>{label}</span>
      {(['x', 'y', 'z'] as const).map((k) => <input key={k} type="number" step={step} value={+toShow(v[k]).toFixed(3)} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) { v[k] = fromShow(n); stage.current?.box.update(); setChanged((c) => c + 1); bump((c) => c + 1); } }} />)}
    </div>
  );
  return (
    <div className="gbe-backdrop">
      <div className="gbe">
        <header className="gbe-bar">
          <b>Chỉnh khối model · {name}</b>
          <div className="gbe-modes">
            {([['translate', 'lucide:move', 'Di chuyển'], ['rotate', 'lucide:rotate-3d', 'Xoay'], ['scale', 'lucide:scaling', 'Kéo dãn']] as const).map(([m, icon, label]) => (
              <button key={m} className={`btn${mode === m ? ' btn-primary' : ''}`} onClick={() => setMode(m)}><Icon name={icon} /> {label}</button>
            ))}
          </div>
          <span className="gbe-note">{changed ? 'Có thay đổi chưa lưu' : 'Bấm vào một khối để chọn'}</span>
          <button className="btn btn-primary" disabled={!ready || saving || !changed} onClick={() => void save()}>{saving ? <><Spinner /> Đang lưu và tính va chạm…</> : <><Icon name="lucide:save" /> Lưu model</>}</button>
          <button className="btn" onClick={onClose} disabled={saving}>Đóng</button>
        </header>
        <div className="gbe-body">
          <div className="gbe-view" ref={host} onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; }} onPointerUp={pick}>
            {!ready && !error && <div className="gbe-wait"><Spinner /> Đang mở model…</div>}
          </div>
          <aside className="gbe-side">
            {error && <p className="error">{error}</p>}
            {!picked && <p className="ix-hint">Bấm một khối trong model (nhà, đá, cột đèn…) để chỉnh. Kéo chuột để xoay góc nhìn, cuộn để thu phóng.</p>}
            {picked && <>
              <h3>{picked.name || 'Khối'}</h3>
              {vec('Vị trí', picked.position, (n) => n, (n) => n, .1)}
              {vec('Xoay (°)', picked.rotation, deg, (n) => n * Math.PI / 180, 1)}
              {vec('Tỉ lệ', picked.scale, (n) => n, (n) => Math.max(.01, n), .05)}
              <button className="btn" onClick={() => resetBlock(picked)}>Về vị trí gốc</button>
              <label className="ix-field"><span>Màu</span><input type="color" value={colourOf(picked)} onChange={(e) => setColour(picked, e.target.value)} /></label>
              <label className="ix-field"><span>Phát sáng (như đèn)</span><input type="checkbox" checked={!!glow} onChange={(e) => setGlow(picked, e.target.checked ? { color: '#ffd9a0', power: 3, range: 14 } : null)} /></label>
              {glow && <>
                <label className="ix-field"><span>Màu ánh sáng</span><input type="color" value={glow.color} onChange={(e) => setGlow(picked, { ...glow, color: e.target.value })} /></label>
                <label className="ix-field"><span>Độ sáng<b>{glow.power.toFixed(1)}</b></span><input type="range" min={.2} max={10} step={.1} value={glow.power} onChange={(e) => setGlow(picked, { ...glow, power: Number(e.target.value) })} /></label>
                <label className="ix-field"><span>Tầm chiếu<b>{glow.range.toFixed(0)} m</b></span><input type="range" min={2} max={60} step={1} value={glow.range} onChange={(e) => setGlow(picked, { ...glow, range: Number(e.target.value) })} /></label>
              </>}
            </>}
            <p className="ix-hint">Lưu tạo phiên bản mới của model (va chạm tính lại) và bản đồ chuyển sang dùng nó.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
