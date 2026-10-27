'use client';

import { useEffect, useState } from 'react';
import { studioSetCharacterStyle } from '@/lib/api';
import { CHARACTER_STYLES, characterStyle, resetCharacterStyle, type CharacterStyle } from '@/game/character-style';
import { Icon } from './Icon';

const LABELS: Record<CharacterStyle, string> = { survivor: 'Người', mixamo: 'Người · xương Mixamo', blocky: 'Khối' };

/** Which character every player sees: the survivor, the survivor on the Mixamo skeleton (trial), or the old block character. */
export function StudioCharacterStyle() {
  const [style, setStyle] = useState<CharacterStyle | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void characterStyle().then(setStyle); }, []);
  const choose = (next: CharacterStyle) => {
    setBusy(true);
    void studioSetCharacterStyle(next).then(r => { resetCharacterStyle(); setStyle(r.style); setFailed(false); }).catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  return <label className={`btn studio-jolt studio-select ${style && style !== 'survivor' ? 'on' : ''}`}
    title={failed ? 'Không đổi được khung xương nhân vật' : 'Khung xương nhân vật cho mọi người chơi. "Xương Mixamo" (thử nghiệm): đi bộ phát đúng bản ghi Walking.fbx. Áp dụng khi tải lại trang hoặc vào trận mới.'}>
    <Icon name="lucide:bone" /> Nhân vật
    <select value={style ?? ''} disabled={busy || style === null} onChange={(e) => choose(e.target.value as CharacterStyle)}>
      {style === null && <option value="">…</option>}
      {CHARACTER_STYLES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
    </select>
  </label>;
}
