import {
  type InvMessage,
  type ClientMessage,
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
  type GameMode,
  type BuildMessage,
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

  constructor(private readonly handlers: ConnectionHandlers, private readonly mode: GameMode = 'survival') {}

  async connect(): Promise<void> {
    const t = await getGameTicket();
    if (t.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`client protocol ${PROTOCOL_VERSION} does not match server ${t.protocolVersion}; reload the page`);
    }
    if (this.closedByUser) return;
    const url = new URL(t.wsUrl);
    if (this.mode === 'infection') url.searchParams.set('mode', this.mode);
    if (this.mode === 'battle-royale') {
      url.searchParams.set('mode', this.mode);
      // Dropped in with the squad ("Tiểu đội xuất phát") rather than solo.
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('squad') === '1') url.searchParams.set('squad', '1');
    }
    const ws = new WebSocket(url.toString());
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
    if (this.closedByUser) return;
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
      this.chain = this.chain
        .then(async () => {
          if (this.closedByUser) return;
          const inflated = await inflateRaw(body);
          if (this.closedByUser) return;
          const chunk = decodeChunkBody(inflated, header.cx, header.cz, header.lod);
          this.handlers.onChunk(chunk);
        })
        .catch((err: unknown) => console.error('chunk decode failed', err));
      return;
    }
    if (type === BinaryMessageType.ChunkUnload) {
      const { chunks } = decodeChunkUnload(bytes);
      this.chain = this.chain.then(() => { if (!this.closedByUser) this.handlers.onUnload(chunks); });
    }
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Map loaded: enter matchmaking (battle royale, infection). */
  sendReady(): void { this.send({ t: 'ready' }); }

  private send(obj: unknown): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_CLIENT_BUFFER) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  sendQuest(op: 'accept' | 'cancel' | 'turnin' | 'retrieve', npc: string, quest: string, index?: number): void {
    this.send({ t: 'quest', op, npc, quest, ...(index !== undefined ? { index } : {}) });
  }

  sendLife(op: 'plant' | 'harvest' | 'cook' | 'buy' | 'sell' | 'eat' | 'loot' | 'ignite', target: string, choice?: string, uid?: number): void {
    this.send({ t: 'life', op, target, choice, uid });
  }

  sendInput(input: InputMessage): boolean {
    return this.send(input);
  }

  sendPing(): void {
    this.send({ t: 'ping', id: ++this.pingId, ct: performance.now() });
  }

  sendChat(text: string, channel: 'world' | 'team' = 'world'): void {
    this.send({ t: 'chat', text: text.slice(0, 200), channel });
  }

  sendPvp(enabled: boolean): void { this.send({ t: 'pvp', enabled }); }

  sendTutorial(message: Extract<ClientMessage, { t: 'tutorial' }>): void { this.send(message); }

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

  /** Battle royale automatic jump point (negative = clear). */
  sendJumpPoint(x: number, z: number): void {
    this.send({ t: 'jumppoint', x: Math.round(x), z: Math.round(z) });
  }

  /** Infection: weapons to carry in the next life. */
  sendLoadout(loadout: { primary: string; secondary: string; melee: string }): void {
    this.send({ t: 'loadout', ...loadout });
  }

  sendHeal(uid: number): void {
    this.send({ t: 'heal', uid });
  }

  sendInv(msg: InvMessage): void {
    this.send(msg);
  }

  /** Base building (place, craft, logs, doors, architect, supply orders). */
  sendBuild(msg: BuildMessage): void {
    this.send(msg);
  }

  /** Downed: call for help / give up. Alive: revive a downed player. */
  sendDistress(): void {
    this.send({ t: 'distress' });
  }

  sendGiveUp(): void {
    this.send({ t: 'giveup' });
  }

  sendRevive(id: number): void {
    this.send({ t: 'revive', id });
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
  sendVehicle(id?: number): void { this.send({ t: 'vehicle', id }); }
  sendDoor(id: number): void { this.send({ t: 'door', id }); }

  sendSetTime(tod: number): void {
    this.send({ t: 'settime', tod: Math.min(1, Math.max(0, tod)) });
  }

  close(): void {
    this.closedByUser = true;
    if (this.ws) this.ws.onmessage = null;
    this.ws?.close(1000, 'client closed');
  }
}
