import {
  BATTLE_FLIGHT, CHUNK_SIZE, ENTITY_INTEREST_RADIUS_CHUNKS, EntityFlags, EntityKind, ITEMS, MUZZLE_HEIGHT, NO_ARMOR, NPC_ID_BASE,
  TICK_DT, WEAPON_BY_ITEM, WEAPON_SPECS, ARMOR_BY_ITEM, advanceBallistic, armorProtection, bulletSpec, packArmor,
  type ArmorLoadout, type BattleCircle, type BattlePlane, type EntityState, type GunSpec, type PlacedItem, type ProjectileEndEvent,
  type ProjectileEvent, type ShotEvent, type BallisticState,
} from '@zion/shared';
import {
  CharacterController, HUMANOID_RIG, Mask, PRONE_RIG, ZONE_DAMAGE_MULTIPLIER, createCharacterState, makeRayHit, stepAirborne,
  type CharacterState, type CollisionWorld,
} from '@zion/physics';
import { castCombatRay, spreadDirection, type Combatant } from './combat';
import { PoseHistory, type Player, type PoseSample } from './player';
import { NavigationState, ZombieNavigation } from './navigation';

/** Bot ids sit in the NPC range, clear of the camp NPCs. */
export const BOT_ID_BASE = NPC_ID_BASE + 0x1000;
export const MAX_BATTLE_BOTS = 10;
const NAME_HEADS = ['tung', 'minh', 'hieu', 'nam', 'khanh', 'duc', 'long', 'phong', 'quan', 'huy', 'linh', 'trang', 'vy', 'an', 'bao', 'dat', 'son', 'thanh', 'kiet', 'tuan', 'shadow', 'ghost', 'sniper', 'wolf', 'reaper', 'noob', 'pro', 'dark', 'killer', 'zero', 'lucky', 'toxic', 'chill', 'blaze', 'viper'];
const NAME_TAILS = ['', '', '_vn', 'pro', 'gaming', 'x', 'zz', '_99', 'boy', 'dz', 'tv', '2k', 'vip', '_hn', '_sg', 'ne'];
/** Usernames in the style real players pick: lowercase handles, numbers, the odd capital. */
function playerLikeName(taken: ReadonlySet<string>): string {
  const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;
  for (let attempt = 0; attempt < 20; attempt++) {
    let name = pick(NAME_HEADS);
    if (Math.random() < .35) name += pick(NAME_HEADS);
    name += pick(NAME_TAILS);
    if (Math.random() < .6) name += Math.random() < .5 ? String(Math.floor(Math.random() * 100)) : String(1990 + Math.floor(Math.random() * 20));
    if (Math.random() < .3) name = name[0]!.toUpperCase() + name.slice(1);
    if (Math.random() < .15) name = `x${name}x`;
    name = name.slice(0, 16);
    if (name.length >= 3 && !taken.has(name)) return name;
  }
  return `player${Math.floor(Math.random() * 10_000)}`;
}
/** How far bots see (m), and the field of view when not already alerted. */
const SIGHT = 70, FOV = Math.cos(65 * Math.PI / 180);

type Mode = 'idle' | 'loot' | 'zone' | 'fight' | 'roam';

