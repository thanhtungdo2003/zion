import type { WebSocket } from 'ws';
import type { ErrorCode, ServerJsonMessage } from '@zion/shared';
import { TokenBucket } from '../security/rate-limit';
import type { TicketPayload } from '../security/auth-service';
import type { Metrics } from '../metrics';
import type { Player } from './player';

/** Above this many queued bytes, droppable traffic (snapshots) is skipped. */
export const SNAPSHOT_DROP_BYTES = 256 * 1024;
/**
 * Above this, chunk streaming pauses for the connection. Well under the snapshot drop: streaming
 * only fills a link that has room, so snapshots are never dropped to make way for terrain (they
 * were, while running into new ground: the stream kept the queue between the two limits and the
 * game ran at a fraction of its tick rate).
 */
export const STREAM_PAUSE_BYTES = 64 * 1024;
/** A consumer this far behind is disconnected (slow-loris / stalled client protection). */
export const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_STRIKES = 12;

export const CloseCode = {
  Normal: 1000,
  GoingAway: 1001,
  PolicyViolation: 1008,
  InternalError: 1011,
  AuthTimeout: 4001,
  AuthFailed: 4003,
  ProtocolVersion: 4004,
  DuplicateSession: 4005,
  RateLimited: 4008,
  Kicked: 4010,
  SlowConsumer: 4011,
  ServerFull: 4013,
} as const;

export type SessionState = 'authenticating' | 'joining' | 'playing' | 'closed';

export class ClientSession {
  state: SessionState = 'authenticating';
  account: TicketPayload | null = null;
  player: Player | null = null;
  alive = true;
  strikes = 0;
  readonly connectedAt = Date.now();
  /** All inbound messages: ~30 inputs/s plus control traffic. */
  readonly messageBucket = new TokenBucket(50, 90);
  readonly chatBucket = new TokenBucket(0.6, 3);
  readonly pingBucket = new TokenBucket(2, 5);
  lastChat = '';
  lastChatAt = 0;
  /** Battle royale: joined with the squad ("Tiểu đội xuất phát") rather than solo. */
  squad = false;

  constructor(
    readonly id: number,
    readonly ws: WebSocket,
    readonly ip: string,
    private readonly metrics: Metrics,
  ) {}

  get buffered(): number {
    return this.ws.bufferedAmount;
  }

  get open(): boolean {
    return this.state !== 'closed' && this.ws.readyState === this.ws.OPEN;
  }

  sendJson(msg: ServerJsonMessage): void {
    this.sendText(JSON.stringify(msg));
  }

  /** Sends an already-serialised JSON message (broadcasts serialise once for everyone). */
  sendText(text: string): void {
    if (!this.open) return;
    if (this.buffered > MAX_BUFFERED_BYTES) {
      this.close(CloseCode.SlowConsumer, 'slow consumer');
      return;
    }
    this.metrics.bytesOut += text.length;
    this.ws.send(text);
  }

  /** Sends a binary frame; droppable frames are skipped under backpressure. Returns whether sent. */
  sendBinary(data: Uint8Array, droppable: boolean): boolean {
    if (!this.open) return false;
    const buffered = this.buffered;
    if (buffered > MAX_BUFFERED_BYTES) {
      this.close(CloseCode.SlowConsumer, 'slow consumer');
      return false;
    }
    if (droppable && buffered > SNAPSHOT_DROP_BYTES) {
      this.metrics.droppedSnapshots++;
      return false;
    }
    this.metrics.bytesOut += data.byteLength;
    this.ws.send(data, { binary: true });
    return true;
  }

  sendError(code: ErrorCode, message: string, fatal: boolean): void {
    this.sendJson({ t: 'error', code, message, fatal });
  }

  /** Records a protocol violation; returns true when the session was closed because of it. */
  strike(): boolean {
    this.strikes++;
    if (this.strikes >= MAX_STRIKES) {
      this.sendError('invalid_message', 'too many invalid messages', true);
      this.close(CloseCode.PolicyViolation, 'protocol violations');
      return true;
    }
    return false;
  }

  close(code: number, reason: string): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    try {
      this.ws.close(code, reason.slice(0, 120));
    } catch {
      this.ws.terminate();
    }
    // Do not wait forever for a close handshake from a misbehaving peer.
    setTimeout(() => {
      if (this.ws.readyState !== this.ws.CLOSED) this.ws.terminate();
    }, 3000).unref();
  }
}
