'use client';

import Link from 'next/link';
import { ContentEditor } from './ContentEditor';
import { Spinner } from './Spinner';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CAMP_ASSETS } from '@zion/assets';
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

const GROUP_COLORS: Record<string, string> = { dists: '#8a6a3f', materias: '#6f7f86' };

/** Every camp asset with its 2D footprint (box colliders, or a disc from its bounds). */
const CATALOG: CatalogEntry[] = CAMP_ASSETS.map((a) => {
  const boxes = (a.colliders ?? []).flatMap((c) =>
    c.type === 'box' ? [{ cx: c.center[0], cz: c.center[2], hx: c.halfExtents[0], hz: c.halfExtents[2], yaw: c.yaw ?? 0 }] : [],
  );
  const group = a.tags?.[0] ?? 'misc';
  const key = a.model.kind === 'bbmodel' ? a.model.path.split('/').pop()!.replace('.bbmodel', '') : a.id;
  return {
    numericId: a.numericId,
    key,
    name: a.name,
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
const NPC_LABEL: Record<string, string> = { merchant: 'Weapon merchant', nurse: 'Field medic', guard: 'Gate guard' };

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
      setError(err instanceof ApiError && err.status === 401 ? 'Wrong studio password' : (err as Error).message);
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
    flash(`Demolished ${ids.size} part(s)`);
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
      .catch(() => flash('Ground could not be loaded (flat preview)'));
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
        if (selParts.length) flash(`Copied ${selParts.length} part(s)`);
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
      flash('Published: the camp is live for every player');
      setModal(null);
    } catch (err) {
      flash(`Publish failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const resetDefault = async () => {
    setBusy(true);
    try {
      adopt(await studioReset());
      flash('Camp restored to the generated default');
      setModal(null);
    } catch (err) {
      flash(`Reset failed: ${(err as Error).message}`);
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
          <h2>Camp Studio</h2>
          {status === 'loading' && <p>Loading camp layout…</p>}
          {status === 'locked' && (
            <form className="studio-unlock" onSubmit={(e) => void unlock(e)}>
              <p>Enter the studio password to edit the camp.</p>
              <input type="password" autoFocus placeholder="Studio password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {error && <p className="error">{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={!password || unlocking}>
                {unlocking ? <Spinner /> : 'Enter studio'}
              </button>
            </form>
          )}
          {status === 'error' && <p>Could not load the camp: {error}</p>}
          <Link className="btn" href="/">
            Back to menu
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
        <Link href="/" className="studio-back" title="Back to menu">
          ←
        </Link>
        <h1>Camp Studio</h1>
        <ContentEditor />
        <span className={`studio-badge ${server?.customised ? 'custom' : ''}`}>{server?.customised ? 'Custom layout' : 'Generated default'}</span>
        {dirty && <span className="studio-badge unsaved">Unsaved changes</span>}
        <div className="studio-spacer" />
        <div className="studio-seg">
          <button className={mode === 'translate' ? 'on' : ''} onClick={() => setMode('translate')} title="Move along X / Y / Z (G)">
            ✥ Move
          </button>
          <button className={mode === 'rotate' ? 'on' : ''} onClick={() => setMode('rotate')} title="Rotate (E)">
            ⟳ Rotate
          </button>
        </div>
        <button className="btn" onClick={undo} disabled={!history.current.undo.length} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button className="btn" onClick={redo} disabled={!history.current.redo.length} title="Redo (Ctrl+Y)">
          Redo
        </button>
        <label className="studio-field-inline">
          Snap
          <select value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
            <option value={0}>off</option>
            <option value={0.25}>0.25 m</option>
            <option value={0.5}>0.5 m</option>
            <option value={1}>1 m</option>
            <option value={2}>2 m</option>
          </select>
        </label>
        <button className="btn" onClick={() => setModal('help')}>
          ?
        </button>
        <button className="btn" onClick={() => setModal('discard')} disabled={!dirty || busy}>
          Discard
        </button>
        <button className="btn" onClick={() => setModal('reset')} disabled={busy}>
          Reset to default
        </button>
        <button className="btn btn-primary" onClick={() => setModal('publish')} disabled={!dirty || busy}>
          Publish
        </button>
      </header>

      <aside className="studio-palette">
        <input className="studio-search" placeholder="Search materials…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="studio-palette-list">
          {groups.map((g) => (
            <div key={g}>
              <div className="studio-group">{g}</div>
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
                    title={`${c.name} · click on the ground to build`}
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
          <div className="studio-group">NPCs</div>
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
          {cursor ? `x ${cursor.x.toFixed(1)}  y ${cursor.y.toFixed(1)}  z ${cursor.z.toFixed(1)}` : '—'} · {parts.length} parts
          {toolEntry && <b> · Building: {toolEntry.name} (R / Q rotate, Esc to stop)</b>}
          <br />
          Left-drag orbit · right-drag pan · wheel zoom · click to select · drag the coloured arrows to move along X (red) / Y (green) / Z (blue)
        </div>
        {toast && <div className="studio-toast">{toast}</div>}
      </main>

      <aside className="studio-props">
        <h3>Properties</h3>
        {!selection.length && <p className="studio-muted">Click a part or NPC to select it (Shift-click to add), or pick a material on the left and click the ground to build.</p>}
        {single && <PartForm part={single} onChange={(next) => commit({ parts: parts.map((p) => (p.uid === single.uid ? next : p)) })} />}
        {npcPos && (
          <div className="studio-form">
            <p>
              <b>{npcPos.label ?? NPC_LABEL[npcPos.role]}</b> — walks on the ground, so only X/Z.{npcPos.role === 'quest' ? ' Saved into the quest content on publish.' : ''}
            </p>
            {(['x', 'z'] as const).map((axis) => (
              <label key={axis} className="studio-field">
                <span>{axis === 'x' ? 'X (east) m' : 'Z (south) m'}</span>
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
        {selParts.length > 1 && <p>{selParts.length} parts selected</p>}
        {selParts.length > 0 && (
          <div className="studio-group-box">
            <span>
              Group:{' '}
              <b>{new Set(selParts.map((p) => p.group ?? 0)).size === 1 ? (selParts[0]!.group ? `#${selParts[0]!.group}` : 'none') : 'mixed'}</b>
            </span>
            <div className="studio-actions">
              <button className="btn" disabled={selParts.length < 2} title="Pieces of one wall/building fade together in game" onClick={() => {
                const next = Math.max(0, ...parts.map((p) => p.group ?? 0)) + 1;
                const ids = new Set(selParts.map((p) => p.uid));
                commit({ parts: parts.map((p) => (ids.has(p.uid) ? { ...p, group: next } : p)) });
                flash(`Grouped ${ids.size} parts as #${next}`);
              }}>Group</button>
              <button className="btn" disabled={!selParts.some((p) => p.group)} onClick={() => {
                const ids = new Set(selParts.map((p) => p.uid));
                commit({ parts: parts.map((p) => (ids.has(p.uid) ? { ...p, group: undefined } : p)) });
              }}>Ungroup</button>
              <button className="btn" disabled={!selParts[0]?.group} onClick={() => {
                const g = selParts[0]!.group;
                setSelection(parts.filter((p) => p.group === g).map((p) => ({ kind: 'part' as const, uid: p.uid })));
              }}>Select group</button>
            </div>
          </div>
        )}
        {selParts.length > 0 && (
          <div className="studio-actions">
            <button className="btn" onClick={() => rotateSelected(-15)}>⟲ 15°</button>
            <button className="btn" onClick={() => rotateSelected(15)}>⟳ 15°</button>
            <button className="btn" onClick={() => rotateSelected(90)}>⟳ 90°</button>
            <button className="btn" onClick={() => duplicate(selParts.map(strip), Math.max(snap, 1))}>Duplicate</button>
            <button className="btn btn-danger" onClick={removeSelected}>Demolish</button>
          </div>
        )}
      </aside>

      {modal && (
        <div className="studio-modal-backdrop" onClick={() => !busy && setModal(null)}>
          <div className="overlay-card studio-modal" onClick={(e) => e.stopPropagation()}>
            {modal === 'publish' && (
              <>
                <h2>Publish camp layout?</h2>
                <p>
                  The camp ({parts.length} parts, NPC spots) is rebuilt <b>live for every player</b> and kept across server restarts.
                  Players standing inside a new structure may get pushed out.
                </p>
                <div className="overlay-row">
                  <button className="btn" onClick={() => setModal(null)} disabled={busy}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => void publish()} disabled={busy}>{busy ? <Spinner /> : 'Publish'}</button>
                </div>
              </>
            )}
            {modal === 'reset' && (
              <>
                <h2>Reset to the generated camp?</h2>
                <p>Removes every studio edit on the server (parts and NPC spots) and restores the original camp for all players. This cannot be undone.</p>
                <div className="overlay-row">
                  <button className="btn" onClick={() => setModal(null)} disabled={busy}>Cancel</button>
                  <button className="btn btn-danger" onClick={() => void resetDefault()} disabled={busy}>{busy ? <Spinner /> : 'Reset'}</button>
                </div>
              </>
            )}
            {modal === 'discard' && (
              <>
                <h2>Discard unsaved changes?</h2>
                <p>Reloads the layout currently live on the server.</p>
                <div className="overlay-row">
                  <button className="btn" onClick={() => setModal(null)} disabled={busy}>Cancel</button>
                  <button className="btn btn-danger" onClick={() => void discard()} disabled={busy}>{busy ? <Spinner /> : 'Discard'}</button>
                </div>
              </>
            )}
            {modal === 'help' && (
              <>
                <h2>Camp Studio controls</h2>
                <ul className="studio-help">
                  <li><b>Camera:</b> left-drag orbit · right-drag pan · wheel zoom · <kbd>F</kbd> focus the selection</li>
                  <li><kbd>Click</kbd> select a part or NPC · <kbd>Shift</kbd>+click add to the selection</li>
                  <li><b>Move:</b> drag the red / green / blue arrows (X east / Y up / Z south) or the planes between them · <kbd>G</kbd></li>
                  <li><b>Rotate:</b> <kbd>E</kbd> then drag the ring · <kbd>R</kbd> ±15° · <kbd>Q</kbd> 90°</li>
                  <li><b>Build:</b> pick a material, click the ground · <kbd>Esc</kbd> stops</li>
                  <li><kbd>Del</kbd> demolish · <kbd>Ctrl+D</kbd> duplicate · <kbd>Ctrl+C</kbd>/<kbd>Ctrl+V</kbd> copy/paste · <kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> undo/redo</li>
                  <li>NPCs (merchant, medic, gate guards) move along the ground only.</li>
                </ul>
                <div className="overlay-row">
                  <button className="btn btn-primary" onClick={() => setModal(null)}>Got it</button>
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
        <span>Material</span>
        <select value={part.asset} onChange={(e) => onChange({ ...part, asset: Number(e.target.value) })}>
          {CATALOG.map((c) => (
            <option key={c.numericId} value={c.numericId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {num('x', 'X (east) m', 0.25, -70, 70)}
      {num('z', 'Z (south) m', 0.25, -70, 70)}
      {num('y', 'Height (Y) m', 0.125, -2, 30)}
      <label className="studio-field">
        <span>Rotation °</span>
        <input type="number" step={15} value={round(part.yaw / DEG, 1)} onChange={(e) => Number.isFinite(Number(e.target.value)) && onChange({ ...part, yaw: Number(e.target.value) * DEG })} />
      </label>
      {num('scale', 'Scale', 0.05, 0.5, 2)}
    </div>
  );
}
