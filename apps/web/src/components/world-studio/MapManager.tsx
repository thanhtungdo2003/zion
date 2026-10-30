'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BATTLE_MAP } from '@zion/shared';
import { CLIMATES, Heightfield, MAP_KINDS, type Climate, MAP_SIZES, TERRAIN_PRESETS, duplicateMap, fromStoredBattleMap, newId, parseMapFile, type MapKind, type TerrainPreset, type WorldMapMeta } from '@zion/worldgen/editor';
import { DEFAULT_AUTO, type AutoParams, type MapTemplate, type NewMapRequest } from '@zion/worldgen/editor/templates';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { hasStudioSession, publishedMapId, studioBattleMap, studioBattleMaps, studioLogin, studioUnpublishBattleMap, type PublishedBattleMap } from '@/lib/api';
import { deleteMap, listMaps, loadMap, saveMap, saveMeta } from '@/studio/world/map-store';
import { JobError, runJob } from '@/studio/world/worker-client';
import { Seg, Slider, fmtTime } from './ui';
import s from './world-studio.module.css';

const TEMPLATES: Array<{ id: MapTemplate; name: string; description: string; icon: string }> = [
  { id: 'auto', name: 'Tự động — bản đồ đầy đủ', description: 'Chỉnh tham số, hệ thống tự sinh địa hình, núi đồi, sông hồ, thành phố, thị trấn, làng, khu công nghiệp, căn cứ, cảng, đường nối, rừng và cấu hình trận.', icon: 'wand' },
  { id: 'hac-son', name: 'Đảo Hắc Sơn — bản đồ BR hiện tại', description: 'Lấy địa hình, bề mặt, 14 tuyến đường, công trình, địa danh và luật bo từ bộ sinh map của game (4096 m).', icon: 'island' },
  { id: 'procedural', name: 'Sinh từ seed', description: 'Đồng bằng, đồi, núi, thung lũng, đảo hoặc hỗn hợp — nhiều lớp noise, cùng seed cho cùng kết quả.', icon: 'dices' },
  { id: 'blank', name: 'Bản đồ trống', description: 'Mặt đất phẳng để tự nặn từ đầu.', icon: 'square' },
];
const kindName = (k: string) => MAP_KINDS.find((m) => m.id === k)?.name ?? k;
type Sort = 'updated' | 'name' | 'size' | 'created';

