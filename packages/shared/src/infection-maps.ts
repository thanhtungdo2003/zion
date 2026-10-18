import { z } from 'zod';
import { INFECTION, INFECTION_MAP } from './infection';

/**
 * Infection maps, authored in the Studio: terrain from a seed, how much grass, trees and rocks
 * grow, the structures and materials placed by hand, spawn points and the round rules. The
 * active map is what new Infection matches are played on.
 */

/** Round rules a map can tune (defaults: INFECTION and INFECTION_MAP). */
export const infectionRulesSchema = z.object({
  maxPlayers: z.number().int().min(2).max(32),
  botFill: z.number().int().min(0).max(32),
  minPlayers: z.number().int().min(1).max(32),
  lobbyWaitMs: z.number().int().min(5_000).max(600_000),
  rounds: z.number().int().min(1).max(20),
  countdownMs: z.number().int().min(3_000).max(120_000),
  outbreakMs: z.number().int().min(1_000).max(120_000),
  roundMs: z.number().int().min(30_000).max(1_800_000),
  finishedMs: z.number().int().min(3_000).max(60_000),
  perZombie: z.number().int().min(1).max(32),
  zombieHealth: z.number().int().min(1).max(100_000),
  zombieSpeed: z.number().min(.5).max(3),
  zombieJump: z.number().min(.5).max(3),
  zombieRespawnMs: z.number().int().min(0).max(60_000),
  knockPerDamage: z.number().min(0).max(2),
  knockMax: z.number().min(0).max(30),
  timeOfDay: z.number().min(0).max(1),
}).strict();
export type InfectionRules = z.infer<typeof infectionRulesSchema>;
export const DEFAULT_INFECTION_RULES: InfectionRules = { ...INFECTION, maxPlayers: INFECTION_MAP.maxPlayers, botFill: INFECTION_MAP.botFill };

const point = z.object({ x: z.number().finite().min(-400).max(400), z: z.number().finite().min(-400).max(400) }).strict();
/** A placed model, in metres from the map centre (y above the ground there). */
export const infectionPartSchema = z.object({
  asset: z.number().int().min(0).max(0xffff),
  x: z.number().finite().min(-400).max(400),
  y: z.number().finite().min(-20).max(120),
  z: z.number().finite().min(-400).max(400),
  yaw: z.number().finite(),
  scale: z.number().min(.05).max(10),
}).strict();
export type InfectionPart = z.infer<typeof infectionPartSchema>;

export const INFECTION_SURFACES = ['dirt', 'grass', 'gravel', 'sand', 'asphalt', 'snow'] as const;

export const infectionMapSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  /**
   * 'warehouse': the Warehouse map model; 'friday13': the old street town (The Street);
   * 'empty': only what is placed.
   */
  base: z.enum(['warehouse', 'friday13', 'empty']),
  seed: z.string().trim().min(1).max(60),
  /** Half the width of the walled play area (m). */
  half: z.number().int().min(30).max(170),
  terrain: z.object({
    /** Rolling ground inside the walls (0 flat … 1 hilly, about ±6 m). */
    hills: z.number().min(0).max(1),
    /** Height of the banks beyond the wall (m). */
    banks: z.number().min(0).max(80),
    /** Perimeter wall: none, concrete or stone, with its height scale. */
    wall: z.enum(['none', 'concrete', 'mossy', 'stone']),
    wallScale: z.number().min(.5).max(3),
  }).strict(),
  environment: z.object({
    /** Share of the ground covered in grass (0…1). */
    grass: z.number().min(0).max(1),
    /** Trees, bushes and rocks per hectare. */
    trees: z.number().min(0).max(200),
    bushes: z.number().min(0).max(300),
    rocks: z.number().min(0).max(200),
    /** Share of the trees that are dead (0…1). */
    deadTrees: z.number().min(0).max(1),
    ground: z.enum(INFECTION_SURFACES),
  }).strict(),
  parts: z.array(infectionPartSchema).max(4000),
  /** Where humans (and, when listed, zombies) appear. Empty: spread automatically. */
  spawns: z.array(point).max(200),
  zombieSpawns: z.array(point).max(200),
  rules: infectionRulesSchema,
}).strict();
export type InfectionMapDef = z.infer<typeof infectionMapSchema>;

export const infectionMapsSchema = z.object({
  active: z.string(),
  maps: z.array(infectionMapSchema).min(1).max(50),
}).strict().refine((v) => v.maps.some((m) => m.id === v.active), { message: 'the active map must exist' })
  .refine((v) => new Set(v.maps.map((m) => m.id)).size === v.maps.length, { message: 'map ids must be unique' });
export type InfectionMaps = z.infer<typeof infectionMapsSchema>;

/** The built-in map: the Warehouse yard (one whole map model), replacing The Street. */
export const DEFAULT_INFECTION_MAP: InfectionMapDef = {
  id: INFECTION_MAP.id, name: INFECTION_MAP.name, base: 'warehouse', seed: INFECTION_MAP.seed, half: 42,
  terrain: { hills: 0, banks: 34, wall: 'none', wallScale: 1 },
  environment: { grass: 0, trees: 0, bushes: 0, rocks: 0, deadTrees: 1, ground: 'asphalt' },
  parts: [], spawns: [], zombieSpawns: [], rules: { ...DEFAULT_INFECTION_RULES },
};

/** A new, empty map with the default rules. */
export function blankInfectionMap(id: string, name: string, seed: string): InfectionMapDef {
  return {
    id, name, base: 'empty', seed, half: 80,
    terrain: { hills: .35, banks: 40, wall: 'concrete', wallScale: 1.5 },
    environment: { grass: .6, trees: 8, bushes: 12, rocks: 6, deadTrees: .3, ground: 'dirt' },
    parts: [], spawns: [], zombieSpawns: [], rules: { ...DEFAULT_INFECTION_RULES },
  };
}

export const DEFAULT_INFECTION_MAPS: InfectionMaps = { active: DEFAULT_INFECTION_MAP.id, maps: [DEFAULT_INFECTION_MAP] };

/** The Street's built-in id: worlds saved with it switch to the Warehouse. */
export const RETIRED_INFECTION_MAP_ID = 'friday-13';

/** Stored maps with the retired built-in replaced by the Warehouse (made active if The Street was). */
export function upgradeInfectionMaps(maps: InfectionMaps): InfectionMaps {
  const list = maps.maps.filter((m) => !(m.id === RETIRED_INFECTION_MAP_ID && m.base === 'friday13') && m.id !== DEFAULT_INFECTION_MAP.id);
  const active = maps.active === RETIRED_INFECTION_MAP_ID || !list.some((m) => m.id === maps.active) ? DEFAULT_INFECTION_MAP.id : maps.active;
  return { active, maps: [structuredClone(DEFAULT_INFECTION_MAP), ...list] };
}
