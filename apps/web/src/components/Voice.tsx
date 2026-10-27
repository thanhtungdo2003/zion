'use client';

import { useEffect } from 'react';
import type { VoiceKind } from '@zion/shared';
import { keyLabel, settingsStore, useSettings } from '@/lib/settings';
import { useVoice, voice } from '@/lib/voice';
import { Icon } from './Icon';

/** The speaker beside a name while that person talks (lobby lists). */
export function SpeakingIcon({ accountId }: { accountId: string }) {
  const v = useVoice();
  const peer = v.peers.find((p) => p.id === accountId);
  const talking = accountId === v.self ? v.speaking : !!peer?.speaking;
  const muted = accountId === v.self ? v.status === 'on' && !v.micOn : !!peer?.muted;
  if (talking) return <span className="voice-speaking" title="Đang nói" aria-label="Đang nói"><Icon name="lucide:volume-2" /></span>;
  if (muted) return <span className="voice-muted" title="Đã tắt micro" aria-label="Đã tắt micro"><Icon name="lucide:mic-off" /></span>;
  return null;
}

/** Push-to-talk: holds the voice key (not while typing). */
export function useVoiceKeys(): void {
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable="true"]');
    const down = (e: KeyboardEvent) => { if (e.code === settingsStore.get().voiceKey && !typing(e)) voice.setTalking(true); };
    const up = (e: KeyboardEvent) => { if (e.code === settingsStore.get().voiceKey) voice.setTalking(false); };
    const blur = () => voice.setTalking(false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
}

/** Join / leave the team's voice, switch the mic: in the team lobbies. */
export function VoiceControls({ kind, disabled }: { kind: VoiceKind; disabled?: boolean }) {
  const v = useVoice();
  const { voicePtt, voiceKey } = useSettings();
  useVoiceKeys();
  const here = v.kind === kind;
  if (!here || v.status === 'off') {
    return <div className="voice-controls">
      <button type="button" className="btn voice-join" disabled={disabled} onClick={() => voice.join(kind)} title="Nói chuyện với đồng đội bằng micro">
        <Icon name="lucide:headphones" /> Vào thoại đội
      </button>
    </div>;
  }
  const label = v.status === 'connecting' ? 'Đang kết nối…' : v.status === 'error' ? v.error ?? 'Lỗi thoại' : voicePtt ? `Giữ ${keyLabel(voiceKey)} để nói` : v.micOn ? 'Micro đang mở' : 'Micro đang tắt';
  return <div className={`voice-controls on${v.speaking ? ' talking' : ''}`}>
    <button type="button" className={`btn voice-mic${v.micOn ? '' : ' off'}`} onClick={() => voice.setMic(!v.micOn)} title={v.micOn ? 'Tắt micro' : 'Bật micro'} aria-pressed={v.micOn}>
      <Icon name={v.micOn ? 'lucide:mic' : 'lucide:mic-off'} />
    </button>
    <span className="voice-state" role="status">{label}{v.status === 'error' && <button type="button" className="voice-retry" onClick={() => voice.join(kind)}>Thử lại</button>}</span>
    <button type="button" className="btn voice-leave" onClick={() => voice.leave()} title="Rời thoại đội"><Icon name="lucide:phone-off" /></button>
  </div>;
}

/** In game: who is on voice, who talks, the mic switch. Shown only after joining in a lobby. */
export function VoiceDock() {
  const v = useVoice();
  const { voicePtt, voiceKey } = useSettings();
  useVoiceKeys();
  if (v.status === 'off') return null;
  return <div className={`voice-dock${v.speaking ? ' talking' : ''}`} aria-label="Thoại đội">
    <button type="button" className={`voice-dock-mic${v.micOn ? '' : ' off'}`} onClick={() => voice.setMic(!v.micOn)} title={v.micOn ? 'Tắt micro' : 'Bật micro'}>
      <Icon name={v.micOn ? 'lucide:mic' : 'lucide:mic-off'} />
      {voicePtt && v.micOn && <kbd>{keyLabel(voiceKey)}</kbd>}
    </button>
    <ul>
      {v.peers.map((p) => <li key={p.id} className={p.speaking ? 'speaking' : ''}>
        <Icon name={p.muted ? 'lucide:mic-off' : p.speaking ? 'lucide:volume-2' : 'lucide:user'} />
        <span>{p.name}</span>
        {!p.connected && <small>…</small>}
      </li>)}
      {v.status !== 'on' && <li className="pending"><small>{v.status === 'connecting' ? 'Đang kết nối…' : v.error}</small></li>}
    </ul>
  </div>;
}
