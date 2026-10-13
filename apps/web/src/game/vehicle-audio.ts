import { VEHICLES, type VehicleState } from '@zion/shared';
import { settingsStore } from '@/lib/settings';

const MUSIC = [
  '43084433-rock-intro-335249.mp3', 'alex-morgan-car-car-music-545487.mp3',
  'alexguz-energy-rock-indie-485422.mp3', 'grumpynora-fierce-13-sec-edit-606457.mp3',
  'litesaturation-short-rock-488463.mp3', 'romanspiridonov-pop-rock-dry-room-beats-full-track-115-bpm-275268.mp3',
  'waveloom-rock-no-copyright-music-605045.mp3',
];
const CRASH = ['car-crash-sound-effect.mp3', 'sound-effect-car-crash.mp3'];
const stop = (audio: HTMLAudioElement) => { audio.pause(); audio.removeAttribute('src'); audio.load(); };
function stream(url: string, loop = false): HTMLAudioElement {
  const audio = new Audio(); audio.preload = 'none'; audio.loop = loop;
  audio.preservesPitch = false; audio.src = url; return audio;
}
export function engineMix(speed: number, maximum: number): { rate: number; volume: number } {
  const load = Math.min(1, Math.abs(speed) / maximum);
  return { rate: .65 + load * 1.15, volume: .12 + load * .55 };
}
/** HTML media streams compressed music progressively; no album-sized AudioBuffers. */
export class VehicleAudio {
  private readonly engines = new Map<number, HTMLAudioElement>();
  private readonly drivers = new Map<number, number | null>();
  private readonly brakes = new Map<number, HTMLAudioElement>();
  private readonly impacts = new Map<number, number | undefined>();
  private readonly crashes: HTMLAudioElement[] = [];
  private active: HTMLAudioElement | null = null;
  private music: HTMLAudioElement | null = null;
  private musicVolume = 0;
  private fastFor = 0;
  private nextMusicAt = 0;
  private lastTrack = -1;
  private readonly playAt = new WeakMap<HTMLAudioElement, number>();
  update(vehicles: VehicleState[], localId: number, x: number, y: number, z: number, dt: number, now: number, enabled: boolean): void {
    const master = enabled ? settingsStore.get().volume : 0;
    const near = vehicles.filter(v => v.driver && v.health > 0 && Math.hypot(v.x-x,v.y-y,v.z-z)<85)
      .sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z)).slice(0,4);
    const ids = new Set(near.map(v=>v.id));
    for(const [id,audio]of this.engines)if(!ids.has(id)){stop(audio);this.engines.delete(id);}
    for(const [id,audio]of this.brakes)if(!ids.has(id)){stop(audio);this.brakes.delete(id);}
    for(let i=this.crashes.length-1;i>=0;i--)if(this.crashes[i]!.ended||!master){stop(this.crashes[i]!);this.crashes.splice(i,1);}
    for(const v of near){
      const prefix=VEHICLES[v.kind].quad?'motorcycle':'car';
      if(this.drivers.has(v.id)&&this.drivers.get(v.id)!==v.driver || !this.drivers.has(v.id)) {
        if(v.driver===localId && master>0){ if(this.active)stop(this.active);this.active=stream(`/sounds/${prefix}-engine-active.mp3`);this.active.volume=master*.65;void this.active.play().catch(()=>undefined); }
      }
      let audio=this.engines.get(v.id);
      if(!audio){audio=stream(`/sounds/${prefix}-engine-noise.mp3`,true);this.engines.set(v.id,audio);}
      const mix=engineMix(v.speed,VEHICLES[v.kind].maxSpeed), distance=Math.hypot(v.x-x,v.y-y,v.z-z);
      audio.volume=Math.max(0,Math.min(1,mix.volume*master*(v.driver===localId?1:Math.max(0,1-distance/85)**2)));
      audio.playbackRate=mix.rate;
      if(audio.volume>0&&audio.paused&&now>=(this.playAt.get(audio)??0)){
        this.playAt.set(audio,now+1500);void audio.play().catch(()=>undefined);
      }
      if(!master)audio.pause();
      // The server reports reverse input while still moving forwards, including remote cars.
      const brakeVolume=master*(v.driver===localId?1:Math.max(0,1-distance/60)**2);
      let brake=this.brakes.get(v.id);
      if(v.braking&&v.speed>5&&brakeVolume>0){
        if(!brake){brake=stream('/sounds/braking-on-gravel.mp3',true);this.brakes.set(v.id,brake);}
        brake.volume=Math.min(1,brakeVolume*(.25+Math.min(1,v.speed/25)*.45));
        if(brake.paused&&now>=(this.playAt.get(brake)??0)){
          this.playAt.set(brake,now+1500);void brake.play().catch(()=>undefined);
        }
      }else if(brake){stop(brake);this.brakes.delete(v.id);}
    }
    for(const v of vehicles){
      const event=v.impact,distance=Math.hypot(v.x-x,v.y-y,v.z-z);
      // Do not replay old crashes when a vehicle first enters the streamed area.
      if(event&&this.impacts.has(v.id)&&this.impacts.get(v.id)!==event.time&&event.speed>=2&&distance<65&&master>0){
        if(this.crashes.length>=4)stop(this.crashes.shift()!);
        const crash=stream('/sounds/'+CRASH[Math.floor(Math.random()*CRASH.length)]!);
        crash.volume=Math.min(1,master*(.25+Math.min(1,event.speed/25)*.65)*Math.max(0,1-distance/65)**2);
        this.crashes.push(crash);void crash.play().catch(()=>undefined);
      }
      this.impacts.set(v.id,event?.time);
    }
    for(const id of this.impacts.keys())if(!vehicles.some(v=>v.id===id))this.impacts.delete(id);
    for(const v of vehicles)this.drivers.set(v.id,v.driver);
    for(const id of this.drivers.keys())if(!vehicles.some(v=>v.id===id))this.drivers.delete(id);
    const own=vehicles.find(v=>v.driver===localId && v.health>0);
    const fast=!!own&&Math.abs(own.speed)>18&&enabled;
    this.fastFor=fast?this.fastFor+dt:0;
    if(this.music?.ended){stop(this.music);this.music=null;this.musicVolume=0;this.nextMusicAt=now+45000+Math.random()*45000;}
    if(!this.music&&this.fastFor>8&&now>this.nextMusicAt){
      const index=(this.lastTrack+1+Math.floor(Math.random()*(MUSIC.length-1)))%MUSIC.length;
      this.lastTrack=index;this.music=stream('/sounds/musics/'+MUSIC[index]);this.music.volume=0;void this.music.play().catch(()=>undefined);
      this.nextMusicAt=now+90000;
    }
    const target=fast?.42*master:0;
    this.musicVolume+=(target-this.musicVolume)*(1-Math.exp(-dt*2));
    if(this.music){this.music.volume=Math.max(0,Math.min(1,this.musicVolume));if(!fast&&this.musicVolume<.005){stop(this.music);this.music=null;this.musicVolume=0;this.nextMusicAt=Math.max(this.nextMusicAt,now+30000);}}
    if(this.active){this.active.volume=master*.65;if(!own||this.active.ended){stop(this.active);this.active=null;}}
  }
  dispose():void{for(const a of this.engines.values())stop(a);this.engines.clear();for(const a of this.brakes.values())stop(a);this.brakes.clear();for(const a of this.crashes)stop(a);this.crashes.length=0;this.impacts.clear();if(this.active)stop(this.active);if(this.music)stop(this.music);this.active=this.music=null;this.drivers.clear();}
}
