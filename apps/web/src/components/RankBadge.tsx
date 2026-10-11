import { RANKS, rankTitle, type RankTitle } from '@zion/shared';
import { Icon } from './Icon';

export function RankBadge({ rank = rankTitle(0), title = false }: { rank?: RankTitle; title?: boolean }) {
  const def = RANKS[rank.tier] ?? RANKS[0];
  return <span className="rank-inline" style={{ color: def.color }} title={rank.title} aria-label={rank.title}>
    <span className="rank-glyph"><Icon name="lucide:shield" /><i>{def.icon}</i></span>{title && <span>{rank.title}</span>}
  </span>;
}
