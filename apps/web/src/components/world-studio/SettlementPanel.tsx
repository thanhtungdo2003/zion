'use client';

import { useState } from 'react';
import { BUILDING_CONDITIONS, BUILDING_CONDITION_NAMES, CONDITION_DECAY, LOT_CLASS_NAMES, SETTLEMENT_AREA_NAMES, SETTLEMENT_KINDS, SETTLEMENT_KIND_NAMES, SETTLEMENT_KIND_STYLES, areaFor, kindOfArea, type BuildingCondition, type SettlementKind } from '@zion/shared';
import { createDefaultRegistry } from '@zion/assets';
import { SETTLEMENT_PRESETS, URBAN_PATTERNS, levelRegion, pointInPolygon, polygonArea, presetSettings, waterLevelAt, type Region, type SettlementIssue, type SettlementResult, type SettlementSettings } from '@zion/worldgen/editor';
import { Icon } from '../Icon';
import { ConfirmDialog } from '../ConfirmDialog';
import { hasStudioSession, studioLogin, studioPlanRegion, type RegionPlan } from '@/lib/api';
import type { EditorApi } from './editor-api';
import { Btn, Check, NumberField, Section, Seg, Slider, TextField, fmt, fmtTime } from './ui';
import s from './world-studio.module.css';

let names: Map<number, string> | null = null;
const assetName = (id: number) => { names ??= new Map(); if (!names.has(id)) names.set(id, createDefaultRegistry().byNumericId(id)?.name ?? `#${id}`); return names.get(id)!; };
// Lot class names shared with the Model Studio.
const CLASS_NAME: Record<string, string> = LOT_CLASS_NAMES;
const LAYER_NAME = { roads: 'Toàn bộ', buildings: 'Công trình + vật thể', props: 'Cây & vật thể' } as const;

export function SettlementPanel({ api }: { api: EditorApi }) {
  const { doc, selection, preview } = api;
  const regionId = selection?.kind === 'shape' && selection.shape === 'region' ? selection.id : selection?.kind === 'building' || selection?.kind === 'prop' ? selection.region : null;
  const region = doc.regions.find((r) => r.id === regionId);
  const item = region?.result && (selection?.kind === 'building' ? region.result.buildings.find((b) => b.id === selection.id) : selection?.kind === 'prop' ? region.result.props.find((p) => p.id === selection.id) : undefined);

  return <>
    {preview && <PreviewSection api={api} result={preview.result} name={doc.regions.find((r) => r.id === preview.region)?.name ?? ''} />}
    {item && region && selection && (selection.kind === 'building' || selection.kind === 'prop') && <Section title={selection.kind === 'building' ? 'Công trình' : 'Vật thể'} icon={selection.kind === 'building' ? 'house' : 'trees'}>
      <p className={s.lead}><b style={{ color: 'var(--text)' }}>{assetName(item.asset)}</b> · asset #{item.asset}{'cls' in item ? ` · ${CLASS_NAME[item.cls]}` : ''}{item.manual ? ' · đã sửa tay' : ''}</p>
      <p className={s.note}>X {item.x.toFixed(1)} · Z {item.z.toFixed(1)} · cao nền {item.y.toFixed(1)} m · hướng {Math.round(((item.yaw * 180 / Math.PI) % 360 + 360) % 360)}°</p>
      <div className={s.btnRow}>
        <Btn icon="rotate-cw" onClick={() => api.updateRegion('Xoay', region.id, (r) => rotate(r, selection.kind as 'building', item.id))}>Xoay 90°</Btn>
        <Btn icon="trash-2" kind="danger" onClick={() => api.removeSelection()}>Xóa</Btn>
      </div>
      <p className={s.lead}>Kéo trên bản đồ để di chuyển. Đối tượng sửa tay được giữ nguyên khi sinh lại; chỗ đã xóa tay để trống.</p>
    </Section>}
    {region ? <RegionSection api={api} region={region} /> : <Section title="Khu dân cư" icon="building-2">
      <p className={s.lead}>Vẽ một vùng (tối thiểu 3 điểm) bằng công cụ <b>Vẽ vùng</b> bên trái, chọn preset rồi sinh. Kết quả luôn hiện ở dạng xem trước để duyệt trước khi áp dụng.</p>
      <Btn icon="pentagon" kind="primary" onClick={() => api.setTool('draw-region')} testId="start-region">Vẽ vùng mới</Btn>
    </Section>}
    <Section title={`Các khu vực (${doc.regions.length})`} icon="list" collapsible initiallyOpen={!region}>
      {!doc.regions.length && <p className={s.lead}>Chưa có khu vực nào.</p>}
      <div className={s.list}>{doc.regions.map((r) => <button key={r.id} className={`${s.listItem} ${r.id === regionId ? s.on : ''}`} onClick={() => { api.setTool('select'); api.setSelection({ kind: 'shape', shape: 'region', id: r.id }); const c = r.polygon.reduce((a, p) => [a[0] + p[0] / r.polygon.length, a[1] + p[1] / r.polygon.length], [0, 0]); api.centerOn(c[0]!, c[1]!, Math.sqrt(Math.abs(polygonArea(r.polygon))) * 1.8); }}>
        <Icon name="lucide:pentagon" /><span>{r.name}</span><small>{r.result ? `${r.result.buildings.length} nhà` : 'chưa sinh'}</small></button>)}</div>
    </Section>
  </>;
}

