import {
  AdditiveBlending, BufferGeometry, Color, DataTexture, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, Mesh, NormalBlending, Points, RGBAFormat,
  type Scene, ShaderMaterial, type MeshStandardMaterial, UnsignedByteType, Vector3,
} from 'three';
import {
  ENV_PARTICLES, emptySample, hexRgb, lightningFlash, resolveWeather, sampleEnvironment, zonesInOrder,
  type EnvParticles, type EnvSample, type MapEnvironment, type WeatherParams,
} from '@zion/shared';
import type { SkySystem } from './sky';

/**
 * The map's environment on screen: the weather over the sky (cloud, haze, softer or harder
 * light, lightning), the local climate where the camera is (haze colour, wind, airborne dust,
 * ash, mist, pollen), rain round the camera with splashes on the ground, and the ground itself
 * tinted, darkened and glossy where it is wet (a small texture over the whole map, baked once
 * from the zones, read by the terrain shader).
 *
 * Everything is the client's own: only the environment description, a match seed and the server
 * clock come from the server, so all players see the same weather. Particles live in boxes that
 * travel with the camera and are moved in the vertex shader (no per-particle CPU work).
 */

export type EnvEffectsQuality = 'low' | 'medium' | 'high' | 'ultra';
const RAIN_COUNT: Record<EnvEffectsQuality, number> = { low: 2500, medium: 6000, high: 11000, ultra: 18000 };
const AIR_COUNT: Record<EnvEffectsQuality, number> = { low: 600, medium: 1400, high: 2600, ultra: 4000 };
const SPLASH_COUNT: Record<EnvEffectsQuality, number> = { low: 0, medium: 160, high: 320, ultra: 520 };

/** Shared by the terrain shader: the baked climate map and the weather's wetness. */
export const environmentUniforms = {
  uEnvMap: { value: blankMap() },
  uEnvSize: { value: 1 },
  uEnvOn: { value: 0 },
  /** Wetness the weather brings everywhere (rain), 0…1. */
  uEnvWet: { value: 0 },
  uEnvTime: { value: 0 },
};

function blankMap(): DataTexture {
  const t = new DataTexture(new Uint8Array([128, 128, 128, 0]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

const MAP_RES = 256;

/**
 * Bakes the climate the ground shows (tint as a multiplier around 1, wetness) into a texture over
 * the whole map. Bilinear filtering and the zones' own blend distances keep the edges soft.
 */
export function bakeEnvironmentMap(env: MapEnvironment, worldSize: number): DataTexture {
  const data = new Uint8Array(MAP_RES * MAP_RES * 4), sample = emptySample(), ordered = zonesInOrder(env);
  for (let j = 0; j < MAP_RES; j++) for (let i = 0; i < MAP_RES; i++) {
    const s = sampleEnvironment(env, (i + .5) / MAP_RES * worldSize, (j + .5) / MAP_RES * worldSize, sample, ordered);
    const o = (j * MAP_RES + i) * 4;
    for (let c = 0; c < 3; c++) data[o + c] = Math.round(Math.max(0, Math.min(2, 1 + (s.tint[c]! * 2 - 1) * s.tintStrength)) * 127.5);
    data[o + 3] = Math.round(s.wetness * 255);
  }
  const t = new DataTexture(data, MAP_RES, MAP_RES, RGBAFormat, UnsignedByteType);
  t.magFilter = LinearFilter; t.minFilter = LinearFilter; t.needsUpdate = true;
  return t;
}

/**
 * The terrain material reads the climate map: tinted ground, darker and glossy where wet, and
 * on wet flat ground, puddles (in patches, glassy). Chained after the material's other changes.
 */
export function applyEnvironmentToGround(material: MeshStandardMaterial): void {
  const compile = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    Object.assign(shader.uniforms, environmentUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uEnvMap; uniform float uEnvSize; uniform float uEnvOn; uniform float uEnvWet;
        float envWet = 0.0; float envPuddle = 0.0;
        float envNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.55), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.55);
          float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.55), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.55);
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uEnvOn > 0.5) {
          vec4 env = texture2D(uEnvMap, vNaturalPosition.xz / uEnvSize);
          diffuseColor.rgb *= env.rgb * 2.0;
          envWet = max(env.a, uEnvWet);
          // Water gathers on flat ground in patches; slopes only darken.
          float envFlat = smoothstep(0.93, 0.99, normalize(vGroundNormal).y);
          float patches = envNoise(vNaturalPosition.xz * 0.09) * 0.65 + envNoise(vNaturalPosition.xz * 0.37) * 0.35;
          envPuddle = envFlat * smoothstep(0.62, 0.7, patches + envWet * 0.35 - 0.3) * smoothstep(0.45, 0.85, envWet);
          diffuseColor.rgb *= mix(1.0, 0.58, envWet * 0.85) * mix(1.0, 0.7, envPuddle);
        }`)
      .replace('#include <lights_fragment_begin>', `
        if (envWet > 0.0) {
          // A film of water: a clear specular layer over the matte soil.
          material.roughness = mix(material.roughness, mix(0.32, 0.05, envPuddle), envWet * 0.9);
          material.specularColor = mix(material.specularColor, vec3(0.04), envWet);
          material.specularF90 = mix(material.specularF90, 1.0, envWet);
        }
        #include <lights_fragment_begin>`);
  };
  material.customProgramCacheKey = () => `${key()}|environment-1`;
}

