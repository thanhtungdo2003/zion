'use client';

import { useMemo, useState } from 'react';
import { LOOT_CATEGORIES, autoLootPoints, autoSpawnPoints, battleConfigSchema, defaultBattleConfig, matchDuration, newId, polygonCentroid, simulateZones, validateBattleConfig, type BattleConfig, type GameplayIssue, type LootCategory } from '@zion/worldgen/editor';
import { Icon } from '../Icon';
import type { EditorApi } from './editor-api';
import { Btn, NumberField, Section, Seg, Slider, TextField } from './ui';
import s from './world-studio.module.css';

const POINT_NAME = { spawn: 'Điểm spawn', loot: 'Điểm loot', hotspot: 'Điểm nóng', poi: 'Địa điểm (POI)', rare: 'Vùng vật phẩm hiếm' } as const;

export function GameplayPanel({ api }: { api: EditorApi }) {
  const { doc, gameplay: g } = api;
  const [zoneSeed, setZoneSeed] = useState('preview-1');
  const [spawnCount, setSpawnCount] = useState(g?.maxPlayers ?? 48);
  const ctx = useMemo(() => ({ terrain: api.terrain, water: doc.water, seaLevel: doc.terrain.seaLevel }), [api.terrain, doc.water, doc.terrain.seaLevel]);
  const [issues, setIssues] = useState<GameplayIssue[] | null>(null);
  if (!g) return <Section title="Gameplay"><p className={s.lead}>Chưa có cấu hình trận.</p></Section>;
  const up = (label: string, fn: (c: BattleConfig) => void, key?: string) => api.updateGameplay(label, fn, key);
  const setDocGameplay = (label: string, gameplay: BattleConfig[], active: string) => api.commit(label, { ...api.doc, gameplay, activeGameplay: active });
  const duration = matchDuration(g);

  return <>
    <SelectionSection api={api} g={g} />
    <Section title="Cấu hình trận" icon="swords">
      <div style={{ display: 'flex', gap: 4 }}>
        <select className={s.input} value={g.id} onChange={(e) => api.commit('Chọn cấu hình trận', { ...api.doc, activeGameplay: e.target.value })} data-testid="config-select">
          {doc.gameplay.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className={s.iconBtn} title="Cấu hình mới" onClick={() => { const c = defaultBattleConfig(doc.terrain.size, `Cấu hình ${doc.gameplay.length + 1}`, newId('br')); setDocGameplay('Thêm cấu hình trận', [...doc.gameplay, c], c.id); }}><Icon name="lucide:plus" /></button>
        <button className={s.iconBtn} title="Nhân bản" onClick={() => { const c = { ...structuredClone(g), id: newId('br'), name: `${g.name} (bản sao)` }; setDocGameplay('Nhân bản cấu hình', [...doc.gameplay, c], c.id); }}><Icon name="lucide:copy" /></button>
        <button className={s.iconBtn} title="Xóa cấu hình" disabled={doc.gameplay.length < 2} onClick={() => api.confirm('Xóa cấu hình trận?', `Xóa "${g.name}". Địa hình và khu vực không bị ảnh hưởng.`, () => { const rest = api.doc.gameplay.filter((c) => c.id !== g.id); setDocGameplay('Xóa cấu hình', rest, rest[0]!.id); }, 'Xóa')}><Icon name="lucide:trash-2" /></button>
      </div>
      <TextField label="Tên cấu hình" value={g.name} onChange={(name) => up('Đổi tên cấu hình', (c) => { c.name = name.slice(0, 80) || 'Cấu hình'; }, 'cfg-name')} />
      <p className={s.lead}>Cấu hình trận lưu tách khỏi địa hình và khu dân cư: một bản đồ dùng được cho nhiều kiểu trận.</p>
      <div className={s.btnRow}>
        <Btn icon="download" onClick={() => download(`${g.name}.br-config.json`, JSON.stringify(g, null, 2))}>Xuất</Btn>
        <Btn icon="upload" onClick={() => pickFile((text) => {
          let raw: unknown;
          try { raw = JSON.parse(text); } catch { api.flash('Tệp không phải JSON hợp lệ.', true); return; }
          const parsed = battleConfigSchema.safeParse(raw);
          if (!parsed.success) { api.flash(`Cấu hình không hợp lệ: ${parsed.error.issues[0]?.path.join('.')} — ${parsed.error.issues[0]?.message}`, true); return; }
          const c = { ...parsed.data, id: newId('br') };
          setDocGameplay('Nhập cấu hình trận', [...api.doc.gameplay, c], c.id); api.flash(`Đã nhập "${c.name}".`);
        })}>Nhập</Btn>
      </div>
    </Section>

    <Section title="Luật trận" icon="scroll-text" collapsible>
      <div className={s.grid3}>
        <NumberField label="Tối đa" unit="người" min={2} max={200} value={g.maxPlayers} onChange={(v) => up('Số người tối đa', (c) => { c.maxPlayers = Math.round(v); }, 'max')} />
        <NumberField label="Tối thiểu" unit="người" min={1} max={200} value={g.minPlayers} onChange={(v) => up('Số người tối thiểu', (c) => { c.minPlayers = Math.round(v); }, 'min')} />
        <NumberField label="Đội" unit="người" min={1} max={4} value={g.squadSize} onChange={(v) => up('Cỡ đội', (c) => { c.squadSize = Math.round(v); }, 'squad')} />
        <NumberField label="Chờ sảnh" unit="giây" min={0} max={1800} value={g.lobbyWaitSec} onChange={(v) => up('Thời gian chờ', (c) => { c.lobbyWaitSec = v; }, 'lobby')} />
        <NumberField label="Đếm ngược" unit="giây" min={0} max={600} value={g.countdownSec} onChange={(v) => up('Đếm ngược', (c) => { c.countdownSec = v; }, 'count')} />
        <NumberField label="Giới hạn" unit="phút (0 = không)" min={0} max={240} value={Math.round(g.timeLimitSec / 60)} onChange={(v) => up('Giới hạn trận', (c) => { c.timeLimitSec = v * 60; }, 'limit')} />
        {/* Every battle royale match has vehicles, whatever the map's style or condition. */}
        <NumberField label="Xe trong trận" unit="chiếc" min={0} max={120} value={g.vehicles ?? 36} onChange={(v) => up('Số xe trong trận', (c) => { c.vehicles = Math.round(v); }, 'vehicles')} />
      </div>
      <div className={s.field}><span className={s.fieldRow}>Điều kiện thắng</span><Seg value={g.winRule} options={[{ id: 'last-standing', name: 'Người cuối cùng' }, { id: 'last-squad', name: 'Đội cuối cùng' }]} onChange={(winRule) => up('Điều kiện thắng', (c) => { c.winRule = winRule; })} /></div>
      <div className={s.field}><span className={s.fieldRow}>Hết giờ thì</span><Seg value={g.timeoutRule} options={[{ id: 'closest-to-zone', name: 'Gần tâm bo thắng' }, { id: 'most-kills', name: 'Nhiều hạ gục' }, { id: 'draw', name: 'Hòa' }]} onChange={(timeoutRule) => up('Khi hết giờ', (c) => { c.timeoutRule = timeoutRule; })} /></div>
      <div className={s.field}><span className={s.fieldRow}>Xuất phát</span><Seg value={g.spawnMode} options={[{ id: 'plane-drop', name: 'Nhảy từ máy bay' }, { id: 'spawn-points', name: 'Điểm spawn' }]} onChange={(spawnMode) => up('Kiểu xuất phát', (c) => { c.spawnMode = spawnMode; })} /></div>
    </Section>

    <Section title="Vùng chơi & vòng bo" icon="circle-dot" collapsible>
      <div className={s.grid3}>
        <NumberField label="Tâm X" unit="m" value={g.playArea.x} onChange={(v) => up('Vùng chơi', (c) => { c.playArea.x = v; }, 'pa-x')} />
        <NumberField label="Tâm Z" unit="m" value={g.playArea.z} onChange={(v) => up('Vùng chơi', (c) => { c.playArea.z = v; }, 'pa-z')} />
        <NumberField label="Bán kính" unit="m" min={50} max={8192} value={g.playArea.radius} onChange={(v) => up('Vùng chơi', (c) => { c.playArea.radius = v; }, 'pa-r')} />
      </div>
      <div className={s.phaseTable} data-testid="phases">
        <div className={`${s.phase} ${s.phaseHead}`}><span>#</span><span>Bán kính m</span><span>Chờ s</span><span>Thu s</span><span>ST/giây</span><span /></div>
        {g.phases.map((ph, i) => <div key={i} className={s.phase}>
          <b>{i + 1}</b>
          <input className={s.input} type="number" value={ph.radius} onChange={(e) => up('Phase', (c) => { c.phases[i]!.radius = Math.max(0, Number(e.target.value) || 0); }, `ph-r-${i}`)} aria-label={`Bán kính phase ${i + 1}`} />
          <input className={s.input} type="number" value={ph.waitSec} onChange={(e) => up('Phase', (c) => { c.phases[i]!.waitSec = Math.max(0, Number(e.target.value) || 0); }, `ph-w-${i}`)} aria-label={`Chờ phase ${i + 1}`} />
          <input className={s.input} type="number" value={ph.shrinkSec} onChange={(e) => up('Phase', (c) => { c.phases[i]!.shrinkSec = Math.max(1, Number(e.target.value) || 1); }, `ph-s-${i}`)} aria-label={`Thu phase ${i + 1}`} />
          <input className={s.input} type="number" step={.5} value={ph.damagePerSec} onChange={(e) => up('Phase', (c) => { c.phases[i]!.damagePerSec = Math.max(0, Number(e.target.value) || 0); }, `ph-d-${i}`)} aria-label={`Sát thương phase ${i + 1}`} />
          <button className={`${s.iconBtn} ${ph.center ? s.on : ''}`} title={ph.center ? 'Tâm cố định — bấm để bỏ (ngẫu nhiên)' : 'Tâm ngẫu nhiên — bấm rồi nhấp bản đồ để cố định'}
            onClick={() => { if (ph.center) up('Bỏ tâm cố định', (c) => { c.phases[i]!.center = null; }); else { api.setTool('select'); api.setPickPhase(i); } }}><Icon name={ph.center ? 'lucide:locate-fixed' : 'lucide:shuffle'} /></button>
        </div>)}
      </div>
      <div className={s.btnRow}>
        <Btn icon="plus" onClick={() => up('Thêm phase', (c) => { const last = c.phases[c.phases.length - 1]!; c.phases.push({ ...last, center: null, radius: Math.round(last.radius * .5), damagePerSec: last.damagePerSec + 5 }); })} disabled={g.phases.length >= 16}>Phase</Btn>
        <Btn icon="minus" onClick={() => up('Bỏ phase', (c) => { c.phases.pop(); })} disabled={g.phases.length < 2}>Phase</Btn>
        <Btn icon="rotate-ccw" onClick={() => up('Phase theo luật hiện hành', (c) => { const d = defaultBattleConfig(doc.terrain.size); c.phases = d.phases; c.playArea = d.playArea; })} title="Theo BATTLE_STAGES của server">Mặc định</Btn>
      </div>
      <p className={s.note}>Tổng {Math.round(duration / 60)} phút · bán kính đầu {Math.round(g.playArea.radius)} m · tâm ngẫu nhiên chọn trong vòng trước, ưu tiên đất liền (như server).</p>
      <div style={{ display: 'flex', gap: 4 }}>
        <Btn icon="play" kind="primary" onClick={() => { api.setZones(simulateZones(g, ctx, zoneSeed)); api.flash('Đã vẽ một chuỗi vòng bo có thể xảy ra.'); }} testId="simulate-zones">Mô phỏng vòng bo</Btn>
        <button className={s.iconBtn} title="Mô phỏng khác" onClick={() => { const seed = Math.random().toString(36).slice(2, 8); setZoneSeed(seed); api.setZones(simulateZones(g, ctx, seed)); }}><Icon name="lucide:dices" /></button>
        {api.zones && <button className={s.iconBtn} title="Ẩn mô phỏng" onClick={() => api.setZones(null)}><Icon name="lucide:eye-off" /></button>}
      </div>
    </Section>

    <Section title={`Spawn (${g.spawnPoints.length})`} icon="triangle" collapsible>
      <Slider label="Khoảng cách tối thiểu" unit=" m" min={0} max={600} step={10} value={g.minSpawnSpacing} onChange={(v) => up('Khoảng cách spawn', (c) => { c.minSpawnSpacing = v; }, 'spacing')} />
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
        <div style={{ width: 90 }}><NumberField label="Số điểm" min={1} max={512} value={spawnCount} onChange={(v) => setSpawnCount(Math.round(v))} /></div>
        <Btn icon="wand-sparkles" onClick={() => { const pts = autoSpawnPoints(g, ctx, `${doc.meta.seed}-${g.id}-${Date.now() % 100000}`, spawnCount); up('Tự sinh spawn', (c) => { c.spawnPoints = pts; }); api.flash(pts.length < spawnCount ? `Chỉ đặt được ${pts.length}/${spawnCount} điểm với khoảng cách hiện tại.` : `Đã đặt ${pts.length} điểm spawn trên đất liền, ngoài vùng cấm.`, pts.length < spawnCount); }} testId="auto-spawn">Tự sinh</Btn>
        <Btn icon="trash-2" kind="danger" disabled={!g.spawnPoints.length} onClick={() => up('Xóa spawn', (c) => { c.spawnPoints = []; })}>Xóa hết</Btn>
      </div>
      <p className={s.lead}>{g.spawnZones.length ? `${g.spawnZones.length} vùng spawn: tự sinh chỉ đặt điểm trong các vùng này.` : 'Vẽ vùng spawn (công cụ bên trái) để giới hạn nơi tự sinh.'}</p>
    </Section>

    <Section title={`Loot (${g.loot.points.length} điểm)`} icon="package" collapsible initiallyOpen={false}>
      <Slider label="Mật độ loot" min={0} max={3} step={.1} value={g.loot.density} onChange={(v) => up('Mật độ loot', (c) => { c.loot.density = v; }, 'loot-d')} format={(v) => `×${v.toFixed(1)}`} />
      {LOOT_CATEGORIES.map((cat) => <Slider key={cat.id} label={cat.name} min={0} max={10} step={.5} value={g.loot.categories[cat.id] ?? 0} onChange={(v) => up('Tỷ trọng loot', (c) => { c.loot.categories[cat.id] = v; }, `loot-${cat.id}`)} />)}
      <div className={s.field}><span className={s.fieldRow}>Loại khi đặt tay</span>
        <div className={s.grid3}>{LOOT_CATEGORIES.map((cat) => <button key={cat.id} type="button" className={`${s.btn} ${api.lootCategory === cat.id ? s.primary : ''}`} onClick={() => { api.setLootCategory(cat.id as LootCategory); api.setTool('place-loot'); }}>{cat.name}</button>)}</div></div>
      <div className={s.btnRow}>
        <Btn icon="wand-sparkles" onClick={() => {
          const buildings = [...doc.regions.flatMap((r) => r.result?.buildings ?? []).map((b) => ({ x: b.obb.x, z: b.obb.z, cls: b.cls, door: b.door })), ...doc.base.structures.map((b) => ({ x: b.x, z: b.z, cls: 'residential', door: [b.x, b.z] as [number, number] }))];
          if (!buildings.length) { api.flash('Chưa có công trình nào để đặt loot — hãy sinh khu dân cư trước.', true); return; }
          const pts = autoLootPoints(g, buildings, `${doc.meta.seed}-${g.id}`);
          up('Tự sinh loot', (c) => { c.loot.points = pts; }); api.flash(`Đã đặt ${pts.length} điểm loot tại ${buildings.length} công trình.`);
        }}>Từ công trình</Btn>
        <Btn icon="trash-2" kind="danger" disabled={!g.loot.points.length} onClick={() => up('Xóa loot', (c) => { c.loot.points = []; })}>Xóa hết</Btn>
      </div>
    </Section>

    <Section title="Điểm nóng · POI · vùng cấm" icon="flame" collapsible initiallyOpen={false}>
      <List api={api} title="Điểm nóng" items={g.hotspots.map((h) => ({ id: h.id, name: h.name, x: h.x, z: h.z, note: `nguy hiểm ${h.danger}` }))} kind="hotspot" />
      <List api={api} title="Vật phẩm hiếm" items={g.loot.rareAreas.map((h) => ({ id: h.id, name: h.name, x: h.x, z: h.z, note: `${h.radius} m` }))} kind="rare" />
      <List api={api} title="POI" items={g.pois.map((h) => ({ id: h.id, name: h.name, x: h.x, z: h.z, note: h.kind }))} kind="poi" />
      <div className={s.list}>{g.noGoZones.map((n) => <button key={n.id} className={s.listItem} onClick={() => { api.setTool('select'); api.setSelection({ kind: 'shape', shape: 'nogo', id: n.id }); const c = polygonCentroid(n.polygon); api.centerOn(c[0], c[1]); }}><Icon name="lucide:ban" /><span>{n.name}</span><small>{n.kind === 'no-go' ? 'cấm' : 'không chơi được'}</small></button>)}</div>
      <Btn icon="map-pin" onClick={() => up('POI từ khu vực', (c) => {
        for (const r of doc.regions) { if (c.pois.some((p) => p.id === `poi-${r.id}`)) continue; const ctr = polygonCentroid(r.polygon); c.pois.push({ id: `poi-${r.id}`, name: r.name, kind: r.preset, x: Math.round(ctr[0]), z: Math.round(ctr[1]), radius: Math.round(Math.sqrt(Math.abs(r.result?.analysis.area ?? 10000)) / 2) }); }
      })} disabled={!doc.regions.length}>Tạo POI từ các khu vực</Btn>
    </Section>

    <Section title="Kiểm tra cấu hình" icon="shield-check">
      <Btn icon="shield-check" onClick={() => setIssues(validateBattleConfig(g, ctx))} testId="validate-gameplay">Kiểm tra</Btn>
      {issues && <div className={s.list} data-testid="gameplay-issues">{issues.map((i, k) => <button key={k} className={s.issue} onClick={() => { if (i.x !== undefined) api.centerOn(i.x, i.z!, 300); }}>
        <Icon name={i.severity === 'error' ? 'lucide:circle-x' : i.severity === 'warning' ? 'lucide:triangle-alert' : 'lucide:info'} className={s[`sev-${i.severity}`]} /><span>{i.message}</span></button>)}</div>}
    </Section>
  </>;
}

function List({ api, title, items, kind }: { api: EditorApi; title: string; kind: 'hotspot' | 'rare' | 'poi'; items: Array<{ id: string; name: string; x: number; z: number; note: string }> }) {
  if (!items.length) return null;
  return <div className={s.field}><span className={s.fieldRow}>{title} ({items.length})</span>
    <div className={s.list}>{items.slice(0, 60).map((i) => <button key={i.id} className={`${s.listItem} ${api.selection?.kind === 'point' && api.selection.id === i.id ? s.on : ''}`} onClick={() => { api.setTool('select'); api.setSelection({ kind: 'point', point: kind, id: i.id }); api.centerOn(i.x, i.z); }}><span>{i.name}</span><small>{i.note}</small></button>)}</div></div>;
}

function SelectionSection({ api, g }: { api: EditorApi; g: BattleConfig }) {
  const sel = api.selection;
  const up = (label: string, fn: (c: BattleConfig) => void, key?: string) => api.updateGameplay(label, fn, key);
  if (!sel) return null;
  if (sel.kind === 'play-area') return <Section title="Vùng chơi" icon="locate-fixed"><p className={s.lead}>Kéo tâm vùng chơi trên bản đồ, hoặc sửa số trong mục Vùng chơi & vòng bo.</p></Section>;
  if (sel.kind === 'phase') { const ph = g.phases[sel.index]; return ph ? <Section title={`Tâm phase ${sel.index + 1}`} icon="locate-fixed"><p className={s.note}>{ph.center ? `X ${ph.center[0]} · Z ${ph.center[1]} · bán kính ${ph.radius} m` : 'Ngẫu nhiên'}</p><Btn icon="shuffle" onClick={() => api.removeSelection()}>Trả về ngẫu nhiên</Btn></Section> : null; }
  if (sel.kind === 'shape' && (sel.shape === 'nogo' || sel.shape === 'spawnzone')) {
    const z = sel.shape === 'nogo' ? g.noGoZones.find((q) => q.id === sel.id) : g.spawnZones.find((q) => q.id === sel.id);
    if (!z) return null;
    return <Section title={sel.shape === 'nogo' ? 'Vùng cấm' : 'Vùng spawn'} icon={sel.shape === 'nogo' ? 'ban' : 'square-dashed'}>
      <TextField label="Tên" value={z.name} onChange={(name) => up('Đổi tên vùng', (c) => { const q = (sel.shape === 'nogo' ? c.noGoZones : c.spawnZones).find((o) => o.id === sel.id); if (q) q.name = name.slice(0, 80); }, `zn-${sel.id}`)} />
      {sel.shape === 'nogo' && 'kind' in z && <Seg<'no-go' | 'unplayable'> value={z.kind as 'no-go' | 'unplayable'} options={[{ id: 'no-go', name: 'Vùng cấm' }, { id: 'unplayable', name: 'Không thể chơi' }]} onChange={(kind) => up('Loại vùng cấm', (c) => { const q = c.noGoZones.find((o) => o.id === sel.id); if (q) q.kind = kind; })} />}
      <p className={s.lead}>Kéo các đỉnh để sửa · chọn đỉnh rồi Delete để xóa đỉnh.</p>
      <Btn icon="trash-2" kind="danger" onClick={() => api.removeSelection({ kind: 'shape', shape: sel.shape, id: sel.id })}>Xóa vùng</Btn>
    </Section>;
  }
  if (sel.kind !== 'point') return null;
  const list = (sel.point === 'spawn' ? g.spawnPoints : sel.point === 'poi' ? g.pois : sel.point === 'loot' ? g.loot.points : sel.point === 'hotspot' ? g.hotspots : g.loot.rareAreas) as Array<Record<string, unknown> & { id: string; x: number; z: number }>;
  const item = list.find((q) => q.id === sel.id);
  if (!item) return null;
  const edit = (label: string, field: string, value: unknown) => up(label, (c) => {
    const l = (sel.point === 'spawn' ? c.spawnPoints : sel.point === 'poi' ? c.pois : sel.point === 'loot' ? c.loot.points : sel.point === 'hotspot' ? c.hotspots : c.loot.rareAreas) as Array<Record<string, unknown> & { id: string }>;
    const q = l.find((o) => o.id === sel.id); if (q) q[field] = value;
  }, `${sel.id}-${field}`);
  return <Section title={POINT_NAME[sel.point]} icon="map-pin">
    {'name' in item && <TextField label="Tên" value={String(item.name)} onChange={(v) => edit('Đổi tên', 'name', v.slice(0, 80))} />}
    <div className={s.grid2}>
      <NumberField label="X" unit="m" value={item.x} onChange={(v) => edit('Vị trí', 'x', v)} />
      <NumberField label="Z" unit="m" value={item.z} onChange={(v) => edit('Vị trí', 'z', v)} />
      {'radius' in item && <NumberField label="Bán kính" unit="m" min={5} max={2000} value={Number(item.radius)} onChange={(v) => edit('Bán kính', 'radius', v)} />}
      {'danger' in item && <NumberField label="Độ nguy hiểm" unit="1–5" min={1} max={5} value={Number(item.danger)} onChange={(v) => edit('Độ nguy hiểm', 'danger', Math.round(v))} />}
      {'tier' in item && <NumberField label="Cấp" unit="1–3" min={1} max={3} value={Number(item.tier)} onChange={(v) => edit('Cấp loot', 'tier', Math.round(v))} />}
    </div>
    {'category' in item && <select className={s.input} value={String(item.category)} onChange={(e) => edit('Loại loot', 'category', e.target.value)}>{LOOT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
    <Btn icon="trash-2" kind="danger" onClick={() => api.removeSelection()}>Xóa</Btn>
  </Section>;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function pickFile(onText: (t: string) => void) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.onchange = async () => { const f = input.files?.[0]; if (f && f.size < 8_000_000) { try { onText(await f.text()); } catch { /* reported by the caller's parser */ } } };
  input.click();
}
