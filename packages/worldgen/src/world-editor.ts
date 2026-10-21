/** Independent implementations informed by the source audit in docs/procedural-world-research.md. */
import { z } from 'zod';
import { ISLAND, type AuthoredMap, type MapRoad, type Point } from './maps/island';
import { authoredMapSchema } from './maps/schema';
import type { Structure } from './structures';
import type { AssetRegistry } from '@zion/assets';

export const EDITOR_PASSES = ['baseline', 'terrain', 'roads', 'settlement', 'environment'] as const;
export type EditorPass = typeof EDITOR_PASSES[number];
const revisionSchema = z.object({ pass: z.enum(EDITOR_PASSES), map: authoredMapSchema, action: z.literal('rollback').optional() }).strict();
export const islandDocumentSchema = z.object({
  format: z.literal('zion-island-editor'), version: z.literal(1),
  revisions: z.array(revisionSchema).min(1).max(64),
}).strict();
export type IslandDocument = z.infer<typeof islandDocumentSchema>;
const baselineMap = authoredMapSchema.parse(ISLAND);

export function openIsland(): IslandDocument {
  return islandDocumentSchema.parse({ format: 'zion-island-editor', version: 1, revisions: [{ pass: 'baseline', map: structuredClone(ISLAND) }] });
}
export function currentIsland(doc: IslandDocument): AuthoredMap { return doc.revisions[doc.revisions.length - 1]!.map; }
export function protectedIsland(map: AuthoredMap): void {
  const normalized = authoredMapSchema.parse(map);
  for (const key of ['id', 'coast', 'hills', 'zones', 'power'] as const) {
    if (JSON.stringify(normalized[key]) !== JSON.stringify(baselineMap[key])) throw new Error(`Protected island field: ${key}`);
  }
  if (JSON.stringify(normalized.roads.slice(0, baselineMap.roads.length)) !== JSON.stringify(baselineMap.roads)) throw new Error('Original roads must be preserved');
  const ids = new Set<string>();
  for (const b of normalized.extraBuildings ?? []) {
    const zone = map.zones.find(z=>z.id===b.zone && (z.kind==='village'||z.kind==='farm'));
    if (!zone || Math.hypot(zone.x-b.x,zone.z-b.z)>zone.radius-12 || ids.has(b.id)) throw new Error('Invalid supplemental building zone or duplicate id');
    ids.add(b.id);
  }
}
export function readIslandDocument(json: string): IslandDocument {
  if (json.length > 4_000_000) throw new Error('Editor file exceeds 4 MB');
  const doc = islandDocumentSchema.parse(JSON.parse(json));
  if (doc.revisions[0]!.pass !== 'baseline' || JSON.stringify(doc.revisions[0]!.map) !== JSON.stringify(baselineMap)) throw new Error('Baseline does not match the original island');
  for (const revision of doc.revisions) protectedIsland(revision.map);
  return doc;
}
export function checkpoint(doc: IslandDocument, pass: EditorPass, map: AuthoredMap): IslandDocument {
  protectedIsland(map);
  return islandDocumentSchema.parse({ ...doc, revisions: [...doc.revisions, { pass, map }] });
}
export function rollback(doc: IslandDocument, revision: number): IslandDocument {
  if (!Number.isInteger(revision) || revision < 0 || revision >= doc.revisions.length) throw new Error('Invalid revision');
  return { ...doc, revisions: doc.revisions.slice(0, revision + 1) };
}

/** Undo only the latest application of one pass, retaining other passes as a new checkpoint. */
export function rollbackPass(doc: IslandDocument, pass: Exclude<EditorPass,'baseline'>): IslandDocument {
  let index = -1;
  for (let i = doc.revisions.length-1; i>0; i--) if (doc.revisions[i]!.pass===pass && doc.revisions[i]!.action!=='rollback') { index=i;break; }
  if (index<1) throw new Error(`No ${pass} pass to roll back`);
  const before=doc.revisions[index-1]!.map, map=structuredClone(currentIsland(doc));
  if(pass==='terrain') { if(before.terrainEdits)map.terrainEdits=structuredClone(before.terrainEdits);else delete map.terrainEdits; }
  if(pass==='roads') map.roads=structuredClone(before.roads);
  if(pass==='settlement') { if(before.extraBuildings)map.extraBuildings=structuredClone(before.extraBuildings);else delete map.extraBuildings; }
  if(pass==='environment') { if(before.dressExtraBuildings!==undefined)map.dressExtraBuildings=before.dressExtraBuildings;else delete map.dressExtraBuildings; }
  protectedIsland(map);
  return islandDocumentSchema.parse({...doc,revisions:[...doc.revisions,{pass,map,action:'rollback'}]});
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = dx * dx + dz * dz;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}

