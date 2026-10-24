'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AmbientLight, ArrowHelper, Box3, Color, DirectionalLight, GridHelper, Group, Matrix4, Mesh, PlaneGeometry, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene, SphereGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ATTACHMENTS, CUSTOM_GUN_SOUNDS, ITEMS, WEAPON_BY_ITEM, builtinWeaponDraft, builtinWeaponIds, customWeaponSchema, type CustomWeapon } from '@zion/shared';
import Link from 'next/link';
import { ConfirmDialog } from './ConfirmDialog';
import { API_URL, studioDeleteWeapon, studioResetWeapons, studioLogin, studioSaveWeapon, studioWeapons, type StudioWeapon } from '@/lib/api';
import { builtinRecoilDegrees } from '@/game/first-person-recoil';
import { BB_UNITS_PER_METER, loadPlayerCharacter, type CharacterTemplate } from '@/game/render/character-model';
import { builtinWeaponVisual, loadWeaponModel, previewAttachment, standaloneVisual, type WeaponSpec } from '@/game/render/weapons';
import { ViewModel } from '@/game/render/viewmodel';
import { scopeFov } from '@/game/scope';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

type Vec3 = [number, number, number];
type Draft = Omit<CustomWeapon, 'weaponId'> & { weaponId?: number };
type PointKey = 'grip' | 'support' | 'muzzle' | 'eject' | 'rail' | 'sightRear' | 'sightFront' | 'strikePoint';

const AXES: Record<string, Vec3> = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };
const axisName = (v: Vec3) => Object.entries(AXES).find(([, a]) => a.every((c, i) => Math.abs(c - v[i]!) < 1e-6))?.[0] ?? '+X';
const POINTS: Record<PointKey, { label: string; color: number; gun: boolean; melee: boolean }> = {
  grip: { label: 'Tay cầm (tay phải)', color: 0x4aa8ff, gun: true, melee: true },
  support: { label: 'Tay đỡ (tay trái)', color: 0x7fd36b, gun: true, melee: true },
  muzzle: { label: 'Đầu nòng', color: 0xff5a3c, gun: true, melee: false },
  eject: { label: 'Cửa nhả vỏ đạn', color: 0xd9a93a, gun: true, melee: false },
  rail: { label: 'Ngàm ống ngắm', color: 0xc77dff, gun: true, melee: false },
  sightRear: { label: 'Thước ngắm sau', color: 0xffffff, gun: true, melee: false },
  sightFront: { label: 'Thước ngắm trước', color: 0xffe066, gun: true, melee: false },
  strikePoint: { label: 'Điểm chém / đập', color: 0xff5a3c, gun: false, melee: true },
};
const OPTICS = Object.values(ATTACHMENTS).filter((a) => a.slot === 'optic').map((a) => a.id);
const MUZZLES = Object.values(ATTACHMENTS).filter((a) => a.slot === 'muzzle').map((a) => a.id);
const AMMO = Object.values(ITEMS).filter((d) => d.ammo).map((d) => d.id);

/**
 * Fitting data embedded in a `.bbmodel` by ModelGen Gun Studio (`zion_weapon`): barrel/up axes,
 * hand and attachment points (in the file's Blockbench pixels) and the real length. Without it
 * a new model starts with the default axes and must be oriented by hand.
 */
async function modelHints(file: File): Promise<Partial<Draft['model']> | null> {
  if (!file.name.toLowerCase().endsWith('.bbmodel')) return null;
  try {
    const raw = (JSON.parse(await file.text()) as { zion_weapon?: Record<string, unknown> }).zion_weapon;
    if (!raw || typeof raw !== 'object') return null;
    const vec = (v: unknown): Vec3 | undefined =>
      Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1], v[2]] as Vec3 : undefined;
    const hints: Partial<Draft['model']> = {};
    const length = raw.length;
    if (typeof length === 'number' && length >= .1 && length <= 3) hints.length = length;
    for (const key of ['barrel', 'up', 'grip', 'support', 'muzzle', 'eject', 'rail'] as const) {
      const v = vec(raw[key]);
      if (v) hints[key] = v;
    }
    const sight = raw.sight as { rear?: unknown; front?: unknown } | undefined;
    const rear = vec(sight?.rear), front = vec(sight?.front);
    if (rear && front) hints.sight = { rear, front };
    return hints.barrel && hints.up ? hints : null;
  } catch {
    return null;
  }
}

function blankDraft(kind: 'gun' | 'melee' | 'throw', format: 'glb' | 'bbmodel'): Draft {
  return {
    id: `cw_${Math.random().toString(36).slice(2, 8)}`, name: kind === 'gun' ? 'Súng mới' : kind === 'throw' ? 'Lựu đạn mới' : 'Vũ khí cận chiến mới', info: '', kind, format,
    item: { category: kind === 'gun' ? 'rifle' : kind === 'throw' ? 'grenade' : 'melee', w: kind === 'gun' ? 5 : kind === 'throw' ? 1 : 4, h: kind === 'gun' ? 2 : 1, color: '#5a5a52' },
    model: { length: kind === 'gun' ? .9 : kind === 'throw' ? .14 : .8, barrel: [1, 0, 0], up: [0, 1, 0], grip: [0, 0, 0] },
    ...(kind === 'gun'
      ? { gun: { damage: 14, pellets: 1, fireMs: 100, spread: .025, range: 70, magazine: 30, reloadMs: 2300, auto: true, weight: 3.5, recoil: 1, ammo: 'ammo_556', sound: 'rifleShot' as const, optics: [], muzzleDevices: [] } }
      : kind === 'throw'
      ? { throw: { damage: 120, radius: 7, fuseMs: 2600, cooldownMs: 1100, maxRange: 22, weight: .4, effect: 'frag' as const, effectMs: 0 } }
      : { melee: { damage: 40, range: 2.6, cooldownMs: 700, swingMs: 380, weight: 1.6 } }),
    price: 500, lootable: false,
  };
}

/** A row of the weapon manager: a built-in (maybe edited) or a Studio-made weapon. */
interface Entry { draft: Draft; builtin: boolean; edited: boolean; modelUrl: string }

