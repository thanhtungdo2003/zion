'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AmbientLight, DirectionalLight, GridHelper, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createDefaultRegistry } from '@zion/assets';
import {
  DEFAULT_APPEARANCE, EntityFlags, SEATED_EYE, STANDING_EYE, VEHICLES, VEHICLE_ROLES, armedSeat, minSeats, seatContacts, seatCount, seatEye, seatHip, seatPosition, seatTuned, setSeatTuning,
  type SeatTune, type SeatTuning, type SeatVec, type VehicleKind,
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
 * Vehicle Studio (/studio/vehicles): every vehicle, its seats, and the rider in each as the game
 * poses them. Each seat has its own contact points — where the hips rest, where each hand grips
 * and each foot rests — and the first-person eye; pick a point and move it: the rider's body
 * follows (hips on the seat, hands and feet by IK). Passenger seats can be added or the last ones
 * removed. Seen from outside (orbit) or from the eye. Saved for every server and client.
 */
type View = 'outside' | 'first';
type Point = 'hip' | 'handL' | 'handR' | 'footL' | 'footR' | 'eye';
const KINDS = Object.keys(VEHICLES) as VehicleKind[];
const AXES = ['X (phải +)', 'Y (lên +)', 'Z (sau +)'] as const;
const POINTS: Array<{ id: Point; name: string; color: number }> = [
  { id: 'hip', name: 'Mông (điểm ngồi)', color: 0xffd34d },
  { id: 'handL', name: 'Tay trái', color: 0x4dd2ff },
  { id: 'handR', name: 'Tay phải', color: 0x2f7bff },
  { id: 'footL', name: 'Chân trái', color: 0x7be08a },
  { id: 'footR', name: 'Chân phải', color: 0x2fae4a },
  { id: 'eye', name: 'Mắt (góc nhìn thứ nhất)', color: 0xff4d3a },
];

/** A seat where the game puts the rider: as set, else fitted to the model's cushion and floor. */
function shownSeat(kind: VehicleKind, seat: number, fit: readonly SeatFit[]): SeatVec {
  const p = seatPosition(kind, seat), y = fit[seat]?.y;
  return seatTuned(kind, seat) || y == null ? p : [p[0], y, p[2]];
}
const add = (a: SeatVec, b: SeatVec): SeatVec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** Where a hand or foot point starts when first switched on: about where a seated body has it. */
function startPoint(origin: SeatVec, p: Point): SeatVec {
  const side = p.endsWith('L') ? -1 : 1;
  return p.startsWith('hand') ? add(origin, [side * .2, .95, -.45]) : add(origin, [side * .14, .02, -.62]);
}

export function VehicleStudioPage() {
  const host = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<VehicleKind>('jeep');
  const [seat, setSeat] = useState(0);
  const [point, setPoint] = useState<Point>('hip');
  const [view, setView] = useState<View>('outside');
  const [tuning, setTuning] = useState<SeatTuning>({});
  const [status, setStatus] = useState('');
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [ready, setReady] = useState(false);
  /** The seats as the game fits them to this model (cushion, floor), where not set. */
  const [fit, setFit] = useState<SeatFit[]>([]);
  const world = useRef<{ avatar: Avatar; vehicle: Group; markers: Map<Point, Mesh>; library: AssetLibrary; outside: PerspectiveCamera; controls: OrbitControls } | null>(null);
  const live = useRef({ kind, seat, view, fit, point });
  live.current = { kind, seat, view, fit, point };

  // The table as saved (the Studio's copy if signed in, else the public one).
  useEffect(() => {
    void studioVehicleSeats().catch(() => vehicleSeats()).then((t) => { setTuning(t); setSeatTuning(t); }).catch(() => setStatus('Không tải được cấu hình ghế.'));
  }, []);

  // The scene: the vehicle at the origin, the rider in the chosen seat, a marker per point.
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
    const markers = new Map<Point, Mesh>();
    for (const p of POINTS) {
      const m = new Mesh(new SphereGeometry(.045, 12, 8), new MeshBasicMaterial({ color: p.color, depthTest: false }));
      m.renderOrder = 5; scene.add(m); markers.set(p.id, m);
    }
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); for (const c of [outside, first]) { c.aspect = w / h; c.updateProjectionMatrix(); } };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    const library = new AssetLibrary(createDefaultRegistry());
    void loadPlayerCharacter(undefined, undefined, 'survivor').then((character) => {
      if (disposed) return;
      const avatar = new Avatar(character, true);
      avatar.setAppearance(DEFAULT_APPEARANCE);
      avatar.addTo(scene);
      world.current = { avatar, vehicle, markers, library, outside, controls };
      setReady(true);
      let last = performance.now();
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(.1, (now - last) / 1000); last = now;
        const { kind: k, seat: s, view: v, fit: f, point: picked } = live.current, def = VEHICLES[k];
        const gunner = s > 0 && armedSeat(k, s), o = shownSeat(k, s, f), e = add(o, seatEye(k, s, gunner)), c = seatContacts(k, s);
        // The vehicle stands at the origin unturned: its own metres are world metres here.
        const v3 = (p: SeatVec) => new Vector3(p[0], p[1], p[2]);
        avatar.seatFloor = seatTuned(k, s) ? null : f[s]?.floor ?? null;
        avatar.seatContacts = { ...(c.hands ? { hands: [v3(c.hands[0]), v3(c.hands[1])] as [Vector3, Vector3] } : {}), ...(c.feet ? { feet: [v3(c.feet[0]), v3(c.feet[1])] as [Vector3, Vector3] } : {}) };
        avatar.update(o[0], o[1], o[2], 0, EntityFlags.Grounded, dt, now / 1000);
        avatar.root.position.set(o[0], o[1], o[2]);
        avatar.drivingPose(gunner ? null : def.quad, 0, 0, 0, s > 0);
        // From the eye, the rider's own body is not drawn (as in the game).
        avatar.root.visible = v === 'outside';
        const at: Record<Point, SeatVec | undefined> = { hip: add(o, [0, .47, .05]), eye: e, handL: c.hands?.[0], handR: c.hands?.[1], footL: c.feet?.[0], footR: c.feet?.[1] };
        for (const [id, m] of markers) {
          const p = at[id];
          m.visible = v === 'outside' && !!p;
          if (p) { m.position.set(p[0], p[1], p[2]); m.scale.setScalar(id === picked ? 1.6 : 1); }
        }
        first.position.set(e[0], e[1], e[2]); first.rotation.set(0, 0, 0);
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

  const def = VEHICLES[kind], role = VEHICLE_ROLES[kind], count = seatCount(kind);
  const gunner = seat > 0 && armedSeat(kind, seat);
  const forKind = tuning[kind] ?? {}, tune: SeatTune = forKind.seats?.[seat] ?? {};
  const origin = shownSeat(kind, seat, fit);
  /** Writes the table (and applies it to this preview at once). */
  const commit = (next: SeatTuning) => { setTuning(next); setSeatTuning(next); setStatus('Chưa lưu'); };
  const setSeatTune = (i: number, t: SeatTune | null) => {
    const seats = { ...(forKind.seats ?? {}) };
    if (t && Object.keys(t).length) seats[i] = t; else delete seats[i];
    commit({ ...tuning, [kind]: { ...forKind, seats } });
  };
  // The value shown and edited for a point (where the game has it now).
  const value = (p: Point): SeatVec | undefined => {
    if (p === 'hip') return seatTuned(kind, seat) ? seatHip(kind, seat) : add(origin, [0, .47, .05]);
    if (p === 'eye') return seatEye(kind, seat, gunner);
    const c = seatContacts(kind, seat), i = p.endsWith('L') ? 0 : 1;
    return p.startsWith('hand') ? c.hands?.[i] : c.feet?.[i];
  };
  const setPoint3 = (p: Point, v: SeatVec) => {
    const t: SeatTune = { ...tune };
    if (p === 'hip') { t.hip = v; delete t.pos; }
    else if (p === 'eye') t.eye = v;
    else {
      const key = p.startsWith('hand') ? 'hands' : 'feet', i = p.endsWith('L') ? 0 : 1;
      const now = (t[key] ?? [startPoint(origin, i ? p.replace('R', 'L') as Point : p), startPoint(origin, i ? p : p.replace('L', 'R') as Point)]) as [SeatVec, SeatVec];
      const both: [SeatVec, SeatVec] = [now[0], now[1]]; both[i] = v; t[key] = both;
    }
    setSeatTune(seat, t);
  };
  const togglePoint = (p: Point, on: boolean) => {
    if (p === 'hip' || p === 'eye') return;
    const key = p.startsWith('hand') ? 'hands' : 'feet', t: SeatTune = { ...tune };
    if (on) t[key] = [startPoint(origin, key === 'hands' ? 'handL' : 'footL'), startPoint(origin, key === 'hands' ? 'handR' : 'footR')]; else delete t[key];
    setSeatTune(seat, t);
  };
  const addSeat = () => {
    const last = seatPosition(kind, count - 1), seats = { ...(forKind.seats ?? {}) };
    seats[count] = { pos: [last[0], last[1], last[2] + .8] };
    commit({ ...tuning, [kind]: { count: count + 1, seats } });
    setSeat(count);
  };
  const removeSeat = () => {
    if (count <= minSeats(kind)) return;
    const seats = { ...(forKind.seats ?? {}) };
    delete seats[count - 1];
    const next = { ...forKind, seats, count: count - 1 };
    if (next.count === def.seats.length) delete (next as { count?: number }).count;
    commit({ ...tuning, [kind]: next });
    setSeat(Math.min(seat, count - 2));
  };
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
  const num = (label: string, v: number, min: number, max: number, set: (v: number) => void) => (
    <label key={label} className="gs-num"><span>{label}</span><input type="range" min={min} max={max} step={.01} value={v} onChange={(e) => set(Number(e.target.value))} /><input type="number" min={min} max={max} step={.01} value={+v.toFixed(3)} onChange={(e) => set(Number(e.target.value) || 0)} /></label>
  );
  const picked = value(point);
  const range = (i: number): [number, number] => point === 'eye' ? (i === 1 ? [0, 2.5] : [-1.5, 1.5]) : i === 1 ? [-1, def.height + 1] : i === 0 ? [-def.halfX - 1, def.halfX + 1] : [-def.halfZ - 1, def.halfZ + 1];

  return (
    <div className="gs-page">
      <header className="gs-bar">
        <Link href="/studio" className="studio-back" title="Về Xưởng"><Icon name="lucide:arrow-left" /></Link>
        <h1>Phương tiện · chỗ ngồi</h1>
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
        {Array.from({ length: count }, (_, i) => (
          <button key={i} className={`btn vs-item${i === seat ? ' btn-primary' : ''}`} onClick={() => setSeat(i)}>
            {i + 1}. {role.seats[i] ?? `Ghế ${i + 1}`}{forKind.seats?.[i] ? ' •' : ''}
          </button>
        ))}
        <div className="vs-row">
          <button className="btn" onClick={addSeat} disabled={count >= 24}><Icon name="lucide:plus" /> Thêm ghế</button>
          <button className="btn" onClick={removeSeat} disabled={count <= minSeats(kind)} title="Bỏ ghế cuối (không bỏ được ghế lái và ghế súng)"><Icon name="lucide:minus" /> Bỏ ghế cuối</button>
        </div>
        <h3>Điểm đặt của ghế {seat + 1}</h3>
        <p className="gs-hint">Mỗi ghế có điểm riêng. Chọn một điểm rồi kéo X/Y/Z (mét, theo khung xe: −Z là mũi xe). {gunner ? 'Ghế súng: nhân vật đứng.' : ''}</p>
        {POINTS.map((p) => {
          const optional = p.id !== 'hip' && p.id !== 'eye', on = !optional || !!value(p.id);
          return (
            <div key={p.id} className={`vs-point${point === p.id ? ' on' : ''}`}>
              <i style={{ background: `#${p.color.toString(16).padStart(6, '0')}` }} />
              <button className="btn" onClick={() => setPoint(p.id)}>{p.name}</button>
              {optional && <input type="checkbox" title="Dùng điểm này" checked={on} onChange={(e) => { togglePoint(p.id, e.target.checked); setPoint(p.id); }} />}
            </div>
          );
        })}
        {picked ? [0, 1, 2].map((i) => { const [mn, mx] = range(i); return num(AXES[i]!, picked[i]!, mn, mx, (v) => { const n = [...picked] as [number, number, number]; n[i] = v; setPoint3(point, n); }); })
          : <p className="gs-hint">Điểm này chưa dùng: tích ô bên cạnh để đặt.</p>}
        {point === 'eye' && <p className="gs-hint">Tính từ gốc ghế; mặc định {gunner ? STANDING_EYE[1] : SEATED_EYE[1]} m phía trên. Xem ở “Góc nhìn thứ nhất” rồi nâng hoặc đẩy mắt ra trước nếu bị ghế, khung kính che.</p>}
        <button className="btn" onClick={() => setSeatTune(seat, null)} disabled={!forKind.seats?.[seat] || seat >= def.seats.length}><Icon name="lucide:rotate-ccw" /> Về mặc định ghế này</button>
      </aside>
    </div>
  );
}
