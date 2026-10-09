import type { Vector3 } from 'three';
import { bindVolume } from '@/lib/settings';

export const SOUND_FILES = {
  akShot: '/sounds/ak47-shot.mp3',
  akReload: '/sounds/ak47-reload.mp3',
  shotgunShot: '/sounds/shotgun-shot.mp3',
  shotgunReload: '/sounds/shotgun-reload.mp3',
  glockReload: '/sounds/glock-gun-reload.mp3',
  explosion: '/sounds/grenade-explosion.mp3',
  doubleBarrelReload: '/sounds/Double-barrel-reload.mp3',
  arrowFly: '/sounds/arrow-fly.mp3',
  arrowHitHard: '/sounds/arrow-hit-hard.mp3',
  arrowHitSoft: '/sounds/arrow-hit-soft.mp3',
  flame: '/sounds/flame-thrower-128555.mp3',
  grenadeLauncherShot: '/sounds/grenade-launcher-2.mp3',
  rocketExplosion: '/sounds/rocket-explosive.mp3',
  rocketLaunch: '/sounds/rocket-launch.mp3',
  rocketReload: '/sounds/rocket-launcher-reload.mp3',
  zombieGroan1: '/sounds/zombie-goan.mp3',
  zombieGroan2: '/sounds/zombie-goan-2.mp3',
  zombieGroan3: '/sounds/zombie-goan-3.mp3',
  zombieGroan4: '/sounds/zombie-goan-4.mp3',
  zombieGrowl: '/sounds/zombie-grow.mp3',
  zombieHurt: '/sounds/zombie-hurt.mp3',
  // Private (UI) sounds: only the local player hears them.
  uiClick: '/sounds/click.mp3',
  equip: '/sounds/ui-equip.mp3',
  questAccept: '/sounds/quest-accept.wav',
  questComplete: '/sounds/quest-complete.wav',
  eat: '/sounds/eat-sound.mp3',
  // World sounds every nearby player hears (positional).
  footsteps: '/sounds/footsteps-in-soft-material.mp3',
} as const;

export type SoundName = keyof typeof SOUND_FILES;

export interface PlayOptions {
  volume?: number;
  rate?: number;
  /**
   * World position: louder and clearer up close, quieter and muffled further away, silent beyond
   * `maxDistance` (default 70 m). Full volume within `refDistance` (default 3 m).
   */
  maxDistance?: number;
  refDistance?: number;
  /** World position; volume falls off with distance to the listener. */
  at?: { x: number; y: number; z: number };
  /** Owner key: every sound played with it can be cut off later with `stop(channel)`. */
  channel?: object;
}

/**
 * Preloaded, decoded sound effects (decoded during the loading screen, never mid-game).
 * Sounds are positional only in loudness and stereo pan, which suits the top-down camera.
 */
export class SoundBank {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly channels = new WeakMap<object, Set<{ src: AudioBufferSourceNode; gain: GainNode }>>();
  private readonly releaseVolume: () => void;

