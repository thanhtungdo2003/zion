'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, DoubleSide, Euler, Float32BufferAttribute, GridHelper, Group, LineBasicMaterial, LineSegments, Mesh,
  MeshBasicMaterial, Object3D, PerspectiveCamera, Plane, PlaneGeometry, Quaternion, Raycaster, Scene, SphereGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Bone,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { HAND_EASES, HAND_FINGERS, ITEMS, WEAPON_BY_ITEM, handKeysAt, handStudioSchema, type HandAnimation, type HandKey, type HandPose, type HandStudio, type HandTrack } from '@zion/shared';
import { hasStudioSession, studioLogin, studioSaveHandStudio } from '@/lib/api';
import { handStudio, loadHandStudio, setHandStudio } from '@/game/hand-studio';
import { loadPlayerCharacter } from '@/game/render/character-model';
import { loadWeapons, type WeaponLibrary } from '@/game/render/weapons';
import { ViewModel } from '@/game/render/viewmodel';
import { SOUND_FILES } from '@/game/audio';
import { cachedFetch } from '@/lib/preload';
import { Icon } from './Icon';

/**
 * Hand Studio (/studio/hands), two tabs on one 3D stage — the first-person arms holding a chosen
 * weapon, the player's view drawn as a frustum with its screen, and a free editor camera:
 *  - Tư thế tay: hand poses. Pick a finger joint (shown through the hand) and turn it with the
 *    gizmo, or drag a joint's tip: the bone turns towards it, its length kept, within the joint's
 *    range. Poses are saved by id and used by the game and by animations.
 *  - Animation: tracks of keys for the gun, each hand (placed on the gun or on one of its parts,
 *    with a pose) and the gun's parts (their own clips or moved / turned), played with smooth
 *    blending — a fist opening into a spread hand opens gradually. An animation made for a weapon's
 *    reload plays in game in place of its scripted one (its sounds, or the gun's own).
 */

type Tab = 'pose' | 'anim';
type Side = 'L' | 'R';
const DEG = Math.PI / 180;
const FINGER_NAMES: Record<string, string> = { f_index: 'Ngón trỏ', f_middle: 'Ngón giữa', f_ring: 'Ngón áp út', f_pinky: 'Ngón út', thumb: 'Ngón cái' };
const JOINT_NAMES = ['gốc', 'đốt giữa', 'đầu'];
const TRACK_NAMES: Record<HandTrack['kind'], string> = { gun: 'Súng', handL: 'Tay trái', handR: 'Tay phải', part: 'Bộ phận' };
const EASE_NAMES: Record<string, string> = { linear: 'Đều', in: 'Nhanh dần', out: 'Chậm dần', inOut: 'Mượt (vào/ra)', step: 'Nhảy bậc' };

