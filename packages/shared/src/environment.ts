import { z } from 'zod';
import { hash2, hashToUnit } from './random';

/**
 * A map's environment: the global weather, sky and grade, a base climate for the whole map and
 * local zones (dusty fields, wet lowlands, a smoking industrial quarter…) that blend into it.
 *
 * Only this description travels (map file, server, welcome message); every client derives the
 * same weather from it, a match seed and the server clock (`resolveWeather`, `lightningFlash`).
 * Rendering (particles, fog, terrain tint) is the client's own (render/environment.ts).
 */

/* ------------------------------------------------------------------------------ weather */

export const WEATHER_IDS = ['clear', 'partly-cloudy', 'overcast', 'light-rain', 'heavy-rain', 'thunderstorm', 'foggy', 'dust-storm', 'hazy'] as const;
export type WeatherId = typeof WEATHER_IDS[number];

/** What a kind of weather does, all 0…1 unless noted. */
export interface WeatherParams {
  /** Sky covered by cloud. */
  cloud: number;
  /** Haze in the air (0 clear … 2 thick fog). */
  fog: number;
  /** Direct sunlight (1 a clear sky): cloud softens and flattens the light. */
  sun: number;
  /** Sky fill relative to a clear day (overcast light comes from the whole sky). */
  ambient: number;
  rain: number;
  lightning: number;
  /** Airborne dust and sand. */
  dust: number;
  /** Wind speed (m/s). */
  wind: number;
  /** Ground wetness the weather brings. */
  wet: number;
  /** Colour of the haze (sRGB hex); null: the sky's horizon. */
  fogColor: string | null;
  /** Light colour: −1 cool … +1 warm. */
  warmth: number;
  /** Colour saturation of the scene (1 as is). */
  saturation: number;
}

export const WEATHER: Readonly<Record<WeatherId, { name: string } & WeatherParams>> = {
  clear: { name: 'Quang đãng', cloud: .12, fog: .15, sun: 1, ambient: 1, rain: 0, lightning: 0, dust: .04, wind: 3, wet: 0, fogColor: null, warmth: .15, saturation: 1.04 },
  'partly-cloudy': { name: 'Ít mây', cloud: .45, fog: .25, sun: .85, ambient: 1.04, rain: 0, lightning: 0, dust: .03, wind: 5, wet: 0, fogColor: null, warmth: .05, saturation: 1 },
  overcast: { name: 'U ám', cloud: .92, fog: .5, sun: .3, ambient: 1.16, rain: 0, lightning: 0, dust: 0, wind: 6, wet: .1, fogColor: '#9aa1a6', warmth: -.2, saturation: .84 },
  'light-rain': { name: 'Mưa nhỏ', cloud: .88, fog: .6, sun: .26, ambient: 1.1, rain: .35, lightning: 0, dust: 0, wind: 6, wet: .6, fogColor: '#8f989e', warmth: -.3, saturation: .82 },
  'heavy-rain': { name: 'Mưa lớn', cloud: 1, fog: .9, sun: .16, ambient: 1, rain: 1, lightning: .1, dust: 0, wind: 10, wet: 1, fogColor: '#7d868c', warmth: -.4, saturation: .76 },
  thunderstorm: { name: 'Giông bão', cloud: 1, fog: .85, sun: .1, ambient: .82, rain: .9, lightning: 1, dust: 0, wind: 14, wet: 1, fogColor: '#646d76', warmth: -.45, saturation: .72 },
  foggy: { name: 'Sương mù', cloud: .7, fog: 1.7, sun: .38, ambient: 1.1, rain: 0, lightning: 0, dust: 0, wind: 1.5, wet: .35, fogColor: '#a9adae', warmth: -.15, saturation: .8 },
  'dust-storm': { name: 'Bão bụi', cloud: .5, fog: 1.45, sun: .45, ambient: .95, rain: 0, lightning: 0, dust: 1, wind: 17, wet: 0, fogColor: '#b49a74', warmth: .6, saturation: .8 },
  hazy: { name: 'Hanh khô, mù', cloud: .25, fog: .75, sun: .8, ambient: 1.02, rain: 0, lightning: 0, dust: .35, wind: 4, wet: 0, fogColor: '#c9bea6', warmth: .45, saturation: .9 },
};

/* ------------------------------------------------------------------------- local climate */

export const ENV_PARTICLES = ['none', 'dust', 'sand', 'ash', 'mist', 'pollen'] as const;
export type EnvParticles = typeof ENV_PARTICLES[number];

const n = z.number().finite();
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const coord = n.min(-64).max(8256);

