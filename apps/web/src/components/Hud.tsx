'use client';
import { Icon } from './Icon';
import { RankBadge } from './RankBadge';
import { RankPromotion } from './RankPromotion';
import { LoadingBackdrop } from './LoadingBackdrop';
import { RedDotReticle, ScopeOverlay } from './ScopeOverlay';
import { BattleResults } from './BattleResults';

import { itemIcons } from '@/game/inventory/icons';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SettingsModal } from '@/components/SettingsModal';
import { TUTORIAL_RESTART_EVENT } from '@/components/Onboarding';
import type { HudState } from '@/game/hud-store';
import { rollKeyLabel, useSettings } from '@/lib/settings';
import { Coins } from './Inventory';
import type { TKey } from '@/lib/i18n';

interface Props {
  state: HudState;
  onMinimap: (canvas: HTMLCanvasElement | null) => void;
  onCompass?: (canvas: HTMLCanvasElement | null) => void;
  onOpenMap: () => void;
  onChatOpen: (open: boolean) => void;
  onChat: (text: string, channel: 'world' | 'team') => void;
  onRespawn: () => void;
  onResume: () => void;
  onLeave: () => void;
  inventoryOpen: boolean;
  onPvp: (enabled: boolean) => void;
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

/** A mouse with its right button lit: "right click to use". */
function MouseRight() {
  return (
    <svg className="hud-mouse" viewBox="0 0 16 22" aria-label="Chuột phải" role="img">
      <rect x="1" y="1" width="14" height="20" rx="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1v8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.75 1.8A6.25 6.25 0 0 1 14.25 8.25H8.75Z" fill="var(--accent)" />
    </svg>
  );
}

export function Hud({ state, onMinimap, onCompass, onOpenMap, onChatOpen, onChat, onRespawn, onResume, onLeave, inventoryOpen, onPvp, onSetTime, chatRequest = 0 }: Props) {
  const { t, tm, cameraMode, rollKey, proneKey } = useSettings();
  // Match modes: the server sends everyone back when the match ends; "reconnect" finds a new one.
  const matchOver = state.battle?.phase === 'finished' || !!state.infection?.over;
  const mouseLook = cameraMode !== 'top-down';
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
  const compass = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    onCompass?.(showWorld ? compass.current : null);
  }, [showWorld, onCompass]);

  // Latest values for the key handler, which is registered once: re-registering on every render
  // would drop it mid-dispatch (the game's own Enter handler re-renders the HUD synchronously).
  // F3: performance / debug overlay.
  const [debugOpen, setDebugOpen] = useState(false);
  // Battle royale: the results card after being knocked out, until closed to keep watching.
  const [resultsClosed, setResultsClosed] = useState(false);
  useEffect(() => { if (state.status !== 'dead') setResultsClosed(false); }, [state.status]);
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
    <>
    {mouseLook && state.status === 'playing' && state.pointerLocked && !inventoryOpen && state.scoped && !state.lensScope && (
      <ScopeOverlay magnification={state.scopeMagnification} reticle={state.reticle} nightVision={state.nightVision} nvScope={state.nvScope} />
    )}
    {/* Looking through a magnified lens: the eye focuses on the sight picture, the rest softens. */}
    {mouseLook && state.status === 'playing' && !inventoryOpen && state.scoped && state.lensScope && <div className="fp-scope-focus" aria-hidden />}
    {mouseLook && state.status === 'playing' && state.pointerLocked && !inventoryOpen && !state.scoped && !state.lensScope && (state.reticle === 'dot' || state.reticle === 'holo') && <RedDotReticle holo={state.reticle === 'holo'} />}
    <RankPromotion promotion={state.promotion} />
    <div className="hud">
      {state.vehicle && <div className={`hud-vehicle${state.vehicle.driving ? ' driving' : ''}`} role="status">
        <strong>{state.vehicle.name}</strong>
        {state.vehicle.driving && <>
          <span>{state.vehicle.speed} km/h</span>
          <div className="hud-vehicle-durability"><progress aria-label="Độ bền xe" max={100} value={state.vehicle.health} /><small>{state.vehicle.health}%</small></div>
        </>}
        {state.vehicle.exploding && <b>XE SẮP NỔ! NHẤN F ĐỂ THOÁT!</b>}
        <button onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }))}>F · {state.vehicle.driving ? 'Xuống xe' : 'Lên xe'}</button>
      </div>}
      {state.visorVision > 0 && <div className="hud-visor" style={{ '--visor': state.visorVision } as React.CSSProperties} />}
      {state.hurtAt > 0 && <div key={state.hurtAt} className="hud-hurt" style={{ opacity: state.hurtAmount }} />}
      {state.damageDirAt > 0 && <div key={`dmg-${state.damageDirAt}`} className="hud-damage-dir" style={{ transform: `rotate(${-state.damageDir}rad)` }} aria-hidden><i /></div>}
      {state.killAt > 0 && <div key={`kill-${state.killAt}`} className="hud-kill" role="status" aria-label={`Hạ gục ${state.killName}${state.killStreak > 1 ? ` ×${state.killStreak}` : ''}`}><b><Icon name="lucide:skull" />{state.killStreak > 1 && ` ×${state.killStreak}`}</b><span>{state.killName}</span></div>}
      {state.meleeCombo && <div key={`combo-${state.meleeCombo.at}`} className="hud-combo" aria-hidden><b>×{state.meleeCombo.n}</b><span>COMBO</span></div>}
      {state.hitMarkAt > 0 && <div key={state.hitMarkAt} className={`hud-hitmark${state.hitMarkHead ? ' head' : ''}`} aria-hidden><i /><i /><i /><i /></div>}
      {showWorld && (
        <>
          <canvas ref={compass} className="hud-compass" aria-label="La bàn" />
          <div className="hud-panel hud-minimap">
            <button className="hud-minimap-open" onClick={onOpenMap} title="Bản đồ lớn (M)" aria-label="Mở bản đồ lớn"><canvas ref={minimap} width={128} height={128} /><i className="hud-minimap-me" aria-hidden /></button>
            {state.mode === 'survival' && state.pvpRemaining > 0 && state.status === 'playing' && <button data-guide="pvp" className={`hud-pvp ${state.pvpEnabled ? 'active' : ''}`} aria-pressed={state.pvpEnabled} disabled={state.downed !== null} onClick={() => onPvp(!state.pvpEnabled)} title="Chỉ gây sát thương cho người chơi khác đội khi bật đồ sát">
              <Icon name="lucide:swords" /> {state.pvpEnabled ? 'Tắt đồ sát' : 'Bật đồ sát'} <small>{state.pvpRemaining}s</small>
            </button>}
            {state.mode === 'survival' && <div className="hud-clock">
              <b>{clock(state.timeOfDay)}</b>
              <span>{t(phase(state.timeOfDay))}</span>
            </div>}
            {process.env.NODE_ENV !== 'production' && state.mode === 'survival' && <div className="hud-times">
              {TIME_PRESETS.map(([label, tod]) => (
                <button key={label} className="hud-time-btn" onClick={() => onSetTime(tod)} title={t('time.jump', { label: t(label) })}>
                  {t(label)}
                </button>
              ))}
            </div>}
          </div>
          <div className="hud-left-stack">
            <div className={`hud-health ${state.downed !== null ? 'dying' : state.health <= 30 ? 'low' : ''}`}>
              <div className="hud-health-row">
                <span className="hud-health-num">{state.downed !== null ? Math.ceil(state.downed) : state.health}</span>
                <div className="health-bar">
                  <div style={{ width: `${state.downed !== null ? state.downed : state.health}%` }} />
                </div>
              </div>
              {state.life && (
                <div className="hud-stamina-row" title={t('hud.stamina')}>
                  {itemIcons.get('cooked_mutton') ? <img className="hud-stamina-icon" src={itemIcons.get('cooked_mutton')} alt="" /> : <span className="hud-stamina-icon" />}
                  <div className="stamina-bar">
                    <div className="stamina-cap" style={{ left: `${(state.life.capacity / state.life.config.stamina.maximum) * 100}%` }} />
                    <div className="stamina-fill" style={{ width: `${(state.life.stamina / state.life.config.stamina.maximum) * 100}%` }} />
                  </div>
                  <span className="hud-stamina-num">{Math.round(state.life.stamina)}</span>
                </div>
              )}
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
                  <div key={l.id} className={l.announcement ? 'chat-announcement' : undefined} style={l.system && !l.announcement ? { color: 'var(--muted)' } : undefined}>
                    {!l.system && <b><RankBadge rank={l.rank} /> {l.from} <small className="chat-rank-title">{l.rank?.title}</small>: </b>}
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
          {state.team && <div className="team-hud"><span className="q-label"><Icon name="lucide:users" /> {state.team.name}</span>{state.team.members.filter((m) => m.name !== state.username).map((m) => <div key={m.accountId}><i /><span>{m.name}</span><small>{m.downed ? 'Cần cứu!' : m.health !== undefined && m.inGame ? `${m.health} HP` : m.online ? 'Ở sảnh' : t('hud.offline')}</small></div>)}</div>}
          {state.toast && <div className="toast">{tm(state.toast)}</div>}
          {state.interact && !inventoryOpen && (
            // TOP: next to the target under the cursor; third / first person: under the crosshair.
            <div className={`hud-interact${state.interactAt ? ' at' : ''}`} role="status"
              style={state.interactAt ? { left: state.interactAt[0], top: state.interactAt[1] } : undefined}>
              {state.interactInput === 'mouse' ? <MouseRight /> : <kbd>F</kbd>}<span>{tm(state.interact)}</span>
            </div>
          )}
          {state.scoped && !mouseLook && <div className="hud-scope" />}
          {debugOpen && (
            <div className="hud-debug">
              <b>F3 · Thông số kỹ thuật</b>
              <span>FPS</span><em className={state.fps < 30 ? 'bad' : ''}>{state.fps}</em>
              <span>Ping</span><em className={state.pingMs > 150 ? 'bad' : ''}>{state.pingMs} ms</em>
              <span>TPS</span><em className={(state.debug?.tps ?? 30) < 25 ? 'bad' : ''}>{state.debug?.tps ?? '—'}</em>
              <span>Người chơi</span><em>{state.playersNearby} ở gần · {state.playersOnline} trực tuyến</em>
              <span>Thực thể</span><em>{state.debug?.entities ?? 0} ({state.debug?.zombies ?? 0} thây ma)</em>
              {state.debug?.frame && <><span>Thời gian khung</span><em>CPU {state.debug.frame.update} + vẽ {state.debug.frame.render} ms · GPU {state.debug.frame.gpu ?? '—'} ms</em></>}
              <span>Lượt vẽ</span><em>{state.debug?.drawCalls ?? 0}</em>
              <span>Tam giác</span><em>{state.trianglesK}k</em>
              <span>Bộ nhớ GPU</span><em>{state.debug?.geometries ?? 0} khối · {state.debug?.textures ?? 0} ảnh</em>
              {state.debug?.heapMB != null && <><span>Bộ nhớ JS</span><em>{state.debug.heapMB} MB</em></>}
              <span>Dữ liệu nhận</span><em>{state.debug?.snapshotKB ?? 0} KB</em>
              <span>Vùng đã tải</span><em>{state.chunksLoaded}</em>
              <span>Tọa độ</span><em>{state.position.map((v) => v.toFixed(1)).join(', ')}</em>
              <span>Ô địa hình</span><em>{state.chunk.join(', ')}</em>
              <span>Sinh cảnh</span><em>{state.biome} · {state.surface}</em>
            </div>
          )}
          {state.mode === 'survival' && <Coins n={state.coins} className="hud-coins" />}
          {state.guides.map((g, i) => (
            <div key={`${g.role}${i}`} className="hud-guide" style={{ left: g.x, top: g.y }}>
              <i className="hud-guide-arrow" style={{ transform: `rotate(${g.angle}rad)` }} />
              <span className={`hud-guide-icon ${g.role}`} title={g.name}><Icon name={g.icon ?? (g.role === 'nurse' ? 'game-icons:medical-pack' : g.role === 'merchant' ? 'game-icons:pistol-gun' : g.role === 'farmer' ? 'game-icons:wheat' : g.role === 'chef' ? 'game-icons:cooking-pot' : g.role === 'storage' ? 'game-icons:locked-chest' : 'game-icons:compass')} />{g.quest && <b className="hud-guide-quest"><Icon name="lucide:circle-alert" /></b>}</span>
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
        <LoadingBackdrop>
          <div className="loader-row">
            <i className="spinner" />
            <span>{tm(state.statusDetail)}</span>
            {state.status === 'loading' && <b>{Math.round(state.loadProgress * 100)}%</b>}
          </div>
          {state.status === 'loading' && (
            <div className="loader-bar" role="progressbar" aria-label={tm(state.statusDetail)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.loadProgress * 100)}>
              <div style={{ width: `${Math.round(state.loadProgress * 100)}%` }} />
            </div>
          )}
        </LoadingBackdrop>
      )}

      {state.status === 'playing' && !state.pointerLocked && !chatOpen && !inventoryOpen && (
        <div className="overlay" onClick={onResume}>
          <div className="overlay-card pause-card">
            <span className="overlay-kicker">ZION // {t('pause.title')}</span>
            <h2>{t('pause.title')}</h2>
            <div className="keys">
              <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> {t('keys.move')} · <kbd>Shift</kbd> {t('keys.sprint')} · <kbd>Space</kbd>{' '}
              {t('keys.jump')} · <kbd>{rollKeyLabel(rollKey)}</kbd> {t('keys.roll')} · <kbd>{rollKeyLabel(proneKey)}</kbd> {t('keys.prone')} · <kbd>X</kbd> ngồi · Chuột phải ở mép tường: tự nghiêng người · <kbd>E</kbd> {t('keys.inventory')} · <kbd>Tab</kbd> đổi súng · <kbd>Wheel</kbd>/<kbd>1</kbd>-<kbd>9</kbd>{' '}
              {t('keys.weapon')}
              <br />
              <kbd>Mouse</kbd> {t('keys.aim')} · <kbd>LMB</kbd> {t('keys.shoot')} · <kbd>RMB</kbd> {t('keys.scope')} · <kbd>R</kbd>{' '}
              {t('keys.reload')} · <kbd>H</kbd> {t('keys.heal')} · <kbd>P</kbd> {t('keys.camera')} · <kbd>Enter</kbd> {t('keys.chat')} · <kbd>Esc</kbd> {t('keys.pause')}
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

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onCameraChange={onResume}>
        {state.status === 'playing' && state.mode === 'survival' && (
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

      {mouseLook && state.status === 'playing' && state.pointerLocked && !inventoryOpen && !state.scoped && state.reticle !== 'dot' && state.reticle !== 'holo' && (
        <div className={`fp-crosshair${state.aiming ? ' is-aiming' : ''}`} aria-hidden>
          <i /><i /><i /><i />
        </div>
      )}
      {state.status === 'playing' && state.ammo && !inventoryOpen && (
        <div className={`hud-ammo${state.ammo.mag === 0 ? ' empty' : state.ammo.mag <= Math.ceil(state.ammo.max * .25) ? ' low' : ''}`} role="status" aria-label={`Đạn ${state.ammo.mag} trên ${state.ammo.reserve}`}>
          <div className="hud-ammo-count"><b>{state.ammo.mag}</b><span>/ {state.ammo.reserve}</span></div>
          <div className="hud-ammo-pips" aria-hidden>{Array.from({ length: Math.min(state.ammo.max, 40) }, (_, i) => <i key={i} className={i < state.ammo!.mag ? 'on' : undefined} />)}</div>
          {state.ammo.reload !== null ? <div className="hud-ammo-reload"><span style={{ transform: `scaleX(${state.ammo.reload})` }} /><small>Đang thay đạn</small></div>
            : state.ammo.mag === 0 ? <small className="hud-ammo-hint">{state.ammo.reserve > 0 ? <><kbd>R</kbd> Thay đạn</> : 'Hết đạn'}</small> : null}
        </div>
      )}

      {state.status === 'dead' && state.mode === 'battle-royale' && state.battle && state.battle.phase !== 'finished' && !resultsClosed && (
        <BattleResults hud={state} onLeave={onLeave} onSpectate={state.spectating ? () => setResultsClosed(true) : undefined} />
      )}
      {state.status === 'dead' && state.mode === 'battle-royale' && state.spectating && resultsClosed && (
        <div className="hud-spectate" role="status">
          <span>Bạn đã bị loại · {state.spectatingKiller ? 'Đang theo dõi người hạ bạn' : 'Đang theo dõi đồng đội'}</span>
          <b>{state.spectating}</b>
          <button className="btn" onClick={onLeave}>Về sảnh</button>
        </div>
      )}
      {state.status === 'dead' && state.mode !== 'infection' && state.mode !== 'battle-royale' && (
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
            <h2>{matchOver ? 'Trận đã kết thúc' : t('hud.disconnected')}</h2>
            {!matchOver && <p>{tm(state.statusDetail)}</p>}
            <div className="overlay-row">
              <button className="btn btn-primary" onClick={() => window.location.reload()}>
                {matchOver ? 'Tìm trận mới' : t('hud.reconnect')}
              </button>
              <button className="btn" onClick={onLeave}>
                {t('hud.main_menu')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
