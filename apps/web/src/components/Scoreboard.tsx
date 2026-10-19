import type { HudState } from '@/game/hud-store';
import { Icon } from './Icon';

/**
 * The Tab scoreboard, laid out like competitive shooters: a header with the mode, one row per
 * player (rank, name, kills, deaths, K/D, status, ping), the local row highlighted. Infection
 * splits it into survivors and the infected; battle royale ranks the living first.
 */
export function Scoreboard({ hud }: { hud: HudState }) {
  const mode = hud.mode, rows = [...hud.scorePlayers];
  const order = (a: typeof rows[number], b: typeof rows[number]) => Number(a.dead) - Number(b.dead) || b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name);
  const title = mode === 'battle-royale' ? 'BATTLE ROYALE' : mode === 'infection' ? 'LÂY NHIỄM' : 'SINH TỒN';
  const sub = mode === 'battle-royale' && hud.battle ? `${hud.battle.alive} còn sống · vòng ${hud.battle.stage}` : `${rows.length} người chơi`;
  const groups = mode === 'infection'
    ? [{ key: 'h', label: 'NGƯỜI SỐNG SÓT', tone: 'human', list: rows.filter((r) => !r.zombie).sort(order) }, { key: 'z', label: 'NGƯỜI BỊ NHIỄM', tone: 'zombie', list: rows.filter((r) => r.zombie).sort(order) }]
    : [{ key: 'all', label: '', tone: '', list: rows.sort(order) }];
  return (
    <div className="scoreboard" role="dialog" aria-label="Bảng người chơi">
      <header>
        <div><b>{title}</b><small>{sub}</small></div>
        <span><Icon name="lucide:users" /> {rows.filter((r) => !r.dead).length}/{rows.length}</span>
      </header>
      {groups.map((g) => (
        <section key={g.key} className={g.tone}>
          {g.label && <h3>{g.label}<em>{g.list.length}</em></h3>}
          <div className="score-row score-head"><span>#</span><span>Người chơi</span><span>Hạ</span><span>Chết</span><span>K/D</span><span>Trạng thái</span><span>Ping</span></div>
          {g.list.map((r, i) => (
            <div key={r.id} className={`score-row${r.id === hud.selfId ? ' self' : ''}${r.dead ? ' out' : ''}`}>
              <span>{i + 1}</span>
              <span className="score-name"><b>{r.name}</b>{r.rank && <small>{r.rank}</small>}{r.bot && <i>BOT</i>}</span>
              <span>{r.kills}</span>
              <span>{r.deaths}</span>
              <span>{(r.kills / Math.max(1, r.deaths)).toFixed(2)}</span>
              <span className="score-state">{r.dead ? 'Đã loại' : r.zombie ? 'Nhiễm' : 'Còn sống'}</span>
              <span>{r.id === hud.selfId ? `${hud.pingMs}` : r.bot ? '—' : '·'}</span>
            </div>
          ))}
        </section>
      ))}
      <footer>Giữ <kbd>Tab</kbd> để xem</footer>
    </div>
  );
}
