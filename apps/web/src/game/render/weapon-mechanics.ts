import { Vector3, type Euler, type Object3D } from 'three';
import { BB_UNITS_PER_METER, sampleTrack, type CharacterClip } from './character-model';
import type { WeaponVisual } from './weapons';
import type { ReloadClip, ReloadScript } from '../reload-scripts';

const DEG = Math.PI / 180;
const PX = 1 / BB_UNITS_PER_METER;
const v3: [number, number, number] = [0, 0, 0];
const r3: [number, number, number] = [0, 0, 0];

interface Part { node: Object3D; restPos: Vector3; restRot: Euler; restScale: Vector3; restVisible: boolean }

/**
 * Moving parts of one first-person gun: the slide / bolt carrier snapping back on each shot, the
 * bolt of a bolt-action rifle being worked after the shot, and the magazine leaving and coming
 * back during a reload. Uses the model's own reload clip when it has one; otherwise a procedural
 * version on whatever parts the model names (slide, bolt, magazine), so every gun gets something.
 */
export class WeaponMechanics {
  private readonly parts = new Map<string, Part>();
  private readonly slide: Part | null;
  private readonly bolt: Part | null;
  private readonly magazine: Part | null;
  private readonly barrel: Vector3;
  private readonly up: Vector3;
  private fireT = -1;
  /** The model's own after-shot clip (pump racked), and its time. */
  private readonly fireClip: CharacterClip | null;
  private readonly supportPart: Part | null;
  private pumpT = -1;
  private cycleT = -1;
  private reloadT = -1;
  private reloadLength = 1;
  private clip: CharacterClip | null = null;
  /** Whole-gun motion for guns without the named part (radians / metres, view-model space). */
  cant = 0;
  lift = 0;

  constructor(model: Object3D, private readonly visual: WeaponVisual, private readonly boltAction: boolean) {
    // Only the gun's own parts: not its markers, mounted attachments or the first-person arm.
    const visit = (o: Object3D) => {
      for (const c of o.children) {
        if (c.name.startsWith('weapon-') || c.name.startsWith('attachment-') || c.name.startsWith('first-person')) continue;
        if (c.name && !this.parts.has(c.name)) this.parts.set(c.name, { node: c, restPos: c.position.clone(), restRot: c.rotation.clone(), restScale: c.scale.clone(), restVisible: c.visible });
        visit(c);
      }
    };
    visit(model.children[0] ?? model);
    const find = (re: RegExp) => [...this.parts.entries()].find(([name, p]) => re.test(name) && !p.node.type.includes('Mesh'))?.[1] ?? null;
    this.slide = find(/^slide$/i) ?? find(/slide/i);
    this.bolt = find(/^bolt$/i) ?? find(/bolt/i);
    // A shotgun's magazine tube stays put (it is loaded shell by shell).
    this.magazine = find(/^magazine$/i) ?? [...this.parts.entries()].find(([name, p]) => /magazine|^mag$/i.test(name) && !/tube|cap/i.test(name) && !p.node.type.includes('Mesh'))?.[1] ?? null;
    this.fireClip = visual.spec?.fireClip ? visual.clips.get(visual.spec.fireClip) ?? null : null;
    this.supportPart = visual.spec?.supportPart ? this.parts.get(visual.spec.supportPart) ?? null : null;
    this.barrel = new Vector3(...(visual.spec?.barrel ?? [1, 0, 0])).normalize();
    this.up = new Vector3(...(visual.spec?.up ?? [0, 1, 0])).normalize();
  }

  /** A round was fired. */
  fire(): void {
    this.fireT = 0;
    if (this.fireClip) this.pumpT = 0;
    if (this.boltAction) this.cycleT = 0;
  }

