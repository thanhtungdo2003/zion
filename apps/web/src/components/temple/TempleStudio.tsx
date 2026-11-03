'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { GRAPHICS_PRESETS, type GraphicsPreset } from '@/lib/settings';
import { hasStudioSession, studioLogin } from '@/lib/api';
import { templeConnect, templeDisconnect, templeSaveGraphics, templeStream, templeTest } from '@/lib/temple-api';
import type { TempleGraphics, TempleStatus } from '@/game/temple/scene';
import { Icon } from '../Icon';
import { TempleView } from './TempleView';

/**
 * Chánh Điện (/studio/temple): connect the hall to a TikTok LIVE by username, try it with test
 * events, and set its graphics (the game's own presets, shadows, shader pack, exposure) for every
 * screen showing it. The game screen itself is /chanh-dien (full window, works on a phone).
 */
const PRESET_NAMES: Record<GraphicsPreset, string> = { low: 'Thấp', medium: 'Vừa', high: 'Cao' };
const STATE_TEXT: Record<TempleStatus['state'], string> = { idle: 'Chưa kết nối', connecting: 'Đang kết nối…', connected: 'Đã kết nối', error: 'Lỗi' };

export function TempleStudioPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<TempleStatus | null>(null);
  const [graphics, setGraphics] = useState<TempleGraphics | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const save = useRef(0);

  useEffect(() => {
    setUnlocked(hasStudioSession());
    try { setUsername(localStorage.getItem('zion.temple.username') ?? ''); } catch { /* storage blocked */ }
    // The panel follows the server: status changes and graphics saved from another tab.
    return templeStream((m) => {
      if (m.type === 'status') setStatus(m.status);
      else if (m.type === 'graphics') setGraphics((g) => g ?? m.graphics);
    });
  }, []);

  const run = async (fn: () => Promise<unknown>, ok = '') => {
    setBusy(true); setMessage('');
    try { await fn(); if (ok) setMessage(ok); } catch (e) { setMessage(e instanceof Error ? e.message : 'Không thực hiện được.'); } finally { setBusy(false); }
  };
  const unlock = () => run(async () => { await studioLogin(password); setUnlocked(true); setPassword(''); });
  const connect = () => run(async () => {
    try { localStorage.setItem('zion.temple.username', username); } catch { /* storage blocked */ }
    const r = await templeConnect(username); setStatus(r.status);
  });
  // Graphics: the preview changes at once, the server copy (every screen) shortly after.
  const edit = (patch: Partial<TempleGraphics>) => {
    setGraphics((g) => {
      const next = { ...(g ?? { renderScale: .8, shadows: 'low', shaders: false, brightness: 1.1, maxPeople: 24 }), ...patch } as TempleGraphics;
      clearTimeout(save.current);
      save.current = window.setTimeout(() => void templeSaveGraphics(next).catch(() => setMessage('Chưa lưu được đồ hoạ (cần mở khoá xưởng).')), 400);
      return next;
    });
  };
  const preset = graphics ? (Object.keys(GRAPHICS_PRESETS) as GraphicsPreset[]).find((k) => GRAPHICS_PRESETS[k].renderScale === graphics.renderScale && GRAPHICS_PRESETS[k].shadows === graphics.shadows) : undefined;
  const state = status?.state ?? 'idle';

  return (
    <div className="gs-page tp-studio">
      <header className="gs-bar">
        <Link href="/studio" className="studio-back" aria-label="Về xưởng"><Icon name="lucide:arrow-left" /></Link>
        <h1>Chánh Điện</h1>
        <span className={`tp-pill ${state === 'connected' ? 'on' : state === 'error' ? 'err' : state === 'connecting' ? 'wait' : ''}`}>
          <Icon name="lucide:radio" /> {STATE_TEXT[state]}{status?.username ? ` · @${status.username}` : ''}{status?.viewers != null ? ` · ${status.viewers} người xem` : ''}
        </span>
        <span className="gs-status">{message}</span>
        <Link href="/chanh-dien" target="_blank" className="btn"><Icon name="lucide:external-link" /> Mở màn hình game</Link>
      </header>

      <aside className="gs-panel">
        {!unlocked && (
          <>
            <h3>Mở khoá xưởng</h3>
            <label className="tp-field">Mật khẩu xưởng<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void unlock(); }} /></label>
            <button className="btn btn-primary" disabled={busy || !password} onClick={() => void unlock()}>Mở khoá</button>
          </>
        )}
        <h3>TikTok LIVE</h3>
        <label className="tp-field">Tên tài khoản (username)
          <input type="text" placeholder="@tenkenh" value={username} onChange={(e) => setUsername(e.target.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter' && username) void connect(); }} />
        </label>
        <div className="tp-row">
          <button className="btn btn-primary" disabled={busy || !unlocked || !username} onClick={() => void connect()}><Icon name="lucide:plug" /> Kết nối</button>
          <button className="btn" disabled={busy || !unlocked || state === 'idle'} onClick={() => void run(templeDisconnect)}><Icon name="lucide:unplug" /> Ngắt</button>
        </div>
        {status?.error && <p className="tp-note">{status.error}</p>}
        <p className="tp-note">Tài khoản phải đang LIVE. Máy chủ giữ kết nối, nên màn hình game và bản xem trước nhận cùng sự kiện.</p>

        <h3>Thử (không cần LIVE)</h3>
        <div className="tp-row">
          <button className="btn" disabled={!unlocked} onClick={() => void run(() => templeTest('like', { likes: 10 }))}>❤ 10 tim</button>
          <button className="btn" disabled={!unlocked} onClick={() => void run(() => templeTest('like', { likes: 50 }))}>❤ 50 tim</button>
          <button className="btn" disabled={!unlocked} onClick={() => void run(() => templeTest('follow'))}>Theo dõi</button>
          <button className="btn" disabled={!unlocked} onClick={() => void run(() => templeTest('share'))}>Chia sẻ</button>
          <button className="btn" disabled={!unlocked} onClick={() => void run(() => templeTest('chat', { name: 'Khách 1', comment: 'Chào cả nhà, chúc mọi người bình an!' }))}>Bình luận</button>
        </div>
        <p className="tp-note">Mỗi 10 tim: dâng một đèn sen. Từ 50 tim, theo dõi hoặc chia sẻ: dâng lễ lớn, camera xuống sát sau lưng người đó rồi trở lại góc trên trần. Quà tặng không tạo lễ và không xếp hạng.</p>
      </aside>

      <div className="tp-preview"><TempleView graphics={graphics} /></div>

      <aside className="gs-panel">
        <h3>Đồ hoạ</h3>
        {!graphics ? <p className="tp-note">Đang tải…</p> : (
          <>
            <div className="tp-row">
              {(Object.keys(GRAPHICS_PRESETS) as GraphicsPreset[]).map((k) => (
                <button key={k} className={`btn ${preset === k ? 'btn-primary' : ''}`} onClick={() => edit({ renderScale: GRAPHICS_PRESETS[k].renderScale, shadows: GRAPHICS_PRESETS[k].shadows })}>{PRESET_NAMES[k]}</button>
              ))}
            </div>
            <label className="tp-field">Độ phân giải: {Math.round(graphics.renderScale * 100)}%
              <input type="range" min={.4} max={1.5} step={.05} value={graphics.renderScale} onChange={(e) => edit({ renderScale: Number(e.target.value) })} />
            </label>
            <label className="tp-field">Bóng đổ
              <select value={graphics.shadows} onChange={(e) => edit({ shadows: e.target.value as TempleGraphics['shadows'] })}>
                <option value="off">Tắt</option><option value="low">Thấp</option><option value="high">Cao (mềm)</option>
              </select>
            </label>
            <label className="tp-field tp-row"><input type="checkbox" checked={graphics.shaders} onChange={(e) => edit({ shaders: e.target.checked })} /> Gói shader (AO, bloom, chỉnh màu như trong game)</label>
            <label className="tp-field">Độ sáng: {graphics.brightness.toFixed(2)}
              <input type="range" min={.5} max={2} step={.05} value={graphics.brightness} onChange={(e) => edit({ brightness: Number(e.target.value) })} />
            </label>
            <label className="tp-field">Số người tối đa trong điện: {graphics.maxPeople}
              <input type="range" min={4} max={42} step={1} value={graphics.maxPeople} onChange={(e) => edit({ maxPeople: Number(e.target.value) })} />
            </label>
            <p className="tp-note">Áp dụng cho mọi màn hình đang mở Chánh Điện. Máy yếu hoặc điện thoại: chọn Thấp, tắt gói shader, 12–20 người.</p>
            <p className="tp-note">Tượng: đặt file <code>apps/web/public/models/temple/buddha.glb</code> để thay tượng tạm (tự canh cao 3 m).</p>
          </>
        )}
      </aside>
    </div>
  );
}
