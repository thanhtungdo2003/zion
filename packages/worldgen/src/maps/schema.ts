import { z } from 'zod';

const coordinate = z.number().finite().min(0).max(4096);
const point = z.tuple([coordinate, coordinate]);
export const terrainEditSchema = z.object({
  x: coordinate, z: coordinate, radius: z.number().min(16).max(600),
  delta: z.number().min(-12).max(12),
}).strict();
export const authoredMapSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(120),
  coast: z.array(point).min(3).max(512),
  hills: z.array(z.object({ x: coordinate, z: coordinate, radius: z.number().positive().max(2000), height: z.number().finite().min(0).max(500) }).strict()).max(256),
  forests: z.array(z.object({ x: coordinate, z: coordinate, radius: z.number().positive().max(2000) }).strict()).max(256),
  zones: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['port', 'town', 'military', 'power_plant', 'airfield', 'village', 'radar', 'substation', 'farm', 'lighthouse', 'school', 'church', 'station', 'stadium', 'park']), x: coordinate, z: coordinate, radius: z.number().positive().max(2000) }).strict()).max(128),
  roads: z.array(z.object({ points: z.array(point).min(2).max(2048), width: z.number().min(2).max(40), paved: z.boolean(), route: z.boolean().optional() }).strict()).max(256),
  power: z.array(z.object({ points: z.array(point).min(2).max(256), kind: z.enum(['tower', 'hframe']), spacing: z.number().min(10).max(500) }).strict()).max(128),
  terrainEdits: z.array(terrainEditSchema).max(128).optional(),
  extraBuildings: z.array(z.object({ id: z.string().min(1).max(80), zone: z.string().min(1).max(80), asset: z.literal(2404), x: coordinate, z: coordinate, yaw: z.number().finite().min(-Math.PI * 2).max(Math.PI * 2), lot: z.object({ polygon: z.array(point).length(4), frontage: z.tuple([point,point]) }).strict().optional() }).strict()).max(64).optional(),
  dressExtraBuildings: z.boolean().optional(),
}).strict();
