'use client';

import { useState } from 'react';
import type { WarfareLayout, WarfarePointKind, WarfareSide } from '@zion/shared';
import { hasStudioSession, publishedMapId, studioLogin, studioSetBattleMapWarfare } from '@/lib/api';
import { ConfirmDialog } from '../ConfirmDialog';
import { WarfareStudioPanel, type WarfareSel } from '../WarfareStudioPanel';
import type { EditorApi } from './editor-api';
import { Btn, Section } from './ui';
import s from './world-studio.module.css';

/**
 * The Chiến trường tab: where on this world the battle is fought (an area up to 800 m across),
 * its zones, bases, deploy and tactical points, vehicle spawns and rules — and the switch that
 * offers this map for Warfare on the server (the map must be published first; the battlefield is
 * sent on its own, without republishing the terrain).
 */
export function WarfarePanel({ api, pointKind, setPointKind, vehicleSide, setVehicleSide }: { api: EditorApi; pointKind: WarfarePointKind; setPointKind: (k: WarfarePointKind) => void; vehicleSide: WarfareSide; setVehicleSide: (s: WarfareSide) => void }) {
  const { doc } = api;
  const size = doc.terrain.size;
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false);
  const sel = api.selection && (api.selection.kind === 'wfZone' || api.selection.kind === 'wfBase' || api.selection.kind === 'wfVehicle') ? api.selection as WarfareSel : null;
  const patchLayout = (fn: (l: WarfareLayout) => void) => {
    const next: WarfareLayout = structuredClone(api.doc.warfare ?? { enabled: false, zones: [], vehicleSpawns: [] });
    fn(next);
    api.commit('Chiến trường', { ...api.doc, warfare: next }, { key: 'warfare' });
  };
  const send = async (password?: string) => {
    setBusy(true);
    try {
      if (password) await studioLogin(password);
      const layout = api.doc.warfare;
      await studioSetBattleMapWarfare(publishedMapId(doc.meta.id), layout ?? null);
      api.flash(layout?.enabled ? 'Đã gán Chiến trường cho bản đồ trên máy chủ — người chơi chọn được trong chế độ Chiến trường.' : 'Đã tắt Chiến trường cho bản đồ này trên máy chủ.');
    } catch (err) { api.flash(`Không gán được: ${err instanceof Error ? err.message : String(err)}`, true); throw err; }
    finally { setBusy(false); }
  };
  const tool = api.tool.startsWith('wf-') && api.tool !== 'wf-area' ? api.tool.slice(3) as 'zone' : null;
  return <>
    <Section title="Chiến trường (Warfare)" icon="swords">
      <p className={s.lead}>Chọn một vùng của bản đồ làm chiến trường (tối đa 800 × 800 m), đặt cứ điểm, căn cứ hai phe, điểm triển khai và điểm xuất hiện xe (jeep, quad). Công cụ ở thanh bên trái.</p>
      <WarfareStudioPanel layout={doc.warfare} half={400} patchLayout={patchLayout} sel={sel} setSel={api.setSelection} tool={tool}
        pointKind={pointKind} setPointKind={setPointKind} vehicleSide={vehicleSide} setVehicleSide={setVehicleSide}
        defaultArea={{ x: Math.round(size / 2), z: Math.round(size / 2), half: Math.min(250, Math.round(size / 2) - 10) }}>
        {doc.warfare?.area && <p className={s.note}>Tâm vùng: X {Math.round(doc.warfare.area.x)} · Z {Math.round(doc.warfare.area.z)} · rộng {doc.warfare.area.half * 2} m <button type="button" className={s.btn} onClick={() => api.centerOn(doc.warfare!.area!.x, doc.warfare!.area!.z, doc.warfare!.area!.half * 2.4)}>Xem</button></p>}
      </WarfareStudioPanel>
    </Section>
    <Section title="Gán cho chế độ Chiến trường" icon="rocket">
      <p className={s.lead}>Bản đồ phải được xuất bản lên máy chủ trước (Thiết lập › Xuất bản). Nút dưới gửi riêng chiến trường, không dựng lại địa hình; trận mới mở sau đó dùng bố cục mới. Xuất bản lại bản đồ cũng gửi kèm chiến trường.</p>
      <Btn icon="swords" kind="primary" disabled={busy} onClick={() => { if (hasStudioSession()) void send().catch(() => {}); else setAsking(true); }} testId="assign-warfare">
        {busy ? 'Đang gửi…' : doc.warfare?.enabled ? 'Gán / cập nhật Chiến trường trên máy chủ' : 'Tắt Chiến trường trên máy chủ'}
      </Btn>
      {asking && <ConfirmDialog title="Đăng nhập Studio" message="Nhập mật khẩu Studio để gán chế độ Chiến trường." password danger={false} confirmLabel="Gán"
        onCancel={() => setAsking(false)} onConfirm={async (pw) => { await send(pw); setAsking(false); }} />}
    </Section>
  </>;
}
