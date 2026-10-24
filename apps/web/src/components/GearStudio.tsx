'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AmbientLight, BufferGeometry, DirectionalLight, Float32BufferAttribute, GridHelper, Line, LineBasicMaterial, PerspectiveCamera, Plane, Points, PointsMaterial, Raycaster, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Mesh } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ARMOR_SLOTS, ARMOR_SPECS, CARRY_HOOKS, DEFAULT_APPEARANCE, EntityFlags, ITEMS, NO_ARMOR, type ArmorLoadout, type ArmorSlot, type CarriedGear, type GearAdjust, type GearFit } from '@zion/shared';
import { hasStudioSession, studioLogin, studioSaveGearFit } from '@/lib/api';
import { gearFit, loadGearFit, setGearFit } from '@/game/gear-fit';
import { Avatar, OUTFIT_KEYS } from '@/game/render/avatars';
import { loadArmorPiece } from '@/game/render/armor-models';
import { loadPlayerCharacter } from '@/game/render/character-model';
import { loadWeapons, type WeaponLibrary } from '@/game/render/weapons';
import { Icon } from './Icon';

/**
 * Gear Studio (/studio/gear): the survivor wearing the armour, backpack and weapons ticked here,
 * moving as in the game (standing, walking, running). Pick a piece or a carry hook and move, turn
 * or resize it by hand; paint loose parts (strap ends, cords) and press "Làm mềm" so they swing
 * with gravity and inertia. Saved for every client: the game shows it exactly as here.
 */
const SLOT_NAME: Record<ArmorSlot, string> = { head: 'Nón', face: 'Mặt', ears: 'Tai', chest: 'Áo giáp' };
const HOOK_NAME: Record<string, string> = { back_right: 'Móc lưng phải', back_left: 'Móc lưng trái', back_center: 'Móc ba lô', hip_right: 'Móc hông phải', hip_left: 'Móc hông trái', chest: 'Móc ngực' };
const NO_ADJUST: GearAdjust = { offset: [0, 0, 0], rotate: [0, 0, 0], scale: 1 };
type Motion = 'idle' | 'walk' | 'run';

