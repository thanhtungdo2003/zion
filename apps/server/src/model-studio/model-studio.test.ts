import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import pino from 'pino';
import { buildChunkCollision, createDefaultRegistry, glbTriangles, uploadedMapHitMesh } from '@zion/assets';
import { emptyDoc, exportModel, generateHouse, studioModelAsset, type CatalogAsset, type ModelDoc } from '@zion/assets/model-studio';
import { CharacterController, CollisionWorld, createCharacterState } from '@zion/physics';
import { CHUNK_SIZE, quantizeHeight, quantizeLocal, quantizeRotation, quantizeScale, type ChunkData } from '@zion/shared';
import { ModelAgent, missingParts } from './agent';
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
    // A refused key stops the AI at once, but the job still ends normally (nothing is thrown away).
    expect(done.status).toBe('done');
    expect(calls).toBe(1);
    const why = done.steps.find((s) => s.text.includes('Tự dừng'))!.text;
    expect(why).toContain('401');
    expect(JSON.stringify(done)).not.toContain('test-key-123456');
  });

  it('keeps working through empty and broken AI answers, and keeps what it built', async () => {
    // Turn 1 builds a rock; then the AI answers empty, garbage, empty; then it finishes.
    const replies: Array<string | object> = [
      { thought: 'Đá trước.', actions: [{ tool: 'create_geometry', args: { type: 'rock', params: { width: 2, height: 1.5, depth: 2, seed: 3 } } }] },
      '', 'blah', '',
      { thought: 'Xong.', done: true, summary: 'Một tảng đá.' },
    ];
    let turn = 0;
    const fetchImpl = (async () => {
      const r = replies[turn++] ?? '';
      return new Response(JSON.stringify({ choices: [{ message: { content: typeof r === 'string' ? r : JSON.stringify(r) } }] }), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const llm = new LlmClient({ apiKey: 'k-12345678', baseUrl: 'http://ai.local/v1', model: 'm', timeoutMs: 5000, retries: 1, temperature: .3 }, fetchImpl);
    const { store, saves } = fakeStore();
    const agent = new ModelAgent(store, llm, () => catalog, log, 1);
    const done = await finish(agent, agent.start('p4', 'Tạo một tảng đá', emptyDoc(), 1).id);
    expect(done.status).toBe('done');
    expect(done.summary).toBe('Một tảng đá.');
    expect(done.steps.filter((s) => s.text.includes('thử lại')).length).toBe(2);
    expect(done.doc.nodes.some((n) => n.kind === 'rock')).toBe(true);
    expect(saves).toHaveLength(1);
  });

  it('gets past the provider safety filter: neutral tool output, a rephrased conversation, then another model', async () => {
    const seen: Array<{ model: string; text: string }> = [];
    let turn = 0;
    const sse = (body: object) => new Response(`data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const req = JSON.parse(init.body) as { model: string; messages: Array<{ content: string }> };
      seen.push({ model: req.model, text: req.messages.at(-1)!.content });
      turn++;
      if (turn === 1) return sse({ choices: [{ delta: { content: JSON.stringify({ thought: 'Tìm.', actions: [{ tool: 'search_assets', args: { query: 'weapon ammo military' } }] }) } }] });
      // The old model is filtered whatever it is asked; the other one answers.
      if (req.model === 'old') return sse({ choices: [{ delta: {}, finish_reason: 'content_filter', content_filter_results: { violence: { filtered: true, severity: 'medium' } } }] });
      return sse({ choices: [{ delta: { content: JSON.stringify({ thought: 'Xong.', done: true, summary: 'ok' }) } }] });
    }) as unknown as typeof fetch;
    const llm = new LlmClient({ apiKey: 'k-12345678', baseUrl: 'http://ai.local/v1', model: 'old', timeoutMs: 5000, retries: 3, temperature: .3 }, fetchImpl);
    const { store } = fakeStore();
    const agent = new ModelAgent(store, llm, () => catalog, log, 1, () => ['other']);
    const done = await finish(agent, agent.start('p6', 'Tạo chung cư 5 tầng', emptyDoc(), 1).id);
    expect(done.status).toBe('done');
    expect(done.summary).toBe('ok');
    // The search results (the last message of turn 2) reached the model without the trigger words.
    expect(seen[1]!.text).not.toMatch(/weapon|ammo|military/i);
    expect(done.steps.find((x) => x.tool === 'search_assets')!.result).toBeDefined();
    const notes = done.steps.filter((x) => x.text.includes('Bộ lọc an toàn')).map((x) => x.text);
    expect(notes[0]).toContain('violence');
    expect(notes[0]).toContain('diễn đạt lại');
    expect(notes[1]).toContain('chuyển sang model other');
    expect(seen.at(-1)!.model).toBe('other');
    // A filtered answer is not retried as is inside the client.
    expect(seen.filter((x) => x.model === 'old')).toHaveLength(3);
  });

  it('stops a runaway loop by itself and saves the work so far', async () => {
    // The model keeps asking for the very same edit.
    const same = { thought: 'Lại.', actions: [{ tool: 'create_geometry', args: { type: 'primitive', params: { shape: 'box', width: 1, height: 1, depth: 1 } } }] };
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(same) } }] }), { headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
    const llm = new LlmClient({ apiKey: 'k-12345678', baseUrl: 'http://ai.local/v1', model: 'm', timeoutMs: 5000, retries: 1, temperature: .3 }, fetchImpl);
    const { store, saves } = fakeStore();
    const agent = new ModelAgent(store, llm, () => catalog, log, 1);
    const done = await finish(agent, agent.start('p5', 'Tạo hộp', emptyDoc(), 1).id);
    expect(done.status).toBe('done');
    expect(calls).toBe(4);
    expect(done.issues!.some((i) => i.includes('Agent tự dừng'))).toBe(true);
    expect(done.doc.nodes.filter((n) => n.kind === 'primitive')).toHaveLength(3);
    expect(saves).toHaveLength(1);
  });

  it('does not finish while a drawing has errors or was never built: it is sent back to work', async () => {
    const mats = [{ id: 'gach', name: 'Gạch', uses: ['tường'], preset: 'brick_red' }, { id: 'bt', name: 'Bê tông', uses: ['sàn'], preset: 'concrete' }];
    const plan = (door: boolean) => ({ level: 0, name: 'Trệt', height: 3,
      rooms: [{ id: 'a', name: 'Phòng', type: 'room', x0: 0, z0: 0, x1: 6, z1: 5 }],
      walls: [
        { id: 'n', a: [0, 0], b: [6, 0], thickness: .2, material: 'gach' }, { id: 'e', a: [6, 0], b: [6, 5], thickness: .2, material: 'gach' },
        { id: 's', a: [6, 5], b: [0, 5], thickness: .2, material: 'gach', openings: door ? [{ kind: 'door', at: 3, width: 1, height: 2.1 }] : [] },
        { id: 'w', a: [0, 5], b: [0, 0], thickness: .2, material: 'gach' },
      ] });
    const replies = [
      { thought: 'Bảng vật liệu, bản vẽ.', actions: [{ tool: 'define_materials', args: { materials: mats } }, { tool: 'draw_floor_plan', args: plan(false) }] },
      { thought: 'Xong.', done: true, summary: 'sớm' },
      { thought: 'Sửa: thêm cửa, dựng.', actions: [{ tool: 'draw_floor_plan', args: plan(true) }, { tool: 'build_floor', args: { level: 0 } }] },
      { thought: 'Xong.', done: true, summary: 'Đã dựng tầng trệt.' },
    ];
    let turn = 0;
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(replies[Math.min(turn++, replies.length - 1)]) } }], usage: { total_tokens: 10 } }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const llm = new LlmClient({ apiKey: 'k-12345678', baseUrl: 'http://ai.local/v1', model: 'm', timeoutMs: 5000, retries: 1, temperature: .3 }, fetchImpl);
    const { store } = fakeStore();
    const agent = new ModelAgent(store, llm, () => catalog, log, 1);
    const done = await finish(agent, agent.start('p9', 'Một phòng gạch', emptyDoc('Phòng', 'building'), 1).id);
    expect(done.status).toBe('done');
    expect(done.summary).toBe('Đã dựng tầng trệt.');
    expect(done.steps.some((x) => x.kind === 'info' && x.text.startsWith('Chưa xong'))).toBe(true);
    expect(done.doc.plans![0]!.built).toBeTruthy();
  });

  it('knows a building is not finished after its first storey: storeys planned, stairs leading up, the roof', () => {
    const doc = emptyDoc('Trường', 'building');
    doc.plans = [{ level: 0, name: 'Trệt', elevation: 0, height: 3.3, slab: .15, rooms: [], walls: [], stairs: [{ id: 'st', x: 0, z: 0, width: 1.2, direction: 's', shape: 'u', style: 'solid', material: 'bt' }], voids: [], built: 'g0' }] as unknown as NonNullable<typeof doc.plans>;
    const missing = missingParts(doc, ['Thiết kế ba dãy 3 tầng quanh sân']);
    expect(missing.join(' ')).toMatch(/1\/3 tầng/);
    expect(missing.join(' ')).toMatch(/dẫn lên/);
    expect(missing.join(' ')).toMatch(/mái/);
    doc.storeys = 1; doc.plans![0]!.stairs = [];
    doc.nodes.push({ id: 'roof', name: 'Mái', kind: 'roof', style: 'flat', width: 8, depth: 6, rise: 0, overhang: .3, thickness: .2, parent: null, transform: { position: [0, 3.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } as never);
    expect(missingParts(doc, ['một tầng'])).toEqual([]);
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