/* ----------------------------------------------------------------------------- particles */

const particleVertex = /* glsl */ `
  attribute vec4 seed;
  uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uVel; uniform float uTime; uniform float uSize;
  uniform float uDensity; uniform float uSwirl; uniform float uFloor;
  varying float vFade; varying float vSeed;
  void main() {
    vSeed = seed.w;
    // Over the density: off screen (no draw-range change, no CPU work).
    if (seed.w > uDensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    vec3 origin = uCam - uBox * 0.5;
    vec3 p = seed.xyz * uBox + uVel * uTime * (0.75 + 0.5 * seed.w);
    p += uSwirl * vec3(sin(uTime * 0.7 + seed.w * 40.0), sin(uTime * 0.5 + seed.x * 30.0) * 0.5, cos(uTime * 0.6 + seed.z * 35.0));
    p = mod(p - origin, uBox) + origin;
    p.y = max(p.y, uCam.y + uFloor);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = -mv.z;
    gl_PointSize = uSize * projectionMatrix[1][1] * 300.0 / max(0.5, d);
    // Fade towards the box's sides (no popping as particles wrap round).
    vec3 q = abs(p - uCam) / (uBox * 0.5);
    vFade = 1.0 - smoothstep(0.7, 1.0, max(q.x, max(q.y, q.z)));
  }
`;

/**
 * Rain: every drop a thin quad stretched along its motion as the eye sees it (its fall plus the
 * wind, minus the camera's own movement), as long as the distance it covers in a ~1/22 s glimpse:
 * long streaks in a downpour, short ones in a drizzle, slanting in the wind and when running.
 * World-anchored in a box round the camera (moving through the rain does not drag it along).
 * Under a roof a dry bubble round the camera keeps it out of the room while it still falls past
 * the windows and the doorway.
 */
