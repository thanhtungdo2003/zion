'use client';

import type { CSSProperties } from 'react';
import { ITEMS, type RequisitionReward } from '@zion/shared';
import { itemIcons } from '@/game/inventory/icons';
import { Icon } from './Icon';

/** Inventory-style reward cell using a cached render of the actual item model. */
export function CareerReward({ reward }: { reward: RequisitionReward }) {
  const id = reward.kind === 'coins' ? 'zcoin' : reward.id;
  const src = itemIcons.get(id);
  const tint = reward.kind === 'coins' ? '#ffb000' : ITEMS[id]?.color ?? '#bd8ce5';
  return <span className="career-reward" style={{ '--reward-tint': tint } as CSSProperties} title={`${reward.name} ×${reward.quantity}`} role="img" aria-label={`${reward.name}, số lượng ${reward.quantity}`}>
    <span className="career-reward-cell">
      {src ? <img src={src} alt="" draggable={false} /> : <Icon name={reward.kind === 'coins' ? 'lucide:coins' : reward.kind === 'item' ? 'lucide:package' : 'lucide:sparkles'} />}
      <strong>×{reward.quantity.toLocaleString('vi-VN')}</strong>
    </span>
    <span className="career-reward-name">{reward.name}</span>
  </span>;
}
