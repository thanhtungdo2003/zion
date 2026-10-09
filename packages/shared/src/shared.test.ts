import { describe, expect, it } from 'vitest';
import {
  BinaryReadError,
  Biome,
  Rng,
  chunkKey,
  chunkKeyX,
  chunkKeyZ,
  decodeChunkBody,
  decodeChunkMessage,
  decodeChunkUnload,
  decodeSnapshot,
  dequantizeHeight,
  encodeChunkBody,
  encodeChunkMessage,
  encodeChunkUnload,
  encodeSnapshot,
  hash2,
  lodVerts,
  parseClientMessage,
  quantizeHeight,
  type ChunkData,
} from './index';

describe('random', () => {
  it('Rng is deterministic for a seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('hash2 is order-sensitive and collision-free on a small grid', () => {
    expect(hash2(1, 2, 3)).not.toBe(hash2(1, 3, 2));
    const seen = new Set<number>();
    for (let x = -50; x < 50; x++) for (let z = -50; z < 50; z++) seen.add(hash2(42, x, z));
    expect(seen.size).toBe(10_000);
  });
});

describe('world keys and quantization', () => {
  it('round-trips negative chunk coordinates', () => {
    for (const [x, z] of [[0, 0], [-1, 5], [127, -128], [-32768, 32767]] as const) {
      const k = chunkKey(x, z);
      expect(chunkKeyX(k)).toBe(x);
      expect(chunkKeyZ(k)).toBe(z);
    }
  });

  it('quantizes heights to 1 cm', () => {
    for (const h of [-50, 0, 12.345, 300.01]) {
      expect(Math.abs(dequantizeHeight(quantizeHeight(h)) - h)).toBeLessThanOrEqual(0.005 + 1e-9);
    }
  });
});

function sampleChunk(lod: number): ChunkData {
  const n = lodVerts(lod);
  const heights = new Uint16Array((n + 2) * (n + 2));
  for (let i = 0; i < heights.length; i++) heights[i] = 10000 + ((i * 37) % 500);
  const water = new Uint16Array(n * n);
  water[5] = 12000;
  const biome = new Uint8Array(n * n).fill(Biome.Forest);
  return {
    cx: -3,
    cz: 7,
    lod,
    verts: n,
    heights,
    water,
    biome,
    surface: new Uint8Array(n * n).fill(2),
    temperature: new Uint8Array(n * n).fill(128),
    humidity: new Uint8Array(n * n).fill(64),
    props: [{ asset: 3, lx: 100, lz: 65535, yq: 12345, rot: 17, scale: 200, group: 77 }],
    cosmeticSeed: 0xdeadbeef,
  };
}

describe('chunk codec', () => {
  it('round-trips all LODs', () => {
    for (let lod = 0; lod < 3; lod++) {
      const c = sampleChunk(lod);
      const decoded = decodeChunkBody(encodeChunkBody(c), c.cx, c.cz, lod);
      expect(decoded).toEqual(c);
    }
  });

  it('rejects truncated and mismatched bodies', () => {
    const body = encodeChunkBody(sampleChunk(0));
    expect(() => decodeChunkBody(body.subarray(0, body.length - 3), 0, 0, 0)).toThrow(BinaryReadError);
    expect(() => decodeChunkBody(body, 0, 0, 1)).toThrow(BinaryReadError);
  });

  it('frames chunk and unload messages', () => {
    const msg = encodeChunkMessage({ cx: -5, cz: 9, lod: 2, seq: 77 }, new Uint8Array([1, 2, 3]));
    const { header, body } = decodeChunkMessage(msg);
    expect(header).toEqual({ cx: -5, cz: 9, lod: 2, seq: 77 });
    expect([...body]).toEqual([1, 2, 3]);
    const unload = decodeChunkUnload(encodeChunkUnload(5, [[1, -2], [3, 4]]));
    expect(unload).toEqual({ seq: 5, chunks: [[1, -2], [3, 4]] });
  });
});

