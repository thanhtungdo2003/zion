'use client';
import { Icon } from './Icon';

import Link from 'next/link';
import { ContentEditor } from './ContentEditor';
import { StudioPlayerCount } from './StudioPlayerCount';
import { StudioCurrency } from './StudioCurrency';
import { NewsEditor } from './NewsEditor';
import { StudioVehiclePhysics } from './StudioVehiclePhysics';
import { Spinner } from './Spinner';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CAMP_ASSETS, LIGHT_ASSETS, LIGHT_SOURCE_ASSET } from '@zion/assets';
import { ApiError, hasStudioSession, studioContent, studioLoad, studioLogin, studioLogout, studioReset, studioSave, studioSaveContent, studioTerrain, type StudioLayout, type StudioNpcs, type StudioPart } from '@/lib/api';
import type { GameContent } from '@zion/shared';
import { StudioScene, type Handle, type SceneNpc } from '@/studio/studio-scene';

/* ---------------------------------------------------------------------------------- catalog */

interface Footprint {
  boxes: Array<{ cx: number; cz: number; hx: number; hz: number; yaw: number }>;
  radius: number;
}

interface CatalogEntry {
  numericId: number;
  key: string;
  name: string;
  group: string;
  color: string;
  height: number;
  footprint: Footprint;
}

const GROUP_COLORS: Record<string, string> = { dists: '#8a6a3f', materias: '#6f7f86', light: '#e0b040' };
const GROUP_LABELS: Record<string, string> = { dists: 'Đồ dùng căn cứ', materias: 'Vật liệu xây dựng', light: 'Ánh sáng', misc: 'Khác' };
const ASSET_LABELS: Record<string, string> = {
  'barbed-wire-fence': 'Hàng rào dây thép gai', 'military-lamp-post': 'Cột đèn quân dụng',
  'military-wooden-crate': 'Thùng gỗ quân dụng', 'rusty-oil-barrel': 'Thùng dầu gỉ',
  'zion-ammo-cache-station': 'Kho đạn ZION', 'branch-stick': 'Cành cây',
  'car-battery': 'Ắc quy ô tô', 'field-tent': 'Lều dã chiến', 'iron-fence': 'Hàng rào sắt',
  'large-stone-brick-wall': 'Tường gạch đá lớn', 'lon-cu-nat': 'Lon cũ nát',
  'old-carton-box': 'Thùng giấy cũ', 'old-dusty-wood-board': 'Ván gỗ cũ phủ bụi',
  'old-iron-bucket': 'Xô sắt cũ', 'old-solar-panel': 'Tấm pin mặt trời cũ',
  'old-water-pipe': 'Ống nước cũ', 'old-wooden-beam': 'Dầm gỗ cũ',
  'old-wooden-crate': 'Thùng gỗ cũ', 'perforated-corrugated-sheet': 'Tấm tôn đục lỗ',
  'rusted-wire-coil': 'Cuộn dây thép gỉ', 'rusty-corrugated-sheet': 'Tấm tôn gỉ',
  'rusty-iron-bar': 'Thanh sắt gỉ', 'rusty-iron-wall-ladder': 'Thang sắt gắn tường gỉ',
  'rusty-metal-plate': 'Tấm kim loại gỉ', 'sandbag-wall': 'Tường bao cát',
  'small-transformer': 'Máy biến áp nhỏ', 'utility-pole': 'Cột điện',
  'water-bottle': 'Chai nước', 'wooden-fence': 'Hàng rào gỗ',
  'medical-table': 'Bàn y tế', 'weapon-table': 'Bàn vũ khí',
  'broken-concrete-wall': 'Tường bê tông vỡ', 'broken-glass-pane': 'Tấm kính vỡ',
  'concrete-wall-panel': 'Tấm tường bê tông', 'concrete-wall': 'Tường bê tông',
  'glass-pane': 'Tấm kính', 'mossy-concrete-wall': 'Tường bê tông phủ rêu',
  'shattered-glass-pane': 'Tấm kính vỡ vụn', 'old-rusty-tank': 'Xe tăng cũ gỉ',
  'rusty-old-helicopter': 'Trực thăng cũ gỉ', 'straight-lamp-post': 'Cột đèn thẳng',
  'l-shaped-kitchen-counter': 'Bàn bếp chữ L',
};

