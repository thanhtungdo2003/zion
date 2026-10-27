'use client';

import { useSyncExternalStore } from 'react';
import { VOICE_PATH, type VoiceIceServer, type VoiceKind, type VoiceServerMessage, type VoiceSignal } from '@zion/shared';
import { getGameTicket } from './api';
import { settingsStore } from './settings';

/**
 * Team voice on this client: one room at a time (the team of the lobby you are in), a WebRTC
 * connection to each teammate, the microphone's own loudness deciding when you are speaking.
 * The server never carries the audio; it introduces teammates and relays connection offers.
 */
export interface VoiceMember { id: string; name: string; speaking: boolean; muted: boolean; connected: boolean; silenced: boolean }
export interface VoiceState {
  kind: VoiceKind | null;
  status: 'off' | 'connecting' | 'on' | 'error';
  error: string | null;
  self: string | null;
  micOn: boolean;
  speaking: boolean;
  /** Push-to-talk key held. */
  talking: boolean;
  peers: VoiceMember[];
}

interface Peer {
  id: string; name: string; pc: RTCPeerConnection; audio: HTMLAudioElement;
  speaking: boolean; muted: boolean; silenced: boolean;
  /** Perfect negotiation: the polite side yields when offers collide. */
  polite: boolean; makingOffer: boolean; ignoreOffer: boolean;
}

/** Loudness (RMS of the speech band) that counts as talking, and how long it lingers after. */
const SPEAK_ON = .02;
const SPEAK_OFF = .012;
const HANGOVER_MS = 350;
const RECONNECT_MS = 3000;

let state: VoiceState = { kind: null, status: 'off', error: null, self: null, micOn: true, speaking: false, talking: false, peers: [] };
const listeners = new Set<() => void>();
const emit = (patch: Partial<VoiceState>) => { state = { ...state, ...patch }; for (const l of listeners) l(); };

let ws: WebSocket | null = null;
let ice: VoiceIceServer[] = [];
let mic: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let meter: number | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
const peers = new Map<string, Peer>();

const MESSAGES: Record<string, string> = {
  no_team: 'Bạn chưa ở trong đội.', auth: 'Phiên đăng nhập hết hạn, hãy tải lại trang.', full: 'Phòng thoại đã đầy.', bad_message: 'Lỗi kết nối thoại.',
};

function publishPeers(): void {
  emit({ peers: [...peers.values()].map((p) => ({ id: p.id, name: p.name, speaking: p.speaking && !p.muted, muted: p.muted, silenced: p.silenced, connected: p.pc.connectionState === 'connected' })) });
}

function send(msg: unknown): void { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

/** Whether the microphone currently goes out: switched on, and (push-to-talk) the key held. */
function transmitting(): boolean { return state.micOn && (!settingsStore.get().voicePtt || state.talking); }

function applyTransmit(): void {
  const on = transmitting();
  for (const t of mic?.getAudioTracks() ?? []) t.enabled = on;
  if (!on && state.speaking) { emit({ speaking: false }); send({ t: 'speaking', on: false }); }
}

async function openMic(): Promise<void> {
  if (mic) return;
  mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  audioCtx ??= new AudioContext();
  const source = audioCtx.createMediaStreamSource(mic);
  // Speech band only: rumble and hiss do not count as talking.
  const hp = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
  const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
  const analyser = audioCtx.createAnalyser(); analyser.fftSize = 1024;
  source.connect(hp).connect(lp).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let lastLoud = 0;
  meter = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const rms = Math.sqrt(sum / buf.length), now = performance.now();
    if (rms > (state.speaking ? SPEAK_OFF : SPEAK_ON)) lastLoud = now;
    const speaking = transmitting() && now - lastLoud < HANGOVER_MS;
    if (speaking !== state.speaking) { emit({ speaking }); send({ t: 'speaking', on: speaking }); }
  }, 60);
  applyTransmit();
}

function closePeer(id: string): void {
  const p = peers.get(id);
  if (!p) return;
  p.pc.close(); p.audio.srcObject = null; p.audio.remove();
  peers.delete(id);
  publishPeers();
}

function addPeer(id: string, name: string, speaking: boolean, muted: boolean): Peer {
  closePeer(id);
  const pc = new RTCPeerConnection({ iceServers: ice });
  const audio = document.createElement('audio');
  audio.autoplay = true; audio.volume = settingsStore.get().voiceVolume;
  document.body.appendChild(audio);
  const p: Peer = { id, name, pc, audio, speaking, muted, silenced: false, polite: (state.self ?? '') < id, makingOffer: false, ignoreOffer: false };
  peers.set(id, p);
  for (const t of mic?.getAudioTracks() ?? []) pc.addTrack(t, mic!);
  if (!mic) pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = (e) => { audio.srcObject = e.streams[0] ?? new MediaStream([e.track]); void audio.play().catch(() => undefined); };
  pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'signal', to: id, data: { kind: 'candidate', candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } }); };
  pc.onnegotiationneeded = async () => {
    try {
      p.makingOffer = true;
      await pc.setLocalDescription();
      send({ t: 'signal', to: id, data: { kind: 'offer', sdp: pc.localDescription!.sdp } });
    } catch { /* the next negotiation retries */ } finally { p.makingOffer = false; }
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce(); publishPeers(); };
  publishPeers();
  return p;
}