/** Conservative connector pass: both ends meet existing cross streets; protected sites win. */
export function townRoadPass(map: AuthoredMap, sites: readonly Structure[], height: (x: number, z: number) => number): { map: AuthoredMap; rejected: string[] } {
  const next = structuredClone(map), rejected: string[] = [];
  for (const candidates of [[1880, 1860, 1840, 1900], [2080, 2100, 2120, 2060]]) for (const x of candidates) {
    const road: MapRoad = { width: 5, paved: true, points: [[x, 2602], [x, 2760]] };
    if (map.roads.some(r => r.width === road.width && JSON.stringify(r.points) === JSON.stringify(road.points))) break;
    if (sites.some(s => s.parts.length && s.radius > 2 && distanceToSegment([s.x, s.z], road.points[0]!, road.points[1]!) < s.radius + road.width + 7)) {
      rejected.push(`${x}: protected structure corridor`); continue;
    }
    let valid = true;
    for (let z = 2602; z <= 2760; z += 2) if (Math.abs(height(x, z + 2) - height(x, z)) / 2 > .12) valid = false;
    if (valid) { next.roads.push(road); break; } else rejected.push(`${x}: grade exceeds 12%`);
  }
  return { map: next, rejected };
}

export interface Parcel { id: string; block: string; polygon: Point[]; frontage: [Point, Point] }

/** Rural frontage lots differ from enclosed town blocks. Deterministic finite search, actual
 * asset bounds, five terrain probes, existing site exclusion and a clear road approach.
 */
export function ruralSettlementPass(map: AuthoredMap, sites: readonly Structure[], registry: AssetRegistry,
  height: (x: number, z: number) => number, coast: (x: number, z: number) => number,
): { map: AuthoredMap; parcels: Parcel[] } {
  const next = structuredClone(map), parcels: Parcel[] = [];
  next.extraBuildings ??= [];
  const asset = registry.byNumericId(2404);
  if (!asset || !asset.colliders.length) throw new Error('Missing small house asset or collider');
  const radius = asset.bounds.radius;
  const occupied = sites.filter(s=>s.parts.length && s.radius>2).map(s=>({x:s.x,z:s.z,radius:s.radius}));
  for (const b of next.extraBuildings) occupied.push({ x:b.x,z:b.z,radius:8.5 });
  for (const zone of map.zones.filter(z=>z.kind==='village' || z.kind==='farm')) {
    let placed = next.extraBuildings.filter(b=>b.zone===zone.id).length;
    for (let ri=0;ri<map.roads.length && placed<2;ri++) {
      const road=map.roads[ri]!;
      if (road.route || road.width>12) continue;
      for (let i=1;i<road.points.length && placed<2;i++) {
        const a=road.points[i-1]!,b=road.points[i]!,length=Math.hypot(b[0]-a[0],b[1]-a[1]);
        if(length<1)continue;
        const dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length;
        for (let along=12;along<length-12 && placed<2;along+=20) for(const side of [-1,1]) {
          if(placed>=2)break;
          const offset=road.width+14,x=a[0]+dx*along-dz*side*offset,z=a[1]+dz*along+dx*side*offset;
          if(Math.hypot(x-zone.x,z-zone.z)>zone.radius-12 || coast(x,z)<180 || x<12 || z<12 || x>4084 || z>4084)continue;
          if(occupied.some(s=>Math.hypot(x-s.x,z-s.z)<s.radius+radius+12))continue;
          const at=height(x,z), probes=[[-radius,-radius],[radius,-radius],[-radius,radius],[radius,radius]];
          if(at<23 || probes.some(([ox,oz])=>Math.abs(height(x+ox!,z+oz!)-at)/radius>.12))continue;
          if(map.roads.some(r=>r.points.some((p,j)=>j>0 && distanceToSegment([x,z],r.points[j-1]!,p)<r.width+radius+8)))continue;
          if(map.power.some(r=>r.points.some((p,j)=>j>0 && distanceToSegment([x,z],r.points[j-1]!,p)<radius+8)))continue;
          const id=`${zone.id}-${ri}-${i}-${along}-${side}`;
          occupied.push({x,z,radius:8.5}); placed++;
          const point=(u:number,v:number):Point=>[x+dx*u-dz*v,z+dz*u+dx*v];
          const parcel: Parcel = {id,block:`rural-${zone.id}`,polygon:[point(-9,-9),point(9,-9),point(9,9),point(-9,9)],frontage:[point(-9,-9*side),point(9,-9*side)]};
          parcels.push(parcel);
          next.extraBuildings.push({id,zone:zone.id,asset:2404,x,z,yaw:Math.atan2(-dz*side,dx*side),lot:{polygon:parcel.polygon,frontage:parcel.frontage}});
        }
      }
    }
  }
  return {map:next,parcels};
}
/** Rectilinear town specialization: only enclosed blocks with four actual road boundaries.
 * Uses road setbacks and frontage subdivision; never treats an unconnected street as a block.
 */