/** Every camp asset with its 2D footprint (box colliders, or a disc from its bounds). */
const CATALOG: CatalogEntry[] = [...CAMP_ASSETS, ...LIGHT_ASSETS].map((a) => {
  const boxes = (a.colliders ?? []).flatMap((c) =>
    c.type === 'box' ? [{ cx: c.center[0], cz: c.center[2], hx: c.halfExtents[0], hz: c.halfExtents[2], yaw: c.yaw ?? 0 }] : [],
  );
  const group = a.numericId === LIGHT_SOURCE_ASSET ? 'light' : a.tags?.[0] ?? 'misc';
  const key = a.model.kind === 'bbmodel' ? a.model.path.split('/').pop()!.replace('.bbmodel', '') : a.id;
  return {
    numericId: a.numericId,
    key,
    name: a.numericId === LIGHT_SOURCE_ASSET ? 'Nguồn sáng (vô hình)' : ASSET_LABELS[key] ?? a.name,
    group,
    color: GROUP_COLORS[group] ?? '#7d7466',
    height: a.bounds.height,
    footprint: { boxes, radius: a.bounds.radius },
  };
}).sort((x, y) => x.group.localeCompare(y.group) || x.name.localeCompare(y.name));
const BY_ID = new Map(CATALOG.map((c) => [c.numericId, c]));

/* ------------------------------------------------------------------------------------ model */

interface Part extends StudioPart {
  uid: number;
}

let nextUid = 1;
const withUid = (p: StudioPart): Part => ({ ...p, uid: nextUid++ });
const strip = (p: Part): StudioPart => ({ asset: p.asset, x: round(p.x), y: round(p.y), z: round(p.z), yaw: round(p.yaw, 4), scale: round(p.scale, 3), ...(p.group ? { group: p.group } : {}) });
function round(v: number, d = 3): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}
const snapTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);
const DEG = Math.PI / 180;
const HISTORY_LIMIT = 120;

type Modal = null | 'publish' | 'reset' | 'discard' | 'help';
/** Quest NPCs (farmer, chef, colonel…): their spots live in the game content, not the layout. */
interface QuestSpot { id: string; name: string; model: string; x: number; z: number }
type Npcs = StudioNpcs & { quest: QuestSpot[] };
const questSpots = (c: GameContent | null): QuestSpot[] => (c?.npcs ?? []).map((n) => ({ id: n.id, name: n.name, model: n.model, x: n.x, z: n.z }));
interface Snapshot {
  parts: Part[];
  npcs: Npcs;
}
const NPC_LABEL: Record<string, string> = { merchant: 'Thương nhân vũ khí', nurse: 'Quân y', guard: 'Lính gác cổng' };

function npcList(n: Npcs): SceneNpc[] {
  return [
    { key: 'merchant', role: 'merchant', ...n.merchant },
    { key: 'nurse', role: 'nurse', ...n.nurse },
    ...n.guards.map((g, i) => ({ key: `guard:${i}`, role: 'guard' as const, ...g })),
    ...n.quest.map((q) => ({ key: `quest:${q.id}`, role: 'quest' as const, model: q.model, label: q.name, x: q.x, z: q.z })),
  ];
}

function moveNpc(n: Npcs, key: string, x: number, z: number): Npcs {
  if (key === 'merchant') return { ...n, merchant: { x, z } };
  if (key === 'nurse') return { ...n, nurse: { x, z } };
  if (key.startsWith('quest:')) {
    const id = key.slice(6);
    return { ...n, quest: n.quest.map((q) => (q.id === id ? { ...q, x, z } : q)) };
  }
  const i = Number(key.split(':')[1]);
  return { ...n, guards: n.guards.map((g, k) => (k === i ? { x, z } : g)) };
}

const sameHandle = (a: Handle, b: Handle) => (a.kind === 'part' && b.kind === 'part' ? a.uid === b.uid : a.kind === 'npc' && b.kind === 'npc' && a.key === b.key);

/**
 * Camp Studio: a 3D editor for the survivor camp. Real models on the real camp ground; place
 * materials from the catalog, select and drag them along three axis arrows (or rotate), stack,
 * duplicate, demolish, and move the camp NPCs. Publishing swaps the camp live for every player.
 */