/** Each joint's range (radians, XYZ): curl toward the palm on X, a little sideways (Y) and twist (Z). */
function jointLimits(bone: string): [[number, number], [number, number], [number, number]] {
  // The wrist: bent back / toward the palm, sideways (thumb / little finger side), twisted.
  if (bone === 'hand') return [[-1.2, 1.2], [-.6, .6], [-1.2, 1.2]];
  if (bone.startsWith('thumb')) return bone.endsWith('01') ? [[-.6, 1.3], [-1, 1], [-1, 1]] : [[-.4, 1.4], [-.35, .35], [-.35, .35]];
  return bone.endsWith('01') ? [[-.4, 1.75], [-.4, .4], [-.25, .25]] : [[-.15, 1.9], [-.1, .1], [-.1, .1]];
}
function clampTurn(bone: string, e: [number, number, number]): [number, number, number] {
  const L = jointLimits(bone);
  return e.map((v, i) => Math.round(Math.min(L[i]![1], Math.max(L[i]![0], v)) * 10000) / 10000) as [number, number, number];
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'item';
function uniqueId(base: string, taken: Set<string>): string {
  let id = slug(base), n = 2;
  while (taken.has(id)) id = `${slug(base).slice(0, 28)}-${n++}`;
  return id;
}

export function HandStudioPage() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(!hasStudioSession());
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>('pose');
  const [data, setData] = useState<HandStudio>(handStudio());
  const [weapon, setWeapon] = useState('ak47');
  const [fpView, setFpView] = useState(true);
  // Poses.
  const [poseId, setPoseId] = useState('fist');
  const [side, setSide] = useState<Side>('R');
  const [bone, setBone] = useState<string | null>(null);
  const [mode, setMode] = useState<'rotate' | 'drag'>('rotate');
  // Animations.
  const [animId, setAnimId] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [sel, setSel] = useState<{ track: string; key: number } | null>(null);
  /** The sound picked on the timeline's sound row (its index). */
  const [soundSel, setSoundSel] = useState<number | null>(null);
  const soundDrag = useRef<number | null>(null);
  const [parts, setParts] = useState<{ parts: string[]; clips: string[] }>({ parts: [], clips: [] });
  const [weapons, setWeapons] = useState<string[]>([]);

  const stage = useRef<{
    view: ViewModel; lib: WeaponLibrary; fpCam: PerspectiveCamera; editCam: PerspectiveCamera; controls: OrbitControls; gizmo: TransformControls;
    proxy: Object3D; joints: Mesh[]; lines: LineSegments; scene: Scene; renderer: WebGLRenderer; frustum: Group;
  } | null>(null);
  // Live values for the render loop.
  const live = useRef({ tab, poseId, side, bone, mode, animId, time, playing, loop, fpView, data, sel });
  live.current = { tab, poseId, side, bone, mode, animId, time, playing, loop, fpView, data, sel };
  const dragging = useRef(false);

  /** Every change: shown at once in the stage (and in any game hands on the page), saved later. */
  const commit = (next: HandStudio) => { setData(next); setHandStudio(next); setDirty(true); };

  const pose = data.poses.find((p) => p.id === poseId) ?? data.poses[0];
  const anim = data.animations.find((a) => a.id === animId) ?? null;

  // The stage.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, raf = 0;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(new Color(0x26313a));
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 1.4));
    const sun = new DirectionalLight(0xffffff, 2.2); sun.position.set(1, 3, 2); scene.add(sun);
    const grid = new GridHelper(6, 60, 0x4f5a4a, 0x3a443c); grid.position.y = -1.6; scene.add(grid);
    // The player's eye: the first-person camera (the game's field of view), and its frustum.
    const fpCam = new PerspectiveCamera(75, 16 / 9, .015, 400); scene.add(fpCam);
    const frustum = frustumHelper(fpCam); scene.add(frustum);
    const editCam = new PerspectiveCamera(45, 1, .01, 50); editCam.position.set(.9, .35, .6);
    const controls = new OrbitControls(editCam, renderer.domElement); controls.target.set(.05, -.2, -.35); controls.update();
    const gizmo = new TransformControls(editCam, renderer.domElement); gizmo.setSize(.7); gizmo.setSpace('local');
    scene.add(gizmo.getHelper());
    const proxy = new Object3D(); scene.add(proxy);
    gizmo.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; dragging.current = !!e.value; });
    // The skeleton drawn through the hand: a ball at each joint, lines between them.
    const jointGeo = new SphereGeometry(.0042, 10, 8);
    const joints: Mesh[] = [];
    for (let i = 0; i < 16; i++) {
      const m = new Mesh(jointGeo, new MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true }));
      m.renderOrder = 10; m.visible = false; scene.add(m); joints.push(m);
    }
    const lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x8fe3ff, depthTest: false, transparent: true }));
    lines.renderOrder = 9; lines.frustumCulled = false; scene.add(lines);
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false); editCam.aspect = w / h; editCam.updateProjectionMatrix();
      fpCam.aspect = w / h; fpCam.updateProjectionMatrix(); frustum.userData.rebuild?.();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    void Promise.all([loadPlayerCharacter(undefined, undefined, 'survivor'), loadHandStudio()]).then(async ([character]) => {
      const lib = await loadWeapons(character).catch(() => new Map() as WeaponLibrary);
      if (disposed) return;
      setData(handStudio());
      const view = new ViewModel(fpCam);
      if (character.human) view.setBody(character.human);
      stage.current = { view, lib, fpCam, editCam, controls, gizmo, proxy, joints, lines, scene, renderer, frustum };
      setWeapons([...lib.keys()].filter((id) => WEAPON_BY_ITEM[id] && ITEMS[id] && ITEMS[id]!.category !== 'melee' && ITEMS[id]!.category !== 'ammo' && !ITEMS[id]!.id.startsWith('ammo')));
      setReady(true);
      let last = performance.now();
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(.05, (now - last) / 1000); last = now;
        const L = live.current, st = stage.current!;
        const hands = st.view.firstPersonHands;
        // Playback.
        const a = L.data.animations.find((x) => x.id === L.animId) ?? null;
        if (L.tab === 'anim' && a && L.playing) {
          const from = L.time;
          let t = from + dt * a.speed / a.duration;
          if (t > 1) { if (L.loop) t %= 1; else { t = 1; setPlaying(false); } }
          live.current.time = t; setTime(t);
          // Every sound the play head passed this frame.
          playSounds(a, from, t);
        }
        st.view.previewAnimation(L.tab === 'anim' ? a : null, live.current.time);
        if (hands) { hands.poseOverride.L = null; hands.poseOverride.R = null; if (L.tab === 'pose') hands.poseOverride[L.side] = L.poseId; }
        st.view.update(dt, { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0, aiming: false });
        frustum.visible = !L.fpView;
        const cam = L.fpView ? fpCam : editCam;
        controls.enabled = !L.fpView && !dragging.current;
        // Posed just before drawing (the arms pose themselves then): the skeleton follows after.
        if (hands) hands.afterEachPose = () => drawSkeleton(st, hands.rig.handBones(L.side), L.tab === 'pose', L.bone);
        if (L.fpView) { gizmo.getHelper().visible = false; } else gizmo.getHelper().visible = true;
        renderer.render(scene, cam);
      };
      raf = requestAnimationFrame(frame);
    });
    return () => { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); gizmo.dispose(); stage.current?.view.dispose(); stage.current = null; renderer.dispose(); el.removeChild(renderer.domElement); };
  }, []);

  // The weapon held.
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    st.view.set(weapon || null, st.lib);
    // Its parts and clips once dressed.
    const id = setTimeout(() => setParts(st.view.studioParts), 50);
    return () => clearTimeout(id);
  }, [weapon, ready]);

  // The gizmo: on the picked finger joint (poses) or the picked hand key (animations).
  useEffect(() => {
    const st = stage.current;
    if (!st) return undefined;
    const { gizmo, proxy } = st;
    gizmo.detach();
    const hands = st.view.firstPersonHands;
    if (tab === 'pose' && bone && hands && mode === 'rotate') {
      const b = boneByName(hands.rig.handBones(side), bone);
      if (!b) return undefined;
      gizmo.setMode('rotate'); gizmo.setSpace('local');
      const sync = () => { if (!dragging.current) { b.updateWorldMatrix(true, false); b.matrixWorld.decompose(proxy.position, proxy.quaternion, new Vector3()); } };
      sync(); gizmo.attach(proxy);
      const onChange = () => {
        if (!dragging.current) return;
        // The proxy's turn as the bone's local turn, then as a turn from the bind pose.
        const parent = b.parent!; parent.updateWorldMatrix(true, false);
        const pq = new Quaternion(); parent.matrixWorld.decompose(new Vector3(), pq, new Vector3());
        b.quaternion.copy(pq.invert().multiply(proxy.quaternion));
        setTurn(bone, hands.rig.boneTurn(b));
      };
      gizmo.addEventListener('objectChange', onChange);
      const id = setInterval(sync, 100);
      return () => { gizmo.removeEventListener('objectChange', onChange); clearInterval(id); gizmo.detach(); };
    }
    if (tab === 'anim' && anim && sel) {
      const tr = anim.tracks.find((x) => x.id === sel.track), key = tr?.keys[sel.key];
      if (!tr || !key || (tr.kind !== 'handL' && tr.kind !== 'handR')) return undefined;
      const gun = st.view.gunModel;
      if (!gun) return undefined;
      const handSide: Side = tr.kind === 'handL' ? 'L' : 'R';
      const hb = hands?.rig.handBones(handSide).hand;
      const sync = () => { if (!dragging.current && hb) { hb.updateWorldMatrix(true, false); hb.matrixWorld.decompose(proxy.position, proxy.quaternion, new Vector3()); } };
      sync(); gizmo.setMode(mode === 'rotate' ? 'rotate' : 'translate'); gizmo.setSpace('local'); gizmo.attach(proxy);
      const onChange = () => {
        if (!dragging.current) return;
        gun.updateWorldMatrix(true, false);
        const gq = new Quaternion(); gun.matrixWorld.decompose(new Vector3(), gq, new Vector3());
        let local = gun.worldToLocal(proxy.position.clone());
        if (key.part) { const n = st.view.firstPersonHands && partNode(st.view, key.part); if (n) local = local.sub(gun.worldToLocal(n.getWorldPosition(new Vector3()))); }
        const e = new Euler().setFromQuaternion(gq.invert().multiply(proxy.quaternion), 'XYZ');
        const r = (v: number) => Math.round(v * 10000) / 10000;
        updateKey(tr.id, sel.key, { pos: [r(local.x), r(local.y), r(local.z)], ...(gizmo.mode === 'rotate' ? { rot: [e.x, e.y, e.z].map((v) => Math.round(v / DEG * 10) / 10) as [number, number, number] } : {}) });
      };
      gizmo.addEventListener('objectChange', onChange);
      const id = setInterval(sync, 100);
      return () => { gizmo.removeEventListener('objectChange', onChange); clearInterval(id); gizmo.detach(); };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-attached when the pick changes.
  }, [tab, bone, side, mode, ready, sel, animId, poseId]);

  // ---------------------------------------------------------------- poses

  const setTurn = (name: string, turn: Quaternion) => {
    const d = live.current.data, p = d.poses.find((x) => x.id === live.current.poseId);
    if (!p) return;
    const e = new Euler().setFromQuaternion(turn, 'XYZ');
    const next: HandPose = { ...p, bones: { ...p.bones, [name]: clampTurn(name, [e.x, e.y, e.z]) } };
    commit({ ...d, poses: d.poses.map((x) => (x.id === p.id ? next : x)) });
  };
  const setTurnDeg = (name: string, axis: number, deg: number) => {
    if (!pose) return;
    const cur = [...(pose.bones[name] ?? [0, 0, 0])] as [number, number, number];
    cur[axis] = deg * DEG;
    commit({ ...data, poses: data.poses.map((x) => (x.id === pose.id ? { ...x, bones: { ...x.bones, [name]: clampTurn(name, cur) } } : x)) });
  };
  const newPose = (from?: HandPose) => {
    const taken = new Set(data.poses.map((p) => p.id));
    const name = from ? `${from.name} (bản sao)` : 'Tư thế mới';
    const p: HandPose = { id: uniqueId(from ? `${from.id}-copy` : 'tu-the', taken), name, bones: from ? structuredClone(from.bones) : {} };
    commit({ ...data, poses: [...data.poses, p] }); setPoseId(p.id);
  };
  const deletePose = () => {
    if (!pose || data.poses.length <= 1) return;
    const used = data.animations.some((a) => a.tracks.some((t) => t.keys.some((k) => k.pose === pose.id)));
    if (used && !confirm('Tư thế này đang dùng trong animation. Vẫn xoá?')) return;
    const rest = data.poses.filter((p) => p.id !== pose.id);
    commit({ ...data, poses: rest }); setPoseId(rest[0]!.id);
  };

  // Dragging a joint's tip (mode "kéo"): the bone turns to point at the pointer, its length kept.
  const picker = useRef(new Raycaster());
  const pickJoint = (e: React.PointerEvent): number | null => {
    const st = stage.current, el = host.current;
    if (!st || !el) return null;
    const rect = el.getBoundingClientRect();
    picker.current.setFromCamera(new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), live.current.fpView ? st.fpCam : st.editCam);
    const hit = picker.current.intersectObjects(st.joints.filter((j) => j.visible), false)[0];
    return hit ? st.joints.indexOf(hit.object as Mesh) : null;
  };
  const drag = useRef<{ bone: Bone; name: string; plane: Plane; tipFrom: Vector3 } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (tab !== 'pose' || dragging.current) return;
    const st = stage.current, hands = st?.view.firstPersonHands;
    const j = pickJoint(e);
    if (j === null || !st || !hands) return;
    // Joint balls: 0 the wrist, then 3 per finger (base→tip).
    if (j === 0) { setBone('hand'); return; }
    const f = Math.floor((j - 1) / 3), k = (j - 1) % 3, name = `${HAND_FINGERS[f]}_0${k + 1}`;
    setBone(name);
    if (mode !== 'drag') return;
    // Dragging the ball of joint k turns the bone before it (k−1), or the finger's base from the hand.
    const chain = hands.rig.handBones(live.current.side).fingers[f]!;
    const moved = k > 0 ? chain[k - 1]! : chain[0]!;
    const movedName = `${HAND_FINGERS[f]}_0${k > 0 ? k : 1}`;
    const tip = st.joints[j]!.position.clone();
    const cam = live.current.fpView ? st.fpCam : st.editCam;
    drag.current = { bone: moved, name: movedName, plane: new Plane().setFromNormalAndCoplanarPoint(cam.getWorldDirection(new Vector3()).negate(), tip), tipFrom: tip };
    controls(false);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const controls = (on: boolean) => { if (stage.current) stage.current.controls.enabled = on; dragging.current = !on; };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current, st = stage.current, el = host.current, hands = st?.view.firstPersonHands;
    if (!d || !st || !el || !hands) return;
    const rect = el.getBoundingClientRect();
    picker.current.setFromCamera(new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), live.current.fpView ? st.fpCam : st.editCam);
    const to = picker.current.ray.intersectPlane(d.plane, new Vector3());
    if (!to) return;
    d.bone.updateWorldMatrix(true, false);
    const origin = new Vector3().setFromMatrixPosition(d.bone.matrixWorld);
    // The tip as the bone holds it now (its child joint, or one bone length further along it).
    const child = d.bone.children.find((c) => (c as Bone).isBone) as Bone | undefined;
    const tipNow = child ? new Vector3().setFromMatrixPosition(child.matrixWorld) : d.tipFrom;
    const from = tipNow.clone().sub(origin).normalize(), want = to.clone().sub(origin).normalize();
    const wq = new Quaternion(); d.bone.matrixWorld.decompose(new Vector3(), wq, new Vector3());
    wq.premultiply(new Quaternion().setFromUnitVectors(from, want));
    const pq = new Quaternion(); d.bone.parent!.updateWorldMatrix(true, false); d.bone.parent!.matrixWorld.decompose(new Vector3(), pq, new Vector3());
    d.bone.quaternion.copy(pq.invert().multiply(wq));
    setTurn(d.name, hands.rig.boneTurn(d.bone));
  };
  const onPointerUp = () => { if (drag.current) { drag.current = null; controls(true); } };

  // ---------------------------------------------------------------- animations

  const setAnim = (next: HandAnimation) => commit({ ...live.current.data, animations: live.current.data.animations.map((a) => (a.id === next.id ? next : a)) });
  const newAnim = (from?: HandAnimation) => {
    const taken = new Set(data.animations.map((a) => a.id));
    const a: HandAnimation = from ? { ...structuredClone(from), id: uniqueId(`${from.id}-copy`, taken), name: `${from.name} (bản sao)` } : {
      id: uniqueId(`${weapon}-reload`, taken), name: `Thay đạn ${ITEMS[weapon]?.name ?? weapon}`, weapon, action: 'reload', duration: 2.2, speed: 1, sounds: [],
      tracks: [{ id: 'gun', kind: 'gun', keys: [] }, { id: 'hand-l', kind: 'handL', keys: [] }, { id: 'hand-r', kind: 'handR', keys: [] }],
    };
    commit({ ...data, animations: [...data.animations, a] }); setAnimId(a.id); setTime(0); setSel(null);
  };
  const deleteAnim = () => {
    if (!anim || !confirm(`Xoá animation “${anim.name}”?`)) return;
    commit({ ...data, animations: data.animations.filter((a) => a.id !== anim.id) }); setAnimId(null); setSel(null);
  };
  const updateKey = (trackId: string, index: number, patch: Partial<HandKey>) => {
    const a = live.current.data.animations.find((x) => x.id === live.current.animId);
    if (!a) return;
    setAnim({ ...a, tracks: a.tracks.map((t) => (t.id === trackId ? { ...t, keys: t.keys.map((k, i) => (i === index ? { ...k, ...patch } : k)) } : t)) });
  };
  /** A new key on a track at the play head, holding what the stage shows now. */
  const addKey = (tr: HandTrack, at = time) => {
    if (!anim) return;
    const st = stage.current;
    const t = Math.round(at * 1000) / 1000;
    let key: HandKey = { t, ease: 'inOut' };
    const sample = handKeysAt(tr.keys, t);
    if (tr.kind === 'handL' || tr.kind === 'handR') {
      const on = st?.view.handOnGun(tr.kind === 'handL' ? 'L' : 'R');
      key = { ...key, ...(on ? { pos: on.pos, rot: on.rot } : {}), pose: (sample && (sample.u < .5 ? sample.a.pose : sample.b.pose)) ?? 'relaxed' };
    } else if (tr.kind === 'gun') key = { ...key, pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 };
    else key = { ...key, ...(tr.clip ? { clip: sample ? (sample.a.clip ?? 0) : 0 } : { pos: [0, 0, 0], rot: [0, 0, 0] }) };
    const keys = [...tr.keys.filter((k) => Math.abs(k.t - t) > 1e-4), key].sort((x, y) => x.t - y.t);
    setAnim({ ...anim, tracks: anim.tracks.map((x) => (x.id === tr.id ? { ...x, keys } : x)) });
    setSel({ track: tr.id, key: keys.indexOf(key) });
  };
  const deleteKey = () => {
    if (!anim || !sel) return;
    setAnim({ ...anim, tracks: anim.tracks.map((t) => (t.id === sel.track ? { ...t, keys: t.keys.filter((_, i) => i !== sel.key) } : t)) });
    setSel(null);
  };
  type AnimSound = HandAnimation['sounds'][number];
  const updateSound = (i: number, patch: Partial<AnimSound>) => {
    const a = live.current.data.animations.find((x) => x.id === live.current.animId);
    if (!a) return;
    setAnim({ ...a, sounds: a.sounds.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  };
  /** A sound at a time: the one picked last (or the magazine out), the list kept in time order. */
  const addSound = (at: number) => {
    if (!anim) return;
    const last = soundSel !== null ? anim.sounds[soundSel] : undefined;
    const s: AnimSound = { at: Math.round(at * 1000) / 1000, sound: last?.sound ?? 'partMagOut', ...(last?.volume !== undefined ? { volume: last.volume } : {}), ...(last?.rate !== undefined ? { rate: last.rate } : {}) };
    const sounds = [...anim.sounds, s].sort((a, b) => a.at - b.at);
    setAnim({ ...anim, sounds }); setSoundSel(sounds.indexOf(s)); setSel(null);
  };
  const addTrack = (kind: HandTrack['kind'], part?: string, clip?: string) => {
    if (!anim) return;
    const taken = new Set(anim.tracks.map((t) => t.id));
    const tr: HandTrack = { id: uniqueId(kind === 'part' ? `part-${part ?? clip ?? ''}` : kind, taken), kind, ...(part ? { part } : {}), ...(clip ? { clip } : {}), keys: [] };
    setAnim({ ...anim, tracks: [...anim.tracks, tr] });
  };
  const timeline = useRef<HTMLDivElement>(null);
  const keyDrag = useRef<{ track: string; key: number } | null>(null);
  const tAt = (clientX: number) => {
    const el = timeline.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left - 150) / Math.max(1, r.width - 160)));
  };

  // ---------------------------------------------------------------- save

  async function save() {
    const parsed = handStudioSchema.safeParse(data);
    if (!parsed.success) { setStatus(`Dữ liệu chưa hợp lệ: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`); return; }
    setStatus('Đang lưu…');
    try { await studioSaveHandStudio(parsed.data); setDirty(false); setStatus('Đã lưu: game dùng ngay ở lần tải tới.'); }
    catch (err) { setStatus(err instanceof Error ? err.message : 'Lưu thất bại'); if (!hasStudioSession()) setLocked(true); }
  }

  const selTrack = anim?.tracks.find((t) => t.id === sel?.track) ?? null;
  const selSound = anim && soundSel !== null ? anim.sounds[soundSel] ?? null : null;
  const selKey = selTrack && sel ? selTrack.keys[sel.key] ?? null : null;
  const num = (label: string, value: number, step: number, on: (v: number) => void) =>
    <label className="gs-num" key={label}><span>{label}</span><input type="number" step={step} value={+value.toFixed(4)} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) on(v); }} /></label>;
  const vec = (label: string, v: readonly [number, number, number] | undefined, step: number, on: (v: [number, number, number] | undefined) => void, names = ['X', 'Y', 'Z']) => (
    <div className="hs-vec">
      <div className="hs-vec-head"><span>{label}</span>{v ? <button className="btn hs-mini" onClick={() => on(undefined)}>Bỏ</button> : <button className="btn hs-mini" onClick={() => on([0, 0, 0])}>Thêm</button>}</div>
      {v && names.map((n, i) => num(n, v[i]!, step, (x) => { const o = [...v] as [number, number, number]; o[i] = x; on(o); }))}
    </div>
  );
  const poseOptions = data.poses.map((p) => <option key={p.id} value={p.id}>{p.name}</option>);
  const weaponName = (id: string) => ITEMS[id]?.name ?? id;
  const sortedWeapons = useMemo(() => [...weapons].sort((a, b) => weaponName(a).localeCompare(weaponName(b))), [weapons]);

  return (
    <div className="gs-page hs-page">
      <header className="gs-bar">
        <Link href="/studio" className="studio-back" title="Về Xưởng"><Icon name="lucide:arrow-left" /></Link>
        <h1>Bàn tay &amp; animation</h1>
        <div className="gs-motion">
          <button className={`btn${tab === 'pose' ? ' btn-primary' : ''}`} onClick={() => { setTab('pose'); setSel(null); }}>Tư thế tay</button>
          <button className={`btn${tab === 'anim' ? ' btn-primary' : ''}`} onClick={() => { setTab('anim'); setBone(null); }}>Animation</button>
        </div>
        <label className="gs-row hs-weapon"><span>Vũ khí</span>
          <select value={weapon} onChange={(e) => setWeapon(e.target.value)} disabled={!ready}>
            {tab === 'pose' && <option value="">— tay không —</option>}
            {sortedWeapons.map((id) => <option key={id} value={id}>{weaponName(id)}</option>)}
          </select>
        </label>
        <div className="gs-motion">
          <button className={`btn${fpView ? ' btn-primary' : ''}`} onClick={() => setFpView(true)} title="Đúng như người chơi thấy">Góc nhìn người chơi</button>
          <button className={`btn${!fpView ? ' btn-primary' : ''}`} onClick={() => setFpView(false)} title="Xoay, thu phóng tự do; khung chóp cụt là tầm nhìn người chơi">Camera tự do</button>
        </div>
        <span className="gs-status">{status}{dirty ? ' · chưa lưu' : ''}</span>
        <button className="btn btn-primary" onClick={() => void save()} disabled={!ready || !dirty}><Icon name="lucide:save" /> Lưu</button>
      </header>

      <aside className="gs-panel">
        {tab === 'pose' ? <>
          <h3>Tư thế tay</h3>
          <div className="hs-list">
            {data.poses.map((p) => <button key={p.id} className={`hs-item${p.id === pose?.id ? ' on' : ''}`} onClick={() => { setPoseId(p.id); setBone(null); }}>{p.name}<small>{p.id}</small></button>)}
          </div>
          <div className="gs-row">
            <button className="btn" onClick={() => newPose()}><Icon name="lucide:plus" /> Mới</button>
            <button className="btn" onClick={() => pose && newPose(pose)} disabled={!pose}><Icon name="lucide:copy" /> Nhân bản</button>
            <button className="btn" onClick={deletePose} disabled={data.poses.length <= 1}><Icon name="lucide:trash-2" /></button>
          </div>
          {pose && <label className="gs-row"><span>Tên</span><input value={pose.name} onChange={(e) => commit({ ...data, poses: data.poses.map((p) => (p.id === pose.id ? { ...p, name: e.target.value.slice(0, 48) || p.name } : p)) })} /></label>}
          <p className="gs-hint">Mã <b>{pose?.id}</b> dùng trong animation và trong game (kiểu bàn tay của thao tác). Tư thế trùng tên mặc định (open, fist, ready, pinch, relaxed) thay luôn kiểu tay chuẩn của game.</p>
        </> : <>
          <h3>Animation</h3>
          <div className="hs-list">
            {data.animations.map((a) => <button key={a.id} className={`hs-item${a.id === anim?.id ? ' on' : ''}`} onClick={() => { setAnimId(a.id); setSel(null); setSoundSel(null); setTime(0); if (a.weapon !== '*' && weapons.includes(a.weapon)) setWeapon(a.weapon); }}>{a.name}<small>{a.weapon === '*' ? 'mọi súng' : weaponName(a.weapon)} · {a.action === 'reload' ? 'thay đạn' : 'không gán'}</small></button>)}
            {!data.animations.length && <p className="gs-hint">Chưa có animation. Bấm “Mới” để tạo cho vũ khí đang chọn.</p>}
          </div>
          <div className="gs-row">
            <button className="btn" onClick={() => newAnim()} disabled={!weapon}><Icon name="lucide:plus" /> Mới</button>
            <button className="btn" onClick={() => anim && newAnim(anim)} disabled={!anim}><Icon name="lucide:copy" /> Nhân bản</button>
            <button className="btn" onClick={deleteAnim} disabled={!anim}><Icon name="lucide:trash-2" /></button>
          </div>
          {anim && <>
            <label className="gs-row"><span>Tên</span><input value={anim.name} onChange={(e) => setAnim({ ...anim, name: e.target.value.slice(0, 60) || anim.name })} /></label>
            <label className="gs-row"><span>Vũ khí</span><select value={anim.weapon} onChange={(e) => setAnim({ ...anim, weapon: e.target.value })}>{sortedWeapons.map((id) => <option key={id} value={id}>{weaponName(id)}</option>)}</select></label>
            <label className="gs-row"><span>Dùng trong game</span><select value={anim.action} onChange={(e) => setAnim({ ...anim, action: e.target.value as HandAnimation['action'] })}><option value="reload">Thay đạn (thay cho thao tác có sẵn)</option><option value="none">Không gán</option></select></label>
            {num('Thời lượng (s)', anim.duration, .1, (v) => setAnim(retime(anim, Math.min(20, Math.max(.1, v)))))}
            {num('Tốc độ phát (×)', anim.speed, .05, (v) => setAnim({ ...anim, speed: Math.min(4, Math.max(.05, v)) }))}
            <p className="gs-hint">Trong game animation kéo dài đúng thời gian thay đạn của súng; âm thanh dưới đây (nếu có) phát theo tỉ lệ thời gian, không có thì dùng âm thanh thay đạn sẵn có của súng.</p>
            <h4>Âm thanh ({anim.sounds.length})</h4>
            <p className="gs-hint">Âm thanh nằm ở hàng “Âm thanh” trên timeline: nhấp đúp để thêm, kéo để dời, bấm để chỉnh (âm, độ lớn, cao độ, nghe thử).</p>
            {anim.sounds.length > 0 && <button className="btn" onClick={() => { if (confirm('Xoá hết âm thanh của animation này (game dùng lại âm thanh thay đạn sẵn có)?')) { setAnim({ ...anim, sounds: [] }); setSoundSel(null); } }}>Xoá hết âm thanh</button>}
          </>}
        </>}
      </aside>

      <div className={`hs-center${tab === 'anim' ? ' with-timeline' : ''}`}>
        <div className="gs-view hs-view" ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
        {tab === 'anim' && anim && (
          <div className="hs-timeline" ref={timeline}
            onPointerMove={(e) => {
              const k = keyDrag.current; if (k) { const t = Math.round(tAt(e.clientX) * 1000) / 1000; updateKey(k.track, k.key, { t }); setTime(t); }
              const si = soundDrag.current; if (si !== null) { const t = Math.round(tAt(e.clientX) * 1000) / 1000; updateSound(si, { at: t }); setTime(t); }
            }}
            onPointerUp={() => { soundDrag.current = null; if (keyDrag.current && anim) { const k = keyDrag.current; keyDrag.current = null; const tr = anim.tracks.find((x) => x.id === k.track); if (tr) { const moved = tr.keys[k.key]; const keys = [...tr.keys].sort((a, b) => a.t - b.t); setAnim({ ...anim, tracks: anim.tracks.map((x) => (x.id === tr.id ? { ...x, keys } : x)) }); setSel({ track: tr.id, key: moved ? keys.indexOf(moved) : 0 }); } } }}>
            <div className="hs-transport">
              <button className="btn hs-mini" title="Về đầu" onClick={() => { setPlaying(false); setTime(0); }}><Icon name="lucide:skip-back" /></button>
              <button className="btn hs-mini" title="Lùi" onClick={() => setTime(Math.max(0, time - .02))}><Icon name="lucide:chevron-left" /></button>
              <button className="btn hs-mini btn-primary" title={playing ? 'Tạm dừng' : 'Phát'} onClick={() => { if (time >= 1) setTime(0); setPlaying(!playing); }}><Icon name={playing ? 'lucide:pause' : 'lucide:play'} /></button>
              <button className="btn hs-mini" title="Dừng" onClick={() => { setPlaying(false); setTime(0); }}><Icon name="lucide:square" /></button>
              <button className="btn hs-mini" title="Tới" onClick={() => setTime(Math.min(1, time + .02))}><Icon name="lucide:chevron-right" /></button>
              <label className="gs-row"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Lặp</label>
              <span className="hs-time">{(time * anim.duration).toFixed(2)} s / {anim.duration.toFixed(2)} s · {Math.round(time * 100)}%</span>
              <select title="Thêm track" value="" onChange={(e) => { const v = e.target.value; if (!v) return; const [kind, a, b] = v.split('|'); addTrack(kind as HandTrack['kind'], a || undefined, b || undefined); }}>
                <option value="">+ Track…</option>
                {!anim.tracks.some((t) => t.kind === 'gun') && <option value="gun">Súng</option>}
                {!anim.tracks.some((t) => t.kind === 'handL') && <option value="handL">Tay trái</option>}
                {!anim.tracks.some((t) => t.kind === 'handR') && <option value="handR">Tay phải</option>}
                {parts.clips.map((c) => <option key={`c${c}`} value={`part||${c}`}>Bộ phận theo clip: {c}</option>)}
                {parts.parts.map((p) => <option key={`p${p}`} value={`part|${p}|`}>Bộ phận: {p} (di chuyển / xoay)</option>)}
              </select>
            </div>
            <div className="hs-ruler" onPointerDown={(e) => { setPlaying(false); setTime(tAt(e.clientX)); }}>
              <span className="hs-ruler-label">Thời gian</span>
              <div className="hs-lane">{[0, .25, .5, .75, 1].map((t) => <i key={t} style={{ left: `${t * 100}%` }}>{(t * anim.duration).toFixed(2)}s</i>)}<b className="hs-head" style={{ left: `${time * 100}%` }} /></div>
            </div>
            <div className="hs-track">
              <span className="hs-track-label">
                <Icon name="lucide:volume-2" /> Âm thanh
                <button className="btn hs-mini" title="Thêm âm thanh tại đầu phát" onClick={() => addSound(time)}><Icon name="lucide:plus" /></button>
              </span>
              <div className="hs-lane hs-sound-lane" onDoubleClick={(e) => addSound(tAt(e.clientX))} onPointerDown={(e) => { if (e.target === e.currentTarget) { setPlaying(false); setTime(tAt(e.clientX)); } }}>
                {anim.sounds.map((s, i) => (
                  <button key={i} className={`hs-sound${soundSel === i ? ' on' : ''}`} style={{ left: `${s.at * 100}%` }} title={`${(s.at * anim.duration).toFixed(2)}s · ${soundName(s.sound)}`}
                    onPointerDown={(e) => { e.stopPropagation(); setPlaying(false); setSoundSel(i); setSel(null); setTime(s.at); soundDrag.current = i; }}>
                    <span>{soundName(s.sound)}</span>
                  </button>
                ))}
                <b className="hs-head" style={{ left: `${time * 100}%` }} />
              </div>
            </div>
            {anim.tracks.map((tr) => (
              <div key={tr.id} className="hs-track">
                <span className="hs-track-label" title={tr.part ?? tr.clip ?? ''}>
                  {tr.kind === 'part' ? `${tr.clip ?? tr.part}` : TRACK_NAMES[tr.kind]}
                  <button className="btn hs-mini" title="Thêm key tại đầu phát" onClick={() => addKey(tr)}><Icon name="lucide:diamond-plus" /></button>
                  <button className="btn hs-mini" title="Xoá track" onClick={() => { if (confirm('Xoá track này?')) { setAnim({ ...anim, tracks: anim.tracks.filter((x) => x.id !== tr.id) }); setSel(null); } }}><Icon name="lucide:x" /></button>
                </span>
                <div className="hs-lane" onDoubleClick={(e) => addKey(tr, tAt(e.clientX))} onPointerDown={(e) => { if (e.target === e.currentTarget) { setPlaying(false); setTime(tAt(e.clientX)); } }}>
                  {tr.keys.map((k, i) => (
                    <button key={i} className={`hs-key${sel?.track === tr.id && sel.key === i ? ' on' : ''}${k.pose ? ' posed' : ''}`} style={{ left: `${k.t * 100}%` }} title={`${(k.t * anim.duration).toFixed(2)}s${k.pose ? ` · ${k.pose}` : ''}`}
                      onPointerDown={(e) => { e.stopPropagation(); setPlaying(false); setSoundSel(null); setSel({ track: tr.id, key: i }); setTime(k.t); keyDrag.current = { track: tr.id, key: i }; }} />
                  ))}
                  <b className="hs-head" style={{ left: `${time * 100}%` }} />
                </div>
              </div>
            ))}
            <p className="gs-hint">Nhấp đúp vào hàng để thêm key; kéo key để dời; bấm vạch thời gian để tua. Key của tay lấy vị trí và kiểu tay đang thấy.</p>
          </div>
        )}
      </div>

      <aside className="gs-panel">
        {tab === 'pose' && pose && <>
          <h3>Khung xương bàn tay</h3>
          <div className="gs-row"><span>Xem trên tay</span>
            <div className="gs-motion" style={{ margin: 0 }}>{(['R', 'L'] as const).map((s) => <button key={s} className={`btn${side === s ? ' btn-primary' : ''}`} onClick={() => setSide(s)}>{s === 'R' ? 'Phải' : 'Trái'}</button>)}</div>
          </div>
          <div className="gs-row"><span>Thao tác</span>
            <div className="gs-motion" style={{ margin: 0 }}>
              <button className={`btn${mode === 'rotate' ? ' btn-primary' : ''}`} onClick={() => setMode('rotate')}>Xoay khớp</button>
              <button className={`btn${mode === 'drag' ? ' btn-primary' : ''}`} onClick={() => setMode('drag')}>Kéo đốt</button>
            </div>
          </div>
          <p className="gs-hint">{mode === 'rotate' ? 'Bấm một khớp (chấm vàng) rồi xoay bằng vòng xoay (ở Camera tự do) hoặc nhập số bên dưới.' : 'Kéo chấm vàng ở đầu một đốt: đốt xương quay theo con trỏ, độ dài giữ nguyên.'} Mỗi khớp có giới hạn góc để bàn tay không bị dị dạng.</p>
          <div className="hs-finger">
            <h4>Cổ tay</h4>
            {(() => {
              const e = pose.bones.hand ?? [0, 0, 0], L = jointLimits('hand');
              return (
                <div className={`hs-joint${bone === 'hand' ? ' on' : ''}`} onClick={() => setBone('hand')}>
                  <span>cổ tay</span>
                  {(['Gập', 'Nghiêng', 'Vặn'] as const).map((label, i) => (
                    <label key={label} title={`${label} (${Math.round(L[i]![0] / DEG)}°…${Math.round(L[i]![1] / DEG)}°)`}>
                      <input type="range" min={L[i]![0] / DEG} max={L[i]![1] / DEG} step={.5} value={e[i]! / DEG} onChange={(ev) => setTurnDeg('hand', i, Number(ev.target.value))} />
                    </label>
                  ))}
                  <b>{Math.round(e[0] / DEG)}°</b>
                </div>
              );
            })()}
          </div>
          {HAND_FINGERS.map((f) => (
            <div key={f} className="hs-finger">
              <h4>{FINGER_NAMES[f]}</h4>
              {[1, 2, 3].map((k) => {
                const name = `${f}_0${k}`, e = pose.bones[name] ?? [0, 0, 0], L = jointLimits(name);
                return (
                  <div key={name} className={`hs-joint${bone === name ? ' on' : ''}`} onClick={() => setBone(name)}>
                    <span>{JOINT_NAMES[k - 1]}</span>
                    {(['Gập', 'Nghiêng', 'Vặn'] as const).map((label, i) => (
                      <label key={label} title={`${label} (${Math.round(L[i]![0] / DEG)}°…${Math.round(L[i]![1] / DEG)}°)`}>
                        <input type="range" min={L[i]![0] / DEG} max={L[i]![1] / DEG} step={.5} value={e[i]! / DEG} onChange={(ev) => setTurnDeg(name, i, Number(ev.target.value))} />
                      </label>
                    ))}
                    <b>{Math.round(e[0] / DEG)}°</b>
                  </div>
                );
              })}
            </div>
          ))}
          <button className="btn" onClick={() => commit({ ...data, poses: data.poses.map((p) => (p.id === pose.id ? { ...p, bones: {} } : p)) })}>Duỗi thẳng tất cả</button>
        </>}
        {tab === 'anim' && anim && <>
          {selSound && soundSel !== null && <>
            <h3>Âm thanh đang chọn</h3>
            <label className="gs-row"><span>Âm thanh</span>
              <select value={selSound.sound} onChange={(e) => { updateSound(soundSel, { sound: e.target.value }); preview({ ...selSound, sound: e.target.value }); }}>
                {SOUND_GROUPS.map(([group, names]) => <optgroup key={group} label={group}>{names.map((n) => <option key={n} value={n}>{soundName(n)}</option>)}</optgroup>)}
              </select>
            </label>
            {num('Thời điểm (0…1)', selSound.at, .01, (v) => updateSound(soundSel, { at: Math.min(1, Math.max(0, v)) }))}
            {num('Độ lớn (0…2)', selSound.volume ?? .9, .05, (v) => updateSound(soundSel, { volume: Math.min(2, Math.max(0, v)) }))}
            {num('Cao độ / tốc độ (×)', selSound.rate ?? 1, .05, (v) => updateSound(soundSel, { rate: Math.min(4, Math.max(.25, v)) }))}
            <div className="gs-row">
              <button className="btn" onClick={() => preview(selSound)}><Icon name="lucide:play" /> Nghe thử</button>
              <button className="btn" onClick={() => { const at = Math.min(1, selSound.at + .05); setAnim({ ...anim, sounds: [...anim.sounds, { ...selSound, at }].sort((a, b) => a.at - b.at) }); }}><Icon name="lucide:copy" /> Nhân bản</button>
              <button className="btn" onClick={() => { setAnim({ ...anim, sounds: anim.sounds.filter((_, j) => j !== soundSel) }); setSoundSel(null); }}><Icon name="lucide:trash-2" /> Xoá</button>
            </div>
          </>}
          <h3>Key đang chọn</h3>
          {!selKey && <p className="gs-hint">Chọn một key trên timeline (hoặc thêm key bằng nút ◇+ ở đầu track).</p>}
          {selKey && selTrack && sel && <>
            <div className="gs-row"><span>{TRACK_NAMES[selTrack.kind]}{selTrack.kind === 'part' ? ` · ${selTrack.clip ?? selTrack.part}` : ''}</span><button className="btn" onClick={deleteKey}><Icon name="lucide:trash-2" /> Xoá key</button></div>
            {num('Thời điểm (0…1)', selKey.t, .01, (v) => updateKey(selTrack.id, sel.key, { t: Math.min(1, Math.max(0, v)) }))}
            <label className="gs-row"><span>Chuyển động tới key</span><select value={selKey.ease} onChange={(e) => updateKey(selTrack.id, sel.key, { ease: e.target.value as HandKey['ease'] })}>{HAND_EASES.map((x) => <option key={x} value={x}>{EASE_NAMES[x]}</option>)}</select></label>
            {(selTrack.kind === 'handL' || selTrack.kind === 'handR') && <>
              <label className="gs-row"><span>Kiểu bàn tay</span><select value={selKey.pose ?? ''} onChange={(e) => updateKey(selTrack.id, sel.key, { pose: e.target.value || undefined })}><option value="">— giữ —</option>{poseOptions}</select></label>
              <label className="gs-row"><span>Bám theo bộ phận</span><select value={selKey.part ?? ''} onChange={(e) => updateKey(selTrack.id, sel.key, { part: e.target.value || undefined })}><option value="">— thân súng —</option>{parts.parts.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
              <div className="gs-row">
                <button className="btn" onClick={() => { const on = stage.current?.view.handOnGun(selTrack.kind === 'handL' ? 'L' : 'R'); if (on) updateKey(selTrack.id, sel.key, { pos: on.pos, rot: on.rot, part: undefined }); }}>Lấy từ tay đang thấy</button>
                <div className="gs-motion" style={{ margin: 0 }}>
                  <button className={`btn${mode === 'rotate' ? ' btn-primary' : ''}`} onClick={() => setMode('rotate')} title="Vòng xoay trên tay (Camera tự do)">Xoay</button>
                  <button className={`btn${mode === 'drag' ? ' btn-primary' : ''}`} onClick={() => setMode('drag')} title="Mũi tên kéo tay (Camera tự do)">Dời</button>
                </div>
              </div>
              {vec('Vị trí trên súng (m): tới nòng, lên, phải', selKey.pos, .005, (v) => updateKey(selTrack.id, sel.key, { pos: v }))}
              {vec('Cổ tay — góc bàn tay trên súng (độ); bỏ trống: chỉ với tới', selKey.rot, 1, (v) => updateKey(selTrack.id, sel.key, { rot: v }))}
              <h4>Khuỷu tay</h4>
              {num('Xoay khuỷu (độ): + ra ngoài, lên', selKey.elbow ?? 0, 2, (v) => updateKey(selTrack.id, sel.key, { elbow: Math.abs(v) < .01 ? undefined : Math.min(180, Math.max(-180, v)) }))}
              {vec('Vai — dời (m): phải, lên, lùi', selKey.shoulder, .005, (v) => updateKey(selTrack.id, sel.key, { shoulder: v }))}
            </>}
            {selTrack.kind === 'gun' && <>
              {vec('Dời súng (m): phải, lên, lùi', selKey.pos, .005, (v) => updateKey(selTrack.id, sel.key, { pos: v }))}
              {vec('Xoay súng (độ): ngóc, quay, nghiêng', selKey.rot, 1, (v) => updateKey(selTrack.id, sel.key, { rot: v }))}
              {num('Kích thước (×)', selKey.scale ?? 1, .01, (v) => updateKey(selTrack.id, sel.key, { scale: Math.min(5, Math.max(.1, v)) }))}
            </>}
            {selTrack.kind === 'part' && <>
              {selTrack.clip ? num('Tiến độ clip (0…1)', selKey.clip ?? 0, .02, (v) => updateKey(selTrack.id, sel.key, { clip: Math.min(1, Math.max(0, v)) })) : <>
                {vec('Dời bộ phận (m, khung súng)', selKey.pos, .002, (v) => updateKey(selTrack.id, sel.key, { pos: v }))}
                {vec('Xoay bộ phận (độ)', selKey.rot, 1, (v) => updateKey(selTrack.id, sel.key, { rot: v }))}
              </>}
            </>}
          </>}
        </>}
      </aside>

      {locked && <div className="studio-root studio-gate"><div className="overlay-card"><h2>Bàn tay &amp; animation</h2>
        <form className="studio-unlock" onSubmit={(e) => { e.preventDefault(); void studioLogin(password).then(() => { setLocked(false); setStatus(''); }).catch(() => setStatus('Sai mật khẩu xưởng.')); }}>
          <p>Nhập mật khẩu xưởng để lưu chỉnh sửa.</p>
          <input type="password" autoFocus placeholder="Mật khẩu xưởng" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={!password}>Vào</button>
        </form></div></div>}
    </div>
  );
}

