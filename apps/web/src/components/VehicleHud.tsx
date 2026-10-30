'use client';

import type { HudState } from '@/game/hud-store';

const WEAPON_TYPES = { cannon: 'Pháo', mg: 'Súng máy', autocannon: 'Pháo tự động', rockets: 'Rocket', missile: 'Tên lửa' } as const;
const CLASS_NAMES = { car: 'Xe', tank: 'Xe tăng', apc: 'Xe bọc thép', heli: 'Trực thăng' } as const;

type Vehicle = NonNullable<HudState['vehicle']>;

/** A part's state as a word and a tone. */
function condition(h: number): { word: string; tone: 'ok' | 'hurt' | 'bad' | 'out' } {
  if (h <= 0) return { word: 'Hỏng', tone: 'out' };
  if (h < .35) return { word: 'Nặng', tone: 'bad' };
  if (h < .75) return { word: 'Hư hại', tone: 'hurt' };
  return { word: 'Tốt', tone: 'ok' };
}

/**
 * The HUD aboard a vehicle, shaped by what it is: the weapons of our seat (loaded / spare, reload,
 * which button), the vehicle's parts and their damage, and what that kind of vehicle needs
 * (speed for anything on wheels or tracks; collective, rotor, height and climb for a helicopter).
 * Near a vehicle and not aboard, only the prompt to get in.
 */
export function VehicleHud({ vehicle: v }: { vehicle: Vehicle }) {
  const enter = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
  if (!v.cls) return (
    <div className="vhud-prompt" role="status"><button onClick={enter}><kbd>F</kbd> Lên {v.name}</button></div>
  );
  return (
    <div className={`vhud vhud-${v.cls}`} role="status" aria-label={`${v.name}, ${v.seat ?? ''}`}>
      <header className="vhud-head">
        <small>{CLASS_NAMES[v.cls]}</small>
        <strong>{v.name}</strong>
        {v.seat && <span>{v.seat}</span>}
      </header>
      {v.driving && (
        <div className="vhud-flight">
          {v.cls === 'heli' ? <>
            <div><b>{v.speed}</b><small>km/h</small></div>
            <div><b>{v.altitude ?? 0}</b><small>m</small></div>
            <div className={(v.climb ?? 0) < -8 ? 'warn' : undefined}><b>{(v.climb ?? 0) > 0 ? '+' : ''}{(v.climb ?? 0).toFixed(1)}</b><small>m/s</small></div>
            <div className="vhud-bars">
              <label>Lực nâng<meter min={0} max={1} value={v.collective ?? 0} /></label>
              <label>Vòng quay<meter min={0} max={1} low={.85} optimum={1} value={v.rotor ?? 0} /></label>
            </div>
          </> : <div><b>{v.speed}</b><small>km/h</small></div>}
        </div>
      )}
      {!!v.weapons?.length && (
        <ul className="vhud-weapons">
          {v.weapons.map((w) => {
            const reloading = w.reloadMs > 0;
            return (
              <li key={w.name} className={`${w.trigger === 'primary' ? 'primary' : ''}${w.jammed ? ' jammed' : ''}`}>
                <kbd>{w.key ?? (w.trigger === 'primary' ? 'LMB' : 'RMB')}</kbd>
                <div className="vhud-weapon-name"><small>{WEAPON_TYPES[w.type]}</small><b>{w.name}</b></div>
                <div className="vhud-ammo"><b>{w.mag}</b><span>/ {w.reserve}</span></div>
                <div className="vhud-reload">
                  {w.jammed ? <em>Hỏng</em> : reloading
                    ? <><i style={{ transform: `scaleX(${1 - w.reloadMs / Math.max(1, w.reloadTotalMs)})` }} /><em>Nạp {(w.reloadMs / 1000).toFixed(1)} s</em></>
                    : <em className="ready">Sẵn sàng</em>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {v.cm && <div className={`vhud-cm${v.cm.active ? ' on' : ''}`}><kbd>V</kbd><b>{v.cm.name}</b>
        <span>{v.cm.active ? 'Đang dùng' : v.cm.readyMs > 0 ? `${Math.ceil(v.cm.readyMs / 1000)} s` : `×${v.cm.charges}`}</span></div>}
      {!!v.parts?.length && (
        <ul className="vhud-parts" aria-label="Tình trạng phương tiện">
          {v.parts.map((p) => {
            const c = condition(p.health);
            return <li key={p.id} className={c.tone}><span>{p.name}</span><meter min={0} max={1} value={p.health} /><em>{c.word}</em></li>;
          })}
        </ul>
      )}
      {v.exploding && <b className="vhud-exploding">SẮP NỔ · F</b>}
      <button className="vhud-exit" onClick={enter}><kbd>F</kbd> {v.driving ? 'Xuống xe' : 'Rời ghế'}</button>
    </div>
  );
}
