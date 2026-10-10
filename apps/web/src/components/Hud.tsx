'use client';
import { Icon } from './Icon';

import { itemIcons } from '@/game/inventory/icons';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SettingsModal } from '@/components/SettingsModal';
import { TUTORIAL_RESTART_EVENT } from '@/components/Onboarding';
import type { HudState } from '@/game/hud-store';
import { useSettings } from '@/lib/settings';
import { Coins } from './Inventory';
import type { TKey } from '@/lib/i18n';

interface Props {
  state: HudState;
  onMinimap: (canvas: HTMLCanvasElement | null) => void;
  onChatOpen: (open: boolean) => void;
  onChat: (text: string, channel: 'world' | 'team') => void;
  onRespawn: () => void;
  onResume: () => void;
  onLeave: () => void;
  inventoryOpen: boolean;
  onSetTime: (tod: number) => void;
  chatRequest?: number;
}

/** Time-of-day jump buttons (testing aid). */
const TIME_PRESETS: Array<[TKey, number]> = [
  ['time.dawn', 0.25],
  ['time.noon', 0.5],
  ['time.dusk', 0.76],
  ['time.night', 0.0],
];

function clock(tod: number): string {
  const minutes = Math.floor(tod * 24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function phase(tod: number): TKey {
  if (tod < 0.22 || tod > 0.8) return 'time.night';
  if (tod < 0.3) return 'time.dawn';
  if (tod < 0.72) return 'time.day';
  return 'time.dusk';
}

export function Hud({ state, onMinimap, onChatOpen, onChat, onRespawn, onResume, onLeave, inventoryOpen, onSetTime, chatRequest = 0 }: Props) {
  const { t, tm, firstPerson } = useSettings();
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [chatChannel, setChatChannel] = useState<'world' | 'team'>('world');
  const input = useRef<HTMLInputElement>(null);
  const minimap = useRef<HTMLCanvasElement>(null);
  const showWorld = state.status === 'playing' || state.status === 'dead';

  useEffect(() => {
    onMinimap(showWorld ? minimap.current : null);
  }, [showWorld, onMinimap]);

  // Latest values for the key handler, which is registered once: re-registering on every render
  // would drop it mid-dispatch (the game's own Enter handler re-renders the HUD synchronously).
  // F3: performance / debug overlay.
  const [debugOpen, setDebugOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.code !== 'F3') return;
      e.preventDefault();
      setDebugOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const keyState = useRef({ chatOpen, inventoryOpen, settingsOpen, status: state.status, onChatOpen });
  keyState.current = { chatOpen, inventoryOpen, settingsOpen, status: state.status, onChatOpen };
  useEffect(() => {
    if (!chatRequest) return;
    const k = keyState.current;
    if (k.status !== 'playing' || k.inventoryOpen || k.settingsOpen) return;
    setChatOpen(true); k.onChatOpen(true);
    const timer = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [chatRequest]);
  useEffect(() => {
    const open = (e: globalThis.KeyboardEvent) => {
      const k = keyState.current;
      if (!k.chatOpen && !k.inventoryOpen && !k.settingsOpen && k.status === 'playing' && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'KeyT')) {
        e.preventDefault();
        setChatOpen(true);
        k.onChatOpen(true);
        setTimeout(() => input.current?.focus(), 0);
      }
    };
    // Capture phase: runs before the game's keyboard handler.
    window.addEventListener('keydown', open, true);
    return () => window.removeEventListener('keydown', open, true);
  }, []);

  const closeChat = () => {
    setChatOpen(false);
    setDraft('');
    onChatOpen(false);
    onResume();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      if (draft.trim()) onChat(draft, state.team ? chatChannel : 'world');
      closeChat();
    } else if (e.key === 'Escape') closeChat();
  };

  return (
    <div className="hud">
      {state.hurtAt > 0 && <div key={state.hurtAt} className="hud-hurt" style={{ opacity: state.hurtAmount }} />}
      {showWorld && (
        <>
          <div className="hud-panel hud-minimap">
            <canvas ref={minimap} width={128} height={128} />
            <div className="hud-clock">
              <b>{clock(state.timeOfDay)}</b>
              <span>{t(phase(state.timeOfDay))}</span>
            </div>
            {process.env.NODE_ENV !== 'production' && <div className="hud-times">
              {TIME_PRESETS.map(([label, tod]) => (
                <button key={label} className="hud-time-btn" onClick={() => onSetTime(tod)} title={t('time.jump', { label: t(label) })}>
                  {t(label)}
                </button>
              ))}
            </div>}
          </div>
          <div className="hud-left-stack">
            <div className={`hud-health ${state.downed !== null ? 'dying' : state.health <= 30 ? 'low' : ''}`}>
              <div className="hud-health-head">
                <span className="hud-health-name">{state.username}</span>
                {state.swimming && <span className="hud-health-tag">{t('hud.swimming')}</span>}
              </div>
              <div className="hud-health-row">
                <span className="hud-health-num">{state.downed !== null ? Math.ceil(state.downed) : state.health}</span>
                <div className="health-bar">
                  <div style={{ width: `${state.downed !== null ? state.downed : state.health}%` }} />
                </div>
              </div>
              {state.life && (
                <div className="hud-stamina-row" title="Stamina">
                  {itemIcons.get('cooked_mutton') ? <img className="hud-stamina-icon" src={itemIcons.get('cooked_mutton')} alt="" /> : <span className="hud-stamina-icon" />}
                  <div className="stamina-bar">
                    <div className="stamina-cap" style={{ left: `${(state.life.capacity / state.life.config.stamina.maximum) * 100}%` }} />
                    <div className="stamina-fill" style={{ width: `${(state.life.stamina / state.life.config.stamina.maximum) * 100}%` }} />
                  </div>
                  <span className="hud-stamina-num">{Math.round(state.life.stamina)}</span>
                </div>
              )}
              <div className={`hud-roll ${state.rollCd > 0 ? 'cooling' : ''}`} title="Roll (C)">
                <kbd>C</kbd>
                <div className="hud-roll-bar">
                  <div style={{ width: `${(1 - state.rollCd) * 100}%` }} />
                </div>
              </div>
            </div>
            {state.life && (() => {
              const st = state.life.config.stamina;
              const exhausted = state.life.stamina < st.maximum * 0.1;
              const starving = state.life.capacity <= st.minimumCapacity + 5;
              const hungry = !starving && state.life.capacity <= st.maximum * 0.7;
              if (!exhausted && !starving && !hungry) return null;
              return (
                <div className="hud-alerts">
                  {exhausted && <div className="hud-alert danger"><b>Hết thể lực</b> Không thể chạy và lộn — đứng nghỉ để hồi.</div>}
                  {(hungry || starving) && <div className={`hud-alert ${starving ? 'danger' : ''}`}><b>{starving ? 'Rất đói' : 'Đang đói'}</b> Ăn đồ chín để bổ sung năng lượng (chuột phải vào thức ăn).</div>}
                </div>
              );
            })()}
            <div className="hud-panel chat">
              {state.team && <div className="chat-channels"><button className={chatChannel === 'world' ? 'on' : ''} onPointerDown={(e) => e.preventDefault()} onClick={() => setChatChannel('world')}>Thế giới</button><button className={chatChannel === 'team' ? 'on' : ''} onPointerDown={(e) => e.preventDefault()} onClick={() => setChatChannel('team')}><i /> Đội · {state.team.name}</button></div>}
              <div className="chat-log">
                {state.chat.filter((l) => l.system || (l.channel ?? 'world') === (state.team ? chatChannel : 'world')).slice(-8).map((l) => (
                  <div key={l.id} style={l.system ? { color: 'var(--muted)' } : undefined}>
                    {!l.system && <b>{l.from}: </b>}
                    {l.msg ? tm(l.msg.key === 'chat.died' && !l.msg.vars?.name ? { ...l.msg, vars: { name: t('chat.someone') } } : l.msg) : l.text}
                  </div>
                ))}
              </div>
              {chatOpen && (
                <input
                  ref={input}
                  value={draft}
                  maxLength={200}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKey}
                  onBlur={closeChat}
                  placeholder={t('hud.say')}
                />
              )}
            </div>
          </div>
          {state.team && <div className="team-hud"><span className="q-label"><Icon name="lucide:users" /> {state.team.name}</span>{state.team.members.filter((m) => m.name !== state.username).map((m) => <div key={m.accountId}><i /><span>{m.name}</span><small>{m.downed ? 'Cần cứu!' : m.health !== undefined && m.inGame ? `${m.health} HP` : m.online ? 'Ở sảnh' : 'Offline'}</small></div>)}</div>}
          {state.toast && <div className="toast">{tm(state.toast)}</div>}
          {state.interact && !inventoryOpen && (
            <div className="hud-interact">
              <kbd>E</kbd> {tm(state.interact)}
            </div>
          )}
          {state.scoped && <div className="hud-scope" />}
          {debugOpen && (
            <div className="hud-debug">
              <b>F3 · Debug</b>
              <span>FPS</span><em className={state.fps < 30 ? 'bad' : ''}>{state.fps}</em>
              <span>Ping</span><em className={state.pingMs > 150 ? 'bad' : ''}>{state.pingMs} ms</em>
              <span>TPS</span><em className={(state.debug?.tps ?? 30) < 25 ? 'bad' : ''}>{state.debug?.tps ?? '—'}</em>
              <span>Players</span><em>{state.playersNearby} near · {state.playersOnline} online</em>
              <span>Entities</span><em>{state.debug?.entities ?? 0} ({state.debug?.zombies ?? 0} zombies)</em>
              <span>Draw calls</span><em>{state.debug?.drawCalls ?? 0}</em>
              <span>Triangles</span><em>{state.trianglesK}k</em>
              <span>GPU mem</span><em>{state.debug?.geometries ?? 0} geo · {state.debug?.textures ?? 0} tex</em>
              {state.debug?.heapMB != null && <><span>JS heap</span><em>{state.debug.heapMB} MB</em></>}
              <span>Net in</span><em>{state.debug?.snapshotKB ?? 0} KB</em>
              <span>Chunks</span><em>{state.chunksLoaded}</em>
              <span>Position</span><em>{state.position.map((v) => v.toFixed(1)).join(', ')}</em>
              <span>Chunk</span><em>{state.chunk.join(', ')}</em>
              <span>Biome</span><em>{state.biome} · {state.surface}</em>
            </div>
          )}
          <Coins n={state.coins} className="hud-coins" />
          {state.guides.map((g, i) => (
            <div key={`${g.role}${i}`} className="hud-guide" style={{ left: g.x, top: g.y }}>
              <i className="hud-guide-arrow" style={{ transform: `rotate(${g.angle}rad)` }} />
              <span className={`hud-guide-icon ${g.role}`}><Icon name={g.role === 'nurse' ? 'game-icons:medical-pack' : g.role === 'merchant' ? 'game-icons:pistol-gun' : g.role === 'farmer' ? 'game-icons:wheat' : g.role === 'chef' ? 'game-icons:cooking-pot' : g.role === 'storage' ? 'game-icons:locked-chest' : 'game-icons:compass'} />{g.quest && <b className="hud-guide-quest"><Icon name="lucide:circle-alert" /></b>}</span>
              <small>{g.dist >= 100 ? `${(g.dist / 1000).toFixed(1)} km` : `${g.dist} m`}</small>
            </div>
          ))}
          {state.healing !== null && (
            <div className="hud-healing">
              <span>{t('hud.healing')}</span>
              <div className="hud-healing-bar">
                <div style={{ transform: `scaleX(${state.healing})` }} />
              </div>
            </div>
          )}
        </>
      )}

      {(state.status === 'connecting' || state.status === 'loading') && (
        <div className="overlay">
          <div className="overlay-card">
            <h2>ZION</h2>
            <div>{tm(state.statusDetail)}</div>
            {state.status === 'loading' && (
              <div className="loading-bar">
                <div style={{ width: `${Math.round(state.loadProgress * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {state.status === 'playing' && !state.pointerLocked && !chatOpen && !inventoryOpen && (
        <div className="overlay" onClick={onResume}>
          <div className="overlay-card pause-card">
            <span className="overlay-kicker">ZION // {t('pause.title')}</span>
            <h2>{t('pause.title')}</h2>
            <div className="keys">
              <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> {t('keys.move')} · <kbd>Shift</kbd> {t('keys.sprint')} · <kbd>Space</kbd>{' '}
              {t('keys.jump')} · <kbd>C</kbd> {t('keys.roll')} · <kbd>E</kbd> {t('keys.inventory')} · <kbd>Wheel</kbd>/<kbd>1</kbd>-<kbd>9</kbd>{' '}
              {t('keys.weapon')}
              <br />
              <kbd>Mouse</kbd> {t('keys.aim')} · <kbd>LMB</kbd> {t('keys.shoot')} · <kbd>RMB</kbd> {t('keys.scope')} · <kbd>R</kbd>{' '}
              {t('keys.reload')} · <kbd>H</kbd> {t('keys.heal')} · <kbd>Enter</kbd> {t('keys.chat')} · <kbd>Esc</kbd> {t('keys.pause')}
            </div>
            <div className="pause-actions">
              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setSettingsOpen(true);
                }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden focusable="false">
                  <path
                    fill="currentColor"
                    d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
                  />
                </svg>
                {t('pause.settings')}
              </button>
              <button
                className="btn btn-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onLeave();
                }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden focusable="false">
                  <path
                    fill="currentColor"
                    d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"
                  />
                </svg>
                {t('pause.exit')}
              </button>
            </div>
            <p className="pause-hint">{t('pause.resume')}</p>
          </div>
        </div>
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        {state.status === 'playing' && (
          <section className="set-section">
            <h3>
              <span>06</span> {t('settings.tutorial')}
            </h3>
            <button
              type="button"
              className="btn set-tutorial"
              onClick={() => {
                setSettingsOpen(false);
                window.dispatchEvent(new Event(TUTORIAL_RESTART_EVENT));
              }}
            >
              <Icon name="game-icons:compass" /> {t('settings.tutorial_run')}
            </button>
          </section>
        )}
      </SettingsModal>

      {firstPerson && state.status === 'playing' && state.pointerLocked && !inventoryOpen && (
        <div className={`fp-crosshair${state.scoped ? ' scoped' : ''}`} aria-hidden>
          <i /><i /><i /><i />
        </div>
      )}

      {state.status === 'dead' && (
        <div className="overlay">
          <div className="overlay-card">
            <h2 style={{ color: 'var(--danger)' }}>{t('hud.you_died')}</h2>
            <button className="btn btn-primary" disabled={state.respawnIn > 0} onClick={onRespawn}>
              {state.respawnIn > 0 ? t('hud.respawn_in', { s: state.respawnIn }) : t('hud.respawn')}
            </button>
          </div>
        </div>
      )}

      {state.status === 'disconnected' && (
        <div className="overlay">
          <div className="overlay-card">
            <h2>{t('hud.disconnected')}</h2>
            <p>{tm(state.statusDetail)}</p>
            <div className="overlay-row">
              <button className="btn btn-primary" onClick={() => window.location.reload()}>
                {t('hud.reconnect')}
              </button>
              <button className="btn" onClick={onLeave}>
                {t('hud.main_menu')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