async function onSignal(from: string, data: VoiceSignal): Promise<void> {
  const p = peers.get(from);
  if (!p) return;
  const pc = p.pc;
  try {
    if (data.kind === 'candidate') {
      try { await pc.addIceCandidate({ candidate: data.candidate, sdpMid: data.sdpMid, sdpMLineIndex: data.sdpMLineIndex }); }
      catch (err) { if (!p.ignoreOffer) throw err; }
      return;
    }
    const collision = data.kind === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
    p.ignoreOffer = !p.polite && collision;
    if (p.ignoreOffer) return;
    await pc.setRemoteDescription({ type: data.kind, sdp: data.sdp });
    if (data.kind === 'offer') {
      await pc.setLocalDescription();
      send({ t: 'signal', to: from, data: { kind: 'answer', sdp: pc.localDescription!.sdp } });
    }
  } catch (err) { console.warn('voice negotiation', err); }
}

function onMessage(m: VoiceServerMessage): void {
  switch (m.t) {
    case 'welcome':
      ice = m.ice;
      emit({ status: 'on', error: null, self: m.self });
      // Newcomers call those already in the room (they answer).
      for (const peer of m.peers) addPeer(peer.id, peer.name, peer.speaking, peer.muted);
      send({ t: 'muted', on: !state.micOn });
      break;
    case 'join': addPeer(m.peer.id, m.peer.name, m.peer.speaking, m.peer.muted); break;
    case 'leave': closePeer(m.id); break;
    case 'signal': void onSignal(m.from, m.data); break;
    case 'speaking': case 'muted': {
      const p = peers.get(m.id);
      if (!p) return;
      if (m.t === 'speaking') p.speaking = m.on; else { p.muted = m.on; if (m.on) p.speaking = false; }
      publishPeers();
      break;
    }
    case 'error':
      emit({ status: 'error', error: MESSAGES[m.code] ?? m.message });
      if (m.code === 'no_team' || m.code === 'auth') { const kind = state.kind; teardown(); emit({ kind, status: 'error' }); }
      break;
  }
}

function teardown(): void {
  if (retry) { clearTimeout(retry); retry = null; }
  const socket = ws; ws = null;
  socket?.close();
  for (const id of [...peers.keys()]) closePeer(id);
}

async function connect(kind: VoiceKind): Promise<void> {
  teardown();
  emit({ kind, status: 'connecting', error: null });
  try { await openMic(); }
  catch { emit({ micOn: false, error: 'Không dùng được micro: bạn vẫn nghe được đồng đội.' }); }
  let url: URL;
  try {
    const t = await getGameTicket();
    url = new URL(t.wsUrl); url.pathname = VOICE_PATH; url.search = '';
    if (state.kind !== kind) return;
    const socket = new WebSocket(url.toString());
    ws = socket;
    socket.onopen = () => socket.send(JSON.stringify({ t: 'hello', ticket: t.ticket, kind }));
    socket.onmessage = (e) => { if (ws === socket) { try { onMessage(JSON.parse(String(e.data)) as VoiceServerMessage); } catch { /* ignore */ } } };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      for (const id of [...peers.keys()]) closePeer(id);
      // Dropped (not left): come back.
      if (state.kind === kind && state.status !== 'error') { emit({ status: 'connecting' }); retry = setTimeout(() => void connect(kind), RECONNECT_MS); }
    };
  } catch {
    emit({ status: 'error', error: 'Không kết nối được thoại.' });
    if (state.kind === kind) retry = setTimeout(() => void connect(kind), RECONNECT_MS * 2);
  }
}

export const voice = {
  get: () => state,
  subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); },
  /** Joins the voice room of your team in that lobby (no-op when already there). */
  join(kind: VoiceKind): void { if (state.kind === kind && state.status !== 'error') return; void connect(kind); },
  leave(): void {
    teardown();
    if (meter !== null) { clearInterval(meter); meter = null; }
    for (const t of mic?.getTracks() ?? []) t.stop();
    mic = null;
    emit({ kind: null, status: 'off', error: null, speaking: false, peers: [] });
  },
  setMic(on: boolean): void { emit({ micOn: on }); applyTransmit(); send({ t: 'muted', on: !on }); },
  /** Push-to-talk key down/up. */
  setTalking(on: boolean): void { if (state.talking === on) return; emit({ talking: on }); applyTransmit(); },
  /** Silences one teammate for you only. */
  silence(id: string, on: boolean): void { const p = peers.get(id); if (!p) return; p.silenced = on; p.audio.muted = on; publishPeers(); },
  /** Names of the teammates talking now. */
  speakingNames(): Set<string> {
    const out = new Set<string>();
    for (const p of peers.values()) if (p.speaking && !p.muted) out.add(p.name);
    return out;
  },
};

// Teammates' loudness and push-to-talk follow the settings.
settingsStore.subscribe(() => {
  const v = settingsStore.get().voiceVolume;
  for (const p of peers.values()) p.audio.volume = v;
  applyTransmit();
});

export function useVoice(): VoiceState {
  return useSyncExternalStore(voice.subscribe, voice.get, voice.get);
}
