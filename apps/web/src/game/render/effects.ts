import {
  AdditiveBlending,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';
import { GRENADE_GRAVITY, WeaponId, weaponSpec, advanceBallistic, type C4Pose, type ProjectileEvent } from '@zion/shared';
import { SpentBrass } from './spent-brass';
import { Mask, makeRayHit, stepProjectile, type CollisionWorld, type ProjectileState } from '@zion/physics';
import type { SoundBank } from '../audio';
import { ParticleFX, ParticleSystem } from './particles';
import { BulletHoles } from './bullet-holes';

/** A launcher round replayed from the server's launch event (ballistic, ended by 'projEnd'). */
interface FlyingRound {
  kind: ProjectileEvent['kind'];
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  drag: number;
  maxAge: number;
  mesh: Object3D;
  age: number;
}

interface FlyingGrenade {
  age: number;
  s: ProjectileState;
  mesh: Object3D;
  spin: Vector3;
}

export interface ShotInfo {
  weapon: number;
  /** Muzzle position and aim direction. */
  muzzle: Vector3;
  dir: Vector3;
  /** Ejection port (for casings) and the gun's right side. */
  eject: Vector3 |null;
  right: Vector3 | null;
  /** Pellet end points, flattened xyz. */
  ends: ArrayLike<number>;
  /** Suppressed: no flash, a short muffled report heard only nearby. */
  suppressed?: boolean;
}

/**
 * Combat visuals and sounds: bullets in flight, muzzle flash + barrel heat, casings, impacts,
 * grenade flights and explosions, built on the pooled particle system.
 */
import { SmokeClouds } from './smoke-clouds';

export class CombatEffects {
  private disposed = false;
  readonly particles: ParticleSystem;
  private readonly bulletHoles: BulletHoles;
  private readonly roundHit = makeRayHit();
  private readonly flashLights: PointLight[] = [];
  private flashNext = 0;
  /** Pooled so the scene's light count never changes (that would recompile every shader). */
  private readonly blastLights: PointLight[] = [];
  private blastNext = 0;
  private readonly grenades = new Map<number, FlyingGrenade>();
  private readonly c4Charges = new Map<number, { mesh: Object3D; pose: C4Pose }>();
  private readonly c4Up = new Vector3(0, 1, 0);
  private readonly c4Normal = new Vector3();
  /** Blast flashes fading out (pooled lights). */
  private readonly rings: Array<{ light: PointLight; t: number; radius: number }> = [];
  /** Per-shooter barrel heat 0…1 (keyed by entity id) and where their muzzle last was. */
  private readonly heat = new Map<number, { h: number; at: Vector3 }>();
  /** Camera shake strength (decays); the engine adds it to the camera position. */
  shake = 0;
  private readonly rounds = new Map<number, FlyingRound>();
  /** Display models for rounds in flight (nose → +X), keyed by projectile kind. */
  private projectileModels = new Map<string, Object3D>();
  /** Flamethrower loop per shooter: when its sound runs out, and its stop timer. */
  private readonly flameSound = new Map<number, { until: number; last: number; channel: object }>();
  private readonly tmpDir = new Vector3();
  private readonly xAxis = new Vector3(1, 0, 0);
  private readonly fallbackRound = new Mesh(new IcosahedronGeometry(0.08), new MeshBasicMaterial({ color: 0x777755 }));
  private readonly bulletModel = new Mesh(new IcosahedronGeometry(.025, 1), new MeshBasicMaterial({ color: 0xffe6ac, toneMapped: false }));
  private readonly bulletGlow = new Mesh(new IcosahedronGeometry(.055, 1), new MeshBasicMaterial({ color: 0xffd183, transparent: true, opacity: .18, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
  private readonly fallbackGrenade = new Mesh(new IcosahedronGeometry(0.07), new MeshBasicMaterial({ color: 0x445533 }));

  /** Thrown grenade models by weapon id (frag uses `grenadeModel`). */
  grenadeModels = new Map<number, Object3D>();
  readonly smoke: SmokeClouds;

  setProjectileModels(models: Map<string, Object3D>): void {
    this.projectileModels = models;
  }

  /** Spent cases and dropped magazines (pooled, a few per shooter). */
  readonly brass: SpentBrass;
  private lastClink = 0;

  constructor(
    private readonly scene: Scene,
    private readonly grenadeModel: Object3D | null,
    private readonly sounds: SoundBank | null,
    private readonly listener: () => Vector3,
  ) {
    this.particles = new ParticleSystem(scene);
    this.brass = new SpentBrass(scene);
    // Each case that lands clinks (a few at most at once: a burst is a patter, not a wall of sound).
    this.brass.onClink = (at, strength) => {
      const now = performance.now();
      if (now - this.lastClink < 35) return;
      this.lastClink = now;
      this.sounds?.play(Math.random() < .5 ? 'casingDrop1' : 'casingDrop2', { at: { x: at.x, y: at.y, z: at.z }, volume: .25 + .55 * strength, rate: .92 + Math.random() * .16, maxDistance: 18 });
    };
    this.smoke = new SmokeClouds(scene);
    this.bulletHoles = new BulletHoles(scene);
    this.bulletModel.add(this.bulletGlow);
    for (let i = 0; i < 4; i++) {
      const l = new PointLight(0xffc070, 0, 9, 1.6);
      this.flashLights.push(l);
      scene.add(l);
    }
    for (let i = 0; i < 2; i++) {
      const l = new PointLight(0xffa040, 0, 25, 1.5);
      this.blastLights.push(l);
      scene.add(l);
    }
  }

  /* ----------------------------------------- guns ------------------------------------------ */

  shot(shooterId: number, info: ShotInfo): void {
    const { muzzle: m, dir: d } = info;
    const spec = weaponSpec(info.weapon);
    if (spec?.kind === 'gun' && spec.fire === 'flame') return this.flame(shooterId, m, d, spec.range);
    if (spec?.kind === 'gun' && spec.fire === 'projectile') return this.launchFlash(info.weapon, m, d);
    const heavy = info.weapon === WeaponId.Shotgun || info.weapon === WeaponId.Saiga12 || info.weapon === WeaponId.DoubleBarrel || info.weapon === WeaponId.AWM || info.weapon === WeaponId.Barrett || info.weapon === WeaponId.SVD;
    if (!info.suppressed) ParticleFX.muzzleFlash(this.particles, m.x, m.y, m.z, d.x, d.y, d.z, heavy);
    // The spent case out of the port (a revolver keeps its cases, a break-action drops them on reloading).
    if (info.eject && info.right && info.weapon !== WeaponId.Revolver && info.weapon !== WeaponId.DoubleBarrel) {
      const shell = info.weapon === WeaponId.Shotgun || info.weapon === WeaponId.Saiga12;
      // Bolt and pump actions throw the case when the action is worked, just after the shot.
      const late = info.weapon === WeaponId.Shotgun || info.weapon === WeaponId.AWM || info.weapon === WeaponId.Kar98k || info.weapon === WeaponId.Remington700;
      const at = info.eject.clone(), right = info.right.clone(), dir = d.clone();
      if (late) setTimeout(() => this.brass.eject(shooterId, at, right, dir, shell ? 'shell' : 'rifle'), 420);
      else this.brass.eject(shooterId, at, right, dir, shell ? 'shell' : 'rifle');
    }
    const light = this.flashLights[this.flashNext++ % this.flashLights.length]!;
    light.position.copy(m);
    light.intensity = info.suppressed ? 0 : heavy ? 14 : 9;
    const h = this.heat.get(shooterId) ?? { h: 0, at: new Vector3() };
    h.h = Math.min(1, h.h + (heavy ? 0.35 : 0.09));
    h.at.copy(m);
    this.heat.set(shooterId, h);
    this.gunSound(info.weapon, m, !!info.suppressed);
  }

  /** Per-gun voice: shared recordings pitched and levelled to the calibre. */
  private gunSound(weapon: number, at: Vector3, suppressed = false): void {
    const bank = this.sounds;
    if (!bank) return;
    // A suppressor keeps the gun's voice but muffles it: quieter, thinner, heard only nearby.
    const s = { play: (name: Parameters<SoundBank['play']>[0], o: { at: Vector3; rate?: number; volume?: number; maxDistance?: number }) => bank.play(name, suppressed ? { ...o, rate: (o.rate ?? 1) * 1.18, volume: (o.volume ?? 1) * .4, maxDistance: (o.maxDistance ?? 90) * .3 } : o) };
    // A recording chosen in the Studio wins over the gun's usual voice.
    const own = (weaponSpec(weapon) as { sound?: string } | undefined)?.sound as Parameters<SoundBank['play']>[0] | undefined;
    if (own) { s.play(own, { at, volume: 0.9, maxDistance: 100 }); if (weapon === WeaponId.AWM || weapon === WeaponId.Kar98k || weapon === WeaponId.Remington700) this.rechamber(at, 1.15); return; }
    switch (weapon) {
      case WeaponId.PKM: s.play('pkmShot', { at, volume: 1, maxDistance: 130 }); break;
      case WeaponId.Shotgun: s.play('pumpShot', { at, maxDistance: 90 }); this.pumpRack(at); break;
      case WeaponId.Saiga12: s.play('shotgunShot', { at, rate: 1.12, volume: 0.95, maxDistance: 90 }); break;
      case WeaponId.DoubleBarrel: s.play('shotgunShot', { at, rate: 0.88, volume: 1.15, maxDistance: 100 }); break;
      case WeaponId.AWM: s.play('sniperRifleShot', { at, volume: 1.25, maxDistance: 180 }); this.rechamber(at, 1.15); break;
      case WeaponId.Barrett: s.play('barrettShot', { at, volume: 1.3, maxDistance: 180 }); break;
      case WeaponId.SVD: s.play('sniperRifleShot', { at, rate: 1.05, volume: 1.1, maxDistance: 160 }); break;
      case WeaponId.GL18: s.play('pistol9mmShot', { at, volume: 0.8, maxDistance: 70 }); break;
      case WeaponId.Revolver: s.play('magnumShot', { at, rate: 0.95, volume: 1.05, maxDistance: 90 }); break;
      case WeaponId.MP5: s.play('pistol9mmShot', { at, rate: 1.05, volume: 0.7, maxDistance: 60 }); break;
      case WeaponId.Deagle: s.play('magnumShot', { at, volume: 1.1, maxDistance: 100 }); break;
      case WeaponId.Uzi: s.play('pistol9mmShot', { at, rate: 1.1, volume: 0.7, maxDistance: 60 }); break;
      case WeaponId.ScarH: s.play('akShot', { at, rate: .9, volume: 1, maxDistance: 120 }); break;
      case WeaponId.Kar98k: s.play('sniperRifleShot', { at, rate: .95, volume: 1.2, maxDistance: 170 }); this.rechamber(at, 1.15); break;
      case WeaponId.Remington700: s.play('sniperRifleShot', { at, rate: 1.02, volume: 1.15, maxDistance: 170 }); this.rechamber(at, 1.15); break;
      case WeaponId.Mini14: s.play('rifleShot', { at, rate: 1.02, volume: 0.95, maxDistance: 120 }); break;
      case WeaponId.Vector: s.play('pistol9mmShot', { at, rate: 1.15, volume: 0.65, maxDistance: 60 }); break;
      case WeaponId.P90: s.play('pistol9mmShot', { at, rate: 1.25, volume: 0.7, maxDistance: 65 }); break;
      case WeaponId.ScarL: s.play('rifleShot', { at, rate: 1.04, volume: 0.9, maxDistance: 100 }); break;
      case WeaponId.M16: s.play('rifleShot', { at, rate: 1.08, volume: 0.9, maxDistance: 100 }); break;
      case WeaponId.Beryl: s.play('rifleShot', { at, rate: .98, volume: 0.9, maxDistance: 100 }); break;
      case WeaponId.M762: s.play('rifleShot', { at, rate: .92, volume: 0.95, maxDistance: 105 }); break;
      case WeaponId.M4A1: s.play('rifleShot', { at, rate: 1.06, volume: 0.85, maxDistance: 100 }); break;
      case WeaponId.AUG: s.play('rifleShot', { at, rate: 1.03, volume: 0.85, maxDistance: 100 }); break;
      default: s.play('akShot', { at, volume: 0.9, maxDistance: 90 });
    }
  }

  /** Bolt-action rifles: the bolt is worked and the case ejected just after each shot. */
  /** Pump action: the fore-end racked back and forward right after the shot. */
  private pumpRack(at: Vector3): void {
    const where = at.clone();
    setTimeout(() => this.sounds?.play('shotgunPump', { at: where, volume: .85, maxDistance: 45 }), 200);
  }

  private rechamber(at: Vector3, rate: number): void {
    const where = at.clone();
    setTimeout(() => this.sounds?.play('rechamber', { at: where, rate, volume: .8, maxDistance: 40 }), 220);
  }

  /** Launchers: muzzle blast and launch sound (the round itself arrives as a 'proj' event). */
  private launchFlash(weapon: number, m: Vector3, d: Vector3): void {
    const rocket = weapon === WeaponId.RocketLauncher;
    if (weapon !== WeaponId.Crossbow) {
      ParticleFX.muzzleFlash(this.particles, m.x, m.y, m.z, d.x, d.y, d.z, true);
      const light = this.flashLights[this.flashNext++ % this.flashLights.length]!;
      light.position.copy(m);
      light.intensity = rocket ? 20 : 12;
    }
    if (rocket) {
      // Back-blast out of the rear of the tube.
      for (let i = 0; i < 8; i++) this.particles.smoke.emit({ x: m.x - d.x * 1.2, y: m.y, z: m.z - d.z * 1.2, vx: -d.x * 5, vy: 0.6, vz: -d.z * 5, spread: 1.5, life: 1.4, size: 0.4, sizeEnd: 1.6, color: [0.8, 0.78, 0.74], alpha: 0.6, drag: 2.5 });
      this.sounds?.play('rocketLaunch', { at: m, volume: 1.1, maxDistance: 120 });
    } else if (weapon === WeaponId.GrenadeLauncher || weapon === WeaponId.M79) this.sounds?.play('grenadeLauncherShot', { at: m, volume: 1, maxDistance: 90 });
    else this.sounds?.play('arrowFly', { at: m, volume: 0.9, maxDistance: 40 });
  }

  /** One flamethrower fuel tick: fire particles plus a looping roar per shooter. */
  private flame(shooterId: number, m: Vector3, d: Vector3, range: number): void {
    ParticleFX.flame(this.particles, m.x, m.y, m.z, d.x, d.z, range);
    const light = this.flashLights[this.flashNext++ % this.flashLights.length]!;
    light.position.set(m.x + d.x * 2, m.y, m.z + d.z * 2);
    light.intensity = 14;
    const now = performance.now();
    let f = this.flameSound.get(shooterId);
    if (!f) this.flameSound.set(shooterId, (f = { until: 0, last: 0, channel: {} }));
    f.last = now;
    if (now >= f.until) f.until = now + (this.sounds?.play('flame', { at: m, volume: 0.9, maxDistance: 50, channel: f.channel }) ?? 0) * 1000 - 60;
  }

  /* ------------------------------------- launcher rounds ------------------------------------ */

  launch(e: ProjectileEvent): void {
    if (this.rounds.has(e.id)) return;
    const model = e.kind === 'bullet' ? this.bulletModel : this.projectileModels.get(e.kind);
    const mesh = (model ?? this.fallbackRound).clone(true);
    mesh.position.set(e.x, e.y, e.z);
    this.scene.add(mesh);
    this.rounds.set(e.id, { kind: e.kind, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, gravity: e.gravity, drag: e.drag ?? 0, maxAge: e.maxFlightSec ?? 8, mesh, age: 0 });
  }

  endRound(id: number, x: number, y: number, z: number, hitBody: boolean, impact = true, normal?: [number, number, number]): void {
    const r = this.rounds.get(id);
    if (!r) return;
    this.scene.remove(r.mesh);
    this.rounds.delete(id);
    if (!impact) return;
    if (r.kind === 'bullet') {
      ParticleFX.impact(this.particles, x, y, z);
      if (!hitBody && normal) this.bulletHoles.add(x, y, z, normal);
    } else if (r.kind === 'bolt') {
      ParticleFX.impact(this.particles, x, y, z);
      this.sounds?.play(hitBody ? 'arrowHitSoft' : 'arrowHitHard', { at: { x, y, z }, volume: 0.9, maxDistance: 35 });
    }
  }

  /** Keeps a shooter's barrel glow attached to the moving muzzle. */
  trackMuzzle(shooterId: number, at: Vector3 | null): void {
    const h = this.heat.get(shooterId);
    if (h && at) h.at.copy(at);
  }

  /* --------------------------------------- grenades ---------------------------------------- */

  throwGrenade(id: number, s: ProjectileState, weapon?: number): void {
    if (this.grenades.has(id)) return;
    const mesh = ((weapon ? this.grenadeModels.get(weapon) : undefined) ?? this.grenadeModel ?? this.fallbackGrenade).clone(true);
    mesh.position.set(s.x, s.y, s.z);
    this.scene.add(mesh);
    this.grenades.set(id, { age: 0, s: { ...s, resting: false }, mesh, spin: new Vector3(Math.random() * 10, Math.random() * 6, Math.random() * 10) });
  }

  syncC4(charges: readonly C4Pose[]): void {
    const live = new Set(charges.map(c => c.id));
    for (const [id, c] of this.c4Charges) if (!live.has(id)) { this.scene.remove(c.mesh); this.c4Charges.delete(id); }
    for (const pose of charges) {
      let c = this.c4Charges.get(pose.id);
      if (!c) {
        const mesh = (this.projectileModels.get('c4') ?? this.fallbackGrenade).clone(true);
        mesh.position.set(pose.x, pose.y, pose.z);
        mesh.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
        this.scene.add(mesh);
        c = { mesh, pose }; this.c4Charges.set(pose.id, c);
      }
      c.pose = pose;
      if (pose.stuck) c.mesh.quaternion.setFromUnitVectors(this.c4Up, this.c4Normal.set(pose.nx, pose.ny, pose.nz).normalize());
    }
  }

  explode(id: number, x: number, y: number, z: number, radius: number, kind: 'grenade' | 'grenade40' | 'rocket' | 'flash' | 'smoke' = 'grenade'): void {
    const c4 = this.c4Charges.get(id);
    if (c4) { this.scene.remove(c4.mesh); this.c4Charges.delete(id); }
    const round = this.rounds.get(id);
    if (round) {
      this.scene.remove(round.mesh);
      this.rounds.delete(id);
    }
    const g = this.grenades.get(id);
    if (g) {
      this.scene.remove(g.mesh);
      this.grenades.delete(id);
    }
    if (kind === 'flash') {
      // Stun grenade: a white flash and a sharp bang, no fire.
      ParticleFX.impact(this.particles, x, y + .1, z);
      const light = this.blastLights[this.blastNext++ % this.blastLights.length]!;
      light.distance = radius * 2.5; light.color.set(0xffffff); light.position.set(x, y + .6, z);
      this.rings.push({ light, t: 0, radius: radius * .6 });
      this.sounds?.play('explosion', { at: { x, y, z }, volume: 1.4, maxDistance: 140, refDistance: 10 });
      return;
    }
    ParticleFX.explosion(this.particles, x, y, z, radius);
    const light = this.blastLights[this.blastNext++ % this.blastLights.length]!;
    light.color.set(0xffa040);
    light.distance = radius * 3.5;
    light.position.set(x, y + 1, z);
    this.rings.push({ light, t: 0, radius });
    const cam = this.listener();
    const d = Math.hypot(cam.x - x, cam.z - z);
    this.shake = Math.max(this.shake, Math.max(0, 1 - d / (radius * 5)) * 0.7);
    if (kind === 'rocket') {
      this.sounds?.play('rocketExplosion', { at: { x, y, z }, volume: 1.3, maxDistance: 150, refDistance: 10 });
      // Burning debris left on the ground.
      for (let i = 0; i < 6; i++) ParticleFX.burning(this.particles, x + (Math.random() - 0.5) * radius * 0.5, y, z + (Math.random() - 0.5) * radius * 0.5);
    } else this.sounds?.play('explosion', { at: { x, y, z }, volume: 1.2, maxDistance: 120, refDistance: 8 });
  }

  /* ----------------------------------------- frame ----------------------------------------- */

  update(dt: number, world: CollisionWorld | null | undefined): void {
    this.bulletHoles.update();
    this.brass.update(dt, world);

    for (const l of this.flashLights) l.intensity = Math.max(0, l.intensity - dt * 220);
    for (const [id, h] of this.heat) {
      h.h -= dt * 0.35;
      if (h.h <= 0) this.heat.delete(id);
      else ParticleFX.barrelGlow(this.particles, h.at.x, h.at.y, h.at.z, h.h);
    }

    this.smoke.update(dt);
    for (const [id, g] of this.grenades) {
      g.age += dt;
      if (g.age > 12) { this.scene.remove(g.mesh); this.grenades.delete(id); }
    }
    for (const c of this.c4Charges.values()) {
      const k = 1 - Math.exp(-dt * 22);
      c.mesh.position.lerp(this.c4Normal.set(c.pose.x, c.pose.y, c.pose.z), k);
      if (!c.pose.stuck) c.mesh.rotation.x += dt * 6;
    }
    if (world) {
      for (const g of this.grenades.values()) {
        stepProjectile(g.s, world, GRENADE_GRAVITY, dt);
        g.mesh.position.set(g.s.x, g.s.y - 0.06, g.s.z);
        if (!g.s.resting) g.mesh.rotation.set(g.mesh.rotation.x + g.spin.x * dt, g.mesh.rotation.y + g.spin.y * dt, g.mesh.rotation.z + g.spin.z * dt);
      }
    }

    for (const [id, r] of this.rounds) {
      const step = Math.min(dt, Math.max(0, r.maxAge - r.age));
      r.age += dt;
      const ox = r.x, oy = r.y, oz = r.z;
      advanceBallistic(r, r.gravity, r.drag, step);
      if (world && r.kind === 'bullet') {
        const dx = r.x - ox, dy = r.y - oy, dz = r.z - oz;
        const len = Math.hypot(dx, dy, dz);
        // Locally sweep geometry to keep the visible round out of walls while awaiting projEnd.
        if (len > 0 && world.raycast(ox, oy, oz, dx / len, dy / len, dz / len, len, Mask.Weapon, this.roundHit)) {
          r.mesh.visible = false;
        }
      }
      r.mesh.position.set(r.x, r.y, r.z);
      const sp = Math.hypot(r.vx, r.vy, r.vz) || 1;
      this.tmpDir.set(r.vx / sp, r.vy / sp, r.vz / sp);
      r.mesh.quaternion.setFromUnitVectors(this.xAxis, this.tmpDir);
      if (r.kind === 'rocket') ParticleFX.rocketTrail(this.particles, r.x - this.tmpDir.x * 0.5, r.y - this.tmpDir.y * 0.5, r.z - this.tmpDir.z * 0.5, this.tmpDir.x, this.tmpDir.y, this.tmpDir.z);
      else if (r.kind === 'grenade40') ParticleFX.smokeTrail(this.particles, r.x, r.y, r.z);
      else if (r.kind === 'bolt') ParticleFX.boltTrail(this.particles, r.x, r.y, r.z);
      // Safety net if the end event was lost.
      if (r.age > r.maxAge + .25) {
        this.scene.remove(r.mesh);
        this.rounds.delete(id);
      }
    }
    const nowMs = performance.now();
    for (const [id, f] of this.flameSound) {
      if (nowMs - f.last > 220) {
        this.sounds?.stop(f.channel);
        this.flameSound.delete(id);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.t += dt;
      const k = r.t / 0.5;
      if (k >= 1) {
        r.light.intensity = 0;
        this.rings.splice(i, 1);
        continue;
      }
      r.light.intensity = 60 * (1 - k) ** 2;
    }
    this.particles.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bulletHoles.dispose();
    this.brass.dispose();
    for (const mesh of [this.bulletModel, this.bulletGlow, this.fallbackRound, this.fallbackGrenade]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    for (const l of this.flashLights) this.scene.remove(l);
    for (const l of this.blastLights) this.scene.remove(l);
    this.smoke.dispose();
    for (const g of this.grenades.values()) this.scene.remove(g.mesh);
    for (const c of this.c4Charges.values()) this.scene.remove(c.mesh);
    this.c4Charges.clear();
    for (const r of this.rounds.values()) this.scene.remove(r.mesh);
    for (const f of this.flameSound.values()) this.sounds?.stop(f.channel);
    this.flameSound.clear();
    this.grenades.clear();
    this.rounds.clear();
    this.heat.clear();
    this.rings.length = 0;
    this.particles.dispose();
  }
}
