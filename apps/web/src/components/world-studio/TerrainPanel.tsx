'use client';

import { BRUSH_SHAPES, PAINT_SURFACES, SCULPT_PATTERNS, carveLake, carveRiver, lakeSpillLevel, riverLevels, riverMaxGrade, type BrushShape, type WorldMapDoc } from '@zion/worldgen/editor';
import type { EditorApi } from './editor-api';
import { isBrush } from './types';
import { Btn, NumberField, Section, Seg, Slider, TextField } from './ui';
import s from './world-studio.module.css';

const TOOL_TEXT: Record<string, [string, string]> = {
  raise: ['Nâng địa hình', 'Kéo để đắp cao. Giữ yên chuột để tiếp tục nâng.'],
  lower: ['Hạ địa hình', 'Kéo để đào thấp.'],
  smooth: ['Làm mượt', 'San đều các mấp mô, giữ dáng tổng thể.'],
  flatten: ['San phẳng', 'Kéo về độ cao mục tiêu. Alt+click để lấy độ cao tại chỗ.'],
  sculpt: ['Tạo hình', 'Đóng dấu một mẫu địa hình theo bán kính bút.'],
  noise: ['Nhiễu tự nhiên', 'Thêm gồ ghề tự nhiên cho vùng quá phẳng.'],
  erosion: ['Xói mòn', 'Mô phỏng nước chảy: khoét rãnh trên sườn và bồi lắng chân dốc.'],
  paint: ['Tô bề mặt', 'Đánh dấu loại bề mặt: đất, cỏ, đá, cát…'],
};

