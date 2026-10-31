'use client';

import { useState } from 'react';
import {
  BIOMES as ENV_BIOMES, BIOME_IDS, ENV_PARTICLES, ENV_QUALITY, ENVIRONMENT_PRESETS, WEATHER, WEATHER_IDS, applyEnvironmentPreset, mapEnvironmentSchema, readEnvironment,
  type BiomeId, type EnvParams, type EnvParticles, type EnvQuality, type EnvZone, type MapEnvironment, type WeatherId,
} from '@zion/shared';
import { newId } from '@zion/worldgen/editor';
import { hasStudioSession, publishedMapId, studioLogin, studioSetBattleMapEnvironment } from '@/lib/api';
import { ConfirmDialog } from '../ConfirmDialog';
import type { EditorApi } from './editor-api';
import { Btn, Check, Section, Seg, Slider, TextField } from './ui';
import s from './world-studio.module.css';

const PARTICLE_NAMES: Record<EnvParticles, string> = { none: 'Không', dust: 'Bụi', sand: 'Cát', ash: 'Tro', mist: 'Sương', pollen: 'Phấn hoa' };
const QUALITY_NAMES: Record<EnvQuality, string> = { auto: 'Tự động', low: 'Thấp', medium: 'Vừa', high: 'Cao', ultra: 'Rất cao' };
const CUSTOM_KEY = 'zion.studio.env-presets.v1';
const deg = (r: number) => Math.round(((r * 180 / Math.PI) % 360 + 360) % 360);
const rad = (d: number) => d * Math.PI / 180;
const clock = (t: number) => { const m = Math.round(t * 24 * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/** The map's environment (the default when the map has none yet). */
export const envOf = (api: EditorApi): MapEnvironment => readEnvironment(api.doc.environment);

/** Saved environment presets of this browser (reusable on any map). */
function loadCustom(): Array<{ name: string; env: MapEnvironment }> {
  try { const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as Array<{ name: string; env: unknown }>; return raw.flatMap((p) => { const r = mapEnvironmentSchema.safeParse(p.env); return r.success && typeof p.name === 'string' ? [{ name: p.name, env: r.data }] : []; }); } catch { return []; }
}
function saveCustom(list: Array<{ name: string; env: MapEnvironment }>): void { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* storage off: the presets last this session */ } }

/** Climate parameters of the map's base or of one zone. */
function ParamsEditor({ params, set }: { params: EnvParams; set: (p: EnvParams, key: string) => void }) {
  const up = <K extends keyof EnvParams>(k: K, v: EnvParams[K]) => set({ ...params, [k]: v }, String(k));
  return <>
    <Slider label="Bụi trong không khí" min={0} max={1} step={.05} value={params.dust} onChange={(v) => up('dust', v)} format={(v) => `${Math.round(v * 100)}%`} />
    <Slider label="Độ ẩm" min={0} max={1} step={.05} value={params.humidity} onChange={(v) => up('humidity', v)} format={(v) => `${Math.round(v * 100)}%`} />
    <Slider label="Sương mù / mù khô cục bộ" min={0} max={2} step={.05} value={params.fog} onChange={(v) => up('fog', v)} format={(v) => v.toFixed(2)} />
    <div className={s.field}><span className={s.fieldRow}>Màu sương
      <span><input type="checkbox" checked={params.fogColor !== null} onChange={(e) => up('fogColor', e.target.checked ? '#a8a49a' : null)} /> riêng {params.fogColor && <input type="color" value={params.fogColor} onChange={(e) => up('fogColor', e.target.value)} />}</span></span></div>
    <Slider label="Hướng gió" unit="°" min={0} max={359} value={deg(params.windDir)} onChange={(v) => up('windDir', rad(v))} />
    <Slider label="Gió thêm" unit=" m/s" min={0} max={30} step={.5} value={params.windSpeed} onChange={(v) => up('windSpeed', v)} />
    <Slider label="Nhiệt độ" unit=" °C" min={-30} max={55} value={params.temperature} onChange={(v) => up('temperature', v)} />
    <Slider label="Độ ẩm ướt mặt đất" min={0} max={1} step={.05} value={params.wetness} onChange={(v) => up('wetness', v)} format={(v) => `${Math.round(v * 100)}%`} />
    <div className={s.field}><span className={s.fieldRow}>Tông màu mặt đất<input type="color" value={params.tint} onChange={(e) => up('tint', e.target.value)} /></span></div>
    <Slider label="Độ đậm tông màu" min={0} max={1} step={.05} value={params.tintStrength} onChange={(v) => up('tintStrength', v)} format={(v) => `${Math.round(v * 100)}%`} />
    <div className={s.field}><span className={s.fieldRow}>Hạt trong không khí</span><Seg<EnvParticles> value={params.particles} options={ENV_PARTICLES.map((id) => ({ id, name: PARTICLE_NAMES[id] }))} onChange={(v) => up('particles', v)} /></div>
    {params.particles !== 'none' && <Slider label="Mật độ hạt" min={0} max={1} step={.05} value={params.particleDensity} onChange={(v) => up('particleDensity', v)} format={(v) => `${Math.round(v * 100)}%`} />}
  </>;
}

/**
 * The Môi trường tab: the map's weather, sky, time of day, haze, wind and grade; the base climate
 * and local climate zones (drawn on the map); battlefield presets, saved presets, import/export;
 * live preview in the 3D view; and sending it to the server for a published map.
 */
export function EnvironmentPanel({ api }: { api: EditorApi }) {
  const env = envOf(api);
  const [custom, setCustom] = useState(loadCustom);
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false);
  const zone = api.selection?.kind === 'envZone' ? env.zones.find((z) => z.id === (api.selection as { id: string }).id) : undefined;
  const set = (label: string, fn: (e: MapEnvironment) => void, key?: string) => {
    const next = structuredClone(env); fn(next);
    api.commit(label, { ...api.doc, environment: mapEnvironmentSchema.parse(next) }, key ? { key: `env-${key}` } : undefined);
  };
  const setZone = (label: string, id: string, fn: (z: EnvZone) => void, key?: string) => set(label, (e) => { const z = e.zones.find((q) => q.id === id); if (z) fn(z); }, key ? `${id}-${key}` : undefined);
  const preview = api.envPreview;

  const send = async (password?: string) => {
    setBusy(true);
    try {
      if (password) await studioLogin(password);
      await studioSetBattleMapEnvironment(publishedMapId(api.doc.meta.id), env);
      api.flash('Đã gửi môi trường lên máy chủ — người chơi vào trận mới sẽ thấy.');
    } catch (err) { api.flash(`Không gửi được: ${err instanceof Error ? err.message : String(err)}`, true); throw err; }
    finally { setBusy(false); }
  };
  const exportEnv = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'zion-environment', ...env }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${api.doc.meta.name}-moi-truong.json`; a.click(); URL.revokeObjectURL(url);
  };
  const importEnv = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = () => void input.files?.[0]?.text().then((text) => {
      try {
        const { format: _format, ...raw } = JSON.parse(text) as Record<string, unknown>;
        const r = mapEnvironmentSchema.safeParse(raw);
        if (!r.success) throw new Error(r.error.issues.slice(0, 2).map((i) => `${i.path.join('.')} — ${i.message}`).join('; '));
        api.commit('Nhập môi trường', { ...api.doc, environment: r.data });
        api.flash('Đã nhập cấu hình môi trường.');
      } catch (err) { api.flash(`Tệp môi trường không hợp lệ: ${err instanceof Error ? err.message : String(err)}`, true); }
    });
    input.click();
  };

  return <>
    <Section title="Xem trước trực tiếp" icon="eye">
      <p className={s.lead}>Xem môi trường trong cảnh 3D, ở tầm mắt người chơi: mọi thay đổi bên dưới hiện ngay. Kéo chuột để nhìn quanh, nhấp đúp lên mặt đất để đứng ở chỗ khác.</p>
      <div className={s.btnRow}>
        <Btn icon="eye" kind={preview.on ? 'primary' : undefined} onClick={() => api.setEnvPreview({ ...preview, on: !preview.on })} testId="env-preview">{preview.on ? 'Tắt xem trước' : 'Xem trước 3D'}</Btn>
        {preview.on && <Btn icon="split" kind={preview.before ? 'primary' : undefined} onClick={() => api.setEnvPreview({ ...preview, before: !preview.before })} title="So sánh với bầu trời mặc định">{preview.before ? 'Đang xem: trước' : 'Đang xem: sau'}</Btn>}
      </div>
    </Section>

    {zone && <Section title={`Vùng: ${zone.name}`} icon="map">
      <TextField label="Tên" value={zone.name} onChange={(name) => name && setZone('Đổi tên vùng', zone.id, (z) => { z.name = name; }, 'name')} />
      <div className={s.field}><span className={s.fieldRow}>Kiểu khí hậu (áp preset)</span>
        <div className={s.grid3}>{BIOME_IDS.map((b) => <button key={b} type="button" className={`${s.btn} ${zone.biome === b ? s.primary : ''}`} onClick={() => setZone('Áp kiểu khí hậu', zone.id, (z) => { z.biome = b; z.params = { ...ENV_BIOMES[b].params }; })}>{ENV_BIOMES[b].name}</button>)}</div></div>
      {zone.shape.kind === 'circle' && <Slider label="Bán kính" unit=" m" min={5} max={3000} value={zone.shape.r} onChange={(r) => setZone('Bán kính vùng', zone.id, (z) => { if (z.shape.kind === 'circle') z.shape.r = r; }, 'r')} />}
      {zone.shape.kind === 'box' && <>
        <Slider label="Nửa rộng" unit=" m" min={5} max={3000} value={zone.shape.hx} onChange={(v) => setZone('Kích thước vùng', zone.id, (z) => { if (z.shape.kind === 'box') z.shape.hx = v; }, 'hx')} />
        <Slider label="Nửa dài" unit=" m" min={5} max={3000} value={zone.shape.hz} onChange={(v) => setZone('Kích thước vùng', zone.id, (z) => { if (z.shape.kind === 'box') z.shape.hz = v; }, 'hz')} />
        <Slider label="Xoay" unit="°" min={0} max={179} value={deg(zone.shape.yaw)} onChange={(v) => setZone('Xoay vùng', zone.id, (z) => { if (z.shape.kind === 'box') z.shape.yaw = rad(v); }, 'yaw')} />
      </>}
      {zone.shape.kind === 'polygon' && <p className={s.note}>{zone.shape.points.length} đỉnh · kéo đỉnh trên bản đồ để sửa.</p>}
      <Slider label="Khoảng hoà trộn" unit=" m" min={0} max={600} value={zone.blend} onChange={(v) => setZone('Khoảng hoà trộn', zone.id, (z) => { z.blend = v; }, 'blend')} />
      <Slider label="Ưu tiên (chồng lên vùng thấp hơn)" min={-10} max={10} value={zone.priority} onChange={(v) => setZone('Ưu tiên vùng', zone.id, (z) => { z.priority = v; }, 'priority')} />
      <ParamsEditor params={zone.params} set={(p, key) => setZone('Thông số vùng', zone.id, (z) => { z.params = p; }, key)} />
      <div className={s.btnRow}>
        <Btn icon="copy" onClick={() => {
          const id = newId('env');
          set('Nhân bản vùng', (e) => {
            const c = structuredClone(zone); c.id = id; c.name = `${zone.name} (bản sao)`;
            const d = 40, sh = c.shape;
            if (sh.kind === 'polygon') sh.points = sh.points.map(([x, z]) => [x + d, z + d] as [number, number]); else { sh.x += d; sh.z += d; }
            e.zones.push(c);
          });
          api.setSelection({ kind: 'envZone', id });
        }}>Nhân bản</Btn>
        <Btn icon="trash-2" kind="danger" onClick={() => { api.setSelection(null); set('Xóa vùng', (e) => { e.zones = e.zones.filter((z) => z.id !== zone.id); }); }}>Xóa</Btn>
      </div>
    </Section>}

    <Section title="Thời tiết & bầu trời" icon="cloud-sun">
      <div className={s.field}><span className={s.fieldRow}>Thời tiết</span>
        <div className={s.grid3}>{WEATHER_IDS.map((w) => <button key={w} type="button" className={`${s.btn} ${env.weather === w ? s.primary : ''}`} onClick={() => set('Thời tiết', (e) => { e.weather = w as WeatherId; })} data-testid={`weather-${w}`}>{WEATHER[w].name}</button>)}</div></div>
      <Check label="Thời tiết tự chuyển dần (mọi người trong trận thấy như nhau)" value={env.dynamic} onChange={(v) => set('Thời tiết động', (e) => { e.dynamic = v; })} />
      <Check label="Giờ cố định" value={env.timeOfDay !== null} onChange={(v) => set('Giờ trong ngày', (e) => { e.timeOfDay = v ? .42 : null; })} />
      {env.timeOfDay !== null && <Slider label="Giờ" min={0} max={1} step={1 / 96} value={env.timeOfDay} onChange={(v) => set('Giờ trong ngày', (e) => { e.timeOfDay = v; }, 'tod')} format={clock} />}
      <Slider label="Hướng đường đi mặt trời" unit="°" min={-180} max={180} value={Math.round(env.sun.azimuth * 180 / Math.PI)} onChange={(v) => set('Hướng mặt trời', (e) => { e.sun.azimuth = rad(v); }, 'sun-az')} />
      <Slider label="Cường độ nắng" min={0} max={2} step={.05} value={env.sun.intensity} onChange={(v) => set('Cường độ nắng', (e) => { e.sun.intensity = v; }, 'sun-i')} format={(v) => `×${v.toFixed(2)}`} />
      <Check label="Độ phủ mây riêng (không theo thời tiết)" value={env.clouds.cover !== null} onChange={(v) => set('Mây', (e) => { e.clouds.cover = v ? WEATHER[e.weather].cloud : null; })} />
      {env.clouds.cover !== null && <Slider label="Độ phủ mây" min={0} max={1} step={.05} value={env.clouds.cover} onChange={(v) => set('Mây', (e) => { e.clouds.cover = v; }, 'cloud')} format={(v) => `${Math.round(v * 100)}%`} />}
      <Slider label="Mật độ sương / mù" min={0} max={3} step={.05} value={env.fog.density} onChange={(v) => set('Sương mù', (e) => { e.fog.density = v; }, 'fog')} format={(v) => `×${v.toFixed(2)}`} />
      <div className={s.field}><span className={s.fieldRow}>Pha màu sương
        <span><input type="checkbox" checked={env.fog.color !== null} onChange={(e) => set('Màu sương', (x) => { x.fog.color = e.target.checked ? '#a7adb0' : null; })} /> {env.fog.color && <input type="color" value={env.fog.color} onChange={(e) => set('Màu sương', (x) => { x.fog.color = e.target.value; }, 'fog-c')} />}</span></span></div>
      <Slider label="Hướng gió" unit="°" min={0} max={359} value={deg(env.wind.dir)} onChange={(v) => set('Hướng gió', (e) => { e.wind.dir = rad(v); }, 'wind-d')} />
      <Check label="Tốc độ gió riêng" value={env.wind.speed !== null} onChange={(v) => set('Gió', (e) => { e.wind.speed = v ? WEATHER[e.weather].wind : null; })} />
      {env.wind.speed !== null && <Slider label="Tốc độ gió" unit=" m/s" min={0} max={30} step={.5} value={env.wind.speed} onChange={(v) => set('Gió', (e) => { e.wind.speed = v; }, 'wind-s')} />}
    </Section>

    <Section title="Chỉnh màu toàn cảnh" icon="palette" collapsible>
      <Slider label="Độ bão hoà" min={.3} max={1.6} step={.02} value={env.grading.saturation} onChange={(v) => set('Chỉnh màu', (e) => { e.grading.saturation = v; }, 'sat')} format={(v) => `×${v.toFixed(2)}`} />
      <Slider label="Tương phản" min={.6} max={1.4} step={.02} value={env.grading.contrast} onChange={(v) => set('Chỉnh màu', (e) => { e.grading.contrast = v; }, 'con')} format={(v) => `×${v.toFixed(2)}`} />
      <Slider label="Ấm / lạnh" min={-1} max={1} step={.05} value={env.grading.warmth} onChange={(v) => set('Chỉnh màu', (e) => { e.grading.warmth = v; }, 'warm')} format={(v) => (v > 0 ? `ấm ${v.toFixed(2)}` : v < 0 ? `lạnh ${(-v).toFixed(2)}` : 'trung tính')} />
      <Slider label="Phơi sáng" min={.5} max={1.6} step={.02} value={env.grading.exposure} onChange={(v) => set('Chỉnh màu', (e) => { e.grading.exposure = v; }, 'exp')} format={(v) => `×${v.toFixed(2)}`} />
      <p className={s.note}>Độ bão hoà và tương phản dùng bộ hiệu ứng (Shader) của người chơi; phơi sáng và ấm/lạnh luôn có hiệu lực.</p>
      <div className={s.field}><span className={s.fieldRow}>Chất lượng hiệu ứng tối đa</span><Seg<EnvQuality> value={env.quality} options={ENV_QUALITY.map((id) => ({ id, name: QUALITY_NAMES[id] }))} onChange={(v) => set('Chất lượng hiệu ứng', (e) => { e.quality = v; })} /></div>
    </Section>

    <Section title="Khí hậu nền (ngoài các vùng)" icon="thermometer" collapsible initiallyOpen={false}>
      <div className={s.field}><span className={s.fieldRow}>Áp kiểu khí hậu</span>
        <div className={s.grid3}>{BIOME_IDS.map((b: BiomeId) => <button key={b} type="button" className={s.btn} onClick={() => set('Khí hậu nền', (e) => { e.base = { ...ENV_BIOMES[b].params }; })}>{ENV_BIOMES[b].name}</button>)}</div></div>
      <ParamsEditor params={env.base} set={(p, key) => set('Khí hậu nền', (e) => { e.base = p; }, `base-${key}`)} />
    </Section>

    <Section title="Vùng môi trường" icon="shapes">
      <p className={s.lead}>Vẽ vùng bằng công cụ bên trái: tròn, chữ nhật (nhấp để đặt) hoặc đa giác (nhấp từng đỉnh, Enter để khép). Viền nét đứt là nơi vùng hoà dần vào xung quanh.</p>
      {!env.zones.length && <p className={s.note}>Chưa có vùng nào.</p>}
      <div className={s.list}>{env.zones.map((z) => <button key={z.id} className={`${s.listItem} ${zone?.id === z.id ? s.on : ''}`} onClick={() => {
        api.setTool('select'); api.setSelection({ kind: 'envZone', id: z.id });
        const c = z.shape.kind === 'polygon' ? z.shape.points[0]! : [z.shape.x, z.shape.z] as const; api.centerOn(c[0], c[1]);
      }}><span>{z.name}</span><small>{ENV_BIOMES[z.biome].name} · {z.shape.kind === 'circle' ? 'tròn' : z.shape.kind === 'box' ? 'chữ nhật' : 'đa giác'}</small></button>)}</div>
    </Section>

    <Section title="Preset" icon="bookmark" collapsible>
      <div className={s.field}><span className={s.fieldRow}>Chiến trường có sẵn (giữ các vùng của bản đồ)</span>
        <div className={s.grid2}>{ENVIRONMENT_PRESETS.map((p) => <button key={p.id} type="button" className={s.btn} onClick={() => api.commit(`Preset: ${p.name}`, { ...api.doc, environment: applyEnvironmentPreset(env, p.id) })} data-testid={`env-preset-${p.id}`}>{p.name}</button>)}</div></div>
      <div className={s.field}><span className={s.fieldRow}>Preset đã lưu (dùng lại cho mọi bản đồ)</span>
        {!custom.length && <p className={s.note}>Chưa lưu preset nào.</p>}
        <div className={s.list}>{custom.map((p, i) => <div key={i} className={s.listItem}>
          <span>{p.name}</span>
          <button type="button" className={s.iconBtn} title="Áp dụng (giữ các vùng của bản đồ)" onClick={() => api.commit(`Preset: ${p.name}`, { ...api.doc, environment: { ...structuredClone(p.env), zones: env.zones } })}>Áp</button>
          <button type="button" className={s.iconBtn} title="Áp cả các vùng" onClick={() => api.commit(`Preset: ${p.name}`, { ...api.doc, environment: structuredClone(p.env) })}>+vùng</button>
          <button type="button" className={s.iconBtn} title="Xóa preset" onClick={() => { const next = custom.filter((_, k) => k !== i); setCustom(next); saveCustom(next); }}>✕</button>
        </div>)}</div>
      </div>
      <div className={s.btnRow}>
        <Btn icon="bookmark-plus" onClick={() => {
          const name = window.prompt('Tên preset', `${api.doc.meta.name} — ${WEATHER[env.weather].name}`)?.trim();
          if (!name) return;
          const next = [...custom.filter((p) => p.name !== name), { name, env: structuredClone(env) }]; setCustom(next); saveCustom(next);
          api.flash(`Đã lưu preset "${name}".`);
        }}>Lưu preset</Btn>
        <Btn icon="upload" onClick={importEnv}>Nhập</Btn>
        <Btn icon="download" onClick={exportEnv}>Xuất</Btn>
        <Btn icon="rotate-ccw" onClick={() => api.commit('Môi trường mặc định', { ...api.doc, environment: undefined })}>Mặc định</Btn>
      </div>
    </Section>

    <Section title="Gửi lên máy chủ" icon="rocket">
      <p className={s.lead}>Bản đồ đã xuất bản: gửi riêng môi trường, không dựng lại địa hình. Khi xuất bản bản đồ, môi trường cũng được gửi kèm.</p>
      <Btn icon="cloud-upload" kind="primary" disabled={busy} onClick={() => { if (hasStudioSession()) void send().catch(() => {}); else setAsking(true); }} testId="send-environment">{busy ? 'Đang gửi…' : 'Gửi môi trường lên máy chủ'}</Btn>
      {asking && <ConfirmDialog title="Đăng nhập Studio" message="Nhập mật khẩu Studio để gửi môi trường." password danger={false} confirmLabel="Gửi"
        onCancel={() => setAsking(false)} onConfirm={async (pw) => { await send(pw); setAsking(false); }} />}
    </Section>
  </>;
}