  /** A reload started; `seconds` is its full length (animations end with it). */
  reload(seconds: number, script?: ReloadScript | null): void {
    this.reloadT = 0;
    this.reloadLength = Math.max(.3, seconds);
    this.clip = this.visual.reloadClip ? this.visual.clips.get(this.visual.reloadClip) ?? null : null;
    // The script's part clips this model has (the first name it knows of each).
    this.scripted = [];
    for (const c of script?.clips ?? []) {
      const clip = c.clips.map((n) => this.visual.clips.get(n)).find(Boolean);
      if (clip) this.scripted.push({ clip, step: c, peak: clipPeak(clip) });
    }
    this.cycleT = -1;
  }

  /** The script's part clips playing in this reload. */
  private scripted: Array<{ clip: CharacterClip; step: ReloadClip; peak: number }> = [];

  /** A named part's place in the world (`rest`: where it sits when not moved), if the model has one. */
  partWorld(re: RegExp, out: Vector3, rest = false): Vector3 | null {
    const part = [...this.parts.entries()].find(([name]) => re.test(name))?.[1];
    const parent = part?.node.parent;
    if (!part || !parent) return null;
    parent.updateWorldMatrix(true, false);
    if (rest) return out.copy(part.restPos).applyMatrix4(parent.matrixWorld);
    part.node.updateWorldMatrix(false, false);
    return out.setFromMatrixPosition(part.node.matrixWorld);
  }

  cancel(): void {
    this.reloadT = -1; this.cycleT = -1; this.fireT = -1; this.pumpT = -1;
    this.reset();
  }

  get reloading(): boolean { return this.reloadT >= 0; }
  /** A bolt action being worked after a shot (the hand goes to the bolt handle). */
  get boltWorked(): boolean { return this.cycleT >= .08 && this.cycleT < .22 + 1.25 + .05; }

  /** How far the part the support hand holds (a pump's fore-end) has moved from rest, in world space. */
  supportShift(out: Vector3): Vector3 {
    const p = this.supportPart, parent = p?.node.parent;
    if (!p || !parent) return out.set(0, 0, 0);
    parent.updateWorldMatrix(true, false);
    return out.copy(p.node.position).applyMatrix4(parent.matrixWorld).sub(p.restPos.clone().applyMatrix4(parent.matrixWorld));
  }

