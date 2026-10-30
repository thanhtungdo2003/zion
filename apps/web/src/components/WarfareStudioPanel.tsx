'use client';
import { WARFARE_DEFAULTS, WARFARE_POINT_KINDS, WARFARE_VEHICLE_KINDS, autoWarfareLayout, parseWarfareConfig, validateWarfareLayout, type WarfareLayout, type WarfarePointKind, type WarfareSide } from '@zion/shared';
import type React from 'react';
import { Icon } from './Icon';

/** What the Warfare tools place on the plan (the Studio's tool for Warfare). */
export type WarfareTool = 'zone' | 'blue' | 'red' | 'vehicle' | 'spawn' | 'point';
export type WarfareSel = { kind: 'wfZone'; index: number } | { kind: 'wfBase'; side: WarfareSide } | { kind: 'wfVehicle'; index: number };

export const WF_COLORS: Record<WarfareSide | 'neutral', string> = { blue: '#4fa3ff', red: '#ff5a4a', neutral: '#d6d6d6' };
export const WF_POINT_LABEL: Record<WarfarePointKind, string> = { cover: 'Ẩn nấp', overwatch: 'Quan sát', sniper: 'Bắn tỉa', defend: 'Phòng thủ' };
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa'];
const VEHICLE_NAMES: Record<string, string> = { jeep: 'Jeep Willys', quad: 'Xe địa hình (quad)' };

/** The map's Warfare layout, created empty when the map has none yet. */
export function ensureWarfare(d: { warfare?: WarfareLayout }): WarfareLayout {
  d.warfare ??= { enabled: false, zones: [], vehicleSpawns: [] };
  return d.warfare;
}

/** A new zone at a point (id and name from the phonetic alphabet, free ones first). */
export function newZone(layout: WarfareLayout, x: number, z: number): WarfareLayout['zones'][number] {
  const used = new Set(layout.zones.map((zz) => zz.id));
  const name = NAMES.find((n) => !used.has(n.toLowerCase())) ?? `Z${layout.zones.length + 1}`;
  return { id: name.toLowerCase(), name, x, z, radius: 10, owner: null, spawns: [], points: [], links: [], value: 1 };
}

