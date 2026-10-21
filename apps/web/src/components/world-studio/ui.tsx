'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from '../Icon';
import s from './world-studio.module.css';

export function Section({ title, icon, children, collapsible = false, initiallyOpen = true, extra }: { title: string; icon?: string; children: ReactNode; collapsible?: boolean; initiallyOpen?: boolean; extra?: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  const head = <>{icon && <Icon name={`lucide:${icon}`} />}<h3>{title}</h3>{extra}{collapsible && <Icon name={open ? 'lucide:chevron-up' : 'lucide:chevron-down'} />}</>;
  return <section className={s.section}>
    {collapsible ? <button type="button" className={`${s.sectionHead} ${s.collapse}`} onClick={() => setOpen(!open)} aria-expanded={open}>{head}</button> : <div className={s.sectionHead}>{head}</div>}
    {open && children}
  </section>;
}

export function Slider({ label, value, min, max, step = 1, unit = '', onChange, format, testId }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; format?: (v: number) => string; testId?: string }) {
  return <label className={s.field}>
    <span className={s.fieldRow}>{label}<output>{format ? format(value) : `${Number.isInteger(step) ? Math.round(value) : value.toFixed(step < .1 ? 2 : 1)}${unit}`}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testId} />
  </label>;
}

export function NumberField({ label, value, onChange, min, max, step = 1, unit }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string }) {
  return <label className={s.field}>
    <span className={s.fieldRow}>{label}{unit && <small>{unit}</small>}</span>
    <input className={s.input} type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step}
      onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(min !== undefined && v < min ? min : max !== undefined && v > max ? max : v); }} />
  </label>;
}

export function TextField({ label, value, onChange, placeholder, testId }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; testId?: string }) {
  return <label className={s.field}><span className={s.fieldRow}>{label}</span><input className={s.input} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} /></label>;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: ReadonlyArray<{ id: T; name: string }>; onChange: (v: T) => void }) {
  return <div className={s.seg} role="radiogroup">{options.map((o) => <button type="button" key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? s.on : ''} onClick={() => onChange(o.id)}>{o.name}</button>)}</div>;
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className={s.check}><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

export function Btn({ icon, children, onClick, disabled, kind, title, testId }: { icon?: string; children?: ReactNode; onClick: () => void; disabled?: boolean; kind?: 'primary' | 'danger'; title?: string; testId?: string }) {
  return <button type="button" className={`${s.btn} ${kind ? s[kind] : ''}`} onClick={onClick} disabled={disabled} title={title} data-testid={testId}>{icon && <Icon name={`lucide:${icon}`} />}{children}</button>;
}

export const fmt = (n: number) => n.toLocaleString('vi-VN');
export const fmtTime = (t: number) => new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
