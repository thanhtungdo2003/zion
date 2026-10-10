/**
 * End-to-end smoke test against a running server:
 *   guest login → WS ticket → authenticate → welcome → chunk stream → walk forward → verify the
 *   authoritative position moved, then check a few security behaviours (replayed ticket,
 *   malformed input, forbidden origin).
 *
 *   pnpm --filter @zion/server smoke [-- --api http://localhost:4000]
 */
import {
  BinaryMessageType,
  PROTOCOL_VERSION,
  decodeChunkMessage,
  decodeSnapshot,
  type ServerJsonMessage,
  type Snapshot,
} from '@zion/shared';
import WebSocket from 'ws';

const api = process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1]! : 'http://localhost:4000';
const origin = 'http://localhost:3000';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

async function post<T>(path: string, token?: string, body: Record<string, unknown> = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

const guest = await post<{ accessToken: string; account: { username: string } }>('/api/auth/guest', undefined, { username: `Smoke_${Date.now().toString(36)}` });
assert(guest.status === 200 && guest.body.accessToken, `guest session for ${guest.body.account?.username}`);
const ticket = await post<{ ticket: string; wsUrl: string }>('/api/game/ticket', guest.body.accessToken);
assert(ticket.status === 200 && ticket.body.ticket.length === 43, 'websocket ticket issued');
const unauth = await post('/api/game/ticket');
assert(unauth.status === 401, 'ticket endpoint rejects anonymous requests');

const ws = new WebSocket(ticket.body.wsUrl, { headers: { origin } });
ws.binaryType = 'arraybuffer';
let welcome: Extract<ServerJsonMessage, { t: 'welcome' }> | null = null;
let chunks = 0;
let lod0 = 0;
let last: Snapshot | null = null;
const errors: string[] = [];

ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', v: PROTOCOL_VERSION, ticket: ticket.body.ticket }));
ws.on('message', (data: ArrayBuffer | Buffer, isBinary: boolean) => {
  if (!isBinary) {
    const m = JSON.parse(data.toString()) as ServerJsonMessage;
    if (m.t === 'welcome') welcome = m;
    if (m.t === 'error') errors.push(`${m.code}: ${m.message}`);
    return;
  }
  const b = new Uint8Array(data as ArrayBuffer);
  if (b[0] === BinaryMessageType.Chunk) {
    chunks++;
    if (decodeChunkMessage(b).header.lod === 0) lod0++;
  } else if (b[0] === BinaryMessageType.Snapshot) last = decodeSnapshot(b);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !welcome; i++) await sleep(100);
assert(welcome, 'received welcome');
const w = welcome as Extract<ServerJsonMessage, { t: 'welcome' }>;
console.log(`  spawn at (${w.spawn.x.toFixed(1)}, ${w.spawn.y.toFixed(1)}, ${w.spawn.z.toFixed(1)}), world ${w.world.sizeChunks} chunks`);
for (let i = 0; i < 80 && lod0 < 49; i++) await sleep(100);
assert(lod0 >= 49, `streamed ${chunks} chunks (${lod0} at LOD 0)`);
assert(last !== null, 'receiving snapshots');

const start = { ...(last as Snapshot).self };
let seq = 0;
for (let i = 0; i < 60; i++) {
  ws.send(JSON.stringify({ t: 'in', s: ++seq, mx: 0, mz: 1, yaw: 0.3, pitch: 0, b: 0 }));
  await sleep(1000 / 30);
}
await sleep(300);
const end = (last as Snapshot).self;
const moved = Math.hypot(end.x - start.x, end.z - start.z);
assert(moved > 1.5 && moved < 8, `server moved player ${moved.toFixed(2)} m in ~2 s of input`);
assert((last as Snapshot).ackSeq === seq, `server acknowledged input seq ${seq}`);
assert(Math.abs(end.y - start.y) < 30, 'player stayed on the terrain');

// Replay: re-sending an old sequence number must not move the player.
ws.send(JSON.stringify({ t: 'in', s: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, b: 0 }));
// Malformed: teleport attempt is not part of the protocol.
ws.send(JSON.stringify({ t: 'in', s: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, b: 0, x: 9999 }));
await sleep(300);
assert(Math.hypot((last as Snapshot).self.x - end.x, (last as Snapshot).self.z - end.z) < 0.5, 'replayed / malformed inputs ignored');

// A consumed ticket cannot be reused.
const ws2 = new WebSocket(ticket.body.wsUrl, { headers: { origin } });
const reuse = await new Promise<number>((resolve) => {
  ws2.onopen = () => ws2.send(JSON.stringify({ t: 'auth', v: PROTOCOL_VERSION, ticket: ticket.body.ticket }));
  ws2.onclose = (e) => resolve(e.code);
});
assert(reuse === 4003, `reused ticket rejected (close ${reuse})`);

// Upgrades from a foreign origin are refused before the WebSocket handshake.
const ws3 = new WebSocket(ticket.body.wsUrl, { headers: { origin: 'https://evil.example' } });
const foreign = await new Promise<string>((resolve) => {
  ws3.onopen = () => resolve('open');
  ws3.onerror = () => resolve('refused');
});
assert(foreign === 'refused', 'foreign origin refused');

ws.close();
assert(errors.length === 0 || errors.every((e) => !e.startsWith('kicked')), `no fatal errors (${errors.join('; ') || 'none'})`);
console.log('smoke test passed');
process.exit(0);