/** The Warfare part of a map in the Studio: on/off, tools, the selected item, rules, checks. */
export function WarfareStudioPanel({ layout: wf, half, patchLayout, sel, setSel, tool, setTool, pointKind, setPointKind, vehicleSide, setVehicleSide, defaultArea, children }: {
  /** The map's battlefield (absent until first edited). */
  layout: WarfareLayout | undefined;
  /** The map's own half width (walled maps); large maps use the layout's area instead. */
  half: number;
  /** Edits the layout (created empty when there is none). */
  patchLayout: (fn: (l: WarfareLayout) => void) => void;
  sel: WarfareSel | null; setSel: (s: WarfareSel | null) => void;
  /** The panel's own tool buttons (absent: the host has its own tool rail). */
  tool?: WarfareTool | null; setTool?: (t: WarfareTool | null) => void;
  pointKind: WarfarePointKind; setPointKind: (k: WarfarePointKind) => void;
  vehicleSide: WarfareSide; setVehicleSide: (s: WarfareSide) => void;
  /** Large maps: the battlefield area an automatic layout gets when none is set yet. */
  defaultArea?: { x: number; z: number; half: number };
  children?: React.ReactNode;
}) {
  type Draft = { warfare?: WarfareLayout };
  const patch = (fn: (d: Draft) => void) => patchLayout((l) => { const d: Draft = { warfare: l }; fn(d); if (d.warfare !== l) { for (const k of Object.keys(l)) delete (l as Record<string, unknown>)[k]; Object.assign(l, d.warfare); } });
  const errors = wf ? validateWarfareLayout(wf, half) : [];
  const cfg = parseWarfareConfig(wf?.config ?? {});
  const setCfg = (key: string, value: unknown) => patch((d) => { const l = ensureWarfare(d); l.config = { ...(l.config ?? {}), [key]: value }; });
  const setVeh = (key: string, value: unknown) => patch((d) => { const l = ensureWarfare(d); const c = parseWarfareConfig(l.config ?? {}); l.config = { ...(l.config ?? {}), vehicles: { ...c.vehicles, [key]: value } }; });
  const zone = sel?.kind === 'wfZone' ? wf?.zones[sel.index] : undefined;
  const veh = sel?.kind === 'wfVehicle' ? wf?.vehicleSpawns[sel.index] : undefined;
  const field = (label: string, value: number, set: (v: number) => void, min: number, max: number, step: number, unit = '') => (
    <label className="ix-field" key={label}><span>{label}<b>{Number.isInteger(step) ? value : value.toFixed(step < .1 ? 2 : 1)}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} /></label>
  );
  const toolBtn = (t: WarfareTool, icon: string, title: string) => <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool?.(tool === t ? null : t)} title={title}><Icon name={icon} /></button>;
  return (
    <section className="ix-section wf-studio">
      <h3>Chiến trường (Warfare)</h3>
      <label className="ix-check"><input type="checkbox" checked={!!wf?.enabled} onChange={(e) => patch((d) => { ensureWarfare(d).enabled = e.target.checked; })} /> Dùng bản đồ này cho chế độ Chiến trường</label>
      {!wf?.zones.length && <button className="btn" onClick={() => patch((d) => { const area = d.warfare?.area ?? defaultArea; const auto = autoWarfareLayout(area?.half ?? half); d.warfare = { ...auto, enabled: d.warfare?.enabled ?? true, ...(area ? { area } : {}), ...(d.warfare?.config ? { config: d.warfare.config } : {}) }; })}><Icon name="lucide:wand-2" /> Tạo bố cục tự động</button>}
      {defaultArea && wf?.area && field('Nửa cạnh vùng chiến trường', wf.area.half, (v) => patch((d) => { ensureWarfare(d).area!.half = v; }), 30, 400, 5, ' m')}
      {defaultArea && !wf?.area && <p className="ix-hint">Đặt tâm vùng chiến trường bằng công cụ vùng (◎) trên thanh bên trái, hoặc bấm Tạo bố cục tự động.</p>}
      {children}
      {setTool && <div className="ix-tools wf-tools">
        {toolBtn('zone', 'lucide:flag', 'Cứ điểm: nhấp để thêm / chọn')}
        {toolBtn('blue', 'lucide:shield', 'Căn cứ phe Xanh (tấn công)')}
        {toolBtn('red', 'lucide:castle', 'Căn cứ phe Đỏ (phòng thủ)')}
        {toolBtn('spawn', 'lucide:map-pin', 'Điểm triển khai của cứ điểm đang chọn (bấm lại để xóa)')}
        {toolBtn('point', 'lucide:crosshair', 'Điểm chiến thuật cho AI trong cứ điểm đang chọn')}
        {toolBtn('vehicle', 'lucide:car-front', 'Điểm xuất hiện phương tiện (bấm lại để xóa)')}
      </div>}
      {tool === 'point' && <div className="ix-row">{WARFARE_POINT_KINDS.map((k) => <button key={k} className={`btn${pointKind === k ? ' on' : ''}`} onClick={() => setPointKind(k)}>{WF_POINT_LABEL[k]}</button>)}</div>}
      {tool === 'vehicle' && <div className="ix-row">{(['blue', 'red'] as const).map((s) => <button key={s} className={`btn${vehicleSide === s ? ' on' : ''}`} onClick={() => setVehicleSide(s)}>Phe {s === 'blue' ? 'Xanh' : 'Đỏ'}</button>)}</div>}
      {(tool === 'spawn' || tool === 'point') && !zone && <p className="ix-hint">Chọn một cứ điểm trước (công cụ cờ hoặc con trỏ).</p>}

      {zone && sel?.kind === 'wfZone' && <div className="wf-item">
        <h4>Cứ điểm {zone.name} <small>({zone.id})</small></h4>
        <label className="ix-field"><span>Tên</span><input value={zone.name} maxLength={32} onChange={(e) => patch((d) => { ensureWarfare(d).zones[sel.index]!.name = e.target.value || zone.id; })} /></label>
        {field('Bán kính chiếm', zone.radius, (v) => patch((d) => { ensureWarfare(d).zones[sel.index]!.radius = v; }), 4, 60, 1, ' m')}
        {field('Giá trị chiến thuật', zone.value, (v) => patch((d) => { ensureWarfare(d).zones[sel.index]!.value = v; }), .2, 5, .1, '×')}
        <label className="ix-field"><span>Phe giữ lúc đầu</span>
          <select value={zone.owner ?? ''} onChange={(e) => patch((d) => { ensureWarfare(d).zones[sel.index]!.owner = (e.target.value || null) as WarfareSide | null; })}>
            <option value="">Trung lập</option><option value="blue">Phe Xanh</option><option value="red">Phe Đỏ</option>
          </select></label>
        <div className="wf-links"><small>Nối tới (tuyến tiến công)</small>
          {wf!.zones.filter((z) => z.id !== zone.id).map((z) => <label key={z.id} className="ix-check"><input type="checkbox" checked={zone.links.includes(z.id)} onChange={(e) => patch((d) => {
            const l = ensureWarfare(d), a = l.zones[sel.index]!, b = l.zones.find((x) => x.id === z.id)!;
            a.links = e.target.checked ? [...new Set([...a.links, z.id])] : a.links.filter((x) => x !== z.id);
            b.links = e.target.checked ? [...new Set([...b.links, a.id])] : b.links.filter((x) => x !== a.id);
          })} /> {z.name}</label>)}
        </div>
        <p className="ix-hint">{zone.spawns.length} điểm triển khai{zone.spawns.length ? '' : ' (tự động quanh vòng)'} · {zone.points.length} điểm chiến thuật</p>
        <div className="ix-row">
          {zone.spawns.length > 0 && <button className="btn" onClick={() => patch((d) => { ensureWarfare(d).zones[sel.index]!.spawns = []; })}>Xóa điểm triển khai</button>}
          {zone.points.length > 0 && <button className="btn" onClick={() => patch((d) => { ensureWarfare(d).zones[sel.index]!.points = []; })}>Xóa điểm chiến thuật</button>}
          <button className="btn" onClick={() => { patch((d) => { const l = ensureWarfare(d), id = l.zones[sel.index]!.id; l.zones.splice(sel.index, 1); for (const z of l.zones) z.links = z.links.filter((x) => x !== id); }); setSel(null); }}><Icon name="lucide:trash" /> Xóa cứ điểm</button>
        </div>
      </div>}

      {veh && sel?.kind === 'wfVehicle' && <div className="wf-item">
        <h4>Phương tiện #{sel.index + 1}</h4>
        <label className="ix-field"><span>Loại</span><select value={veh.kind} onChange={(e) => patch((d) => { ensureWarfare(d).vehicleSpawns[sel.index]!.kind = e.target.value as typeof veh.kind; })}>
          {WARFARE_VEHICLE_KINDS.map((k) => <option key={k} value={k}>{VEHICLE_NAMES[k] ?? k}</option>)}
        </select></label>
        <label className="ix-field"><span>Phe được dùng</span><select value={veh.side} onChange={(e) => patch((d) => { ensureWarfare(d).vehicleSpawns[sel.index]!.side = e.target.value as WarfareSide; })}>
          <option value="blue">Phe Xanh</option><option value="red">Phe Đỏ</option>
        </select></label>
        {field('Hướng đầu xe', Math.round(veh.yaw * 180 / Math.PI), (v) => patch((d) => { ensureWarfare(d).vehicleSpawns[sel.index]!.yaw = v * Math.PI / 180; }), -180, 180, 5, '°')}
        <button className="btn" onClick={() => { patch((d) => { ensureWarfare(d).vehicleSpawns.splice(sel.index, 1); }); setSel(null); }}><Icon name="lucide:trash" /> Xóa</button>
      </div>}

      {wf && <details className="wf-rules">
        <summary>Luật trận đấu</summary>
        {field('Quân số dự bị mỗi phe', cfg.tickets, (v) => setCfg('tickets', v), 10, 1000, 10)}
        {field('Tối đa trên chiến trường', cfg.maxActive, (v) => setCfg('maxActive', v), 4, 50, 1, ' người')}
        {field('Thời gian hồi sinh', cfg.respawnSeconds, (v) => setCfg('respawnSeconds', v), 1, 60, 1, ' s')}
        {field('Bot đi theo mỗi người', cfg.followerCap, (v) => setCfg('followerCap', v), 0, 12, 1)}
        {field('Bot mỗi đội AI', cfg.squadSize, (v) => setCfg('squadSize', v), 2, 8, 1)}
        {field('Thời gian chiếm (1 người)', cfg.captureSeconds, (v) => setCfg('captureSeconds', v), 2, 120, 1, ' s')}
        {field('Mất quân theo cứ điểm', cfg.bleedPerZone, (v) => setCfg('bleedPerZone', v), 0, 2, .05, '/s')}
        {field('Mất quân tối đa', cfg.bleedMaxPerSecond, (v) => setCfg('bleedMaxPerSecond', v), 0, 5, .1, '/s')}
        {field('Chỉ mất quân khi kém từ', cfg.bleedMinLead, (v) => setCfg('bleedMinLead', v), 1, 10, 1, ' cứ điểm')}
        {field('Thời gian trận (0 = không giới hạn)', cfg.timeLimitMinutes, (v) => setCfg('timeLimitMinutes', v), 0, 180, 5, ' phút')}
        {field('Thắng khi giữ mọi cứ điểm (0 = tắt)', cfg.allZonesSeconds, (v) => setCfg('allZonesSeconds', v), 0, 600, 15, ' s')}
        <label className="ix-field"><span>Điểm triển khai</span><select value={cfg.spawnRule} onChange={(e) => setCfg('spawnRule', e.target.value)}>
          <option value="any-held">Mọi cứ điểm đang giữ</option><option value="front">Chỉ cứ điểm gần mặt trận</option><option value="base-only">Chỉ căn cứ</option>
        </select></label>
        <label className="ix-check"><input type="checkbox" checked={cfg.botFill} onChange={(e) => setCfg('botFill', e.target.checked)} /> Bổ sung bot cho đủ quân</label>
        <label className="ix-check"><input type="checkbox" checked={cfg.vehicles.enabled} onChange={(e) => setVeh('enabled', e.target.checked)} /> Phương tiện</label>
        {cfg.vehicles.enabled && <>
          {field('Xe tối đa mỗi phe', cfg.vehicles.maxPerSide, (v) => setVeh('maxPerSide', v), 0, 12, 1)}
          {field('Xác xe tồn tại', cfg.vehicles.wreckSeconds, (v) => setVeh('wreckSeconds', v), 2, 300, 1, ' s')}
          {field('Chờ xuất hiện lại', cfg.vehicles.cooldownSeconds, (v) => setVeh('cooldownSeconds', v), 5, 600, 5, ' s')}
        </>}
        <button className="btn" onClick={() => patch((d) => { delete ensureWarfare(d).config; })}><Icon name="lucide:rotate-ccw" /> Luật mặc định ({WARFARE_DEFAULTS.tickets} quân, {WARFARE_DEFAULTS.maxActive} người, {WARFARE_DEFAULTS.respawnSeconds} s)</button>
      </details>}

      {wf && (errors.length
        ? <ul className="wf-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        : <p className="ix-hint wf-ok"><Icon name="lucide:check" /> Bố cục hợp lệ: {wf.zones.length} cứ điểm, {wf.vehicleSpawns.length} điểm phương tiện.</p>)}
      {wf?.enabled && errors.length > 0 && <p className="ix-hint">Bản đồ chưa xuất bản được cho Chiến trường cho tới khi sửa các lỗi trên.</p>}
    </section>
  );
}
