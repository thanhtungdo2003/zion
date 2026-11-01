'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DocBuilder, FURNITURE_KINDS, ROOM_TYPES, duplicateNode, emptyDoc, furniture, generateHouse, label as furnitureLabel, matchPreset, parseDoc, subtree, validateDoc, autoFix,
  type ModelDoc, type ModelNode, type ValidationReport,
} from '@zion/assets/model-studio';
import { Icon } from '@/components/Icon';
import { ApiError, studioLogin } from '@/lib/api';
import { msApi, type AiStatus, type AgentJob, type AgentStep, type Project, type ProjectSummary, type PublishedModel, type VersionInfo } from '@/lib/model-studio-api';
import { ModelViewport, type DisplayMode, type GizmoMode } from '@/studio/model-studio/viewport';
import { ChecksPanel, HierarchyPanel, Inspector, LibraryPanel, MaterialPanel, ProjectsPanel, VersionsPanel, type Mutate } from './Panels';
import s from './model-studio.module.css';

/**
 * Model Studio: build, assemble, check and publish 3D models for the game in the browser — by
 * hand (procedural parts, game models, imported GLB files, PBR materials) or by asking the AI
 * agent, which works through the same tools. Projects save on the server (autosave + named
 * versions); undo/redo covers every change, the agent's included.
 */
const EXAMPLES = [
  'Tạo một ngôi nhà hoàn chỉnh gồm phòng khách, phòng ngủ, nhà bếp và phòng ăn, dùng vật liệu có sẵn trong game.',
  'Tạo một căn nhà sinh tồn có sân trước, vườn cây, hàng rào, sân sau và nội thất cơ bản, phong cách hậu tận thế.',
  'Tạo một tảng đá lớn có hình dạng tự nhiên, bề mặt lởm chởm, nhiều lớp đá, texture chi tiết và vật liệu PBR.',
  'Tạo một căn nhà bỏ hoang sau 200 năm, 2 tầng, mái hư hỏng, tường nứt, rêu và bụi bẩn.',
  'Từ các model tường, cửa, cửa sổ và mái nhà đang có, lắp ghép thành một căn nhà hoàn chỉnh, tối ưu draw call.',
];
const MAX_UNDO = 80;
/** Parts copied with Ctrl+C (kept in this browser, so they paste into another project too). */
const CLIPBOARD_KEY = 'zion.model-studio.clipboard.v1';
interface Clip { roots: string[]; nodes: ModelNode[]; materials: ModelDoc['materials'] }
type LeftTab = 'projects' | 'library' | 'scene';
type RightTab = 'props' | 'material' | 'checks' | 'versions';

