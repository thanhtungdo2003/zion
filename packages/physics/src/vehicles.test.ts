import { describe, expect, it } from 'vitest';
import { createVehicleMotion, VEHICLES, vehiclePoint, vehicleLocalPoint, type VehicleState } from '@zion/shared';
import { CollisionWorld } from './world';
import { Heightfield } from './heightfield';
import { stepVehicle, vehicleColliders } from './vehicles';
import { Layer, Mask } from './layers';
import { makeBox, makeCapsule, makeRayHit } from './shapes';

function world(height=(x:number,z:number)=>30+0*x+0*z) {
  const w=new CollisionWorld({worldSize:192,seaLevel:20});
  for(let x=0;x<6;x++)for(let z=0;z<6;z++){
    const heights=new Float32Array(1089);
    for(let i=0;i<33;i++)for(let j=0;j<33;j++)heights[j*33+i]=height(x*32+i,z*32+j);
    w.addChunk(x,z,new Heightfield(x*32,z*32,1,33,heights,new Float32Array(1089).fill(NaN)),[]);
  }
  return w;
}
function vehicle(kind:VehicleState['kind']='car'):VehicleState {
  return {id:1,kind,x:96,y:30,z:160,yaw:0,speed:0,health:VEHICLES[kind].health,driver:1,explodeAt:0,exploded:false,motion:createVehicleMotion(kind)};
}
describe('vehicle suspension and chassis',()=>{
  it.each(['car','jeep','quad','grizzly'] as const)('drives %s on flat terrain without durability loss or chassis bounce',kind=>{
    const w=world(),v=vehicle(kind),start=v.health;
    for(let i=0;i<240;i++)stepVehicle(v,1,0,w,1/90,i*1000/90);
    expect(v.z).toBeLessThan(150);expect(v.speed).toBeGreaterThan(10);
    expect(v.health).toBe(start);expect(v.explodeAt).toBe(0);
    expect(v.y).toBeCloseTo(30,1);expect(Math.abs(v.motion!.vy)).toBeLessThan(.1);
    // Acceleration squat is real load transfer, but stays small.
    expect(Math.abs(v.motion!.pitch)).toBeLessThan(.06);expect(Math.abs(v.motion!.roll)).toBeLessThan(.03);
  });
  it('follows a hillside with independent springs instead of treating the slope as a collision',()=>{
    const w=world((x,z)=>30+(x-96)*.15+(z-96)*.1),v=vehicle();v.y=w.terrainHeight(v.x,v.z);
    for(let i=0;i<240;i++)stepVehicle(v,1,0,w,1/90,i*1000/90);
    expect(v.health).toBe(VEHICLES.car.health);expect(v.speed).toBeGreaterThan(10);
    expect(Math.abs(v.y-w.terrainHeight(v.x,v.z))).toBeLessThan(.2);
    expect(Math.abs(v.motion!.pitch)).toBeGreaterThan(.04);expect(Math.abs(v.motion!.roll)).toBeGreaterThan(.08);
    expect(new Set(v.motion!.suspension.map(x=>x.toFixed(4))).size).toBeGreaterThan(1);
  });
  it('supports the wheels on a bridge deck rather than the terrain underneath',()=>{
    const w=world(),v=vehicle();v.y=34;
    w.setOwnerColliders(77,[{shape:makeBox(96,33.8,135,6,.2,45),layer:Layer.Static}]);
    for(let i=0;i<180;i++)stepVehicle(v,1,0,w,1/90,i*1000/90);
    expect(v.y).toBeCloseTo(34,1);expect(v.health).toBe(VEHICLES.car.health);expect(v.z).toBeLessThan(155);
  });
  it('falls under gravity, keeps angular momentum, and damages only the hard landing',()=>{
    const w=world(),v=vehicle();v.y=40;v.motion!.rollVelocity=2;
    for(let i=0;i<60;i++)stepVehicle(v,0,0,w,1/90,i*1000/90);
    expect(v.y).toBeLessThan(39);expect(v.y).toBeGreaterThan(32);expect(v.health).toBe(VEHICLES.car.health);
    expect(v.motion!.roll).toBeGreaterThan(.8);
    for(let i=60;i<360;i++)stepVehicle(v,0,0,w,1/90,i*1000/90);
    expect(v.health).toBeLessThan(VEHICLES.car.health);expect(v.health).toBeGreaterThan(0);
    const after=v.health;
    for(let i=360;i<540;i++)stepVehicle(v,0,0,w,1/90,i*1000/90);
    expect(v.health).toBe(after);expect(v.motion!.grounded).toBe(true);
  });
  it('cannot fall forever when a terrain ray is missed below a loaded map',()=>{
    const w=world(),v=vehicle();v.y=-80;
    for(let i=0;i<30;i++)stepVehicle(v,0,0,w,1/90,i*1000/90);
    expect(v.y).toBeGreaterThan(29);expect(v.y).toBeLessThan(31);expect(Math.abs(v.motion!.vy)).toBeLessThan(.5);
  });
  it.each(['car','jeep'] as const)('stops a tilted %s climbing a slope into a thin wall',kind=>{
    const w=world((_x,z)=>30+(160-z)*.35),v=vehicle(kind);
    v.speed=28;v.motion!.grounded=true;v.motion!.pitch=-.2;v.motion!.roll=.1;
    w.setOwnerColliders(77,[{shape:makeBox(96,35,152,8,12,.015),layer:Layer.Static}]);
    let crash=0;
    for(let i=0;i<90;i++){
      crash=Math.max(crash,stepVehicle(v,1,0,w,1/30,i*1000/30));
      expect(v.z).toBeGreaterThan(152+VEHICLES[kind].halfZ*.6);
      expect(v.y).toBeGreaterThan(w.terrainHeight(v.x,v.z)-.5);
    }
    expect(crash).toBeGreaterThan(20);expect(v.health).toBeLessThan(VEHICLES[kind].health);
    expect(Number.isFinite(v.y)).toBe(true);
  });
  it('sweeps a high-speed falling chassis against a thin raised deck',()=>{
    const w=world(),v=vehicle();v.y=36;v.motion!.vy=-60;
    w.setOwnerColliders(77,[{shape:makeBox(96,33.95,160,8,.05,8),layer:Layer.Static}]);
    let crash=0;
    for(let i=0;i<60;i++){
      crash=Math.max(crash,stepVehicle(v,0,0,w,1/30,1000+i*1000/30));
      expect(v.y).toBeGreaterThan(33.7);
    }
    // The springs absorb the landing and the car comes to rest on the deck.
    expect(Math.abs(v.motion!.vy)).toBeLessThan(.2);expect(crash).toBeGreaterThan(50);
  });
  it('reports reverse braking at medium forward speed, with no crash event from normal braking',()=>{
    const w=world(),v=vehicle();v.speed=16;v.motion!.grounded=true;
    stepVehicle(v,-1,0,w,1/30,1000);expect(v.braking).toBe(true);expect(v.impact).toBeUndefined();
    v.speed=4;stepVehicle(v,-1,0,w,1/30,1033);expect(v.braking).toBe(false);
    v.speed=-16;stepVehicle(v,-1,0,w,1/30,1066);expect(v.braking).toBe(false);
    v.speed=16;stepVehicle(v,0,0,w,1/30,1100);expect(v.braking).toBe(false);
  });
  it('keeps a capsized car resting upside down and transforms seats and solid surfaces consistently',()=>{
    const w=world(),v=vehicle();v.y=32;v.motion!.roll=Math.PI;
    for(let i=0;i<360;i++)stepVehicle(v,1,0,w,1/90,i*1000/90);
    expect(Math.cos(v.motion!.roll)).toBeLessThan(-.8);expect(Math.abs(v.speed)).toBeLessThan(.1);
    const p=vehiclePoint(v,.3,.5,-1),local=vehicleLocalPoint(v,p.x,p.y,p.z);
    expect(local.x).toBeCloseTo(.3);expect(local.y).toBeCloseTo(.5);expect(local.z).toBeCloseTo(-1);
    w.setOwnerColliders(99,vehicleColliders(v));
    const chassis=vehiclePoint(v,0,.48,0),hit=makeRayHit();
    expect(w.raycast(chassis.x-5,chassis.y,chassis.z,1,0,0,10,Mask.LineOfSight,hit)).toBe(true);
    expect(hit.tag).toBe(50001);
  });
  it('drives over a small rock with a jolt instead of stopping dead',()=>{
    const w=world(),v=vehicle();v.speed=25;v.motion!.grounded=true;
    w.setOwnerColliders(77,[{shape:makeBox(96.3,30.2,150,.3,.2,.3),layer:Layer.Static}]);
    for(let i=0;i<30;i++)stepVehicle(v,1,0,w,1/30,i*1000/30);
    expect(v.z).toBeLessThan(140);expect(v.speed).toBeGreaterThan(15);expect(v.health).toBe(VEHICLES.car.health);
  });
  it('coasts with inertia instead of braking hard when the throttle is released',()=>{
    const w=world(),v=vehicle();v.speed=30;v.motion!.grounded=true;
    for(let i=0;i<30;i++)stepVehicle(v,0,0,w,1/30,i*1000/30);
    expect(v.speed).toBeGreaterThan(26);expect(v.speed).toBeLessThan(30);
  });
  it('glances off a wall at a shallow angle, keeping speed and never passing through',()=>{
    const w=world(),v=vehicle();v.speed=32;v.yaw=-.25;v.motion!.grounded=true;
    w.setOwnerColliders(77,[{shape:makeBox(99,32,120,.1,4,60),layer:Layer.Static}]);
    for(let i=0;i<45;i++){stepVehicle(v,1,0,w,1/30,i*1000/30);expect(v.x).toBeLessThan(99);}
    expect(Math.hypot(v.speed,v.motion!.lateral??0)).toBeGreaterThan(10);
  });
  it('never tunnels through a thin wall at top speed',()=>{
    const w=world(),v=vehicle();v.speed=34;v.motion!.grounded=true;
    w.setOwnerColliders(77,[{shape:makeBox(96,32,140,8,4,.02),layer:Layer.Static}]);
    for(let i=0;i<60;i++){stepVehicle(v,1,0,w,1/30,i*1000/30);expect(v.z).toBeGreaterThan(140);}
  });
  it('launches off the crest of a ramp with its own momentum',()=>{
    const w=world((_x,z)=>z<150&&z>136?30+(150-z)*.3:30),v=vehicle();v.speed=30;v.motion!.grounded=true;
    let air=0,tilt=0;
    for(let i=0;i<60;i++){
      stepVehicle(v,1,0,w,1/30,i*1000/30);
      if(v.z<146&&v.z>138)tilt=Math.max(tilt,v.motion!.pitch);
      if(v.z<134)air=Math.max(air,v.y-w.terrainHeight(v.x,v.z));
    }
    // The body follows the ramp's angle (atan .3 = .29 rad) and then flies off its lip.
    expect(tilt).toBeGreaterThan(.2);expect(air).toBeGreaterThan(2);
  });
  it('shoves a parked vehicle by momentum instead of stopping against it like a wall',()=>{
    const w=world(),a=vehicle(),b={...vehicle(),id:2,z:150,driver:null,motion:createVehicleMotion('car')};
    a.speed=20;a.motion!.grounded=b.motion.grounded=true;
    const all=new Map([[1,a],[2,b]]),others=(id:number)=>all.get(id);
    for(let i=0;i<20;i++){
      for(const v of all.values()){w.removeOwnerColliders(v.id);stepVehicle(v,v===a?1:0,0,w,1/30,i*1000/30,others);w.setOwnerColliders(v.id,vehicleColliders(v));}
    }
    expect(b.z).toBeLessThan(147);expect(a.speed).toBeLessThan(15);expect(b.health).toBeLessThan(VEHICLES.car.health);
  });
  it.each(['car','jeep','quad'] as const)('turns a %s through tyre forces, leaning outwards without flipping',kind=>{
    const w=world(),v=vehicle(kind);v.speed=18;v.motion!.grounded=true;
    let lean=0;
    for(let i=0;i<60;i++){stepVehicle(v,.4,1,w,1/30,i*1000/30);lean=Math.max(lean,Math.abs(v.motion!.roll));}
    expect(Math.abs(v.yaw)).toBeGreaterThan(.6);expect(lean).toBeGreaterThan(.01);expect(lean).toBeLessThan(.5);
    expect(Math.cos(v.motion!.roll)).toBeGreaterThan(.9);
  });
  it('bounces off a wall hit at an angle and can always reverse away from it',()=>{
    const w=world(),v=vehicle();v.speed=30;v.yaw=-.6;v.motion!.grounded=true;
    w.setOwnerColliders(77,[{shape:makeBox(99,32,130,.15,4,60),layer:Layer.Static}]);
    for(let i=0;i<30;i++){stepVehicle(v,1,0,w,1/30,i*1000/30);expect(v.x).toBeLessThan(99);}
    const x=v.x,z=v.z;
    for(let i=30;i<90;i++)stepVehicle(v,-1,0,w,1/30,i*1000/30);
    expect(Math.hypot(v.x-x,v.z-z)).toBeGreaterThan(3);
  });
  it('glances off a tree trunk without hopping onto it',()=>{
    const w=world(),v=vehicle();v.speed=25;v.motion!.grounded=true;
    w.setOwnerColliders(77,[{shape:makeCapsule(96.7,30,145,96.7,38,145,.35),layer:Layer.Static}]);
    let top=0;
    for(let i=0;i<60;i++){stepVehicle(v,1,0,w,1/30,i*1000/30);top=Math.max(top,v.y);}
    expect(top).toBeLessThan(30.6);expect(Math.hypot(v.x-96.7,v.z-145)).toBeGreaterThan(1);
  });
});