  update(dt: number): void {
    this.reset();
    this.cant = 0; this.lift = 0;
    // Slide / carrier recoil: back fast, home a little slower.
    if (this.fireT >= 0) {
      this.fireT += dt;
      const t = this.fireT, back = t < .035 ? t / .035 : Math.max(0, 1 - (t - .035) / .07);
      const part = this.slide ?? (this.boltAction ? null : this.bolt);
      if (part) part.node.position.addScaledVector(this.barrel, -back * (this.slide ? 2.2 : 2.6) * PX);
      if (t > .11) this.fireT = -1;
    }
    // Bolt action: lift, pull, push, lower — in step with the rechamber sound (starts at 0.22 s).
    if (this.cycleT >= 0) {
      this.cycleT += dt;
      const t = this.cycleT - .22, len = 1.25;
      if (t >= len) this.cycleT = -1;
      else if (t > 0) {
        const k = t / len;
        const lift = k < .18 ? k / .18 : k > .82 ? (1 - k) / .18 : 1;
        const pull = k < .25 ? 0 : k < .45 ? (k - .25) / .2 : k < .6 ? 1 : k < .78 ? 1 - (k - .6) / .18 : 0;
        if (this.bolt) {
          this.bolt.node.rotateOnAxis(this.barrel, -lift * 70 * DEG);
          this.bolt.node.position.addScaledVector(this.barrel, -pull * 5 * PX);
        }
        // The shooter rolls the rifle slightly to work the bolt, with or without a bolt part.
        this.cant = -lift * .18; this.lift = -lift * .015;
      }
    }
    // Pump action: racked by the model's own clip just after the shot (with its sound).
    if (this.pumpT >= 0 && this.fireClip) {
      this.pumpT += dt;
      const t = this.pumpT - .2;
      if (t >= this.fireClip.length) this.pumpT = -1;
      else if (t > 0) this.playClip(this.fireClip, t);
    }
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      const k = this.reloadT / this.reloadLength;
      if (k >= 1) { this.reloadT = -1; this.clip = null; this.reset(); return; }
      if (this.clip) this.playClip(this.clip, k * this.clip.length);
      else if (this.scripted.length) {
        // Each part's own clip: forward while opening, held, backwards while closing.
        // A clip that goes out and comes back (most do) opens up to its furthest frame and closes
        // over the rest; one that only goes out is played back for the close.
        for (const { clip, step, peak } of this.scripted) {
          if (k < step.at || k > step.until) continue;
          const open = Math.min(1, (k - step.at) / Math.max(1e-3, step.open));
          const close = step.close ? Math.min(1, Math.max(0, (k - (step.until - step.close)) / step.close)) : 0;
          const roundTrip = peak < clip.length * .85;
          this.playClip(clip, close > 0 ? (roundTrip ? peak + close * (clip.length - peak) : (1 - close) * clip.length) : open * (roundTrip ? peak : clip.length));
          // A swapped part (the old magazine) is gone while out; the new one comes up in its place.
          if (step.swap && open >= 1 && close <= 0 && k > step.at + step.open + .04 && k < step.until - (step.close ?? 0) - .02) {
            for (const name of clip.bones.keys()) { const part = this.parts.get(name); if (part) part.node.visible = false; }
          }
        }
      } else if (this.magazine) {
        // Out (drops along "down"), away, back in, seated.
        const out = k < .12 ? 0 : k < .32 ? (k - .12) / .2 : k < .62 ? 1 : k < .82 ? 1 - (k - .62) / .2 : 0;
        this.magazine.node.position.addScaledVector(this.up, -out * 9 * PX);
        this.magazine.node.visible = !(k > .3 && k < .64);
        // Charging handle / slide racked at the end.
        if (k > .86 && (this.slide || this.bolt)) {
          const rack = Math.sin((k - .86) / .14 * Math.PI);
          (this.slide ?? this.bolt)!.node.position.addScaledVector(this.barrel, -rack * 2.5 * PX);
        }
      }
    }
  }

  private playClip(clip: CharacterClip, time: number): void {
    for (const [name, p] of this.parts) {
      const tracks = clip.bones.get(name);
      if (!tracks) continue;
      r3[0] = r3[1] = r3[2] = 0; v3[0] = v3[1] = v3[2] = 0;
      if (tracks.rotation) sampleTrack(tracks.rotation, time, r3);
      if (tracks.position) sampleTrack(tracks.position, time, v3);
      p.node.rotation.set(p.restRot.x - r3[0] * DEG, p.restRot.y - r3[1] * DEG, p.restRot.z + r3[2] * DEG, 'ZYX');
      p.node.position.set(p.restPos.x - v3[0] * PX, p.restPos.y + v3[1] * PX, p.restPos.z + v3[2] * PX);
      if (tracks.scale) { sampleTrack(tracks.scale, time, r3); p.node.scale.set(p.restScale.x * r3[0], p.restScale.y * r3[1], p.restScale.z * r3[2]); }
    }
  }

  private reset(): void {
    for (const p of this.parts.values()) {
      p.node.position.copy(p.restPos); p.node.rotation.copy(p.restRot); p.node.scale.copy(p.restScale);
      p.node.visible = p.restVisible;
    }
  }
}

/** The time a clip moves its parts furthest from rest (where an opening move ends). */
function clipPeak(clip: CharacterClip): number {
  let best = clip.length, most = -1;
  for (let i = 0; i <= 24; i++) {
    const t = clip.length * i / 24;
    let d = 0;
    for (const tracks of clip.bones.values()) {
      if (tracks.position) { sampleTrack(tracks.position, t, v3); d += Math.hypot(v3[0], v3[1], v3[2]) / 16; }
      if (tracks.rotation) { sampleTrack(tracks.rotation, t, r3); d += Math.hypot(r3[0], r3[1], r3[2]) * DEG; }
    }
    if (d > most + 1e-6) { most = d; best = t; }
  }
  return best;
}