/** Built-in weapons as editable drafts, from the shared stats and the client's visual table. */
function builtinEntries(saved: Map<string, StudioWeapon>): Entry[] {
  return builtinWeaponIds().flatMap((id) => {
    const v = builtinWeaponVisual(id);
    if (!v) return [];
    const model: Draft['model'] = {
      base: v.url, length: v.length, barrel: v.barrel, up: v.up, grip: v.grip,
      ...(v.support ? { support: v.support } : {}), ...(v.muzzle ? { muzzle: v.muzzle } : {}), ...(v.eject ? { eject: v.eject } : {}),
      ...(v.sight ? { sight: v.sight } : {}), ...(v.rail ? { rail: v.rail } : {}), ...(v.edge ? { edge: v.edge } : {}), ...(v.strikePoint ? { strikePoint: v.strikePoint } : {}),
      ...(v.fpHip ? { fpHip: v.fpHip } : {}), ...(v.fpEyeRelief ? { fpEyeRelief: v.fpEyeRelief } : {}),
      ...(v.fpSupport ? { fpSupport: v.fpSupport } : {}), ...(v.fpRot ? { fpRot: v.fpRot } : {}), ...(v.opticScale ? { opticScale: v.opticScale } : {}), ...(v.muzzleScale ? { muzzleScale: v.muzzleScale } : {}), ...(v.attachmentScale ? { attachmentScale: v.attachmentScale } : {}), ...(v.attachmentOffset ? { attachmentOffset: v.attachmentOffset } : {}),
    };
    const format = v.url.split('?')[0]!.endsWith('.glb') ? 'glb' : 'bbmodel';
    const shipped = builtinWeaponDraft(id, model, format, builtinRecoilDegrees(WEAPON_BY_ITEM[id] ?? 0));
    if (!shipped) return [];
    const edit = saved.get(id);
    // An edit made for an older shipped model keeps its stats; the points start from the new model.
    // (Edits saved before the Studio recorded the model they were made for are for the current one.)
    if (edit && edit.model.base !== undefined && edit.model.base !== v.url) return [{ draft: { ...edit, model, format }, builtin: true, edited: true, modelUrl: v.url }];
    return [{ draft: edit ?? shipped, builtin: true, edited: !!edit, modelUrl: edit?.modelUrl ? `${API_URL}${edit.modelUrl}` : v.url }];
  });
}

/**
 * Weapon manager page (/studio/weapons): every weapon in the game — the built-in arsenal (edits
 * are saved as overrides, "restore" returns to the shipped values) and the ones made here from an
 * uploaded GLB / Blockbench model.
 */