export function TerrainPanel({ api }: { api: EditorApi }) {
  const { brush, setBrush, tool, doc, selection } = api;
  const lake = selection?.kind === 'shape' && selection.shape === 'lake' ? doc.water.lakes.find((l) => l.id === selection.id) : undefined;
  const river = selection?.kind === 'shape' && selection.shape === 'river' ? doc.water.rivers.find((l) => l.id === selection.id) : undefined;
  const setWater = (label: string, water: WorldMapDoc['water'], key?: string) => api.commit(label, { ...api.doc, water }, { key });
  const info = TOOL_TEXT[tool];

  return <>
    {lake && <Section title="Hồ" icon="circle-dashed">
      <TextField label="Tên" value={lake.name} onChange={(name) => setWater('Đổi tên hồ', { ...doc.water, lakes: doc.water.lakes.map((l) => (l.id === lake.id ? { ...l, name } : l)) }, `lake-name-${lake.id}`)} />
      <div className={s.grid2}>
        <NumberField label="Mặt nước" unit="m" step={.1} value={lake.level} onChange={(level) => setWater('Mực nước hồ', { ...doc.water, lakes: doc.water.lakes.map((l) => (l.id === lake.id ? { ...l, level } : l)) }, `lake-level-${lake.id}`)} />
        <NumberField label="Độ sâu" unit="m" min={0} max={100} value={lake.depth} onChange={(depth) => setWater('Độ sâu hồ', { ...doc.water, lakes: doc.water.lakes.map((l) => (l.id === lake.id ? { ...l, depth } : l)) }, `lake-depth-${lake.id}`)} />
      </div>
      {lake.level > lakeSpillLevel(api.terrain, lake) + .5 && <p className={`${s.note} ${s.warn}`}>Mặt nước cao hơn bờ thấp nhất ({lakeSpillLevel(api.terrain, lake).toFixed(1)} m): nước sẽ tràn.</p>}
      <div className={s.btnRow}>
        <Btn icon="shovel" onClick={() => api.terrainOp(`Khắc ${lake.name}`, (t) => carveLake(t, lake))}>Khắc lòng hồ</Btn>
        <Btn icon="trash-2" kind="danger" onClick={() => { api.setSelection(null); setWater('Xóa hồ', { ...doc.water, lakes: doc.water.lakes.filter((l) => l.id !== lake.id) }); }}>Xóa</Btn>
      </div>
      <p className={s.lead}>Kéo các đỉnh trên bản đồ để sửa bờ (công cụ Chọn). Dữ liệu nước lưu riêng, không tô màu lên địa hình.</p>
    </Section>}
    {river && <Section title="Sông" icon="spline">
      <TextField label="Tên" value={river.name} onChange={(name) => setWater('Đổi tên sông', { ...doc.water, rivers: doc.water.rivers.map((l) => (l.id === river.id ? { ...l, name } : l)) }, `river-name-${river.id}`)} />
      <div className={s.grid2}>
        <NumberField label="Độ sâu lòng" unit="m" min={0} max={50} step={.5} value={river.depth} onChange={(depth) => setWater('Độ sâu sông', { ...doc.water, rivers: doc.water.rivers.map((l) => (l.id === river.id ? { ...l, depth, levels: undefined } : l)) }, `river-depth-${river.id}`)} />
        <NumberField label="Rộng (nguồn)" unit="m" min={2} max={200} value={river.points[0]!.width} onChange={(w) => {
          const k = w / river.points[0]!.width;
          setWater('Độ rộng sông', { ...doc.water, rivers: doc.water.rivers.map((l) => (l.id === river.id ? { ...l, levels: undefined, points: l.points.map((p) => ({ ...p, width: Math.max(2, Math.round(p.width * k)) })) } : l)) }, `river-width-${river.id}`);
        }} />
      </div>
      {(() => { const lv = river.levels ?? riverLevels(api.terrain, river); return <p className={s.note}>Mặt nước {lv[0]!.toFixed(1)} → {lv[lv.length - 1]!.toFixed(1)} m · dốc lớn nhất {riverMaxGrade(river, lv).toFixed(1)}% · {river.points.length} điểm{river.levels ? '' : ' · chưa khắc'}</p>; })()}
      <div className={s.btnRow}>
        <Btn icon="shovel" kind={river.levels ? undefined : 'primary'} onClick={() => {
          let levels: number[] = [];
          api.terrainOp(`Khắc ${river.name}`, (t) => { const r = carveRiver(t, river); levels = r.levels; return r.rect; }, (d) => ({ ...d, water: { ...d.water, rivers: d.water.rivers.map((l) => (l.id === river.id ? { ...l, levels } : l)) } }));
        }}>Khắc lòng sông</Btn>
        <Btn icon="trash-2" kind="danger" onClick={() => { api.setSelection(null); setWater('Xóa sông', { ...doc.water, rivers: doc.water.rivers.filter((l) => l.id !== river.id) }); }}>Xóa</Btn>
      </div>
    </Section>}

    {isBrush(tool) && info && <Section title={info[0]} icon="paintbrush">
      <p className={s.lead}>{info[1]}</p>
      <Slider label="Bán kính" unit=" m" min={4} max={600} value={brush.radius} onChange={(radius) => setBrush({ ...brush, radius })} testId="brush-radius" />
      {tool !== 'paint' && <Slider label="Cường độ" min={.05} max={1} step={.05} value={brush.strength} onChange={(strength) => setBrush({ ...brush, strength })} format={(v) => `${Math.round(v * 100)}%`} />}
      <Slider label="Độ mềm mép" min={0} max={1} step={.05} value={brush.falloff} onChange={(falloff) => setBrush({ ...brush, falloff })} format={(v) => `${Math.round(v * 100)}%`} />
      <div className={s.field}><span className={s.fieldRow}>Hình bút</span><Seg<BrushShape> value={brush.shape} options={BRUSH_SHAPES.map((id) => ({ id, name: id === 'circle' ? 'Tròn' : 'Vuông' }))} onChange={(shape) => setBrush({ ...brush, shape })} /></div>
      {tool === 'flatten' && <NumberField label="Độ cao mục tiêu" unit="m (Alt+click để lấy)" step={.5} value={brush.targetHeight} onChange={(targetHeight) => setBrush({ ...brush, targetHeight })} />}
      {tool === 'sculpt' && <>
        <div className={s.field}><span className={s.fieldRow}>Mẫu (pattern preset)</span>
          <div className={s.grid3}>{SCULPT_PATTERNS.map((p) => <button key={p.id} type="button" className={`${s.btn} ${brush.pattern === p.id ? s.primary : ''}`} onClick={() => setBrush({ ...brush, pattern: p.id })}>{p.name}</button>)}</div></div>
        {(brush.pattern === 'ridge' || brush.pattern === 'dune') && <Slider label="Hướng" unit="°" min={0} max={180} value={Math.round(brush.angle * 180 / Math.PI)} onChange={(a) => setBrush({ ...brush, angle: a * Math.PI / 180 })} />}
      </>}
      {tool === 'paint' && <div className={s.field}><span className={s.fieldRow}>Bề mặt</span>
        <div className={s.swatches}>{PAINT_SURFACES.map((p) => <button key={p.id} type="button" className={`${s.swatch} ${brush.surface === p.id ? s.on : ''}`} style={{ background: `rgb(${p.color.join(',')})` }} onClick={() => setBrush({ ...brush, surface: p.id })} title={p.name}>{p.name}</button>)}</div></div>}
    </Section>}

    {(tool === 'draw-river' || tool === 'draw-lake') && <Section title={tool === 'draw-river' ? 'Vẽ sông' : 'Vẽ hồ'} icon="droplets">
      {tool === 'draw-river'
        ? <><p className={s.lead}>Nhấp từ nguồn tới cửa sông. Mực nước tự giảm dần theo dòng chảy, lòng sông được khắc thấp hơn mặt nước, bờ thoải dần.</p>
          <Slider label="Độ rộng ở nguồn" unit=" m" min={4} max={80} value={api.riverWidth} onChange={api.setRiverWidth} /></>
        : <p className={s.lead}>Nhấp quanh bờ. Mặt hồ đặt dưới bờ thấp nhất 0,4 m để nước không tràn; đáy hồ được khắc sâu dần vào giữa.</p>}
    </Section>}

    <Section title="Sông hồ" icon="waves" collapsible initiallyOpen={!isBrush(tool)}>
      {!doc.water.lakes.length && !doc.water.rivers.length && <p className={s.lead}>Chưa có. Dùng công cụ Vẽ hồ / Vẽ sông ở thanh bên trái.</p>}
      <div className={s.list}>
        {doc.water.lakes.map((l) => <button key={l.id} className={`${s.listItem} ${lake?.id === l.id ? s.on : ''}`} onClick={() => { api.setTool('select'); api.setSelection({ kind: 'shape', shape: 'lake', id: l.id }); api.centerOn(l.polygon[0]![0], l.polygon[0]![1]); }}><span>{l.name}</span><small>{l.level.toFixed(1)} m</small></button>)}
        {doc.water.rivers.map((l) => <button key={l.id} className={`${s.listItem} ${river?.id === l.id ? s.on : ''}`} onClick={() => { api.setTool('select'); api.setSelection({ kind: 'shape', shape: 'river', id: l.id }); api.centerOn(l.points[0]!.x, l.points[0]!.z); }}><span>{l.name}</span><small>{l.points.length} điểm</small></button>)}
      </div>
    </Section>

    <Section title="Địa hình" icon="mountain" collapsible initiallyOpen={false}>
      <TerrainStats terrain={api.terrain} />
      <p className={s.lead}>Sinh lại từ seed, đổi preset, độ cao, độ gồ ghề, kích thước: tab Thiết lập.</p>
    </Section>
  </>;
}

/** Only computed while its section is open (it reads every cell). */
function TerrainStats({ terrain }: { terrain: EditorApi['terrain'] }) {
  const st = terrain.stats();
  return <div className={s.stats}>
    <div className={s.stat}><strong>{st.min.toFixed(0)}</strong><span>Thấp nhất m</span></div>
    <div className={s.stat}><strong>{st.max.toFixed(0)}</strong><span>Cao nhất m</span></div>
    <div className={s.stat}><strong>{terrain.cell}</strong><span>m / ô lưới</span></div>
  </div>;
}
