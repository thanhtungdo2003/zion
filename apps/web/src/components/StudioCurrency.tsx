'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { STUDIO_MAX_COIN_GRANT, type StudioCurrencyGrant, type StudioCurrencyPlayer } from '@zion/shared';
import { studioCurrencyPlayers, studioGrantCurrency } from '@/lib/api';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

const number = (value: number) => value.toLocaleString('vi-VN');

export function StudioCurrency() {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const [players, setPlayers] = useState<StudioCurrencyPlayer[]>([]);
  const [selected, setSelected] = useState<StudioCurrencyPlayer | null>(null);
  const [amount, setAmount] = useState(''), [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const sending = useRef(false);
  const attempt = useRef<{ signature: string; grant: StudioCurrencyGrant } | null>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal(); else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void studioCurrencyPlayers(search.trim()).then((list) => {
        if (!active) return;
        setPlayers(list);
        setSelected((current) => current ? list.find((p) => p.id === current.id) ?? current : null);
      }).catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Không tải được danh sách người chơi.'); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [open, search, refresh]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!selected || sending.current || !Number.isInteger(value) || value < 1 || value > STUDIO_MAX_COIN_GRANT) return;
    const signature = JSON.stringify([selected.id, value, reason.trim()]);
    if (attempt.current?.signature !== signature) attempt.current = { signature, grant: { requestId: crypto.randomUUID(), accountId: selected.id, amount: value, reason: reason.trim() } };
    sending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await studioGrantCurrency(attempt.current.grant);
      setMessage(result.delivered ? `Đã cấp ${number(value)} ZCoin vào ví Sinh tồn của ${selected.username}.` : `Đã ghi nhận ${number(value)} ZCoin cho ${selected.username}. Tiền tự vào ví khi người chơi vào Sinh tồn hoặc giao dịch đang diễn ra hoàn tất.`);
      attempt.current = null;
      setAmount(''); setReason(''); setRefresh((v) => v + 1);
    } catch (err) { setError(err instanceof Error ? err.message : 'Chưa cấp được tiền. Bấm lại để thử cùng giao dịch.'); }
    finally { sending.current = false; setBusy(false); }
  };
  const close = () => { if (!sending.current) setOpen(false); };

  return <>
    <button className="btn" onClick={() => { setError(''); setMessage(''); setOpen(true); }}><Icon name="lucide:coins" /> Cấp tiền</button>
    <dialog ref={dialog} className="studio-currency" onCancel={(event) => { if (busy) event.preventDefault(); else close(); }} onClick={(event) => { if (event.target === dialog.current) close(); }} aria-labelledby="studio-currency-title">
      <header><div><span className="q-kicker">STUDIO // KINH TẾ SINH TỒN</span><h2 id="studio-currency-title">Cấp tiền cho người chơi</h2></div><button className="q-close" disabled={busy} onClick={close} aria-label="Đóng"><Icon name="lucide:x" /></button></header>
      <div className="studio-currency-body">
        <section className="studio-currency-players" aria-label="Chọn người chơi">
          <input className="studio-search" aria-label="Tìm người chơi" placeholder="Tìm theo tên hoặc ID…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="studio-currency-list" aria-busy={loading}>
            {loading ? <Spinner /> : players.filter((e) => e.online).map((player) => <button key={player.id} className={selected?.id === player.id ? 'selected' : ''} disabled={busy} onClick={() => setSelected(player)}>
              <span><b>{player.username}</b><small className={player.online ? 'online' : ''}>{player.online ? 'Đang chơi' : 'Ngoại tuyến'}</small></span>
              <small className="studio-currency-id">{player.id}</small>
              <span><strong>{number(player.coins)} ZCoin</strong>{player.pendingCoins > 0 && <small>+{number(player.pendingCoins)} chờ cấp</small>}</span>
            </button>)}
            {!loading && !players.length && <p>Không tìm thấy người chơi.</p>}
          </div>
          <div className="studio-currency-list" aria-busy={loading}>
            {loading ? <Spinner /> : players.filter((e) => !e.online).map((player) => <button key={player.id} className={selected?.id === player.id ? 'selected' : ''} disabled={busy} onClick={() => setSelected(player)}>
              <span><b>{player.username}</b><small className={player.online ? 'online' : ''}>{player.online ? 'Đang chơi' : 'Ngoại tuyến'}</small></span>
              <small className="studio-currency-id">{player.id}</small>
              <span><strong>{number(player.coins)} ZCoin</strong>{player.pendingCoins > 0 && <small>+{number(player.pendingCoins)} chờ cấp</small>}</span>
            </button>)}
            {!loading && !players.length && <p>Không tìm thấy người chơi.</p>}
          </div>
        </section>
        <form className="studio-currency-form" onSubmit={(event) => void submit(event)}>
          <span className="q-kicker">NGƯỜI NHẬN</span><h3>{selected?.username ?? 'Chọn người chơi bên trái'}</h3>
          {selected && <small className="studio-currency-id">{selected.id}</small>}
          <label>Số tiền ZCoin<input type="number" inputMode="numeric" required min={1} max={STUDIO_MAX_COIN_GRANT} step={1} placeholder="Nhập số tiền" value={amount} disabled={busy || !selected} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>Ghi chú <small>(không bắt buộc)</small><textarea maxLength={200} rows={3} placeholder="Ví dụ: thưởng sự kiện" value={reason} disabled={busy || !selected} onChange={(event) => setReason(event.target.value)} /></label>
          <p>Tiền cộng vào ví Sinh tồn. Người ngoại tuyến tự nhận ở lần vào game tiếp theo.</p>
          <button className="btn btn-primary" disabled={busy || !selected || !amount}>{busy ? <Spinner /> : <><Icon name="lucide:coins" /> Cấp ZCoin</>}</button>
          <button className="btn" type="button" disabled={busy || loading} onClick={() => { setError(''); setRefresh((v) => v + 1); }}><Icon name="lucide:refresh-cw" /> Cập nhật số dư</button>
        </form>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="career-note" role="status">{message}</p>}
    </dialog>
  </>;
}