export function WeaponManagerPage() {
  const [resetting, setResetting] = useState<{ all: boolean; id?: string; name?: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [saved, setSaved] = useState<StudioWeapon[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'locked' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'builtin' | 'custom' | 'grenade'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ draft: Draft; file: File } | null>(null);
  const [creating, setCreating] = useState(false);
  const [password, setPassword] = useState('');
  const refresh = () => studioWeapons().then((r) => { setSaved(r.weapons); setStatus('ready'); }).catch((e: unknown) => {
    const code = (e as { status?: number }).status;
    if (code === 401 || code === 403) setStatus('locked'); else { setStatus('error'); setError(e instanceof Error ? e.message : 'Không tải được danh sách vũ khí.'); }
  });
  useEffect(() => { void refresh(); }, []);
  const entries = useMemo<Entry[]>(() => {
    if (!saved) return [];
    const map = new Map(saved.map((w) => [w.id, w]));
    const custom = saved.filter((w) => w.id.startsWith('cw_')).map((w) => ({ draft: w as Draft, builtin: false, edited: true, modelUrl: `${API_URL}${w.modelUrl}` }));
    return [...builtinEntries(map), ...custom];
  }, [saved]);
  const shown = entries.filter((e) => (filter === 'all' || (filter === 'grenade' ? e.draft.kind === 'throw' : (filter === 'builtin') === e.builtin)) && (!search || `${e.draft.name} ${e.draft.id}`.toLowerCase().includes(search.toLowerCase())));
  const current = fresh ? null : entries.find((e) => e.draft.id === selected) ?? null;
  if (status === 'locked') return (
    <div className="studio-root studio-gate"><div className="overlay-card"><h2>Quản lý vũ khí</h2>
      <form className="studio-unlock" onSubmit={(e) => { e.preventDefault(); void studioLogin(password).then(() => { setStatus('loading'); return refresh(); }).catch(() => setError('Sai mật khẩu xưởng.')); }}>
        <p>Nhập mật khẩu xưởng để quản lý vũ khí.</p>
        <input type="password" autoFocus placeholder="Mật khẩu xưởng" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={!password}>Vào</button>
      </form></div></div>
  );
  return (
    <div className="ws-page">
      <header className="studio-bar ws-bar">
        <Link href="/studio" className="studio-back" title="Về Xưởng căn cứ"><Icon name="lucide:arrow-left" /></Link>
        <h1>Quản lý vũ khí</h1>
        <div className="ws-tabs">{(['all', 'builtin', 'custom', 'grenade'] as const).map((f) => <button key={f} className={`btn${filter === f ? ' btn-primary' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? 'Tất cả' : f === 'builtin' ? 'Có sẵn' : f === 'custom' ? 'Tự tạo' : 'Lựu đạn'}</button>)}</div>
        <input className="ws-search" placeholder="Tìm vũ khí…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="lucide:plus" /> Thêm vũ khí</button>
        <button className="btn ws-reset" title="Đưa mọi vũ khí có sẵn về mặc định" onClick={() => setResetting({ all: true })}><Icon name="lucide:rotate-ccw" /> Reset mặc định</button>
      </header>
      {resetting && <ConfirmDialog password title={resetting.all ? 'Reset tất cả về mặc định?' : `Reset ${resetting.name} về mặc định?`}
        message={resetting.all ? 'Mọi chỉnh sửa trên các vũ khí có sẵn (thông số, model, điểm gắn, góc nhìn thứ nhất) sẽ bị xóa. Vũ khí tự tạo giữ nguyên. Nhập mật khẩu Studio để xác nhận.' : 'Mọi chỉnh sửa của vũ khí này sẽ bị xóa. Nhập mật khẩu Studio để xác nhận.'}
        confirmLabel="Reset" onCancel={() => setResetting(null)}
        onConfirm={async (pw) => { await studioResetWeapons(pw, resetting.all ? undefined : resetting.id); setResetting(null); await refresh(); }} />}
      {deleting && <ConfirmDialog title={`Xóa ${deleting.name}?`} message="Xóa vĩnh viễn vũ khí tự tạo này. Người chơi đang có món này sẽ mất nó." confirmLabel="Xóa" onCancel={() => setDeleting(null)}
        onConfirm={async () => { await studioDeleteWeapon(deleting.id); setDeleting(null); setSelected(null); await refresh(); }} />}
      {status === 'error' && <p className="error">{error}</p>}
      <div className="ws-layout">
        <nav className="ws-list" aria-label="Danh sách vũ khí">
          {status === 'loading' && <Spinner />}
          {shown.map((e) => <button key={e.draft.id} className={`ws-item${selected === e.draft.id && !fresh ? ' on' : ''}`} onClick={() => { setFresh(null); setSelected(e.draft.id); }}>
            <Icon name={e.draft.kind === 'gun' ? 'game-icons:pistol-gun' : e.draft.kind === 'throw' ? 'game-icons:grenade' : 'game-icons:broadsword'} />
            <span><b>{e.draft.name}</b><small>{e.draft.id}{e.draft.gun ? ` · ${e.draft.gun.damage}${e.draft.gun.pellets > 1 ? `×${e.draft.gun.pellets}` : ''} st · ${e.draft.gun.fireMs} ms` : e.draft.melee ? ` · ${e.draft.melee.damage} st` : ''}</small></span>
            {e.builtin ? (e.edited ? <em className="ws-badge edited">Đã sửa</em> : <em className="ws-badge">Có sẵn</em>) : <em className="ws-badge custom">Tự tạo</em>}
          </button>)}
          {status === 'ready' && !shown.length && <p className="studio-muted">Không có vũ khí nào khớp.</p>}
        </nav>
        <main className="ws-main">
          {fresh ? <WeaponEditor key={fresh.draft.id} initial={fresh.draft} file={fresh.file} modelUrl={null} builtin={false} onClose={(ok) => { setFresh(null); if (ok) { setSelected(fresh.draft.id); void refresh(); } }} />
            : current ? <WeaponEditor key={`${current.draft.id}:${current.edited}`} initial={current.draft} file={null} modelUrl={current.modelUrl} builtin={current.builtin}
              onClose={(ok) => { if (ok) void refresh(); }}
              onRemove={current.builtin && !current.edited ? undefined : () => {
                if (current.builtin) setResetting({ all: false, id: current.draft.id, name: current.draft.name });
                else setDeleting({ id: current.draft.id, name: current.draft.name });
              }} />
              : <div className="ws-empty"><Icon name="game-icons:pistol-gun" /><p>Chọn một vũ khí bên trái để chỉnh, hoặc “Thêm vũ khí” để tải model mới lên.</p>
                <p className="studio-muted">Thay đổi áp dụng ngay trên máy chủ; người chơi đang trong trận cần tải lại trang để thấy model và góc nhìn mới.</p></div>}
        </main>
      </div>
      {creating && <NewWeaponDialog onCancel={() => setCreating(false)} onPick={(kind, file) => {
        setCreating(false);
        void modelHints(file).then((hints) => {
          const draft = blankDraft(kind, file.name.toLowerCase().endsWith('.glb') ? 'glb' : 'bbmodel');
          setFresh({ draft: hints ? { ...draft, model: { ...draft.model, ...hints } } : draft, file });
        });
      }} />}
    </div>
  );
}

/** Step 1: the model file and whether it is a gun or a melee weapon. */
function NewWeaponDialog({ onPick, onCancel }: { onPick: (kind: 'gun' | 'melee' | 'throw', file: File) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<'gun' | 'melee' | 'throw'>('gun');
  const [file, setFile] = useState<File | null>(null);
  return (
    <div className="studio-modal-backdrop">
      <form className="overlay-card studio-modal studio-form" onSubmit={(e) => { e.preventDefault(); if (file) onPick(kind, file); }}>
        <h2>Thêm vũ khí</h2>
        <div className="ws-kind">
          {(['gun', 'melee', 'throw'] as const).map((k) => <label key={k} className={kind === k ? 'on' : ''}><input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
            <Icon name={k === 'gun' ? 'game-icons:pistol-gun' : k === 'throw' ? 'game-icons:grenade' : 'game-icons:broadsword'} /><b>{k === 'gun' ? 'Tầm xa' : k === 'throw' ? 'Lựu đạn' : 'Cận chiến'}</b><small>{k === 'gun' ? 'Súng: sát thương, tốc độ bắn, băng đạn, độ giật, phụ kiện…' : k === 'throw' ? 'Nổ, choáng hoặc khói: ngòi nổ, bán kính, tầm ném…' : 'Dao, rìu, gậy: sát thương, tầm với, tốc độ vung…'}</small></label>)}
        </div>
        <label className="studio-field"><span>File model (.glb hoặc .bbmodel, tối đa 8 MB)</span>
          <input type="file" accept=".glb,.bbmodel" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        {file && file.size > 8 * 1024 * 1024 && <p className="error">File lớn hơn 8 MB.</p>}
        <div className="overlay-row"><button type="button" className="btn" onClick={onCancel}>Hủy</button>
          <button className="btn btn-primary" disabled={!file || file.size > 8 * 1024 * 1024}>Tiếp tục</button></div>
      </form>
    </div>
  );
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Spec for the in-game visual from the draft (what `registerWeaponVisual` will get). */
function visualSpec(d: Draft, url: string): WeaponSpec {
  const m = d.model;
  return {
    url, format: d.format, length: m.length, barrel: m.barrel, up: m.up, grip: m.grip,
    ...(m.support ? { support: m.support } : {}), ...(m.muzzle ? { muzzle: m.muzzle } : {}), ...(m.eject ? { eject: m.eject } : {}),
    ...(m.sight ? { sight: m.sight } : {}), ...(m.rail ? { rail: m.rail } : {}), ...(m.edge ? { edge: m.edge } : {}), ...(m.strikePoint ? { strikePoint: m.strikePoint } : {}),
    ...(m.fpHip ? { fpHip: m.fpHip } : {}), ...(m.fpSupport ? { fpSupport: m.fpSupport } : {}), ...(m.fpRot ? { fpRot: m.fpRot } : {}), ...(m.opticScale ? { opticScale: m.opticScale } : {}), ...(m.muzzleScale ? { muzzleScale: m.muzzleScale } : {}), ...(m.attachmentScale ? { attachmentScale: m.attachmentScale } : {}), ...(m.attachmentOffset ? { attachmentOffset: m.attachmentOffset } : {}),
    // The preview has no item entry: give handguns their usual longer eye relief explicitly.
    fpEyeRelief: m.fpEyeRelief ?? (d.item.category === 'pistol' ? .4 : .3),
  };
}

/** Step 2: 3D model with its hand / attachment points, stats, and the first-person view. */
function WeaponEditor({ initial, file: initialFile, modelUrl, builtin, onClose, onRemove }: { initial: Draft; file: File | null; modelUrl: string | null; builtin: boolean; onClose: (saved: boolean) => void; onRemove?: () => void }) {
  // A new file replaces the model (kept until saved); the points may need placing again.
  const [file, setFile] = useState<File | null>(initialFile);
  const [d, setD] = useState<Draft>(initial);
  const [picking, setPicking] = useState<PointKey | null>('grip');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'model' | 'stats' | 'view'>('model');
  const [savedAt, setSavedAt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  /** Attachments shown on the model while editing (preview only). */
  const [shown, setShown] = useState<{ optic: string; muzzle: string }>({ optic: initial.gun?.optics[0] ?? '', muzzle: initial.gun?.muzzleDevices[0] ?? '' });
  // A picked file is read through an object URL created and revoked by the same effect, so React's
  // dev double-mount never leaves the viewers with an already revoked URL.
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setFileUrl(null); return; }
    const u = URL.createObjectURL(file);
    setFileUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const url = file ? fileUrl : modelUrl;
  const set = (patch: Partial<Draft>) => setD((v) => ({ ...v, ...patch }));
  const setModel = (patch: Partial<Draft['model']>) => setD((v) => ({ ...v, model: { ...v.model, ...patch } }));
  const setGun = (patch: Partial<NonNullable<Draft['gun']>>) => setD((v) => ({ ...v, gun: { ...v.gun!, ...patch } }));
  const setMelee = (patch: Partial<NonNullable<Draft['melee']>>) => setD((v) => ({ ...v, melee: { ...v.melee!, ...patch } }));
  const setThrow = (patch: Partial<NonNullable<Draft['throw']>>) => setD((v) => ({ ...v, throw: { ...v.throw!, ...patch } }));
  const point = (k: PointKey): Vec3 | undefined => k === 'sightRear' ? d.model.sight?.rear : k === 'sightFront' ? d.model.sight?.front : d.model[k];
  const setPoint = (k: PointKey, p: Vec3 | undefined) => {
    if (k === 'sightRear' || k === 'sightFront') {
      const sight = { rear: d.model.sight?.rear ?? p!, front: d.model.sight?.front ?? p!, [k === 'sightRear' ? 'rear' : 'front']: p };
      setModel({ sight: p ? sight as { rear: Vec3; front: Vec3 } : undefined });
    } else setModel({ [k]: p } as Partial<Draft['model']>);
  };
  const keys = (Object.keys(POINTS) as PointKey[]).filter((k) => POINTS[k][d.kind === 'throw' ? 'melee' : d.kind]);
  const save = async () => {
    setBusy(true); setError(null);
    // Listing fields (where the model is served) are not part of the definition.
    const { modelUrl: _url, ...def } = d as Draft & { modelUrl?: unknown };
    const check = customWeaponSchema.safeParse({ ...def, weaponId: def.weaponId ?? 100 });
    if (!check.success) { setError(check.error.issues.map((i) => `${i.path.join('.') || 'Vũ khí'}: ${i.message}`).join(' · ')); setBusy(false); return; }
    try { await studioSaveWeapon(def, file ? await readBase64(file) : undefined); setSavedAt(Date.now()); onClose(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không lưu được.'); }
    setBusy(false);
  };
  const num = (label: string, value: number, on: (v: number) => void, step = 1, min?: number, max?: number) =>
    <label className="studio-field-inline"><span>{label}</span><input type="number" step={step} min={min} max={max} value={value} onChange={(e) => on(Number(e.target.value))} /></label>;
  return (
    <div className="ws-editor">
        <header className="ws-head">
          <h2>{d.kind === 'gun' ? 'Tầm xa' : 'Cận chiến'}{builtin ? ' · có sẵn' : ''} · <input className="ws-name" value={d.name} onChange={(e) => set({ name: e.target.value })} aria-label="Tên vũ khí" /></h2>
          <div className="ws-tabs">{(['model', 'stats', 'view'] as const).map((t) => <button key={t} className={`btn${tab === t ? ' btn-primary' : ''}`} onClick={() => setTab(t)}>{t === 'model' ? 'Model & điểm gắn' : t === 'stats' ? 'Chỉ số' : 'Góc nhìn thứ nhất'}</button>)}</div>
          <label className="btn ws-swap" title="Thay model bằng một file GLB / Blockbench khác">
            <Icon name="lucide:replace" /> Đổi model
            <input type="file" accept=".glb,.bbmodel" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > 8 * 1024 * 1024) { setError('File lớn hơn 8 MB.'); return; }
              setFile(f); set({ format: f.name.toLowerCase().endsWith('.glb') ? 'glb' : 'bbmodel' }); setTab('model');
              setError(null); setNotice(`Đã chọn ${f.name}: kiểm tra lại hướng nòng và các điểm gắn rồi bấm Lưu.`);
              // Per-attachment offsets were tuned in the OLD model's units and axes (on one file Y is the
              // barrel, on the next it may be up): carried over, they lift or sink every optic. Start clean.
              if (d.model.attachmentOffset) setModel({ attachmentOffset: undefined });
              void modelHints(f).then((hints) => {
                if (!hints) return;
                setModel({ ...hints, attachmentOffset: undefined });
                setNotice(`Đã chọn ${f.name}: hướng nòng, hướng lên và các điểm gắn được lấy từ file (Gun Studio). Kiểm tra lại rồi bấm Lưu.`);
              });
            }} />
          </label>
          {onRemove && <button className={`btn ${builtin ? 'ws-reset' : 'btn-danger'}`} onClick={onRemove} disabled={busy}><Icon name={builtin ? 'lucide:rotate-ccw' : 'lucide:trash-2'} /> {builtin ? 'Reset mặc định' : 'Xóa'}</button>}
          {!builtin && !modelUrl && <button className="btn" onClick={() => onClose(false)} disabled={busy}>Hủy</button>}
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>{busy ? <Spinner /> : <><Icon name="lucide:save" /> Lưu</>}</button>
          {savedAt > 0 && !busy && <span className="studio-badge">Đã lưu</span>}
        </header>
        {error && <p className="error ws-error">{error}</p>}
        {notice && !error && <p className="studio-muted ws-error">{notice}</p>}
        <div className="ws-body">
          {tab === 'model' && <>
            {url ? <PointEditor key={url} url={url} format={d.format} draft={d} previews={d.gun ? [shown.optic, shown.muzzle].filter((a) => a && (a === shown.optic ? d.gun!.optics : d.gun!.muzzleDevices).includes(a)) : []} picking={picking} onPick={(p) => { if (picking) setPoint(picking, p); }} /> : <div className="ws-viewer"><div className="ws-viewer-state"><Spinner /> Đang đọc file…</div></div>}
            <aside className="ws-side studio-form">
              <p className="studio-muted">Chọn một điểm bên dưới rồi nhấp lên model để đặt. Trục: hướng nòng (về phía mục tiêu) và hướng lên trên của model.</p>
              <div className="ws-axes">
                <label className="studio-field-inline"><span>Hướng nòng</span><select value={axisName(d.model.barrel)} onChange={(e) => setModel({ barrel: AXES[e.target.value]! })}>{Object.keys(AXES).map((a) => <option key={a}>{a}</option>)}</select></label>
                <label className="studio-field-inline"><span>Hướng lên</span><select value={axisName(d.model.up)} onChange={(e) => setModel({ up: AXES[e.target.value]! })}>{Object.keys(AXES).map((a) => <option key={a}>{a}</option>)}</select></label>
                {num('Chiều dài thật (m)', d.model.length, (v) => setModel({ length: v }), .01, .1, 3)}
              </div>
              <ul className="ws-points">
                {keys.map((k) => {
                  const p = point(k);
                  return <li key={k} className={picking === k ? 'on' : ''}>
                    <button type="button" onClick={() => setPicking(k)}><i style={{ background: `#${POINTS[k].color.toString(16).padStart(6, '0')}` }} />{POINTS[k].label}</button>
                    <span className="ws-xyz">{[0, 1, 2].map((i) => <input key={i} type="number" step={d.format === 'glb' ? .01 : .25} aria-label={`${POINTS[k].label} ${'xyz'[i]}`} placeholder={'xyz'[i]}
                      value={p ? +p[i]!.toFixed(3) : ''} onFocus={() => setPicking(k)}
                      onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v)) return; const next: Vec3 = p ? [...p] : [0, 0, 0]; next[i] = v; setPoint(k, next); }} />)}</span>
                    {p && k !== 'grip' && <button type="button" className="ws-clear" title="Bỏ điểm này" onClick={() => setPoint(k, undefined)}><Icon name="lucide:x" /></button>}
                    {d.gun && (k === 'rail' || k === 'muzzle') && <AttachmentPicker slot={k === 'rail' ? 'optic' : 'muzzle'} chosen={k === 'rail' ? d.gun.optics : d.gun.muzzleDevices} mounted={!!p}
                      onChange={(list) => setGun(k === 'rail' ? { optics: list } : { muzzleDevices: list })}
                      shown={k === 'rail' ? shown.optic : shown.muzzle} onShow={(a) => setShown((v) => ({ ...v, [k === 'rail' ? 'optic' : 'muzzle']: a }))}
                      slotScale={(k === 'rail' ? d.model.opticScale : d.model.muzzleScale) ?? 1} onSlotScale={(v) => setModel(k === 'rail' ? { opticScale: v === 1 ? undefined : v } : { muzzleScale: v === 1 ? undefined : v })}
                      partScale={d.model.attachmentScale ?? {}} onPartScale={(id, v) => { const next = { ...d.model.attachmentScale }; if (v === undefined) delete next[id]; else next[id] = v; setModel({ attachmentScale: Object.keys(next).length ? next : undefined }); }}
                      step={d.format === 'glb' ? .005 : .05} partOffset={d.model.attachmentOffset ?? {}} onPartOffset={(id, v) => { const next = { ...d.model.attachmentOffset }; if (v === undefined) delete next[id]; else next[id] = v; setModel({ attachmentOffset: Object.keys(next).length ? next : undefined }); }} />}
                  </li>;
                })}
              </ul>
              {d.kind === 'melee' && <label className="studio-field-inline"><span>Hướng lưỡi</span><select value={d.model.edge ? axisName(d.model.edge) : ''} onChange={(e) => setModel({ edge: e.target.value ? AXES[e.target.value] : undefined })}><option value="">—</option>{Object.keys(AXES).map((a) => <option key={a}>{a}</option>)}</select></label>}
            </aside>
          </>}
          {tab === 'stats' && <div className="ws-stats studio-form">
            <fieldset><legend>Vật phẩm</legend>
              <label className="studio-field"><span>Mô tả ngắn</span><input value={d.info} maxLength={120} onChange={(e) => set({ info: e.target.value })} /></label>
              <label className="studio-field-inline"><span>Loại</span><select value={d.item.category} onChange={(e) => set({ item: { ...d.item, category: e.target.value as Draft['item']['category'] } })}>
                {(d.kind === 'gun' ? ['pistol', 'smg', 'rifle', 'shotgun', 'heavy'] : ['melee']).map((c) => <option key={c} value={c}>{({ pistol: 'Súng ngắn', smg: 'Tiểu liên', rifle: 'Súng trường', shotgun: 'Shotgun', heavy: 'Hạng nặng', melee: 'Cận chiến' } as Record<string, string>)[c]}</option>)}</select></label>
              {num('Ô rộng', d.item.w, (v) => set({ item: { ...d.item, w: v } }), 1, 1, 8)}
              {num('Ô cao', d.item.h, (v) => set({ item: { ...d.item, h: v } }), 1, 1, 3)}
              <label className="studio-field-inline"><span>Màu ô</span><input type="color" value={d.item.color} onChange={(e) => set({ item: { ...d.item, color: e.target.value } })} /></label>
              {num('Giá (ZC)', d.price, (v) => set({ price: v }), 10, 0)}
              <label className="studio-field-inline"><span>Rơi trong rương</span><input type="checkbox" checked={d.lootable} onChange={(e) => set({ lootable: e.target.checked })} /></label>
            </fieldset>
            {d.gun && <fieldset><legend>Bắn</legend>
              {num('Sát thương / viên', d.gun.damage, (v) => setGun({ damage: v }), 1, 1, 300)}
              {num('Số viên mỗi phát', d.gun.pellets, (v) => setGun({ pellets: v }), 1, 1, 16)}
              {num('Thời gian giữa 2 phát (ms)', d.gun.fireMs, (v) => setGun({ fireMs: v }), 5, 40, 4000)}
              <label className="studio-field-inline"><span>Bắn liên thanh</span><input type="checkbox" checked={d.gun.auto} onChange={(e) => setGun({ auto: e.target.checked })} /></label>
              {num('Độ tản (rad)', d.gun.spread, (v) => setGun({ spread: v }), .001, 0, .4)}
              {num('Độ giật (độ)', d.gun.recoil, (v) => setGun({ recoil: v }), .05, 0, 8)}
              {num('Tầm bắn (m)', d.gun.range, (v) => setGun({ range: v }), 1, 5, 250)}
              {num('Băng đạn', d.gun.magazine, (v) => setGun({ magazine: v }), 1, 1, 200)}
              {num('Thay đạn (ms)', d.gun.reloadMs, (v) => setGun({ reloadMs: v }), 50, 300, 8000)}
              {num('Nặng (kg)', d.gun.weight, (v) => setGun({ weight: v }), .1, .2, 20)}
              <label className="studio-field-inline"><span>Hộp đạn</span><select value={d.gun.ammo} onChange={(e) => setGun({ ammo: e.target.value })}>{AMMO.map((a) => <option key={a} value={a}>{ITEMS[a]!.name}</option>)}</select></label>
              <label className="studio-field-inline"><span>Tiếng súng</span><select value={d.gun.sound} onChange={(e) => setGun({ sound: e.target.value as NonNullable<Draft['gun']>['sound'] })}>{CUSTOM_GUN_SOUNDS.map((s) => <option key={s}>{s}</option>)}</select></label>
              <p className="ws-dps">≈ {Math.round(d.gun.damage * d.gun.pellets * 1000 / d.gun.fireMs)} sát thương/giây · hạ 100 máu sau {Math.max(0, Math.ceil(100 / (d.gun.damage * d.gun.pellets)) - 1) * d.gun.fireMs} ms</p>
            </fieldset>}
            {d.gun && <fieldset><legend>Phụ kiện lắp được</legend>
              <div className="ws-checks">{[...OPTICS, ...MUZZLES].map((a) => {
                const list = ATTACHMENTS[a]!.slot === 'optic' ? d.gun!.optics : d.gun!.muzzleDevices;
                const on = list.includes(a);
                return <label key={a}><input type="checkbox" checked={on} onChange={() => setGun(ATTACHMENTS[a]!.slot === 'optic' ? { optics: on ? list.filter((x) => x !== a) : [...list, a] } : { muzzleDevices: on ? list.filter((x) => x !== a) : [...list, a] })} />{ITEMS[a]!.name}</label>;
              })}</div>
              {!d.model.rail && d.gun.optics.length > 0 && <p className="studio-muted">Cần đặt “Ngàm ống ngắm” trên model để lắp ống ngắm.</p>}
            </fieldset>}
            {d.throw && <fieldset><legend>Lựu đạn</legend>
              <label className="studio-field-inline"><span>Loại</span><select value={d.throw.effect} onChange={(e) => setThrow({ effect: e.target.value as 'frag' | 'flash' | 'smoke' })}>
                <option value="frag">Nổ (sát thương)</option><option value="flash">Choáng (chói mắt, ù tai)</option><option value="smoke">Khói (che tầm nhìn)</option></select></label>
              {num('Ngòi nổ (ms)', d.throw.fuseMs, (v) => setThrow({ fuseMs: v }), 50, 300, 10000)}
              {num(d.throw.effect === 'smoke' ? 'Bán kính khói (m)' : d.throw.effect === 'flash' ? 'Bán kính choáng (m)' : 'Bán kính nổ (m)', d.throw.radius, (v) => setThrow({ radius: v }), .5, 1, 40)}
              {d.throw.effect === 'frag' && num('Sát thương tâm nổ', d.throw.damage, (v) => setThrow({ damage: v }), 1, 0, 500)}
              {d.throw.effect !== 'frag' && num(d.throw.effect === 'smoke' ? 'Khói tồn tại (ms)' : 'Choáng tối đa (ms)', d.throw.effectMs, (v) => setThrow({ effectMs: v }), 100, 0, 60000)}
              {num('Tầm ném xa nhất (m)', d.throw.maxRange, (v) => setThrow({ maxRange: v }), .5, 3, 60)}
              {num('Hồi ném (ms)', d.throw.cooldownMs, (v) => setThrow({ cooldownMs: v }), 50, 200, 5000)}
              {num('Nặng (kg)', d.throw.weight, (v) => setThrow({ weight: v }), .05, .1, 5)}
            </fieldset>}
            {d.melee && <fieldset><legend>Cận chiến</legend>
              {num('Sát thương', d.melee.damage, (v) => setMelee({ damage: v }), 1, 1, 300)}
              {num('Tầm với (m)', d.melee.range, (v) => setMelee({ range: v }), .1, 1, 5)}
              {num('Hồi đòn (ms)', d.melee.cooldownMs, (v) => setMelee({ cooldownMs: v }), 10, 200, 4000)}
              {num('Thời gian vung (ms)', d.melee.swingMs, (v) => setMelee({ swingMs: v }), 10, 100, 3000)}
              {num('Nặng (kg)', d.melee.weight, (v) => setMelee({ weight: v }), .1, .2, 20)}
              {num('Tỉ lệ chặt đầu zombie', d.melee.decapitationChance ?? 0, (v) => setMelee({ decapitationChance: v || undefined }), .01, 0, 1)}
            </fieldset>}
          </div>}
          {tab === 'view' && url && <FirstPersonEditor key={url} url={url} draft={d} onChange={setModel} />}
        </div>
    </div>
  );
}

