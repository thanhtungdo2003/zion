/**
 * Team voice (WebRTC mesh, at most four people): the server only introduces the members of one
 * team to each other and relays their connection offers; the audio goes peer to peer (or through
 * the TURN relay when a network blocks direct connections).
 */
/** Which team list a voice room belongs to (the same lobbies as `/api/teams?mode=`). */
export type VoiceKind = 'survival' | 'battle-royale' | 'waves' | 'warfare';
export const VOICE_KINDS: readonly VoiceKind[] = ['survival', 'battle-royale', 'waves', 'warfare'];
export const VOICE_PATH = '/voice';
/** Largest relayed message (an SDP offer with its candidates fits comfortably). */
export const VOICE_MAX_MESSAGE = 16 * 1024;

export interface VoicePeer { id: string; name: string; speaking: boolean; muted: boolean }
export interface VoiceIceServer { urls: string | string[]; username?: string; credential?: string }

export type VoiceSignal =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

export type VoiceClientMessage =
  | { t: 'hello'; ticket: string; kind: VoiceKind }
  | { t: 'signal'; to: string; data: VoiceSignal }
  | { t: 'speaking'; on: boolean }
  | { t: 'muted'; on: boolean };

export type VoiceServerMessage =
  /** Joined: who you are, the members already in the room, the ICE servers to use. */
  | { t: 'welcome'; self: string; team: string; peers: VoicePeer[]; ice: VoiceIceServer[] }
  | { t: 'join'; peer: VoicePeer }
  | { t: 'leave'; id: string }
  | { t: 'signal'; from: string; data: VoiceSignal }
  | { t: 'speaking'; id: string; on: boolean }
  | { t: 'muted'; id: string; on: boolean }
  /** Fatal: not in a team of that kind, bad ticket… The socket closes after it. */
  | { t: 'error'; code: 'auth' | 'no_team' | 'full' | 'bad_message'; message: string };

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Parses and bounds a client message; null when it is not one. */
export function parseVoiceClientMessage(raw: string): VoiceClientMessage | null {
  if (raw.length > VOICE_MAX_MESSAGE) return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'hello': return isStr(o.ticket, 512) && VOICE_KINDS.includes(o.kind as VoiceKind) ? { t: 'hello', ticket: o.ticket, kind: o.kind as VoiceKind } : null;
    case 'speaking': case 'muted': return typeof o.on === 'boolean' ? { t: o.t, on: o.on } : null;
    case 'signal': {
      const d = o.data as Record<string, unknown> | undefined;
      if (!isStr(o.to, 64) || !d || typeof d !== 'object') return null;
      if ((d.kind === 'offer' || d.kind === 'answer') && isStr(d.sdp, VOICE_MAX_MESSAGE)) return { t: 'signal', to: o.to, data: { kind: d.kind, sdp: d.sdp } };
      if (d.kind === 'candidate' && isStr(d.candidate, 1024) && (d.sdpMid === null || isStr(d.sdpMid, 64)) && (d.sdpMLineIndex === null || (Number.isInteger(d.sdpMLineIndex) && (d.sdpMLineIndex as number) >= 0 && (d.sdpMLineIndex as number) < 16))) {
        return { t: 'signal', to: o.to, data: { kind: 'candidate', candidate: d.candidate, sdpMid: d.sdpMid as string | null, sdpMLineIndex: d.sdpMLineIndex as number | null } };
      }
      return null;
    }
    default: return null;
  }
}