/**
 * A new length: every key and sound keeps its time in seconds (the moves keep their speed); on the
 * 0…1 timeline they draw closer together when it grows. Shortened past them, they gather at the end.
 */
function retime(a: HandAnimation, duration: number): HandAnimation {
  const k = a.duration / duration, at = (t: number) => Math.round(Math.min(1, t * k) * 10000) / 10000;
  return { ...a, duration, tracks: a.tracks.map((tr) => ({ ...tr, keys: tr.keys.map((key) => ({ ...key, t: at(key.t) })) })), sounds: a.sounds.map((s) => ({ ...s, at: at(s.at) })) };
}

function boneByName(hand: { hand: Bone; fingers: Bone[][] }, name: string): Bone | null {
  if (name === 'hand') return hand.hand;
  const m = /^(.+)_0(\d)$/.exec(name);
  if (!m) return null;
  return hand.fingers[HAND_FINGERS.indexOf(m[1] as (typeof HAND_FINGERS)[number])]?.[Number(m[2]) - 1] ?? null;
}

function partNode(view: ViewModel, name: string): Object3D | null {
  let found: Object3D | null = null;
  view.gunModel?.traverse((o) => { if (!found && o.name === name) found = o; });
  return found;
}

/** The joints as balls (the hand, then each finger base→tip) and the bones as lines, through the hand. */
function drawSkeleton(st: { joints: Mesh[]; lines: LineSegments }, hand: { hand: Bone; fingers: Bone[][] }, show: boolean, picked: string | null): void {
  const pts: number[] = [];
  const at = (b: Bone) => new Vector3().setFromMatrixPosition(b.matrixWorld);
  const wrist = at(hand.hand);
  st.joints[0]!.position.copy(wrist); st.joints[0]!.visible = show;
  (st.joints[0]!.material as MeshBasicMaterial).color.setHex(picked === 'hand' ? 0xff5a36 : 0x7fd3ff);
  st.joints[0]!.scale.setScalar(1.6);
  hand.fingers.forEach((chain, f) => {
    let prev = wrist;
    chain.forEach((b, k) => {
      const p = at(b), j = st.joints[1 + f * 3 + k]!;
      j.position.copy(p); j.visible = show;
      (j.material as MeshBasicMaterial).color.setHex(picked === `${HAND_FINGERS[f]}_0${k + 1}` ? 0xff5a36 : 0xffd23f);
      pts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      prev = p;
    });
  });
  st.lines.geometry.setAttribute('position', new Float32BufferAttribute(pts, 3));
  st.lines.visible = show;
}