export class BattleBot implements Combatant {
  readonly history = new PoseHistory();
  readonly state: CharacterState;
  readonly nav = new NavigationState();
  dead = false;
  deadAt = 0;
  active = false;
  yaw = 0;
  pitch = 0;
  health = 100;
  armor: ArmorLoadout = { ...NO_ARMOR };
  /** What the bot carries, as real inventory items (dropped in a crate when it dies). */
  items: PlacedItem[] = [];
  weapon = 0;
  gunItem: PlacedItem | null = null;
  fireAt = 0;
  reloadUntil = 0;
  healUntil = 0;
  jumpAt = 0;
  landing: { x: number; z: number } | null = null;
  /** Bot squad in squad matches (squadmates never fight each other, they drop together). */
  squad: string | null = null;
  /** Run over by a vehicle: limp and flying until then. */
  knockedUntil = 0;
  mode: Mode = 'idle';
  goal: { x: number; y: number; z: number; chest?: string } | null = null;
  /** Chests already emptied or checked by this bot. */
  readonly searched = new Set<string>();
  target: Combatant & { state: CharacterState; id: number } | null = null;
  seenAt = 0;
  reactAt = 0;
  /** When the bot settled its aim on the current target (0 = not aimed). */
  aimedAt = 0;
  strafe = 1;
  strafeUntil = 0;
  /** Last known position of whoever hurt it. */
  alert: { x: number; z: number; until: number } | null = null;
  progress = { x: 0, z: 0, at: 0 };
  detourUntil = 0;
  detourYaw = 0;
  roamUntil = 0;
  constructor(readonly id: number, readonly name: string, x: number, y: number, z: number) {
    this.state = createCharacterState(x, y, z);
  }
  get rig() { return this.state.prone ? PRONE_RIG : HUMANOID_RIG; }
  rigAt(pose: PoseSample) { return pose.prone ? PRONE_RIG : HUMANOID_RIG; }
  get gun(): GunSpec | null {
    const spec = this.weapon ? WEAPON_SPECS[this.weapon as keyof typeof WEAPON_SPECS] : undefined;
    return spec?.kind === 'gun' ? spec : null;
  }
  ammoItems(): PlacedItem[] {
    const gun = this.gunItem?.itemId;
    return gun ? this.items.filter(i => ITEMS[i.itemId]?.ammo?.guns.includes(gun) && (i.count ?? 0) > 0) : [];
  }
  get reserve(): number { return this.ammoItems().reduce((n, i) => n + (i.count ?? 0), 0); }
}

export interface BotHooks {
  shot(e: ShotEvent): void;
  projectile(e: ProjectileEvent): void;
  projectileEnd(e: ProjectileEndEvent): void;
  /** A bot's bullet struck a player. */
  hitPlayer(bot: BattleBot, player: Player, damage: number, zone: string, x: number, y: number, z: number, now: number): void;
  /** A bot died; `by` names the killer or cause. */
  died(bot: BattleBot, by: string, now: number, killerId: number | null): void;
  /** Lootable chests (and death crates) near a point. */
  chests(x: number, z: number, radius: number): Array<{ id: string; x: number; y: number; z: number }>;
  /** Takes the chosen items out of a chest; returns what was actually removed. */
  loot(id: string, choose: (items: readonly PlacedItem[]) => number[]): PlacedItem[];
}

export interface BotWorld {
  phase: 'waiting' | 'countdown' | 'running' | 'finished';
  circle: BattleCircle;
  nextCircle: BattleCircle;
  shrinking: boolean;
  remainingMs: number;
  plane: BattlePlane | null;
}

interface Round extends BallisticState { id: number; bot: BattleBot; traveled: number; damage: number; w: number; range: number; gravity: number; drag: number }

/**
 * Battle royale bots: board the plane, skydive towards a landing spot, loot chests for a gun,
 * ammo and armour, keep ahead of the red zone, and fight anyone they see (strafing, going prone
 * when hurt, healing in quiet moments). They are real entrants in the match.
 */
export class BattleBotDirector {
  readonly bots: BattleBot[] = [];
  private readonly controller: CharacterController;
  private readonly navigation: ZombieNavigation;
  private readonly sight = makeRayHit();
  private readonly rounds: Round[] = [];
  private nextRoundId = 0x68000000;
  private serial = 0;

  constructor(private readonly collision: CollisionWorld, private readonly hooks: BotHooks) {
    this.controller = new CharacterController(collision);
    this.navigation = new ZombieNavigation(collision);
  }

  clear(): void { this.bots.length = 0; this.rounds.length = 0; }

  /** Adds a bot next to a point (the joining player); returns it so the match can enrol it. */
  spawn(x: number, y: number, z: number): BattleBot {
    const name = playerLikeName(new Set(this.bots.map(b => b.name)));
    const angle = Math.random() * Math.PI * 2;
    const bot = new BattleBot(BOT_ID_BASE + (this.serial++ % 0x1000), name, x + Math.cos(angle) * 3, y + .1, z + Math.sin(angle) * 3);
    this.bots.push(bot);
    return bot;
  }

