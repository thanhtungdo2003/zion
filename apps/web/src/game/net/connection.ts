import {
  type InvMessage,
  BinaryMessageType,
  PROTOCOL_VERSION,
  decodeChunkBody,
  decodeChunkMessage,
  decodeChunkUnload,
  decodeSnapshot,
  type ChunkData,
  type InputMessage,
  type ServerJsonMessage,
  type Snapshot,
  type WelcomeMessage,
} from '@zion/shared';
import { getGameTicket } from '@/lib/api';

export interface ConnectionHandlers {
  onWelcome(msg: WelcomeMessage): void;
  onSnapshot(snap: Snapshot): void;
  onChunk(chunk: ChunkData): void;
  onUnload(chunks: Array<[number, number]>): void;
  onMessage(msg: ServerJsonMessage): void;
  onClose(info: { code: number; reason: string; fatal: boolean; message?: string }): void;
}

/** Bytes of unsent data above which the client stops queueing inputs (server is backed up). */
const MAX_CLIENT_BUFFER = 64 * 1024;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * WebSocket client. Authenticates with a single-use ticket, decodes binary frames, and applies
 * chunk loads/unloads strictly in arrival order (decoding is async, so a serial queue prevents
 * an unload from overtaking the load it refers to).
 */
export class GameConnection {
  private ws: WebSocket | null = null;
  private chain: Promise<void> = Promise.resolve();
  private closedByUser = false;
  private lastError: { message: string; fatal: boolean } | null = null;
  private pingId = 0;
  bytesIn = 0;

  constructor(private readonly handlers: ConnectionHandlers) {}

  async connect(): Promise<void> {
    const t = await getGameTicket();
    if (t.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`client protocol ${PROTOCOL_VERSION} does not match server ${t.protocolVersion}; reload the page`);
    }
    if (this.closedByUser) return;
    const ws = new WebSocket(t.wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', v: PROTOCOL_VERSION, ticket: t.ticket }));
    ws.onmessage = (ev: MessageEvent<ArrayBuffer | string>) => this.onFrame(ev.data);
    ws.onclose = (ev) => {
      this.ws = null;
      this.handlers.onClose({
        code: ev.code,
        reason: ev.reason,
        fatal: this.lastError?.fatal ?? !this.closedByUser,
        message: this.lastError?.message,
      });
    };
  }

  private onFrame(data: ArrayBuffer | string): void {
    if (typeof data === 'string') {
      this.bytesIn += data.length;
      let msg: ServerJsonMessage;
      try {
        msg = JSON.parse(data) as ServerJsonMessage;
      } catch {
        return;
      }
      if (msg.t === 'welcome') this.handlers.onWelcome(msg);
      else {
        if (msg.t === 'error') this.lastError = { message: msg.message, fatal: msg.fatal };
        this.handlers.onMessage(msg);
      }
      return;
    }
    this.bytesIn += data.byteLength;
    const bytes = new Uint8Array(data);
    const type = bytes[0];
    if (type === BinaryMessageType.Snapshot) {
      try {
        this.handlers.onSnapshot(decodeSnapshot(bytes));
      } catch (err) {
        console.error('bad snapshot', err);
      }
      return;
    }
    if (type === BinaryMessageType.Chunk) {
      const { header, body } = decodeChunkMessage(bytes);
      const pending = inflateRaw(body);
      this.chain = this.chain
        .then(async () => {
          const chunk = decodeChunkBody(await pending, header.cx, header.cz, header.lod);
          this.handlers.onChunk(chunk);
        })
        .catch((err: unknown) => console.error('chunk decode failed', err));
      return;
    }
    if (type === BinaryMessageType.ChunkUnload) {
      const { chunks } = decodeChunkUnload(bytes);
      this.chain = this.chain.then(() => this.handlers.onUnload(chunks));
    }
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(obj: unknown): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_CLIENT_BUFFER) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  sendQuest(op: 'accept' | 'cancel' | 'turnin' | 'retrieve', npc: string, quest: string, index?: number): void {
    this.send({ t: 'quest', op, npc, quest, ...(index !== undefined ? { index } : {}) });
  }

  sendLife(op: 'plant' | 'harvest' | 'cook' | 'buy' | 'sell' | 'eat' | 'loot', target: string, choice?: string, uid?: number): void {
    this.send({ t: 'life', op, target, choice, uid });
  }

  sendInput(input: InputMessage): boolean {
    return this.send(input);
  }

  sendPing(): void {
    this.send({ t: 'ping', id: ++this.pingId, ct: performance.now() });
  }

  sendChat(text: string): void {
    this.send({ t: 'chat', text: text.slice(0, 200) });
  }

  /** Shop trade request (buy / sell one item); the answer is a 'wallet' message. */
  sendTrade(msg: { t: 'buy'; req: number; item: string } | { t: 'sell'; req: number; uid: number }): void {
    this.send(msg);
  }

  sendNurseHeal(req: number): void {
    this.send({ t: 'nurseheal', req });
  }

  sendArmor(a: { head: number; chest: number; legs: number; feet: number }): void {
    this.send({ t: 'armor', ...a });
  }

  sendHeal(uid: number): void {
    this.send({ t: 'heal', uid });
  }

  sendInv(msg: InvMessage): void {
    this.send(msg);
  }

  sendReload(): void {
    this.send({ t: 'reload' });
  }

  sendDevCoins(): void {
    this.send({ t: 'devcoins' });
  }

  sendRespawn(): void {
    this.send({ t: 'respawn' });
  }

  sendSetTime(tod: number): void {
    this.send({ t: 'settime', tod: Math.min(1, Math.max(0, tod)) });
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close(1000, 'client closed');
  }
}