export default function ModelStudio() {
  const [auth, setAuth] = useState<'checking' | 'ok' | 'login'>('checking');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [deleted, setDeleted] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [doc, setDoc] = useState<ModelDoc | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'error'>('idle');
  const [conflict, setConflict] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [left, setLeft] = useState<LeftTab>('projects');
  const [right, setRight] = useState<RightTab>('props');
  const [gizmo, setGizmo] = useState<GizmoMode>('translate');
  const [space, setSpace] = useState<'local' | 'world'>('world');
  const [snapOn, setSnapOn] = useState(true);
  const [snap, setSnap] = useState({ move: .25, angle: 15, scale: .1 });
  const [mode, setMode] = useState<DisplayMode>('lit');
  const [grid, setGrid] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [houseOpen, setHouseOpen] = useState(false);
  const [stats, setStats] = useState({ triangles: 0, meshes: 0, pendingTextures: 0 });
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [status, setStatus] = useState<{ ai: boolean; model: string | null } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [published, setPublished] = useState<PublishedModel[]>([]);
  const [trial, setTrial] = useState<{ active: number[]; saved: number[] } | null>(null);
  const [serverReport, setServerReport] = useState<ValidationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [job, setJob] = useState<AgentJob | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [agentOpen, setAgentOpen] = useState(true);
  const [preview, setPreview] = useState<number | null>(null);
  const undo = useRef<ModelDoc[]>([]), redo = useRef<ModelDoc[]>([]);
  const view = useRef<ModelViewport | null>(null), host = useRef<HTMLDivElement>(null);
  const docRef = useRef<ModelDoc | null>(null);
  const clipboard = useRef<Clip | null>(null), pasteCount = useRef(0);
  const agentRunning = useRef(false);
  const [plansOn, setPlansOn] = useState(true);
  docRef.current = doc;

  const flash = useCallback((text: string, bad = false) => { setToast({ text, bad }); window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), bad ? 9000 : 4500); }, []);
  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) { setAuth('login'); return; }
    flash(err instanceof Error ? err.message : String(err), true);
  }, [flash]);

  /* ------------------------------------------------------------------ loading */

  const refreshList = useCallback(async () => {
    const [all, gone] = await Promise.all([msApi.list(), msApi.list(true)]);
    setProjects(all); setDeleted(gone.filter((p) => p.deleted));
  }, []);
  const refreshPublished = useCallback(async () => {
    const [pub, tr] = await Promise.all([msApi.published(), msApi.trial().catch(() => null)]);
    setPublished(pub); setTrial(tr);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refreshList();
        setAuth('ok');
        setStatus(await msApi.status());
        void refreshPublished();
        const id = new URLSearchParams(window.location.search).get('project');
        if (id) void open(id);
      } catch (err) { if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setAuth('login'); else { setAuth('ok'); fail(err); } }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = useCallback(async (id: string) => {
    try {
      const p = await msApi.get(id);
      setProject(p); setDoc(p.doc); setVersion(p.version); setDirty(false); setSelected([]); setConflict(null); setServerReport(null); setPreview(null);
      undo.current = []; redo.current = [];
      setLeft('scene');
      window.history.replaceState(null, '', `?project=${id}`);
      setVersions(await msApi.versions(id));
      requestAnimationFrame(() => view.current?.focusSelection());
      // An agent still working on this project (the page was reloaded): follow it again.
      const { job: running } = await msApi.agentLatest(id);
      if (running && !running.finished) await attachAgent(running.id);
    } catch (err) { fail(err); }
  }, [fail]);
  /** Shows a job's log and follows it until it ends (from its first step). */
  const attachAgent = async (id: string) => {
    const j = await msApi.agentGet(id, 0);
    setSteps([]); setAgentOpen(true);
    setJob({ ...j, steps: [] });
  };

  /* -------------------------------------------------------------------- editing */

  const mutate: Mutate = useCallback((labelText, fn) => {
    const cur = docRef.current;
    if (!cur || preview !== null) return;
    // The agent is building: the view follows its work; edits wait until it ends or is stopped.
    if (agentRunning.current) { flash('AI đang dựng — chờ xong hoặc bấm Dừng rồi sửa.', true); return; }
    const next = structuredClone(cur);
    fn(next);
    try { parseDoc(next); } catch (err) { flash(`Thay đổi không hợp lệ (${labelText}): ${(err as Error).message}`, true); return; }
    undo.current.push(cur);
    if (undo.current.length > MAX_UNDO) undo.current.shift();
    redo.current = [];
    setDoc(next); setDirty(true);
  }, [flash, preview]);

  const doUndo = useCallback(() => { const prev = undo.current.pop(); if (!prev || !docRef.current) return; redo.current.push(docRef.current); setDoc(prev); setDirty(true); }, []);
  const doRedo = useCallback(() => { const nx = redo.current.pop(); if (!nx || !docRef.current) return; undo.current.push(docRef.current); setDoc(nx); setDirty(true); }, []);

  // Autosave 2 s after the last change.
  const save = useCallback(async (snapshot?: { note: string }) => {
    const cur = docRef.current;
    if (!project || !cur || preview !== null) return;
    setSaving('saving');
    try {
      const r = await msApi.save(project.id, cur, version, snapshot);
      setVersion(r.version); setSaving('idle');
      if (docRef.current === cur) setDirty(false);
      if (snapshot) { setVersions(await msApi.versions(project.id)); flash(`Đã lưu phiên bản v${r.version}.`); }
    } catch (err) {
      setSaving('error');
      if (err instanceof ApiError && err.status === 409) setConflict(err.message); else fail(err);
    }
  }, [project, version, preview, flash, fail]);
  useEffect(() => {
    if (!dirty || conflict || job?.status === 'running') return;
    const t = window.setTimeout(() => void save(), 2000);
    return () => window.clearTimeout(t);
  }, [dirty, doc, save, conflict, job?.status]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /* ------------------------------------------------------------------- viewport */

  useEffect(() => {
    if (auth !== 'ok' || !host.current) return;
    const v = new ModelViewport(host.current, {
      pick: (id, additive) => setSelected((cur) => (!id ? [] : additive ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id])),
      transform: (id, t) => mutate('Biến đổi', (d) => { const n = d.nodes.find((x) => x.id === id); if (n) n.transform = t; }),
      stats: (st) => setStats((o) => (o.triangles === st.triangles && o.meshes === st.meshes && o.pendingTextures === st.pendingTextures ? o : st)),
    });
    view.current = v;
    // Development: the view is reachable from the console (automated UI checks).
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __modelViewport?: ModelViewport }).__modelViewport = v;
    return () => { v.dispose(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);
  useEffect(() => { if (doc) view.current?.setDoc(doc); }, [doc]);
  useEffect(() => { view.current?.select(selected, gizmo, space, snapOn ? snap : null); }, [selected, gizmo, space, snapOn, snap, doc]);
  useEffect(() => { view.current?.setMode(mode); }, [mode]);
  useEffect(() => { view.current?.setPlansVisible(plansOn); }, [plansOn]);
  useEffect(() => { agentRunning.current = !!job && !job.finished; }, [job]);
  useEffect(() => { view.current?.setGrid(grid, snapOn ? Math.max(.1, snap.move) * 4 : 1); }, [grid, snapOn, snap.move]);

  const report = useMemo(() => (doc ? validateDoc(doc, { asset: (id) => view.current?.registry.byNumericId(id), files: new Set(project?.files.map((f) => f.id) ?? []) }) : null), [doc, project?.files]);
  const selectedNodes = useMemo(() => (doc ? selected.map((id) => doc.nodes.find((n) => n.id === id)).filter((n): n is ModelNode => !!n) : []), [doc, selected]);

  /* --------------------------------------------------------------- add / edit */

  /** Where new parts go: in front of the camera target, on the ground, under the selected group. */
  const placement = () => {
    const sel = selectedNodes[0];
    const parent = sel?.kind === 'group' ? sel.id : null;
    return { parent, position: [0, 0, 0] as [number, number, number] };
  };
  const add = (labelText: string, fn: (b: DocBuilder, parent: string | null) => string) => {
    let made = '';
    mutate(labelText, (d) => { const b = new DocBuilder(d); made = fn(b, placement().parent); });
    if (made) setSelected([made]);
    setAddOpen(false);
  };
  const mat = (b: DocBuilder, preset: string) => b.material(matchPreset(preset).id, matchPreset(preset).id).id;

  const duplicateSel = () => {
    if (!selected.length) return;
    const made: string[] = [];
    mutate('Nhân bản', (d) => { for (const id of selected) { const c = duplicateNode(d, id); c.transform.position = [c.transform.position[0] + 1, c.transform.position[1], c.transform.position[2] + 1]; made.push(c.id); } });
    setSelected(made);
  };
  /**
   * Copy (Ctrl+C): the selected parts with everything under them and the materials they use, kept
   * in this browser (pasted into this model or another project). Paste (Ctrl+V): fresh ids, in the
   * same place in the hierarchy, each paste a step further along so copies do not overlap.
   */
  const copySel = () => {
    if (!doc || !selected.length) return;
    const ids = new Set(selected), nodes = selected.filter((id) => { for (let n = doc.nodes.find((x) => x.id === id); n?.parent; n = doc.nodes.find((x) => x.id === n!.parent)) if (ids.has(n.parent)) return false; return true; }).flatMap((id) => subtree(doc, id));
    if (!nodes.length) return;
    const text = JSON.stringify(nodes), materials = doc.materials.filter((m) => text.includes(`"${m.id}"`));
    const clip = { roots: selected.filter((id) => nodes.some((n) => n.id === id)), nodes, materials };
    clipboard.current = clip; pasteCount.current = 0;
    try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clip)); } catch { /* too big or no storage: this tab keeps it */ }
    flash(`Đã sao chép ${clip.roots.length} khối (${nodes.length} phần).`);
  };
  const pasteSel = () => {
    let clip = clipboard.current;
    if (!clip) { try { const raw = localStorage.getItem(CLIPBOARD_KEY); if (raw) clip = JSON.parse(raw) as Clip; } catch { /* nothing to paste */ } }
    if (!clip?.nodes.length) return;
    const step = ++pasteCount.current, made: string[] = [];
    mutate('Dán', (d) => {
      for (const m of clip!.materials) if (!d.materials.some((x) => x.id === m.id)) d.materials.push(structuredClone(m));
      const map = new Map<string, string>(), taken = new Set(d.nodes.map((n) => n.id));
      for (const n of clip!.nodes) {
        let k = 1, fresh: string;
        do fresh = `${n.id.replace(/-copy\d*$/, '')}-copy${k++}`; while (taken.has(fresh));
        taken.add(fresh); map.set(n.id, fresh);
      }
      for (const n of clip!.nodes) {
        const c = structuredClone(n) as typeof n, root = clip!.roots.includes(n.id);
        c.id = map.get(n.id)!;
        // A copied block keeps its place in the hierarchy when that is in this model, else the top.
        c.parent = root ? (n.parent && d.nodes.some((x) => x.id === n.parent) ? n.parent : null) : map.get(n.parent!) ?? null;
        if (root) { c.transform = { ...c.transform, position: [c.transform.position[0] + step, c.transform.position[1], c.transform.position[2] + step] }; made.push(c.id); }
        d.nodes.push(c);
      }
    });
    setSelected(made);
  };
  const deleteSel = () => {
    if (!selected.length) return;
    mutate('Xóa', (d) => { const gone = new Set(selected.flatMap((id) => subtree(d, id).map((n) => n.id))); d.nodes = d.nodes.filter((n) => !gone.has(n.id)); });
    setSelected([]);
  };
  const groupSel = () => {
    if (selected.length < 1) return;
    let g = '';
    mutate('Gom nhóm', (d) => {
      const first = d.nodes.find((n) => n.id === selected[0]);
      g = new DocBuilder(d).group('Nhóm', first?.parent ?? null);
      for (const id of selected) { const n = d.nodes.find((x) => x.id === id); if (n && !subtree(d, id).some((x) => x.id === g)) n.parent = g; }
    });
    setSelected([g]);
  };
  const dropSel = () => {
    const id = selected[selected.length - 1];
    const dy = id ? view.current?.dropDistance(id) : null;
    if (!id || dy === null || dy === undefined || Math.abs(dy) < 1e-4) return;
    mutate('Đặt lên bề mặt', (d) => { const n = d.nodes.find((x) => x.id === id); if (n) n.transform.position[1] = Math.round((n.transform.position[1] + dy) * 1000) / 1000; });
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSel(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'c') { if (!window.getSelection()?.toString()) { e.preventDefault(); copySel(); } }
      else if ((e.ctrlKey || e.metaKey) && k === 'v') { e.preventDefault(); pasteSel(); }
      else if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); void save({ note: 'Lưu thủ công' }); }
      else if ((e.ctrlKey || e.metaKey) && k === 'g') { e.preventDefault(); groupSel(); }
      else if (k === 'delete' || k === 'backspace') deleteSel();
      else if (k === 'w') setGizmo('translate'); else if (k === 'e') setGizmo('rotate'); else if (k === 'r') setGizmo('scale');
      else if (k === 'f') view.current?.focusSelection();
      else if (k === 'escape') { setSelected([]); setAddOpen(false); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  /* ------------------------------------------------------------------- server */

  const withBusy = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => { setBusy(true); try { return await fn(); } catch (err) { fail(err); return undefined; } finally { setBusy(false); } };
  const download = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); window.setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const exportGlb = (m: 'game' | 'editable') => void withBusy(async () => {
    const r = await msApi.exportGlb(doc!, m);
    download(r.blob, `${(doc!.name || 'model').replace(/[^\p{L}\p{N}_-]+/gu, '_')}${m === 'game' ? '_game' : ''}.glb`);
    flash(`Đã xuất GLB (${(r.blob.size / 1024 / 1024).toFixed(1)} MB, ${r.triangles.toLocaleString('vi-VN')} tam giác${r.refs ? `, ${r.refs} model game tham chiếu` : ''}).${r.warnings.length ? ` Lưu ý: ${r.warnings.slice(0, 3).join(' ')}` : ''}`);
  });
  const importFile = (f: File) => void withBusy(async () => {
    if (!project) return;
    const r = await msApi.upload(project.id, f);
    setProject((p) => (p ? { ...p, files: [...p.files, r] } : p));
    if (r.mime.startsWith('model/')) {
      // A GLB exported from this Studio carries its project: offer to open it as editable parts.
      const bytes = new Uint8Array(await f.arrayBuffer());
      const editable = await readEditable(bytes);
      if (editable && confirm(`"${f.name}" là model xuất từ Model Studio (${editable.nodes.length} phần). Mở thành các phần chỉnh sửa được (thay vì một khối import)?`)) {
        mutate('Import dự án', (d) => { const map = new Map<string, string>(); const b = new DocBuilder(d); const root = b.group(editable.name, null); for (const m of editable.materials) if (!d.materials.some((x) => x.id === m.id)) d.materials.push(m); for (const n of editable.nodes) { let id = n.id; let k = 1; while (d.nodes.some((x) => x.id === id)) id = `${n.id}-i${k++}`; map.set(n.id, id); } for (const n of editable.nodes) d.nodes.push({ ...n, id: map.get(n.id)!, parent: n.parent ? map.get(n.parent) ?? root : root } as ModelNode); });
        flash(`Đã mở ${editable.nodes.length} phần từ ${f.name}.`);
      } else {
        mutate('Đặt file import', (d) => { new DocBuilder(d); d.nodes.push({ id: `import-${r.id.slice(0, 8)}`, name: f.name.slice(0, 80), kind: 'import', file: r.id, fileName: f.name.slice(0, 200), parent: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }); });
        flash(`Đã import ${f.name}.`);
      }
    } else flash(`Đã thêm ảnh ${f.name}: chọn nó ở tab Vật liệu → Ảnh màu nền.`);
  });
  const snapshot = (note: string) => void save({ note });
  const restoreVersion = (v: number) => void withBusy(async () => {
    if (!project) return;
    await msApi.restore(project.id, v);
    await open(project.id);
    flash(`Đã khôi phục phiên bản ${v}.`);
  });
  const previewVersion = (v: number) => void withBusy(async () => {
    if (!project) return;
    const r = await (await import('@/lib/api')).studioJson<{ doc: ModelDoc }>(`/api/studio/models/projects/${project.id}/versions/${v}`);
    setPreview(v); setDoc(r.doc);
  });
  const endPreview = () => { if (!project) return; setPreview(null); void open(project.id); };
  const publish = (opts: { lotClass?: string; replaceAsset?: number }) => void withBusy(async () => {
    if (!project) return;
    if (dirty) await save();
    const r = await msApi.publish(project.id, opts);
    await refreshPublished();
    flash(`Đã xuất bản #${r.asset} "${r.name}" vào game.${r.warnings.length ? ` Lưu ý: ${r.warnings.slice(0, 3).join(' ')}` : ''}`);
  });
  const unpublish = (asset: number) => void withBusy(async () => { await msApi.unpublish(asset); await refreshPublished(); flash(`Đã gỡ #${asset} khỏi game.`); });
  const setTrialAssets = (assets: number[]) => void withBusy(async () => { const r = await msApi.setTrial(assets); setTrial(r); flash(r.restartRequired ? 'Đã lưu thử nghiệm; khởi động lại server để áp dụng trên đảo Hắc Sơn.' : 'Đã lưu.'); });

  /* -------------------------------------------------------------------- agent */

  const runAgent = () => void (async () => {
    if (!project || !prompt.trim() || job?.status === 'running') return;
    try {
      if (dirty) await save();
      const r = await msApi.agentStart(project.id, prompt.trim());
      setSteps([]); setAgentOpen(true);
      setJob({ id: r.job, status: 'running', mode: r.mode as 'ai', model: r.model, prompt: prompt.trim(), steps: [], total: 0, summary: null, issues: [], savedVersion: null, saveError: null, usage: { prompt: 0, completion: 0, total: 0, turns: 0 }, publishRequests: [], revision: 0, finished: false });
    } catch (err) {
      // Already running on the server (another tab, before a reload): show that one instead.
      if (err instanceof ApiError && err.status === 409 && project) {
        const { job: running } = await msApi.agentLatest(project.id).catch(() => ({ job: null }));
        if (running && !running.finished) { await attachAgent(running.id); flash('Agent vẫn đang chạy trên dự án này — đang hiện tiến độ của nó (bấm Dừng nếu muốn ra lệnh mới).'); return; }
      }
      fail(err);
    }
  })();
  useEffect(() => {
    if (!job || job.finished) return;
    let stop = false, after = 0, rev = 0;
    // What was there before: one undo brings it back, however much the agent built.
    const before = docRef.current;
    const poll = async () => {
      while (!stop) {
        try {
          const j = await msApi.agentGet(job.id, after, false, rev);
          after = j.total;
          if (j.steps.length) setSteps((cur) => [...cur, ...j.steps]);
          // The work in progress, live: each floor plan and storey as the agent makes it.
          if (j.doc && !j.finished) { rev = j.revision; setDoc(j.doc); }
          if (j.status !== 'running') setJob((cur) => (cur && cur.status !== j.status ? { ...cur, status: j.status } : cur));
          if (j.finished) {
            setJob(j);
            // The agent's work: saved as a version on the server (undo still brings back what was before).
            if (j.savedVersion && project) {
              const p = await msApi.get(project.id);
              if (before) { undo.current.push(before); redo.current = []; }
              setDoc(p.doc); setVersion(p.version); setDirty(false); setVersions(await msApi.versions(project.id));
              requestAnimationFrame(() => view.current?.focusSelection());
            } else if (j.saveError) {
              const full = await msApi.agentGet(job.id, j.total, true);
              if (full.doc && before) { undo.current.push(before); setDoc(full.doc); setDirty(true); }
              flash(`Agent xong nhưng chưa lưu được: ${j.saveError}`, true);
            }
            return;
          }
        } catch (err) { fail(err); return; }
        await new Promise((r) => setTimeout(r, 700));
      }
    };
    void poll();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.finished]);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [steps.length]);

  /* ---------------------------------------------------------------------- UI */

  if (auth === 'login') return <Login onDone={() => window.location.reload()} />;
  const saveDot = saving === 'saving' ? s.busy : saving === 'error' ? s.err : dirty ? s.dirty : '';
  const running = job?.status === 'running';

  return (
    <div className={s.studio}>
      <header className={s.top}>
        <Link href="/studio" className={s.back} title="Về Studio"><Icon name="lucide:arrow-left" /></Link>
        <div className={s.title}>
          <strong>{doc?.name ?? 'Model Studio'}</strong>
          <small><span className={`${s.dot} ${saveDot}`} />{project ? (preview !== null ? `Đang xem phiên bản ${preview}` : saving === 'saving' ? 'Đang lưu…' : saving === 'error' ? 'Lưu lỗi' : dirty ? 'Chưa lưu' : `Đã lưu · v${version}`) : 'Quản lý model'}</small>
        </div>
        <button className={s.ibtn} title="Hoàn tác (Ctrl+Z)" disabled={!undo.current.length || preview !== null} onClick={doUndo}><Icon name="lucide:undo-2" /></button>
        <button className={s.ibtn} title="Làm lại (Ctrl+Y)" disabled={!redo.current.length || preview !== null} onClick={doRedo}><Icon name="lucide:redo-2" /></button>
        <span className={s.sep} />
        <button className={s.tbtn} disabled={!doc || preview !== null} onClick={() => setAddOpen((o) => !o)}><Icon name="lucide:plus" /> Thêm</button>
        <button className={s.tbtn} disabled={!doc || preview !== null} onClick={() => setHouseOpen(true)}><Icon name="lucide:house" /> Sinh nhà</button>
        <span className={s.spacer} />
        {preview !== null && <button className={`${s.tbtn} ${s.on}`} onClick={endPreview}>Thoát xem phiên bản</button>}
        {status && <button className={`${s.tbtn} ${status.ai ? '' : s.on}`} title="API key và model của AI agent" onClick={() => setAiOpen(true)}><Icon name="lucide:key-round" /> {status.ai ? `AI · ${status.model}` : 'Cấu hình AI'}</button>}
        <button className={s.tbtn} disabled={!doc || busy || preview !== null} onClick={() => void save({ note: 'Lưu thủ công' })}><Icon name="lucide:save" /> Lưu bản</button>
        <button className={`${s.tbtn} ${s.primary}`} disabled={!doc || busy} onClick={() => setRight('versions')}><Icon name="lucide:rocket" /> Xuất / Xuất bản</button>
        <button className={`${s.tbtn} ${s.danger}`} disabled={!project || busy || running} title="Xóa dự án đang mở (khôi phục được trong Dự án › Đã xóa)"
          onClick={() => { if (project && confirm(`Xóa dự án "${doc?.name ?? ''}"? Có thể khôi phục trong mục "Đã xóa".`)) void withBusy(async () => { await msApi.remove(project.id); setProject(null); setDoc(null); await refreshList(); setLeft('projects'); flash('Đã xóa dự án — khôi phục trong mục "Đã xóa".'); }); }}><Icon name="lucide:trash-2" /> Xóa dự án</button>
      </header>

      <aside className={s.left}>
        <div className={s.tabs}>
          {([['projects', 'lucide:folder', 'Dự án'], ['library', 'lucide:library', 'Thư viện'], ['scene', 'lucide:list-tree', 'Cảnh']] as const).map(([k, icon, n]) => <button key={k} className={`${s.tab} ${left === k ? s.on : ''}`} onClick={() => setLeft(k)}><Icon name={icon} /> {n}</button>)}
        </div>
        {left === 'projects' && <ProjectsPanel projects={projects} deleted={deleted} current={project?.id ?? null} open={(id) => void open(id)}
          create={(name) => void withBusy(async () => { const p = await msApi.create(name, emptyDoc(name)); await refreshList(); await open(p.id); })}
          rename={(id, name) => void withBusy(async () => { await msApi.rename(id, name); await refreshList(); if (project?.id === id) await open(id); })}
          duplicate={(id) => void withBusy(async () => { const p = await msApi.duplicate(id); await refreshList(); await open(p.id); })}
          remove={(id) => void withBusy(async () => { await msApi.remove(id); await refreshList(); if (project?.id === id) { setProject(null); setDoc(null); } })}
          undelete={(id) => void withBusy(async () => { await msApi.undelete(id); await refreshList(); })}
          purge={(id) => void withBusy(async () => { await msApi.purge(id); await refreshList(); flash('Đã xóa vĩnh viễn.'); })} />}
        {left === 'library' && view.current && <LibraryPanel registry={view.current.registry} files={project?.files ?? []} doc={doc}
          addAsset={(id) => doc && add('Thêm model game', (b, parent) => b.asset(view.current!.registry.byNumericId(id)?.name ?? `#${id}`, parent, id))}
          addPreset={(preset) => doc && mutate('Thêm vật liệu', (d) => { new DocBuilder(d).material(`${preset}-${d.materials.filter((m) => m.preset === preset).length + 1}`, preset); })}
          importFile={importFile}
          addImport={(f) => mutate('Đặt file import', (d) => { d.nodes.push({ id: `import-${f.id.slice(0, 8)}-${d.nodes.length}`, name: f.name.slice(0, 80), kind: 'import', file: f.id, fileName: f.name.slice(0, 200), parent: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }); })}
          useImage={(f) => { setRight('material'); flash(`Chọn vật liệu rồi đặt "Ảnh màu nền" = ${f.name}.`); }} />}
        {left === 'scene' && doc && <HierarchyPanel doc={doc} selected={selected} select={(id, additive) => setSelected((cur) => (additive ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]))} mutate={mutate} />}
        {!doc && left === 'scene' && <div className={s.pane}><p className={s.muted}>Mở hoặc tạo một dự án.</p></div>}
      </aside>

      <main className={s.view}>
        <div ref={host} className={s.canvas} />
        {doc && (
          <div className={s.toolbar}>
            <div className={s.group}>
              {([['translate', 'lucide:move-3d', 'Di chuyển (W)'], ['rotate', 'lucide:rotate-3d', 'Xoay (E)'], ['scale', 'lucide:scaling', 'Tỉ lệ (R)']] as const).map(([k, icon, t]) => <button key={k} className={`${s.ibtn} ${gizmo === k ? s.on : ''}`} title={t} onClick={() => setGizmo(k)}><Icon name={icon} /></button>)}
              <button className={s.ibtn} title={space === 'world' ? 'Trục thế giới' : 'Trục cục bộ'} onClick={() => setSpace(space === 'world' ? 'local' : 'world')}><Icon name={space === 'world' ? 'lucide:globe' : 'lucide:box'} /></button>
            </div>
            <div className={s.group} title="Bắt lưới / góc / tỉ lệ">
              <button className={`${s.ibtn} ${snapOn ? s.on : ''}`} title="Bắt lưới" onClick={() => setSnapOn(!snapOn)}><Icon name="lucide:magnet" /></button>
              <input type="number" step={.05} min={.01} value={snap.move} onChange={(e) => setSnap({ ...snap, move: Math.max(.01, Number(e.target.value) || .25) })} title="Bước di chuyển (m)" />
              <input type="number" step={5} min={1} value={snap.angle} onChange={(e) => setSnap({ ...snap, angle: Math.max(1, Number(e.target.value) || 15) })} title="Bước xoay (°)" />
            </div>
            <div className={s.group}>
              <button className={s.ibtn} title="Nhân bản (Ctrl+D) · Sao chép Ctrl+C, dán Ctrl+V" disabled={!selected.length} onClick={duplicateSel}><Icon name="lucide:copy" /></button>
              <button className={s.ibtn} title="Gom nhóm (Ctrl+G)" disabled={!selected.length} onClick={groupSel}><Icon name="lucide:group" /></button>
              <button className={s.ibtn} title="Đặt xuống bề mặt bên dưới" disabled={!selected.length} onClick={dropSel}><Icon name="lucide:arrow-down-to-line" /></button>
              <button className={s.ibtn} title="Xóa (Delete)" disabled={!selected.length} onClick={deleteSel}><Icon name="lucide:trash-2" /></button>
              <button className={s.ibtn} title="Nhìn vào phần chọn (F)" onClick={() => view.current?.focusSelection()}><Icon name="lucide:focus" /></button>
            </div>
            <div className={s.group}>
              <select value={mode} onChange={(e) => setMode(e.target.value as DisplayMode)} title="Chế độ hiển thị">
                <option value="lit">PBR</option><option value="clay">Đất sét</option><option value="wire">Khung lưới</option><option value="uv">Kiểm tra UV</option><option value="collision">Va chạm</option>
              </select>
              <button className={`${s.ibtn} ${grid ? s.on : ''}`} title="Lưới" onClick={() => setGrid(!grid)}><Icon name="lucide:grid-3x3" /></button>
              <button className={`${s.ibtn} ${plansOn ? s.on : ''}`} title="Bản vẽ mặt bằng" onClick={() => setPlansOn(!plansOn)}><Icon name="lucide:map" /></button>
            </div>
          </div>
        )}
        {addOpen && doc && <AddMenu add={add} mat={mat} />}
        {conflict && <div className={s.banner}>{conflict}<button className={s.tbtn} onClick={() => project && void open(project.id)}>Tải lại</button></div>}
        {toast && <div className={`${s.toast} ${toast.bad ? s.bad : ''}`} onClick={() => setToast(null)}>{toast.text}</div>}
        {project && (
          <div className={s.agent}>
            <div className={s.agentHead}>
              <Icon name="lucide:sparkles" /><strong>AI Agent</strong>
              <span>{job ? `${job.mode === 'ai' ? `AI ${job.model ?? ''}` : 'bộ lập kế hoạch tích hợp'} · ${job.status === 'running' ? 'đang làm…' : job.status === 'done' ? 'xong' : job.status === 'cancelled' ? 'đã dừng' : 'lỗi'}${job.usage.turns ? ` · ${job.usage.turns} lượt, ${job.usage.total.toLocaleString('vi-VN')} token` : ''}` : 'mô tả model bạn muốn — agent gọi các công cụ của Studio để dựng, gán vật liệu, kiểm tra và tự sửa'}</span>
              <span className={s.spacer} />
              {steps.length > 0 && <button className={s.ibtn} title={agentOpen ? 'Thu gọn' : 'Mở nhật ký'} onClick={() => setAgentOpen(!agentOpen)}><Icon name={agentOpen ? 'lucide:chevron-down' : 'lucide:chevron-up'} /></button>}
            </div>
            {agentOpen && steps.length > 0 && (
              <div className={s.agentLog} ref={logRef}>
                {steps.map((st, i) => (
                  <div key={i} className={`${s.step} ${st.kind === 'tool' ? `${s.tool} ${st.ok ? s.ok : s.bad}` : st.kind === 'plan' ? s.plan : st.kind === 'done' ? s.done : st.kind === 'error' ? s.bad : ''}`}>
                    {st.kind === 'tool' ? <details><summary>{st.text}</summary><pre>{JSON.stringify(st.args, null, 1)}</pre><pre>{typeof st.result === 'string' ? st.result : JSON.stringify(st.result, null, 1)}</pre></details> : st.text}
                  </div>
                ))}
                {job && job.status !== 'running' && job.issues.length > 0 && <div className={s.step}>Còn tồn tại:{'\n'}• {job.issues.join('\n• ')}</div>}
                {job?.publishRequests.map((r) => (
                  <div key={r.id} className={`${s.step} ${s.plan}`}>Agent đề nghị xuất bản model vào game{r.lotClass ? ` (lô ${r.lotClass})` : ''}.{' '}
                    <button className={`${s.tbtn} ${s.primary}`} onClick={() => void withBusy(async () => { await msApi.agentPublish(job.id, r.id, true); setJob({ ...job, publishRequests: job.publishRequests.filter((x) => x.id !== r.id) }); await refreshPublished(); flash('Đã xuất bản.'); })}>Xác nhận</button>{' '}
                    <button className={s.tbtn} onClick={() => void msApi.agentPublish(job.id, r.id, false).then(() => setJob({ ...job, publishRequests: job.publishRequests.filter((x) => x.id !== r.id) }))}>Bỏ qua</button>
                  </div>
                ))}
              </div>
            )}
            {!running && !steps.length && <div className={s.chips} style={{ padding: '6px 10px 0' }}>{EXAMPLES.map((e) => <button key={e} className={s.chip} title={e} onClick={() => setPrompt(e)}>{e.slice(0, 48)}…</button>)}</div>}
            <form className={s.prompt} onSubmit={(e) => { e.preventDefault(); runAgent(); }}>
              <textarea value={prompt} placeholder="Ví dụ: Tạo một căn nhà bỏ hoang 2 tầng có sân vườn và hàng rào…" onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runAgent(); } }} disabled={running || preview !== null} />
              {running ? <button type="button" className={`${s.tbtn} ${s.danger}`} onClick={() => job && void msApi.agentCancel(job.id)}><Icon name="lucide:square" /> Dừng</button>
                : <button className={`${s.tbtn} ${s.primary}`} disabled={!prompt.trim() || preview !== null}><Icon name="lucide:send" /> Gửi</button>}
            </form>
          </div>
        )}
        {!project && auth === 'ok' && <div className={s.toast} style={{ left: 12, right: 'auto', top: 12 }}>Chọn hoặc tạo một dự án ở cột trái để bắt đầu.</div>}
      </main>

      <aside className={s.right}>
        <div className={s.tabs}>
          {([['props', 'lucide:sliders-horizontal', 'Thuộc tính'], ['material', 'lucide:palette', 'Vật liệu'], ['checks', 'lucide:shield-check', 'Kiểm tra'], ['versions', 'lucide:history', 'Xuất bản']] as const).map(([k, icon, n]) => (
            <button key={k} className={`${s.tab} ${right === k ? s.on : ''}`} onClick={() => setRight(k)}><Icon name={icon} /> {n}{k === 'checks' && report && !report.ok ? ' ⚠' : ''}</button>
          ))}
        </div>
        {doc && right === 'props' && <Inspector doc={doc} nodes={selectedNodes} mutate={mutate} />}
        {doc && right === 'material' && <MaterialPanel doc={doc} nodes={selectedNodes} mutate={mutate} files={project?.files ?? []} projectId={project?.id ?? ''} addFiles={(f) => setProject((p) => (p ? { ...p, files: [...p.files, ...f.filter((x) => !p.files.some((y) => y.id === x.id))] } : p))} />}
        {doc && right === 'checks' && <ChecksPanel report={report} server={serverReport} select={(id) => setSelected([id])}
          fix={() => { if (!report) return; let done: string[] = []; mutate('Tự sửa', (d) => { done = autoFix(d, validateDoc(d)); }); setServerReport(null); flash(done.length ? done.join(' ') : 'Không có gì để tự sửa.'); }}
          runServer={() => void withBusy(async () => setServerReport(await msApi.validate(doc, project?.id)))} />}
        {doc && right === 'versions' && project && <VersionsPanel doc={doc} mutate={mutate} versions={versions} published={published} projectId={project.id} trial={trial} busy={busy}
          snapshot={snapshot} preview={previewVersion} restore={restoreVersion} exportGlb={exportGlb} publish={publish} unpublish={unpublish} setTrial={setTrialAssets} />}
      </aside>

      <footer className={s.status}>
        <span>{stats.triangles.toLocaleString('vi-VN')} tam giác</span>
        <span>{stats.meshes} lưới</span>
        {report && <span>≈ {report.stats.drawCalls} draw call khi xuất</span>}
        {doc && <span>{doc.nodes.length} phần · {doc.materials.length} vật liệu</span>}
        {stats.pendingTextures > 0 && <span>đang sinh texture ({stats.pendingTextures})…</span>}
        {selectedNodes.length > 0 && <span>Chọn: {selectedNodes.map((n) => n.name).join(', ').slice(0, 80)}</span>}
        <span className={s.spacer} />
        <span>W/E/R · F · Ctrl+Z/Y · Ctrl+D · Ctrl+G · Del · Ctrl+S</span>
      </footer>

      {aiOpen && <AiDialog close={() => setAiOpen(false)} saved={(st) => { setStatus({ ai: st.configured, model: st.configured ? st.model : null }); flash(st.configured ? `AI agent dùng ${st.model}.` : 'Đã bỏ API key: agent dùng bộ lập kế hoạch tích hợp.'); }} />}
      {houseOpen && doc && <HouseDialog close={() => setHouseOpen(false)} make={(spec) => { setHouseOpen(false); add('Sinh nhà', (b, parent) => { const r = generateHouse(b.doc, spec, parent); b.doc.kind = 'building'; flash(`Nhà ${r.floors} tầng, ${r.rooms.length} phòng, ${r.doors} cửa, ${r.windows} cửa sổ, ${r.furniture} món nội thất (${r.footprint.width}×${r.footprint.depth} m).`); return r.root; }); }} />}
    </div>
  );
}