/** A place's climate: what the base of the map and every zone set. */
export const envParamsSchema = z.object({
  /** Dust hanging in the air (0…1). */
  dust: n.min(0).max(1).default(.1),
  /** Moisture in the air (0…1): cooler light, low mist. */
  humidity: n.min(0).max(1).default(.4),
  /** Local haze added to the weather's (0…2). */
  fog: n.min(0).max(2).default(0),
  fogColor: hex.nullable().default(null),
  /** Wind (radians, the direction it blows towards; m/s added to the weather's). */
  windDir: n.default(.6),
  windSpeed: n.min(0).max(30).default(0),
  /** Air temperature (°C): heat haze above 30. */
  temperature: n.min(-30).max(55).default(22),
  /** Ground wetness (0 dry … 1 puddles), at least the weather's. */
  wetness: n.min(0).max(1).default(0),
  /** Ground tint (sRGB) and how strongly it colours the terrain (0…1). */
  tint: hex.default('#808080'),
  tintStrength: n.min(0).max(1).default(0),
  /** Particles floating in the air here and how many (0…1). */
  particles: z.enum(ENV_PARTICLES).default('none'),
  particleDensity: n.min(0).max(1).default(.5),
}).strict();
export type EnvParams = z.infer<typeof envParamsSchema>;

export const BIOME_IDS = ['temperate', 'dusty', 'humid', 'wet', 'desert', 'forest', 'industrial'] as const;
export type BiomeId = typeof BIOME_IDS[number];

export const BIOMES: Readonly<Record<BiomeId, { name: string; params: EnvParams }>> = {
  temperate: { name: 'Ôn hoà', params: { dust: .08, humidity: .45, fog: 0, fogColor: null, windDir: .6, windSpeed: 0, temperature: 22, wetness: 0, tint: '#808080', tintStrength: 0, particles: 'none', particleDensity: .3 } },
  dusty: { name: 'Khô, bụi', params: { dust: .65, humidity: .15, fog: .35, fogColor: '#c2ab88', windDir: .6, windSpeed: 3, temperature: 31, wetness: 0, tint: '#a8916a', tintStrength: .35, particles: 'dust', particleDensity: .6 } },
  humid: { name: 'Ẩm', params: { dust: 0, humidity: .85, fog: .4, fogColor: '#a7b2b4', windDir: .6, windSpeed: 0, temperature: 27, wetness: .25, tint: '#6f7f6a', tintStrength: .2, particles: 'mist', particleDensity: .5 } },
  wet: { name: 'Ẩm ướt, bùn lầy', params: { dust: 0, humidity: .9, fog: .3, fogColor: '#959d9f', windDir: .6, windSpeed: 0, temperature: 18, wetness: .85, tint: '#5e5446', tintStrength: .45, particles: 'mist', particleDensity: .35 } },
  desert: { name: 'Sa mạc', params: { dust: .55, humidity: .05, fog: .25, fogColor: '#d6c19a', windDir: .6, windSpeed: 4, temperature: 41, wetness: 0, tint: '#c2a06a', tintStrength: .5, particles: 'sand', particleDensity: .55 } },
  forest: { name: 'Rừng', params: { dust: 0, humidity: .7, fog: .3, fogColor: '#8f9f94', windDir: .6, windSpeed: 0, temperature: 20, wetness: .15, tint: '#55654a', tintStrength: .15, particles: 'pollen', particleDensity: .5 } },
  industrial: { name: 'Công nghiệp, đổ nát', params: { dust: .45, humidity: .35, fog: .45, fogColor: '#8c8a86', windDir: .6, windSpeed: 1, temperature: 21, wetness: 0, tint: '#7c7a76', tintStrength: .4, particles: 'ash', particleDensity: .6 } },
};

/* --------------------------------------------------------------------------------- zones */

export const envShapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('circle'), x: coord, z: coord, r: n.min(1).max(8000) }).strict(),
  z.object({ kind: z.literal('box'), x: coord, z: coord, hx: n.min(1).max(8000), hz: n.min(1).max(8000), yaw: n.default(0) }).strict(),
  z.object({ kind: z.literal('polygon'), points: z.array(z.tuple([coord, coord])).min(3).max(128) }).strict(),
]);
export type EnvShape = z.infer<typeof envShapeSchema>;

export const envZoneSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  biome: z.enum(BIOME_IDS).default('temperate'),
  shape: envShapeSchema,
  /** Metres outside its edge over which a zone fades into what is around it. */
  blend: n.min(0).max(1000).default(60),
  /** Where zones overlap, the higher priority is laid over the lower (ties: by id). */
  priority: n.int().min(-100).max(100).default(0),
  params: envParamsSchema,
}).strict();
export type EnvZone = z.infer<typeof envZoneSchema>;

