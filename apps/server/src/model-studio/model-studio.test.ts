import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import pino from 'pino';
import { buildChunkCollision, createDefaultRegistry, glbTriangles, uploadedMapHitMesh } from '@zion/assets';
import { emptyDoc, exportModel, generateHouse, studioModelAsset, type CatalogAsset, type ModelDoc } from '@zion/assets/model-studio';
import { CharacterController, CollisionWorld, createCharacterState } from '@zion/physics';
import { CHUNK_SIZE, quantizeHeight, quantizeLocal, quantizeRotation, quantizeScale, type ChunkData } from '@zion/shared';
import { ModelAgent } from './agent';
import { LlmClient, parseJsonObject } from './llm';
import { offlinePlan } from './planner';
import type { ModelStudioStore } from './store';
import { WalkingMap } from '../game/navigation';

const registry = createDefaultRegistry();
const catalog: CatalogAsset[] = registry.all().map((a) => ({ id: a.numericId, key: a.id, name: a.name, category: a.category, model: a.model.kind, tags: a.tags, radius: a.bounds.radius, height: a.bounds.height }));
const log = pino({ level: 'silent' });

/** The store as the agent uses it (saves counted, exports not needed). */
function fakeStore() {
  const saves: Array<{ doc: ModelDoc; base: number; note?: string }> = [];
  let version = 1;
  const store = {
    save: async (_id: string, doc: ModelDoc, base: number, opts: { note?: string } = {}) => {
      if (base !== version) throw Object.assign(new Error('conflict'), { statusCode: 409 });
      saves.push({ doc: structuredClone(doc), base, ...(opts.note ? { note: opts.note } : {}) });
      return { version: ++version, updatedAt: '' };
    },
    exportDoc: async (doc: ModelDoc, mode: 'game' | 'editable') => exportModel(doc, { mode, deflate: (b) => new Uint8Array(deflateSync(b)), textureSize: 32 }),
  };
  return { store: store as unknown as ModelStudioStore, saves };
}