  /** The plane takes off: everyone boards; each bot picks its own jump moment and landing spot. */
  board(now: number, circle: BattleCircle): void {
    for (const bot of this.bots) {
      if (bot.dead) continue;
      bot.state.flight = 1; bot.state.grounded = false;
      bot.jumpAt = now + 6000 + Math.random() * (BATTLE_FLIGHT.durationMs - 14000);
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * circle.radius * .6;
      bot.landing = { x: circle.x + Math.cos(a) * r, z: circle.z + Math.sin(a) * r };
      // Squadmates follow their first member out of the plane, landing a few metres apart.
      const lead = bot.squad ? this.bots.find(b => b.squad === bot.squad && !b.dead && b.landing) : undefined;
      if (lead && lead !== bot) { bot.jumpAt = lead.jumpAt + 300 + Math.random() * 600; bot.landing = { x: lead.landing!.x + (Math.random() - .5) * 16, z: lead.landing!.z + (Math.random() - .5) * 16 }; }
    }
  }

  near(x: number, z: number, radius: number): BattleBot[] {
    return this.bots.filter(b => !b.dead && Math.hypot(b.state.x - x, b.state.z - z) <= radius);
  }

  centers(): Array<[number, number]> {
    return this.bots.filter(b => !b.dead).map(b => [Math.floor(b.state.x / CHUNK_SIZE), Math.floor(b.state.z / CHUNK_SIZE)]);
  }

  /** Damage from players, other bots, blasts or the zone. */
  hit(bot: BattleBot, amount: number, by: string, from: { x: number; z: number } | null, now: number, zone = 'torso', killerId: number | null = null): void {
    if (bot.dead || amount <= 0) return;
    const taken = zone === 'red_zone' ? amount : Math.max(1, Math.round(amount * (1 - armorProtection(bot.armor))));
    bot.health = Math.max(0, bot.health - taken);
    bot.healUntil = 0;
    if (from) bot.alert = { x: from.x, z: from.z, until: now + 6000 };
    if (bot.health > 0) return;
    bot.dead = true; bot.deadAt = now; bot.state.flight = 0; bot.state.prone = false;
    this.hooks.died(bot, by, now, killerId);
  }

  step(now: number, tick: number, world: BotWorld, players: readonly Player[]): void {
    this.navigation.beginTick();
    const think = tick % 3 === 0;
    for (const bot of this.bots) {
      const s = bot.state;
      bot.history.push(now, s.x, s.y, s.z, bot.yaw, s.prone);
      if (bot.dead) continue;
      if (s.flight === 1) { this.ride(bot, now, world.plane); continue; }
      if (s.flight) { this.fall(bot); continue; }
      bot.active = this.controller.canSimulateAt(s.x, s.z);
      if (!bot.active) continue;
      // Thrown by a vehicle: no thinking, no steering, the body just flies and slides.
      if (now < bot.knockedUntil) { this.controller.step(s, { mx: 0, mz: 0, yaw: bot.yaw, jump: false, sprint: false, prone: false }, TICK_DT); continue; }
      if (think) this.decide(bot, now, world, players);
      this.move(bot, now, world);
      if (bot.mode === 'fight') this.shoot(bot, now);
    }
    this.fly(now, players);
  }

  /* ----------------------------------------------------------------------------- insertion */

  private ride(bot: BattleBot, now: number, plane: BattlePlane | null): void {
    const s = bot.state;
    if (!plane) { s.flight = 2; return; }
    Object.assign(s, { x: plane.x, y: plane.y - 2, z: plane.z, vx: 0, vy: 0, vz: 0 });
    if (now >= bot.jumpAt || plane.remainingMs <= 0) s.flight = 2;
  }

  private fall(bot: BattleBot): void {
    const s = bot.state, goal = bot.landing ?? { x: s.x, z: s.z };
    const dx = goal.x - s.x, dz = goal.z - s.z, far = Math.hypot(dx, dz);
    bot.yaw = Math.atan2(-dx, -dz);
    stepAirborne(s, { mx: 0, mz: far > 8 ? 1 : 0, yaw: bot.yaw, jump: false, sprint: far < 60 }, this.collision, TICK_DT);
    if (!s.flight) { bot.mode = 'idle'; bot.goal = null; }
  }

  /* ---------------------------------------------------------------------------- decisions */

  private enemies(bot: BattleBot, players: readonly Player[]): Array<Combatant & { state: CharacterState; id: number }> {
    const list: Array<Combatant & { state: CharacterState; id: number }> = [];
    for (const p of players) if (!p.dead && !p.state.flight && p.active) list.push(p);
    for (const other of this.bots) if (other !== bot && !other.dead && !other.state.flight && (!bot.squad || other.squad !== bot.squad)) list.push(other);
    return list;
  }

