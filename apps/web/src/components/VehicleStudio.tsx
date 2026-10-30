'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AmbientLight, DirectionalLight, GridHelper, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, SphereGeometry, SRGBColorSpace, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createDefaultRegistry } from '@zion/assets';
import {
  DEFAULT_APPEARANCE, EntityFlags, SEATED_EYE, STANDING_EYE, VEHICLES, VEHICLE_ROLES, armedSeat, seatEye, seatPosition, seatTuned, setSeatTuning,
  type SeatTune, type SeatTuning, type VehicleKind,
} from '@zion/shared';
import { studioLogin, studioSaveVehicleSeats, studioVehicleSeats, vehicleSeats } from '@/lib/api';
import { AssetLibrary } from '@/game/render/asset-library';
import { Avatar } from '@/game/render/avatars';
import { loadPlayerCharacter } from '@/game/render/character-model';
import { cutWheels } from '@/game/render/vehicle-wheels';
import { splitMounts } from '@/game/render/vehicle-mounts';
import { fitSeats, type SeatFit } from '@/game/render/seat-fit';
import { Icon } from './Icon';

/**
 * Vehicle Studio (/studio/vehicles): every vehicle, its seats and the rider in each as the game
 * shows them (seated, or standing at a gun). Per seat, move where the rider sits and where their
 * eye is for the first-person view, watching it from outside (orbit) or from the eye itself.
 * Saved for every server and client: riders sit there and the first-person view starts there.
 */
type View = 'outside' | 'first';
const KINDS = Object.keys(VEHICLES) as VehicleKind[];
const AXES = ['X (phải +)', 'Y (lên +)', 'Z (sau +)'] as const;

/** A seat where the game puts the rider: as tuned, else fitted to the model's cushion and floor. */
function shownSeat(kind: VehicleKind, seat: number, fit: readonly SeatFit[]): readonly [number, number, number] {
  const p = seatPosition(kind, seat), y = fit[seat]?.y;
  return seatTuned(kind, seat) || y == null ? p : [p[0], y, p[2]];
}

