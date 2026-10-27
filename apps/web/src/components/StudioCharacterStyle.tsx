'use client';

import { useEffect, useState } from 'react';
import { studioSetCharacterStyle } from '@/lib/api';
import { blockyCharacters, resetCharacterStyle } from '@/game/character-style';
import { Icon } from './Icon';

/** Switch between the survivor model and the old block (Minecraft-style) character for every player. */
export function StudioCharacterStyle() {
  const [blocky, setBlocky] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void blockyCharacters().then(setBlocky); }, []);
  const toggle = () => {
    if (blocky === null) return;
    setBusy(true);
    void studioSetCharacterStyle(!blocky).then(r => { resetCharacterStyle(); setBlocky(r.blocky); setFailed(false); }).catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  return <button className={`btn studio-jolt ${blocky ? 'on' : ''}`} aria-pressed={!!blocky} disabled={busy || blocky === null} onClick={toggle}
    title={failed ? 'Không đổi được kiểu nhân vật' : 'Nhân vật: mô hình người thật hoặc nhân vật khối vuông kiểu cũ. Áp dụng khi người chơi tải lại trang/vào trận mới.'}>
    <Icon name="lucide:box" /> Nhân vật {blocky === null ? '…' : blocky ? 'KHỐI' : 'NGƯỜI'}
  </button>;
}
