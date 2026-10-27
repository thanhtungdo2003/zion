'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  CircleGeometry,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  BOOT_COLORS,
  BODY_KEYS,
  DEFAULT_APPEARANCE,
  EntityFlags,
  FACE_KEYS,
  HAIR_COLORS,
  HAIR_STYLES,
  PANTS_COLORS,
  SKIN_TONES,
  TOP_COLORS,
  appearanceHeight,
  randomAppearance,
  type Appearance,
  type BodyKey,
  type FaceKey,
  type HairStyle,
} from '@zion/shared';
import { Avatar } from '@/game/render/avatars';
import { loadPlayerCharacter } from '@/game/render/character-model';
import { SURVIVOR_SIZE } from '@/game/render/human-rig';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

const TABS = [
  { id: 'hair', label: 'Kiểu tóc', icon: 'lucide:scissors' },
  { id: 'outfit', label: 'Trang phục', icon: 'lucide:shirt' },
  { id: 'face', label: 'Khuôn mặt', icon: 'lucide:scan-face' },
  { id: 'body', label: 'Vóc dáng', icon: 'lucide:person-standing' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** The hair pack's styles: how long, and whether tied. */
const HAIR_NAMES: Record<HairStyle, { name: string; note: string }> = {
  hair_01: { name: 'Kiểu 1', note: 'Ngắn' },
  hair_02: { name: 'Kiểu 2', note: 'Ngắn' },
  hair_03: { name: 'Kiểu 3', note: 'Ngang vai · buộc' },
  hair_04: { name: 'Kiểu 4', note: 'Ngắn · buộc' },
  hair_05: { name: 'Kiểu 5', note: 'Ngắn' },
  hair_06: { name: 'Kiểu 6', note: 'Dài · buộc' },
  hair_07: { name: 'Kiểu 7', note: 'Dài' },
  hair_08: { name: 'Kiểu 8', note: 'Ngắn' },
  hair_09: { name: 'Kiểu 9', note: 'Ngang vai' },
  hair_10: { name: 'Kiểu 10', note: 'Ngắn' },
  hair_11: { name: 'Kiểu 11', note: 'Ngang vai' },
  hair_12: { name: 'Kiểu 12', note: 'Ngắn' },
  hair_13: { name: 'Kiểu 13', note: 'Ngắn' },
  hair_14: { name: 'Kiểu 14', note: 'Ngắn' },
  hair_15: { name: 'Kiểu 15', note: 'Ngắn' },
  hair_16: { name: 'Kiểu 16', note: 'Ngang vai · buộc' },
  hair_17: { name: 'Kiểu 17', note: 'Dài' },
  hair_18: { name: 'Kiểu 18', note: 'Dài · buộc' },
  hair_19: { name: 'Kiểu 19', note: 'Ngắn · buộc' },
  hair_20: { name: 'Kiểu 20', note: 'Ngắn' },
  hair_21: { name: 'Kiểu 21', note: 'Ngang vai' },
  hair_22: { name: 'Kiểu 22', note: 'Dài' },
  hair_23: { name: 'Kiểu 23', note: 'Dài · buộc' },
  hair_24: { name: 'Kiểu 24', note: 'Ngắn' },
  hair_25: { name: 'Kiểu 25', note: 'Dài · buộc' },
  hair_26: { name: 'Kiểu 26', note: 'Ngang vai · buộc' },
  hair_27: { name: 'Kiểu 27', note: 'Dài' },
  bald: { name: 'Cạo trọc', note: 'Không tóc' },
};
const FACE_NAMES: Record<FaceKey, [string, string, string]> = {
  head: ['Kích thước đầu', 'Nhỏ', 'Lớn'],
  jaw: ['Độ rộng hàm', 'Thon', 'Vuông'],
  chin: ['Cằm', 'Ngắn', 'Dài'],
  cheeks: ['Gò má', 'Hóp', 'Đầy'],
  nose: ['Mũi', 'Nhỏ', 'To'],
  brow: ['Chân mày', 'Phẳng', 'Nhô'],
  eyes: ['Khoảng cách mắt', 'Gần', 'Xa'],
  ears: ['Tai', 'Nhỏ', 'To'],
};
const BODY_NAMES: Record<BodyKey, [string, string, string]> = {
  build: ['Thể trạng', 'Gầy', 'Đậm'],
  muscle: ['Cơ bắp', 'Mảnh', 'Vạm vỡ'],
  shoulders: ['Bờ vai', 'Hẹp', 'Rộng'],
  waist: ['Vòng eo', 'Thon', 'To'],
  legs: ['Độ dài chân', 'Ngắn', 'Dài'],
};
/** Height of the base survivor (top of the hair), cm. */
const BASE_HEIGHT_CM = 174 * SURVIVOR_SIZE;

interface Props {
  /** First character (no cancel, "save and play") or an edit from the profile. */
  mode: 'first' | 'edit';
  initial: Appearance | null;
  onSave: (look: Appearance) => Promise<void>;
  onClose?: () => void;
}

/**
 * The character creator: the survivor on a turntable beside the choices (haircut and colour,
 * outfit colours, face and body proportions, height), every change shown live on the model.
 * Opens before the first match and from the profile's "Chỉnh sửa nhân vật".
 */
export function CharacterCreator({ mode, initial, onSave, onClose }: Props) {
  const [look, setLook] = useState<Appearance>(initial ?? DEFAULT_APPEARANCE);
  const [tab, setTab] = useState<Tab>('hair');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<Avatar | null>(null);
  const focusRef = useRef<'body' | 'face'>('body');
  const lookRef = useRef(look);
  lookRef.current = look;
  focusRef.current = tab === 'face' || tab === 'hair' ? 'face' : 'body';

  useEffect(() => { avatarRef.current?.setAppearance(look); }, [look]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(28, 1, 0.05, 50);
    scene.add(new AmbientLight(0xffffff, 0.75));
    const key = new DirectionalLight(0xfff2e0, 2.4);
    key.position.set(-2, 3.5, -3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const rim = new DirectionalLight(0xffb000, 1.6);
    rim.position.set(2.5, 2.2, 3);
    scene.add(rim);
    const fill = new DirectionalLight(0xbfd4ff, .6);
    fill.position.set(2.5, 1.5, -2);
    scene.add(fill);
    const floor = new Mesh(new CircleGeometry(2.4, 48), new ShadowMaterial({ opacity: 0.45 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const pad = new Mesh(new CircleGeometry(0.75, 6), new MeshBasicMaterial({ color: 0x1b1d1f }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.002;
    scene.add(pad);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    let yaw = 0.35, drag: number | null = null, idle = 0;
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';
    const down = (e: PointerEvent) => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (drag === null) return; yaw += (e.clientX - drag) * 0.012; drag = e.clientX; idle = 0; };
    const up = () => { drag = null; };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    let avatar: Avatar | null = null;
    void loadPlayerCharacter().then((character) => {
      if (disposed) return;
      avatar = new Avatar(character, true);
      // The editor turns the model like a turntable, in the plain standing pose.
      avatar.rigid = true;
      avatar.setAppearance(lookRef.current);
      avatar.addTo(scene);
      avatarRef.current = avatar;
      setReady(true);
    }).catch(() => { if (!disposed) setError('Không tải được mô hình nhân vật. Hãy thử tải lại trang.'); });

    const eye = new Vector3(0, 1.05, -4.4), target = new Vector3(0, .9, 0);
    const wantEye = new Vector3(), wantTarget = new Vector3();
    let last = performance.now(), t = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now; t += dt; idle += dt;
      // Turns slowly back towards the camera when left alone.
      if (drag === null && idle > 2.5) yaw += (Math.sin(t * .3) * .45 - yaw) * (1 - Math.exp(-dt * .8));
      const s = appearanceHeight(lookRef.current) * SURVIVOR_SIZE;
      if (focusRef.current === 'face') { wantEye.set(.08, 1.6 * s, -1.6); wantTarget.set(0, 1.54 * s, 0); }
      else { wantEye.set(0, 1.0 * s, -4.4); wantTarget.set(0, .88 * s, 0); }
      const k = 1 - Math.exp(-dt * 5);
      eye.lerp(wantEye, k); target.lerp(wantTarget, k);
      camera.position.copy(eye);
      camera.lookAt(target);
      avatar?.update(0, 0, 0, yaw, EntityFlags.Grounded, dt, t);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      avatar?.dispose(scene);
      avatarRef.current = null;
      floor.geometry.dispose(); pad.geometry.dispose();
      (floor.material as ShadowMaterial).dispose(); (pad.material as MeshBasicMaterial).dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, []);

  // Escape closes an edit (never the first character).
  useEffect(() => {
    if (mode !== 'edit' || !onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, onClose, busy]);

  const set = <K extends keyof Appearance>(k: K, v: Appearance[K]) => setLook((l) => ({ ...l, [k]: v }));
  const save = async () => {
    setBusy(true); setError(null);
    try { await onSave(look); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không lưu được nhân vật. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  };
  const heightCm = Math.round(BASE_HEIGHT_CM * appearanceHeight(look));

  const swatches = (palette: readonly string[], value: number, pick: (i: number) => void, label: string) => (
    <div className="cc-swatches" role="radiogroup" aria-label={label}>
      {palette.map((c, i) => (
        <button key={c} type="button" role="radio" aria-checked={value === i} aria-label={c === 'natural' ? `${label} tự nhiên` : `${label} ${i + 1}`} title={c === 'natural' ? 'Màu gốc của kiểu tóc (xám bạc)' : undefined}
          className={`cc-swatch${c === 'natural' ? ' natural' : ''}`} style={c === 'natural' ? undefined : { background: c }} onClick={() => pick(i)} />
      ))}
    </div>
  );
  const slider = (label: [string, string, string], value: number, change: (v: number) => void, id: string) => (
    <label className="cc-slider" key={id}>
      <span className="cc-slider-head"><b>{label[0]}</b><em>{value > 0 ? `+${value}` : value}</em></span>
      <input type="range" min={-100} max={100} step={1} value={value} onChange={(e) => change(Number(e.target.value))} onDoubleClick={() => change(0)} aria-valuetext={`${label[0]} ${value}`} />
      <span className="cc-slider-ends" aria-hidden><small>{label[1]}</small><small>{label[2]}</small></span>
    </label>
  );

  return (
    <div className="cc-overlay" role="dialog" aria-modal="true" aria-labelledby="cc-title">
      <div className="cc-stage" ref={stage}>
        {!ready && !error && <div className="cc-loading"><Spinner /> Đang tải nhân vật…</div>}
        <div className="cc-stage-hint" aria-hidden><Icon name="lucide:move-horizontal" /> Kéo để xoay</div>
        <div className="cc-stage-height"><small>Chiều cao</small><b>{heightCm} cm</b></div>
      </div>
      <section className="cc-panel">
        <header className="cc-head">
          <span className="overlay-kicker">ZION // Hồ sơ nhân vật</span>
          <h2 id="cc-title">{mode === 'first' ? 'Tạo nhân vật' : 'Chỉnh sửa nhân vật'}</h2>
          <p>{mode === 'first' ? 'Chọn diện mạo người sống sót của bạn. Bạn có thể chỉnh lại bất cứ lúc nào trong hồ sơ.' : 'Thay đổi áp dụng từ trận tiếp theo và mọi người chơi khác đều thấy.'}</p>
        </header>
        <div className="tabs cc-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} /> <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="cc-body" role="tabpanel">
          {tab === 'hair' && <>
            <h3>Kiểu tóc</h3>
            <div className="cc-options">
              {HAIR_STYLES.map((h) => (
                <button key={h} type="button" className="cc-option" aria-pressed={look.hair === h} onClick={() => set('hair', h)}>
                  <b>{HAIR_NAMES[h].name}</b><small>{HAIR_NAMES[h].note}</small>
                </button>
              ))}
            </div>
            <h3>Màu tóc</h3>
            {swatches(HAIR_COLORS, look.hairColor, (i) => set('hairColor', i), 'Màu tóc')}
          </>}
          {tab === 'outfit' && <>
            <h3>Áo</h3>
            <div className="cc-options cc-options-2">
              <button type="button" className="cc-option" aria-pressed={look.top === 'tank_top'} onClick={() => set('top', 'tank_top')}><b>Áo ba lỗ</b><small>Cotton gân, dây bản rộng</small></button>
              <button type="button" className="cc-option" aria-pressed={look.top === 'none'} onClick={() => set('top', 'none')}><b>Cởi trần</b><small>Không mặc áo</small></button>
            </div>
            {look.top !== 'none' && swatches(TOP_COLORS, look.topColor, (i) => set('topColor', i), 'Màu áo')}
            <h3>Quần leo núi kaki</h3>
            {swatches(PANTS_COLORS, look.pantsColor, (i) => set('pantsColor', i), 'Màu quần')}
            <h3>Giày leo núi</h3>
            {swatches(BOOT_COLORS, look.bootsColor, (i) => set('bootsColor', i), 'Màu giày')}
            <label className="cc-check"><input type="checkbox" checked={look.belt} onChange={(e) => set('belt', e.target.checked)} /> Thắt lưng vải canvas</label>
          </>}
          {tab === 'face' && <>
            <h3>Màu da</h3>
            {swatches(SKIN_TONES, look.skin, (i) => set('skin', i), 'Màu da')}
            <h3>Tỷ lệ khuôn mặt</h3>
            {FACE_KEYS.map((k) => slider(FACE_NAMES[k], look.face[k], (v) => setLook((l) => ({ ...l, face: { ...l.face, [k]: v } })), k))}
          </>}
          {tab === 'body' && <>
            <h3>Chiều cao</h3>
            {slider(['Chiều cao', `${Math.round(BASE_HEIGHT_CM * appearanceHeight({ ...look, height: -100 }))} cm`, `${Math.round(BASE_HEIGHT_CM * appearanceHeight({ ...look, height: 100 }))} cm`], look.height, (v) => set('height', v), 'height')}
            <h3>Vóc dáng</h3>
            {BODY_KEYS.map((k) => slider(BODY_NAMES[k], look.body[k], (v) => setLook((l) => ({ ...l, body: { ...l.body, [k]: v } })), k))}
          </>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <footer className="cc-foot">
          <div className="cc-foot-tools">
            <button type="button" className="btn" disabled={busy} onClick={() => setLook(randomAppearance((Math.random() * 0x7fffffff) | 0))}><Icon name="lucide:dices" /> Ngẫu nhiên</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setLook(initial ?? DEFAULT_APPEARANCE)}><Icon name="lucide:rotate-ccw" /> Đặt lại</button>
          </div>
          <div className="cc-foot-main">
            {mode === 'edit' && onClose && <button type="button" className="btn" disabled={busy} onClick={onClose}>Huỷ</button>}
            <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={() => { void save(); }}>
              {busy ? <Spinner /> : <><Icon name="lucide:check" /> {mode === 'first' ? 'Lưu & vào trận' : 'Lưu thay đổi'}</>}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