async function finish(agent: ModelAgent, id: string) {
  for (let i = 0; i < 600; i++) {
    const job = agent.get(id)!;
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('agent did not finish');
}

describe('model studio agent', () => {
  it('builds a house from a Vietnamese request with the built-in planner, validates and saves a version', async () => {
    const { store, saves } = fakeStore();
    const agent = new ModelAgent(store, null, () => catalog, log);
    const job = agent.start('p1', 'Tạo một căn nhà bỏ hoang sau 200 năm, 2 tầng, có phòng khách, 2 phòng ngủ, nhà bếp, phòng ăn, sân trước, vườn cây và hàng rào', emptyDoc('Nhà'), 1);
    const done = await finish(agent, job.id);
    expect(done.status).toBe('done');
    expect(done.mode).toBe('offline');
    const tools = done.steps.filter((s) => s.kind === 'tool');
    expect(tools.map((s) => s.tool)).toEqual(expect.arrayContaining(['research', 'create_geometry', 'validate_asset', 'auto_fix']));
    expect(tools.every((s) => s.ok)).toBe(true);
    expect(done.doc.kind).toBe('building');
    expect(done.doc.lotClass).toBe('abandoned');
    expect(done.doc.nodes.filter((n) => n.tags?.includes('room')).length).toBeGreaterThanOrEqual(7);
    expect(done.doc.nodes.some((n) => n.kind === 'stairs')).toBe(true);
    expect(saves).toHaveLength(1);
    expect(saves[0]!.note).toContain('AI:');
    expect(done.issues!.filter((i) => !i.startsWith('draw-calls'))).toEqual([]);
  });

  it('plans rocks and kit assemblies, and declines what it cannot do offline', () => {
    expect(offlinePlan('Tạo một tảng đá lớn có hình dạng tự nhiên, bề mặt lởm chởm, nhiều lớp đá', catalog).steps.some((s) => s.tool === 'create_geometry')).toBe(true);
    const kit = offlinePlan('Từ các model tường, cửa, cửa sổ và mái nhà đang có, lắp ghép thành một căn nhà hoàn chỉnh', catalog);
    expect(kit.steps.filter((s) => s.tool === 'assemble_model').length).toBeGreaterThan(0);
    expect(offlinePlan('vẽ một con rồng', catalog).steps).toEqual([]);
  });

  it('runs the language model loop: tool calls, results back, errors reported, done', async () => {
    const replies = [
      { thought: 'Tạo vật liệu và tảng đá.', plan: ['vật liệu', 'đá', 'kiểm tra'], actions: [
        { tool: 'create_or_edit_material', args: { id: 'da', preset: 'rock_granite', texture: { moss: .4 } } },
        { tool: 'create_geometry', args: { type: 'rock', material: 'da', params: { width: 3, height: 2, depth: 2.5, seed: 4 } } },
        { tool: 'no_such_tool', args: {} },
      ] },
      'not json at all',
      { thought: 'Kiểm tra.', actions: [{ tool: 'validate_asset', args: {} }] },
      { thought: 'Xong.', done: true, summary: 'Một tảng đá granite 3 m có rêu.', issues: [] },
    ];
    const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    let turn = 0;
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const r = replies[turn++]!;
      const content = typeof r === 'string' ? r : JSON.stringify(r);
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const llm = new LlmClient({ apiKey: 'test-key-123456', baseUrl: 'http://ai.local/v1', model: 'test-model', timeoutMs: 5000, retries: 1, temperature: .3 }, fetchImpl);
    const { store } = fakeStore();
    const agent = new ModelAgent(store, llm, () => catalog, log);
    const done = await finish(agent, agent.start('p2', 'Tạo một tảng đá lớn có rêu', emptyDoc('Đá', 'rock'), 1).id);
    expect(done.status).toBe('done');
    expect(done.summary).toBe('Một tảng đá granite 3 m có rêu.');
    expect(done.doc.nodes.some((n) => n.kind === 'rock')).toBe(true);
    expect(done.steps.some((s) => s.tool === 'no_such_tool' && !s.ok)).toBe(true);
    expect(done.usage.turns).toBe(4);
    // The tool results went back to the model, the key never into a message.
    expect(bodies[1]!.messages.some((m) => m.content.includes('no_such_tool'))).toBe(true);
    expect(JSON.stringify(bodies)).not.toContain('test-key-123456');
  });

  it('reports AI failures without leaking the key, and retries only what can be retried', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response('bad key test-key-123456', { status: 401 }); }) as unknown as typeof fetch;
    const llm = new LlmClient({ apiKey: 'test-key-123456', baseUrl: 'http://ai.local/v1', model: 'm', timeoutMs: 5000, retries: 3, temperature: .3 }, fetchImpl);
    const { store } = fakeStore();
    const agent = new ModelAgent(store, llm, () => catalog, log);
    const done = await finish(agent, agent.start('p3', 'Tạo một cái ghế', emptyDoc(), 1).id);
    expect(done.status).toBe('failed');
    expect(calls).toBe(1);
    const err = done.steps.find((s) => s.kind === 'error')!.text;
    expect(err).toContain('401');
    expect(err).not.toContain('test-key-123456');
  });

  it('parses JSON from fenced or wrapped answers', () => {
    expect(parseJsonObject('```json\n{"a": 1,}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('Here: {"done": true, "x": "}"} thanks')).toEqual({ done: true, x: '}' });
    expect(parseJsonObject('nothing')).toBeNull();
  });
});