/* ------------------------------------------------------------------------------- the map */

export const ENV_QUALITY = ['auto', 'low', 'medium', 'high', 'ultra'] as const;
export type EnvQuality = typeof ENV_QUALITY[number];

export const ENVIRONMENT_VERSION = 1;

export const mapEnvironmentSchema = z.object({
  version: z.literal(ENVIRONMENT_VERSION).default(ENVIRONMENT_VERSION),
  weather: z.enum(WEATHER_IDS).default('clear'),
  /** The weather drifts on its own (to neighbouring kinds, the same for everyone in a match). */
  dynamic: z.boolean().default(false),
  /** Fixed time of day (0 midnight … .5 noon); null: the mode's own clock. */
  timeOfDay: n.min(0).max(1).nullable().default(null),
  sun: z.object({ intensity: n.min(0).max(2).default(1), azimuth: n.min(-Math.PI).max(Math.PI).default(0) }).strict().default({}),
  clouds: z.object({ cover: n.min(0).max(1).nullable().default(null), speed: n.min(0).max(4).default(1) }).strict().default({}),
  fog: z.object({ density: n.min(0).max(3).default(1), color: hex.nullable().default(null) }).strict().default({}),
  wind: z.object({ dir: n.default(.6), speed: n.min(0).max(30).nullable().default(null) }).strict().default({}),
  grading: z.object({ saturation: n.min(.3).max(1.6).default(1), contrast: n.min(.6).max(1.4).default(1), warmth: n.min(-1).max(1).default(0), exposure: n.min(.5).max(1.6).default(1) }).strict().default({}),
  /** Highest effect quality this map asks for (players' settings may lower it). */
  quality: z.enum(ENV_QUALITY).default('auto'),
  /** The climate everywhere no zone covers. */
  base: envParamsSchema.default({}),
  zones: z.array(envZoneSchema).max(64).default([]),
}).strict();
export type MapEnvironment = z.infer<typeof mapEnvironmentSchema>;

export function defaultEnvironment(): MapEnvironment { return mapEnvironmentSchema.parse({}); }

/** A stored environment (null, absent or unreadable: the default; never throws). */
export function readEnvironment(raw: unknown): MapEnvironment {
  if (raw === null || raw === undefined) return defaultEnvironment();
  const r = mapEnvironmentSchema.safeParse(raw);
  return r.success ? r.data : defaultEnvironment();
}

/* ------------------------------------------------------------------- battlefield presets */

export const ENVIRONMENT_PRESETS: ReadonlyArray<{ id: string; name: string; env: Partial<MapEnvironment> & { base: EnvParams } }> = [
  { id: 'dusty-rural', name: 'Chiến trường nông thôn bụi', env: { weather: 'hazy', timeOfDay: .4, grading: { saturation: .9, contrast: 1.05, warmth: .3, exposure: 1 }, base: BIOMES.dusty.params } },
  { id: 'overcast-town', name: 'Thị trấn bỏ hoang u ám', env: { weather: 'overcast', timeOfDay: .55, grading: { saturation: .78, contrast: 1.04, warmth: -.15, exposure: .95 }, base: BIOMES.industrial.params } },
  { id: 'tropical-forest', name: 'Rừng nhiệt đới ẩm', env: { weather: 'partly-cloudy', timeOfDay: .38, grading: { saturation: .95, contrast: 1, warmth: 0, exposure: .98 }, base: { ...BIOMES.humid.params, temperature: 31 } } },
  { id: 'rainy-industrial', name: 'Khu công nghiệp mưa', env: { weather: 'heavy-rain', timeOfDay: .6, grading: { saturation: .76, contrast: 1.06, warmth: -.3, exposure: .95 }, base: { ...BIOMES.industrial.params, wetness: .7, particles: 'none' } } },
  { id: 'desert-outpost', name: 'Tiền đồn sa mạc khô', env: { weather: 'clear', timeOfDay: .48, grading: { saturation: .92, contrast: 1.08, warmth: .45, exposure: 1.04 }, base: BIOMES.desert.params } },
  { id: 'foggy-mountain', name: 'Làng núi sương mù', env: { weather: 'foggy', timeOfDay: .3, grading: { saturation: .8, contrast: .96, warmth: -.2, exposure: .97 }, base: { ...BIOMES.forest.params, humidity: .9, particles: 'mist' } } },
];

