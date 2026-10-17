'use client';
import { ITEMS, type ItemDef } from '@zion/shared';
import { useSettings } from '@/lib/settings';
import { ItemArt } from './Inventory';
import { Icon } from './Icon';

export interface GroundEntry { id: number; itemId: string; count?: number }

/**
 * Loose items within reach on the player's floor: one row each, a click picks it up. Shown on
 * its own when two or more lie together, and in a corner of an open chest.
 */
export function GroundPanel({ items, onPick, inChest = false, onTip }: { items: readonly GroundEntry[]; onPick: (id: number) => void; inChest?: boolean; onTip?: (tip: { def: ItemDef; count?: number } | null) => void }) {
  const { item } = useSettings();
  if (!items.length) return null;
  return (
    <section className={`ground-panel${inChest ? ' in-chest' : ''}`} aria-label="Vật phẩm dưới đất">
      <header><Icon name="lucide:package-open" /> Dưới đất · {items.length}</header>
      <ul>
        {items.map((g) => {
          const def = ITEMS[g.itemId];
          if (!def) return null;
          return (
            <li key={g.id}>
              <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => { onTip?.(null); onPick(g.id); }}
                onMouseEnter={() => onTip?.({ def, count: g.count })} onMouseLeave={() => onTip?.(null)}>
                <ItemArt def={def} /><span>{item(g.itemId)}</span>{g.count !== undefined && g.count > 1 ? <small>x{g.count}</small> : <Icon name="lucide:hand" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
