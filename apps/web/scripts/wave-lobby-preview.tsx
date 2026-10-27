/** Browser-only preview of the wave lobby, bundled by wave-lobby-e2e.mjs (mocked API, no server). */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { TeamAction, TeamLobby } from '@zion/shared';
import { WaveBoards, WaveLobby } from '../src/components/WaveLobby';
import { login } from '../src/lib/api';

const view = new URLSearchParams(location.search).get('view') ?? 'bots';
try { localStorage.setItem('zion.waves.mode', view === 'party' || view === 'join' ? 'friends' : 'bots'); localStorage.setItem('zion.waves.bots', '2'); localStorage.setItem('zion.waves.map', 'kho-hang'); } catch { /* storage blocked */ }

const me = '00000000-0000-4000-8000-000000000001';
const party: TeamLobby = {
  available: [],
  team: {
    id: 't1', code: 'A1B2C3D4', name: 'Đội của Ann', leaderId: me, public: false, quests: {}, chat: [], launchId: null, launchedAt: 0, map: 'kho-hang',
    members: [
      { accountId: me, name: 'Ann', ready: false, online: true, inGame: false },
      { accountId: 'b', name: 'Bảo', ready: true, online: true, inGame: false },
      { accountId: 'c', name: 'Cường', ready: false, online: true, inGame: false },
    ],
  },
};

function App() {
  const [lobby] = useState<TeamLobby | null>(view === 'party' ? party : { available: [], team: null });
  if (view === 'boards') return <WaveBoards maps={[{ id: 'kho-hang', name: 'Kho hàng', thumbnail: null, players: 3, matches: 0 }]} initialMap="kho-hang" onClose={() => undefined} />;
  return <WaveLobby lobby={lobby} busy={false} error={null} onAction={async (_a: TeamAction) => lobby} onPlay={() => undefined} onClose={() => undefined} />;
}

void login('ann', 'x').finally(() => {
  document.body.style.cssText = 'margin:0;background:#0b0c0d';
  createRoot(document.getElementById('root')!).render(<App />);
  setTimeout(() => Object.assign(window, { preview: { ready: true } }), 800);
});
