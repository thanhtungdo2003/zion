'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_RANK_CONFIG, ITEMS, rankConfigSchema, rankTitle, requisitionRewardSchema, type RankConfig, type RequisitionReward } from '@zion/shared';
import { studioRanks, studioSaveRanks } from '@/lib/api';

export function RankEditor() {
  const [config, setConfig] = useState<RankConfig | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  useEffect(() => { let active = true; void studioRanks().then((c) => { if (active) setConfig(c); }).catch((e) => { if (active) setError(String(e)); }); return () => { active = false; }; }, []);
  const update = (patch: Partial<RankConfig>) => { if (config) setConfig({ ...config, ...patch }); setError(''); };
  const reward = (index: number, patch: Partial<RequisitionReward>) => {
    if (!config) return;
    update({ rewards: config.rewards.map((list, n) => n === step ? list.map((r, i) => i === index ? { ...r, ...patch } : r) : list) });
  };
  const save = async () => {
    const parsed = rankConfigSchema.safeParse(config);
    if (!parsed.success) { setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')); return; }
    setBusy(true);
    try { setConfig(await studioSaveRanks(parsed.data)); setError('Đã lưu cấu hình quân hàm toàn hệ thống.'); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <section className="rank-editor">
    <p>Áp dụng cho toàn bộ tài khoản và chế độ. Người chơi chỉ nhận danh hiệu; điểm và ngưỡng dưới đây chỉ dành cho Studio. Quà của mỗi mốc chỉ cấp một lần.</p>
    {!config ? <p>Đang tải cấu hình…</p> : <>
      <div className="rank-editor-controls">{([['dailyPoints', 'Nhiệm vụ hằng ngày'], ['longPoints', 'Nhiệm vụ dài hạn'], ['externalBonus', 'Thưởng nhiệm vụ bên ngoài'], ['teamPoints', 'Nhiệm vụ đội'], ['deathBase', 'Trừ điểm khi chết'], ['deathPerStep', 'Trừ thêm mỗi bậc sao']] as const).map(([key, title]) => <label key={key}>{title}<input type="number" min="0" value={config[key]} onChange={(e) => update({ [key]: Number(e.target.value) })} /></label>)}</div>
      <div className="rank-editor-grid"><div>{config.thresholds.map((points, n) => <label className={step === n ? 'selected' : ''} key={n}><button onClick={() => setStep(n)}>{rankTitle(n).title}</button><input aria-label={`Ngưỡng ${rankTitle(n).title}`} type="number" min="0" value={points} onChange={(e) => update({ thresholds: config.thresholds.map((x, i) => i === n ? Number(e.target.value) : x) })} /></label>)}</div>
      <div><h3>Quà {rankTitle(step).title}</h3>{config.rewards[step]!.map((r, i) => <div className="rank-editor-reward" key={i}>
        <label>Loại<select value={r.kind} onChange={(e) => { const kind = e.target.value as RequisitionReward['kind']; reward(i, kind === 'coins' ? { kind, id: 'zcoin', name: 'ZCoin', mode: 'survival' } : kind === 'item' ? { kind, id: 'medkit', name: ITEMS.medkit!.name, mode: 'survival' } : { kind, id: 'future_reward', name: 'Nội dung tương lai', mode: 'future' }); }}>{requisitionRewardSchema.innerType().shape.kind.options.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        {r.kind === 'item' ? <label>Vật phẩm<select value={r.id} onChange={(e) => reward(i, { id: e.target.value, name: ITEMS[e.target.value]!.name })}>{Object.values(ITEMS).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label> : <label>Mã<input value={r.id} onChange={(e) => reward(i, { id: e.target.value })} /></label>}
        <label>Tên<input value={r.name} onChange={(e) => reward(i, { name: e.target.value })} /></label><label>Số lượng<input type="number" min="1" value={r.quantity} onChange={(e) => reward(i, { quantity: Number(e.target.value) })} /></label>
        <label>Chế độ<select value={r.mode} onChange={(e) => reward(i, { mode: e.target.value as RequisitionReward['mode'] })}><option value="survival">Sinh tồn</option><option value="global">Toàn hệ thống</option><option value="future">Cập nhật tương lai</option></select></label>
        <button className="btn" onClick={() => update({ rewards: config.rewards.map((list, n) => n === step ? list.filter((_, x) => x !== i) : list) })}>Xóa</button>
      </div>)}<button className="btn" onClick={() => update({ rewards: config.rewards.map((list, n) => n === step ? [...list, { kind: 'coins', id: 'zcoin', name: 'ZCoin', mode: 'survival', quantity: 100 }] : list) })}>Thêm quà</button></div></div>
      <div className="overlay-row"><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Lưu quân hàm & phần thưởng</button><button className="btn" onClick={() => { if (confirm('Khôi phục cấu hình mặc định trong bản nháp?')) setConfig(structuredClone(DEFAULT_RANK_CONFIG)); }}>Bản nháp mặc định</button></div>
    </>}{error && <p style={{ whiteSpace: 'pre-wrap' }} role="status">{error}</p>}
  </section>;
}
