'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AmbientLight, CanvasTexture, CircleGeometry, Color, DoubleSide, Euler, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PointLight,
  Quaternion, Raycaster, Scene, SRGBColorSpace, TextureLoader, Vector3, WebGLRenderer, type Object3D, type Texture,
} from 'three';
import { ITEMS, WEAPON_ATTACHMENTS, weaponOptic, WEAPON_BY_ITEM, WEAPON_SPECS, type Attachments, type AttachmentSlot, type GunSpec, type WeaponId } from '@zion/shared';
import { renderItemIcons } from '@/game/inventory/icons';
import { ItemArt } from './Inventory';
import { gltfLoader } from '@/game/render/gltf-loader';
import { loadPlayerCharacter } from '@/game/render/character-model';
import { loadWeapons, type WeaponLibrary } from '@/game/render/weapons';
import { ViewModel } from '@/game/render/viewmodel';
import { CombatEffects } from '@/game/render/effects';
import { SoundBank } from '@/game/audio';
import { reloadScriptOf } from '@/game/reload-scripts';
import { weaponRecoil } from '@/game/first-person-recoil';
import { ScopeLens } from '@/game/render/scope-lens';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

/**
 * Shooting range (Phòng tập): the range room on its own, played offline. Walk the firing line
 * behind the booths, shoot paper targets down the lanes with any gun, and see where each round
 * went and how many points it scored. E opens the menu: the gun, how the targets move and how
 * fast, how far away they stand. Each target carries a picture placeholder: an image put at
 * /range/target.png (public folder) is pasted over every target.
 */

const ROOM_URL = '/models/range/shooting_range.glb';
/** The picture on every target (put the file here), else a drawn placeholder. */
const TARGET_IMAGE = '/range/target.png';
const EYE = 1.62;
/** Where the shooter may walk: the firing line behind the booths. */
const AREA = { x0: -8.1, x1: 8.1, z0: -7.6, z1: -5.0 };
/** Target lanes: standing distances along the room (z), nearest to farthest. */
const NEAR_Z = -2.6, FAR_Z = 7.29;
const MAX_HOLES = 240;

type Motion = 'still' | 'sway' | 'approach' | 'popup';
const MOTIONS: Array<{ id: Motion; label: string }> = [
  { id: 'still', label: 'Đứng yên' }, { id: 'sway', label: 'Chạy ngang' }, { id: 'approach', label: 'Tiến / lùi' }, { id: 'popup', label: 'Bật lên / hạ xuống' },
];

/** A paper target; `hits` so far, and once broken (BREAK_AT hits) how far it has fallen. */
interface Target { node: Object3D; paper: Mesh; x: number; phase: number; size: { w: number; h: number; cx: number; cy: number }; hits: number; fall: { drop: number; vy: number; tilt: number; x?: number; z?: number } | null }
const BREAK_AT = 30;

function guns(lib: WeaponLibrary): string[] {
  return [...lib.keys()].filter((id) => {
    const w = WEAPON_BY_ITEM[id], spec = w ? WEAPON_SPECS[w as Exclude<WeaponId, 0>] : undefined;
    return spec?.kind === 'gun' && !(spec as GunSpec).fire;
  }).sort((a, b) => (ITEMS[a]?.name ?? a).localeCompare(ITEMS[b]?.name ?? b));
}