/** A GLB exported (editable) by the Model Studio carries its project in the scene extras. */
async function readEditable(bytes: Uint8Array): Promise<ModelDoc | null> {
  try {
    const { readGltf } = await import('@zion/assets/model-studio');
    const scene = readGltf(bytes);
    return scene.extras?.zionModelDoc ? parseDoc(scene.extras.zionModelDoc) : null;
  } catch { return null; }
}

function AddMenu({ add, mat }: { add: (label: string, fn: (b: DocBuilder, parent: string | null) => string) => void; mat: (b: DocBuilder, preset: string) => string }) {
  const prim = (shape: 'box' | 'cylinder' | 'cone' | 'sphere' | 'plane' | 'wedge' | 'torus' | 'capsule', params: Record<string, number>, name: string) =>
    add(`Thêm ${name}`, (b, parent) => b.primitive(name, parent, shape, params, mat(b, 'concrete')));
  return (
    <div className={s.addMenu}>
      <div className={s.section}><h3>Hình khối</h3><div className={s.chips}>
        <button className={s.chip} onClick={() => prim('box', { width: 1, height: 1, depth: 1 }, 'Hộp')}>Hộp</button>
        <button className={s.chip} onClick={() => prim('cylinder', { radius: .5, height: 1, segments: 24 }, 'Trụ')}>Trụ</button>
        <button className={s.chip} onClick={() => prim('cone', { radius: .5, radiusTop: 0, height: 1, segments: 24 }, 'Nón')}>Nón</button>
        <button className={s.chip} onClick={() => prim('sphere', { radius: .5, segments: 24 }, 'Cầu')}>Cầu</button>
        <button className={s.chip} onClick={() => prim('capsule', { radius: .3, height: 1.6, segments: 16 }, 'Viên nang')}>Viên nang</button>
        <button className={s.chip} onClick={() => prim('wedge', { width: 1, height: 1, depth: 1, ridge: .5 }, 'Lăng trụ')}>Lăng trụ</button>
        <button className={s.chip} onClick={() => prim('torus', { radius: .5, tube: .12, segments: 32 }, 'Xuyến')}>Xuyến</button>
        <button className={s.chip} onClick={() => prim('plane', { width: 2, depth: 2 }, 'Mặt phẳng')}>Mặt phẳng</button>
        <button className={s.chip} onClick={() => add('Nhóm', (b, parent) => b.group('Nhóm', parent))}>Nhóm rỗng</button>
      </div></div>
      <div className={s.section}><h3>Kiến trúc</h3><div className={s.chips}>
        <button className={s.chip} onClick={() => add('Tường', (b, parent) => b.wall('Tường', parent, 4, 2.8, .2, [{ kind: 'window', offset: 0, width: 1.2, height: 1.2, sill: .9 }], mat(b, 'plaster_white'), {}))}>Tường có cửa sổ</button>
        <button className={s.chip} onClick={() => add('Tường', (b, parent) => b.wall('Tường', parent, 4, 2.8, .2, [{ kind: 'door', offset: 0, width: .9, height: 2.1, sill: 0 }], mat(b, 'brick_red'), {}))}>Tường có cửa đi</button>
        <button className={s.chip} onClick={() => add('Sàn', (b, parent) => b.slab('Sàn', parent, 4, 4, .15, [], mat(b, 'wood_planks'), {}))}>Sàn</button>
        <button className={s.chip} onClick={() => add('Cầu thang', (b, parent) => b.stairs('Cầu thang', parent, 1, 2.9, 4.32, 16, mat(b, 'wood_oak'), {}))}>Cầu thang</button>
        <button className={s.chip} onClick={() => add('Mái', (b, parent) => b.roof('Mái', parent, { style: 'gable', width: 8, depth: 6, rise: 2, overhang: .4, thickness: .14, damage: 0, seed: 1 }, mat(b, 'roof_tiles'), { position: [0, 2.8, 0] }))}>Mái hai mái</button>
      </div></div>
      <div className={s.section}><h3>Tự nhiên</h3><div className={s.chips}>
        <button className={s.chip} onClick={() => add('Tảng đá', (b, parent) => b.rock('Tảng đá', parent, { width: 2, height: 1.4, depth: 1.8, roughness: .6, layers: .4, detail: 4, seed: Math.floor(Math.random() * 1e6) }, mat(b, 'rock_granite')))}>Tảng đá</button>
        <button className={s.chip} onClick={() => add('Đá lớp', (b, parent) => b.rock('Đá trầm tích', parent, { width: 3.5, height: 2.2, depth: 3, roughness: .5, layers: .85, detail: 4, seed: Math.floor(Math.random() * 1e6) }, mat(b, 'rock_sandstone')))}>Đá nhiều lớp</button>
      </div></div>
      <div className={s.section}><h3>Nội thất</h3><div className={s.chips}>
        {FURNITURE_KINDS.map((k) => <button key={k} className={s.chip} onClick={() => add(furnitureLabel(k), (b, parent) => furniture(b, k, parent, { wood: mat(b, 'wood_oak'), fabric: mat(b, 'fabric'), metal: mat(b, 'metal_steel'), ceramic: mat(b, 'paint_metal'), top: mat(b, 'ceramic_tiles') }, { position: [0, 0, 0], yaw: 0 }))}>{furnitureLabel(k)}</button>)}
      </div></div>
    </div>
  );
}