describe('snapshot codec', () => {
  it('round-trips with quantized angles', () => {
    const snap = {
      tick: 99,
      serverTime: 123456.5,
      timeOfDay: 0.25,
      ackSeq: 42,
      self: { x: 1.5, y: 20.25, z: -3, vx: 0.5, vy: -1, vz: 2, flags: 3, health: 80, stuckTicks: 0, rollTicks: 5, rollCooldown: 10, rollYaw: 1.5 },
      entities: [{ id: 7, kind: 1, x: 10, y: 21, z: 30, yaw: 1.2, pitch: -0.3, flags: 1, health: 100, weapon: 2 }],
    };
    const out = decodeSnapshot(encodeSnapshot(snap));
    expect(out.self).toEqual(snap.self);
    expect(out.entities[0]!.yaw).toBeCloseTo(1.2, 3);
    expect(out.entities[0]!.pitch).toBeCloseTo(-0.3, 3);
  });
});

describe('client message validation', () => {
  const ok = { t: 'in', s: 1, mx: 0, mz: 1, yaw: 0.5, pitch: 0, b: 1 };

  it('accepts a valid input', () => {
    expect(parseClientMessage(JSON.stringify(ok)).ok).toBe(true);
  });

  it.each([
    ['extra field', { ...ok, x: 100 }],
    ['out of range axis', { ...ok, mx: 2 }],
    ['unknown buttons', { ...ok, b: 128 }],
    ['negative seq', { ...ok, s: -1 }],
    ['wrong type', { ...ok, yaw: '1' }],
    ['unknown message', { t: 'teleport', x: 1 }],
  ])('rejects %s', (_name, msg) => {
    expect(parseClientMessage(JSON.stringify(msg)).ok).toBe(false);
  });

  it('rejects non-finite numbers, garbage and oversized payloads', () => {
    expect(parseClientMessage('{"t":"in","s":1,"mx":1e999,"mz":0,"yaw":0,"pitch":0,"b":0}').ok).toBe(false);
    expect(parseClientMessage('not json').ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'chat', text: 'x'.repeat(5000) }))).toMatchObject({
      ok: false,
      reason: 'too_large',
    });
  });
});

describe('weapons & shop', () => {
  it('every weapon item has a spec and every shop entry has a sane price', async () => {
    const { WEAPON_BY_ITEM, WEAPON_SPECS, SHOP_STOCK, buyPrice, sellPrice } = await import('./index');
    for (const w of Object.values(WEAPON_BY_ITEM)) if (w) expect(WEAPON_SPECS[w as Exclude<typeof w, 0>]).toBeDefined();
    expect(new Set(SHOP_STOCK.map((e) => e.item)).size).toBe(SHOP_STOCK.length);
    for (const e of SHOP_STOCK) {
      expect(buyPrice(e.item)).toBe(e.price);
      expect(sellPrice(e.item)).toBeLessThan(e.price);
    }
    expect(sellPrice('ammo_762', 0.5)).toBe(Math.floor(45 * 0.4 * 0.5));
    expect(buyPrice('nope')).toBeNull();
  });

  it('lobbed grenade-launcher rounds land at the aimed distance', async () => {
    const { lobSpeed, GRENADE_GRAVITY } = await import('./index');
    const e = 0.85;
    for (const d of [8, 20, 40]) {
      const v = lobSpeed(e, 45, d, 0);
      const t = (2 * v * Math.sin(e)) / GRENADE_GRAVITY;
      expect(v * Math.cos(e) * t).toBeCloseTo(d, 3);
    }
  });
});

