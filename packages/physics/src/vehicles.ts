import { VEHICLES, VEHICLE_EXPLODE_DELAY, createVehicleMotion, vehicleBasis, vehiclePoint, type VehicleState, type VehicleMotion } from '@zion/shared';
import { makeBox, shapeAABB, makeContact, type BoxShape, type Collider } from './shapes';
import { capsuleVsBox } from './geometry';
import { Layer, Mask } from './layers';
import { makeRayHit } from './shapes';
import type { CollisionWorld, ColliderInit } from './world';

/** Solid chassis and pillars; windows stay open to combat rays and exposed riders. */
export function vehicleColliders(v: VehicleState): ColliderInit[] {
  const def = VEHICLES[v.kind], basis=vehicleBasis(v);
  const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number): ColliderInit => {
    const p=vehiclePoint(v,x,y,z),shape=makeBox(p.x,p.y,p.z,hx,hy,hz,v.yaw);
    if(v.motion?.pitch || v.motion?.roll) shape.basis=basis;
    return {shape,layer:Layer.Static,tag:50000+v.id};
  };
  const k = def.scale, parts = [box(0, .48 * k, 0, def.halfX, .25 * k, def.halfZ)];
  if (!def.quad) {
    const roof = (v.kind === 'jeep' ? 2.25 : 1.48) * k, sill = (v.kind === 'jeep' ? 1.05 : .82) * k;
    // The jeep is open-top: its windshield frame is solid, the cabin has no invented roof.
    if(v.kind !== 'jeep') parts.push(box(0, roof, .1, def.halfX, .06, def.halfZ * .55));
    for (const x of [-def.halfX, def.halfX]) for (const z of [-def.halfZ * .5, def.halfZ * .6]) parts.push(box(x, (roof+sill)/2, z, .055, (roof-sill)/2, .055));
    for (const x of [-def.halfX, def.halfX]) parts.push(box(x, sill-.15, .15, .06, .15, def.halfZ * .7));
  }
  return parts;
}
export function damageVehicle(v: VehicleState, damage: number, now: number): void {
  if (v.exploded || v.health <= 0 || damage <= 0 || !Number.isFinite(damage)) return;
  v.health = Math.max(0, v.health - damage);
  if (v.health === 0) { v.explodeAt = now + VEHICLE_EXPLODE_DELAY; v.speed = 0; }
}
const hit = makeRayHit();
const GRAVITY=9.81;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const candidates:Collider[]=[];
const contact=makeContact();
const boxBasis=(b:BoxShape)=>b.basis??[b.cos,0,-b.sin,0,1,0,b.sin,0,b.cos];
/** SAT on the full oriented volume; forward rays alone miss side panels and rotation. */
function boxesOverlap(a:BoxShape,b:BoxShape):boolean {
  const am=boxBasis(a),bm=boxBasis(b);
  const aa=[am.slice(0,3),am.slice(3,6),am.slice(6,9)],ba=[bm.slice(0,3),bm.slice(3,6),bm.slice(6,9)];
  const axes=[...aa,...ba];
  for(const u of aa)for(const v of ba)axes.push([u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!]);
  const ah=[a.hx,a.hy,a.hz],bh=[b.hx,b.hy,b.hz];
  for(const axis of axes){
    const norm=Math.hypot(...axis);if(norm<1e-7)continue;
    const x=axis[0]!/norm,y=axis[1]!/norm,z=axis[2]!/norm;
    const radius=(frame:number[][],half:number[])=>frame.reduce((sum,u,i)=>sum+Math.abs(u[0]!*x+u[1]!*y+u[2]!*z)*half[i]!,0);
    if(Math.abs((a.cx-b.cx)*x+(a.cy-b.cy)*y+(a.cz-b.cz)*z)>=radius(aa,ah)+radius(ba,bh)-.002)return false;
  }
  return true;
}
/** The first static collider the chassis overlaps, or null. */
function blocker(v:VehicleState,world:CollisionWorld):Collider|null {
  for(const part of vehicleColliders(v)){
    const body=part.shape as BoxShape;
    candidates.length=0;world.queryAABB(shapeAABB(body),Layer.Static,candidates);
    for(const collider of candidates){
      if(collider.tag===50000+v.id)continue;
      const s=collider.shape;
      if(s.type==='box'){if(boxesOverlap(body,s))return collider;}
      else if(s.type==='sphere'){
        if(capsuleVsBox(s.cx,s.cy,s.cz,s.cx,s.cy,s.cz,s.r,body,contact)&&contact.depth>.002)return collider;
      }else if(capsuleVsBox(s.ax,s.ay,s.az,s.bx,s.by,s.bz,s.r,body,contact)&&contact.depth>.002)return collider;
    }
  }
  return null;
}
const bodyBlocked=(v:VehicleState,world:CollisionWorld)=>blocker(v,world)!==null;
const isVehicleTag=(tag:number|undefined)=>tag!==undefined&&tag>50000&&tag<60000;
/** Horizontal surface normal of an obstacle facing the vehicle, its top height and footprint. */
function obstacle(v:VehicleState,c:Collider):{nx:number;nz:number;top:number;size:number} {
  const s=c.shape;let nx=0,nz=0,top=-Infinity,size=Infinity;
  if(s.type==='box'){
    const m=boxBasis(s),dx=v.x-s.cx,dz=v.z-s.cz;
    const ax=Math.hypot(m[0]!,m[2]!)||1,az=Math.hypot(m[6]!,m[8]!)||1;
    const lx=(dx*m[0]!+dz*m[2]!)/ax,lz=(dx*m[6]!+dz*m[8]!)/az;
    if(Math.abs(lx)-s.hx>Math.abs(lz)-s.hz){nx=Math.sign(lx)*m[0]!/ax;nz=Math.sign(lx)*m[2]!/ax;}
    else{nx=Math.sign(lz)*m[6]!/az;nz=Math.sign(lz)*m[8]!/az;}
    top=s.cy+Math.abs(m[1]!)*s.hx+Math.abs(m[4]!)*s.hy+Math.abs(m[7]!)*s.hz;size=Math.max(s.hx,s.hz)*2;
  }else if(s.type==='sphere'){nx=v.x-s.cx;nz=v.z-s.cz;top=s.cy+s.r;size=s.r*2;}
  else{
    const ux=s.bx-s.ax,uz=s.bz-s.az,len=ux*ux+uz*uz,t=len>1e-6?clamp(((v.x-s.ax)*ux+(v.z-s.az)*uz)/len,0,1):0;
    nx=v.x-(s.ax+ux*t);nz=v.z-(s.az+uz*t);top=Math.max(s.ay,s.by)+s.r;size=Math.sqrt(len)+s.r*2;
  }
  const n=Math.hypot(nx,nz);
  // Degenerate (centre inside the obstacle footprint): push straight back along the chassis.
  if(n<1e-6)return {nx:Math.sin(v.yaw),nz:Math.cos(v.yaw),top,size};
  return {nx:nx/n,nz:nz/n,top,size};
}
type V3=[number,number,number];
const add=(a:V3,b:V3,k=1):V3=>[a[0]+b[0]*k,a[1]+b[1]*k,a[2]+b[2]*k];
const scale=(a:V3,k:number):V3=>[a[0]*k,a[1]*k,a[2]*k];
const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:V3):V3=>{const l=Math.hypot(a[0],a[1],a[2]);return l>1e-9?scale(a,1/l):[0,0,0];};
const column=(r:readonly number[],i:number):V3=>[r[i*3]!,r[i*3+1]!,r[i*3+2]!];
/** Rodrigues rotation of an orientation (column-major basis) by the rotation vector theta. */
function rotate(r:readonly number[],theta:V3):number[] {
  const angle=Math.hypot(theta[0],theta[1],theta[2]);
  if(angle<1e-9)return [...r];
  const k=scale(theta,1/angle),c=Math.cos(angle),s=Math.sin(angle),out:number[]=[];
  for(let i=0;i<3;i++){const v=column(r,i),kv=cross(k,v),d=dot(k,v)*(1-c);out.push(v[0]*c+kv[0]*s+k[0]*d,v[1]*c+kv[1]*s+k[1]*d,v[2]*c+kv[2]*s+k[2]*d);}
  // Re-orthonormalise so rounding never shears the chassis.
  const x=unit(column(out,0)),z=unit(cross(x,column(out,1))),y=cross(z,x);
  return [...x,...y,...z];
}
/** Writes an orientation back as the shared YXZ yaw/pitch/roll used by network and graphics. */
function setOrientation(v:VehicleState,m:VehicleMotion,r:readonly number[]):void {
  m.pitch=Math.asin(clamp(-r[7]!,-1,1));
  if(Math.abs(r[7]!)<.9999){v.yaw=Math.atan2(r[6]!,r[8]!);m.roll=Math.atan2(r[1]!,r[4]!);}
  else{v.yaw=Math.atan2(-r[2]!,r[0]!);m.roll=0;}
}
/**
 * Rigid-body vehicle: a box with real mass and inertia, four raycast spring/damper wheels whose
 * forces act at their contact points (so the body pitches, rolls and leaves crests by itself),
 * friction-circle tyres, impulse contacts for the chassis against ground, walls and other
 * vehicles, all integrated at fixed substeps.
 */