  private visible(bot: BattleBot, t: { state: CharacterState }, alerted: boolean): boolean {
    const s = bot.state, dx = t.state.x - s.x, dz = t.state.z - s.z, d = Math.hypot(dx, dz);
    if (d > SIGHT) return false;
    if (!alerted && d > 12) {
      const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
      if ((dx * fx + dz * fz) / (d || 1) < FOV) return false;
    }
    const oy = s.y + (s.prone ? .4 : MUZZLE_HEIGHT), ty = t.state.y + (t.state.prone ? .3 : 1.2);
    return this.collision.lineOfSight(s.x, oy, s.z, t.state.x, ty, t.state.z, Mask.LineOfSight, this.sight);
  }

  private decide(bot: BattleBot, now: number, world: BotWorld, players: readonly Player[]): void {
    const s = bot.state;
    if (bot.reloadUntil && now >= bot.reloadUntil) this.finishReload(bot);
    // Target: keep the current one while visible, otherwise the nearest visible enemy.
    const alerted = !!bot.alert && now < bot.alert.until;
    if (bot.target && (bot.target.dead || !this.visible(bot, bot.target, true))) bot.target = null;
    if (!bot.target) {
      let best = Infinity;
      for (const e of this.enemies(bot, players)) {
        const d = Math.hypot(e.state.x - s.x, e.state.z - s.z);
        if (d < best && this.visible(bot, e, alerted)) { best = d; bot.target = e; }
      }
      if (bot.target) { bot.seenAt = now; bot.reactAt = now + 350 + Math.random() * 450; }
    }
    if (alerted && !bot.target) bot.yaw = Math.atan2(-(bot.alert!.x - s.x), -(bot.alert!.z - s.z));
    const outsideNow = Math.hypot(s.x - world.circle.x, s.z - world.circle.z) > world.circle.radius - 4;
    const next = world.nextCircle, outsideNext = Math.hypot(s.x - next.x, s.z - next.z) > next.radius * .85;
    const zoneUrgent = world.phase === 'running' && (outsideNow || (outsideNext && (world.shrinking || world.remainingMs < 25_000)));
    const armed = !!bot.gun && (bot.gunItem?.mag ?? 0) + bot.reserve > 0;

    if (bot.target && armed && !(outsideNow && Math.hypot(bot.target.state.x - s.x, bot.target.state.z - s.z) > 30)) { bot.mode = 'fight'; return; }
    if (zoneUrgent) {
      bot.mode = 'zone';
      const dx = next.x - s.x, dz = next.z - s.z, d = Math.hypot(dx, dz) || 1, inside = Math.min(d, next.radius * .4);
      bot.goal = { x: next.x - dx / d * inside, y: s.y, z: next.z - dz / d * inside };
      return;
    }
    if (bot.target && !armed) {
      // Unarmed: break line of sight and keep looking for a gun.
      bot.mode = 'loot';
    }
    // Patch up when it is quiet.
    if (!bot.target && bot.health < 70 && !bot.healUntil) {
      const kit = bot.items.find(i => i.itemId === 'medkit');
      if (kit) { bot.healUntil = now + 5000; bot.mode = 'idle'; return; }
    }
    if (bot.healUntil) {
      if (now >= bot.healUntil) {
        const kit = bot.items.find(i => i.itemId === 'medkit');
        if (kit) { bot.health = 100; kit.count = (kit.count ?? ITEMS.medkit?.uses ?? 1) - 1; if (kit.count <= 0) bot.items = bot.items.filter(i => i !== kit); }
        bot.healUntil = 0;
      } else { bot.mode = 'idle'; return; }
    }
    const wantsGear = !armed || bot.reserve < (bot.gun?.magazine ?? 0) || !bot.armor.chest || !bot.armor.head;
    if (world.phase === 'running' && wantsGear) {
      if (bot.goal?.chest && !bot.searched.has(bot.goal.chest)) { bot.mode = 'loot'; return; }
      const chest = this.hooks.chests(s.x, s.z, armed ? 60 : 160).filter(c => !bot.searched.has(c.id))
        .sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
      if (chest) { bot.mode = 'loot'; bot.goal = { x: chest.x, y: chest.y, z: chest.z, chest: chest.id }; return; }
    }
    // Roam inside the safe area.
    if (bot.mode !== 'roam' || !bot.goal || now > bot.roamUntil || Math.hypot(bot.goal.x - s.x, bot.goal.z - s.z) < 3) {
      const area = world.phase === 'running' ? next : { x: s.x, z: s.z, radius: 12 };
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * area.radius * .7;
      bot.goal = { x: area.x + Math.cos(a) * r, y: s.y, z: area.z + Math.sin(a) * r };
      bot.roamUntil = now + 20_000;
    }
    bot.mode = world.phase === 'running' ? 'roam' : 'idle';
  }

