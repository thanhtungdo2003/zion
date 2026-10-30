import { z } from 'zod';
import { TUTORIAL_IDS } from '../tutorial';
import { MAX_CHAT_LENGTH, MAX_CLIENT_MESSAGE_BYTES, MAX_PITCH } from '../constants';
import { MAX_WEAPON_ID } from '../weapons';
import { warfareLoadoutSchema, warfareOrderSchema } from '../warfare';

/** Input button bit flags. */
export const Buttons = {
  Jump: 1 << 0,
  Sprint: 1 << 1,
  Attack: 1 << 2,
  Roll: 1 << 3,
  Prone: 1 << 4,
  ThrowC4: 1 << 5,
  Aim: 1 << 6,
  /** Applying a first aid kit (so others see the bandage animation). */
  Heal: 1 << 7,
  /** Leaning out round cover (Q / E held). */
  LeanLeft: 1 << 8,
  LeanRight: 1 << 9,
  /** Crouched (X toggles). */
  Crouch: 1 << 10,
  /** Holding a blueprint up to place a structure (others see it in both hands). */
  Plan: 1 << 11,
  /** The blade finisher's forward lunge (accepted by the server only for the combo's last hit). */
  Lunge: 1 << 12,
  /** With Lunge: the long-hafted slash's step in (the quắm's second swing) instead of the blade finisher. */
  LungeLong: 1 << 13,
  /** Hand grenade held up with its pin pulled (left button held), waiting for the throw (right button). */
  Prime: 1 << 14,
} as const;

export const BUTTON_MASK = Buttons.Jump | Buttons.Sprint | Buttons.Attack | Buttons.Roll | Buttons.Prone | Buttons.ThrowC4 | Buttons.Aim | Buttons.Heal | Buttons.LeanLeft | Buttons.LeanRight | Buttons.Crouch | Buttons.Plan | Buttons.Lunge | Buttons.LungeLong | Buttons.Prime;

const u32 = z.number().int().min(0).max(0xffffffff);
const finite = z.number().finite();

