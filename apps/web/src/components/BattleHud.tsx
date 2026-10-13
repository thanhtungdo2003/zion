'use client';
import type { BattleState } from '@zion/shared';

export function BattleHud({ state, position, onLeave }: { state: BattleState; position: readonly number[]; onLeave(): void }) {
  const outside = Math.hypot(position[0]! - state.circle.x, position[2]! - state.circle.z) >= state.circle.radius;
  const seconds = Math.ceil(state.remainingMs / 1000);
  return <>
    {state.phase === 'running' && !state.placement && state.drop && state.drop.phase !== 'landed' && <div className="battle-drop" role="status">
      <b>{state.drop.phase === 'boarding' ? 'TRÊN MÁY BAY VẬN TẢI' : state.drop.phase === 'falling' ? 'ĐANG RƠI TỰ DO' : 'ĐANG HẠ CÁNH BẰNG DÙ'}</b>
      <strong>{Math.round(state.drop.altitude)} m</strong>
      <small>ĐỘ CAO SO VỚI MẶT ĐẤT · {Math.round(state.drop.speed ?? 0)} km/h · Hướng {Math.round(state.drop.heading ?? 0)}°</small>
      <progress max={650} value={Math.min(650, state.drop.altitude)} aria-label="Độ cao còn lại" />
      <span>{state.drop.phase === 'boarding' ? <><kbd>Space</kbd> · Nhảy khỏi máy bay · Tự nhảy sau {Math.ceil((state.plane?.remainingMs ?? 0) / 1000)}s</> : state.drop.phase === 'falling' ? <>WASD · Lướt khi rơi<br/><kbd>Shift</kbd> · Lao nhanh xuống · <kbd>Space</kbd> · Bung dù<br/>Dù tự bung ở độ cao 120 m</> : <>WASD · Điều khiển dù lượn · Tự thu dù khi chạm đất</>}</span>
    </div>}
    <div className="battle-status" role="status">
      <b>BATTLE ROYALE · {state.map}</b>
      <span>{state.phase === 'waiting' ? `Đang chờ người chơi · ${state.total}/32 · cần ít nhất 2 người` : state.phase === 'countdown' ? `Bắt đầu sau ${seconds}s · Tìm vị trí xuất phát` : `${state.alive} sống sót / ${state.total} · Bo ${state.stage}`}</span>
      {state.phase === 'running' && <span>{state.shrinking ? 'Bo đỏ đang thu hẹp' : 'Bo đỏ thu hẹp sau'} · {seconds}s</span>}
      {(state.phase === 'waiting' || state.phase === 'countdown') && <small>Bắt đầu tay không · Nhặt súng và giáp khi trận bắt đầu · Không hồi sinh</small>}
      {state.phase === 'running' && outside && !state.placement && <strong className="battle-warning">NGOÀI BO ĐỎ · Mất {state.damagePerSecond} máu/giây</strong>}
      {state.placement && state.phase !== 'finished' && <span>Bạn đã bị loại · Hạng #{state.placement}</span>}
    </div>
    {state.phase === 'finished' && <div className="overlay battle-result"><div className="overlay-card">
      <h2>{state.placement === 1 ? 'CHIẾN THẮNG!' : 'TRẬN ĐÃ KẾT THÚC'}</h2>
      <p>{state.winner ? `${state.winner.name} là người sống sót cuối cùng.` : 'Không còn người sống sót.'}</p>
      {state.placement && <p>Thứ hạng của bạn: #{state.placement} / {state.total}</p>}
      <button className="btn btn-primary" onClick={onLeave}>Về sảnh</button>
      <small>Tự đóng trận sau {seconds}s</small>
    </div></div>}
  </>;
}
