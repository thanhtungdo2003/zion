import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VehicleState } from '@zion/shared';
import { VehicleAudio } from './vehicle-audio';

vi.mock('@/lib/settings', () => ({ settingsStore: { get: () => ({ volume: 1 }) } }));
class Media {
  static all: Media[] = [];
  src = ''; volume = 0; playbackRate = 1; preload = ''; loop = false;
  preservesPitch = true; paused = true; ended = false;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  removeAttribute = vi.fn(() => { this.src = ''; });
  constructor() { Media.all.push(this); }
}
const vehicle = (id: number, kind: VehicleState['kind'] = 'car'): VehicleState =>
  ({ id, kind, x: id * 3, y: 0, z: 0, yaw: 0, speed: 0, health: 500, driver: id, explodeAt: 0, exploded: false });
beforeEach(() => { Media.all = []; vi.stubGlobal('Audio', Media); });
afterEach(() => vi.unstubAllGlobals());

describe('vehicle audio streams', () => {
  it('limits nearby engine streams, selects quad sounds and releases streams on departure', () => {
    const audio = new VehicleAudio();
    const states = Array.from({ length: 8 }, (_, i) => vehicle(i + 1, i === 0 ? 'quad' : 'car'));
    audio.update(states, 1, 0, 0, 0, .1, 1000, true);
    expect(Media.all.filter(a => a.loop)).toHaveLength(4);
    expect(Media.all.find(a => a.loop)?.src).toContain('motorcycle-engine-noise');
    expect(Media.all.find(a => !a.loop)?.src).toContain('motorcycle-engine-active');
    const old = [...Media.all];
    audio.update([], 1, 0, 0, 0, .1, 1100, true);
    for (const media of old) { expect(media.paused).toBe(true); expect(media.src).toBe(''); }
    audio.dispose();
  });
  it('increases engine pitch and volume with speed and starts music only after sustained fast driving', () => {
    const audio = new VehicleAudio(), v = vehicle(1);
    audio.update([v], 1, 0, 0, 0, 1, 1000, true);
    const engine = Media.all.find(a => a.loop)!, rate = engine.playbackRate, volume = engine.volume;
    v.speed = 25;
    for (let i = 0; i < 8; i++) audio.update([v], 1, 0, 0, 0, 1, 2000 + i * 1000, true);
    expect(engine.playbackRate).toBeGreaterThan(rate); expect(engine.volume).toBeGreaterThan(volume);
    expect(Media.all.some(a => a.src.includes('/musics/'))).toBe(false);
    audio.update([v], 1, 0, 0, 0, 1, 10000, true);
    const music = Media.all.find(a => a.src.includes('/musics/'))!;
    expect(music).toBeDefined(); expect(music.preload).toBe('none');
    v.driver = null;
    audio.update([v], 1, 0, 0, 0, 4, 14000, true);
    expect(music.paused).toBe(true); expect(music.src).toBe('');
    audio.dispose();
  });
  it('backs off when browser autoplay is blocked', () => {
    const audio = new VehicleAudio(), v = vehicle(2);
    audio.update([v], 1, 0, 0, 0, .01, 1000, true);
    const engine = Media.all[0]!;
    engine.paused = true; engine.play.mockImplementation(async () => { throw new Error('blocked'); });
    for (let i = 0; i < 60; i++) audio.update([v], 1, 0, 0, 0, 1/60, 1000+i*16, true);
    expect(engine.play).toHaveBeenCalledTimes(1);
    audio.dispose(); expect(engine.src).toBe('');
  });
  it('plays braking only during forward braking and releases it on reverse, exit or mute',()=>{
    const audio=new VehicleAudio(),v=vehicle(1);v.speed=16;
    audio.update([v],1,0,0,0,.1,1000,true);
    expect(Media.all.some(a=>a.src.includes('braking-on-gravel'))).toBe(false);
    v.braking=true;audio.update([v],1,0,0,0,.1,1100,true);
    const brake=Media.all.find(a=>a.src.includes('braking-on-gravel'))!;
    expect(brake.loop).toBe(true);expect(brake.play).toHaveBeenCalledTimes(1);
    audio.update([v],1,0,0,0,.1,1200,true);expect(brake.play).toHaveBeenCalledTimes(1);
    v.speed=-12;audio.update([v],1,0,0,0,.1,1300,true);
    expect(brake.paused).toBe(true);expect(brake.src).toBe('');
    v.speed=16;audio.update([v],1,0,0,0,.1,1400,true);
    const second=Media.all.at(-1)!;
    audio.update([v],1,0,0,0,.1,1500,false);expect(second.src).toBe('');
    audio.update([v],1,0,0,0,.1,1600,true);
    const third=Media.all.at(-1)!;v.driver=null;
    audio.update([v],1,0,0,0,.1,1700,true);expect(third.src).toBe('');
    audio.dispose();
  });
  it('randomizes confirmed physical impacts once, ignores health changes and old streamed events',()=>{
    const random=vi.spyOn(Math,'random'),audio=new VehicleAudio(),v=vehicle(1);
    v.impact={time:10,speed:15};audio.update([v],1,0,0,0,.1,1000,true);
    expect(Media.all.some(a=>a.src.includes('crash'))).toBe(false);
    v.health-=30;audio.update([v],1,0,0,0,.1,1100,true);
    expect(Media.all.some(a=>a.src.includes('crash'))).toBe(false);
    random.mockReturnValueOnce(0);v.impact={time:20,speed:15};
    audio.update([v],1,0,0,0,.1,1200,true);
    const first=Media.all.find(a=>a.src.endsWith('/car-crash-sound-effect.mp3'))!;
    expect(first.play).toHaveBeenCalledTimes(1);expect(first.preload).toBe('none');
    audio.update([v],1,0,0,0,.1,1300,true);
    expect(Media.all.filter(a=>a.src.includes('crash'))).toHaveLength(1);
    random.mockReturnValueOnce(.99);v.impact={time:30,speed:20};
    audio.update([v],1,0,0,0,.1,1400,true);
    expect(Media.all.some(a=>a.src.endsWith('/sound-effect-car-crash.mp3'))).toBe(true);
    first.ended=true;audio.update([v],1,0,0,0,.1,1500,true);expect(first.src).toBe('');
    audio.dispose();random.mockRestore();
    expect(Media.all.every(a=>a.src==='')).toBe(true);
  });
  it('limits crash streams and ignores distant or muted collisions',()=>{
    const audio=new VehicleAudio(),v=vehicle(1);
    audio.update([v],1,0,0,0,.1,1000,true);
    for(let i=1;i<=8;i++){v.impact={time:i,speed:10};audio.update([v],1,0,0,0,.1,1000+i*100,true);}
    expect(Media.all.filter(a=>a.src.includes('crash'))).toHaveLength(4);
    v.x=200;v.impact={time:9,speed:20};audio.update([v],1,0,0,0,.1,2000,true);
    expect(Media.all.filter(a=>a.src.includes('crash'))).toHaveLength(4);
    audio.update([v],1,0,0,0,.1,2100,false);
    expect(Media.all.filter(a=>a.src.includes('crash'))).toHaveLength(0);
    audio.dispose();
  });
});