describe('armour', () => {
  it('packs loadouts, caps protection and slows heavy sets a little', async () => {
    const { packArmor, unpackArmor, armorProtection, armorSpeedFactor, ARMOR_SPECS, ARMOR_BY_ITEM } = await import('./index');
    const riot = { head: 19, chest: 20, legs: 21, feet: 22 };
    expect(unpackArmor(packArmor(riot))).toEqual(riot);
    expect(new Set(ARMOR_SPECS.map((a) => a.id)).size).toBe(ARMOR_SPECS.length);
    expect(armorProtection(riot)).toBeCloseTo(0.56, 2);
    expect(armorProtection({ head: 0, chest: 0, legs: 0, feet: 0 })).toBe(0);
    expect(armorSpeedFactor(riot)).toBeGreaterThanOrEqual(0.9);
    expect(armorSpeedFactor(riot)).toBeLessThan(1);
    expect(ARMOR_BY_ITEM.get('combat_helmet')?.slot).toBe('head');
  });
});

describe('server inventory model', () => {
  it('enforces grid rules, ammo, charges and armour wear', async () => {
    const { InventoryModel, defaultLoadout } = await import('./index');
    const inv = new InventoryModel(defaultLoadout());
    expect(inv.equippedItem()?.itemId).toBe('ak47');
    expect(inv.equippedItem()?.mag).toBe(30);
    // Overlapping move is refused; a free spot is accepted.
    const box = inv.items.find((i) => i.itemId === 'ammo_762')!;
    expect(inv.move(box.uid, 'backpack', 7, 0, false)).toBe(false);
    expect(inv.move(box.uid, 'backpack', 3, 3, false)).toBe(true);
    // Ammo comes out of boxes and empty boxes vanish.
    expect(inv.ammoFor('ak47')).toBe(30);
    expect(inv.takeAmmo('ak47', 50)).toBe(30);
    expect(inv.items.some((i) => i.itemId === 'ammo_762')).toBe(false);
    // Medkit: 3 charges then gone.
    const kit = inv.items.find((i) => i.itemId === 'medkit')!;
    inv.useCharge(kit.uid);
    inv.useCharge(kit.uid);
    inv.useCharge(kit.uid);
    expect(inv.get(kit.uid)).toBeUndefined();
    // Armour wears down and breaks.
    const vest = inv.add('riot_protection_jacket')!;
    expect(inv.move(vest.uid, 'armor_chest', 0, 0, false)).toBe(true);
    expect(inv.worn().chest).toBe(20);
    inv.wearArmor(10_000);
    expect(inv.worn().chest).toBe(0);
    // Forged / overlapping data is dropped on load.
    const bad = new InventoryModel({ items: [{ uid: 1, itemId: 'nope', container: 'backpack', x: 0, y: 0, rotated: false }, { uid: 2, itemId: 'ak47', container: 'backpack', x: 7, y: 4, rotated: false }], equipped: 2 });
    expect(bad.items).toHaveLength(0);
    expect(bad.equipped).toBeNull();
  });
});

describe('quest content', () => {
  it('default content is valid: 3 NPCs × 10 quests, 3 daily, ≥5 away from base', async () => {
    const { DEFAULT_CONTENT, validateContent } = await import('./index');
    const res = validateContent(DEFAULT_CONTENT);
    expect(res.ok ? [] : res.errors).toEqual([]);
    for (const npc of ['farmer', 'chef', 'colonel']) {
      const qs = DEFAULT_CONTENT.quests.filter((q) => q.npc === npc);
      expect(qs).toHaveLength(10);
      expect(qs.filter((q) => q.kind === 'daily')).toHaveLength(3);
      expect(qs.filter((q) => q.objectives.some((o) => o.type === 'visit' || o.type === 'retrieve' || o.type === 'kill')).length).toBeGreaterThanOrEqual(5);
    }
    const broken = structuredClone(DEFAULT_CONTENT);
    broken.quests[0]!.prereq = ['nope'];
    broken.quests[1]!.objectives = [{ type: 'deliver', item: 'unobtainium', count: 1 }];
    const bad = validateContent(broken);
    expect(bad.ok).toBe(false);
  });
});