const rainVertex = /* glsl */ `
  attribute vec4 seed;
  uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uVel; uniform vec3 uCamVel;
  uniform float uTime; uniform float uDensity; uniform float uWidth; uniform float uStreak; uniform float uShelter;
  varying float vFade; varying float vAlong; varying float vAcross;
  void main() {
    if (seed.w > uDensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    // Bigger drops fall faster (a spread of speeds, independent of the density rank).
    vec3 vel = uVel * (0.82 + 0.36 * fract(seed.x * 13.7 + seed.z * 7.1));
    vec3 origin = uCam - uBox * 0.5;
    vec3 p = mod(seed.xyz * uBox + vel * uTime - origin, uBox) + origin;
    vec3 rel = vel - uCamVel;
    float speed = max(length(rel), 0.001);
    vec3 dir = rel / speed;
    vec3 at = p - dir * clamp(speed * uStreak, 0.12, 2.8) * (1.0 - position.y);
    vec3 toCam = uCam - at;
    float dist = length(toCam);
    vec3 side = cross(dir, toCam / max(dist, 0.001));
    side /= max(length(side), 0.001);
    // Never thinner than about a pixel, or far drops shimmer away.
    at += side * position.x * max(uWidth, dist * 0.0011);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
    vec3 q = abs(p - uCam) / (uBox * 0.5);
    vFade = 1.0 - smoothstep(0.7, 1.0, max(q.x, max(q.y, q.z)));
    vFade *= mix(1.0, smoothstep(9.0, 13.0, length((p - uCam).xz)), uShelter);
    vAlong = position.y; vAcross = position.x * 2.0;
  }
`;
const rainFragment = /* glsl */ `
  uniform vec3 uColor; uniform float uOpacity;
  varying float vFade; varying float vAlong; varying float vAcross;
  void main() {
    // Brightest at the drop, fading up the streak; soft across.
    float a = uOpacity * vFade * (0.2 + 0.8 * vAlong) * (1.0 - smoothstep(0.35, 1.0, abs(vAcross)));
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

function rainGeometry(count: number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry(), s = new Float32Array(count * 4);
  g.setAttribute('position', new Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, -.5, 1, 0, .5, 1, 0], 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  for (let i = 0; i < count * 4; i++) s[i] = Math.random();
  // Sorted ranks: a density keeps the first share of the drops.
  for (let i = 0; i < count; i++) s[i * 4 + 3] = (i + Math.random()) / count;
  g.setAttribute('seed', new InstancedBufferAttribute(s, 4));
  g.instanceCount = count;
  return g;
}

function rainMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uCam: { value: new Vector3() }, uBox: { value: new Vector3(40, 26, 40) }, uVel: { value: new Vector3() }, uCamVel: { value: new Vector3() }, uTime: { value: 0 },
      uDensity: { value: 0 }, uWidth: { value: .012 }, uStreak: { value: .045 }, uShelter: { value: 0 }, uColor: { value: new Color() }, uOpacity: { value: .3 },
    },
    vertexShader: rainVertex, fragmentShader: rainFragment, transparent: true, depthWrite: false, blending: NormalBlending, fog: false,
  });
}

const airFragment = /* glsl */ `
  uniform vec3 uColor; uniform float uOpacity; uniform float uSoft;
  varying float vFade; varying float vSeed;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(1.0 - uSoft, 1.0, r)) * uOpacity * vFade * (0.6 + 0.4 * vSeed);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