  constructor(private readonly listener: () => Vector3) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.releaseVolume = bindVolume(this.master.gain);
    this.master.connect(this.ctx.destination);
  }

  async load(onProgress?: (p: number) => void): Promise<void> {
    const names = Object.keys(SOUND_FILES) as SoundName[];
    let done = 0;
    await Promise.all(
      names.map(async (name) => {
        const res = await fetch(SOUND_FILES[name]);
        if (!res.ok) throw new Error(`sound ${SOUND_FILES[name]} unavailable (${res.status})`);
        this.buffers.set(name, await this.ctx.decodeAudioData(await res.arrayBuffer()));
        onProgress?.(++done / names.length);
      }),
    );
  }

  private readonly synth = new Map<string, AudioBuffer>();

  /**
   * Gear sound for putting armour on / taking it off, synthesised once (no sample needed):
   * a fabric rustle with strap/buckle clicks; heavy (plated) gear adds a dull metal clank.
   */
  playEquip(heavy: boolean, volume = 0.7): void {
    const key = heavy ? 'equipHeavy' : 'equip';
    let buf = this.synth.get(key);
    if (!buf) {
      const rate = this.ctx.sampleRate;
      const len = Math.floor(rate * 0.55);
      buf = this.ctx.createBuffer(1, len, rate);
      const d = buf.getChannelData(0);
      let lp = 0;
      let seed = heavy ? 7 : 3;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647 - 0.5;
      };
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        // Rustle: low-passed noise with two swells.
        lp += (rnd() - lp) * 0.18;
        const swell = Math.exp(-((t - 0.08) ** 2) / 0.003) + 0.7 * Math.exp(-((t - 0.26) ** 2) / 0.004);
        let v = lp * 1.6 * swell;
        // Buckle / strap clicks.
        for (const [at, f] of [[0.15, 2400], [0.31, 3100]] as const) {
          if (t >= at) v += Math.sin(2 * Math.PI * f * (t - at)) * Math.exp(-(t - at) * 90) * 0.35;
        }
        if (heavy && t >= 0.2) {
          const u = t - 0.2;
          v += (Math.sin(2 * Math.PI * 340 * u) + 0.5 * Math.sin(2 * Math.PI * 917 * u)) * Math.exp(-u * 14) * 0.3;
        }
        d[i] = Math.max(-1, Math.min(1, v));
      }
      this.synth.set(key, buf);
    }
    this.unlock();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.95 + Math.random() * 0.1;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.master);
    src.start();
  }

  /** Length of a sound in seconds (used to time reloads to their audio). */
  duration(name: SoundName): number {
    return this.buffers.get(name)?.duration ?? 0;
  }

  /** Browsers start audio suspended until a user gesture. */
  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Plays a sound; returns its playing length in seconds (even when too far away to hear). */
  play(name: SoundName, opts: PlayOptions = {}): number {
    const buffer = this.buffers.get(name);
    if (!buffer) return 0;
    const length = buffer.duration / (opts.rate ?? 1);
    this.unlock();
    let volume = opts.volume ?? 1;
    let pan = 0;
    let muffle = 0;
    if (opts.at) {
      const l = this.listener();
      const dx = opts.at.x - l.x;
      const dz = opts.at.z - l.z;
      const d = Math.hypot(dx, opts.at.y - l.y, dz);
      const ref = opts.refDistance ?? 3;
      const max = opts.maxDistance ?? 70;
      if (d >= max) return length;
      // Smooth falloff that reaches exactly zero at max distance.
      const k = Math.max(0, Math.min(1, (d - ref) / (max - ref)));
      volume *= (1 - k) * (1 - k);
      muffle = k;
      pan = Math.max(-0.8, Math.min(0.8, (dx - dz) * 0.05));
    }
    if (volume < 0.005) return length;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = (opts.rate ?? 1) * (0.97 + Math.random() * 0.06);
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    // Distance takes the highs off first: far sounds are duller, near ones crisp.
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 18000 * Math.pow(1 - muffle, 2) + 900;
    src.connect(filter).connect(gain).connect(panner).connect(this.master);
    src.start();
    const ch = opts.channel;
    if (ch) {
      let set = this.channels.get(ch);
      if (!set) this.channels.set(ch, (set = new Set()));
      const entry = { src, gain };
      set.add(entry);
      src.onended = () => set.delete(entry);
    }
    return length;
  }

  /** Quickly fades out and stops every sound still playing on `channel`. */
  private readonly loops = new Map<object, { src: AudioBufferSourceNode; gain: GainNode; panner: StereoPannerNode; filter: BiquadFilterNode }>();

  /**
   * Keeps a looping world sound going for `key` (footsteps of one character), updating its volume,
   * speed and position every call; `volume` 0 or out of range fades it out.
   */
  loopAt(key: object, name: SoundName, opts: PlayOptions): void {
    const buffer = this.buffers.get(name);
    let volume = opts.volume ?? 1;
    let pan = 0;
    let muffle = 0;
    if (opts.at) {
      const l = this.listener();
      const dx = opts.at.x - l.x;
      const dz = opts.at.z - l.z;
      const d = Math.hypot(dx, opts.at.y - l.y, dz);
      const ref = opts.refDistance ?? 3;
      const max = opts.maxDistance ?? 70;
      const k = Math.max(0, Math.min(1, (d - ref) / (max - ref)));
      volume *= d >= max ? 0 : (1 - k) * (1 - k);
      muffle = k;
      pan = Math.max(-0.8, Math.min(0.8, (dx - dz) * 0.05));
    }
    let loop = this.loops.get(key);
    if (volume < 0.005 || !buffer) {
      if (loop) this.stopLoop(key);
      return;
    }
    const t = this.ctx.currentTime;
    if (!loop) {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      const panner = this.ctx.createStereoPanner();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      src.connect(filter).connect(gain).connect(panner).connect(this.master);
      // Start somewhere in the recording so two walkers never step in sync.
      src.start(t, Math.random() * buffer.duration);
      loop = { src, gain, panner, filter };
      this.loops.set(key, loop);
    }
    loop.gain.gain.setTargetAtTime(volume, t, 0.06);
    loop.src.playbackRate.setTargetAtTime(opts.rate ?? 1, t, 0.1);
    loop.panner.pan.setTargetAtTime(pan, t, 0.05);
    loop.filter.frequency.setTargetAtTime(18000 * Math.pow(1 - muffle, 2) + 900, t, 0.05);
  }

  stopLoop(key: object): void {
    const loop = this.loops.get(key);
    if (!loop) return;
    this.loops.delete(key);
    const t = this.ctx.currentTime;
    loop.gain.gain.setTargetAtTime(0, t, 0.05);
    try {
      loop.src.stop(t + 0.25);
    } catch {
      /* already stopped */
    }
  }

  stop(channel: object): void {
    const set = this.channels.get(channel);
    if (!set) return;
    const t = this.ctx.currentTime;
    for (const { src, gain } of set) {
      gain.gain.setTargetAtTime(0, t, 0.03);
      try {
        src.stop(t + 0.15);
      } catch {
        /* already stopped */
      }
    }
    set.clear();
  }

  dispose(): void {
    this.releaseVolume();
    void this.ctx.close();
  }
}