function rotate(r: Region, kind: 'building' | 'prop', id: string): Region {
  if (!r.result) return r;
  const turn = <T extends { yaw: number; obb: { yaw: number; hx: number; hz: number } }>(o: T): T => ({ ...o, yaw: o.yaw + Math.PI / 2, obb: { ...o.obb, yaw: o.obb.yaw + Math.PI / 2 }, manual: true });
  return { ...r, result: kind === 'building' ? { ...r.result, buildings: r.result.buildings.map((b) => (b.id === id ? turn(b) : b)) } : { ...r.result, props: r.result.props.map((p) => (p.id === id ? turn(p) : p)) } };
}

function RegionSection({ api, region }: { api: EditorApi; region: Region }) {
  const st = region.settings;
  const set = (patch: Partial<SettlementSettings>, key: string) => api.updateRegion('Đổi thông số khu vực', region.id, (r) => ({ ...r, settings: { ...r.settings, ...patch } }), `${region.id}-${key}`);
  const area = Math.abs(polygonArea(region.polygon));
  const manual = region.result ? region.result.buildings.filter((b) => b.manual).length + region.result.props.filter((p) => p.manual).length : 0;
  const run = (from: 'roads' | 'buildings' | 'props') => api.generateRegion(region.id, from);
  return <>
    <Section title="Khu vực" icon="pentagon">
      <TextField label="Tên" value={region.name} onChange={(name) => api.updateRegion('Đổi tên khu vực', region.id, (r) => ({ ...r, name }), `${region.id}-name`)} testId="region-name" />
      <p className={s.note}>{fmt(Math.round(area))} m² · {region.polygon.length} điểm{region.result ? ` · ${region.result.buildings.length} công trình · ${region.result.props.length} vật thể` : ' · chưa sinh'}{region.exclusions.length ? ` · ${region.exclusions.length} chỗ xóa tay` : ''}</p>
      <RegionKind api={api} region={region} />
      <RegionAi api={api} region={region} onGenerate={() => run('roads')} />
      <div className={s.field}><span className={s.fieldRow}>Seed</span>
        <div style={{ display: 'flex', gap: 4 }}><input className={s.input} value={region.seed} onChange={(e) => api.updateRegion('Đổi seed', region.id, (r) => ({ ...r, seed: e.target.value.slice(0, 64) || 'seed' }), `${region.id}-seed`)} data-testid="region-seed" />
          <button className={s.iconBtn} title="Seed ngẫu nhiên" onClick={() => api.updateRegion('Seed ngẫu nhiên', region.id, (r) => ({ ...r, seed: Math.random().toString(36).slice(2, 9) }))}><Icon name="lucide:dices" /></button></div></div>
      <Btn icon="wand-sparkles" kind="primary" onClick={() => run('roads')} disabled={api.busy} testId="generate-region">{region.result ? 'Sinh lại toàn bộ' : 'Sinh khu vực'}</Btn>
      {region.result && <div className={s.btnRow}>
        <Btn icon="house" onClick={() => run('buildings')} disabled={api.busy} title="Giữ đường và lô đất, sinh lại công trình và vật thể">Sinh lại công trình</Btn>
        <Btn icon="trees" onClick={() => run('props')} disabled={api.busy} title="Giữ đường và công trình, sinh lại cây và vật thể" testId="regen-props">Sinh lại cây/vật thể</Btn>
      </div>}
      {manual > 0 && <p className={s.note}>{manual} đối tượng sửa tay sẽ được giữ khi sinh lại.</p>}
      <div className={s.btnRow}>
        <Btn icon="shovel" onClick={() => api.terrainOp(`San nền ${region.name}`, (t) => levelRegion(t, region.polygon, 40))} title="Đắp/đào đất về mặt phẳng nghiêng nhẹ trong vùng (có thể hoàn tác)">San nền</Btn>
        <Btn icon="trash-2" kind="danger" onClick={() => api.confirm('Xóa khu vực?', `Xóa "${region.name}" cùng toàn bộ đường, công trình và vật thể. Có thể hoàn tác.`, () => { api.commit(`Xóa ${region.name}`, { ...api.doc, regions: api.doc.regions.filter((r) => r.id !== region.id) }); api.setSelection(null); if (api.preview?.region === region.id) api.discardPreview(); }, 'Xóa')}>Xóa vùng</Btn>
      </div>
    </Section>
    <Section title="Quy hoạch" icon="layout-grid" collapsible>
      <div className={s.field}><span className={s.fieldRow}>Bố cục đường</span><Seg value={st.layout} options={[{ id: 'grid', name: 'Lưới ô phố' }, { id: 'organic', name: 'Trục uốn lượn' }, { id: 'urban', name: 'Đô thị (trường tensor)' }]} onChange={(layout) => set(layout === 'urban' ? { layout, pattern: st.pattern ?? 'mixed' } : { layout }, 'layout')} /></div>
      {st.layout === 'urban' && <div className={s.field}><span className={s.fieldRow}>Kiểu đô thị</span><Seg value={st.pattern ?? 'mixed'} options={URBAN_PATTERNS} onChange={(pattern) => set({ pattern }, 'pattern')} />
        <p className={s.lead} style={{ margin: 0 }}>Đường chính → đường khu vực → ngõ hẻm theo địa hình (bám đường đồng mức), lô mặt tiền, phân khu, trường/trạm y tế/chợ/chùa, nhà bỏ hoang/đổ nát theo từng khu (mức xuống cấp).</p></div>}
      <Slider label="Mật độ xây dựng" min={0} max={1} step={.05} value={st.density} onChange={(density) => set({ density }, 'density')} format={(v) => `${Math.round(v * 100)}%`} testId="density" />
      <Slider label="Độ ngẫu nhiên" min={0} max={1} step={.05} value={st.randomness} onChange={(randomness) => set({ randomness }, 'randomness')} format={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="Mức tập trung về tâm" min={0} max={1} step={.05} value={st.concentration} onChange={(concentration) => set({ concentration }, 'concentration')} format={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="Ưu tiên công trình lớn" min={0} max={1} step={.05} value={st.sizeBias} onChange={(sizeBias) => set({ sizeBias }, 'sizeBias')} format={(v) => `${Math.round(v * 100)}%`} />
      <div className={s.grid3}>
        <NumberField label="Đường chính" unit="m" min={4} max={24} step={.5} value={st.mainRoadWidth} onChange={(mainRoadWidth) => set({ mainRoadWidth }, 'main')} />
        <NumberField label="Đường phụ" unit="m" min={3} max={st.mainRoadWidth} step={.5} value={st.secondaryRoadWidth} onChange={(secondaryRoadWidth) => set({ secondaryRoadWidth }, 'sec')} />
        <NumberField label="Ngõ" unit="m" min={2.5} max={st.secondaryRoadWidth} step={.5} value={st.alleyWidth} onChange={(alleyWidth) => set({ alleyWidth }, 'alley')} />
      </div>
      <div className={s.grid2}>
        <NumberField label="Ô phố" unit="m" min={40} max={300} value={st.blockSize} onChange={(blockSize) => set({ blockSize }, 'block')} />
        <NumberField label="Khoảng lùi" unit="m" min={0} max={20} step={.5} value={st.setback} onChange={(setback) => set({ setback }, 'setback')} />
        <NumberField label="Lô rộng" unit="m" min={8} max={80} value={st.lotWidth} onChange={(lotWidth) => set({ lotWidth }, 'lotw')} />
        <NumberField label="Lô sâu" unit="m" min={10} max={100} value={st.lotDepth} onChange={(lotDepth) => set({ lotDepth }, 'lotd')} />
      </div>
      <Slider label="Mức san nền khi sinh" min={0} max={1} step={.05} value={st.grading} onChange={(grading) => set({ grading }, 'grading')} format={(v) => (v ? `${Math.round(v * 100)}%` : 'Tắt')} />
      <Slider label="Dốc tối đa cho nhà" min={.05} max={.6} step={.01} value={st.maxSlope} onChange={(maxSlope) => set({ maxSlope }, 'slope')} format={(v) => `${Math.round(v * 100)}%`} />
      <div className={s.field}><span className={s.fieldRow}>Tỷ trọng phân khu</span>
        {(['residential', 'commercial', 'industrial', 'military'] as const).map((k) => <Slider key={k} label={CLASS_NAME[k]!} min={0} max={1} step={.05} value={st.zoning[k]} onChange={(v) => set({ zoning: { ...st.zoning, [k]: v } }, `zone-${k}`)} format={(v) => `${Math.round(v * 100)}%`} />)}</div>
    </Section>
    <Section title="Cây & vật thể phụ" icon="trees" collapsible initiallyOpen={false}>
      <Slider label="Mật độ cây" min={0} max={1} step={.05} value={st.treeDensity} onChange={(treeDensity) => set({ treeDensity }, 'trees')} format={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="Mật độ vật thể" min={0} max={1} step={.05} value={st.propDensity} onChange={(propDensity) => set({ propDensity }, 'props')} format={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="Mức xuống cấp" min={0} max={1} step={.05} value={st.decay} onChange={(decay) => set({ decay }, 'decay')} format={(v) => `${Math.round(v * 100)}%`} />
      <Check label="Hàng rào quanh nhà" value={st.fences} onChange={(fences) => set({ fences }, 'fences')} />
      <Check label="Cột đèn dọc đường" value={st.lamps} onChange={(lamps) => set({ lamps }, 'lamps')} />
      <Check label="Hàng rào bao quanh vùng" value={st.perimeter} onChange={(perimeter) => set({ perimeter }, 'perimeter')} />
      <div className={s.grid2}>
        <NumberField label="Tối đa công trình" min={1} max={4000} value={st.maxBuildings} onChange={(maxBuildings) => set({ maxBuildings }, 'maxb')} />
        <NumberField label="Tối đa vật thể" min={0} max={20000} value={st.maxProps} onChange={(maxProps) => set({ maxProps }, 'maxp')} />
      </div>
    </Section>
    {region.result && !api.preview && <Section title="Kết quả đang áp dụng" icon="clipboard-check" collapsible initiallyOpen={false}>
      <ResultStats result={region.result} />
      <IssueList api={api} issues={region.result.issues} />
    </Section>}
    {region.history.length > 0 && <Section title="Lịch sử sinh" icon="history" collapsible initiallyOpen={false}>
      <div className={s.list}>{[...region.history].reverse().map((h, i) => <div key={i} className={s.listItem} style={{ cursor: 'default' }}><span>{LAYER_NAME[h.from]} · seed {h.seed}</span><small>{h.buildings} nhà · {fmtTime(h.at)}</small></div>)}</div>
    </Section>}
  </>;
}

function PreviewSection({ api, result, name }: { api: EditorApi; result: SettlementResult; name: string }) {
  const errors = result.issues.filter((i) => i.severity === 'error').length;
  return <Section title={`Xem trước · ${name}`} icon="eye">
    <p className={`${s.note} ${errors ? s.err : s.warn}`}>Bản xem trước chưa ghi vào bản đồ (viền cam). Duyệt trên bản đồ hoặc 3D rồi áp dụng.{result.grading ? ' Phần san nền (đào/đắp đất trong vùng) được ghi vào địa hình khi áp dụng.' : ''}</p>
    <ResultStats result={result} />
    <IssueList api={api} issues={result.issues} />
    <div className={s.btnRow}>
      <Btn icon="check" kind="primary" onClick={api.applyPreview} testId="apply-preview">Áp dụng</Btn>
      <Btn icon="x" onClick={api.discardPreview} testId="discard-preview">Bỏ</Btn>
    </div>
  </Section>;
}

function ResultStats({ result }: { result: SettlementResult }) {
  const st = result.stats;
  return <div className={s.stats} data-testid="result-stats">
    <div className={s.stat}><strong>{fmt(st.buildings ?? 0)}</strong><span>Công trình</span></div>
    <div className={s.stat}><strong>{fmt(st.props ?? 0)}</strong><span>Vật thể</span></div>
    <div className={s.stat}><strong>{fmt(st.roads ?? 0)}</strong><span>Tuyến đường</span></div>
    <div className={s.stat}><strong>{fmt(st.blocks ?? 0)}</strong><span>Ô phố</span></div>
    <div className={s.stat}><strong>{fmt(st.lots ?? 0)}</strong><span>Lô đất</span></div>
    <div className={s.stat}><strong>{((st.roadLength ?? 0) / 1000).toFixed(1)}</strong><span>km đường</span></div>
  </div>;
}

function IssueList({ api, issues }: { api: EditorApi; issues: SettlementIssue[] }) {
  const order = { error: 0, warning: 1, info: 2 };
  const list = [...issues].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 40);
  return <div className={s.list}>{list.map((i, k) => <button key={k} className={s.issue} onClick={() => { if (i.x !== undefined) api.centerOn(i.x, i.z!, 160); }}>
    <Icon name={i.severity === 'error' ? 'lucide:circle-x' : i.severity === 'warning' ? 'lucide:triangle-alert' : 'lucide:info'} className={s[`sev-${i.severity}`]} /><span>{i.message}</span></button>)}</div>;
}

/**
 * What the region is — a kind of settlement (the same list as the Model Studio's) and its
 * condition, plus a style where the kind has several — instead of 13 fixed presets: the layout
 * (preset) follows from them, and the Model Studio's buildings made for that kind and condition
 * are the ones placed.
 */
function RegionKind({ api, region }: { api: EditorApi; region: Region }) {
  const kind: SettlementKind = region.kind ?? kindOfArea(region.preset);
  const condition: BuildingCondition = region.condition ?? (region.preset === 'abandoned-settlement' || region.preset === 'abandoned-city' ? 'abandoned' : 'intact');
  const styles = SETTLEMENT_KIND_STYLES[kind].styles;
  const set = (label: string, k: SettlementKind, c: BuildingCondition, style?: string) => api.updateRegion(label, region.id, (r) => {
    const preset = areaFor(k, c, style ?? (r.preset as string));
    return { ...r, kind: k, condition: c, preset, settings: { ...presetSettings(preset), decay: CONDITION_DECAY[c] } };
  });
  const preset = SETTLEMENT_PRESETS.find((p) => p.id === region.preset);
  return <>
    <div className={s.field}><span className={s.fieldRow}>Kiểu khu vực</span>
      <div className={s.grid3} data-testid="presets">{SETTLEMENT_KINDS.map((k) => <button key={k} type="button" className={`${s.btn} ${kind === k ? s.primary : ''}`} onClick={() => set(`Kiểu: ${SETTLEMENT_KIND_NAMES[k]}`, k, condition)}>{SETTLEMENT_KIND_NAMES[k]}</button>)}</div></div>
    <div className={s.field}><span className={s.fieldRow}>Tình trạng</span>
      <Seg<BuildingCondition> value={condition} options={BUILDING_CONDITIONS.map((c) => ({ id: c, name: BUILDING_CONDITION_NAMES[c] }))} onChange={(c) => set(`Tình trạng: ${BUILDING_CONDITION_NAMES[c]}`, kind, c)} /></div>
    {condition === 'intact' && styles.length > 1 && <div className={s.field}><span className={s.fieldRow}>Phong cách</span>
      <Seg<string> value={region.preset} options={styles.map((id) => ({ id, name: SETTLEMENT_AREA_NAMES[id] }))} onChange={(st) => set('Phong cách', kind, condition, st)} /></div>}
    {preset && <p className={s.note}>{preset.description}</p>}
  </>;
}

/**
 * The AI picks what the region is: from the admin's words (optional) and the ground the region
 * covers — its size, water, height, slope and neighbours — it chooses the kind, condition, style
 * and a name (the Model Studio's AI connection; rules of thumb without one), lists the published
 * buildings that will stand there, and generates the region straight away.
 */
function RegionAi({ api, region, onGenerate }: { api: EditorApi; region: Region; onGenerate: () => void }) {
  const [prompt, setPrompt] = useState(''), [busy, setBusy] = useState(false), [asking, setAsking] = useState(false);
  const [plan, setPlan] = useState<RegionPlan | null>(null);
  const ask = async (password?: string) => {
    setBusy(true);
    try {
      if (password) await studioLogin(password);
      const hf = api.terrain, sea = api.doc.terrain.seaLevel;
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const [x, z] of region.polygon) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      // The ground: a grid of samples inside the polygon.
      let n = 0, wet = 0, height = 0, slope = 0;
      const stepX = (maxX - minX) / 16, stepZ = (maxZ - minZ) / 16;
      for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) {
        const x = minX + i * stepX, z = minZ + j * stepZ;
        if (!pointInPolygon(x, z, region.polygon)) continue;
        const h = hf.heightAt(x, z), water = waterLevelAt(hf, api.doc.water, sea, x, z);
        n++; height += h - sea; if (water !== null && water > h - .5) wet++;
        slope += Math.hypot(hf.heightAt(x + 2, z) - hf.heightAt(x - 2, z), hf.heightAt(x, z + 2) - hf.heightAt(x, z - 2)) / 4;
      }
      const r = await studioPlanRegion({ prompt, region: { area: Math.abs(polygonArea(region.polygon)), width: maxX - minX, depth: maxZ - minZ, water: n ? wet / n : 0, elevation: n ? height / n : 0, slope: n ? slope / n : 0,
        neighbours: api.doc.regions.filter((q) => q.id !== region.id).map((q) => q.name).slice(0, 30) } });
      const kind = r.kind as SettlementKind, condition = r.condition as BuildingCondition;
      api.updateRegion(`AI: ${r.name}`, region.id, (q) => ({ ...q, name: r.name, kind, condition, preset: r.preset as Region['preset'], settings: { ...presetSettings(r.preset as Region['preset']), decay: CONDITION_DECAY[condition] } }));
      setPlan(r);
      // Generated at once with what the AI chose (a preview, applied after review as always).
      window.setTimeout(onGenerate, 0);
    } catch (err) { api.flash(`AI không chọn được: ${err instanceof Error ? err.message : String(err)}`, true); throw err; }
    finally { setBusy(false); }
  };
  return <Section title="AI chọn kiểu khu vực" icon="sparkles" collapsible>
    <p className={s.lead}>Mô tả ngắn (tuỳ chọn), vd "căn cứ quân sự bỏ hoang trên đồi", "thị trấn ven biển". Để trống: AI tự chọn theo địa hình. Công trình là các model đã xuất bản từ Model Studio hợp với lựa chọn đó.</p>
    <textarea className={s.input} rows={2} value={prompt} maxLength={1000} onChange={(e) => setPrompt(e.target.value)} placeholder="Khu vực này là…" />
    <Btn icon="sparkles" kind="primary" disabled={busy || api.busy} onClick={() => { if (hasStudioSession()) void ask().catch(() => {}); else setAsking(true); }}>{busy ? 'AI đang chọn…' : 'AI chọn và sinh khu vực'}</Btn>
    {plan && <p className={s.note}>{plan.source === 'ai' ? 'AI' : 'Quy tắc (chưa nối AI)'}: {SETTLEMENT_KIND_NAMES[plan.kind as SettlementKind]} · {BUILDING_CONDITION_NAMES[plan.condition as BuildingCondition]} · {SETTLEMENT_AREA_NAMES[plan.preset as Region['preset']]}{plan.reason ? ` — ${plan.reason}` : ''}. {plan.buildings.length ? `${plan.buildings.length} công trình Model Studio hợp: ${plan.buildings.slice(0, 8).map((b) => b.name).join(', ')}${plan.buildings.length > 8 ? '…' : ''}.` : 'Chưa có công trình Model Studio nào hợp: dùng nhà có sẵn.'}</p>}
    {asking && <ConfirmDialog title="Đăng nhập Studio" message="Nhập mật khẩu Studio để dùng AI." password danger={false} confirmLabel="Tiếp"
      onCancel={() => setAsking(false)} onConfirm={async (pw) => { await ask(pw); setAsking(false); }} />}
  </Section>;
}
