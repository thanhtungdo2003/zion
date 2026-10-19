'use client';
import type { ReactNode } from 'react';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RANKS, rankTitle, type CareerView, type RequisitionEntry } from '@zion/shared';
import { deployRequisition, getCareer } from '@/lib/api';
import { BadgeModel } from './BadgeModel';
import { RankBadge } from './RankBadge';
import { Icon } from './Icon';
import { CareerReward } from './CareerReward';
import { itemIconVersion, subscribeItemIcons } from '@/game/inventory/icons';

const serverIconVersion = () => 0;

export function CareerPanel({ session, children }: { session: boolean; children?: ReactNode }) {
  useSyncExternalStore(subscribeItemIcons, itemIconVersion, serverIconVersion);
  const [career, setCareer] = useState<CareerView | null>(null);
  const [tab, setTab] = useState<'ranks' | 'armory' | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ entry: RequisitionEntry; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!session) { setCareer(null); return; }
    let active = true;
    void getCareer().then((view) => { if (active) setCareer(view); }).catch(() => { if (active) setMessage('Không tải được hồ sơ quân vụ. Mở lại để thử.'); });
    return () => { active = false; };
  }, [session]);
  useEffect(() => {
    if (!tab) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    if (session) void getCareer().then(setCareer).catch(() => setMessage('Chưa kết nối được hồ sơ quân vụ.'));
  }, [tab, session]);
  const rank = career?.rank ?? rankTitle(0), def = RANKS[rank.tier]!;
  const shown = selected ?? rank.step;
  const transfer = async (entry: RequisitionEntry) => {
    if (busy) return;
    setBusy(true); setMenu(null); setMessage('');
    try { setCareer(await deployRequisition(entry.key)); setMessage('Đã chuyển. Vật phẩm sẽ được cấp vào kho cá nhân tại căn cứ khi bạn vào Sinh tồn.'); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Chuyển thất bại.'); }
    finally { setBusy(false); }
  };
  const close = () => { setTab(null); setMenu(null); setSelected(null); };
  return <>
    <div className="menu-career">
      {/* Above the supplies and titles: the world chat. */}
      {children}
      <button className="menu-rank" onClick={() => { setMessage(''); setTab('ranks'); }} aria-label={`Quân hàm: ${rank.title}`}>
        <BadgeModel url={def.model} /><small>QUÂN HÀM</small><b>{rank.title}</b><span>{'★'.repeat(rank.stars)}</span>
      </button>
      <button className="menu-requisitions" onClick={() => { setMessage(''); setTab('armory'); }}><Icon name="lucide:package-open" /><span>QUÂN NHU</span>{!!career?.armory.length && <em>{career.armory.length}</em>}</button>
    </div>
    <dialog ref={dialog} className="career-dialog" onCancel={close} onClick={(e) => { if (e.target === dialog.current) close(); }}>
      <div className="career-shell" onClick={() => setMenu(null)}>
        <header><div><span className="q-kicker">ZION // HỒ SƠ QUÂN VỤ</span><h2>{tab === 'armory' ? 'Quân nhu' : 'Danh hiệu của bạn'}</h2></div><button className="q-close" onClick={close} aria-label="Đóng"><Icon name="lucide:x" /></button></header>
        <nav><button className={tab === 'ranks' ? 'on' : ''} onClick={() => setTab('ranks')}>Quân hàm</button><button className={tab === 'armory' ? 'on' : ''} onClick={() => setTab('armory')}>Quân nhu</button></nav>
        {!session ? <p className="career-empty">Hãy tạo nhân vật hoặc đăng nhập để lưu danh hiệu và nhận quân nhu.</p> : tab === 'ranks' ? <div className="career-ranks">
          <aside><BadgeModel url={RANKS[Math.floor(shown / 5)]!.model} animated /><RankBadge rank={rankTitle(shown)} title /><p>Hoàn thành nhiệm vụ để được ghi nhận. Hy sinh sẽ ảnh hưởng đến quân hàm.</p><small>Danh hiệu hiện tại: {rank.title}</small></aside>
          <div className="rank-timeline">{career?.milestones.map((m) => <button key={m.rank.step} className={`${m.awarded ? 'awarded' : ''} ${m.rank.step === rank.step ? 'current' : ''} ${m.rank.step === shown ? 'selected' : ''}`} onClick={() => setSelected(m.rank.step)}>
            <RankBadge rank={m.rank} /><div className="rank-milestone"><span className="rank-milestone-heading"><b>{m.rank.title}</b><small>{m.awarded ? 'Đã cấp' : 'Chưa đạt'}</small></span>{m.rewards.length ? <span className="rank-rewards">{m.rewards.map((reward, i) => <CareerReward key={`${reward.kind}:${reward.id}:${i}`} reward={reward} />)}</span> : <small>Khởi đầu hành trình</small>}</div>
          </button>)}</div>
        </div> : <div className="career-stock">
          <p>Phần quà của tài khoản dùng chung cho các chế độ. Chọn vật phẩm hoặc nhấn chuột phải để đưa vào Sinh tồn.</p>
          {!!career?.pendingSurvival && <p className="career-note">{career.pendingSurvival} kiện đang chờ cấp vào Sinh tồn. Nếu kho căn cứ đầy, kiện vẫn được giữ để cấp ở lần vào tiếp theo.</p>}
          <div className="requisition-grid">{career?.armory.map((entry) => <button key={entry.key} disabled={busy} onClick={(e) => { e.stopPropagation(); setMenu({ entry, x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 130) }); }} onContextMenu={(e) => { e.preventDefault(); setMenu({ entry, x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 130) }); }}>
            <CareerReward reward={entry} /><small>{entry.source}</small>
          </button>)}</div>
          {!career?.armory.length && <p className="career-empty">Quân nhu đang trống. Phần thưởng thăng quân hàm sẽ được gửi về đây.</p>}
        </div>}
        {message && <p className="career-note" role="status">{message}</p>}
      </div>
      {menu && <div className="requisition-menu" style={{ left: menu.x, top: menu.y }}><b>{menu.entry.name}</b><button disabled={busy || menu.entry.mode !== 'survival' || !['coins', 'item'].includes(menu.entry.kind)} onClick={() => void transfer(menu.entry)}>Đưa vào Sinh tồn</button>{!['coins', 'item'].includes(menu.entry.kind) && <small>Nội dung dành cho bản cập nhật sau</small>}<button onClick={() => setMenu(null)}>Đóng</button></div>}
    </dialog>
  </>;
}