/**
 * Which attachments this mount accepts (only those are offered in game): one toggle per optic or
 * muzzle device. Without the mount point nothing can be fitted, whatever is ticked.
 */
function AttachmentPicker({ slot, chosen, mounted, onChange, shown, onShow, slotScale, onSlotScale, partScale, onPartScale, step, partOffset, onPartOffset }: { slot: 'optic' | 'muzzle'; chosen: string[]; mounted: boolean; onChange: (list: string[]) => void; shown: string; onShow: (id: string) => void; slotScale: number; onSlotScale: (v: number) => void; partScale: Record<string, number>; onPartScale: (id: string, v: number | undefined) => void; step: number; partOffset: Record<string, Vec3>; onPartOffset: (id: string, v: Vec3 | undefined) => void }) {
  const all = slot === 'optic' ? OPTICS : MUZZLES;
  return (
    <div className={`ws-picker${mounted ? '' : ' off'}`}>
      <small>{slot === 'optic' ? 'Ống ngắm lắp được' : 'Phụ kiện đầu nòng lắp được'}{mounted ? '' : ' (đặt điểm trước)'}</small>
      <div className="ws-picker-chips">
        {all.map((a) => {
          const on = chosen.includes(a);
          return <button key={a} type="button" aria-pressed={on} className={on ? 'on' : ''} onClick={() => onChange(on ? chosen.filter((x) => x !== a) : [...chosen, a])}>{ITEMS[a]!.name.replace('Ống ngắm ', '')}</button>;
        })}
      </div>
      <div className="ws-picker-tools"><button type="button" onClick={() => onChange([...all])}>Tất cả</button><button type="button" onClick={() => onChange([])}>Không</button></div>
      {mounted && chosen.length > 0 && <div className="ws-picker-preview">
        <label><span>Xem trên súng</span><select value={chosen.includes(shown) ? shown : ''} onChange={(e) => onShow(e.target.value)}>
          <option value="">— không —</option>{chosen.map((a) => <option key={a} value={a}>{ITEMS[a]!.name}</option>)}</select></label>
        <label><span>Cỡ chung ×{slotScale.toFixed(2)}</span><input type="range" min={.3} max={3} step={.01} value={slotScale} onChange={(e) => onSlotScale(Number(e.target.value))} /></label>
        {chosen.includes(shown) && <label><span>Cỡ {ITEMS[shown]!.name.replace('Ống ngắm ', '')} ×{(partScale[shown] ?? slotScale).toFixed(2)}</span>
          <span className="ws-part-scale"><input type="range" min={.2} max={5} step={.01} value={partScale[shown] ?? slotScale} onChange={(e) => onPartScale(shown, Number(e.target.value))} />
          {partScale[shown] !== undefined && <button type="button" title="Dùng cỡ chung" onClick={() => onPartScale(shown, undefined)}><Icon name="lucide:rotate-ccw" /></button>}</span></label>}
        {/* The part's pivot (centre of its contact face) sits on the mount point, moved only by this offset. */}
        {chosen.includes(shown) && <label><span>Lệch điểm gắn riêng (x y z)</span>
          <span className="ws-part-scale"><span className="ws-xyz">{[0, 1, 2].map((i) => <input key={i} type="number" step={step} aria-label={`Lệch ${'xyz'[i]}`} value={+(partOffset[shown]?.[i] ?? 0).toFixed(3)}
            onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v)) return; const next: Vec3 = [...(partOffset[shown] ?? [0, 0, 0])]; next[i] = v; onPartOffset(shown, next.every((x) => x === 0) ? undefined : next); }} />)}</span>
          {partOffset[shown] !== undefined && <button type="button" title="Bỏ lệch" onClick={() => onPartOffset(shown, undefined)}><Icon name="lucide:rotate-ccw" /></button>}</span></label>}
      </div>}
    </div>
  );
}