function HouseDialog({ close, make }: { close(): void; make(spec: Parameters<typeof generateHouse>[1]): void }) {
  const [style, setStyle] = useState<'rural' | 'modern' | 'postapoc' | 'cottage'>('rural');
  const [floors, setFloors] = useState<1 | 2>(1);
  const [rooms, setRooms] = useState<Record<string, number>>({ living: 1, kitchen: 1, dining: 1, bedroom: 2, bathroom: 1, storage: 0 });
  const [years, setYears] = useState(0);
  const [opts, setOpts] = useState({ furniture: true, yard: true, fence: true, garden: true });
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  const NAMES: Record<string, string> = { living: 'Phòng khách', kitchen: 'Nhà bếp', dining: 'Phòng ăn', bedroom: 'Phòng ngủ', bathroom: 'Phòng tắm', storage: 'Kho' };
  return (
    <div className={s.modalBack} onClick={close}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <h2>Sinh ngôi nhà hoàn chỉnh</h2>
        <div className={s.row}><label>Phong cách</label><select className={s.select} value={style} onChange={(e) => setStyle(e.target.value as typeof style)}>
          <option value="rural">Nông thôn (vữa/gạch, mái ngói)</option><option value="modern">Hiện đại (bê tông, mái bằng)</option><option value="postapoc">Hậu tận thế (gạch, mái tôn gỉ)</option><option value="cottage">Nhà đá (mái bốn mái)</option>
        </select></div>
        <div className={s.row}><label>Số tầng</label><select className={s.select} value={floors} onChange={(e) => setFloors(Number(e.target.value) as 1 | 2)}><option value={1}>1 tầng</option><option value={2}>2 tầng (cầu thang, phòng ngủ trên lầu)</option></select></div>
        {ROOM_TYPES.filter((r) => r !== 'hall').map((r) => (
          <div className={s.row} key={r}><label>{NAMES[r]}</label><input type="number" className={s.num} min={r === 'living' ? 1 : 0} max={4} value={rooms[r] ?? 0} onChange={(e) => setRooms({ ...rooms, [r]: Math.max(r === 'living' ? 1 : 0, Math.min(4, Number(e.target.value) || 0)) })} /></div>
        ))}
        <div className={s.row}><label>Bỏ hoang</label><input type="range" min={0} max={300} step={10} value={years} onChange={(e) => setYears(Number(e.target.value))} /><span className={s.muted} style={{ width: 60 }}>{years} năm</span></div>
        <div className={s.chips}>{(Object.keys(opts) as Array<keyof typeof opts>).map((k) => <button key={k} className={`${s.chip} ${opts[k] ? s.on : ''}`} onClick={() => setOpts({ ...opts, [k]: !opts[k] })}>{({ furniture: 'Nội thất', yard: 'Sân', fence: 'Hàng rào', garden: 'Vườn cây' } as const)[k]}</button>)}</div>
        <div className={s.row} style={{ marginTop: 8 }}><label>Seed</label><input type="number" className={s.num} value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} /><button className={s.tbtn} onClick={() => setSeed(Math.floor(Math.random() * 100000))}>Ngẫu nhiên</button></div>
        <div className={s.modalActions}>
          <button className={s.tbtn} onClick={close}>Hủy</button>
          <button className={`${s.tbtn} ${s.primary}`} onClick={() => make({ style, floors, seed, abandonedYears: years, ...opts, rooms: Object.entries(rooms).flatMap(([r, n]) => Array.from({ length: n }, () => r as never)), name: years >= 100 ? 'Nhà bỏ hoang' : 'Ngôi nhà' })}>Sinh nhà</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The agent's AI connection: API key (sent to the server once, stored encrypted there, shown back
 * only as its last four characters), endpoint, and the model picked from what the endpoint offers.
 */