export function MapManager({ onOpen }: { onOpen: (id: string) => void }) {
  const [maps, setMaps] = useState<WorldMapMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | MapKind>('all');
  const [sort, setSort] = useState<Sort>('updated');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WorldMapMeta | null>(null);
  const [removing, setRemoving] = useState<WorldMapMeta | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Maps on the game server: the library above lives in this browser only, so maps published from
  // another machine (or whose local copy was deleted) are listed from the server.
  const [where, setWhere] = useState<'local' | 'server'>('local');
  const [published, setPublished] = useState<PublishedBattleMap[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [login, setLogin] = useState(false);
  const [unpublishing, setUnpublishing] = useState<PublishedBattleMap | null>(null);

  const refresh = useCallback(async () => {
    try { setMaps(await listMaps()); setError(null); } catch (err) { setError(err instanceof Error ? err.message : String(err)); setMaps([]); }
  }, []);
  const refreshServer = useCallback(async () => {
    if (!hasStudioSession()) { setPublished(null); setServerError('login'); return; }
    try { setPublished(await studioBattleMaps()); setServerError(null); }
    catch (err) { setServerError(err instanceof Error ? err.message : String(err)); }
  }, []);
  useEffect(() => { void refresh(); void refreshServer(); }, [refresh, refreshServer]);
  const publishedIds = useMemo(() => new Set((published ?? []).map((p) => p.id)), [published]);
  const localFor = (p: PublishedBattleMap) => (maps ?? []).find((m) => publishedMapId(m.id) === p.id);
  const openPublished = async (p: PublishedBattleMap) => {
    const local = localFor(p);
    if (local) { onOpen(local.id); return; }
    setBusy(`Đang tải "${p.name}" từ máy chủ…`);
    try {
      const { doc, terrain, complete } = fromStoredBattleMap(await studioBattleMap(p.id));
      if (p.thumbnail && p.thumbnail.length < 200_000) doc.meta.thumbnail = p.thumbnail;
      await saveMap(doc, terrain);
      if (!complete) setError(`"${p.name}" được xuất bản từ bản cũ: chỉ có địa hình, cây cối và đường/công trình làm lớp tham chiếu.`);
      onOpen(doc.meta.id);
    } catch (err) { setError(`Không tải được: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setBusy(null); }
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (maps ?? []).filter((m) => (kind === 'all' || m.kind === kind) && (!q || m.name.toLowerCase().includes(q) || m.seed.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)));
    const by: Record<Sort, (a: WorldMapMeta, b: WorldMapMeta) => number> = {
      updated: (a, b) => b.updatedAt - a.updatedAt, created: (a, b) => b.createdAt - a.createdAt,
      name: (a, b) => a.name.localeCompare(b.name, 'vi'), size: (a, b) => b.size - a.size || b.updatedAt - a.updatedAt,
    };
    return list.sort(by[sort]);
  }, [kind, maps, search, sort]);

  const duplicate = async (m: WorldMapMeta) => {
    setBusy(`Đang nhân bản "${m.name}"…`);
    try { const { doc, terrain } = await loadMap(m.id); await saveMap(duplicateMap(doc), terrain); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  };
  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setBusy(`Đang nhập ${f.name}…`);
      try {
        const { doc, terrain } = parseMapFile(await f.text());
        // Never overwrite a map already in the library.
        if ((maps ?? []).some((m) => m.id === doc.meta.id)) doc.meta = { ...doc.meta, id: newId('map'), name: `${doc.meta.name} (nhập)` };
        await saveMap(doc, terrain); await refresh();
      } catch (err) { setError(`Không nhập được: ${err instanceof Error ? err.message : String(err)}`); }
      finally { setBusy(null); }
    };
    input.click();
  };

  return <div className={s.manager} data-testid="map-manager">
    <header className={s.managerTop}>
      <Link className={s.back} href="/studio" title="Về Zion Studio"><Icon name="lucide:arrow-left" /></Link>
      <h1>ZION <span>World Studio</span></h1>
      <div className={s.spacer} />
      <button className={s.tbtn} onClick={importFile} data-testid="import-map"><Icon name="lucide:upload" /><span>Nhập file</span></button>
      <button className={`${s.tbtn} ${s.primary}`} onClick={() => setCreating(true)} data-testid="new-map"><Icon name="lucide:plus" /><span>Bản đồ mới</span></button>
    </header>
    <div className={s.filters}>
      <label className={s.search}><Icon name="lucide:search" /><input className={s.input} placeholder="Tìm theo tên, seed, mô tả…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search" /></label>
      <Seg value={where} options={[{ id: 'local', name: `Trong máy này (${maps?.length ?? 0})` }, { id: 'server', name: `Đã xuất bản lên game${published ? ` (${published.length})` : ''}` }]} onChange={(w) => { setWhere(w); if (w === 'server') void refreshServer(); }} />
      {where === 'local' && <Seg value={kind} options={[{ id: 'all', name: 'Tất cả' }, ...MAP_KINDS]} onChange={setKind} />}
      <select className={s.input} style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sắp xếp">
        <option value="updated">Mới sửa</option><option value="created">Mới tạo</option><option value="name">Tên A–Z</option><option value="size">Kích thước</option>
      </select>
      {busy && <span className={s.lead}>{busy}</span>}
      {error && <span className={`${s.note} ${s.err}`}>{error}</span>}
    </div>
    {where === 'server' ? <div className={s.cards} data-testid="published-maps">
      {serverError === 'login' && <div className={s.emptyState}><Icon name="lucide:lock" /><strong>Đăng nhập Studio để xem các bản đồ đã xuất bản lên máy chủ.</strong>
        <button className={`${s.btn} ${s.primary}`} onClick={() => setLogin(true)}><Icon name="lucide:log-in" />Đăng nhập</button></div>}
      {serverError && serverError !== 'login' && <div className={s.emptyState}><Icon name="lucide:cloud-off" /><strong>Không lấy được danh sách: {serverError}</strong><button className={s.btn} onClick={() => void refreshServer()}><Icon name="lucide:refresh-cw" />Thử lại</button></div>}
      {!serverError && published === null && <p className={s.lead}>Đang tải danh sách từ máy chủ…</p>}
      {!serverError && published?.length === 0 && <div className={s.emptyState}><Icon name="lucide:map" /><strong>Chưa có bản đồ nào được xuất bản.</strong><span>Mở một bản đồ › Thiết lập › Xuất bản Battle Royale.</span></div>}
      {!serverError && (published ?? []).filter((p) => { const q = search.trim().toLowerCase(); return !q || p.name.toLowerCase().includes(q) || p.id.includes(q); }).map((p) => {
        const local = localFor(p);
        return <article key={p.id} className={s.card} data-testid="published-card">
          <button className={s.thumb} style={{ backgroundImage: p.thumbnail ? `url(${p.thumbnail})` : undefined }} onClick={() => void openPublished(p)} aria-label={`Mở ${p.name}`}>
            <span className={s.kind} style={p.error ? { color: '#ff8b80' } : undefined}>{p.error ? 'Lỗi dựng' : p.live ? 'Đang trên game' : 'Đang tải'}</span></button>
          <div className={s.cardBody}>
            <h2 title={p.name}>{p.name}</h2>
            <div className={s.meta}>
              <span><Icon name="lucide:hash" />{p.id}</span>
              <span><Icon name="lucide:clock" />{fmtTime(Date.parse(p.updatedAt))}</span>
              <span><Icon name="lucide:users" />{p.players} người · {p.matches} trận</span>
              <span><Icon name="lucide:hard-drive" />{(p.bytes / 1024 / 1024).toFixed(1)} MB</span>
              <span><Icon name={local ? 'lucide:laptop' : 'lucide:cloud'} />{local ? 'Có trong máy này' : 'Chỉ trên máy chủ'}</span>
            </div>
            {p.error && <p className={`${s.note} ${s.err}`} title={p.error} style={{ margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.error}</p>}
            {!local && !p.editable && <p className={s.lead} style={{ margin: 0 }}>Xuất bản từ bản cũ: tải về được địa hình, cây và lớp tham chiếu đường/công trình.</p>}
            <div className={s.cardActions}>
              <button className={`${s.btn} ${s.primary}`} onClick={() => void openPublished(p)} data-testid="open-published"><Icon name={local ? 'lucide:pencil' : 'lucide:download'} />{local ? 'Mở' : 'Tải về để sửa'}</button>
              <button className={`${s.btn} ${s.danger}`} onClick={() => setUnpublishing(p)} title="Gỡ khỏi game (xóa trên máy chủ)" data-testid="unpublish-map"><Icon name="lucide:trash-2" /></button>
            </div>
          </div>
        </article>;
      })}
    </div> : <div className={s.cards}>
      {maps === null && <p className={s.lead}>Đang mở kho bản đồ…</p>}
      {maps && shown.length === 0 && <div className={s.emptyState}><Icon name="lucide:map" /><strong>{maps.length ? 'Không có bản đồ khớp bộ lọc.' : 'Chưa có bản đồ nào.'}</strong>
        {!maps.length && <><span>Tạo bản đồ đầu tiên — bắt đầu từ Đảo Hắc Sơn đang dùng trong Battle Royale, từ seed, hoặc từ mặt đất trống.</span><button className={`${s.btn} ${s.primary}`} onClick={() => setCreating(true)}><Icon name="lucide:plus" />Bản đồ mới</button></>}</div>}
      {shown.map((m) => <article key={m.id} className={s.card} data-testid="map-card">
        <button className={s.thumb} style={{ backgroundImage: m.thumbnail ? `url(${m.thumbnail})` : undefined }} onClick={() => onOpen(m.id)} aria-label={`Mở ${m.name}`}><span className={s.kind}>{kindName(m.kind)}</span></button>
        <div className={s.cardBody}>
          <h2 title={m.name}>{m.name}</h2>
          <div className={s.meta}>
            <span><Icon name="lucide:scan" />{m.size} × {m.size} m</span>
            <span><Icon name="lucide:sprout" />{m.seed}</span>
            <span><Icon name="lucide:layers" />{m.template}</span>
            <span><Icon name="lucide:clock" />{fmtTime(m.updatedAt)}</span>
            {publishedIds.has(publishedMapId(m.id)) && <span style={{ color: 'var(--accent)' }}><Icon name="lucide:rocket" />Đã xuất bản</span>}
            {published?.find((p) => p.id === publishedMapId(m.id))?.warfare && <span style={{ color: '#ff8a5a' }}><Icon name="lucide:swords" />Chiến trường</span>}
          </div>
          {m.description && <p className={s.lead} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.description}</p>}
          <div className={s.cardActions}>
            <button className={`${s.btn} ${s.primary}`} onClick={() => onOpen(m.id)} data-testid="open-map"><Icon name="lucide:pencil" />Mở</button>
            <button className={s.btn} onClick={() => setEditing(m)} title="Đổi tên / thông tin" data-testid="edit-map"><Icon name="lucide:file-pen" /></button>
            <button className={s.btn} onClick={() => void duplicate(m)} title="Nhân bản" data-testid="duplicate-map"><Icon name="lucide:copy" /></button>
            <button className={`${s.btn} ${s.danger}`} onClick={() => setRemoving(m)} title="Xóa" data-testid="delete-map"><Icon name="lucide:trash-2" /></button>
          </div>
        </div>
      </article>)}
    </div>}
    {login && <ConfirmDialog title="Đăng nhập Studio" message="Nhập mật khẩu Studio để xem và quản lý bản đồ trên máy chủ game." password danger={false} confirmLabel="Đăng nhập"
      onCancel={() => setLogin(false)} onConfirm={async (pw) => { await studioLogin(pw); setLogin(false); await refreshServer(); }} />}
    {unpublishing && <ConfirmDialog title="Gỡ bản đồ khỏi game?" message={<>Xóa <b>{unpublishing.name}</b> khỏi máy chủ: người chơi không chọn được nữa, trận đang chạy trên bản đồ này kết thúc.{localFor(unpublishing) ? ' Bản trong máy này vẫn giữ, có thể xuất bản lại.' : ' Bản đồ không có trong máy này — hãy "Tải về để sửa" trước nếu cần giữ.'}</>}
      confirmLabel="Gỡ khỏi game" onCancel={() => setUnpublishing(null)} onConfirm={async () => { await studioUnpublishBattleMap(unpublishing.id); setUnpublishing(null); await refreshServer(); }} />}
    {creating && <NewMapDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id); }} />}
    {editing && <MetaDialog meta={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />}
    {removing && <ConfirmDialog title="Xóa bản đồ?" message={<>Xóa vĩnh viễn <b>{removing.name}</b> khỏi trình duyệt này — địa hình, khu vực và mọi cấu hình trận. Không hoàn tác được; hãy xuất file trước nếu cần giữ.</>}
      confirmLabel="Xóa bản đồ" onCancel={() => setRemoving(null)} onConfirm={async () => { await deleteMap(removing.id); setRemoving(null); await refresh(); }} />}
  </div>;
}

function MetaDialog({ meta, onClose, onSaved }: { meta: WorldMapMeta; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(meta.name), [kind, setKind] = useState<MapKind>(meta.kind), [description, setDescription] = useState(meta.description);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try { const { doc } = await loadMap(meta.id); await saveMeta({ ...doc, meta: { ...doc.meta, name: name.trim().slice(0, 80) || doc.meta.name, kind, description: description.slice(0, 500), updatedAt: Date.now() } }); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  return <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <form className={s.dialog} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h2>Thông tin bản đồ</h2>
      <label className={s.field}><span className={s.fieldRow}>Tên</span><input className={s.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus data-testid="meta-dialog-name" /></label>
      <div className={s.field}><span className={s.fieldRow}>Loại</span><Seg value={kind} options={MAP_KINDS} onChange={setKind} /></div>
      <label className={s.field}><span className={s.fieldRow}>Mô tả</span><textarea className={s.input} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      {error && <p className={`${s.note} ${s.err}`}>{error}</p>}
      <div className={s.dialogActions}><button type="button" className={s.btn} onClick={onClose}>Hủy</button><button type="submit" className={`${s.btn} ${s.primary}`} data-testid="meta-dialog-save">Lưu</button></div>
    </form>
  </div>;
}

function NewMapDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [template, setTemplate] = useState<MapTemplate>('hac-son');
  const [name, setName] = useState('Đảo Hắc Sơn — bản chỉnh sửa');
  const [kind, setKind] = useState<MapKind>('battle-royale');
  const [preset, setPreset] = useState<TerrainPreset>('tectonic');
  const [size, setSize] = useState(4096);
  const [seed, setSeed] = useState(() => Math.random().toString(36).slice(2, 9));
  const p = TERRAIN_PRESETS.find((t) => t.id === preset)!;
  const [maxHeight, setMaxHeight] = useState<number>(p.maxHeight), [roughness, setRoughness] = useState<number>(p.roughness), [detail, setDetail] = useState<number>(p.detail), [seaEdge, setSeaEdge] = useState(true);
  const [job, setJob] = useState<{ label: string; value: number; cancel: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState<AutoParams>(DEFAULT_AUTO);
  const [climate, setClimate] = useState<Climate>('temperate'), [erosion, setErosion] = useState(.6);
  const choose = (t: MapTemplate) => {
    setTemplate(t);
    if (t === 'hac-son') setName('Đảo Hắc Sơn — bản chỉnh sửa'); else if (name.startsWith('Đảo Hắc Sơn')) setName(t === 'blank' ? 'Bản đồ trống' : 'Bản đồ mới');
  };
  const create = async () => {
    setError(null);
    const req: NewMapRequest = { template, name: name.trim() || 'Bản đồ mới', kind, size: template === 'hac-son' ? BATTLE_MAP.sizeChunks * 32 : size, seed: template === 'hac-son' ? BATTLE_MAP.seed : seed, preset, maxHeight, roughness, detail, seaEdge, climate, erosion, ...(template === 'auto' ? { auto } : {}) };
    const handle = runJob<'map'>({ kind: 'new-map', req }, (label, value) => setJob((j) => (j ? { ...j, label, value } : j)));
    setJob({ label: 'Đang chuẩn bị…', value: 0, cancel: handle.cancel });
    try {
      const r = await handle.promise;
      const terrain = new Heightfield(r.doc.terrain.size, r.doc.terrain.cell, new Float32Array(r.heights), new Uint8Array(r.surface));
      await saveMap(r.doc, terrain);
      onCreated(r.doc.meta.id);
    } catch (err) {
      setJob(null);
      if (!(err instanceof JobError && err.cancelled)) setError(err instanceof Error ? err.message : String(err));
    }
  };
  return <div className={s.backdrop}>
    <form className={s.dialog} onSubmit={(e) => { e.preventDefault(); if (!job) void create(); }} data-testid="new-map-dialog">
      <h2>Bản đồ mới</h2>
      <div className={s.templates}>{TEMPLATES.map((t) => <button type="button" key={t.id} className={`${s.template} ${template === t.id ? s.on : ''}`} onClick={() => choose(t.id)} data-testid={`template-${t.id}`}><strong>{t.name}</strong><small>{t.description}</small></button>)}</div>
      <label className={s.field}><span className={s.fieldRow}>Tên</span><input className={s.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="new-map-name" /></label>
      <div className={s.field}><span className={s.fieldRow}>Loại map</span><Seg value={kind} options={MAP_KINDS} onChange={setKind} /></div>
      {template !== 'hac-son' && <div className={s.field}><span className={s.fieldRow}>Kích thước</span><Seg value={String(size)} options={MAP_SIZES.map((v) => ({ id: String(v), name: `${v} m` }))} onChange={(v) => setSize(Number(v))} /></div>}
      {template === 'auto' && <div className={s.grid3}>
        {([['cities', 'Thành phố', 4], ['towns', 'Thị trấn', 8], ['villages', 'Làng', 16], ['industrial', 'Khu công nghiệp', 6], ['military', 'Căn cứ', 6], ['ports', 'Cảng', 4], ['lakes', 'Hồ', 10], ['rivers', 'Sông', 8]] as const).map(([k, label, max]) =>
          <label key={k} className={s.field}><span className={s.fieldRow}>{label}</span><input className={s.input} type="number" min={0} max={max} value={auto[k]} onChange={(e) => setAuto({ ...auto, [k]: Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0))) })} /></label>)}
      </div>}
      {template === 'auto' && <>
        <Slider label="Độ phủ rừng" min={0} max={1} step={.05} value={auto.forest} onChange={(forest) => setAuto({ ...auto, forest })} format={(v) => `${Math.round(v * 100)}%`} />
        <label className={s.check}><input type="checkbox" checked={auto.roads} onChange={(e) => setAuto({ ...auto, roads: e.target.checked })} />Nối các khu vực bằng đường</label>
      </>}
      {(template === 'procedural' || template === 'auto') && <>
        <div className={s.field}><span className={s.fieldRow}>Khí hậu chiến trường</span><Seg<Climate> value={climate} options={CLIMATES} onChange={setClimate} /></div>
        <Slider label="Xói mòn (thung lũng, khe rãnh)" min={0} max={1} step={.05} value={erosion} onChange={setErosion} format={(v) => (v ? `${Math.round(v * 100)}%` : 'Tắt')} />
        <div className={s.field}><span className={s.fieldRow}>Preset địa hình</span>
          <div className={s.grid3}>{TERRAIN_PRESETS.map((t) => <button type="button" key={t.id} className={`${s.btn} ${preset === t.id ? s.primary : ''}`} onClick={() => { setPreset(t.id); setMaxHeight(t.maxHeight); setRoughness(t.roughness); setDetail(t.detail); }}>{t.name}</button>)}</div></div>
        <label className={s.field}><span className={s.fieldRow}>Seed</span><div style={{ display: 'flex', gap: 4 }}><input className={s.input} value={seed} onChange={(e) => setSeed(e.target.value.slice(0, 64))} data-testid="new-map-seed" /><button type="button" className={s.iconBtn} onClick={() => setSeed(Math.random().toString(36).slice(2, 9))} title="Seed ngẫu nhiên"><Icon name="lucide:dices" /></button></div></label>
        <Slider label="Độ cao tối đa" unit=" m" min={5} max={800} step={5} value={maxHeight} onChange={setMaxHeight} />
        <Slider label="Độ gồ ghề" min={0} max={1} step={.05} value={roughness} onChange={setRoughness} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Mật độ chi tiết" min={1} max={8} value={detail} onChange={setDetail} />
        {preset !== 'island' && <label className={s.check}><input type="checkbox" checked={seaEdge} onChange={(e) => setSeaEdge(e.target.checked)} />Biển bao quanh</label>}
      </>}
      {job && <div className={s.field}><span className={s.fieldRow}>{job.label}<output>{Math.round(job.value * 100)}%</output></span><div className={s.bar}><i style={{ width: `${job.value * 100}%` }} /></div></div>}
      {error && <p className={`${s.note} ${s.err}`}>{error}</p>}
      <div className={s.dialogActions}>
        {job ? <button type="button" className={s.btn} onClick={job.cancel}>Hủy tạo</button> : <button type="button" className={s.btn} onClick={onClose}>Đóng</button>}
        <button type="submit" className={`${s.btn} ${s.primary}`} disabled={!!job} data-testid="create-map">{job ? 'Đang tạo…' : 'Tạo bản đồ'}</button>
      </div>
    </form>
  </div>;
}
