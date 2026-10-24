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

describe('animated weapon input', () => {
  const input = { t: 'in', s: 1, mx: 0, mz: 0, yaw: 0, pitch: 0, b: 4 };
  const bore = { x: .2, y: 1.4, z: -.8, dx: 0, dy: 0, dz: -1 };
  it('accepts a reachable animated muzzle and remains compatible with older input', () => {
    expect(parseClientMessage(JSON.stringify({ ...input, bore })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify(input)).ok).toBe(true);
  });
  it.each([{ x: 2.4, z: 2.4 }, { y: 4 }, { dz: 0 }, { dx: 1 }, { dy: null }])('rejects an unreachable or invalid bore %j', (invalid) => {
    expect(parseClientMessage(JSON.stringify({ ...input, bore: { ...bore, ...invalid } })).ok).toBe(false);
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
      self: { x: 1.5, y: 20.25, z: -3, vx: 0.5, vy: -1, vz: 2, flags: 3, health: 80, stuckTicks: 0, rollTicks: 5, rollCooldown: 10, rollYaw: 1.5, lungeTicks: 3 },
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
    ['unknown buttons', { ...ok, b: 1 << 20 }],
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
    const riot = { head: 35, face: 44, ears: 50, chest: 65 };
    expect(unpackArmor(packArmor(riot))).toEqual(riot);
    expect(new Set(ARMOR_SPECS.map((a) => a.id)).size).toBe(ARMOR_SPECS.length);
    expect(armorProtection(riot)).toBeCloseTo(0.6, 2);
    expect(armorProtection({ head: 0, face: 0, ears: 0, chest: 0 })).toBe(0);
    expect(armorSpeedFactor(riot)).toBeGreaterThanOrEqual(0.9);
    expect(armorSpeedFactor(riot)).toBeLessThan(1);
    expect(ARMOR_BY_ITEM.get('helmet_military')?.slot).toBe('head');
    // Pieces, not sets: masks narrow the view and muffle hearing, headsets sharpen it.
    const { armorVision, armorHearing } = await import('./index');
    expect(armorVision({ head: 0, face: 45, ears: 0, chest: 0 })).toBeGreaterThan(.1);
    expect(armorHearing({ head: 0, face: 45, ears: 0, chest: 0 })).toBeLessThan(1);
    expect(armorHearing({ head: 0, face: 0, ears: 50, chest: 0 })).toBeGreaterThan(1);
    expect(ARMOR_SPECS.filter((a) => a.slot === 'face').every((a) => a.survivalOnly)).toBe(true);
  });
});

describe('server inventory model', () => {
  it('enforces grid rules, ammo, charges and armour wear', async () => {
    const { InventoryModel, defaultLoadout } = await import('./index');
    const inv = new InventoryModel(defaultLoadout());
    expect(inv.equippedItem()?.itemId).toBe('gl18');
    expect(inv.equippedItem()?.mag).toBe(17);
    expect(inv.items.filter((i) => i.itemId === 'grenade')).toHaveLength(2);
    expect(inv.items.filter((i) => i.itemId === 'potato_cooked')).toHaveLength(5);
    expect(inv.items.filter((i) => i.itemId === 'potato')).toHaveLength(1);
    expect(inv.items).toHaveLength(15);
    expect(inv.items.filter((i) => i.itemId === 'ammo_9mm')).toHaveLength(5);
    expect(inv.add('ammo_762')).toBeTruthy();
    // Overlapping move is refused; a free spot is accepted.
    const box = inv.items.find((i) => i.itemId === 'ammo_762')!;
    expect(inv.move(box.uid, 'backpack', 3, 0, false)).toBe(false);
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
    const vest = inv.add('vest_premium')!;
    expect(inv.move(vest.uid, 'armor_chest', 0, 0, false)).toBe(true);
    expect(inv.worn().chest).toBe(65);
    inv.wearArmor(100_000);
    expect(inv.worn().chest).toBe(0);
    // Forged / overlapping data is dropped on load.
    const bad = new InventoryModel({ items: [{ uid: 1, itemId: 'nope', container: 'backpack', x: 0, y: 0, rotated: false }, { uid: 2, itemId: 'ak47', container: 'backpack', x: 7, y: 4, rotated: false }], equipped: 2 });
    expect(bad.items).toHaveLength(0);
    expect(bad.equipped).toBeNull();
  });
});