function AiDialog({ close, saved }: { close(): void; saved(st: AiStatus): void }) {
  const [st, setSt] = useState<AiStatus | null>(null);
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [custom, setCustom] = useState(false);
  const [imageModel, setImageModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const loadModels = useCallback(async () => {
    setBusy(true);
    try { const r = await msApi.aiModels(); setModels(r.models); setListError(r.error); } catch (e) { setListError((e as Error).message); } finally { setBusy(false); }
  }, []);
  useEffect(() => {
    void (async () => {
      try { const a = await msApi.ai(); setSt(a); setBaseUrl(a.baseUrl); setModel(a.model); setImageModel(a.imageModel ?? ''); await loadModels(); } catch (e) { setErr((e as Error).message); }
    })();
  }, [loadModels]);
  const save = async (body: { apiKey?: string; baseUrl?: string; model?: string; imageModel?: string }) => {
    setBusy(true); setErr(null);
    try {
      const a = await msApi.setAi(body);
      setSt(a); setKey('');
      saved(a);
      return a;
    } catch (e) { setErr((e as Error).message); return null; } finally { setBusy(false); }
  };
  const options = [...new Set([...(model ? [model] : []), ...models])];
  return (
    <div className={s.modalBack} onClick={close}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <h2>Cấu hình AI cho Model Studio</h2>
        <p className={s.muted}>
          {st ? (st.configured ? `Đang dùng key ${st.keyHint} (${st.source === 'studio' ? 'nhập trong Studio' : 'từ biến môi trường server'}).` : 'Chưa có API key — agent đang dùng bộ lập kế hoạch tích hợp.') : 'Đang tải…'}
          {' '}Key được gửi lên máy chủ một lần và lưu mã hóa ở đó; trình duyệt không giữ lại.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); if (key.trim()) void save({ apiKey: key.trim(), baseUrl, ...(model ? { model } : {}) }).then((a) => { if (a) void loadModels(); }); }}>
          <div className={s.row}><label>API key</label><input className={s.text} type="password" autoComplete="off" spellCheck={false} value={key} placeholder={st?.keyHint ? `${st.keyHint} — nhập để thay` : 'sk-…'} onChange={(e) => setKey(e.target.value)} /></div>
          <div className={s.row}><label>Địa chỉ API</label><input className={s.text} value={baseUrl} placeholder="https://ai.mangso.net/v1" onChange={(e) => setBaseUrl(e.target.value)} /></div>
          <div className={s.row}><label />
            <button className={`${s.tbtn} ${s.primary}`} disabled={busy || !key.trim()}>Lưu key</button>
            {st?.source === 'studio' && <button type="button" className={`${s.tbtn} ${s.danger}`} disabled={busy} onClick={() => { if (confirm('Xóa API key đã nhập trong Studio?')) void save({ apiKey: '' }); }}>Xóa key</button>}
          </div>
        </form>
        <div className={s.section} style={{ marginTop: 12 }}>
          <h3>Model</h3>
          <div className={s.row}><label>Model</label>
            {custom
              ? <input className={s.text} value={model} placeholder="vd: cx/gpt-5.6-sol" onChange={(e) => setModel(e.target.value)} />
              : <select className={s.select} value={model} onChange={(e) => setModel(e.target.value)}>{options.map((m) => <option key={m} value={m}>{m}</option>)}</select>}
          </div>
          <div className={s.row}><label />
            <button type="button" className={s.tbtn} disabled={busy} onClick={() => void loadModels()}><Icon name="lucide:refresh-cw" /> Tải danh sách</button>
            <button type="button" className={s.tbtn} onClick={() => setCustom(!custom)}>{custom ? 'Chọn từ danh sách' : 'Nhập tên khác'}</button>
          </div>
          {listError && <p className={s.muted}>⚠ {listError}</p>}
          {!listError && models.length > 0 && <p className={s.muted}>{models.length} model từ máy chủ AI.</p>}
        </div>
        <div className={s.section}>
          <h3>Model vẽ texture</h3>
          <div className={s.row}><label>Model ảnh</label><input className={s.text} value={imageModel} placeholder="cx/gpt-image-2.5" onChange={(e) => setImageModel(e.target.value)} />
            <button type="button" className={s.tbtn} disabled={busy || !imageModel || imageModel === st?.imageModel} onClick={() => void save({ imageModel })}>Lưu</button></div>
          <p className={s.muted}>Dùng khi AI tự vẽ texture (paint_texture). Cùng API key và địa chỉ ở trên.</p>
        </div>
        {err && <p style={{ color: '#ff8b80' }}>{err}</p>}
        <div className={s.modalActions}>
          <button className={s.tbtn} onClick={close}>Đóng</button>
          <button className={`${s.tbtn} ${s.primary}`} disabled={busy || !model || (model === st?.model && baseUrl === st?.baseUrl)} onClick={() => void save({ model, baseUrl }).then((a) => { if (a) close(); })}>Lưu model</button>
        </div>
      </div>
    </div>
  );
}

function Login({ onDone }: { onDone(): void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className={s.login}>
      <form onSubmit={(e) => { e.preventDefault(); studioLogin(pw).then(onDone).catch((x: Error) => setErr(x.message)); }}>
        <h2 style={{ margin: 0 }}>Model Studio</h2>
        <p className={s.muted}>Nhập mật khẩu Studio.</p>
        <input className={s.text} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {err && <p style={{ color: '#ff8b80', margin: 0 }}>{err}</p>}
        <button className={`${s.tbtn} ${s.primary}`}>Mở</button>
        <Link href="/studio" className={s.muted}>← Về Studio</Link>
      </form>
    </div>
  );
}
