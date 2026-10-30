import { createVehicleMotion, type VehicleState } from '@zion/shared';

const copy=(v:VehicleState):VehicleState=>({...v,motion:{...(v.motion??createVehicleMotion(v.kind)),suspension:[...(v.motion??createVehicleMotion(v.kind)).suspension]}});
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
/** World velocity of a snapshot (speed along the heading, sideways slip, climb). */
const velocity=(v:VehicleState):[number,number,number]=>{const l=v.motion?.lateral??0;return [-Math.sin(v.yaw)*v.speed+Math.cos(v.yaw)*l,v.motion?.vy??0,-Math.cos(v.yaw)*v.speed-Math.sin(v.yaw)*l];};
/** Timestamped playback, independent of packet arrival cadence and render frame rate. */
export class VehicleTimeline {
  private frames:Array<{time:number;state:VehicleState}>=[];
  private playbackTime:number|undefined;
  private offset={x:0,y:0,z:0,yaw:0,pitch:0,roll:0};
  push(time:number,state:VehicleState):void {
    const last=this.frames.at(-1);
    if(last&&time<=last.time)return;
    let before=this.playbackTime===undefined?undefined:this.sample(this.playbackTime);
    if(last&&Math.hypot(last.state.x-state.x,last.state.y-state.y,last.state.z-state.z)>12){
      this.frames=[];this.playbackTime=undefined;this.offset={x:0,y:0,z:0,yaw:0,pitch:0,roll:0};before=undefined;
    }
    // A vehicle left out of snapshots while it stood still: it stood there until just before
    // this one, rather than gliding across the whole silence.
    if(last&&time-last.time>250)this.frames.push({time:time-1000/30,state:copy(last.state)});
    this.frames.push({time,state:copy(state)});
    if(this.frames.length>12)this.frames.shift();
    if(before&&this.playbackTime!==undefined){
      const after=this.sample(this.playbackTime);
      for(const key of ['x','y','z'] as const)this.offset[key]+=before[key]-after[key];
      this.offset.yaw+=Math.atan2(Math.sin(before.yaw-after.yaw),Math.cos(before.yaw-after.yaw));
      for(const key of ['pitch','roll'] as const)this.offset[key]+=before.motion![key]-after.motion![key];
    }
  }
  /** Preserve the displayed pose when a packet corrects extrapolation, then settle smoothly. */
  play(time:number):VehicleState {
    const dt=this.playbackTime===undefined?0:Math.max(0,(time-this.playbackTime)/1000);
    this.playbackTime=time;
    const p=this.sample(time),decay=Math.exp(-dt*10);
    for(const key of ['x','y','z','yaw','pitch','roll'] as const)this.offset[key]*=decay;
    for(const key of ['x','y','z','yaw'] as const)p[key]+=this.offset[key];
    p.motion!.pitch+=this.offset.pitch;p.motion!.roll+=this.offset.roll;
    return p;
  }
  sample(time:number):VehicleState {
    const latest=this.frames.at(-1)!;
    let a=this.frames[0]!,b=a;
    for(const frame of this.frames){if(frame.time<=time)a=frame;if(frame.time>=time){b=frame;break;}b=frame;}
    const p=copy(a.state),m=p.motion!;
    if(b.time>a.time){
      const t=Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));
      // Velocity-aware (cubic Hermite): the path bends through each snapshot as the vehicle was
      // actually moving, instead of kinking at every packet.
      const h=(b.time-a.time)/1000,va=velocity(a.state),vb=velocity(b.state),t2=t*t,t3=t2*t;
      const h00=2*t3-3*t2+1,h10=t3-2*t2+t,h01=-2*t3+3*t2,h11=t3-t2;
      if(h<.5){
        p.x=h00*a.state.x+h10*h*va[0]+h01*b.state.x+h11*h*vb[0];
        p.y=h00*a.state.y+h10*h*va[1]+h01*b.state.y+h11*h*vb[1];
        p.z=h00*a.state.z+h10*h*va[2]+h01*b.state.z+h11*h*vb[2];
      }else{p.x=mix(a.state.x,b.state.x,t);p.y=mix(a.state.y,b.state.y,t);p.z=mix(a.state.z,b.state.z,t);}
      p.yaw=a.state.yaw+Math.atan2(Math.sin(b.state.yaw-a.state.yaw),Math.cos(b.state.yaw-a.state.yaw))*t;
      p.speed=mix(a.state.speed,b.state.speed,t);
      const am=a.state.motion!,bm=b.state.motion!;
      m.pitch=mix(am.pitch,bm.pitch,t);m.roll=mix(am.roll,bm.roll,t);m.vy=mix(am.vy,bm.vy,t);m.steer=mix(am.steer,bm.steer,t);
      m.suspension=m.suspension.map((_,i)=>mix(am.suspension[i]!,bm.suspension[i]!,t)) as typeof m.suspension;
    } else if(time>latest.time){
      // At 10 Hz, 80 ms was shorter than one packet interval plus transit time and caused
      // rhythmic stops. Bridge normal transit/jitter, with a strict limit on prediction.
      const dt=Math.min(.18,(time-latest.time)/1000),previous=this.frames.at(-2);
      const yawRate=previous?Math.atan2(Math.sin(p.yaw-previous.state.yaw),Math.cos(p.yaw-previous.state.yaw))/((latest.time-previous.time)/1000):0;
      const turn=Math.max(-2,Math.min(2,yawRate))*dt;
      p.x-=Math.sin(p.yaw+turn*.5)*p.speed*dt;p.z-=Math.cos(p.yaw+turn*.5)*p.speed*dt;p.yaw+=turn;
      if(!m.grounded)p.y+=m.vy*dt;
    }
    p.driver=latest.state.driver;p.health=latest.state.health;p.explodeAt=latest.state.explodeAt;p.exploded=latest.state.exploded;
    p.braking=latest.state.braking;p.impact=latest.state.impact;
    p.throttle=latest.state.throttle;
    return p;
  }
}