/** Orbitable model with the hand / attachment points; a click on the model places the active one. */
const VIEWER_BG_KEY = 'zion-weapon-viewer-bg';
const BACKDROP = {
  dark: { clear: 0x15181a, gridMajor: 0x3a3f42, grid: 0x24282a },
  light: { clear: 0xd9dde2, gridMajor: 0x8e969e, grid: 0xb4bbc2 },
} as const;

function PointEditor({ url, format, draft, previews, picking, onPick }: { url: string; format: 'glb' | 'bbmodel'; draft: Draft; previews: string[]; picking: PointKey | null; onPick: (p: Vec3) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ markers: (d: Draft) => void; attachments: (d: Draft, ids: string[]) => void } | null>(null);
  const pick = useRef(onPick); pick.current = onPick;
  const active = useRef(picking); active.current = picking;
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  // Light or dark backdrop: black parts vanish on the dark one. Remembered per browser.
  const [light, setLight] = useState(() => { try { return localStorage.getItem(VIEWER_BG_KEY) === 'light'; } catch { return false; } });
  const lightRef = useRef(light); lightRef.current = light;
  const backdrop = useRef<((light: boolean) => void) | null>(null);
  useEffect(() => {
    backdrop.current?.(light);
    try { localStorage.setItem(VIEWER_BG_KEY, light ? 'light' : 'dark'); } catch { /* private mode: not remembered */ }
  }, [light]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, frame = 0;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = SRGBColorSpace; renderer.setClearColor(new Color(lightRef.current ? BACKDROP.light.clear : BACKDROP.dark.clear));
    el.appendChild(renderer.domElement);
    const scene = new Scene(), holder = new Group(), markers = new Group();
    scene.add(holder, new AmbientLight(0xffffff, 1.7));
    const sun = new DirectionalLight(0xffffff, 2.4); sun.position.set(2, 4, 3); scene.add(sun);
    const camera = new PerspectiveCamera(40, 1, .01, 50);
    const controls = new OrbitControls(camera, renderer.domElement);
    const unit = 1 / BB_UNITS_PER_METER;
    let root: Group | null = null, radius = .1;
    const draw = () => { frame = 0; if (!disposed) renderer.render(scene, camera); };
    const redraw = () => { if (!frame) frame = requestAnimationFrame(draw); };
    controls.addEventListener('change', redraw);
    // Move gizmo on the active point: drag its arrows to slide the point along the model's axes.
    const handle = new Group();
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSpace('local'); gizmo.setSize(1);
    scene.add(gizmo.getHelper());
    let dragging = false;
    gizmo.addEventListener('dragging-changed', (e) => { dragging = !!e.value; controls.enabled = !e.value; });
    gizmo.addEventListener('change', redraw);
    gizmo.addEventListener('objectChange', () => {
      const p = handle.position.clone().multiplyScalar(BB_UNITS_PER_METER);
      pick.current([+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]);
    });
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); redraw(); };
    const observer = new ResizeObserver(resize); observer.observe(el);
    const previewGroup = new Group();
    let previewToken = 0;
    const attachments = (d: Draft, ids: string[]) => {
      const token = ++previewToken;
      if (!root) return;
      const gunRoot = root;
      void Promise.all(ids.map((id) => previewAttachment(visualSpec(d, url), gunRoot, id).catch(() => null))).then((parts) => {
        if (disposed || token !== previewToken) return;
        previewGroup.clear();
        for (const p of parts) if (p) previewGroup.add(p);
        redraw();
      });
    };
    api.current = { attachments, markers: (d) => {
      markers.clear();
      if (!root) return;
      // Show the weapon lying on its side: barrel to the right (+X), top up (+Y).
      const f = new Vector3(...d.model.barrel).normalize(), u0 = new Vector3(...d.model.up);
      const side = new Vector3().crossVectors(f, u0).normalize(), u = new Vector3().crossVectors(side, f).normalize();
      if (side.lengthSq() > .5) holder.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(f, u, side).transpose());
      holder.updateMatrixWorld(true);
      frame0();
      const put = (p: Vec3 | undefined, color: number) => { if (!p) return; const m = new Mesh(new SphereGeometry(radius, 12, 8), new MeshBasicMaterial({ color, depthTest: false })); m.renderOrder = 10; m.position.set(p[0] * unit, p[1] * unit, p[2] * unit); markers.add(m); };
      const pointOf = (k: PointKey) => (k === 'sightRear' ? d.model.sight?.rear : k === 'sightFront' ? d.model.sight?.front : d.model[k]);
      for (const k of Object.keys(POINTS) as PointKey[]) put(pointOf(k), POINTS[k].color);
      // The gizmo follows the active point (not while it is being dragged, it moves itself).
      const at = active.current ? pointOf(active.current) : undefined;
      if (at && !dragging) { handle.position.set(at[0] * unit, at[1] * unit, at[2] * unit); if (gizmo.object !== handle) gizmo.attach(handle); }
      if (!at) gizmo.detach();
      // Barrel (red) and up (green) arrows from the grip.
      const g = new Vector3(...d.model.grip).multiplyScalar(unit), len = radius * 14;
      markers.add(new ArrowHelper(new Vector3(...d.model.barrel), g, len, 0xff4a3a), new ArrowHelper(new Vector3(...d.model.up), g, len * .6, 0x4adf6a));
      redraw();
    } };
    // Frame the camera on the (re-oriented) model.
    let framed = false;
    const frame0 = () => {
      if (framed || !root) return;
      framed = true;
      const box = new Box3().setFromObject(root), size = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
      radius = Math.max(size.x, size.y, size.z) * .018;
      gridSize = Math.max(size.x, size.z) * 2; gridY = box.min.y;
      setBackdrop(lightRef.current);
      controls.target.copy(center); camera.position.copy(center).add(new Vector3(0, size.length() * .25, size.length() * 1.25)); controls.update();
    };
    let grid: GridHelper | null = null, gridSize = 0, gridY = 0;
    const setBackdrop = (isLight: boolean) => {
      const look = isLight ? BACKDROP.light : BACKDROP.dark;
      renderer.setClearColor(new Color(look.clear));
      if (gridSize > 0) {
        if (grid) { scene.remove(grid); grid.dispose(); }
        grid = new GridHelper(gridSize, 20, look.gridMajor, look.grid); grid.position.y = gridY; scene.add(grid);
      }
      redraw();
    };
    backdrop.current = setBackdrop;
    void loadWeaponModel(url, undefined, format).then(({ root: r }) => {
      if (disposed) return;
      // Markers, gizmo handle and attachment previews sit beside the model (same frame), never in it.
      root = r; holder.add(root, markers, handle, previewGroup);
      setState('ready'); api.current?.markers(draftRef.current); api.current?.attachments(draftRef.current, previewsRef.current); resize();
    }).catch(() => { if (!disposed) setState('failed'); });
    // Click (not drag) on the model: place the active point at the hit, in model units.
    let downAt: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
    const up = (e: PointerEvent) => {
      if (!downAt || !root || !active.current || dragging || gizmo.axis !== null || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ray = new Raycaster(); ray.setFromCamera(new Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObject(root, true).find((h) => !markers.children.includes(h.object as Mesh) && !(h.object.parent instanceof ArrowHelper));
      if (!hit) return;
      const p = root.worldToLocal(hit.point.clone()).multiplyScalar(BB_UNITS_PER_METER);
      pick.current([+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]);
    };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up);
    return () => { disposed = true; backdrop.current = null; cancelAnimationFrame(frame); observer.disconnect(); gizmo.dispose(); controls.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); api.current = null; };
  }, [url, format]);
  const draftRef = useRef(draft); draftRef.current = draft;
  useEffect(() => { api.current?.markers(draft); }, [draft, picking]);
  const previewsRef = useRef(previews); previewsRef.current = previews;
  // Re-mount the previews only when something they depend on changes.
  const mountKey = JSON.stringify([previews, draft.model.rail, draft.model.muzzle, draft.model.barrel, draft.model.up, draft.model.length, draft.model.opticScale, draft.model.muzzleScale, draft.model.attachmentScale, draft.model.attachmentOffset]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `mountKey` stands for those inputs.
  useEffect(() => { api.current?.attachments(draft, previews); }, [mountKey]);
  return <div className="ws-viewer" ref={host}>
    {state === 'loading' && <div className="ws-viewer-state"><Spinner /> Đang tải model…</div>}
    {state === 'failed' && <div className="ws-viewer-state">Không đọc được file model.</div>}
    <button type="button" className="ws-viewer-bg" onClick={() => setLight((v) => !v)} title={light ? 'Chuyển sang nền tối' : 'Chuyển sang nền sáng'} aria-pressed={light}>
      <Icon name={light ? 'lucide:moon' : 'lucide:sun'} /> {light ? 'Nền tối' : 'Nền sáng'}
    </button>
    {picking && state === 'ready' && <div className="ws-viewer-hint">Nhấp lên model để đặt: <b>{POINTS[picking].label}</b> · kéo mũi tên để dời điểm · kéo nền để xoay</div>}
  </div>;
}

