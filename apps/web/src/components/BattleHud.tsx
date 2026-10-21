'use client';
import { BATTLE_FLIGHT, BATTLE_MAP, type BattleState } from '@zion/shared';
import type { HudState } from '@/game/hud-store';
import { BattleResults } from './BattleResults';

export function BattleHud({ hud, state, position, onLeave }: { hud: HudState; state: BattleState; position: readonly number[]; onLeave(): void }) {
  const outside = Math.hypot(position[0]! - state.circle.x, position[2]! - state.circle.z) >= state.circle.radius;
  const seconds = Math.ceil(state.remainingMs / 1000);
  return <>
    {state.phase === 'running' && !state.placement && state.drop && state.drop.phase !== 'landed' && <DropHud state={state} drop={state.drop} />}
    <div className="battle-zone-info" role="status">
      {state.phase === 'waiting' && <><b>Chờ người chơi</b><span>{state.total}/{BATTLE_MAP.maxPlayers} · cần {BATTLE_MAP.minPlayers} người{state.remainingMs > 0 ? ` · tự bắt đầu sau ${Math.ceil(state.remainingMs / 1000)}s` : ''}</span></>}
      {state.phase === 'countdown' && <><b>Bắt đầu sau</b><span>{seconds}s · {state.total} người</span></>}
      {(state.phase === 'waiting' || state.phase === 'countdown') && !!state.lobbyNames?.length && <ul className="battle-lobby-names" aria-label="Người trong sảnh chờ">
        {state.lobbyNames.map((name, i) => <li key={`${name}-${i}`}>{name}</li>)}
      </ul>}
      {state.phase === 'running' && <>
        <div><span>Còn sống</span><b>{state.alive}/{state.total}</b></div>
        <div><span>Bo {state.stage}</span><b className={state.shrinking ? 'shrinking' : undefined}>{state.shrinking ? 'Đang thu' : 'Thu sau'} {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</b></div>
        {outside && !state.placement && <strong>Ngoài bo · −{state.damagePerSecond} máu/s</strong>}
        {state.placement && state.phase === 'running' && <span>Đã bị loại · #{state.placement}</span>}
      </>}
    </div>
    {state.phase === 'finished' && <BattleResults hud={hud} onLeave={onLeave} />}
  </>;
}

/** Altitude marks on the vertical gauge (metres above ground). */
const ALTITUDE_MARKS = [600, 500, 400, 300, 200, BATTLE_FLIGHT.autoDeployHeight, 0];

/** Insertion HUD: a slim vertical altimeter on the right edge and one compact control strip at the bottom. */
function DropHud({ state, drop }: { state: BattleState; drop: NonNullable<BattleState['drop']> }) {
  const top = BATTLE_FLIGHT.altitude, altitude = Math.max(0, Math.min(top, drop.altitude)), level = altitude / top;
  const label = drop.phase === 'boarding' ? 'Trên máy bay' : drop.phase === 'falling' ? 'Rơi tự do' : 'Đang bung dù';
  return <>
    <div className={`battle-altimeter ${drop.phase}`} role="status" aria-label={`Độ cao ${Math.round(altitude)} mét`}>
      <span className="battle-altimeter-title">Độ cao</span>
      <div className="battle-altimeter-scale">
        <div className="battle-altimeter-track">
          <div className="battle-altimeter-fill" style={{ height: `${level * 100}%` }} />
          {ALTITUDE_MARKS.map(mark => <i key={mark} className={mark === BATTLE_FLIGHT.autoDeployHeight ? 'deploy' : undefined} style={{ bottom: `${mark / top * 100}%` }}><small>{mark === BATTLE_FLIGHT.autoDeployHeight ? `${mark} · DÙ` : mark}</small></i>)}
          <b className="battle-altimeter-marker" style={{ bottom: `${level * 100}%` }} />
        </div>
      </div>
      <strong>{Math.round(altitude)}<small>m</small></strong>
      <span>{Math.round(drop.speed ?? 0)} km/h</span>
      <span>{Math.round(drop.heading ?? 0)}°</span>
    </div>
    <div className="battle-drop-strip" role="note">
      <b>{label}</b>
      {drop.phase === 'boarding' && <><span><kbd>Space</kbd> Nhảy</span><span><kbd>M</kbd> Chọn điểm nhảy</span><small>Tự nhảy sau {Math.ceil((state.plane?.remainingMs ?? 0) / 1000)}s</small></>}
      {drop.phase === 'falling' && <><span><kbd>WASD</kbd> Lướt</span><span><kbd>Shift</kbd> Lao nhanh</span>{(drop.deployIn ?? 0) > 0 ? <span className="battle-drop-wait">Bung dù sau {Math.ceil(drop.deployIn!)}s</span> : <span><kbd>Space</kbd> Bung dù</span>}<small>Tự bung ở {BATTLE_FLIGHT.autoDeployHeight} m</small></>}
      {drop.phase === 'parachute' && <><span><kbd>WASD</kbd> Lượn dù</span><small>Tự thu dù khi chạm đất</small></>}
    </div>
  </>;
}
