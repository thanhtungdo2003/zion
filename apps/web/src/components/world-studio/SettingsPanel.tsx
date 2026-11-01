'use client';

import { useEffect, useState } from 'react';
import { CLIMATES, MAP_KINDS, MAP_SIZES, TERRAIN_PRESETS, publishModesOf, toBattleMap, climateTint, type Climate, cellFor, validateTerrainSettings, type MapKind, type TerrainPreset, type TerrainSettings } from '@zion/worldgen/editor';
import { Icon } from '../Icon';
import { renderThumbnail, storageEstimate } from '@/studio/world/map-store';
import { hasStudioSession, publishedMapId, studioLogin, studioPublishBattleMap, studioSetBattleMapModes } from '@/lib/api';
import { WORLD_MAP_MODES, type WorldMapMode } from '@zion/shared';
import { ConfirmDialog } from '../ConfirmDialog';
import type { EditorApi } from './editor-api';
import { Btn, Check, NumberField, Section, Seg, Slider, TextField, fmtTime } from './ui';
import s from './world-studio.module.css';

export function SettingsPanel({ api }: { api: EditorApi }) {
  const { doc } = api;
  const [storage, setStorage] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => { void storageEstimate().then(setStorage); }, []);
  const meta = (label: string, patch: Partial<typeof doc.meta>, key: string) => api.commit(label, { ...api.doc, meta: { ...api.doc.meta, ...patch } }, { key });
  const terrain = (patch: Partial<TerrainSettings>, key: string) => {
    const next = { ...api.doc.terrain, ...patch };
    if (patch.size) next.cell = cellFor(patch.size);
    api.commit('Thông số địa hình', { ...api.doc, terrain: next, meta: { ...api.doc.meta, seed: next.seed } }, { key });
  };
  const t = doc.terrain, problems = validateTerrainSettings(t), resized = t.size !== api.terrain.size;
  return <>
    <Section title="Thông tin bản đồ" icon="file-text">
      <TextField label="Tên" value={doc.meta.name} onChange={(name) => meta('Đổi tên bản đồ', { name: name.slice(0, 80) || 'Bản đồ' }, 'name')} testId="meta-name" />
      <div className={s.field}><span className={s.fieldRow}>Loại map</span><Seg<MapKind> value={doc.meta.kind} options={MAP_KINDS} onChange={(kind) => meta('Loại bản đồ', { kind }, 'kind')} /></div>
      <label className={s.field}><span className={s.fieldRow}>Mô tả</span><textarea className={s.input} value={doc.meta.description} maxLength={500} onChange={(e) => meta('Mô tả', { description: e.target.value }, 'desc')} /></label>
      <p className={s.note}>ID <code>{doc.meta.id}</code><br />Tạo {fmtTime(doc.meta.createdAt)} · sửa {fmtTime(doc.meta.updatedAt)} · mẫu {doc.meta.template}</p>
    </Section>
    <Section title="Sinh địa hình từ seed" icon="dices">
      <div className={s.field}><span className={s.fieldRow}>Preset</span>
        <div className={s.grid3}>{TERRAIN_PRESETS.map((p) => <button key={p.id} type="button" className={`${s.btn} ${t.preset === p.id ? s.primary : ''}`} onClick={() => terrain({ preset: p.id as TerrainPreset, maxHeight: p.maxHeight, roughness: p.roughness, detail: p.detail, seaEdge: p.id === 'island' || t.seaEdge }, 'preset')}>{p.name}</button>)}</div></div>
      <div className={s.field}><span className={s.fieldRow}>Seed</span>
        <div style={{ display: 'flex', gap: 4 }}><input className={s.input} value={t.seed} onChange={(e) => terrain({ seed: e.target.value.slice(0, 64) }, 'seed')} data-testid="terrain-seed" />
          <button className={s.iconBtn} title="Seed ngẫu nhiên" onClick={() => terrain({ seed: Math.random().toString(36).slice(2, 10) }, 'seed-rnd')}><Icon name="lucide:dices" /></button></div></div>
      <div className={s.field}><span className={s.fieldRow}>Kích thước map</span><Seg value={String(t.size)} options={MAP_SIZES.map((v) => ({ id: String(v), name: `${v} m` }))} onChange={(v) => terrain({ size: Number(v) }, 'size')} /></div>
      <Slider label="Độ cao tối đa" unit=" m" min={5} max={800} step={5} value={t.maxHeight} onChange={(maxHeight) => terrain({ maxHeight }, 'height')} />
      <Slider label="Độ gồ ghề" min={0} max={1} step={.05} value={t.roughness} onChange={(roughness) => terrain({ roughness }, 'rough')} format={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="Mật độ chi tiết (lớp noise)" min={1} max={8} value={t.detail} onChange={(detail) => terrain({ detail }, 'detail')} />
      <NumberField label="Mực nước biển" unit="m" min={0} max={200} step={.5} value={t.seaLevel} onChange={(seaLevel) => terrain({ seaLevel }, 'sea')} />
      <div className={s.field}><span className={s.fieldRow}>Khí hậu</span><Seg<Climate> value={t.climate ?? 'temperate'} options={CLIMATES} onChange={(climate) => terrain({ climate }, 'climate')} /></div>
      <Slider label="Xói mòn khi sinh" min={0} max={1} step={.05} value={t.erosion ?? 0} onChange={(erosion) => terrain({ erosion }, 'erosion')} format={(v) => (v ? `${Math.round(v * 100)}%` : 'Tắt')} />
      <Check label="Biển bao quanh (đường bờ)" value={t.seaEdge || t.preset === 'island'} onChange={(seaEdge) => terrain({ seaEdge }, 'edge')} />
      {problems.map((p) => <p key={p} className={`${s.note} ${s.err}`}>{p}</p>)}
      {resized && <p className={`${s.note} ${s.warn}`}>Đổi kích thước cần sinh lại địa hình ({t.size} m, {t.cell} m/ô). Khu vực ngoài biên mới sẽ báo lỗi khi kiểm tra.</p>}
      <Btn icon="wand-sparkles" kind="primary" disabled={!!problems.length || api.busy} onClick={() => api.confirm('Sinh lại địa hình?', `Thay toàn bộ độ cao và bề mặt bằng preset "${TERRAIN_PRESETS.find((p) => p.id === t.preset)?.name}" seed "${t.seed}". Sông hồ sinh lại theo địa hình mới; khu vực và cấu hình trận được giữ.${resized ? '' : ' Có thể hoàn tác.'}`, api.regenerateTerrain, 'Sinh địa hình')} testId="regen-terrain">Sinh địa hình</Btn>
      <p className={s.lead}>Cùng seed và thông số luôn cho cùng địa hình. Địa hình đã chỉnh được lưu trực tiếp, mở map không cần sinh lại.</p>
    </Section>
    <PublishSection api={api} />
    <Section title="Lưu trữ" icon="hard-drive" collapsible initiallyOpen={false}>
      <p className={s.lead}>Bản đồ lưu trong IndexedDB của trình duyệt này (tự lưu sau mỗi thay đổi). Dùng <b>Xuất</b> để có file sao lưu hoặc chuyển sang máy khác; nhập lại ở trang danh sách.</p>
      {storage && <p className={s.note}>Đã dùng {(storage.used / 1024 / 1024).toFixed(1)} MB / {(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB</p>}
      <Btn icon="hard-drive-download" onClick={() => void navigator.storage?.persist?.().then((ok) => api.flash(ok ? 'Trình duyệt sẽ giữ dữ liệu bản đồ lâu dài.' : 'Trình duyệt chưa cho phép lưu lâu dài.', !ok))}>Yêu cầu lưu lâu dài</Btn>
    </Section>
  </>;
}

/**
 * Puts the map on the game server for the chosen game modes (only those: a battlefield is not
 * offered as a battle royale map unless that mode is ticked). Used by Thiết lập and Chiến trường.
 */
export async function publishWorldMap(api: EditorApi, modes: WorldMapMode[]): Promise<string> {
  const d = api.doc, map = toBattleMap(d, api.terrain);
  // The editor document goes along so the map can be opened again from any machine.
  const { thumbnail: _thumb, ...meta } = d.meta;
  const r = await studioPublishBattleMap({ id: publishedMapId(d.meta.id), name: d.meta.name, thumbnail: renderThumbnail(api.terrain, d.terrain.seaLevel, 320, climateTint(d.terrain.climate)), seaLevel: d.terrain.seaLevel, map, source: { ...d, meta: { ...meta, modes } }, modes, ...(d.warfare ? { warfare: d.warfare } : {}), ...(d.environment ? { environment: d.environment } : {}) });
  return r.name;
}

/** Which game modes the map is published for, and the publish / update buttons. */
function PublishSection({ api }: { api: EditorApi }) {
  const [asking, setAsking] = useState<null | 'publish' | 'modes'>(null), [busy, setBusy] = useState(false);
  const modes = publishModesOf(api.doc.meta);
  const toggle = (m: WorldMapMode, on: boolean) => {
    const next = on ? [...new Set([...modes, m])] : modes.filter((x) => x !== m);
    if (!next.length) { api.flash('Chọn ít nhất một chế độ chơi.', true); return; }
    api.commit('Chế độ chơi của bản đồ', { ...api.doc, meta: { ...api.doc.meta, modes: next } });
  };
  const names = modes.map((m) => WORLD_MAP_MODES.find((x) => x.id === m)?.name ?? m).join(' và ');
  const run = async (what: 'publish' | 'modes', password?: string) => {
    setBusy(true);
    try {
      if (password) await studioLogin(password);
      if (what === 'publish') api.flash(`Đã xuất bản "${await publishWorldMap(api, modes)}" cho ${names}.`);
      else { await studioSetBattleMapModes(publishedMapId(api.doc.meta.id), modes); api.flash(`Bản đồ giờ chỉ dùng cho ${names}.`); }
    } catch (err) { api.flash(`Không thực hiện được: ${err instanceof Error ? err.message : String(err)}`, true); throw err; }
    finally { setBusy(false); }
  };
  const go = (what: 'publish' | 'modes') => { if (hasStudioSession()) void run(what).catch(() => {}); else setAsking(what); };
  return <Section title="Xuất bản lên game" icon="rocket" collapsible initiallyOpen={false}>
    <p className="lead" style={{ margin: 0, fontSize: 12, opacity: .75 }}>Chọn chế độ chơi dùng bản đồ này; bản đồ chỉ xuất hiện trong các chế độ được chọn. Mỗi lần xuất bản thay bản cũ; trận đang chạy giữ bản cũ tới khi kết thúc.</p>
    {WORLD_MAP_MODES.map((m) => <Check key={m.id} label={`${m.name} — ${m.hint}`} value={modes.includes(m.id)} onChange={(on) => toggle(m.id, on)} />)}
    <Btn icon="rocket" kind="primary" disabled={busy} onClick={() => go('publish')} testId="publish-br">{busy ? 'Đang xuất bản…' : 'Xuất bản lên máy chủ'}</Btn>
    <Btn icon="list-checks" disabled={busy} onClick={() => go('modes')}>Chỉ đổi chế độ chơi (bản đồ đã xuất bản)</Btn>
    {asking && <ConfirmDialog title="Đăng nhập Studio" message="Nhập mật khẩu Studio để xuất bản bản đồ lên máy chủ." password danger={false} confirmLabel="Tiếp tục"
      onCancel={() => setAsking(null)} onConfirm={async (pw) => { await run(asking, pw); setAsking(null); }} />}
  </Section>;
}