  /* ------------------------------------------------------------------------------ movement */

  private move(bot: BattleBot, now: number, world: BotWorld): void {
    const s = bot.state;
    let mx = 0, mz = 0, sprint = false, prone = false, yaw = bot.yaw;
    if (bot.mode === 'fight' && bot.target) {
      const t = bot.target.state, dx = t.x - s.x, dz = t.z - s.z, d = Math.hypot(dx, dz);
      yaw = Math.atan2(-dx, -dz);
      const close = (bot.gun?.range ?? 40) < 30 ? 7 : 18;
      if (now > bot.strafeUntil) { bot.strafe = Math.random() < .5 ? -1 : 1; bot.strafeUntil = now + 700 + Math.random() * 1300; }
      // Hurt and at range: drop prone (harder to hit); otherwise strafe and hold a comfortable distance.
      prone = bot.health < 50 && d > 15 && !bot.reloadUntil;
      if (!prone) { mx = bot.strafe; mz = d > close * 1.6 ? .8 : d < close * .6 ? -.8 : 0; }
      // Reloading up close: back off sideways.
      if (bot.reloadUntil && d < 15) { mz = -1; mx = bot.strafe; }
    } else if (bot.goal && bot.mode !== 'idle') {
      const goal = bot.goal, d = Math.hypot(goal.x - s.x, goal.z - s.z);
      if (goal.chest && d < 1.8) { this.lootChest(bot, goal.chest); bot.goal = null; }
      else {
        const ground = this.collision.terrainHeight(goal.x, goal.z);
        const way = this.navigation.steer(bot.nav, { x: s.x, y: s.y, z: s.z }, { x: goal.x, y: Number.isFinite(ground) ? Math.max(ground, goal.y) : goal.y, z: goal.z }, now) ?? goal;
        yaw = Math.atan2(-(way.x - s.x), -(way.z - s.z));
        mz = 1; sprint = bot.mode === 'zone' || d > 25;
      }
    } else if (world.phase !== 'running' && Math.random() < .01) {
      yaw = bot.yaw + (Math.random() - .5) * 2;
    }
    // Stuck against something: jump and sidestep for a moment.
    if (now > bot.progress.at + 1500) {
      const moved = Math.hypot(s.x - bot.progress.x, s.z - bot.progress.z);
      if ((mz || mx) && moved < .6 && !prone) { bot.detourUntil = now + 1200; bot.detourYaw = yaw + (Math.random() < .5 ? 1.3 : -1.3); }
      bot.progress = { x: s.x, z: s.z, at: now };
    }
    const detour = now < bot.detourUntil && bot.mode !== 'fight';
    if (detour) { yaw = bot.detourYaw; mz = 1; mx = 0; }
    if (bot.healUntil) { mx = mz = 0; sprint = false; }
    // Turn smoothly rather than snapping.
    const turn = Math.atan2(Math.sin(yaw - bot.yaw), Math.cos(yaw - bot.yaw));
    bot.yaw += Math.max(-.2, Math.min(.2, turn));
    // Movement axes are relative to the facing; recompute so a partly turned bot still heads to `yaw`.
    const rel = yaw - bot.yaw, c = Math.cos(rel), sn = Math.sin(rel);
    const rmx = mx * c - mz * sn, rmz = mx * sn + mz * c;
    this.controller.step(s, { mx: rmx, mz: rmz, yaw: bot.yaw, jump: detour && Math.random() < .08, sprint: sprint && !prone, prone }, TICK_DT);
  }

  /* ------------------------------------------------------------------------------- looting */