export default function StudioView() {
  const [status, setStatus] = useState<'loading' | 'locked' | 'error' | 'ready'>('loading');
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [server, setServer] = useState<StudioLayout | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [npcs, setNpcs] = useState<Npcs>({ merchant: { x: 0, z: 0 }, nurse: { x: 0, z: 0 }, guards: [], quest: [] });
  const content = useRef<GameContent | null>(null);
  const [baseline, setBaseline] = useState('');
  const [selection, setSelection] = useState<Handle[]>([]);
  const [mode, setMode] = useState<'translate' | 'rotate'>('translate');
  const [tool, setTool] = useState<number | null>(null);
  const [ghostYaw, setGhostYaw] = useState(0);
  const [snap, setSnap] = useState(0.5);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number; z: number } | null>(null);
  const [, setHistoryTick] = useState(0);
  const history = useRef<{ undo: Snapshot[]; redo: Snapshot[] }>({ undo: [], redo: [] });
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<StudioScene | null>(null);
  const clipboard = useRef<StudioPart[]>([]);
  // Latest state for the scene's event callbacks (they are bound once).
  const live = useRef({ parts, npcs, selection, tool, snap, ghostYaw });
  live.current = { parts, npcs, selection, tool, snap, ghostYaw };
  const dragStart = useRef<Snapshot | null>(null);

  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 2600);
  }, []);

  const adopt = useCallback((layout: StudioLayout, game?: GameContent) => {
    if (game) content.current = game;
    const n: Npcs = { ...layout.npcs, quest: questSpots(content.current) };
    setServer(layout);
    setParts(layout.parts.map(withUid));
    setNpcs(n);
    setBaseline(JSON.stringify({ parts: layout.parts.map((p) => strip(withUid(p))), npcs: n }));
    setSelection([]);
    history.current = { undo: [], redo: [] };
  }, []);

  /* ------------------------------------------------------------------------------ loading */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // A studio password session, or an admin/moderator game account.
      try {
        const [layout, game] = await Promise.all([studioLoad(), studioContent()]);
        if (cancelled) return;
        adopt(layout, game);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          if (hasStudioSession()) studioLogout();
          setStatus('locked');
        } else {
          setError((err as Error).message);
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt, attempt]);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlocking(true);
    setError('');
    try {
      await studioLogin(password);
      setPassword('');
      setStatus('loading');
      setAttempt((n) => n + 1);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Mật khẩu xưởng không đúng' : (err as Error).message);
    } finally {
      setUnlocking(false);
    }
  };

  const dirty = useMemo(() => JSON.stringify({ parts: parts.map(strip), npcs }) !== baseline, [parts, npcs, baseline]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /* ------------------------------------------------------------------------------ history */

  const pushHistory = useCallback((snap: Snapshot) => {
    const h = history.current;
    h.undo.push(snap);
    if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
    h.redo = [];
    setHistoryTick((n) => n + 1);
  }, []);

  const commit = useCallback(
    (next: { parts?: Part[]; npcs?: Npcs }) => {
      pushHistory({ parts, npcs });
      if (next.parts) setParts(next.parts);
      if (next.npcs) setNpcs(next.npcs);
    },
    [parts, npcs, pushHistory],
  );

  const undo = useCallback(() => {
    const h = history.current;
    const prev = h.undo.pop();
    if (!prev) return;
    h.redo.push({ parts, npcs });
    setParts(prev.parts);
    setNpcs(prev.npcs);
    setHistoryTick((n) => n + 1);
  }, [parts, npcs]);

  const redo = useCallback(() => {
    const h = history.current;
    const next = h.redo.pop();
    if (!next) return;
    h.undo.push({ parts, npcs });
    setParts(next.parts);
    setNpcs(next.npcs);
    setHistoryTick((n) => n + 1);
  }, [parts, npcs]);

  /* ------------------------------------------------------------------------------ editing */

  const selParts = useMemo(() => parts.filter((p) => selection.some((h) => h.kind === 'part' && h.uid === p.uid)), [parts, selection]);
  const selNpc = selection.length === 1 && selection[0]!.kind === 'npc' ? selection[0]!.key : null;

  const removeSelected = useCallback(() => {
    if (!selParts.length) return;
    const ids = new Set(selParts.map((p) => p.uid));
    commit({ parts: parts.filter((p) => !ids.has(p.uid)) });
    flash(`Đã tháo dỡ ${ids.size} cấu kiện`);
    setSelection([]);
  }, [commit, parts, selParts, flash]);

  const duplicate = useCallback(
    (source: StudioPart[], offset: number) => {
      if (!source.length) return;
      const copies = source.map((p) => withUid({ ...p, x: p.x + offset, z: p.z + offset }));
      commit({ parts: [...parts, ...copies] });
      setSelection(copies.map((c) => ({ kind: 'part' as const, uid: c.uid })));
    },
    [commit, parts],
  );

  const rotateSelected = useCallback(
    (deg: number) => {
      if (!selParts.length) return;
      const ids = new Set(selParts.map((p) => p.uid));
      const cx = selParts.reduce((a, p) => a + p.x, 0) / selParts.length;
      const cz = selParts.reduce((a, p) => a + p.z, 0) / selParts.length;
      const a = deg * DEG;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Rotate about the group's centre (three.js yaw: (x, z) → (x cos + z sin, −x sin + z cos)).
      commit({
        parts: parts.map((p) => {
          if (!ids.has(p.uid)) return p;
          const dx = p.x - cx;
          const dz = p.z - cz;
          return { ...p, x: cx + dx * c + dz * s, z: cz - dx * s + dz * c, yaw: p.yaw + a };
        }),
      });
    },
    [commit, parts, selParts],
  );

  /* ------------------------------------------------------------------------------ 3D scene */

  useEffect(() => {
    if (status !== 'ready' || !hostRef.current) return;
    const scene = new StudioScene(hostRef.current, {
      pick: (handle, additive) => {
        setTool(null);
        setSelection((s) => {
          if (!handle) return additive ? s : [];
          if (!additive) return [handle];
          return s.some((h) => sameHandle(h, handle)) ? s.filter((h) => !sameHandle(h, handle)) : [...s, handle];
        });
      },
      place: (x, y, z) => {
        const L = live.current;
        if (L.tool === null) return;
        const p = withUid({ asset: L.tool, x: snapTo(x, L.snap), y: Math.max(0, Math.round(y * 8) / 8), z: snapTo(z, L.snap), yaw: L.ghostYaw, scale: 1 });
        pushHistory({ parts: L.parts, npcs: L.npcs });
        setParts([...L.parts, p]);
      },
      dragging: (active) => {
        const L = live.current;
        if (active) dragStart.current = { parts: L.parts, npcs: L.npcs };
        else if (dragStart.current) {
          pushHistory(dragStart.current);
          dragStart.current = null;
        }
      },
      transform: (handle, x, y, z, yaw) => {
        const start = dragStart.current;
        const L = live.current;
        if (handle.kind === 'npc') {
          setNpcs(moveNpc(L.npcs, handle.key, round(x, 2), round(z, 2)));
          return;
        }
        // Move (or turn) every selected part by the gizmo's change to the primary one.
        const base = start?.parts ?? L.parts;
        const prim = base.find((p) => p.uid === handle.uid);
        if (!prim) return;
        const dx = x - prim.x;
        const dy = y - prim.y;
        const dz = z - prim.z;
        const dyaw = yaw - prim.yaw;
        const ids = new Set(L.selection.filter((h) => h.kind === 'part').map((h) => (h as { uid: number }).uid));
        setParts(base.map((p) => (ids.has(p.uid) || p.uid === handle.uid ? { ...p, x: p.x + dx, y: Math.max(-2, p.y + dy), z: p.z + dz, yaw: p.yaw + dyaw } : p)));
      },
      cursor: (p) => setCursor(p),
    });
    sceneRef.current = scene;
    void studioTerrain()
      .then((t) => scene.setTerrain(t))
      .catch(() => flash('Không tải được địa hình (đang xem trên mặt phẳng)'));
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [status, pushHistory, flash]);

  useEffect(() => sceneRef.current?.syncParts(parts), [parts, status]);
  useEffect(() => sceneRef.current?.syncNpcs(npcList(npcs)), [npcs, status]);
  useEffect(() => sceneRef.current?.setSelection(selection, mode), [selection, mode, parts, npcs, status]);
  useEffect(() => sceneRef.current?.setSnap(snap), [snap, status]);
  useEffect(() => sceneRef.current?.setGhost(tool, ghostYaw), [tool, ghostYaw, status]);

  /* ---------------------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (modal) {
        if (e.key === 'Escape') setModal(null);
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (ctrl && k === 'y') {
        e.preventDefault();
        redo();
      } else if (ctrl && k === 'd') {
        e.preventDefault();
        duplicate(selParts.map(strip), Math.max(snap, 1));
      } else if (ctrl && k === 'c') {
        clipboard.current = selParts.map(strip);
        if (selParts.length) flash(`Đã sao chép ${selParts.length} cấu kiện`);
      } else if (ctrl && k === 'v') {
        duplicate(clipboard.current, Math.max(snap, 1) * 2);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        removeSelected();
      } else if (e.key === 'Escape') {
        setTool(null);
        setSelection([]);
      } else if (k === 'g' || k === 't') {
        setMode('translate');
      } else if (k === 'e') {
        setMode('rotate');
      } else if (k === 'r') {
        const step = e.shiftKey ? -15 : 15;
        if (tool !== null) setGhostYaw((y) => y + step * DEG);
        else rotateSelected(step);
      } else if (k === 'q') {
        if (tool !== null) setGhostYaw((y) => y + 90 * DEG);
        else rotateSelected(90);
      } else if (k === 'f') {
        const p = selParts[0] ?? (selNpc ? npcList(npcs).find((n) => n.key === selNpc) : undefined);
        if (p) sceneRef.current?.focus(p.x, p.z);
      } else if (e.key === '?') setModal('help');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, undo, redo, duplicate, selParts, selNpc, npcs, snap, removeSelected, tool, rotateSelected, flash]);

  /* --------------------------------------------------------------------------- server I/O */

  const publish = async () => {
    setBusy(true);
    try {
      const layout = await studioSave(parts.map(strip), { merchant: npcs.merchant, nurse: npcs.nurse, guards: npcs.guards });
      // Quest NPC spots are part of the game content: publish them there when they moved.
      let game = content.current;
      if (game && npcs.quest.some((q) => game!.npcs.some((n) => n.id === q.id && (n.x !== q.x || n.z !== q.z)))) {
        // Merge into the latest content (it may have been edited in the quest editor meanwhile).
        game = await studioContent();
        game = await studioSaveContent({ ...game, npcs: game.npcs.map((n) => {
          const q = npcs.quest.find((s) => s.id === n.id);
          return q ? { ...n, x: q.x, z: q.z } : n;
        }) });
      }
      adopt(layout, game ?? undefined);
      flash('Đã áp dụng căn cứ cho tất cả người chơi');
      setModal(null);
    } catch (err) {
      flash(`Áp dụng thất bại: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const resetDefault = async () => {
    setBusy(true);
    try {
      adopt(await studioReset());
      flash('Đã khôi phục căn cứ mặc định');
      setModal(null);
    } catch (err) {
      flash(`Khôi phục thất bại: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      const [layout, game] = await Promise.all([studioLoad(), studioContent()]);
      adopt(layout, game);
      setModal(null);
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------------------------------------------------------- render */

  if (status !== 'ready') {
    return (
      <div className="studio-root studio-gate">
        <div className="overlay-card">
          <h2>Xưởng căn cứ</h2>
          {status === 'loading' && <p>Đang tải bố trí căn cứ…</p>}
          {status === 'locked' && (
            <form className="studio-unlock" onSubmit={(e) => void unlock(e)}>
              <p>Nhập mật khẩu xưởng để chỉnh sửa căn cứ.</p>
              <input type="password" autoFocus placeholder="Mật khẩu xưởng" value={password} onChange={(e) => setPassword(e.target.value)} />
              {error && <p className="error">{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={!password || unlocking}>
                {unlocking ? <Spinner /> : 'Vào xưởng'}
              </button>
            </form>
          )}
          {status === 'error' && <p>Không tải được căn cứ: {error}</p>}
          <Link className="btn" href="/">
            Về menu chính
          </Link>
        </div>
      </div>
    );
  }

  const filtered = CATALOG.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.key.includes(search.toLowerCase()));
  const groups = [...new Set(filtered.map((c) => c.group))];
  const single = selParts.length === 1 && selection.length === 1 ? selParts[0]! : null;
  const toolEntry = tool !== null ? BY_ID.get(tool) : undefined;
  const npcPos = selNpc ? npcList(npcs).find((n) => n.key === selNpc) : undefined;

  return (
    <div className="studio-root">
      <header className="studio-bar">
        <Link href="/" className="studio-back" title="Về menu chính">
          <Icon name="lucide:arrow-left" />
        </Link>
        <h1>Xưởng căn cứ</h1>
        <StudioPlayerCount />
        <StudioCurrency />
        <ContentEditor />
        <NewsEditor />
        <StudioVehiclePhysics />
        <Link href="/studio/weapons" className="btn"><Icon name="game-icons:pistol-gun" /> Vũ khí</Link>
        <Link href="/studio/infection" className="btn"><Icon name="game-icons:biohazard" /> Lây nhiễm</Link>
        <span className={`studio-badge ${server?.customised ? 'custom' : ''}`}>{server?.customised ? 'Bố trí tùy chỉnh' : 'Bố trí mặc định'}</span>
        {dirty && <span className="studio-badge unsaved">Thay đổi chưa lưu</span>}
        <div className="studio-spacer" />
        <div className="studio-seg">
          <button className={mode === 'translate' ? 'on' : ''} onClick={() => setMode('translate')} title="Di chuyển theo X / Y / Z (G)">
            <Icon name="lucide:move" /> Di chuyển
          </button>
          <button className={mode === 'rotate' ? 'on' : ''} onClick={() => setMode('rotate')} title="Xoay (E)">
            <Icon name="lucide:rotate-cw" /> Xoay
          </button>
        </div>
        <button className="btn" onClick={undo} disabled={!history.current.undo.length} title="Hoàn tác (Ctrl+Z)">
          Hoàn tác
        </button>
        <button className="btn" onClick={redo} disabled={!history.current.redo.length} title="Làm lại (Ctrl+Y)">
          Làm lại
        </button>
        <label className="studio-field-inline">
          Bám lưới
          <select value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
            <option value={0}>Tắt</option>
            <option value={0.25}>0.25 m</option>
            <option value={0.5}>0.5 m</option>
            <option value={1}>1 m</option>
            <option value={2}>2 m</option>
          </select>
        </label>
        <button className="btn" onClick={() => setModal('help')}>
          <Icon name="lucide:circle-help" />
        </button>
        <button className="btn" onClick={() => setModal('discard')} disabled={!dirty || busy}>
          Bỏ thay đổi
        </button>
        <button className="btn" onClick={() => setModal('reset')} disabled={busy}>
          Khôi phục mặc định
        </button>
        <button className="btn btn-primary" onClick={() => setModal('publish')} disabled={!dirty || busy}>
          Áp dụng
        </button>
      </header>

      <aside className="studio-palette">
        <input className="studio-search" placeholder="Tìm vật liệu…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="studio-palette-list">
          {groups.map((g) => (
            <div key={g}>
              <div className="studio-group">{GROUP_LABELS[g] ?? g}</div>
              {filtered
                .filter((c) => c.group === g)
                .map((c) => (
                  <button
                    key={c.numericId}
                    className={`studio-asset ${tool === c.numericId ? 'on' : ''}`}
                    onClick={() => {
                      setTool(tool === c.numericId ? null : c.numericId);
                      setSelection([]);
                    }}
                    title={`${c.name} · nhấp xuống đất để xây dựng`}
                  >
                    <FootprintIcon entry={c} />
                    <span>
                      {c.name}
                      <small>
                        {(Math.max(...c.footprint.boxes.map((b) => b.hx * 2), c.footprint.radius) || 0).toFixed(1)} m · h {c.height.toFixed(1)} m
                      </small>
                    </span>
                  </button>
                ))}
            </div>
          ))}
          <div className="studio-group">Nhân vật</div>
          {npcList(npcs).map((n) => (
            <button
              key={n.key}
              className={`studio-asset ${selNpc === n.key ? 'on' : ''}`}
              onClick={() => {
                setTool(null);
                setSelection([{ kind: 'npc', key: n.key }]);
                sceneRef.current?.focus(n.x, n.z);
              }}
            >
              <span className={`studio-npc-dot ${n.role}`} />
              <span>
                {n.label ?? NPC_LABEL[n.role]}
                {n.role === 'guard' ? ` ${Number(n.key.split(':')[1]) + 1}` : ''}
                <small>
                  x {n.x.toFixed(1)} · z {n.z.toFixed(1)}
                </small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className={`studio-canvas ${tool !== null ? 'building' : ''}`}>
        <div ref={hostRef} className="studio-3d" />
        <div className="studio-hud">
          {cursor ? `x ${cursor.x.toFixed(1)}  y ${cursor.y.toFixed(1)}  z ${cursor.z.toFixed(1)}` : '—'} · {parts.length} cấu kiện
          {toolEntry && <b> · Đang xây: {toolEntry.name} (R / Q để xoay, Esc để dừng)</b>}
          <br />
          Kéo chuột trái để xoay góc nhìn · kéo chuột phải để dịch góc nhìn · cuộn để thu phóng · nhấp để chọn · kéo mũi tên để di chuyển theo X (đỏ) / Y (xanh lá) / Z (xanh dương)
        </div>
        {toast && <div className="studio-toast">{toast}</div>}
      </main>

      <aside className="studio-props">
        <h3>Thuộc tính</h3>
        {!selection.length && <p className="studio-muted">Nhấp vào cấu kiện hoặc nhân vật để chọn (giữ Shift để chọn thêm), hoặc chọn vật liệu bên trái rồi nhấp xuống đất để xây.</p>}
        {single && <PartForm part={single} onChange={(next) => commit({ parts: parts.map((p) => (p.uid === single.uid ? next : p)) })} />}
        {npcPos && (
          <div className="studio-form">
            <p>
              <b>{npcPos.label ?? NPC_LABEL[npcPos.role]}</b> — di chuyển trên mặt đất, chỉ chỉnh X/Z.{npcPos.role === 'quest' ? ' Được lưu vào nội dung nhiệm vụ khi áp dụng.' : ''}
            </p>
            {(['x', 'z'] as const).map((axis) => (
              <label key={axis} className="studio-field">
                <span>{axis === 'x' ? 'X (đông) m' : 'Z (nam) m'}</span>
                <input
                  type="number"
                  step={0.25}
                  value={round(npcPos[axis], 2)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    commit({ npcs: moveNpc(npcs, npcPos.key, axis === 'x' ? v : npcPos.x, axis === 'z' ? v : npcPos.z) });
                  }}
                />
              </label>
            ))}
          </div>
        )}
        {selParts.length > 1 && <p>{selParts.length} cấu kiện được chọn</p>}
        {selParts.length > 0 && (
          <div className="studio-group-box">
            <span>
              Nhóm:{' '}
              <b>{new Set(selParts.map((p) => p.group ?? 0)).size === 1 ? (selParts[0]!.group ? `#${selParts[0]!.group}` : 'chưa có') : 'nhiều nhóm'}</b>
            </span>
            <div className="studio-actions">
              <button className="btn" disabled={selParts.length < 2} title="Các cấu kiện cùng tường hoặc công trình sẽ mờ đi cùng nhau trong trò chơi" onClick={() => {
                const next = Math.max(0, ...parts.map((p) => p.group ?? 0)) + 1;
                const ids = new Set(selParts.map((p) => p.uid));
                commit({ parts: parts.map((p) => (ids.has(p.uid) ? { ...p, group: next } : p)) });
                flash(`Đã gộp ${ids.size} cấu kiện vào nhóm #${next}`);
              }}>Gộp nhóm</button>
              <button className="btn" disabled={!selParts.some((p) => p.group)} onClick={() => {
                const ids = new Set(selParts.map((p) => p.uid));
                commit({ parts: parts.map((p) => (ids.has(p.uid) ? { ...p, group: undefined } : p)) });
              }}>Tách nhóm</button>
              <button className="btn" disabled={!selParts[0]?.group} onClick={() => {
                const g = selParts[0]!.group;
                setSelection(parts.filter((p) => p.group === g).map((p) => ({ kind: 'part' as const, uid: p.uid })));
              }}>Chọn cả nhóm</button>
            </div>
          </div>
        )}
        {selParts.length > 0 && (
          <div className="studio-actions">
            <button className="btn" onClick={() => rotateSelected(-15)}><Icon name="lucide:rotate-ccw" /> 15°</button>
            <button className="btn" onClick={() => rotateSelected(15)}><Icon name="lucide:rotate-cw" /> 15°</button>
            <button className="btn" onClick={() => rotateSelected(90)}><Icon name="lucide:rotate-cw" /> 90°</button>
            <button className="btn" onClick={() => duplicate(selParts.map(strip), Math.max(snap, 1))}>Nhân bản</button>
            <button className="btn btn-danger" onClick={removeSelected}>Tháo dỡ</button>
          </div>
        )}
      </aside>

      {modal && (
        <div className="studio-modal-backdrop" onClick={() => !busy && setModal(null)}>
          <div className="overlay-card studio-modal" onClick={(e) => e.stopPropagation()}>
            {modal === 'publish' && (
              <>
                <h2>Áp dụng bố trí căn cứ?</h2>
                <p>
                  Căn cứ ({parts.length} cấu kiện và vị trí nhân vật) được cập nhật <b>ngay cho tất cả người chơi</b> và được giữ lại khi máy chủ khởi động lại.
                  Người chơi đứng trong công trình mới có thể bị đẩy ra ngoài.
                </p>
                <div className="overlay-row">
                  <button className="btn" onClick={() => setModal(null)} disabled={busy}>Hủy</button>
                  <button className="btn btn-primary" onClick={() => void publish()} disabled={busy}>{busy ? <Spinner /> : 'Áp dụng'}</button>
                </div>
              </>
            )}
            {modal === 'reset' && (
              <>
                <h2>Khôi phục căn cứ mặc định?</h2>
                <p>Xóa mọi chỉnh sửa trên máy chủ (cấu kiện và vị trí nhân vật) rồi khôi phục căn cứ gốc cho tất cả người chơi. Không thể hoàn tác.</p>
                <div className="overlay-row">
                  <button className="btn" onClick={() => setModal(null)} disabled={busy}>Hủy</button>
                  <button className="btn btn-danger" onClick={() => void resetDefault()} disabled={busy}>{busy ? <Spinner /> : 'Khôi phục'}</button>
                </div>
              </>
            )}
            {modal === 'discard' && (
              <>
                <h2>Bỏ các thay đổi chưa lưu?</h2>
                <p>Tải lại bố trí đang áp dụng trên máy chủ.</p>
                <div className="overlay-row">
                  <button className="btn" onClick={() => setModal(null)} disabled={busy}>Hủy</button>
                  <button className="btn btn-danger" onClick={() => void discard()} disabled={busy}>{busy ? <Spinner /> : 'Bỏ thay đổi'}</button>
                </div>
              </>
            )}
            {modal === 'help' && (
              <>
                <h2>Điều khiển xưởng căn cứ</h2>
                <ul className="studio-help">
                  <li><b>Góc nhìn:</b> kéo chuột trái để xoay · kéo chuột phải để dịch · cuộn để thu phóng · <kbd>F</kbd> đưa góc nhìn tới mục đang chọn</li>
                  <li><kbd>Nhấp</kbd> chọn cấu kiện hoặc nhân vật · <kbd>Shift</kbd>+nhấp để chọn thêm</li>
                  <li><b>Di chuyển:</b> kéo mũi tên đỏ / xanh lá / xanh dương (X đông / Y lên / Z nam) hoặc mặt phẳng giữa chúng · <kbd>G</kbd></li>
                  <li><b>Xoay:</b> <kbd>E</kbd> rồi kéo vòng xoay · <kbd>R</kbd> ±15° · <kbd>Q</kbd> 90°</li>
                  <li><b>Xây dựng:</b> chọn vật liệu rồi nhấp xuống đất · <kbd>Esc</kbd> để dừng</li>
                  <li><kbd>Del</kbd> tháo dỡ · <kbd>Ctrl+D</kbd> nhân bản · <kbd>Ctrl+C</kbd>/<kbd>Ctrl+V</kbd> sao chép/dán · <kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> hoàn tác/làm lại</li>
                  <li>Nhân vật (thương nhân, quân y, lính gác) chỉ di chuyển trên mặt đất.</li>
                </ul>
                <div className="overlay-row">
                  <button className="btn btn-primary" onClick={() => setModal(null)}>Đã rõ</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------- pieces */

function Shape({ entry, strokeWidth, elevated }: { entry: CatalogEntry | undefined; strokeWidth: number; elevated: boolean }) {
  if (!entry) return <circle r={0.5} className="studio-unknown" strokeWidth={strokeWidth} />;
  const { boxes, radius } = entry.footprint;
  const style = { fill: entry.color, fillOpacity: elevated ? 0.55 : 0.85 };
  if (!boxes.length) return <circle r={Math.max(0.25, radius * 0.7)} style={style} strokeWidth={strokeWidth} />;
  return (
    <>
      {boxes.map((b, i) => (
        <rect
          key={i}
          x={-b.hx}
          y={-b.hz}
          width={b.hx * 2}
          height={b.hz * 2}
          transform={`translate(${b.cx} ${b.cz}) rotate(${-b.yaw / DEG})`}
          style={style}
          strokeWidth={strokeWidth}
        />
      ))}
      {/* Facing tick: the part's local −Z ("front"). */}
      <line x1={0} y1={0} x2={0} y2={-Math.max(0.3, radius * 0.6)} className="studio-facing" strokeWidth={strokeWidth} />
    </>
  );
}

function FootprintIcon({ entry }: { entry: CatalogEntry }) {
  const r = Math.max(0.3, entry.footprint.radius, ...entry.footprint.boxes.map((b) => Math.hypot(b.cx, b.cz) + Math.max(b.hx, b.hz)));
  return (
    <svg className="studio-asset-icon" viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`}>
      <Shape entry={entry} strokeWidth={r / 12} elevated={false} />
    </svg>
  );
}

function PartForm({ part, onChange }: { part: Part; onChange: (p: Part) => void }) {
  const num = (key: 'x' | 'y' | 'z' | 'scale', label: string, step: number, min?: number, max?: number) => (
    <label className="studio-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={round(part[key], 3)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange({ ...part, [key]: min !== undefined && max !== undefined ? Math.max(min, Math.min(max, v)) : v });
        }}
      />
    </label>
  );
  return (
    <div className="studio-form">
      <label className="studio-field">
        <span>Vật liệu</span>
        <select value={part.asset} onChange={(e) => onChange({ ...part, asset: Number(e.target.value) })}>
          {CATALOG.map((c) => (
            <option key={c.numericId} value={c.numericId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {num('x', 'X (đông) m', 0.25, -70, 70)}
      {num('z', 'Z (nam) m', 0.25, -70, 70)}
      {num('y', 'Độ cao (Y) m', 0.125, -2, 30)}
      <label className="studio-field">
        <span>Góc xoay °</span>
        <input type="number" step={15} value={round(part.yaw / DEG, 1)} onChange={(e) => Number.isFinite(Number(e.target.value)) && onChange({ ...part, yaw: Number(e.target.value) * DEG })} />
      </label>
      {part.asset === LIGHT_SOURCE_ASSET ? num('scale', 'Độ sáng (×)', 0.1, 0.1, 10) : num('scale', 'Tỷ lệ', 0.05, 0.5, 2)}
    </div>
  );
}