export const authMessageSchema = z
  .object({
    t: z.literal('auth'),
    v: z.number().int().min(0).max(65535),
    ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

/**
 * One fixed-step input command. Clients never send positions — only intent. The server
 * integrates movement itself, so teleport/speed hacks cannot be expressed in the protocol.
 */
export const inputMessageSchema = z
  .object({
    t: z.literal('in'),
    /** Strictly increasing sequence number (anti-replay, reconciliation ack). */
    s: u32,
    /** Local strafe axis, -1 (left) … 1 (right). */
    mx: finite.min(-1).max(1),
    /** Local forward axis, -1 (back) … 1 (forward). */
    mz: finite.min(-1).max(1),
    yaw: finite.min(-Math.PI).max(Math.PI),
    /** Optional camera-to-muzzle aim correction; movement remains relative to `yaw`. */
    aimYaw: finite.min(-Math.PI).max(Math.PI).optional(),
    /** Animated muzzle relative to the player's feet, and the visible bore's unit vector.
     * The server bounds reach and sweeps from the body to prevent firing through cover. */
    bore: z.object({
      x: finite.min(-2.4).max(2.4), y: finite.min(-.5).max(3), z: finite.min(-2.4).max(2.4),
      dx: finite.min(-1).max(1), dy: finite.min(-1).max(1), dz: finite.min(-1).max(1),
    }).strict().refine((v) => Math.hypot(v.x, v.z) <= 2.4 && Math.abs(Math.hypot(v.dx, v.dy, v.dz) - 1) < .01, 'invalid weapon bore').optional(),
    pitch: finite.min(-MAX_PITCH).max(MAX_PITCH),
    b: z
      .number()
      .int()
      .min(0)
      .max(BUTTON_MASK)
      .refine((v) => (v & ~BUTTON_MASK) === 0, 'unknown button bits'),
    /** Weapon in hand (WeaponId); omitted = empty hands. */
    w: z.number().int().min(0).max(Math.max(MAX_WEAPON_ID, 250)).optional(),
    /** Weapon carried on the back (main slot, not in hand); omitted = none. */
    bw: z.number().int().min(0).max(Math.max(MAX_WEAPON_ID, 250)).optional(),
    /** Client's interpolated render time (server clock, ms) — used for lag compensation. */
    rt: finite.min(0).optional(),
    /** Throw target distance (m, horizontal) on ticks that throw a grenade. */
    td: finite.min(0).max(100).optional(),
  })
  .strict();

export const pingMessageSchema = z
  .object({ t: z.literal('ping'), id: u32, ct: finite })
  .strict();

export const chatMessageSchema = z
  .object({ t: z.literal('chat'), text: z.string().min(1).max(MAX_CHAT_LENGTH), channel: z.enum(['world', 'team']).optional() })
  .strict();

export const respawnMessageSchema = z.object({ t: z.literal('respawn') }).strict();
export const doorMessageSchema = z.object({ t: z.literal('door'), id: u32 }).strict();
export const vehicleMessageSchema = z.object({ t: z.literal('vehicle'), id: u32.optional() }).strict();
/** V aboard a vehicle: its countermeasure (flares / smoke screen). */
export const vehicleCountermeasureSchema = z.object({ t: z.literal('vcm') }).strict();

/** Testing aid: jump the world clock to a time of day (0…1, 0.5 = noon). */
export const setTimeMessageSchema = z.object({ t: z.literal('settime'), tod: finite.min(0).max(1) }).strict();

const itemId = z.string().regex(/^[a-z0-9_]{1,32}$/);

/** Buy one item from the weapon merchant (the server checks range and funds). */
export const buyMessageSchema = z.object({ t: z.literal('buy'), req: u32, item: itemId }).strict();

/** Zombie waves, between waves: buy one item from the wave shop with match cash; say ready (or not) for the next wave. */
export const waveBuyMessageSchema = z.object({ t: z.literal('waveBuy'), item: itemId }).strict();
export const waveReadyMessageSchema = z.object({ t: z.literal('waveReady'), ready: z.boolean() }).strict();

/** Warfare: pick a class and deploy point (a held zone id or the main base) while dead / before spawning. */
export const wfDeployMessageSchema = z.object({
  t: z.literal('wfDeploy'),
  cls: z.enum(['assault', 'medic', 'engineer', 'support', 'recon']),
  loadout: warfareLoadoutSchema.optional(),
  /** A deploy point id from the state's `deploy` list (absent: the server picks). */
  spawn: z.string().regex(/^[A-Za-z0-9_:-]{1,32}$/).optional(),
  /** Deploy as soon as allowed (false: just save the choice). */
  ready: z.boolean().optional(),
}).strict();
/** Warfare: create / join / leave a player squad. */
export const wfSquadMessageSchema = z.object({ t: z.literal('wfSquad'), action: z.enum(['create', 'join', 'leave']), id: u32.optional() }).strict();
/** Warfare: an explicit order to the bots following the sender. */
export const wfOrderMessageSchema = z.object({ t: z.literal('wfOrder'), order: warfareOrderSchema }).strict();
/**
 * Warfare: G. Aimed at an allied bot (`target`, from the client's raycast): recruit that bot;
 * aimed at the ground (`at`): send the followers there; neither: recruit the nearest idle allies.
 * `dismiss` lets every follower go back to its AI squad.
 */
export const wfRecruitMessageSchema = z.object({
  t: z.literal('wfRecruit'),
  target: u32.optional(),
  at: z.object({ x: z.number().finite().min(-100_000).max(100_000), y: z.number().finite().min(-1000).max(1000), z: z.number().finite().min(-100_000).max(100_000) }).strict().optional(),
  dismiss: z.boolean().optional(),
}).strict();
/** Warfare: an emote; point / wave / halt also command the sender's bots. `aim` = where the sender looks. */
export const wfEmoteMessageSchema = z.object({ t: z.literal('wfEmote'), emote: z.enum(['point', 'wave', 'salute', 'halt']), aim: z.object({ x: z.number().finite().min(-100_000).max(100_000), z: z.number().finite().min(-100_000).max(100_000) }).strict().optional() }).strict();

/** Sell one item (by uid) to the merchant; the server prices it from its own copy. */
export const sellMessageSchema = z.object({ t: z.literal('sell'), req: u32, uid: u32 }).strict();

/** Pick up a dropped ZCoin (the server checks reach). */
export const pickupCoinMessageSchema = z.object({ t: z.literal('pickcoin'), id: u32 }).strict();

/** Downed: call for help / give up (die now). Alive: start reviving a downed player nearby. */
export const distressMessageSchema = z.object({ t: z.literal('distress') }).strict();
export const giveUpMessageSchema = z.object({ t: z.literal('giveup') }).strict();
export const reviveMessageSchema = z.object({ t: z.literal('revive'), id: u32 }).strict();

/** Testing aid: add 1000 ZCoin to the wallet. */
export const devCoinsMessageSchema = z.object({ t: z.literal('devcoins') }).strict();

/** A first aid kit finished its 5 s application: restore full health (server enforces the pace). */
export const healMessageSchema = z.object({ t: z.literal('heal'), uid: u32 }).strict();

/** Pay the field medic to restore full health. */
export const nurseHealMessageSchema = z.object({ t: z.literal('nurseheal'), req: u32 }).strict();

const containerId = z.enum(['heavy', 'primary', 'secondary', 'grenades', 'backpack', 'armor_head', 'armor_chest', 'armor_face', 'armor_ears', 'armor_legs', 'armor_feet', 'offhand', 'pack', 'pack_storage', 'pack_rifle', 'stash_1', 'stash_2', 'stash_3']);
const cell = z.number().int().min(0).max(16);

/**
 * Inventory request (the server owns the inventory and answers with an 'inv' state):
 * move an item, put an item in hand (uid null = empty hands), drop it on the ground, pick a
 * ground item up (`id`), or take one item from a nearby ammo cache (`item`).
 */
const chestId = z.string().regex(/^\d{4}:-?\d+:-?\d+:-?\d+$/).max(100);
export const invMessageSchema = z.discriminatedUnion('op', [
  z.object({ t: z.literal('inv'), op: z.literal('chestOpen'), id: chestId }).strict(),
  z.object({ t: z.literal('inv'), op: z.literal('chestClose') }).strict(),
  z.object({ t: z.literal('inv'), op: z.literal('chestSearch'), id: chestId }).strict(),
  z.object({ t: z.literal('inv'), op: z.literal('chestPut'), id: chestId, uid: u32, revision: u32 }).strict(),
  z.object({ t: z.literal('inv'), op: z.literal('chestTake'), id: chestId, uid: u32, revision: u32 }).strict(),
  z.object({ t: z.literal('inv'), op: z.literal('move'), uid: u32, c: containerId, x: cell, y: cell, r: z.boolean() }).strict(),
  z.object({ t: z.literal('inv'), op: z.literal('equip'), uid: u32.nullable() }).strict(),
  // Auto-sort a container (the backpack, a storage page) as tightly as it packs.
  z.object({ t: z.literal('inv'), op: z.literal('sort'), c: containerId }).strict(),
  z.object({ t: z.literal('inv'), op: z.literal('drop'), uid: u32 }).strict(),
  /** Throws an item out of the open chest onto the ground. */
  z.object({ t: z.literal('inv'), op: z.literal('chestDrop'), id: chestId, uid: u32 }).strict(),
  z.object({ t: z.literal('inv'), op: z.literal('pickup'), id: u32 }).strict(),
  z.object({ t: z.literal('inv'), op: z.literal('cache'), item: itemId }).strict(),
  // Attachments: install item `uid` on gun `gun`, or take the attachment in `slot` off it.
  z.object({ t: z.literal('inv'), op: z.literal('attach'), gun: u32, uid: u32 }).strict(),
  z.object({ t: z.literal('inv'), op: z.literal('detach'), gun: u32, slot: z.enum(['optic', 'muzzle']) }).strict(),
]);

/**
 * Base building (survival): place a blueprint, split a log into planks, gather a log off a felled
 * trunk, open / close a structure's door, give the architect resources, collect a finished
 * blueprint, and order a supply drop by radio.
 */
const blueprintId = z.enum(['wood_outpost', 'stone_bunker', 'metal_fortress']);
export const buildMessageSchema = z.discriminatedUnion('op', [
  z.object({ t: z.literal('build'), op: z.literal('place'), uid: u32, x: z.number().finite().min(0).max(100_000), z: z.number().finite().min(0).max(100_000), yaw: z.number().finite().min(-10).max(10) }).strict(),
  z.object({ t: z.literal('build'), op: z.literal('craft'), uid: u32 }).strict(),
  z.object({ t: z.literal('build'), op: z.literal('log'), id: z.string().regex(/^-?\d+:-?\d+:\d+:\d+$/).max(40) }).strict(),
  z.object({ t: z.literal('build'), op: z.literal('door'), id: u32, piece: z.number().int().min(0).max(255) }).strict(),
  z.object({ t: z.literal('build'), op: z.literal('deposit'), blueprint: blueprintId, item: itemId }).strict(),
  z.object({ t: z.literal('build'), op: z.literal('claim'), blueprint: blueprintId }).strict(),
  z.object({ t: z.literal('build'), op: z.literal('order'), entry: itemId }).strict(),
]);
export type BuildMessage = z.infer<typeof buildMessageSchema>;

/** Reload the gun in hand (the server moves rounds from ammo boxes into its magazine). */
export const reloadMessageSchema = z.object({ t: z.literal('reload') }).strict();

export const lifeMessageSchema = z.object({ t: z.literal('life'), op: z.enum(['plant', 'harvest', 'cook', 'buy', 'sell', 'eat', 'loot', 'ignite']), target: itemId, choice: itemId.optional(), uid: u32.optional() }).strict();

export const questMessageSchema = z.object({ t: z.literal('quest'), op: z.enum(['list', 'accept', 'cancel', 'turnin', 'retrieve']), npc: itemId, quest: itemId.optional(), /** retrieve: which placed item. */ index: z.number().int().min(0).max(63).optional() }).strict();

/** Battle royale: where to leave the plane automatically (a point on its flight path), or clear it. */
export const jumpPointMessageSchema = z.object({ t: z.literal('jumppoint'), x: z.number().finite().min(-1).max(100_000), z: z.number().finite().min(-1).max(100_000) }).strict();

/** Infection: the weapons to carry (each validated against the allowed list by the server). */
export const loadoutMessageSchema = z.object({ t: z.literal('loadout'), primary: itemId, secondary: itemId, melee: itemId }).strict();

const plainClientMessageSchema = z.discriminatedUnion('t', [
  jumpPointMessageSchema,
  loadoutMessageSchema,
  z.object({ t: z.literal('pvp'), enabled: z.boolean() }).strict(),
  /** The client finished loading the map around it: only now does it enter matchmaking. */
  z.object({ t: z.literal('ready') }).strict(),
  z.object({ t: z.literal('tutorial'), op: z.enum(['open', 'close', 'heartbeat']), id: z.enum(TUTORIAL_IDS).optional(), replay: z.boolean().optional() }).strict(),
  distressMessageSchema,
  giveUpMessageSchema,
  reviveMessageSchema,
  lifeMessageSchema,
  questMessageSchema,
  reloadMessageSchema,
  nurseHealMessageSchema,
  devCoinsMessageSchema,
  healMessageSchema,
  pickupCoinMessageSchema,
  buyMessageSchema,
  sellMessageSchema,
  waveBuyMessageSchema,
  waveReadyMessageSchema,
  wfDeployMessageSchema,
  wfSquadMessageSchema,
  wfOrderMessageSchema,
  wfRecruitMessageSchema,
  wfEmoteMessageSchema,
  authMessageSchema,
  inputMessageSchema,
  pingMessageSchema,
  chatMessageSchema,
  respawnMessageSchema,
  doorMessageSchema,
  vehicleMessageSchema,
  vehicleCountermeasureSchema,
  setTimeMessageSchema,
]);

export const clientMessageSchema = z.union([plainClientMessageSchema, invMessageSchema, buildMessageSchema]);
export type InvMessage = z.infer<typeof invMessageSchema>;

export type AuthMessage = z.infer<typeof authMessageSchema>;
export type InputMessage = z.infer<typeof inputMessageSchema>;
export type PingMessage = z.infer<typeof pingMessageSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type DoorMessage = z.infer<typeof doorMessageSchema>;
export type BuyMessage = z.infer<typeof buyMessageSchema>;
export type SellMessage = z.infer<typeof sellMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: 'too_large' | 'not_json' | 'invalid_schema'; detail?: string };

/** Size-checked JSON parse + schema validation. Never throws. */
export function parseClientMessage(raw: string): ParseResult {
  // Each UTF-16 unit encodes to at most 3 UTF-8 bytes; cheap upper-bound check first.
  if (raw.length > MAX_CLIENT_MESSAGE_BYTES) return { ok: false, reason: 'too_large' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  const parsed = clientMessageSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_schema', detail: parsed.error.issues[0]?.message };
  }
  return { ok: true, message: parsed.data };
}