describe('quest content', () => {
  it('default content is valid: 10 base quests per NPC plus 10 Colonel search missions', async () => {
    const { DEFAULT_CONTENT, validateContent } = await import('./index');
    const res = validateContent(DEFAULT_CONTENT);
    expect(res.ok ? [] : res.errors).toEqual([]);
    for (const npc of ['farmer', 'chef', 'colonel']) {
      const qs = DEFAULT_CONTENT.quests.filter((q) => q.npc === npc);
      expect(qs).toHaveLength(npc === 'colonel' ? 20 : 10);
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

import { SHOCKWAVE, shockwaveDamage, shockwaveFront } from './weapons';
describe('shock wave', () => {
  it('races out fast, then eases to its reach', () => {
    expect(shockwaveFront(7, 0)).toBe(0);
    expect(shockwaveFront(7, SHOCKWAVE.seconds / 3)).toBeGreaterThan(7 * SHOCKWAVE.reach * .6);
    expect(shockwaveFront(7, 10)).toBeCloseTo(7 * SHOCKWAVE.reach);
  });
  it('hurts less with distance and nothing past its reach', () => {
    expect(shockwaveDamage(7, 200, 8)).toBeGreaterThan(shockwaveDamage(7, 200, 12));
    expect(shockwaveDamage(7, 200, 7 * SHOCKWAVE.reach)).toBe(0);
  });
});

describe('blade combo', () => {
  it('cycles the four steps while swings follow each other, and starts over after a pause', async () => {
    const { BLADE_COMBO, nextBladeStep, bladeStepTiming, WEAPON_SPECS, WeaponId } = await import('./index');
    const katana = WEAPON_SPECS[WeaponId.Katana];
    if (katana.kind !== 'melee') throw new Error('katana is a melee weapon');
    let step = -1, readyAt = 0, now = 1000;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      step = nextBladeStep(step, readyAt, now);
      seen.push(step);
      const t = bladeStepTiming(katana, step);
      readyAt = now + t.cooldownMs;
      now = readyAt + 50;
    }
    expect(seen).toEqual([0, 1, 2, 3, 0, 1]);
    expect(BLADE_COMBO[3]!.lunge).toBe(true);
    expect(nextBladeStep(1, readyAt, readyAt + 5000)).toBe(0);
    for (let s = 0; s < 4; s++) {
      const t = bladeStepTiming(katana, s);
      expect(t.hitMs).toBeGreaterThan(0);
      expect(t.hitMs).toBeLessThan(t.durationMs);
      expect(t.cooldownMs).toBeLessThanOrEqual(t.durationMs + 1e-6);
    }
  });
});

describe('backpack', () => {
  it('opens its grids only while worn, and its items leave and return with it', async () => {
    const { InventoryModel, canPlace, carriedGear } = await import('./index');
    const inv = new InventoryModel({ items: [], equipped: null });
    expect(canPlace(inv.items, 'pack_storage', 'medkit', 0, 0, false)).toBe(false);
    const pack = inv.add('military_backpack')!;
    expect(pack.container).toBe('pack');
    const rifle = inv.add('ak47')!, rifle2 = inv.add('m4a1')!, third = inv.add('ak47')!;
    expect(third.container).toBe('pack_rifle');
    const med = inv.add('medkit')!;
    expect(inv.move(med.uid, 'pack_storage', 2, 1, false)).toBe(true);
    expect(carriedGear(inv.items, rifle.uid).back).toHaveLength(2);
    expect(carriedGear(inv.items, null)).toMatchObject({ pack: 'military_backpack' });
    // Dropped: the pack carries the rifle slot and its storage away.
    const dropped = inv.remove(pack.uid)!;
    expect(dropped.contents?.map((c) => c.itemId).sort()).toEqual(['ak47', 'medkit']);
    expect(inv.items.some((i) => i.container === 'pack_storage' || i.container === 'pack_rifle')).toBe(false);
    expect(inv.items.some((i) => i.uid === rifle2.uid)).toBe(true);
    // Picked up again: back on the back, contents unpacked into its grids.
    const again = inv.add('military_backpack')!;
    inv.restoreContents(again.uid, dropped.contents);
    expect(inv.items.find((i) => i.itemId === 'medkit')).toMatchObject({ container: 'pack_storage', x: 2, y: 1 });
    expect(inv.items.some((i) => i.container === 'pack_rifle')).toBe(true);
  });

  it('keeps packed contents through a save, and rescues old items left in pack grids', async () => {
    const { InventoryModel } = await import('./index');
    const inv = new InventoryModel({ items: [], equipped: null });
    const pack = inv.add('military_backpack')!;
    const med = inv.add('medkit')!;
    inv.move(med.uid, 'pack_storage', 0, 0, false);
    expect(inv.move(pack.uid, 'backpack', 0, 0, false)).toBe(true);
    const saved = JSON.parse(JSON.stringify(inv.toJSON()));
    const loaded = new InventoryModel(saved);
    expect(loaded.items.find((i) => i.itemId === 'military_backpack')?.contents?.[0]).toMatchObject({ itemId: 'medkit', container: 'pack_storage' });
    // A pack never goes inside a pack, and junk inside is dropped.
    const nested = new InventoryModel({ items: [{ uid: 1, itemId: 'military_backpack', container: 'backpack', x: 0, y: 0, rotated: false, contents: [{ uid: 2, itemId: 'military_backpack', container: 'pack_storage', x: 0, y: 0, rotated: false }, { uid: 3, itemId: 'nope', container: 'pack_storage', x: 4, y: 0, rotated: false }] }], equipped: null });
    expect(nested.items[0]!.contents).toBeUndefined();
    // Items saved in a pack grid with no pack worn move to the carried storage instead of vanishing.
    const orphan = new InventoryModel({ items: [{ uid: 5, itemId: 'medkit', container: 'pack_storage', x: 0, y: 0, rotated: false }], equipped: null });
    expect(orphan.items[0]?.container).toBe('backpack');
  });
});

describe('shipped gear fitting', () => {
  it('is a valid fitting', async () => {
    const { DEFAULT_GEAR_FIT, gearFitSchema } = await import('./index');
    expect(gearFitSchema.parse(DEFAULT_GEAR_FIT)).toEqual(DEFAULT_GEAR_FIT);
  });
});