describe('a published house in the game world', () => {
  it('lets a player walk in through the front door, between rooms and up the stairs', () => {
    const doc = emptyDoc('Nhà', 'building');
    const house = generateHouse(doc, { seed: 21, floors: 2, style: 'rural', garden: false, fence: false });
    const out = exportModel(doc, { mode: 'game', deflate: (b) => new Uint8Array(deflateSync(b)), textureSize: 16 });
    const tris = glbTriangles(out.glb, false);
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (const p of t) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c]!, p[c]!); max[c] = Math.max(max[c]!, p[c]!); }
    const reg = createDefaultRegistry();
    const def = reg.registerUploaded(studioModelAsset({ asset: 3005, name: 'Nhà', kind: 'building', min, max, refs: out.refs }));
    // Flat ground at y = 10, the house in the middle of four chunks.
    const ground = 10, hx = 64, hz = 64;
    const world = new CollisionWorld({ worldSize: 4096, seaLevel: 0 });
    world.addHitMesh(3005, uploadedMapHitMesh(out.glb, [0, 0, 0]));
    for (let cz = 0; cz < 4; cz++) for (let cx = 0; cx < 4; cx++) {
      const verts = CHUNK_SIZE + 1, n = verts + 2;
      const chunk: ChunkData = {
        cx, cz, lod: 0, verts, heights: new Uint16Array(n * n).fill(quantizeHeight(ground)), water: new Uint16Array(verts * verts), biome: new Uint8Array(verts * verts), surface: new Uint8Array(verts * verts), temperature: new Uint8Array(verts * verts), humidity: new Uint8Array(verts * verts), cosmeticSeed: 0,
        props: hx >= cx * CHUNK_SIZE && hx < (cx + 1) * CHUNK_SIZE && hz >= cz * CHUNK_SIZE && hz < (cz + 1) * CHUNK_SIZE ? [{ asset: def.numericId, lx: quantizeLocal(hx - cx * CHUNK_SIZE), lz: quantizeLocal(hz - cz * CHUNK_SIZE), yq: quantizeHeight(ground), rot: quantizeRotation(0), scale: quantizeScale(1), group: 0 }] : [],
      };
      const c = buildChunkCollision(chunk, reg);
      world.addChunk(cx, cz, c.heightfield, c.colliders);
    }
    const map = new WalkingMap(world);
    const roomAt = (type: string, floor: number) => house.rooms.find((r) => r.type === type && r.floor === floor)!;
    const front = doc.nodes.find((n) => n.kind === 'wall' && n.name === 'Tường trước')!;
    const door = front.kind === 'wall' ? front.openings.find((o) => o.kind === 'door')! : null;
    const outside = { x: hx + door!.offset, z: hz + house.footprint.depth / 2 + 1.6, y: ground + .02 };
    const hall = roomAt('hall', 0);
    const inside = { x: hx + door!.offset, z: hz + hall.z1 - .8, y: ground + .15 + .02 };
    expect(map.reaches(outside, inside)).toBe(true);
    // Walls are solid: straight through the front wall beside the door is blocked.
    expect(map.reaches({ ...outside, x: outside.x + 2.5 }, { ...inside, x: inside.x + 2.5 })).toBe(false);
    // To the stairs at the back of the hall and up the flight onto the landing upstairs.
    const stairs = doc.nodes.find((n) => n.kind === 'stairs')!;
    if (stairs.kind !== 'stairs') throw new Error('no stairs');
    const sx = hx + stairs.transform.position[0], sz = hz + stairs.transform.position[2];
    const bottom = { x: sx - .45, z: sz, y: ground + .15 + .02 };
    const top = { x: sx + stairs.run + .6, z: sz, y: ground + .15 + stairs.rise + .02 };
    // Along the hall to the foot of the flight, then turn onto it.
    const foot = { x: bottom.x, z: inside.z, y: inside.y };
    expect(map.reaches(inside, foot)).toBe(true);
    expect(map.reaches(foot, bottom)).toBe(true);
    // A player (the movement controller) walks the same way and climbs the flight to the upper floor.
    const ctrl = new CharacterController(world), st = createCharacterState(outside.x, outside.y, outside.z);
    st.grounded = true;
    const go = (yaw: number, until: () => boolean, max = 300) => { for (let i = 0; i < max && !until(); i++) ctrl.step(st, { mx: 0, mz: 1, yaw, jump: false, sprint: false }, 1 / 30); };
    go(0, () => st.z <= inside.z);
    expect(st.z).toBeLessThanOrEqual(inside.z + .05);
    go(Math.PI / 2, () => st.x <= foot.x);
    go(0, () => st.z <= bottom.z);
    go(-Math.PI / 2, () => st.x >= top.x - .1);
    expect(st.x).toBeGreaterThan(top.x - .3);
    expect(st.y).toBeCloseTo(top.y - .02, 1);
  });
});
