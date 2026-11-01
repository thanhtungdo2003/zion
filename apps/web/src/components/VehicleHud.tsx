'use client';

import type { HudState } from '@/game/hud-store';
import { Icon } from './Icon';

type Vehicle = NonNullable<HudState['vehicle']>;

const CLASS_ICONS = { car: 'game-icons:jeep', tank: 'game-icons:tank', apc: 'game-icons:apc', heli: 'game-icons:helicopter' } as const;
const WEAPON_ICONS = { cannon: 'game-icons:cannon', mg: 'game-icons:machine-gun', autocannon: 'game-icons:minigun', rockets: 'game-icons:rocket', missile: 'game-icons:missile-pod' } as const;
const PART_ICONS: Record<string, string> = {
  hull: 'lucide:shield', engine: 'game-icons:gears', tracks: 'game-icons:tank-tread', turret: 'game-icons:turret', gun: 'game-icons:cannon',
  mainRotor: 'game-icons:spinning-blades', tailRotor: 'game-icons:helicopter-tail', cockpit: 'game-icons:plane-pilot', station: 'game-icons:sentry-gun',
};

/** A part's state as a tone. */
const tone = (h: number) => (h <= 0 ? 'out' : h < .35 ? 'bad' : h < .75 ? 'hurt' : 'ok');

/**
 * The HUD aboard a vehicle, see-through like the rest of the HUD and read at a glance: icons and
 * numbers, no sentences. Speed (or, flying, speed, height, climb, lift and rotor), the seat's
 * weapons (key, loaded / spare, reload), the countermeasure, the parts as icons over their health.
 * Near a vehicle and not aboard, only the key to get in.
 */
export function VehicleHud({ vehicle: v }: { vehicle: Vehicle }) {
  const enter = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
  if (!v.cls) return (
    <div className="vhud-prompt" role="status"><button onClick={enter} aria-label={`Lên ${v.name}`}><kbd>F</kbd><Icon name="lucide:log-in" /><b>{v.name}</b></button></div>
  );
  const climb = v.climb ?? 0;
  return (
    <div className={`vhud vhud-${v.cls}`} role="status" aria-label={`${v.name}, ${v.seat ?? ''}`}>
      <header className="vhud-head" title={v.seat}>
        <Icon name={CLASS_ICONS[v.cls]} className="vhud-class" />
        <b>{v.name}</b>
        <Icon name={v.driving ? 'game-icons:steering-wheel' : 'lucide:crosshair'} className="vhud-seat" />
      </header>
      {v.driving && (
        <div className="vhud-gauges">
          <div className="vhud-speed"><b>{v.speed}</b><small>km/h</small></div>
          {v.cls === 'heli' && <>
            <div title="Độ cao"><Icon name="lucide:mountain" /><b>{v.altitude ?? 0}</b><small>m</small></div>
            <div className={climb < -8 ? 'warn' : undefined} title="Tốc độ lên / xuống"><Icon name={climb >= 0 ? 'lucide:arrow-up' : 'lucide:arrow-down'} /><b>{Math.abs(climb).toFixed(1)}</b><small>m/s</small></div>
            <div className="vhud-bar" title="Lực nâng"><Icon name="lucide:move-vertical" /><i style={{ transform: `scaleX(${v.collective ?? 0})` }} /></div>
            <div className={`vhud-bar${(v.rotor ?? 0) < .85 ? ' warn' : ''}`} title="Vòng quay cánh quạt"><Icon name="game-icons:spinning-blades" /><i style={{ transform: `scaleX(${v.rotor ?? 0})` }} /></div>
          </>}
        </div>
      )}
      {!!v.weapons?.length && (
        <ul className="vhud-weapons">
          {v.weapons.map((w) => {
            const reloading = w.reloadMs > 0;
            return (
              <li key={w.name} title={w.name} className={`${w.trigger === 'primary' ? 'primary' : ''}${w.jammed ? ' jammed' : ''}`}>
                <kbd>{w.key ?? (w.trigger === 'primary' ? 'LMB' : 'RMB')}</kbd>
                <Icon name={WEAPON_ICONS[w.type]} className="vhud-weapon" />
                <div className="vhud-ammo"><b>{w.mag}</b><span>{w.reserve}</span></div>
                {w.jammed ? <Icon name="lucide:wrench" className="vhud-state bad" />
                  : reloading ? <em className="vhud-state"><Icon name="lucide:timer" />{(w.reloadMs / 1000).toFixed(1)}</em>
                    : <Icon name="lucide:check" className="vhud-state ok" />}
                {reloading && !w.jammed && <i className="vhud-reload" style={{ transform: `scaleX(${1 - w.reloadMs / Math.max(1, w.reloadTotalMs)})` }} />}
              </li>
            );
          })}
        </ul>
      )}
      {v.cm && (
        <div className={`vhud-cm${v.cm.active ? ' on' : ''}`} title={v.cm.name}>
          <kbd>V</kbd><Icon name={v.cls === 'heli' ? 'game-icons:cross-flare' : 'game-icons:smoke-bomb'} />
          <b>{v.cm.active ? <Icon name="lucide:radio" /> : v.cm.readyMs > 0 ? `${Math.ceil(v.cm.readyMs / 1000)}s` : `×${v.cm.charges}`}</b>
        </div>
      )}
      {!!v.parts?.length && (
        <ul className="vhud-parts" aria-label="Tình trạng phương tiện">
          {v.parts.map((p) => (
            <li key={p.id} className={tone(p.health)} title={`${p.name} ${Math.round(p.health * 100)}%`}>
              <Icon name={PART_ICONS[p.id] ?? 'lucide:cog'} />
              <i style={{ transform: `scaleX(${Math.max(0, p.health)})` }} />
            </li>
          ))}
        </ul>
      )}
      {v.exploding && <b className="vhud-exploding"><Icon name="game-icons:explosion-rays" /><kbd>F</kbd></b>}
      <button className="vhud-exit" onClick={enter} aria-label={v.driving ? 'Xuống xe' : 'Rời ghế'}><kbd>F</kbd><Icon name="lucide:log-out" /></button>
    </div>
  );
}