/** A drawn stand-in for the target picture: rings, a centre and where to put the real image. */
function placeholderTexture(): Texture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 256, 512);
  g.strokeStyle = '#222'; g.lineWidth = 3;
  for (let r = 110; r > 0; r -= 22) { g.beginPath(); g.arc(128, 220, r, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = '#c0282d'; g.beginPath(); g.arc(128, 220, 11, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#555'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center';
  g.fillText('ẢNH BIA', 128, 400); g.font = '14px sans-serif'; g.fillText('public/range/target.png', 128, 428);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}

export function ShootingRange() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Đang tải phòng tập…');
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const [weapon, setWeapon] = useState('ak47');
  const [motion, setMotion] = useState<Motion>('sway');
  const [speed, setSpeed] = useState(1);
  const [distance, setDistance] = useState(.7);
  const [hud, setHud] = useState({ mag: 0, max: 0, reloading: false, last: null as number | null, score: 0, shots: 0, hits: 0 });
  const [gunList, setGunList] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const live = useRef({ weapon, motion, speed, distance, menu });
  live.current = { weapon, motion, speed, distance, menu };
  const game = useRef<{ view: ViewModel; lib: WeaponLibrary; reset: () => void; equip: (id: string, attachments?: Attachments) => void } | null>(null);
  /** Attachments chosen per gun (right click on a gun in the menu). */
  const [fitted, setFitted] = useState<Record<string, Attachments>>({});
  const [fitting, setFitting] = useState<string | null>(null);
  const fittedNow = useRef(fitted); fittedNow.current = fitted;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, raf = 0;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = SRGBColorSpace; renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(new Color(0x101214));
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, .55), new HemisphereLight(0xf2f4ff, 0x3a3630, .9));
    // Ceiling lights over the firing line and down the lanes.
    for (const [x, z] of [[-5, -6], [0, -6], [5, -6], [-5, 1], [0, 1], [5, 1], [-5, 6], [0, 6], [5, 6]] as const) { const l = new PointLight(0xfff2e0, 9, 14, 1.6); l.position.set(x, 3.2, z); scene.add(l); }
    const camera = new PerspectiveCamera(75, 1, .015, 200);
    scene.add(camera);
    let yaw = Math.PI, pitch = 0; // facing +Z, down the lanes
    const pos = new Vector3(-.83, 0, -6.3);
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    const targets: Target[] = [];
    const hitMeshes: Object3D[] = [];
    const holes: Mesh[] = [];
    const holeGeo = new CircleGeometry(.0075, 10), holeMat = new MeshBasicMaterial({ color: 0x111111, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
    const keys = new Set<string>();
    let firing = false, aiming = false, nextShot = 0, mag = 0, reloadEnd = 0, reloadTimers: number[] = [];
    let score = 0, shots = 0, hits = 0, last: number | null = null;
    let scopeLens: ScopeLens | null = null;
    /** Recoil on top of the aim, recovering after each shot. */
    let kickPitch = 0, kickYaw = 0;
    let sounds: SoundBank | null = null, effects: CombatEffects | null = null, view: ViewModel | null = null, lib: WeaponLibrary | null = null;
    const spec = (): GunSpec | null => { const w = WEAPON_BY_ITEM[live.current.weapon]; const s = w ? WEAPON_SPECS[w as Exclude<WeaponId, 0>] : undefined; return s?.kind === 'gun' ? s as GunSpec : null; };
    const push = () => setHud({ mag, max: spec()?.magazine ?? 0, reloading: reloadEnd > performance.now(), last, score, shots, hits });

    const equip = (id: string, attachments?: Attachments) => {
      if (!view || !lib) return;
      view.set(id, lib, attachments); mag = spec()?.magazine ?? 0; reloadEnd = 0; for (const t of reloadTimers) clearTimeout(t); reloadTimers = []; push();
    };
    /** Everything back: the targets whole and up, no holes, the score from zero. */
    const reset = () => {
      score = 0; shots = 0; hits = 0; last = null; for (const h of holes) h.removeFromParent(); holes.length = 0;
      for (const t of targets) { t.hits = 0; t.fall = null; t.node.quaternion.copy(t.node.userData.baseRot as Quaternion); }
      push();
    };

    void (async () => {
      try {
        const [gltf, character] = await Promise.all([gltfLoader().loadAsync(ROOM_URL), loadPlayerCharacter()]);
        if (disposed) return;
        const room = gltf.scene;
        scene.add(room);
        room.updateMatrixWorld(true);
        // The paper targets: every "SR Target Holder" (its holder frame and paper), taken out to move on their own.
        const image = await new TextureLoader().loadAsync(TARGET_IMAGE).then((t) => { t.colorSpace = SRGBColorSpace; return t; }).catch(() => placeholderTexture());
        const holders: Object3D[] = [];
        room.traverse((o) => { if (/^SR_Target_Holder(_dup_\d+)?$/.test(o.name)) holders.push(o); });
        holders.forEach((node, i) => {
          let paper: Mesh | null = null;
          node.traverse((o) => { if (!paper && (o as Mesh).isMesh && /Target_Paper/.test(o.name)) paper = o as Mesh; });
          if (!paper) return;
          const p = paper as Mesh;
          p.material = new MeshStandardMaterial({ map: image, roughness: .9, side: DoubleSide });
          p.geometry.computeBoundingBox();
          const bb = p.geometry.boundingBox!;
          const world = node.getWorldPosition(new Vector3());
          // Lanes in a row (the one left parked at the booth goes back down its lane).
          targets.push({ hits: 0, fall: null, node, paper: p, x: world.x, phase: i * 1.7, size: { w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y, cx: (bb.min.x + bb.max.x) / 2, cy: (bb.min.y + bb.max.y) / 2 } });
          node.userData.base = node.position.clone();
          node.userData.baseRot = node.quaternion.clone();
          node.userData.baseWorld = world;
        });
        room.traverse((o) => { if ((o as Mesh).isMesh) hitMeshes.push(o); });
        lib = await loadWeapons(character).catch(() => new Map() as WeaponLibrary);
        if (disposed) return;
        // Pictures of the guns for the menu.
        try { renderItemIcons(lib); } catch { /* icons are optional */ }
        view = new ViewModel(camera);
        if (character.human) view.setBody(character.human);
        sounds = new SoundBank(() => camera.position, () => yaw);
        void sounds.load();
        effects = new CombatEffects(scene, null, sounds, () => camera.position);
        const list = guns(lib);
        setGunList(list);
        if (!list.includes(live.current.weapon) && list[0]) setWeapon(list[0]);
        equip(list.includes(live.current.weapon) ? live.current.weapon : list[0] ?? 'ak47');
        game.current = { view, lib, reset, equip };
        setReady(true); setStatus('');
      } catch (e) { setStatus(`Không tải được phòng tập: ${(e as Error).message}`); }
    })();

    // Input.
    const lockedNow = () => document.pointerLockElement === renderer.domElement;
    const onLock = () => setLocked(lockedNow());
    document.addEventListener('pointerlockchange', onLock);
    const onMouseMove = (e: MouseEvent) => {
      if (!lockedNow()) return;
      // Browsers sometimes report one huge jump (the cursor re-centred, a focus change): skipped,
      // so the view never snaps to another direction.
      if (Math.abs(e.movementX) > 220 || Math.abs(e.movementY) > 220) return;
      // Slower through a magnified optic, by its power.
      const power = aiming ? weaponOptic(live.current.weapon, fittedNow.current[live.current.weapon])?.magnification ?? 1 : 1;
      const k = .0022 * (aiming ? .55 : 1) / Math.max(1, power * .7);
      yaw -= e.movementX * k; pitch = Math.max(-1.45, Math.min(1.45, pitch - e.movementY * k));
    };
    const onDown = (e: MouseEvent) => {
      if (live.current.menu) return;
      if (!lockedNow()) {
        sounds?.unlock();
        // Raw mouse movement where the browser has it (no acceleration, no jumps).
        const lock = renderer.domElement.requestPointerLock as (o?: { unadjustedMovement?: boolean }) => Promise<void> | void;
        void Promise.resolve(lock.call(renderer.domElement, { unadjustedMovement: true })).catch(() => renderer.domElement.requestPointerLock());
        return;
      }
      if (e.button === 0) firing = true;
      if (e.button === 2) aiming = true;
    };
    const onUp = (e: MouseEvent) => { if (e.button === 0) firing = false; if (e.button === 2) aiming = false; };
    const reload = () => {
      const s = spec(), now = performance.now();
      if (!s || !view || reloadEnd > now || mag >= s.magazine) return;
      const ms = s.shellReload ? s.shellReload.firstMs + s.shellReload.shellMs * (s.magazine - mag) : s.reloadMs;
      reloadEnd = now + ms;
      view.reload(ms / 1000);
      for (const step of reloadScriptOf(live.current.weapon)?.sounds ?? []) reloadTimers.push(window.setTimeout(() => sounds?.play(step.sound, { rate: step.rate, volume: step.volume ?? .9 }), step.at * ms));
      reloadTimers.push(window.setTimeout(() => { mag = s.magazine; push(); }, ms));
      push();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.type === 'keydown') {
        if (e.code === 'KeyE') { e.preventDefault(); setMenu((m) => { const open = !m; if (open) void document.exitPointerLock(); return open; }); return; }
        if (e.code === 'KeyR') reload();
        keys.add(e.code);
      } else keys.delete(e.code);
    };
    const noMenu = (e: Event) => e.preventDefault();
    renderer.domElement.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
    renderer.domElement.addEventListener('contextmenu', noMenu);

    const ray = new Raycaster();
    const shoot = (now: number) => {
      const s = spec();
      if (!s || !view || !effects) return;
      if (mag <= 0) { firing = false; reload(); return; }
      mag--; shots++;
      const weaponId = WEAPON_BY_ITEM[live.current.weapon]!;
      view.kick(Math.min(1.8, weaponRecoil(weaponId) * 28 * (aiming ? .65 : 1)));
      const ends: number[] = [];
      let best: number | null = null;
      for (let p = 0; p < Math.max(1, s.pellets); p++) {
        const spread = s.spread * (aiming ? .25 : 1) * (s.pellets > 1 ? 1 : .6);
        // Along the view as it is now (the sight picture), before this shot's kick.
        const dir = new Vector3(0, 0, -1).applyEuler(new Euler(pitch + kickPitch + (Math.random() - .5) * spread * 2, yaw + kickYaw + (Math.random() - .5) * spread * 2, 0, 'YXZ'));
        ray.set(camera.position, dir); ray.far = s.range;
        const hit = ray.intersectObjects(hitMeshes, false)[0];
        if (!hit) continue;
        ends.push(hit.point.x, hit.point.y, hit.point.z);
        const target = targets.find((t) => t.paper === hit.object && !t.fall);
        if (target) {
          // Shot through enough times, it breaks off its holder and falls.
          if (++target.hits >= BREAK_AT) target.fall = { drop: 0, vy: 0, tilt: 0 };
          // A hole where it went in, and points by how near the centre.
          const local = target.paper.worldToLocal(hit.point.clone());
          const hole = new Mesh(holeGeo, holeMat);
          target.paper.add(hole); holes.push(hole);
          // Facing out of the paper, the same size whatever the model's own scale.
          hole.position.copy(local);
          hole.scale.setScalar(1 / target.paper.getWorldScale(new Vector3()).x);
          if (hit.face) hole.lookAt(hit.point.clone().add(hit.face.normal.clone().transformDirection(target.paper.matrixWorld)));
          if (holes.length > MAX_HOLES) holes.shift()!.removeFromParent();
          const d = Math.hypot((local.x - target.size.cx) / (target.size.w / 2), (local.y - (target.size.cy + target.size.h * .12)) / (target.size.w / 2));
          const pts = Math.max(0, 10 - Math.floor(d * 10));
          best = Math.max(best ?? 0, pts);
        }
      }
      if (best !== null) { hits++; score += best; last = best; } else last = null;
      // The kick: the view jumps up (a little sideways) and settles back to where it was aimed.
      kickPitch += weaponRecoil(weaponId) * (aiming ? .5 : .8);
      kickYaw += (Math.random() - .5) * weaponRecoil(weaponId) * .4;
      const muzzle = new Vector3(), eject = new Vector3();
      if (!view.weaponPoint('muzzle', muzzle)) muzzle.copy(camera.position);
      const dir = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const right = new Vector3(-dir.z, 0, dir.x).normalize();
      const device = fittedNow.current[live.current.weapon]?.muzzle;
      effects.shot(0, { weapon: weaponId, muzzle, dir, eject: view.weaponPoint('eject', eject) ? eject : null, right, ends, muzzleDevice: device, suppressed: !!device?.startsWith('suppressor') });
      nextShot = now + s.fireMs;
      if (!s.auto) firing = false;
      push();
    };

    let lastT = performance.now(), clock = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(.05, (now - lastT) / 1000); lastT = now; clock += dt;
      // Walking the firing line.
      const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => keys.has(k)) && lockedNow();
      if (moving) {
        const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
        const sp = (keys.has('ShiftLeft') ? 4.5 : 2.6) * dt;
        pos.x += (-Math.sin(yaw) * f + Math.cos(yaw) * r) * sp; pos.z += (-Math.cos(yaw) * f - Math.sin(yaw) * r) * sp;
        pos.x = Math.min(AREA.x1, Math.max(AREA.x0, pos.x)); pos.z = Math.min(AREA.z1, Math.max(AREA.z0, pos.z));
      }
      camera.position.set(pos.x, EYE, pos.z);
      kickPitch *= Math.exp(-dt * 9); kickYaw *= Math.exp(-dt * 9);
      camera.rotation.set(pitch + kickPitch, yaw + kickYaw, 0, 'YXZ');
      // Targets: stand, run across their lane, come and go, or pop up — at the chosen pace and distance.
      const L = live.current, standZ = NEAR_Z + (FAR_Z - NEAR_Z) * L.distance;
      for (const t of targets) {
        const base = t.node.userData.baseWorld as Vector3, ph = clock * L.speed + t.phase;
        const parent = t.node.parent!;
        const w = new Vector3(t.x, base.y, standZ);
        let up = 0;
        if (L.motion === 'sway') w.x = t.x + Math.sin(ph * 1.3) * .62;
        if (L.motion === 'approach') w.z = NEAR_Z + (standZ - NEAR_Z) * (.5 + .5 * Math.sin(ph * .7));
        if (L.motion === 'popup') up = Math.sin(ph * 1.1) > .2 ? 0 : -1.2;
        w.y += up;
        // A broken target drops to the floor, tipping over as it goes.
        if (t.fall) {
          // It lies where it broke off: no more sliding across or to and fro, no popping up.
          t.fall.x ??= w.x; t.fall.z ??= w.z;
          w.x = t.fall.x; w.z = t.fall.z; w.y = base.y;
          const floor = -(base.y - .05);
          t.fall.vy -= 9.8 * dt; t.fall.drop = Math.max(floor, t.fall.drop + t.fall.vy * dt);
          if (t.fall.drop === floor) t.fall.vy = 0;
          t.fall.tilt = Math.min(Math.PI / 2, t.fall.tilt + dt * 3.2);
          w.y += t.fall.drop;
          t.node.quaternion.copy(t.node.userData.baseRot as Quaternion).premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), t.fall.tilt));
        }
        t.node.position.copy(parent.worldToLocal(w));
      }
      if (firing && now >= nextShot && reloadEnd <= now && !L.menu) shoot(now);
      view?.update(dt, { visible: true, moving, sprint: false, reloading: reloadEnd > now, yaw, pitch, aiming: aiming && reloadEnd <= now, firing });
      view?.setLoaded(mag > 0);
      effects?.update(dt, null);
      // Through an optic: the magnified picture (or the dot / holo reticle) drawn on its lens, as in game.
      const optic = weaponOptic(L.weapon, fittedNow.current[L.weapon]), lens = view?.lens;
      const sight = !!lens && !!optic && aiming && reloadEnd <= now && (view?.aimed ?? 0) > .82 && ((optic.magnification ?? 1) > 1 || optic.reticle === 'dot' || optic.reticle === 'holo');
      if (sight && lens && optic && view) {
        (scopeLens ??= new ScopeLens()).render(renderer, scene, camera, lens.mesh, view.scopeHidden, { magnification: optic.magnification ?? 1, reticle: optic.reticle ?? null, nightVision: false }, true);
      } else scopeLens?.release();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect();
      for (const t of reloadTimers) clearTimeout(t);
      document.removeEventListener('pointerlockchange', onLock);
      window.removeEventListener('mouseup', onUp); window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
      effects?.dispose(); view?.dispose(); sounds?.dispose(); scopeLens?.dispose();
      renderer.dispose(); el.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => { if (ready) game.current?.equip(weapon, fitted[weapon]); }, [weapon, ready, fitted]);
  const accuracy = hud.shots ? Math.round(hud.hits / hud.shots * 100) : 0;
  const byClass = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const id of gunList) { const c = ITEMS[id]?.category ?? 'other'; groups.set(c, [...(groups.get(c) ?? []), id]); }
    return [...groups.entries()];
  }, [gunList]);
  const CATEGORY: Record<string, string> = { rifle: 'Súng trường', smg: 'Tiểu liên', pistol: 'Súng ngắn', shotgun: 'Súng săn', sniper: 'Bắn tỉa', lmg: 'Súng máy' };

  return (
    <div className="range-page">
      <div className="range-view" ref={host} />
      {ready && <div className="range-cross" aria-hidden />}
      <div className="range-top">
        <Link href="/" className="btn"><Icon name="lucide:arrow-left" /> Về menu</Link>
        <b>Phòng tập</b>
        <span>{ITEMS[weapon]?.name ?? weapon}</span>
        <button className="btn range-reset" onClick={() => game.current?.reset()} title="Dựng lại mọi bia, gỡ lỗ đạn, tính điểm lại"><Icon name="lucide:rotate-ccw" /> Reset</button>
        <span><span title="Điểm"><Icon name="lucide:target" /> <b>{hud.score}</b></span> · <span title="Trúng / bắn"><Icon name="lucide:crosshair" /> {hud.hits}/{hud.shots} ({accuracy}%)</span>{hud.last !== null && <span title="Phát vừa rồi"> · +{hud.last}</span>}</span>
      </div>
      <div className="range-ammo"><b>{hud.mag}</b> / {hud.max}{hud.reloading ? ' · đang thay đạn' : hud.mag === 0 ? ' · R thay đạn' : ''}</div>
      {status && <div className="range-status">{status.startsWith('Đang') ? <Spinner /> : null} {status}</div>}
      {ready && !locked && !menu && <div className="range-hint"><Icon name="lucide:mouse-pointer-click" /> Bấm để bắt đầu · <b>E</b> súng / bia</div>}
      {menu && (
        <div className="range-menu" role="dialog" aria-label="Phòng tập">
          <header title="Bấm để cầm · chuột phải để chọn phụ kiện"><b>Phòng tập</b><button className="btn" onClick={() => setMenu(false)}>Đóng (E)</button></header>
          <div className="range-menu-body">
            <section className="range-guns">
              {byClass.map(([cat, ids]) => (
                <div key={cat}>
                  <h3>{CATEGORY[cat] ?? cat}</h3>
                  <div className="range-grid">
                    {ids.map((id) => (
                      <button key={id} className={`range-gun${id === weapon ? ' on' : ''}`} onClick={() => setWeapon(id)}
                        onContextMenu={(e) => { e.preventDefault(); setWeapon(id); setFitting(id); }}>
                        <span className="range-gun-art">{ITEMS[id] && <ItemArt def={ITEMS[id]!} attachments={fitted[id]} />}</span>
                        <b>{ITEMS[id]?.name ?? id}</b>
                        {fitted[id] && Object.values(fitted[id]!).some(Boolean) && <small>{Object.values(fitted[id]!).filter(Boolean).map((a) => ITEMS[a!]?.name ?? a).join(' · ')}</small>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
            <aside className="range-config">
              {fitting && WEAPON_ATTACHMENTS[fitting] ? <>
                <h3>Phụ kiện · {ITEMS[fitting]?.name ?? fitting}</h3>
                {(Object.entries(WEAPON_ATTACHMENTS[fitting]!) as Array<[AttachmentSlot, readonly string[]]>).map(([slot, options]) => (
                  <div key={slot} className="range-slot">
                    <small>{slot === 'optic' ? 'Ống ngắm' : 'Đầu nòng'}</small>
                    <div className="range-motions">
                      <button className={`btn${!fitted[fitting]?.[slot] ? ' btn-primary' : ''}`} onClick={() => setFitted((f) => ({ ...f, [fitting]: { ...f[fitting], [slot]: undefined } }))}>Không</button>
                      {options.map((a) => <button key={a} className={`btn${fitted[fitting]?.[slot] === a ? ' btn-primary' : ''}`} onClick={() => setFitted((f) => ({ ...f, [fitting]: { ...f[fitting], [slot]: a } }))}>{ITEMS[a]?.name ?? a}</button>)}
                    </div>
                  </div>
                ))}
                <button className="btn" onClick={() => setFitting(null)}>Xong</button>
              </> : fitting ? <><p className="range-note">{ITEMS[fitting]?.name ?? fitting} không gắn được phụ kiện.</p><button className="btn" onClick={() => setFitting(null)}>Xong</button></> : <>
                <h3>Bia tập</h3>
                <div className="range-motions">{MOTIONS.map((m) => <button key={m.id} className={`btn${motion === m.id ? ' btn-primary' : ''}`} onClick={() => setMotion(m.id)}>{m.label}</button>)}</div>
                <label className="set-slider"><span>Tốc độ bia <b>{speed.toFixed(1)}×</b></span><input type="range" min={.1} max={4} step={.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /></label>
                <label className="set-slider"><span>Khoảng cách <b>{Math.round(NEAR_Z + (FAR_Z - NEAR_Z) * distance + 6.3)} m</b></span><input type="range" min={0} max={1} step={.01} value={distance} onChange={(e) => setDistance(Number(e.target.value))} /></label>
                <button className="btn" title="Dựng lại mọi bia, gỡ lỗ đạn, tính điểm lại" onClick={() => game.current?.reset()}><Icon name="lucide:rotate-ccw" /> Reset</button>
                <p className="range-note" title="Số phát trúng làm vỡ bia"><Icon name="lucide:target" /> {BREAK_AT} × <Icon name="lucide:zap" /></p>
              </>}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