/** A preset applied to a map: its global settings and base climate, the map's zones kept. */
export function applyEnvironmentPreset(env: MapEnvironment, id: string): MapEnvironment {
  const p = ENVIRONMENT_PRESETS.find((x) => x.id === id);
  if (!p) return env;
  return mapEnvironmentSchema.parse({ ...structuredClone(env), ...structuredClone(p.env), zones: env.zones });
}

/* ------------------------------------------------------------------------ zone geometry */

/** Signed distance (m) from a zone's edge: negative inside. */
export function shapeDistance(s: EnvShape, x: number, z: number): number {
  if (s.kind === 'circle') return Math.hypot(x - s.x, z - s.z) - s.r;
  if (s.kind === 'box') {
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), dx = x - s.x, dz = z - s.z;
    const lx = Math.abs(dx * c - dz * sn) - s.hx, lz = Math.abs(dx * sn + dz * c) - s.hz;
    return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
  }
  const p = s.points;
  let best = Infinity, inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [ax, az] = p[j]!, [bx, bz] = p[i]!;
    if ((bz > z) !== (az > z) && x < (ax - bx) * (z - bz) / (az - bz) + bx) inside = !inside;
    const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return inside ? -best : best;
}

/** How much a zone holds at a point: 1 inside, easing to 0 at `blend` metres outside. */
export function zoneWeight(zone: EnvZone, x: number, z: number): number {
  const d = shapeDistance(zone.shape, x, z);
  if (d <= 0) return 1;
  if (d >= zone.blend) return 0;
  const t = 1 - d / zone.blend;
  return t * t * (3 - 2 * t);
}

/** A zone's bounds (for drawing and baking). */
export function shapeBounds(s: EnvShape): { minX: number; minZ: number; maxX: number; maxZ: number } {
  if (s.kind === 'circle') return { minX: s.x - s.r, minZ: s.z - s.r, maxX: s.x + s.r, maxZ: s.z + s.r };
  if (s.kind === 'box') { const e = Math.hypot(s.hx, s.hz); return { minX: s.x - e, minZ: s.z - e, maxX: s.x + e, maxZ: s.z + e }; }
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of s.points) { minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); }
  return { minX, minZ, maxX, maxZ };
}

/* ------------------------------------------------------------------------------ sampling */

/** The climate at one point, every zone blended in (numbers, colours as linear 0…1 triples). */
export interface EnvSample {
  dust: number; humidity: number; fog: number; fogColor: [number, number, number]; fogColorWeight: number;
  windX: number; windZ: number; temperature: number; wetness: number;
  tint: [number, number, number]; tintStrength: number;
  /** Weight of each kind of particle here (its density folded in). */
  particles: Record<EnvParticles, number>;
}

export function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}

export function emptySample(): EnvSample {
  return { dust: 0, humidity: 0, fog: 0, fogColor: [0, 0, 0], fogColorWeight: 0, windX: 0, windZ: 0, temperature: 0, wetness: 0, tint: [.5, .5, .5], tintStrength: 0, particles: { none: 0, dust: 0, sand: 0, ash: 0, mist: 0, pollen: 0 } };
}