export function GearStudioPage() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(!hasStudioSession());
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [armor, setArmor] = useState<ArmorLoadout>({ ...NO_ARMOR, chest: 65 });
  const [gear, setGear] = useState<CarriedGear>({ back: ['ak47', 'shotgun'], holster: 'gl18', belt: 'grenade', pack: 'military_backpack' });
  const [hand, setHand] = useState<string>('');
  const [motion, setMotion] = useState<Motion>('idle');
  const [target, setTarget] = useState<string>('vest_premium');
  const [fit, setFit] = useState<GearFit>(gearFit());
  const [paint, setPaint] = useState(false);
  const [brush, setBrush] = useState(.03);
  const [meshIndex, setMeshIndex] = useState(0);
  const [stiffness, setStiffness] = useState(.3);
  const [painted, setPainted] = useState<Set<number>>(new Set());
  /** "Kéo": drag a point of the model's surface (e.g. a shoulder strap over the shoulder). */
  const [pull, setPull] = useState(false);
  const grabbed = useRef<{ mesh: Mesh; local: Vector3; world: Vector3; plane: Plane; end: Vector3 } | null>(null);
  /** Bumped when the dressed model changes (the mesh list follows it). */
  const [dressed, setDressed] = useState(0);
  const world = useRef<{ avatar: Avatar; weapons: WeaponLibrary; camera: PerspectiveCamera; scene: Scene; overlay: Points | null; marker: Line | null; renderer: WebGLRenderer; controls: OrbitControls } | null>(null);
  const live = useRef({ motion, paint, brush, meshIndex, target });
  live.current = { motion, paint, brush, meshIndex, target };
  const pullLive = useRef(pull); pullLive.current = pull;

  // The scene: the survivor on a turntable, the camera following when it walks.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, raf = 0;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 1.2));
    const sun = new DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); scene.add(sun);
    const rim = new DirectionalLight(0xbfd4ff, 1); rim.position.set(-2, 2, -3); scene.add(rim);
    scene.add(new GridHelper(20, 40, 0x555555, 0x333333));
    const camera = new PerspectiveCamera(35, 1, .05, 100);
    camera.position.set(1.6, 1.7, -2.6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.25, 0);
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    void Promise.all([loadPlayerCharacter(), loadGearFit()]).then(async ([character]) => {
      const weapons = await loadWeapons(character);
      if (disposed) return;
      setFit(gearFit());
      const avatar = new Avatar(character, true);
      avatar.setAppearance(DEFAULT_APPEARANCE);
      avatar.addTo(scene);
      world.current = { avatar, weapons, camera, scene, overlay: null, marker: null, renderer, controls };
      setReady(true);
      let last = performance.now(), z = 0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(.1, (now - last) / 1000); last = now;
        const m = live.current.motion, speed = m === 'run' ? 5.5 : m === 'walk' ? 2.2 : 0;
        // A treadmill: walks forward 8 m, then starts over.
        z -= speed * dt; if (z < -8) z = 0;
        const before = avatar.root.position.z;
        avatar.update(0, 0, z, 0, EntityFlags.Grounded | (m === 'run' ? EntityFlags.Sprinting : 0), dt, now / 1000);
        const moved = avatar.root.position.z - before;
        camera.position.z += moved; controls.target.z += moved;
        controls.update();
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(frame);
    });
    return () => { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, []);

  // Dressing.
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    for (const slot of ARMOR_SLOTS) {
      const id = armor[slot];
      if (!id) { w.avatar.setArmor(slot, null); continue; }
      void loadArmorPiece(id).then((piece) => { if (world.current === w) { w.avatar.setArmor(slot, piece); setDressed((n) => n + 1); } });
    }
  }, [armor, ready]);
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    w.avatar.setStance(hand ? (ITEMS[hand]?.stance ?? 'rifle') : 'unarmed');
    w.avatar.setWeapon(hand || null, w.weapons);
    w.avatar.setGear(gear, w.weapons);
    const t = setTimeout(() => setDressed((n) => n + 1), 1500);
    return () => clearTimeout(t);
  }, [gear, hand, ready]);

  // The fitting is applied live (every avatar listening re-dresses).
  const update = (next: GearFit) => { setFit(next); setGearFit(next); setTimeout(() => setDressed((n) => n + 1), 300); };
  void dressed;
  const adjust = fit.adjust[target] ?? NO_ADJUST;
  const setAdjust = (a: GearAdjust) => update({ ...fit, adjust: { ...fit.adjust, [target]: a } });
  const targets = useMemo(() => [
    ...ARMOR_SLOTS.flatMap((s) => { const spec = ARMOR_SPECS.find((a) => a.id === armor[s]); return spec ? [{ key: spec.item, name: `${SLOT_NAME[s]}: ${spec.name}`, paintable: true }] : []; }),
    ...(gear.pack ? [{ key: 'military_backpack', name: 'Ba lô quân đội', paintable: true }] : []),
    // Each stowed weapon's own place (on the pack's sides / top, the back, the hip, the belt).
    ...gear.back.map((id, i) => ({ key: `sling:back_${i + 1}`, name: `Súng trên lưng ${i + 1}: ${ITEMS[id]?.name ?? id}`, paintable: false })),
    ...(gear.holster ? [{ key: 'sling:holster', name: `Bao súng hông: ${ITEMS[gear.holster]?.name ?? gear.holster}`, paintable: false }] : []),
    ...(gear.belt ? [{ key: 'sling:belt', name: `Móc thắt lưng: ${ITEMS[gear.belt]?.name ?? gear.belt}`, paintable: false }] : []),
    ...CARRY_HOOKS.map((h) => ({ key: `hook:${h}`, name: HOOK_NAME[h]!, paintable: false })),
    // The default trousers and boots every survivor wears (not inventory items).
    { key: OUTFIT_KEYS.top, name: 'Áo mặc định', paintable: false },
    { key: OUTFIT_KEYS.legs, name: 'Quần mặc định', paintable: false },
    { key: OUTFIT_KEYS.feet, name: 'Giày mặc định', paintable: false },
  ], [armor, gear]);
  const paintable = targets.find((t) => t.key === target)?.paintable ?? false;
  const regions = fit.soft[target] ?? [];

  // Painting: the brush marks the vertices of the chosen mesh under the cursor.
  const meshes = (): Mesh[] => world.current?.avatar.gearMeshes(live.current.target) ?? [];
  const showPainted = (set: Set<number>) => {
    const w = world.current;
    if (!w) return;
    w.overlay?.removeFromParent();
    w.overlay = null;
    const mesh = meshes()[live.current.meshIndex];
    if (!mesh || !set.size) return;
    const pos = mesh.geometry.getAttribute('position'), pts: number[] = [];
    for (const i of set) if (i < pos.count) pts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pts, 3));
    w.overlay = new Points(g, new PointsMaterial({ color: 0xffa31a, size: 4, sizeAttenuation: false, depthTest: false }));
    w.overlay.renderOrder = 10;
    mesh.add(w.overlay);
  };
  useEffect(() => { setPainted(new Set()); showPainted(new Set()); }, [target, meshIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (world.current) world.current.controls.enabled = !paint && !pull; }, [paint, pull]);
  const pointerRay = (e: React.PointerEvent) => {
    const w = world.current!, r = w.renderer.domElement.getBoundingClientRect(), ray = new Raycaster();
    ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), w.camera);
    return ray;
  };
  /** Pull: press on the surface, drag in the plane facing the camera, release to keep it. */
  const pullDown = (e: React.PointerEvent) => {
    const w = world.current, mesh = meshes()[live.current.meshIndex];
    if (!w || !mesh || !pullLive.current) return;
    const hit = pointerRay(e).intersectObject(mesh, false)[0];
    if (!hit) return;
    const normal = w.camera.getWorldDirection(new Vector3());
    grabbed.current = { mesh, local: mesh.worldToLocal(hit.point.clone()), world: hit.point.clone(), plane: new Plane().setFromNormalAndCoplanarPoint(normal, hit.point), end: hit.point.clone() };
    showMarker(hit.point, hit.point);
  };
  const pullMove = (e: React.PointerEvent) => {
    const g = grabbed.current;
    if (!g || !(e.buttons & 1)) return;
    const at = pointerRay(e).ray.intersectPlane(g.plane, new Vector3());
    if (at) { g.end.copy(at); showMarker(g.world, at); }
  };
  const pullUp = () => {
    const g = grabbed.current;
    grabbed.current = null;
    showMarker(null, null);
    if (!g || g.end.distanceTo(g.world) < 1e-4) return;
    const k = g.mesh.getWorldScale(new Vector3()).x || 1;
    const d = g.mesh.worldToLocal(g.end.clone()).sub(g.local);
    const drag = { mesh: live.current.meshIndex, p: g.local.toArray() as [number, number, number], d: d.toArray() as [number, number, number], r: live.current.brush / k };
    update({ ...fit, drag: { ...fit.drag, [live.current.target]: [...(fit.drag[live.current.target] ?? []), drag] } });
  };
  const showMarker = (from: Vector3 | null, to: Vector3 | null) => {
    const w = world.current;
    if (!w) return;
    w.marker?.removeFromParent();
    w.marker = null;
    if (!from || !to) return;
    const g = new BufferGeometry().setFromPoints([from, to]);
    w.marker = new Line(g, new LineBasicMaterial({ color: 0x4fd1ff, depthTest: false }));
    w.marker.renderOrder = 11;
    w.scene.add(w.marker);
  };
  const drags = (fit.drag[target] ?? []).filter((d) => d.mesh === meshIndex);
  const setDrags = (list: typeof drags) => {
    const others = (fit.drag[target] ?? []).filter((d) => d.mesh !== meshIndex), all = { ...fit.drag };
    if (others.length + list.length) all[target] = [...others, ...list]; else delete all[target];
    update({ ...fit, drag: all });
  };
  const stroke = (e: React.PointerEvent) => {
    const w = world.current;
    if (!w || !live.current.paint || !(e.buttons & 1)) return;
    const r = w.renderer.domElement.getBoundingClientRect(), ray = new Raycaster();
    ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), w.camera);
    const mesh = meshes()[live.current.meshIndex];
    if (!mesh) return;
    const hit = ray.intersectObject(mesh, false)[0];
    if (!hit) return;
    const local = mesh.worldToLocal(hit.point.clone()), pos = mesh.geometry.getAttribute('position'), v = new Vector3();
    // The brush radius is in metres; the mesh may be scaled.
    const k = mesh.getWorldScale(new Vector3()).x || 1, rad = live.current.brush / k;
    setPainted((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < pos.count; i++) if (v.fromBufferAttribute(pos, i).distanceTo(local) < rad) { if (e.shiftKey) next.delete(i); else next.add(i); }
      showPainted(next);
      return next;
    });
  };
  const soften = () => {
    if (!painted.size) return;
    const rest = regions.filter((r) => r.mesh !== meshIndex);
    update({ ...fit, soft: { ...fit.soft, [target]: [...rest, { mesh: meshIndex, vertices: [...painted].sort((a, b) => a - b), stiffness }] } });
    setPainted(new Set()); showPainted(new Set()); setPaint(false);
  };
  const clearSoft = () => {
    const rest = regions.filter((r) => r.mesh !== meshIndex), soft = { ...fit.soft };
    if (rest.length) soft[target] = rest; else delete soft[target];
    update({ ...fit, soft });
  };
  const save = async () => {
    setStatus('Đang lưu…');
    try { await studioSaveGearFit(fit); setStatus('✓ Đã lưu — trong game sẽ y như vậy.'); }
    catch (err) {
      const code = (err as { status?: number }).status;
      if (code === 401 || code === 403) { setLocked(true); setStatus('Cần mật khẩu xưởng.'); } else setStatus(`✕ ${err instanceof Error ? err.message : 'Không lưu được.'}`);
    }
  };

  const rifles = Object.values(ITEMS).filter((d) => ['rifle', 'shotgun', 'heavy'].includes(d.category)).map((d) => d.id);
  const sidearms = Object.values(ITEMS).filter((d) => d.category === 'pistol' || d.category === 'smg').map((d) => d.id);
  const belts = Object.values(ITEMS).filter((d) => d.category === 'grenade').map((d) => d.id);
  const pick = (value: string | null, list: string[], set: (v: string | null) => void, none = '— không —') => (
    <select value={value ?? ''} onChange={(e) => set(e.target.value || null)}><option value="">{none}</option>{list.map((id) => <option key={id} value={id}>{ITEMS[id]?.name ?? id}</option>)}</select>
  );
  const num = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void) => (
    <label key={label} className="gs-num"><span>{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} /><input type="number" min={min} max={max} step={step} value={+value.toFixed(3)} onChange={(e) => set(Number(e.target.value) || 0)} /></label>
  );

  return (
    <div className="gs-page">
      <header className="gs-bar">
        <Link href="/studio" className="studio-back" title="Về Xưởng"><Icon name="lucide:arrow-left" /></Link>
        <h1>Trang bị trên nhân vật</h1>
        <div className="gs-motion">{(['idle', 'walk', 'run'] as const).map((m) => <button key={m} className={`btn${motion === m ? ' btn-primary' : ''}`} onClick={() => setMotion(m)}>{m === 'idle' ? 'Đứng' : m === 'walk' ? 'Đi' : 'Chạy'}</button>)}</div>
        <span className="gs-status">{status}</span>
        <button className="btn btn-primary" onClick={() => void save()} disabled={!ready}><Icon name="lucide:save" /> Lưu</button>
      </header>
      <aside className="gs-panel">
        <h3>Đang mặc / mang</h3>
        {ARMOR_SLOTS.map((s) => (
          <label key={s} className="gs-row"><span>{SLOT_NAME[s]}</span>
            <select value={armor[s]} onChange={(e) => setArmor({ ...armor, [s]: Number(e.target.value) })}><option value={0}>— không —</option>{ARMOR_SPECS.filter((a) => a.slot === s).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </label>
        ))}
        <label className="gs-row"><input type="checkbox" checked={!!gear.pack} onChange={(e) => setGear({ ...gear, pack: e.target.checked ? 'military_backpack' : null })} /> <span>Ba lô quân đội</span></label>
        {[0, 1, 2].map((i) => <label key={i} className="gs-row"><span>Súng trên lưng {i + 1}</span>{pick(gear.back[i] ?? null, rifles, (v) => { const back = [...gear.back]; if (v) back[i] = v; else back.splice(i, 1); setGear({ ...gear, back: back.filter(Boolean) }); })}</label>)}
        <label className="gs-row"><span>Bao súng hông</span>{pick(gear.holster, sidearms, (v) => setGear({ ...gear, holster: v }))}</label>
        <label className="gs-row"><span>Móc thắt lưng</span>{pick(gear.belt, belts, (v) => setGear({ ...gear, belt: v }))}</label>
        <label className="gs-row"><span>Cầm trên tay</span>{pick(hand || null, [...rifles, ...sidearms], (v) => setHand(v ?? ''), '— tay không —')}</label>
      </aside>
      <div className={`gs-view${paint || pull ? ' painting' : ''}`} ref={host} onPointerDown={(e) => { stroke(e); pullDown(e); }} onPointerMove={(e) => { stroke(e); pullMove(e); }} onPointerUp={pullUp} onPointerLeave={pullUp} />
      <aside className="gs-panel">
        <h3>Chỉnh món</h3>
        <select className="gs-target" value={target} onChange={(e) => { setTarget(e.target.value); setMeshIndex(0); setPaint(false); setPull(false); }}>
          {targets.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          {!targets.some((t) => t.key === target) && <option value={target}>{target}</option>}
        </select>
        <h4>Vị trí (m) · trái/phải, lên/xuống, trước/sau</h4>
        {(['X', 'Y', 'Z'] as const).map((a, k) => num(a, adjust.offset[k]!, -.3, .3, .002, (v) => { const o = [...adjust.offset] as [number, number, number]; o[k] = v; setAdjust({ ...adjust, offset: o }); }))}
        <h4>Xoay (độ)</h4>
        {(['X', 'Y', 'Z'] as const).map((a, k) => num(a, adjust.rotate[k]!, -180, 180, 1, (v) => { const r = [...adjust.rotate] as [number, number, number]; r[k] = v; setAdjust({ ...adjust, rotate: r }); }))}
        <h4>Kích thước</h4>
        {num('×', adjust.scale, .5, 1.6, .005, (v) => setAdjust({ ...adjust, scale: v }))}
        <button className="btn" onClick={() => { const a = { ...fit.adjust }; delete a[target]; update({ ...fit, adjust: a }); }}>Về mặc định</button>
        {paintable && <>
          <h3>Vùng mềm (dây thừa, dây treo…)</h3>
          <label className="gs-row"><span>Phần model</span><select value={meshIndex} onChange={(e) => setMeshIndex(Number(e.target.value))}>{(world.current?.avatar.gearMeshes(target) ?? []).map((m, i) => <option key={i} value={i}>{i + 1}. {m.name || 'mesh'}{regions.some((r) => r.mesh === i) ? ' · mềm' : ''}</option>)}</select></label>
          <div className="gs-row">
            <button className={`btn${paint ? ' btn-primary' : ''}`} onClick={() => { setPaint(!paint); setPull(false); }}><Icon name="lucide:brush" /> {paint ? 'Đang tô (Shift: xoá)' : 'Tô vùng'}</button>
            <button className={`btn${pull ? ' btn-primary' : ''}`} onClick={() => { setPull(!pull); setPaint(false); }}><Icon name="lucide:move" /> {pull ? 'Đang kéo' : 'Kéo điểm'}</button>
          </div>
          {num('Cọ (m)', brush, .005, .12, .001, setBrush)}
          {num('Độ cứng', stiffness, 0, 1, .05, setStiffness)}
          <div className="gs-row"><button className="btn btn-primary" disabled={!painted.size} onClick={soften}>Làm mềm ({painted.size} điểm)</button><button className="btn" onClick={clearSoft} disabled={!regions.some((r) => r.mesh === meshIndex)}>Bỏ vùng mềm</button></div>
          <div className="gs-row"><span>Đã kéo {drags.length} lần</span><button className="btn" disabled={!drags.length} onClick={() => setDrags(drags.slice(0, -1))}>Hoàn tác</button><button className="btn" disabled={!drags.length} onClick={() => setDrags([])}>Bỏ hết</button></div>
          <p className="gs-hint">Kéo điểm: bấm lên bề mặt (ví dụ quai ba lô) rồi kéo tới chỗ cần (qua vai), thả chuột để giữ; vùng ảnh hưởng theo cỡ “Cọ”. Xoay camera để kéo theo hướng khác.</p>
          <p className="gs-hint">Tô lên phần cần thả lỏng (ví dụ hai đầu dây thừa của ba lô) rồi bấm “Làm mềm”: phần đó rủ theo trọng lực và đung đưa theo quán tính. Chọn “Đi”/“Chạy” để xem.</p>
        </>}
      </aside>
      {locked && <div className="studio-root studio-gate"><div className="overlay-card"><h2>Trang bị trên nhân vật</h2>
        <form className="studio-unlock" onSubmit={(e) => { e.preventDefault(); void studioLogin(password).then(() => { setLocked(false); setStatus(''); }).catch(() => setStatus('Sai mật khẩu xưởng.')); }}>
          <p>Nhập mật khẩu xưởng để lưu chỉnh sửa.</p>
          <input type="password" autoFocus placeholder="Mật khẩu xưởng" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={!password}>Vào</button>
        </form></div></div>}
    </div>
  );
}
