'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { TouchAction, TouchButton } from '@/game/input';
import { useSettings } from '@/lib/settings';
import { Icon } from './Icon';

export interface TouchControlsPort {
  move(x: number, z: number): void;
  button(button: TouchButton, down: boolean): void;
  look(dx: number, dy: number): { x: number; y: number } | undefined;
  fireDirection(x: number, y: number): void;
  action(action: TouchAction): void;
  reset(): void;
  chat(): void;
}

function TouchKey({ icon, label, hold, press, pressed, disabled, className = '', controls, look = false }: {
  icon: string; label: string; hold?: TouchButton; press?: () => void; pressed?: boolean;
  disabled?: boolean; className?: string; controls: TouchControlsPort; look?: boolean;
}) {
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => () => { if (hold) controls.button(hold, false); }, [controls, hold]);
  useEffect(() => {
    if (!disabled) return;
    pointer.current = null; setDown(false);
    if (hold) controls.button(hold, false);
  }, [disabled, hold, controls]);
  const end = (e: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current?.id !== e.pointerId) return;
    pointer.current = null;
    setDown(false);
    if (hold) controls.button(hold, false);
  };
  return <button type="button" className={`touch-key ${className}`} aria-label={label} title={label}
    aria-pressed={pressed ?? (hold ? down : undefined)} disabled={disabled} data-active={pressed || down}
    onContextMenu={(e) => e.preventDefault()}
    onPointerDown={(e) => {
      e.preventDefault(); e.stopPropagation();
      if (pointer.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDown(true);
      if (hold) controls.button(hold, true);
      press?.();
    }}
    onPointerMove={(e) => {
      const p = pointer.current;
      if (!look || p?.id !== e.pointerId) return;
      controls.look(e.clientX - p.x, e.clientY - p.y);
      p.x = e.clientX; p.y = e.clientY;
    }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <Icon name={icon} />
  </button>;
}

/** Independent captured pointers let movement, aiming and firing work together. */
export function MobileControls({ controls, canAim, canReload, reloading, rollCooldown, weaponUid }: {
  controls: TouchControlsPort; canAim: boolean; canReload: boolean; reloading: boolean; rollCooldown: number; weaponUid: number | null;
}) {
  const { t, firstPerson } = useSettings();
  const joystick = useRef<{ id: number; x: number; y: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const fire = useRef<number | null>(null);
  const [fireStick, setFireStick] = useState({ x: 0, y: 0 });
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const [sprint, setSprint] = useState(false);
  const [aim, setAim] = useState(false);
  const [gestureEpoch, setGestureEpoch] = useState(0);

  useEffect(() => {
    const reset = () => {
      controls.reset(); joystick.current = look.current = null; fire.current = null;
      setFireStick({ x: 0, y: 0 });
      setStick({ x: 0, y: 0 }); setSprint(false); setAim(false);
      setGestureEpoch((n) => n + 1);
    };
    const visibility = () => { if (document.hidden) reset(); };
    reset();
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      controls.reset();
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', reset);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [controls, firstPerson]);
  useEffect(() => { setAim(false); controls.button('aim', false); }, [weaponUid, controls]);

  const move = (e: PointerEvent<HTMLElement>) => {
    const p = joystick.current;
    if (p?.id !== e.pointerId) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    const length = Math.hypot(dx, dy);
    const scale = Math.max(44, length);
    setStick({ x: dx / scale * 44, y: dy / scale * 44 });
    const strength = Math.max(0, Math.min(1, (length - 6) / 38));
    controls.move(length ? dx / length * strength : 0, length ? -dy / length * strength : 0);
  };
  const endMove = (e: PointerEvent<HTMLElement>) => {
    if (joystick.current?.id !== e.pointerId) return;
    joystick.current = null; setStick({ x: 0, y: 0 }); controls.move(0, 0);
  };
  const endLook = (e: PointerEvent<HTMLElement>) => {
    if (look.current?.id === e.pointerId) look.current = null;
  };
  const dragFire = (e: PointerEvent<HTMLElement>) => {
    if (fire.current !== e.pointerId) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
    const length = Math.hypot(x, y), scale = Math.max(40, length);
    setFireStick({ x: x / scale * 40, y: y / scale * 40 });
    controls.fireDirection(length > 8 ? x / length : 0, length > 8 ? y / length : 0);
  };
  const endFire = (e: PointerEvent<HTMLElement>) => {
    if (fire.current !== e.pointerId) return;
    fire.current = null; setFireStick({ x: 0, y: 0 }); controls.fireDirection(0, 0);
  };
  return <div key={gestureEpoch} className="touch-controls" data-nosound>
    {firstPerson && <div className="touch-look" aria-label={t('touch.look')}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault();
        if (look.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
        look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const p = look.current;
        if (p?.id !== e.pointerId) return;
        controls.look(e.clientX - p.x, e.clientY - p.y);
        p.x = e.clientX; p.y = e.clientY;
      }} onPointerUp={endLook} onPointerCancel={endLook} onLostPointerCapture={endLook} />}
    <div className="touch-tools">
      <TouchKey controls={controls} icon="lucide:pause" label={t('touch.pause')} press={() => controls.action('pause')} />
      <TouchKey controls={controls} icon="lucide:backpack" label={t('touch.inventory')} press={() => controls.action('inventory')} />
      <TouchKey controls={controls} icon="lucide:message-circle" label={t('touch.chat')} press={() => { controls.reset(); controls.chat(); }} />
    </div>
    <div className="touch-joystick" role="group" aria-label={t('touch.move')} data-active={!!joystick.current}
      onPointerDown={(e) => {
        e.preventDefault(); e.stopPropagation();
        if (joystick.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const r = e.currentTarget.getBoundingClientRect();
        joystick.current = { id: e.pointerId, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        e.currentTarget.setPointerCapture(e.pointerId); move(e);
      }} onPointerMove={move} onPointerUp={endMove} onPointerCancel={endMove} onLostPointerCapture={endMove}>
      <Icon name="lucide:move" />
      <i style={{ transform: `translate(${stick.x}px, ${stick.y}px)` }} />
    </div>
    <TouchKey controls={controls} className="touch-sprint" icon="lucide:footprints" label={t('touch.sprint')} pressed={sprint}
      press={() => { controls.button('sprint', !sprint); setSprint(!sprint); }} />
    {firstPerson ? <TouchKey controls={controls} className="touch-fire" icon="lucide:crosshair" label={t('touch.attack')} hold="attack" look /> :
      <div className="touch-joystick touch-fire-stick" role="group" aria-label={t('touch.dragFire')} data-active={fire.current !== null}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          e.preventDefault(); e.stopPropagation();
          if (fire.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
          fire.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); dragFire(e);
        }} onPointerMove={dragFire} onPointerUp={endFire} onPointerCancel={endFire} onLostPointerCapture={endFire}>
        <Icon name="lucide:crosshair" /><i style={{ transform: `translate(${fireStick.x}px, ${fireStick.y}px)` }} />
      </div>}
    <div className="touch-actions">
      {canAim ? <TouchKey controls={controls} icon="lucide:scan" label={t('touch.aim')} pressed={aim} press={() => { controls.button('aim', !aim); setAim(!aim); }} /> : <span />}
      <TouchKey controls={controls} icon="lucide:rotate-cw" label={t('touch.reload')} disabled={!canReload || reloading} press={() => controls.action('reload')} />
      <TouchKey controls={controls} icon="lucide:hand" label={t('touch.interact')} press={() => controls.action('interact')} />
      <TouchKey controls={controls} icon="lucide:heart-pulse" label={t('touch.heal')} press={() => controls.action('heal')} />
      <TouchKey controls={controls} icon="lucide:arrow-up-from-line" label={t('touch.jump')} hold="jump" />
      <TouchKey controls={controls} icon="lucide:rotate-3d" label={t('touch.roll')} hold="roll" disabled={rollCooldown > 0} />
    </div>
  </div>;
}