function setFrom(out: EnvSample, p: EnvParams): void {
  out.dust = p.dust; out.humidity = p.humidity; out.fog = p.fog; out.temperature = p.temperature; out.wetness = p.wetness;
  out.windX = Math.sin(p.windDir) * p.windSpeed; out.windZ = Math.cos(p.windDir) * p.windSpeed;
  if (p.fogColor) { out.fogColor = hexRgb(p.fogColor); out.fogColorWeight = 1; } else { out.fogColor = [0, 0, 0]; out.fogColorWeight = 0; }
  out.tint = hexRgb(p.tint); out.tintStrength = p.tintStrength;
  for (const k of ENV_PARTICLES) out.particles[k] = 0;
  out.particles[p.particles] = p.particleDensity;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const scratch = emptySample();

/** Zones in the order they are laid on (lowest priority first, then by id): deterministic. */
export function zonesInOrder(env: MapEnvironment): EnvZone[] {
  return [...env.zones].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The climate at (x, z): the base, then each zone laid over it by its weight there. `ordered`
 * may pass `zonesInOrder(env)` computed once.
 */
export function sampleEnvironment(env: MapEnvironment, x: number, z: number, out: EnvSample = emptySample(), ordered = zonesInOrder(env)): EnvSample {
  setFrom(out, env.base);
  for (const zone of ordered) {
    const w = zoneWeight(zone, x, z);
    if (w <= 0) continue;
    const s = scratch;
    setFrom(s, zone.params);
    out.dust = lerp(out.dust, s.dust, w); out.humidity = lerp(out.humidity, s.humidity, w); out.fog = lerp(out.fog, s.fog, w);
    out.temperature = lerp(out.temperature, s.temperature, w); out.wetness = lerp(out.wetness, s.wetness, w);
    out.windX = lerp(out.windX, s.windX, w); out.windZ = lerp(out.windZ, s.windZ, w);
    // A zone without a haze colour of its own leaves the colour to what is beneath it.
    if (s.fogColorWeight) { const k = w / Math.max(1e-6, out.fogColorWeight * (1 - w) + w); for (let i = 0; i < 3; i++) out.fogColor[i] = lerp(out.fogColor[i]!, s.fogColor[i]!, k); }
    out.fogColorWeight = lerp(out.fogColorWeight, s.fogColorWeight, w);
    for (let i = 0; i < 3; i++) out.tint[i] = lerp(out.tint[i]!, s.tint[i]!, w);
    out.tintStrength = lerp(out.tintStrength, s.tintStrength, w);
    for (const k of ENV_PARTICLES) out.particles[k] = lerp(out.particles[k], s.particles[k], w);
  }
  return out;
}

/* ---------------------------------------------------------------- weather over the match */

/** Kinds of weather each one may drift to. */
const DRIFT: Readonly<Record<WeatherId, readonly WeatherId[]>> = {
  clear: ['partly-cloudy', 'hazy'], 'partly-cloudy': ['clear', 'overcast'], overcast: ['partly-cloudy', 'light-rain', 'foggy'],
  'light-rain': ['overcast', 'heavy-rain'], 'heavy-rain': ['light-rain', 'thunderstorm'], thunderstorm: ['heavy-rain'],
  foggy: ['overcast', 'partly-cloudy'], 'dust-storm': ['hazy'], hazy: ['clear', 'dust-storm'],
};
/** A spell of weather lasts this long (s); the change to the next takes the last minute of it. */
const SPELL = 360, CHANGE = 60;

function spellWeather(env: MapEnvironment, seed: number, spell: number): WeatherId {
  if (!env.dynamic || spell <= 0) return env.weather;
  // The map's own weather half the time; otherwise a neighbour of it.
  const r = hashToUnit(hash2(seed, spell, 0x5eed));
  if (r < .5) return env.weather;
  const options = DRIFT[env.weather];
  return options[Math.floor((r - .5) * 2 * options.length) % options.length]!;
}

/** The weather now: the same for every client given the match seed and the server clock (s). */
export function resolveWeather(env: MapEnvironment, seed: number, time: number): WeatherParams & { id: WeatherId } {
  const spell = Math.floor(time / SPELL), into = time - spell * SPELL;
  const now = spellWeather(env, seed, spell), next = spellWeather(env, seed, spell + 1);
  const k = into > SPELL - CHANGE ? (into - (SPELL - CHANGE)) / CHANGE : 0, t = k * k * (3 - 2 * k);
  const a = WEATHER[now], b = WEATHER[next];
  const out: WeatherParams & { id: WeatherId } = {
    id: t < .5 ? now : next,
    cloud: lerp(a.cloud, b.cloud, t), fog: lerp(a.fog, b.fog, t), sun: lerp(a.sun, b.sun, t), ambient: lerp(a.ambient, b.ambient, t),
    rain: lerp(a.rain, b.rain, t), lightning: lerp(a.lightning, b.lightning, t), dust: lerp(a.dust, b.dust, t), wind: lerp(a.wind, b.wind, t),
    wet: lerp(a.wet, b.wet, t), fogColor: t < .5 ? a.fogColor : b.fogColor, warmth: lerp(a.warmth, b.warmth, t), saturation: lerp(a.saturation, b.saturation, t),
  };
  if (env.clouds.cover !== null) out.cloud = env.clouds.cover;
  if (env.wind.speed !== null) out.wind = env.wind.speed;
  return out;
}

/** A lightning flash's brightness now (0…1), the same instant for everyone. */
export function lightningFlash(seed: number, time: number, strength: number): number {
  if (strength <= 0) return 0;
  const second = Math.floor(time), into = time - second;
  if (hashToUnit(hash2(seed, second, 0x11)) > .07 * strength) return 0;
  // A strike: a bright first stroke, often a second a moment later.
  const at = hashToUnit(hash2(seed, second, 0x12)) * .5, d = into - at;
  if (d < 0) return 0;
  const first = Math.exp(-d * 14), again = d > .12 && hashToUnit(hash2(seed, second, 0x13)) < .6 ? Math.exp(-(d - .12) * 16) * .8 : 0;
  return Math.min(1, first + again);
}