/** The player's view: a frustum from the eye with the screen as a translucent rectangle. */
function frustumHelper(cam: PerspectiveCamera): Group {
  const g = new Group();
  const near = .12, far = .9;
  const build = () => {
    g.clear();
    const corners = (d: number) => {
      const h = Math.tan(cam.fov * DEG / 2) * d, w = h * cam.aspect;
      return [new Vector3(-w, h, -d), new Vector3(w, h, -d), new Vector3(w, -h, -d), new Vector3(-w, -h, -d)];
    };
    const a = corners(near), b = corners(far), pts: number[] = [];
    const seg = (p: Vector3, q: Vector3) => pts.push(p.x, p.y, p.z, q.x, q.y, q.z);
    for (let i = 0; i < 4; i++) { seg(a[i]!, a[(i + 1) % 4]!); seg(b[i]!, b[(i + 1) % 4]!); seg(a[i]!, b[i]!); seg(new Vector3(), a[i]!); }
    const lines = new LineSegments(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3)), new LineBasicMaterial({ color: 0x7cc4ff }));
    g.add(lines);
    const h = Math.tan(cam.fov * DEG / 2) * near;
    const screen = new Mesh(new PlaneGeometry(h * 2 * cam.aspect, h * 2), new MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: .12, side: DoubleSide, depthWrite: false }));
    screen.position.z = -near; g.add(screen);
  };
  build();
  g.userData.rebuild = build;
  return g;
}