export function townParcels(map: AuthoredMap): Parcel[] {
  const vertical: Array<{ x: number; a: number; b: number; width: number }> = [];
  const horizontal: Array<{ z: number; a: number; b: number; width: number }> = [];
  for (const r of map.roads) for (let i = 1; i < r.points.length; i++) {
    const [a, b] = [r.points[i - 1]!, r.points[i]!];
    if (a[0] === b[0]) vertical.push({ x: a[0], a: Math.min(a[1], b[1]), b: Math.max(a[1], b[1]), width: r.width });
    if (a[1] === b[1]) horizontal.push({ z: a[1], a: Math.min(a[0], b[0]), b: Math.max(a[0], b[0]), width: r.width });
  }
  const xs = [...new Set(vertical.filter(v => v.x >= 1800 && v.x <= 2160 && v.a <= 2602 && v.b >= 2760).map(v => v.x))].sort((a,b) => a-b);
  const parcels: Parcel[] = [];
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1]!, right = xs[i]!;
    const covered = (z: number) => {
      const intervals = horizontal.filter(h => h.z === z).sort((a,b) => a.a-b.a);
      let cursor = left;
      for (const h of intervals) if (h.a <= cursor) cursor = Math.max(cursor, h.b);
      return cursor >= right;
    };
    if (!covered(2602) || !covered(2760)) continue;
    const west = vertical.find(v => v.x === left && v.a <= 2602 && v.b >= 2760)!;
    const east = vertical.find(v => v.x === right && v.a <= 2602 && v.b >= 2760)!;
    const x0 = left + west.width + 4, x1 = right - east.width - 4;
    const north = Math.max(...horizontal.filter(h => h.z === 2602).map(h => h.width));
    const south = Math.max(...horizontal.filter(h => h.z === 2760).map(h => h.width));
    const z0 = 2602 + north + 4, z1 = 2760 - south - 4;
    if (x1 - x0 < 24 || z1 - z0 < 24) continue;
    const mid = (x0+x1)/2, count = Math.floor((z1-z0)/24);
    for (let j = 0; j < count; j++) for (const side of [0, 1]) {
      const a = z0 + (z1-z0)*j/count, b = z0 + (z1-z0)*(j+1)/count;
      const l = side ? mid : x0, r = side ? x1 : mid, street = side ? r : l;
      parcels.push({ id: `town-${i}-${side}-${j}`, block: `town-${i}`, polygon: [[l,a],[r,a],[r,b],[l,b]], frontage: [[street,a],[street,b]] });
    }
  }
  return parcels;
}

export function terrainPass(map: AuthoredMap): AuthoredMap {
  return { ...structuredClone(map), terrainEdits: [
    { x: 1280, z: 2170, radius: 210, delta: -6 },
    { x: 2550, z: 1850, radius: 260, delta: -8 },
    { x: 1700, z: 2100, radius: 220, delta: 5 },
  ] };
}
