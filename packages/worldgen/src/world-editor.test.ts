import { describe, expect, it } from 'vitest';
import { buildChunkCollision, createDefaultRegistry } from '@zion/assets';
import { BATTLE_MAP, TICK_DT } from '@zion/shared';
import { CharacterController, CollisionWorld, createCharacterState } from '../../physics/src/index';
import { ISLAND, type AuthoredMap } from './maps/island';
import { WorldGenerator } from './generator';
import { normalizeSeed } from './config';
import { authoredWorld } from './maps/authored';
import { checkpoint, currentIsland, distanceToSegment, openIsland, readIslandDocument, rollback, rollbackPass, ruralSettlementPass, terrainPass, townParcels, townRoadPass } from './world-editor';

const registry = createDefaultRegistry();
const make = (battleIsland?: AuthoredMap) => new WorldGenerator({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, mode: 'battle-royale', battleIsland }, registry);
describe('real island editor revisions', () => {
  it('round trips, rolls back, and rejects altered coastline, baseline or POIs', () => {
    const baseline = openIsland(), edited = checkpoint(baseline, 'terrain', terrainPass(currentIsland(baseline)));
    expect(readIslandDocument(JSON.stringify(edited))).toEqual(edited);
    expect(rollback(edited,0)).toEqual(baseline);
    expect(ISLAND.terrainEdits).toBeUndefined();
    for(const field of ['coast','zones'] as const) {
      const bad = structuredClone(edited);
      if(field === 'coast') bad.revisions[1]!.map.coast[0]![0] += 1;
      else bad.revisions[1]!.map.zones[0]!.x += 1;
      expect(()=>readIslandDocument(JSON.stringify(bad))).toThrow('Protected');
    }
    const bad = structuredClone(edited); bad.revisions[0]!.map.name='Different baseline';
    expect(()=>readIslandDocument(JSON.stringify(bad))).toThrow('Baseline');
    expect(()=>rollback(edited,-1)).toThrow();
    const dressed=checkpoint(edited,'environment',{...currentIsland(edited),dressExtraBuildings:true});
    const reverted=rollbackPass(dressed,'terrain');
    expect(currentIsland(reverted).terrainEdits).toBeUndefined();
    expect(currentIsland(reverted).dressExtraBuildings).toBe(true);
    expect(readIslandDocument(JSON.stringify(reverted))).toEqual(reverted);
  });
  it('applies persisted sculpting to generated terrain while retaining structures, loot and coast', () => {
    const original=make(), edited=make(terrainPass(ISLAND));
    expect(edited.heightAt(2550,1850)).toBeLessThan(original.heightAt(2550,1850)-1);
    for(const [x,z] of ISLAND.coast) expect(edited.heightAt(x,z)).toBe(original.heightAt(x,z));
    const before=authoredWorld(original),after=authoredWorld(edited);
    expect(after.structures()).toEqual(before.structures());
    expect(after.lootSpots()).toEqual(before.lootSpots());
    for (const p of ISLAND.zones) expect(edited.heightAt(p.x,p.z)).toBe(original.heightAt(p.x,p.z));
    const loaded=make(currentIsland(readIslandDocument(JSON.stringify(checkpoint(openIsland(),'terrain',terrainPass(ISLAND))))));
    expect(loaded.generateChunk(79,57,0)).toEqual(edited.generateChunk(79,57,0));
  });
  it('makes parcels only for enclosed streets, with frontage, road setbacks and no overlap', () => {
    expect(townParcels(ISLAND)).toEqual([]);
    const result=townRoadPass(ISLAND,[],()=>40);
    expect(result.map.roads.length).toBe(ISLAND.roads.length+2);
    const parcels=townParcels(result.map);
    expect(parcels.length).toBeGreaterThan(0);
    expect(new Set(parcels.map(p=>p.block)).size).toBe(2);
    for(const p of parcels) {
      expect(p.polygon[0]![0]).toBeGreaterThan(1840);
      expect(p.polygon[0]![1]).toBeGreaterThan(2602+8.1);
      expect(p.polygon[2]![1]).toBeLessThan(2760-8.1);
      expect(p.frontage[0][0]).toBe(p.frontage[1][0]);
    }
    expect(townRoadPass(ISLAND,[],(_x,z)=>z).map.roads).toEqual(ISLAND.roads);
  });
  it('places real existing house assets into rural frontage lots without moving gameplay sites', () => {
    const original=make(),before=authoredWorld(original);
    const result=ruralSettlementPass(ISLAND,before.structures(),registry,(x,z)=>original.heightAt(x,z),(x,z)=>before.coastDistance(x,z));
    expect(result.parcels).toHaveLength(2);
    const edited=make({...result.map,dressExtraBuildings:true}),after=authoredWorld(edited);
    expect(after.structures().slice(0,before.structures().length)).toEqual(before.structures());
    expect(after.lootSpots()).toEqual(before.lootSpots());
    for(const building of result.map.extraBuildings!) {
      const def=registry.byNumericId(building.asset)!;
      expect(def.colliders.length).toBeGreaterThan(0);
      expect(before.coastDistance(building.x,building.z)).toBeGreaterThan(180);
      expect(edited.heightAt(building.x,building.z)).toBeCloseTo(original.heightAt(building.x,building.z),1);
      for(const road of ISLAND.roads) for(let i=1;i<road.points.length;i++) expect(distanceToSegment([building.x,building.z],road.points[i-1]!,road.points[i]!)).toBeGreaterThan(road.width+def.bounds.radius+8);
      for(const site of before.structures().filter(s=>s.parts.length && s.radius>2)) expect(Math.hypot(site.x-building.x,site.z-building.z)).toBeGreaterThan(site.radius+def.bounds.radius+12);
      const cx=Math.floor(building.x/32),cz=Math.floor(building.z/32);
      expect(edited.generateChunk(cx,cz,0).props.some(p=>p.asset===building.asset)).toBe(true);
      const collision=new CollisionWorld({worldSize:4096,seaLevel:20});
      for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++) {
        const chunk=edited.generateChunk(cx+dx,cz+dz,0),data=buildChunkCollision(chunk,registry);
        expect(data.unknownAssets).toBe(0);
        collision.addChunk(cx+dx,cz+dz,data.heightfield,data.colliders);
      }
      const c=Math.cos(building.yaw),s=Math.sin(building.yaw),x=building.x-12*s,z=building.z-12*c;
      const state=createCharacterState(x,collision.terrainHeight(x,z),z),controller=new CharacterController(collision);
      state.grounded=true;
      for(let tick=0;tick<240;tick++)controller.step(state,{mx:0,mz:1,yaw:building.yaw+Math.PI,jump:false,sprint:false},TICK_DT);
      const localZ=(state.x-building.x)*s+(state.z-building.z)*c;
      expect(localZ).toBeGreaterThan(-3.5);
      expect(localZ).toBeLessThan(-2);
      expect(state.grounded).toBe(true);
    }
    expect(ruralSettlementPass(result.map,after.structures(),registry,(x,z)=>edited.heightAt(x,z),(x,z)=>after.coastDistance(x,z)).map.extraBuildings).toEqual(result.map.extraBuildings);
  });
});