  private lootChest(bot: BattleBot, id: string): void {
    bot.searched.add(id);
    const taken = this.hooks.loot(id, items => {
      const pick: number[] = [];
      const have = new Set(bot.items.map(i => i.itemId));
      // A gun first (any gun beats none; keep the current one otherwise).
      let gun = bot.gunItem?.itemId;
      if (!gun) {
        const found = items.find(i => isBotGun(i.itemId));
        if (found) { pick.push(found.uid); gun = found.itemId; }
      }
      for (const i of items) {
        if (pick.includes(i.uid)) continue;
        const def = ITEMS[i.itemId];
        if (gun && def?.ammo?.guns.includes(gun)) pick.push(i.uid);
        else if (i.itemId === 'medkit' && !have.has('medkit')) pick.push(i.uid);
        else { const armor = ARMOR_BY_ITEM.get(i.itemId); if (armor && !bot.armor[armor.slot]) { pick.push(i.uid); bot.armor[armor.slot] = -1; } }
      }
      return pick;
    });
    for (const slot of Object.keys(bot.armor) as Array<keyof ArmorLoadout>) if (bot.armor[slot] === -1) bot.armor[slot] = 0;
    for (const item of taken) {
      bot.items.push(item);
      const armor = ARMOR_BY_ITEM.get(item.itemId);
      if (armor && !bot.armor[armor.slot]) bot.armor[armor.slot] = armor.id;
      if (!bot.gunItem && isBotGun(item.itemId)) { bot.gunItem = item; bot.weapon = WEAPON_BY_ITEM[item.itemId]!; }
    }
    if (bot.gunItem && !(bot.gunItem.mag ?? 0)) this.finishReload(bot);
  }

  private finishReload(bot: BattleBot): void {
    bot.reloadUntil = 0;
    const gun = bot.gun, item = bot.gunItem;
    if (!gun || !item) return;
    let need = gun.magazine - (item.mag ?? 0);
    for (const ammo of bot.ammoItems()) {
      const take = Math.min(need, ammo.count ?? 0);
      ammo.count = (ammo.count ?? 0) - take; need -= take;
      item.mag = (item.mag ?? 0) + take;
      if (!need) break;
    }
    bot.items = bot.items.filter(i => !(ITEMS[i.itemId]?.ammo && (i.count ?? 0) <= 0));
  }

  /* -------------------------------------------------------------------------------- combat */

  private shoot(bot: BattleBot, now: number): void {
    const gun = bot.gun, item = bot.gunItem, target = bot.target;
    if (!gun || !item || !target || now < bot.reactAt || bot.reloadUntil || now < bot.fireAt) return;
    if ((item.mag ?? 0) <= 0) {
      if (bot.reserve > 0) bot.reloadUntil = now + gun.reloadMs;
      return;
    }
    const s = bot.state, oy = s.y + (s.prone ? .45 : MUZZLE_HEIGHT);
    const t = target.state, tx = t.x - s.x, tz = t.z - s.z, ty = t.y + (t.prone ? .3 : 1.15) - oy;
    // Fire only once the body has actually turned onto the target and held it briefly.
    const facing = Math.atan2(-tx, -tz), off = Math.abs(Math.atan2(Math.sin(facing - bot.yaw), Math.cos(facing - bot.yaw)));
    if (off > .08) { bot.aimedAt = 0; return; }
    if (!bot.aimedAt) bot.aimedAt = now;
    if (now - bot.aimedAt < 220) return;
    const d = Math.hypot(tx, ty, tz) || 1;
    if (d > gun.range) return;
    bot.pitch = Math.atan2(ty, Math.hypot(tx, tz));
    // Lead moving targets a little and miss more at range and while moving.
    const lead = d / 400;
    const ax = tx + t.vx * lead, az = tz + t.vz * lead, len = Math.hypot(ax, ty, az) || 1;
    const spread = gun.spread * 1.2 + .006 + d * .00025 + (Math.hypot(s.vx, s.vz) > 1 ? .01 : 0);
    const spec = bulletSpec(bot.weapon, gun);
    bot.fireAt = now + Math.max(gun.fireMs, gun.auto ? gun.fireMs * 1.4 : 380 + Math.random() * 300);
    item.mag = (item.mag ?? 0) - 1;
    for (let p = 0; p < Math.max(1, gun.pellets); p++) {
      const [dx, dy, dz] = spreadDirection(ax / len, ty / len, az / len, spread, Math.random);
      const r: Round = { id: this.nextRoundId++, bot, traveled: 0, x: s.x, y: oy, z: s.z, vx: dx * spec.speed, vy: dy * spec.speed, vz: dz * spec.speed, damage: gun.damage, w: bot.weapon, range: spec.maxRange ?? gun.range, gravity: spec.gravity, drag: spec.drag ?? 0 };
      this.rounds.push(r);
      this.hooks.projectile({ t: 'proj', id: r.id, ownerId: bot.id, w: bot.weapon, kind: 'bullet', x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, gravity: spec.gravity, drag: spec.drag, maxFlightSec: spec.maxFlightSec });
    }
    this.hooks.shot({ t: 'shot', shooterId: bot.id, w: bot.weapon, ox: s.x, oy, oz: s.z, ends: [] });
  }

