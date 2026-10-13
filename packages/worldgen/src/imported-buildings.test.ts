import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, assetColliders } from '@zion/assets';
import { CharacterController, CollisionWorld, Heightfield, createCharacterState } from '../../physics/src/index';
import { TICK_DT } from '@zion/shared';
import { importedRoofAccess } from './imported-buildings';

describe('imported building collision',()=>{
  it('climbs the exterior favela ladder onto the roof',()=>{
    const w=new CollisionWorld({worldSize:96,seaLevel:20}),registry=createDefaultRegistry();
    for(let x=0;x<3;x++)for(let z=0;z<3;z++)w.addChunk(x,z,new Heightfield(x*32,z*32,1,33,new Float32Array(1089).fill(30),new Float32Array(1089).fill(NaN)),[]);
    const parts=importedRoofAccess([{asset:2420,x:0,y:0,z:0,yaw:0,scale:1,group:1}]);
    for(const [i,p]of parts.entries())w.setOwnerColliders(i+1,assetColliders(registry.byNumericId(p.asset)!,{x:48+p.x,y:30+p.y,z:48+p.z,rotY:p.yaw,scale:p.scale}));
    const c=new CharacterController(w),s=createCharacterState(42.3,30.05,48);s.grounded=true;
    for(let i=0;i<130;i++)c.step(s,{mx:0,mz:1,yaw:-Math.PI/2,jump:false,sprint:false},TICK_DT);
    expect(s.y).toBeGreaterThan(36.4);expect(s.x).toBeGreaterThan(43.1);expect(s.grounded).toBe(true);
  });
  it('walks the apartment switchback stairs to both upper floors and the roof',()=>{
    const w=new CollisionWorld({worldSize:96,seaLevel:20}),registry=createDefaultRegistry();
    for(let x=0;x<3;x++)for(let z=0;z<3;z++)w.addChunk(x,z,new Heightfield(x*32,z*32,1,33,new Float32Array(1089).fill(30),new Float32Array(1089).fill(NaN)),[]);
    w.setOwnerColliders(1,assetColliders(registry.byNumericId(2421)!,{x:48,y:30,z:48,rotY:0,scale:1}));
    const c=new CharacterController(w),s=createCharacterState(46.7,30.08,44.6);s.grounded=true;
    const walk=(x:number,z:number)=>{
      for(let i=0;i<200;i++){
        const dx=48+x-s.x,dz=48+z-s.z;
        if(Math.hypot(dx,dz)<.12)return;
        c.step(s,{mx:0,mz:1,yaw:Math.atan2(-dx,-dz),jump:false,sprint:false},TICK_DT);
      }
      expect({x:s.x-48,y:s.y-30,z:s.z-48}).toEqual({x,z});
    };
    for(let floor=1;floor<=3;floor++){
      walk(-1.3,-7.5);walk(1.3,-7.5);walk(1.3,-3.1);
      expect(s.y).toBeGreaterThan(30+floor*3.1);
      if(floor<3)walk(-1.3,-3.1);
    }
  });
  it('climbs the actual favela stair treads from the entrance slab to the upper floor',()=>{
    const w=new CollisionWorld({worldSize:96,seaLevel:20}),registry=createDefaultRegistry();
    for(let x=0;x<3;x++)for(let z=0;z<3;z++)w.addChunk(x,z,new Heightfield(x*32,z*32,1,33,new Float32Array(1089).fill(30),new Float32Array(1089).fill(NaN)),[]);
    w.setOwnerColliders(1,assetColliders(registry.byNumericId(2420)!,{x:48,y:30,z:48,rotY:0,scale:1}));
    const c=new CharacterController(w),s=createCharacterState(43,30.05,51.05);
    s.grounded=true;
    for(let i=0;i<100;i++)c.step(s,{mx:0,mz:1,yaw:-Math.PI/2,jump:false,sprint:false},TICK_DT);
    expect(s.x).toBeGreaterThan(49);expect(s.y).toBeGreaterThan(33);
  });
});