/** Sounds of an animation crossed between two play times (Studio preview). */
function playSounds(a: HandAnimation, from: number, to: number): void {
  for (const s of a.sounds) {
    const crossed = to >= from ? s.at > from && s.at <= to : s.at > from || s.at <= to;
    if (crossed) preview(s);
  }
}

/**
 * One sound as the game plays it (its volume and pitch), through Web Audio from the same files the
 * game loads (by their hashed names), so several can overlap.
 */
let audio: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
function preview(s: { sound: string; volume?: number; rate?: number }): void {
  const url = (SOUND_FILES as Record<string, string>)[s.sound];
  if (!url) return;
  audio ??= new AudioContext();
  if (audio.state === 'suspended') void audio.resume();
  const ctx = audio;
  if (!buffers.has(url)) buffers.set(url, cachedFetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))).then((b) => ctx.decodeAudioData(b)).catch(() => null));
  void buffers.get(url)!.then((buffer) => {
    if (!buffer) return;
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buffer; src.playbackRate.value = s.rate ?? 1; gain.gain.value = s.volume ?? .9;
    src.connect(gain).connect(ctx.destination); src.start();
  });
}

/** Every game sound by kind: parts of guns first (what reloads are made of). */
const SOUND_GROUPS: Array<[string, string[]]> = (() => {
  const all = Object.keys(SOUND_FILES);
  const part = all.filter((n) => n.startsWith('part'));
  const gun = all.filter((n) => !n.startsWith('part') && /shot|reload|rack|pump|chamber|bolt|mag|gun|fire|empty|dry|equip|cock/i.test(n));
  const rest = all.filter((n) => !part.includes(n) && !gun.includes(n));
  return [['Bộ phận súng', part], ['Súng', gun], ['Khác', rest]];
})();
function soundName(n: string): string { return n.replace(/^part/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2'); }
