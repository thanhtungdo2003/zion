import { describe, expect, it } from 'vitest';
import type { VehicleState } from '@zion/shared';
import { VehicleTimeline } from './vehicle-timeline';

const state=(time:number):VehicleState=>({id:1,kind:'car',x:10,y:30,z:100-time*.02,yaw:0,speed:20,health:600,driver:1,explodeAt:0,exploded:false});
describe('vehicle rendering timeline',()=>{
  it.each([30,60,144])('moves smoothly at %s FPS despite uneven snapshot arrivals',fps=>{
    const timeline=new VehicleTimeline();let next=0,last:number|undefined;
    const delays=[0,12,-8,18,-5,7];
    for(let frame=0;frame<fps*2;frame++){
      const now=frame*1000/fps;
      while(next<=2000&&next+(delays[(next/100)%delays.length]??0)<=now){timeline.push(next,state(next));next+=100;}
      const rendered=timeline.sample(now-120);
      if(now>250&&last!==undefined)expect(last-rendered.z).toBeCloseTo(20/fps,7);
      last=rendered.z;
    }
  });
  it('takes the short yaw arc and limits extrapolation when snapshots stop',()=>{
    const timeline=new VehicleTimeline(),a=state(0),b=state(100);a.yaw=Math.PI-.1;b.yaw=-Math.PI+.1;
    timeline.push(0,a);timeline.push(100,b);
    expect(timeline.sample(50).yaw).toBeCloseTo(Math.PI);
    expect(timeline.sample(2000).z).toBe(timeline.sample(500).z);
  });
  it('extrapolates the latest speed briefly instead of leaving a fast model behind',()=>{
    const timeline=new VehicleTimeline(),a=state(0),b=state(100);
    timeline.push(0,a);timeline.push(100,b);
    const current=timeline.sample(145);
    expect(current.z).toBeCloseTo(97.1);
    expect(current.z).toBeGreaterThan(b.z-1.1);
  });
  it.each([30,60,144])('has no backwards steps or periodic freezes at %s FPS with a 45 ms buffer and network transit',fps=>{
    const timeline=new VehicleTimeline();let next=0,last:number|undefined;
    const jitter=[0,22,-8,18,-5,7];
    for(let frame=0;frame<fps*3;frame++){
      const now=frame*1000/fps;
      while(next+55+jitter[(next/100)%jitter.length]!<=now){timeline.push(next,state(next));next+=100;}
      if(next===0)continue;
      const p=timeline.play(now-45);
      if(now>300&&last!==undefined)expect(last-p.z).toBeCloseTo(20/fps,7);
      last=p.z;
    }
  });
  it('reconciles a speed correction over frames instead of snapping the vehicle backwards',()=>{
    const timeline=new VehicleTimeline();timeline.push(0,state(0));timeline.push(100,state(100));
    const before=timeline.play(220);
    const corrected=state(200);corrected.z+=.5;timeline.push(200,corrected);
    expect(timeline.play(220).z).toBeCloseTo(before.z);
    let last=before;
    for(let time=220+1000/60;time<350;time+=1000/60){
      const p=timeline.play(time);expect(last.z-p.z).toBeGreaterThan(0);expect(last.z-p.z).toBeLessThan(.6);last=p;
    }
  });
});
