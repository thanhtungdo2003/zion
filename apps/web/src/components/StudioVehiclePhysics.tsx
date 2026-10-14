'use client';

import { useEffect, useState } from 'react';
import { studioSetVehiclePhysics, studioVehiclePhysics } from '@/lib/api';
import { Icon } from './Icon';

/** Live switch between Jolt Physics and the built-in arcade model for vehicles on every server. */
export function StudioVehiclePhysics() {
  const [jolt, setJolt] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void studioVehiclePhysics().then(r => setJolt(r.jolt)).catch(() => setFailed(true)); }, []);
  const toggle = () => {
    if (jolt === null) return;
    setBusy(true);
    void studioSetVehiclePhysics(!jolt).then(r => { setJolt(r.jolt); setFailed(false); }).catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  return <button className={`btn studio-jolt ${jolt ? 'on' : ''}`} aria-pressed={!!jolt} disabled={busy || jolt === null} onClick={toggle}
    title={failed ? 'Không đổi được chế độ vật lý xe' : 'Vật lý xe: Jolt Physics hoặc mô hình tích hợp sẵn. Áp dụng ngay cho mọi máy chủ.'}>
    <Icon name="lucide:car" /> Jolt {jolt === null ? '…' : jolt ? 'BẬT' : 'TẮT'}
  </button>;
}
