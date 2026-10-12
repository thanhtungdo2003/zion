'use client';
import { useEffect, useState } from 'react';
import { studioPlayers, studioResetProgress, type PlayerProgress as Progress } from '@/lib/api';
import { Icon } from './Icon';

export function PlayerProgress() {
  const [players, setPlayers] = useState<Progress[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => { try { setPlayers(await studioPlayers()); } catch (e) { setError(String(e)); } };
  useEffect(() => { void refresh(); }, []);
  const reset = async (player?: Progress) => {
    if (!confirm(player ? `Đặt lại toàn bộ nhiệm vụ của ${player.username}?` : 'Đặt lại toàn bộ nhiệm vụ của TẤT CẢ người chơi trong thế giới này?')) return;
    setBusy(true); setError('');
    try { await studioResetProgress(player?.id); await refresh(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <div style={{ overflow: 'auto', flex: 1 }}>
    <h3><Icon name="lucide:users" /> Tiến trình người chơi</h3>
    <p>Đặt lại nhiệm vụ đưa nhật ký về trạng thái chưa nhận. ZCoin và vật phẩm đã nhận không bị thu hồi.</p>
    <input placeholder="Tìm tên người chơi" value={search} onChange={(e) => setSearch(e.target.value)} />
    <button className="btn" disabled={busy} onClick={() => void refresh()}>Làm mới</button>
    <button className="btn" disabled={busy} onClick={() => void reset()}>Đặt lại tất cả người chơi</button>
    {error && <p role="alert">{error}</p>}
    <table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>Người chơi</th><th>Nhiệm vụ / trạng thái / bước / tiến độ</th><th>Thao tác</th></tr></thead><tbody>
      {players.filter((p) => p.username.toLowerCase().includes(search.toLowerCase())).map((p) => <tr key={p.id}>
        <td>{p.username}</td><td>{Object.entries(p.journal).map(([id, q]) => <div key={id}>{id}: {{ active: 'Đang làm', ready: 'Chờ nhận thưởng', available: 'Có thể nhận', cancelled: 'Đã hủy', claimed: 'Đã nhận thưởng' }[q.status] ?? q.status} · bước {q.stage + 1} · {q.progress}</div>)}{!Object.keys(p.journal).length && 'Chưa nhận nhiệm vụ'}</td>
        <td><button className="btn" disabled={busy} onClick={() => void reset(p)}>Đặt lại nhiệm vụ</button></td>
      </tr>)}
    </tbody></table>
  </div>;
}
