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
  terrainGrid: z.object({ size: z.number().positive().max(16384), cell: z.number().positive().max(64), data: z.string().max(40_000_000) }).strict().optional(),
  placed: z.array(z.object({
    x: z.number().finite(), z: z.number().finite(), y: z.number().finite(), yaw: z.number().finite(), radius: z.number().min(0).max(500),
    halfX: z.number().min(0).optional(), halfZ: z.number().min(0).optional(), decal: z.boolean().optional(),
    parts: z.array(z.object({ asset: z.number().int(), x: z.number().finite(), y: z.number().finite(), z: z.number().finite(), yaw: z.number().finite(), scale: z.number().positive() }).strict()).max(4000),
  }).strict()).max(40000).optional(),
  flora: z.array(z.tuple([z.number().int(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().positive()])).max(120000).optional(),
}).strict();