  private fly(now: number, players: readonly Player[]): void {
    if (!this.rounds.length) return;
    const candidates: Array<Combatant & { state: CharacterState }> = [...players.filter(p => !p.dead && !p.state.flight), ...this.bots.filter(b => !b.dead && !b.state.flight)];
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i]!;
      const ox = r.x, oy = r.y, oz = r.z;
      advanceBallistic(r, r.gravity, r.drag, TICK_DT);
      const dx = r.x - ox, dy = r.y - oy, dz = r.z - oz, distance = Math.hypot(dx, dy, dz) || 1e-6;
      const length = Math.min(distance, r.range - r.traveled);
      const hit = castCombatRay(r.bot, candidates, this.collision, now, undefined, ox, oy, oz, dx / distance, dy / distance, dz / distance, length);
      r.x = ox + dx / distance * hit.t; r.y = oy + dy / distance * hit.t; r.z = oz + dz / distance * hit.t;
      r.traveled += hit.t;
      if (!hit.target && hit.t >= length - 1e-4 && r.traveled < r.range - 1e-4) continue;
      this.rounds.splice(i, 1);
      this.hooks.projectileEnd({ t: 'projEnd', id: r.id, x: r.x, y: r.y, z: r.z, hit: !!hit.target, impact: !!hit.target || hit.t < length - 1e-4, normal: hit.normal });
      if (!hit.target || !hit.zone) continue;
      const damage = Math.round(r.damage * ZONE_DAMAGE_MULTIPLIER[hit.zone]);
      if (hit.target instanceof BattleBot && r.bot.squad && hit.target.squad === r.bot.squad) continue;
      if (hit.target instanceof BattleBot) this.hit(hit.target, damage, r.bot.name, { x: r.bot.state.x, z: r.bot.state.z }, now, hit.zone, r.bot.id);
      else this.hooks.hitPlayer(r.bot, hit.target as Player, damage, hit.zone, r.x, r.y, r.z, now);
    }
  }

  /* ------------------------------------------------------------------------------ snapshot */

  entitiesFor(player: Player, now: number, out: EntityState[]): void {
    const range = CHUNK_SIZE * ENTITY_INTEREST_RADIUS_CHUNKS;
    for (const bot of this.bots) {
      const s = bot.state;
      if (bot.dead && now - bot.deadAt > 15_000) continue;
      if (Math.hypot(s.x - player.state.x, s.z - player.state.z) > range) continue;
      const flags = (s.grounded ? EntityFlags.Grounded : 0) | (s.prone ? EntityFlags.Prone : 0) | (bot.dead ? EntityFlags.Dead : 0)
        | (s.flight === 1 ? EntityFlags.InPlane : s.flight === 2 ? EntityFlags.Freefall : s.flight === 3 ? EntityFlags.Parachute : 0)
        | (bot.mode === 'fight' && !bot.dead ? EntityFlags.Aiming : 0)
        | (Math.hypot(s.vx, s.vz) > 5 ? EntityFlags.Sprinting : 0)
        | (now < bot.knockedUntil && !bot.dead ? EntityFlags.Knocked : 0);
      out.push({ id: bot.id, kind: EntityKind.Player, x: s.x, y: s.y, z: s.z, yaw: bot.yaw, pitch: bot.pitch, flags, health: bot.health, weapon: bot.dead ? 0 : bot.weapon, armor: packArmor(bot.armor) });
    }
  }
}

/** Ordinary guns only: launchers and the flamethrower need handling bots do not have. */
export function isBotGun(itemId: string): boolean {
  const w = WEAPON_BY_ITEM[itemId];
  const spec = w ? WEAPON_SPECS[w as keyof typeof WEAPON_SPECS] : undefined;
  return spec?.kind === 'gun' && !spec.burn && (!spec.projectile || spec.projectile.kind === 'bullet');
}