/** The gun as the player sees it: hip and aiming, with sliders for its placement. */
function FirstPersonEditor({ url, draft, onChange }: { url: string; draft: Draft; onChange: (p: Partial<Draft['model']>) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [aiming, setAiming] = useState(false);
  const aim = useRef(aiming); aim.current = aiming;
  const spec = useMemo(() => visualSpec(draft, url), [draft, url]);
  const hip = draft.model.fpHip ?? [0.2, -0.27, -0.25];
  const relief = draft.model.fpEyeRelief ?? (draft.item.category === 'pistol' ? .4 : .3);
  const support = draft.model.fpSupport ?? [0, 0, 0];
  const rot = draft.model.fpRot ?? [0, 0];
  // Scene and model load once per file; the view model is rebuilt whenever the settings change.
  const stage = useRef<{ camera: PerspectiveCamera; root: Group | null; character?: CharacterTemplate; view: ViewModel | null } | null>(null);
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, frame = 0;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = SRGBColorSpace; renderer.setClearColor(new Color(0x6f8ea6));
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xffffff, 2.2); sun.position.set(1, 3, 2); scene.add(sun);
    const ground = new GridHelper(200, 100, 0x4f5a4a, 0x56624f); ground.position.y = -1.6; scene.add(ground);
    const field = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial({ color: 0x5d6b4c })); field.rotation.x = -Math.PI / 2; field.position.y = -1.62; scene.add(field);
    // A target 25 m ahead, on the aiming line.
    const target = new Mesh(new SphereGeometry(.35, 16, 12), new MeshBasicMaterial({ color: 0xd8462c })); target.position.set(0, 0, -25); scene.add(target);
    const camera = new PerspectiveCamera(75, 1, .03, 400); scene.add(camera);
    stage.current = { camera, root: null, view: null };
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let last = performance.now();
    const loop = () => {
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
      const view = stage.current?.view;
      if (view) {
        view.update(dt, { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0, aiming: aim.current });
        const fov = scopeFov(75, 1 + .25 * view.aimed);
        if (Math.abs(camera.fov - fov) > .01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      }
      renderer.render(scene, camera);
      if (!disposed) frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    // The player's own arms, as in game (loaded with the model).
    void Promise.all([loadWeaponModel(url, undefined, draft.format), loadPlayerCharacter()]).then(([{ root }, character]) => {
      if (disposed || !stage.current) return;
      stage.current.root = root; stage.current.character = character; setLoaded((n) => n + 1);
    }).catch(() => undefined);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); stage.current?.view?.dispose(); stage.current = null; renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the model reloads only with the file.
  }, [url]);
  useEffect(() => {
    const st = stage.current;
    if (!st?.root) return;
    st.view?.dispose();
    const view = new ViewModel(st.camera);
    view.set('studio-preview', new Map([['studio-preview', standaloneVisual('studio-preview', spec, st.root, st.character)]]));
    st.view = view;
  }, [spec, loaded]);
  const slider = (label: string, value: number, min: number, max: number, on: (v: number) => void) =>
    <label className="set-slider"><span>{label} <b>{value.toFixed(2)}</b></span><input type="range" min={min} max={max} step={(max - min) / 400} value={value} onChange={(e) => on(Number(e.target.value))} /></label>;
  return <>
    <div className="ws-viewer ws-fp" ref={host}><div className="ws-crosshair" aria-hidden /></div>
    <aside className="ws-side studio-form">
      {draft.gun ? <div className="ws-tabs"><button className={`btn${!aiming ? ' btn-primary' : ''}`} onClick={() => setAiming(false)}>Bình thường</button><button className={`btn${aiming ? ' btn-primary' : ''}`} onClick={() => setAiming(true)}>Nhắm bắn</button></div> : null}
      <div className="ws-tabs"><button className="btn" onClick={() => stage.current?.view?.preview(draft.gun ? 'reload' : 'swing')}><Icon name="lucide:play" /> {draft.gun ? 'Thử thay đạn' : 'Thử vung'}</button></div>
      <h4>Khi cầm bình thường</h4>
      {slider('Sang phải', hip[0], -.1, .45, (v) => onChange({ fpHip: [v, hip[1], hip[2]] }))}
      {slider('Lên / xuống', hip[1], -.5, -.05, (v) => onChange({ fpHip: [hip[0], v, hip[2]] }))}
      {slider('Xa / gần', hip[2], -.6, -.1, (v) => onChange({ fpHip: [hip[0], hip[1], v] }))}
      {slider('Xoay dọc (độ)', rot[0] * 180 / Math.PI, -40, 40, (v) => onChange({ fpRot: [v * Math.PI / 180, rot[1]] }))}
      {slider('Xoay ngang (độ)', rot[1] * 180 / Math.PI, -40, 40, (v) => onChange({ fpRot: [rot[0], v * Math.PI / 180] }))}
      <h4>Tay trái</h4>
      {!draft.model.support && !(draft.gun && draft.item.category === 'pistol') && <p className="studio-muted">Đặt điểm “Tay đỡ (tay trái)” ở tab Model để hiện tay trái{draft.gun ? '' : ' (vũ khí hai tay)'}.</p>}
      {slider('Trước / sau', support[0], -.2, .2, (v) => onChange({ fpSupport: [v, support[1], support[2]] }))}
      {slider('Lên / xuống', support[1], -.15, .15, (v) => onChange({ fpSupport: [support[0], v, support[2]] }))}
      {slider('Trái / phải', support[2], -.15, .15, (v) => onChange({ fpSupport: [support[0], support[1], v] }))}
      {draft.gun && <>
        <h4>Khi nhắm bắn</h4>
        {slider('Khoảng cách mắt – thước ngắm (m)', relief, .1, .8, (v) => onChange({ fpEyeRelief: v }))}
        {!draft.model.sight && <p className="studio-muted">Đặt “Thước ngắm sau / trước” ở tab Model để súng ngắm đúng tâm.</p>}
      </>}
      <button type="button" className="btn" onClick={() => onChange({ fpHip: undefined, fpEyeRelief: undefined, fpSupport: undefined, fpRot: undefined })}>Về mặc định</button>
    </aside>
  </>;
}