const splashVertex = /* glsl */ `
  attribute vec4 seed;
  uniform float uTime; uniform float uSize; uniform float uDensity;
  varying float vPhase;
  void main() {
    if (seed.w > uDensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    vPhase = fract(uTime * 2.3 + seed.w * 17.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * projectionMatrix[1][1] * 300.0 / max(0.5, -mv.z);
  }
`;
const splashFragment = /* glsl */ `
  uniform vec3 uColor; uniform float uOpacity;
  varying float vPhase;
  void main() {
    vec2 c = (gl_PointCoord - 0.5) * vec2(1.0, 3.0);
    float r = length(c) * 2.0;
    // A ring spreading and fading, low over the ground.
    float ring = smoothstep(0.12, 0.0, abs(r - vPhase)) * (1.0 - vPhase);
    float a = ring * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

function seeds(count: number): BufferGeometry {
  const g = new BufferGeometry(), s = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) s[i] = Math.random();
  // Sorted ranks: a density keeps the first share of the particles.
  for (let i = 0; i < count; i++) s[i * 4 + 3] = (i + Math.random()) / count;
  g.setAttribute('seed', new Float32BufferAttribute(s, 4));
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3));
  return g;
}

function particleMaterial(fragment: string, additive = false): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uCam: { value: new Vector3() }, uBox: { value: new Vector3(40, 24, 40) }, uVel: { value: new Vector3() }, uTime: { value: 0 }, uSize: { value: .1 },
      uDensity: { value: 0 }, uSwirl: { value: 0 }, uFloor: { value: -12 }, uColor: { value: new Color() }, uOpacity: { value: .5 }, uSoft: { value: .8 },
    },
    vertexShader: particleVertex, fragmentShader: fragment, transparent: true, depthWrite: false, blending: additive ? AdditiveBlending : NormalBlending, fog: false,
  });
}

/** How each kind of airborne particle looks and moves. */
const AIR_LOOK: Record<Exclude<EnvParticles, 'none'>, { color: string; size: number; opacity: number; soft: number; fall: number; swirl: number; box: [number, number, number]; floor: number }> = {
  dust: { color: '#c8b590', size: .05, opacity: .4, soft: .9, fall: -.05, swirl: .8, box: [36, 14, 36], floor: -2 },
  sand: { color: '#cdb382', size: .035, opacity: .55, soft: .6, fall: .4, swirl: .4, box: [30, 8, 30], floor: -1.8 },
  ash: { color: '#6e6a66', size: .045, opacity: .6, soft: .5, fall: .35, swirl: 1.2, box: [32, 18, 32], floor: -2 },
  mist: { color: '#d7dde0', size: 2.6, opacity: .05, soft: 1, fall: 0, swirl: .5, box: [70, 5, 70], floor: -1.6 },
  pollen: { color: '#f2ead0', size: .025, opacity: .7, soft: .5, fall: -.02, swirl: 1.5, box: [26, 12, 26], floor: -1.5 },
};

/* ------------------------------------------------------------------------------- system */

export interface EnvironmentFrame {
  weather: WeatherParams;
  local: EnvSample;
  /** Lightning now (0…1). */
  flash: number;
  /** Wind (m/s) where the camera is. */
  windX: number; windZ: number;
}

export class EnvironmentSystem {
  private readonly rain: Mesh;
  private readonly air: Points;
  private readonly splashes: Points;
  private readonly rainMat = rainMaterial();
  /** The camera's own velocity (smoothed): rain streaks slant as the eye moves through them. */
  private readonly camVel = new Vector3();
  private readonly lastCam = new Vector3();
  private hasLastCam = false;
  private readonly airMat = particleMaterial(airFragment);
  private readonly splashMat: ShaderMaterial;
  private readonly sample = emptySample();
  private ordered;
  private sheltered = 0;
  private roofed = 0;
  private shelterCheck = 0;
  private splashNext = 0;
  private airKind: Exclude<EnvParticles, 'none'> = 'dust';
  private airAmount = 0;
  private readonly fogColor = new Color();
  private started = false;
  /** The weather being eased away from (a preset changed in the Studio) and how far (0…1). */
  private from: WeatherParams | null = null;
  private blend = 1;
  /** What the camera sees now (read by the engine: grade, exposure, sounds). */
  frame: EnvironmentFrame | null = null;

  constructor(private readonly scene: Scene, private env: MapEnvironment, private readonly worldSize: number, private readonly seed: number, readonly quality: EnvEffectsQuality) {
    this.ordered = zonesInOrder(env);
    this.rain = new Mesh(rainGeometry(RAIN_COUNT[quality]), this.rainMat);
    this.air = new Points(seeds(AIR_COUNT[quality]), this.airMat);
    this.splashMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSize: { value: .35 }, uDensity: { value: 0 }, uColor: { value: new Color(0xcfd8de) }, uOpacity: { value: .55 } },
      vertexShader: splashVertex, fragmentShader: splashFragment, transparent: true, depthWrite: false, fog: false,
    });
    this.splashes = new Points(seeds(Math.max(1, SPLASH_COUNT[quality])), this.splashMat);
    for (const p of [this.rain, this.air, this.splashes]) { p.frustumCulled = false; p.renderOrder = 5; scene.add(p); }
    this.bake();
  }

  /** A new or edited environment (the Studio's live preview). */
  setEnvironment(env: MapEnvironment): void {
    // Another kind of weather: eased over a few seconds from what is on screen now.
    if (this.frame && env.weather !== this.env.weather) { this.from = this.frame.weather; this.blend = 0; }
    this.env = env; this.ordered = zonesInOrder(env);
    this.bake();
  }

  private bake(): void {
    environmentUniforms.uEnvMap.value.dispose();
    environmentUniforms.uEnvMap.value = bakeEnvironmentMap(this.env, this.worldSize);
    environmentUniforms.uEnvSize.value = this.worldSize;
    environmentUniforms.uEnvOn.value = 1;
  }

  /** The fixed time of day the map asks for (null: the mode's own clock). */
  get timeOfDay(): number | null { return this.env.timeOfDay; }
  get environment(): MapEnvironment { return this.env; }

  /**
   * One frame. `time`: server seconds (the same weather for everyone); `roof` tells whether
   * something is overhead (indoors: no rain); `ground` the height under a point (splashes).
   */
  update(dt: number, camera: Vector3, time: number, sky: SkySystem, roof: (x: number, y: number, z: number) => boolean, ground: (x: number, z: number) => number): EnvironmentFrame {
    const env = this.env, w: WeatherParams = resolveWeather(env, this.seed, time), s = sampleEnvironment(env, camera.x, camera.z, this.sample, this.ordered);
    if (this.from && this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 4);
      const k = this.blend * this.blend * (3 - 2 * this.blend), a = this.from;
      for (const key of ['cloud', 'fog', 'sun', 'ambient', 'rain', 'lightning', 'dust', 'wind', 'wet', 'warmth', 'saturation'] as const) w[key] = a[key] + (w[key] - a[key]) * k;
      if (k < .5) w.fogColor = a.fogColor;
    }
    const flash = lightningFlash(this.seed, time, w.lightning);
    const dir = env.wind.dir, windX = Math.sin(dir) * w.wind + s.windX, windZ = Math.cos(dir) * w.wind + s.windZ;
    // Indoors (a roof overhead): no rain, less dust; checked a few times a second.
    if ((this.shelterCheck -= dt) <= 0) { this.shelterCheck = .3; this.roofed = roof(camera.x, camera.y + 1.6, camera.z) ? 1 : 0; }
    // Eased over a few tenths of a second: stepping through a doorway does not snap the rain.
    this.sheltered += (this.roofed - this.sheltered) * Math.min(1, dt * 6);
    if (this.hasLastCam && dt > 0) {
      const v = this.lastCam.sub(camera).multiplyScalar(-1 / dt);
      // A teleport or respawn is not movement.
      if (v.length() > 60) v.set(0, 0, 0);
      this.camVel.lerp(v, Math.min(1, dt * 8));
    }
    this.lastCam.copy(camera); this.hasLastCam = true;

    // The sky: weather, local haze over it, the map's grade on the light.
    const fogMix = s.fogColorWeight > 0 ? s.fogColorWeight : w.fogColor ? 1 : 0;
    if (s.fogColorWeight > 0) this.fogColor.setRGB(...s.fogColor, 'srgb');
    else if (w.fogColor) this.fogColor.setRGB(...hexRgb(w.fogColor), 'srgb');
    if (env.fog.color) this.fogColor.lerp(new Color(env.fog.color), .5);
    const haze = (w.fog + s.fog + s.dust * .4 + s.humidity * .15) * env.fog.density;
    sky.weather = {
      cloud: w.cloud, sun: w.sun * env.sun.intensity, ambient: w.ambient, fog: haze, fogColor: this.fogColor, fogMix,
      warmth: Math.max(-1, Math.min(1, w.warmth + env.grading.warmth * .6 + (s.temperature - 22) / 60)), flash, azimuth: env.sun.azimuth,
    };

    // Rain: drizzle to downpour. Heavier rain falls faster (bigger drops), in longer, thicker,
    // denser streaks, and the wind carries it almost fully sideways. The fall speeds are what a
    // camera's motion blur shows (drops at 6–9 m/s read as slow without it), not the bare
    // terminal velocity.
    const rain = w.rain, r = this.rainMat.uniforms;
    r.uCam!.value.copy(camera); r.uTime!.value = time % 600;
    r.uCamVel!.value.copy(this.camVel);
    r.uVel!.value.set(windX * .9, -(13 + 11 * rain), windZ * .9);
    r.uDensity!.value = rain * (1 - .5 * this.sheltered);
    r.uShelter!.value = this.sheltered;
    r.uWidth!.value = .008 + .012 * rain;
    r.uStreak!.value = .03 + .025 * rain;
    r.uOpacity!.value = .2 + .22 * rain;
    (r.uColor!.value as Color).setRGB(.62, .67, .72).multiplyScalar(.5 + .5 * sky.lightLevel).lerp(new Color(1, 1, 1), flash * .6);
    this.rain.visible = rain > .005;

    // Splashes on the ground round the camera: a few re-placed each frame.
    const sp = this.splashes.geometry.getAttribute('position') as Float32BufferAttribute, count = SPLASH_COUNT[this.quality];
    if (count && rain > .05 && this.sheltered < .5) {
      for (let k = 0; k < Math.ceil(count / 30); k++) {
        const i = this.splashNext = (this.splashNext + 1) % count;
        const a = Math.random() * Math.PI * 2, d = 1.5 + Math.sqrt(Math.random()) * 16;
        const x = camera.x + Math.cos(a) * d, z = camera.z + Math.sin(a) * d, y = ground(x, z);
        sp.setXYZ(i, x, Number.isFinite(y) ? y + .03 : -1e4, z);
      }
      sp.needsUpdate = true;
    }
    const su = this.splashMat.uniforms;
    su.uTime!.value = time % 1000; su.uDensity!.value = rain * (1 - this.sheltered); this.splashes.visible = rain > .05 && count > 0 && this.sheltered < .95;

    // Airborne particles: the kind that dominates here, as much as the place and weather hold.
    let kind: Exclude<EnvParticles, 'none'> = 'dust', amount = 0;
    for (const k of ENV_PARTICLES) if (k !== 'none' && s.particles[k] > amount) { amount = s.particles[k]; kind = k; }
    if (w.dust > amount) { amount = w.dust; kind = w.dust > .5 ? 'sand' : 'dust'; }
    amount = Math.max(amount, s.dust * .6) * (1 - .7 * this.sheltered) * (1 - .6 * w.rain);
    // A change of kind fades out first, then in.
    if (kind !== this.airKind) { this.airAmount = Math.max(0, this.airAmount - dt * 1.5); if (this.airAmount <= 0) this.airKind = kind; }
    else this.airAmount += (amount - this.airAmount) * Math.min(1, dt * 1.5);
    const look = AIR_LOOK[this.airKind], u = this.airMat.uniforms;
    u.uCam!.value.copy(camera); u.uTime!.value = time % 1000;
    u.uBox!.value.set(...look.box); u.uFloor!.value = look.floor;
    u.uVel!.value.set(windX * (this.airKind === 'mist' ? .15 : .8), -look.fall, windZ * (this.airKind === 'mist' ? .15 : .8));
    u.uSwirl!.value = look.swirl; u.uSize!.value = look.size; u.uSoft!.value = look.soft;
    u.uDensity!.value = this.airAmount;
    u.uOpacity!.value = look.opacity * (.45 + .55 * sky.lightLevel);
    // Lit by the sun (motes glint in sunlight, grey under cloud).
    (u.uColor!.value as Color).set(look.color).multiply(new Color().copy(sky.sunColor).lerp(new Color(1, 1, 1), .6)).multiplyScalar(.5 + .5 * w.sun * sky.lightLevel);
    this.air.visible = this.airAmount > .01;

    // The ground wets (and dries) over a minute or so; as it is at the start.
    const wet = Math.max(w.wet, w.rain);
    environmentUniforms.uEnvWet.value = this.started ? environmentUniforms.uEnvWet.value + (wet - environmentUniforms.uEnvWet.value) * Math.min(1, dt * .05) : wet;
    this.started = true;
    environmentUniforms.uEnvTime.value = time % 1000;
    this.frame = { weather: w, local: s, flash, windX, windZ };
    return this.frame;
  }

  dispose(): void {
    for (const p of [this.rain, this.air, this.splashes]) { this.scene.remove(p); p.geometry.dispose(); }
    this.rainMat.dispose(); this.airMat.dispose(); this.splashMat.dispose();
    environmentUniforms.uEnvOn.value = 0; environmentUniforms.uEnvWet.value = 0;
  }
}