export function stepVehicle(v: VehicleState, throttle: number, steer: number, world: CollisionWorld, dt: number, now: number, others?: (id: number) => VehicleState | undefined): number {
  const def = VEHICLES[v.kind],m=v.motion??=createVehicleMotion(v.kind);
  const reach = Math.hypot(def.halfX, def.halfZ) + .3;
  if (!world.isAreaLoaded(v.x-reach,v.z-reach,v.x+reach,v.z+reach)) return 0;
  if (v.health<=0) throttle=0;
  v.braking=throttle<-.1&&v.speed>=8&&v.health>0;
  const steps=Math.max(1,Math.ceil(dt/(1/120))),h=dt/steps;
  const mass=def.mass,W=def.halfX*2,H=def.height,L=def.halfZ*2,k=def.scale;
  const inertia:V3=[mass*(H*H+L*L)/12,mass*(W*W+L*L)/12,mass*(W*W+H*H)/12];
  // Static sag puts the body exactly at rest height: length `spring` under the car's weight.
  const sag=def.spring*.45,rest=def.spring+sag,stiffness=mass*GRAVITY/4/sag,damping=2*.45*Math.sqrt(stiffness*mass/4);
  const share=mass/4,mu=def.grip,bottom=.23*k;
  // Network state stores horizontal speed in the yaw frame, world vy and body angular rates.
  let r=[...vehicleBasis(v)];
  let vel:V3=[-Math.sin(v.yaw)*v.speed+Math.cos(v.yaw)*(m.lateral??0),m.vy,-Math.cos(v.yaw)*v.speed-Math.sin(v.yaw)*(m.lateral??0)];
  let w:V3=add(add(scale(column(r,0),m.pitchVelocity),column(r,1),m.yawVelocity??0),column(r,2),m.rollVelocity);
  const invInertia=(t:V3):V3=>{
    const x=column(r,0),y=column(r,1),z=column(r,2);
    return add(add(scale(x,dot(t,x)/inertia[0]),y,dot(t,y)/inertia[1]),z,dot(t,z)/inertia[2]);
  };
  const centre=():V3=>[v.x,v.y+def.com,v.z];
  const world3=(x:number,y:number,z:number):V3=>add(add(add(centre(),column(r,0),x),column(r,1),y-def.com),column(r,2),z);
  /** Applies an impulse at a world point; returns nothing, mutates vel/w. */
  const impulse=(j:V3,at:V3)=>{vel=add(vel,j,1/mass);w=add(w,invInertia(cross(add(at,centre(),-1),j)));};
  const pointVelocity=(at:V3):V3=>add(vel,cross(w,add(at,centre(),-1)));
  /** Solves one contact: normal impulse with restitution e plus Coulomb friction. Returns the closing speed. */
  const resolve=(at:V3,n:V3,e:number,friction:number,other?:{vel:V3;mass:number}):number=>{
    const rel=other?add(pointVelocity(at),other.vel,-1):pointVelocity(at),vn=dot(rel,n);
    if(vn>=0)return 0;
    const arm=add(at,centre(),-1),angular=dot(n,cross(invInertia(cross(arm,n)),arm));
    const j=-(1+e)*vn/(1/mass+(other?1/other.mass:0)+angular);
    impulse(scale(n,j),at);
    if(other)other.vel=add(other.vel,n,-j/other.mass);
    const tangent=add(rel,n,-vn),speed=Math.hypot(...tangent);
    if(speed>1e-4&&friction>0){
      const dir=scale(tangent,1/speed),denom=1/mass+dot(dir,cross(invInertia(cross(arm,dir)),arm));
      impulse(scale(dir,-Math.min(friction*j,speed/denom)),at);
    }
    return -vn;
  };
  let largestImpact=0;
  for(let tick=0;tick<steps;tick++) {
    // Already inside something (rotation, a shove, a lift): push straight out along its normal and
    // drop the velocity into it, so a car can always drive or reverse away from a wall or a tree.
    for(let i=0,inside=blocker(v,world);inside&&i<12;i++,inside=blocker(v,world)){
      const o=obstacle(v,inside),n:V3=[o.nx,0,o.nz],into=dot(vel,n);
      if(into<0)vel=add(vel,n,-into);
      v.x+=o.nx*.05;v.z+=o.nz*.05;
    }
    const right=column(r,0),up=column(r,1),forward=scale(column(r,2),-1);
    const oldGrounded=m.grounded,fallSpeed=-vel[1];
    const speed=dot(vel,forward);
    const braking=throttle!==0&&Math.sign(throttle)!==Math.sign(speed)&&Math.abs(speed)>.5;
    m.steer+=(steer-m.steer)*(1-Math.exp(-h*(steer?6:9)));
    const steerAngle=m.steer*def.turn*.75/(1+Math.abs(speed)/15);
    let force:V3=[0,-GRAVITY*mass,0],torque:V3=[0,0,0];
    const push=(f:V3,at:V3)=>{force=add(force,f);torque=add(torque,cross(add(at,centre(),-1),f));};
    let contacts=0;
    for(let wheel=0;wheel<4;wheel++) {
      const x=wheel%2===0?-def.wheelX:def.wheelX,z=wheel<2?def.frontZ:def.rearZ;
      const mount=world3(x,def.wheelRadius+def.spring,z),previous=m.suspension[wheel]!;
      const touching=up[1]>.2&&world.raycast(mount[0],mount[1],mount[2],-up[0],-up[1],-up[2],rest+def.wheelRadius,Mask.CharacterMovement,hit)&&hit.ny>.3;
      if(!touching){m.suspension[wheel]=rest;continue;}
      const length=hit.t-def.wheelRadius,at=add(mount,up,-hit.t);
      m.suspension[wheel]=clamp(length,0,rest);
      // Spring + damper, and a stiff bump stop once the tyre reaches the arch.
      let load=stiffness*(rest-Math.max(0,length))+damping*(previous-length)/h;
      if(length<0)load+=stiffness*8*-length;
      load=Math.max(0,load);
      push(scale(up,load),at);
      contacts++;
      // Tyre: longitudinal drive/brake and lateral grip share one friction circle.
      const n:V3=[hit.nx,hit.ny,hit.nz],angle=wheel<2?steerAngle:0,c=Math.cos(angle),s=Math.sin(angle);
      const heading=add(scale(forward,c),right,s),side=add(scale(right,c),forward,-s);
      const f=unit(add(heading,n,-dot(heading,n))),sd=unit(add(side,n,-dot(side,n)));
      const pv=pointVelocity(at),along=dot(pv,f),across=dot(pv,sd),stop=Math.abs(along)*share/h;
      let lateral=-across*share/h*.9,longitudinal=0;
      if(braking) longitudinal=-Math.sign(along)*Math.min(mass*14/4,stop);
      else if(throttle&&v.health>0){
        const top=throttle>0?def.maxSpeed:def.maxSpeed*.32,ratio=Math.min(1,Math.abs(speed)/top);
        longitudinal=throttle*mass*def.acceleration*(1-.8*ratio*ratio)/4;
      } else longitudinal=-Math.sign(along)*Math.min((v.driver===null?mass*mu*GRAVITY*.6:mass*1.15)/4,stop);
      const limit=mu*load,total=Math.hypot(lateral,longitudinal);
      if(total>limit){lateral*=limit/total;longitudinal*=limit/total;}
      // Tyre forces act a little above the road: a lower roll centre keeps the car from tripping.
      const arm=add(at,centre(),-1),lever=add(arm,up,-dot(arm,up)*.65);
      push(add(scale(f,longitudinal),sd,lateral),add(centre(),lever));
    }
    const drag=mass*.0004*(def.quad?1.6:1)*Math.hypot(...vel);
    force=add(force,vel,-drag);
    if(v.y<world.seaLevel)force=add(force,vel,-mass*3);
    vel=add(vel,force,h/mass);
    w=add(w,invInertia(torque),h);
    w=scale(w,Math.exp(-h*(contacts?.6:.08)));
    // In the air, pitch and roll settle gently so a jump lands on its wheels instead of nose-diving.
    if(!contacts){const airDamp=1-Math.exp(-h*1.2);w=add(add(w,right,-dot(w,right)*airDamp),column(r,2),-dot(w,column(r,2))*airDamp);}
    const spin=Math.hypot(...w);if(spin>9)w=scale(w,9/spin);
    // Move: translate and rotate together, swept against static geometry.
    // After an impact the rest of the substep continues with the new velocity, so a glancing hit
    // slides and bounces off instead of freezing against the surface.
    for(let pass=0,remaining=1;pass<3&&remaining>1e-3;pass++){
    const from=centre(),fromR=r,theta=scale(w,h*remaining),delta=scale(vel,h*remaining);
    remaining=0;
    const pose=(t:number)=>{
      r=rotate(fromR,scale(theta,t));setOrientation(v,m,r);
      v.x=from[0]+delta[0]*t;v.y=from[1]+delta[1]*t-def.com;v.z=from[2]+delta[2]*t;
    };
    const target=add(from,delta);
    if(!world.inBounds(target[0]-reach,target[2]-reach)||!world.inBounds(target[0]+reach,target[2]+reach)||!world.isAreaLoaded(target[0]-reach,target[2]-reach,target[0]+reach,target[2]+reach)){
      vel=[0,Math.min(0,vel[1]),0];w=[0,0,0];
    } else {
      const slices=Math.max(1,Math.ceil(Math.hypot(...delta)/.1),Math.ceil(Math.hypot(...theta)/.02));
      let safe=0,blocked:Collider|null=null;
      for(let i=1;i<=slices;i++){pose(i/slices);blocked=blocker(v,world);if(blocked)break;safe=i/slices;}
      if(blocked){
        let lo=safe,hi=Math.min(1,safe+1/slices);
        for(let i=0;i<5;i++){const mid=(lo+hi)/2;pose(mid);if(bodyBlocked(v,world))hi=mid;else lo=mid;}
        pose(hi);const o=obstacle(v,blocked),vehicle=isVehicleTag(blocked.tag);
        const rise=o.top-v.y,horizontal=Math.hypot(vel[0],vel[2]);
        let climbed=false;
        // Kerbs, rocks and debris lower than the step height are ridden over; the springs take the hit.
        if(!vehicle&&horizontal>.5&&rise>.05&&rise<=def.step){
          const floor=Math.max(0,rise);
          for(const lift of [floor+.03,floor+.12,floor+.3]){
            pose(1);v.y+=lift;
            if(bodyBlocked(v,world))continue;
            climbed=true;
            if(rise>0){
              const jolt=Math.min(.3,rise/def.step*.12);
              vel=[vel[0]*(1-jolt),Math.max(vel[1],Math.min(2.5,horizontal*rise*.2)),vel[2]*(1-jolt)];
              w=add(w,right,Math.sign(dot(vel,forward))*Math.min(.6,horizontal*rise*.05));
            }
            break;
          }
        }
        if(!climbed){
          pose(lo);
          const other=others&&vehicle?others(blocked.tag-50000):undefined;
          if(other)Object.assign(o,obstacle(v,{shape:vehicleColliders(other)[0]!.shape} as Collider));
          // Landing on a deck or a box top is a vertical contact; anything else is a side impact.
          const below=o.top<=v.y+def.com&&vel[1]<0;
          const n:V3=below?[0,1,0]:[o.nx,0,o.nz];
          const rx=-(o.nx*right[0]+o.nz*right[2]),rz=-(o.nx*forward[0]+o.nz*forward[2]);
          const reachScale=1/Math.max(Math.abs(rx)/def.halfX,Math.abs(rz)/def.halfZ,1e-6);
          const at=below?world3(0,bottom,0):world3(rx*reachScale,def.com,-rz*reachScale);
          let impact:number;
          if(other){
            const om=other.motion??=createVehicleMotion(other.kind),odef=VEHICLES[other.kind];
            const body={vel:[-Math.sin(other.yaw)*other.speed+Math.cos(other.yaw)*(om.lateral??0),om.vy,-Math.cos(other.yaw)*other.speed-Math.sin(other.yaw)*(om.lateral??0)] as V3,mass:odef.mass};
            const before=body.vel;
            impact=resolve(at,n,.3,.2,body);
            other.speed=-Math.sin(other.yaw)*body.vel[0]-Math.cos(other.yaw)*body.vel[2];
            om.lateral=Math.cos(other.yaw)*body.vel[0]-Math.sin(other.yaw)*body.vel[2];
            om.vy=body.vel[1];
            // Off-centre blows spin the other vehicle too.
            const arm:V3=[at[0]-other.x,0,at[2]-other.z],j=scale(add(body.vel,before,-1),odef.mass);
            om.yawVelocity=clamp((om.yawVelocity??0)+cross(arm,j)[1]/(odef.mass*(4*odef.halfX**2+4*odef.halfZ**2)/12),-4,4);
            const total=mass+odef.mass;
            damageVehicle(other,Math.max(0,impact-6)**2*.9*mass/total,now);other.impact={time:now,speed:impact};
            damageVehicle(v,Math.max(0,impact-6)**2*.9*odef.mass/total,now);
          } else {
            impact=resolve(at,n,below?0:impact0(vel,n),below?.6:.3);
            damageVehicle(v,Math.max(0,impact-7)**2*(below?1.4:.6)*mass/1000,now);
          }
          if(below)m.grounded=true;
          largestImpact=Math.max(largestImpact,impact);
          // Separate by a small skin, stop any spin that keeps rotating into it, and go on.
          v.x+=n[0]*.02;v.y+=n[1]*.02;v.z+=n[2]*.02;
          if(bodyBlocked(v,world)){v.x-=n[0]*.02;v.y-=n[1]*.02;v.z-=n[2]*.02;}
          const turning=dot(cross(add(at,centre(),-1),n),w);if(turning<0&&!below)w=scale(w,.6);
          remaining=(1-lo)*.9;
        }
      }
    }
    }
    r=[...vehicleBasis(v)];
    // A missed downward ray must never let the chassis tunnel below loaded terrain.
    const terrain=world.terrainHeight(v.x,v.z);
    if(Number.isFinite(terrain)&&v.y<terrain-.6){
      if(fallSpeed>7)damageVehicle(v,(fallSpeed-7)**2*1.4,now);
      v.y=terrain+.04;vel=[vel[0],0,vel[2]];
    } else if(!Number.isFinite(terrain)&&v.y<world.seaLevel-8){v.y=world.seaLevel-1;vel=[vel[0],0,vel[2]];}
    // Chassis corners and roof against the ground: lets a flipped car scrape, tumble and rest.
    let depth=0,bodyContact=false;
    for(const x of [-def.halfX*.92,def.halfX*.92])for(const z of [-def.halfZ*.92,def.halfZ*.92])for(const y of [bottom,def.height]) {
      const p=world3(x,y,z),terrainY=world.terrainHeight(p[0],p[2]);
      let surface=Number.isFinite(terrainY)?terrainY:-Infinity;
      // Only walkable tops count as floor: a ray starting inside a trunk or wall reports t=0 and
      // used to hoist the chassis onto it, making the car hop on trees and stick to walls.
      if(world.raycast(p[0],p[1]+.5,p[2],0,-1,0,.58,Layer.Static,hit)&&hit.ny>.7&&hit.t>.02&&p[1]+.5-hit.t<=p[1]+.35)surface=Math.max(surface,p[1]+.5-hit.t);
      if(surface<=p[1])continue;
      bodyContact=true;depth=Math.max(depth,surface-p[1]);
      const impact=resolve(p,[0,1,0],.05,.55);
      if(impact>7&&!oldGrounded){damageVehicle(v,(impact-7)**2*1.4,now);largestImpact=Math.max(largestImpact,impact);}
    }
    if(depth>0){
      const baseY=v.y;v.y+=depth*.8;
      if(bodyBlocked(v,world)){
        // Terrain support must not push the chassis through a wall or a thin deck.
        // Undo only the lift; restoring the whole pose here pinned cars against walls for good.
        v.y=baseY;
      } else if(v.y-baseY>.5) vel=[vel[0],Math.max(0,vel[1]),vel[2]];
    }
    if(!oldGrounded&&contacts>0&&fallSpeed>9){
      damageVehicle(v,(fallSpeed-9)**2*1.4,now);largestImpact=Math.max(largestImpact,fallSpeed);
    }
    m.grounded=contacts>0||bodyContact;
  }
  // Back to the compact network form.
  v.yaw=Math.atan2(Math.sin(v.yaw),Math.cos(v.yaw));
  v.speed=-Math.sin(v.yaw)*vel[0]-Math.cos(v.yaw)*vel[2];
  m.lateral=Math.cos(v.yaw)*vel[0]-Math.sin(v.yaw)*vel[2];
  m.vy=vel[1];
  m.pitchVelocity=dot(w,column(r,0));m.yawVelocity=dot(w,column(r,1));m.rollVelocity=dot(w,column(r,2));
  // Settling bounces right after a crash must not overwrite the crash itself.
  if(largestImpact>=2&&!(v.impact&&now-v.impact.time<400&&v.impact.speed>largestImpact))v.impact={time:now,speed:largestImpact};
  return largestImpact;
}
/** Hard side impacts bounce a little; gentle scrapes do not. */
function impact0(vel:V3,n:V3):number{return -dot(vel,n)>4?.2:0;}