export function VehicleStudioPage() {
  const host = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<VehicleKind>('z10');
  const [seat, setSeat] = useState(0);
  const [view, setView] = useState<View>('outside');
  const [tuning, setTuning] = useState<SeatTuning>({});
  const [status, setStatus] = useState('');
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [ready, setReady] = useState(false);
  /** The seats as the game fits them to this model (cushion, floor), where not tuned. */
  const [fit, setFit] = useState<SeatFit[]>([]);
  const world = useRef<{ scene: Scene; avatar: Avatar; vehicle: Group; eye: Mesh; library: AssetLibrary; outside: PerspectiveCamera; first: PerspectiveCamera; controls: OrbitControls } | null>(null);
  const live = useRef({ kind, seat, view, fit });
  live.current = { kind, seat, view, fit };

  // Tuning as saved (the Studio's copy if signed in, else the public one).
  useEffect(() => {
    void studioVehicleSeats().catch(() => vehicleSeats()).then((t) => { setTuning(t); setSeatTuning(t); }).catch(() => setStatus('Không tải được cấu hình ghế.'));
  }, []);

  // The scene: the vehicle at the origin, the rider in the chosen seat, a dot at the eye.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, raf = 0;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 1.1));
    const sun = new DirectionalLight(0xffffff, 2.2); sun.position.set(4, 8, 5); scene.add(sun);
    scene.add(new GridHelper(40, 40, 0x555555, 0x333333));
    const outside = new PerspectiveCamera(40, 1, .05, 300); outside.position.set(8, 5, 9);
    const first = new PerspectiveCamera(72, 1, .03, 300);
    const controls = new OrbitControls(outside, renderer.domElement); controls.target.set(0, 1.4, 0);
    const vehicle = new Group(); scene.add(vehicle);
    const eye = new Mesh(new SphereGeometry(.06, 12, 8), new MeshBasicMaterial({ color: 0xff4d3a, depthTest: false })); eye.renderOrder = 5; scene.add(eye);
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); for (const c of [outside, first]) { c.aspect = w / h; c.updateProjectionMatrix(); } };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    const library = new AssetLibrary(createDefaultRegistry());
    void loadPlayerCharacter(undefined, undefined, 'survivor').then((character) => {
      if (disposed) return;
      const avatar = new Avatar(character, true);
      avatar.setAppearance(DEFAULT_APPEARANCE);
      avatar.addTo(scene);
      world.current = { scene, avatar, vehicle, eye, library, outside, first, controls };
      setReady(true);
      let last = performance.now();
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(.1, (now - last) / 1000); last = now;
        const { kind: k, seat: s, view: v, fit: f } = live.current, def = VEHICLES[k];
        const gunner = s > 0 && armedSeat(k, s), [x, y, z] = shownSeat(k, s, f), [ex, ey, ez] = seatEye(k, s, gunner);
        avatar.seatFloor = seatTuned(k, s) ? null : f[s]?.floor ?? null;
        avatar.update(x, y, z, 0, EntityFlags.Grounded, dt, now / 1000);
        avatar.root.position.set(x, y, z);
        avatar.drivingPose(gunner ? null : def.quad, 0, 0, 0, s > 0);
        // From the eye, the rider's own body is not drawn (as in the game).
        avatar.root.visible = v === 'outside';
        eye.position.set(x + ex, y + ey, z + ez);
        eye.visible = v === 'outside';
        first.position.copy(eye.position); first.rotation.set(0, 0, 0);
        controls.update();
        renderer.render(scene, v === 'first' ? first : outside);
      };
      raf = requestAnimationFrame(frame);
    });
    return () => { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, []);

  // The vehicle model (as the game draws it: scaled, wheels in place).
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    w.vehicle.clear();
    setFit([]);
    const def = VEHICLES[kind], body = new Group();
    body.scale.setScalar(def.scale);
    w.vehicle.add(body);
    void w.library.load(def.asset)?.then((visual) => {
      if (world.current !== w || live.current.kind !== kind) return;
      const parts = cutWheels(kind, visual.parts);
      setFit(fitSeats(kind, splitMounts(kind, parts).hull));
      for (const part of parts) {
        const m = new Mesh(part.geometry, part.material);
        if (part.wheelCenter) m.position.set(...part.wheelCenter);
        if (part.rotorCenter) m.position.set(...part.rotorCenter);
        body.add(m);
      }
    });
    w.controls.target.set(0, def.height * .5, 0);
    w.outside.position.set(def.halfX * 4 + 3, def.height * 1.6 + 1, def.halfZ * 1.6 + 3);
  }, [kind, ready]);

  const tune: SeatTune = tuning[kind]?.[seat] ?? {};
  const gunner = seat > 0 && armedSeat(kind, seat);
  const pos = shownSeat(kind, seat, fit), eye = seatEye(kind, seat, gunner);
  const change = (next: SeatTune | null) => {
    const forKind = { ...(tuning[kind] ?? {}) };
    if (next && (next.pos || next.eye)) forKind[seat] = next; else delete forKind[seat];
    const t: SeatTuning = { ...tuning, [kind]: forKind };
    if (!Object.keys(forKind).length) delete t[kind];
    setTuning(t); setSeatTuning(t); setStatus('Chưa lưu');
  };
  const setPos = (i: number, v: number) => { const p = [...pos] as [number, number, number]; p[i] = v; change({ ...tune, pos: p }); };
  const setEye = (i: number, v: number) => { const e = [...eye] as [number, number, number]; e[i] = v; change({ ...tune, eye: e }); };
  const save = async () => {
    setStatus('Đang lưu…');
    try { await studioSaveVehicleSeats(tuning); setStatus('✓ Đã lưu — áp dụng cho mọi máy chủ.'); }
    catch (err) {
      const code = (err as { status?: number }).status;
      if (code === 401 || code === 403) { setLocked(true); setStatus('Cần mật khẩu xưởng.'); } else setStatus(`✕ ${err instanceof Error ? err.message : 'Không lưu được.'}`);
    }
  };
  const unlock = async () => {
    try { await studioLogin(password); setLocked(false); setStatus('Đã mở khoá. Bấm Lưu lần nữa.'); } catch { setStatus('Sai mật khẩu.'); }
  };
  const num = (label: string, value: number, min: number, max: number, set: (v: number) => void) => (
    <label key={label} className="gs-num"><span>{label}</span><input type="range" min={min} max={max} step={.01} value={value} onChange={(e) => set(Number(e.target.value))} /><input type="number" min={min} max={max} step={.01} value={+value.toFixed(3)} onChange={(e) => set(Number(e.target.value) || 0)} /></label>
  );
  const def = VEHICLES[kind], role = VEHICLE_ROLES[kind];

  return (
    <div className="gs-page">
      <header className="gs-bar">
        <Link href="/studio" className="studio-back" title="Về Xưởng"><Icon name="lucide:arrow-left" /></Link>
        <h1>Phương tiện · vị trí ngồi</h1>
        <div className="gs-motion">
          <button className={`btn${view === 'outside' ? ' btn-primary' : ''}`} onClick={() => setView('outside')}><Icon name="lucide:rotate-3d" /> Nhìn từ ngoài</button>
          <button className={`btn${view === 'first' ? ' btn-primary' : ''}`} onClick={() => setView('first')}><Icon name="lucide:eye" /> Góc nhìn thứ nhất</button>
        </div>
        <span className="gs-status">{status}</span>
        {locked && <><input type="password" placeholder="Mật khẩu xưởng" value={password} onChange={(e) => setPassword(e.target.value)} /><button className="btn" onClick={() => void unlock()}>Mở khoá</button></>}
        <button className="btn btn-primary" onClick={() => void save()} disabled={!ready}><Icon name="lucide:save" /> Lưu</button>
      </header>
      <aside className="gs-panel">
        <h3>Phương tiện</h3>
        {KINDS.map((k) => (
          <button key={k} className={`btn vs-item${k === kind ? ' btn-primary' : ''}`} onClick={() => { setKind(k); setSeat(0); }}>
            {VEHICLES[k].name}{tuning[k] ? ' •' : ''}
          </button>
        ))}
      </aside>
      <div className="gs-view" ref={host} />
      <aside className="gs-panel">
        <h3>Ghế · {def.name}</h3>
        {def.seats.map((_, i) => (
          <button key={i} className={`btn vs-item${i === seat ? ' btn-primary' : ''}`} onClick={() => setSeat(i)}>
            {i + 1}. {role.seats[i] ?? `Ghế ${i + 1}`}{tuning[kind]?.[i] ? ' •' : ''}
          </button>
        ))}
        <h3>Vị trí ngồi</h3>
        <p className="gs-hint">{gunner ? 'Đứng tại súng (gốc nhân vật là bàn chân).' : 'Ngồi (gốc nhân vật dưới mặt đệm khoảng 0,5 m).'} Mét, theo khung xe: −Z là mũi xe.</p>
        {[0, 1, 2].map((i) => num(AXES[i]!, pos[i]!, i === 1 ? -2 : -def.halfZ - 2, i === 1 ? def.height + 1 : def.halfZ + 2, (v) => setPos(i, v)))}
        <h3>Mắt (góc nhìn thứ nhất)</h3>
        <p className="gs-hint">Tính từ gốc ghế. Mặc định {gunner ? STANDING_EYE[1] : SEATED_EYE[1]} m phía trên. Đổi sang “Góc nhìn thứ nhất” để xem đúng như người chơi thấy, rồi nâng hoặc đẩy mắt ra trước nếu bị ghế, khung kính che.</p>
        {[0, 1, 2].map((i) => num(AXES[i]!, eye[i]!, i === 1 ? 0 : -1.5, i === 1 ? 2.5 : 1.5, (v) => setEye(i, v)))}
        <button className="btn" onClick={() => change(null)} disabled={!tuning[kind]?.[seat]}><Icon name="lucide:rotate-ccw" /> Về mặc định ghế này</button>
      </aside>
    </div>
  );
}
