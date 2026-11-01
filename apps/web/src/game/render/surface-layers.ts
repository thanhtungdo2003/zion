import { MeshLambertMaterial, MeshPhongMaterial, MeshStandardMaterial, RepeatWrapping, type BufferGeometry, type Material, type Object3D, type Texture } from 'three';
import { Mesh } from 'three';
import { VEHICLES } from '@zion/shared';
import { environmentUniforms } from './environment';
import { ROCK_MOSS } from './natural-material';

/**
 * Layered surface variation for every model in the game and the Studio views: no surface is one
 * flat photograph wrapped over its shape. On top of each material's own colour, texture, UVs and
 * PBR values (all kept), the shader lays the wear the object would really carry, by rules of its
 * kind and from where each point sits on it:
 *
 * - buildings: grime and rising damp at the foot of the walls, rain streaks down the faces, moss
 *   on the base and the ledges in damp country, dust on the tops in dry country, chipped plaster
 *   and paint on the corners;
 * - trees: moss and lichen on the lower, damp side of the bark; leaves varying in hue, in sun and
 *   shade through the crown, with dry clusters (more in drought), each tree its own shade;
 * - grass and bushes: lighter tips, darker bases, dry patches across a field, each clump its own;
 * - rocks: dust in the hollows, lichen spots, each stone its own tone;
 * - vehicles: mud thrown up on the lower body, dust on the tops, scratches through the paint,
 *   rust where paint meets edges and water — tyres, glass and bare metal each kept as what they are;
 * - weapons: worn, polished edges on metal, uneven sheen, grips and stocks kept matte;
 * - other props: dust on top, grime at the foot.
 *
 * The amount follows the place and the weather (ROCK_MOSS: damp and green; LAYER_DUST: dry and
 * dusty; rain wetness darkens porous surfaces and makes the tops glossy) and each instance has its
 * own age and tint, so a row of the same model never looks copied. Repeating textures are broken
 * up by blending two offset samples (no visible tiles). Everything is shader maths on the
 * existing materials: no extra textures, no extra draw calls.
 */
export type LayerProfile = 'structure' | 'tree' | 'vegetation' | 'rock' | 'vehicle' | 'weapon' | 'prop';

/** Dryness and dust in the air where the player is (0 damp … 1 desert), set by the engine. */
export const LAYER_DUST = { value: 0 };

/** Material kinds within a model (each wears differently). */
const KIND = { paint: 0, metal: 1, rubber: 2, glass: 3, wood: 4, foliage: 5 } as const;

function kindOf(m: Material): number {
  const s = m as Material & { metalness?: number; color?: { r: number; g: number; b: number }; map?: Texture | null; transmission?: number };
  if ((m.transparent && m.opacity < .95) || (s.transmission ?? 0) > 0) return KIND.glass;
  if (m.alphaTest > 0) return KIND.foliage;
  if ((s.metalness ?? 0) > .5) return KIND.metal;
  const c = s.color;
  if (c && !s.map) {
    const luma = c.r * .2126 + c.g * .7152 + c.b * .0722;
    if (luma < .035) return KIND.rubber;
    if (c.r > c.g * 1.15 && c.g > c.b * 1.1 && luma < .35) return KIND.wood;
  }
  return KIND.paint;
}

/** A texture laid over and over (UVs spanning several repeats): worth breaking up. */
function tiles(geometry: BufferGeometry | undefined, map: Texture | null | undefined): boolean {
  if (!map || map.wrapS !== RepeatWrapping || !geometry) return false;
  const uv = geometry.getAttribute('uv');
  if (!uv) return false;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < uv.count; i += Math.max(1, Math.floor(uv.count / 512))) {
    const u = uv.getX(i), v = uv.getY(i);
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  return u1 - u0 > 1.5 || v1 - v0 > 1.5;
}

const COMMON = /* glsl */ `
uniform float uLvWet; uniform float uLvMoss; uniform float uLvDust; uniform float uLvKind; uniform float uLvHeight;
varying vec3 lvWorld; varying vec3 lvLocal; varying vec3 lvNormal; varying float lvSeed;
float lvHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float lvNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lvHash(i), lvHash(i + vec3(1,0,0)), f.x), mix(lvHash(i + vec3(0,1,0)), lvHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(lvHash(i + vec3(0,0,1)), lvHash(i + vec3(1,0,1)), f.x), mix(lvHash(i + vec3(0,1,1)), lvHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float lvFbm(vec3 p) { return lvNoise(p) * 0.55 + lvNoise(p * 2.03 + 7.1) * 0.3 + lvNoise(p * 4.1 + 3.7) * 0.15; }
float lvLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

const VERTEX = /* glsl */ `
  {
    vec4 lvP4 = vec4(transformed, 1.0); vec3 lvN3 = objectNormal; vec4 lvO = vec4(0.0, 0.0, 0.0, 1.0);
    #ifdef USE_INSTANCING
      lvP4 = instanceMatrix * lvP4; lvN3 = mat3(instanceMatrix) * lvN3; lvO = instanceMatrix * lvO;
    #endif
    lvWorld = (modelMatrix * lvP4).xyz;
    lvLocal = transformed;
    lvNormal = normalize(mat3(modelMatrix) * lvN3);
    vec3 lvOrigin = (modelMatrix * lvO).xyz;
    lvSeed = fract(sin(dot(floor(lvOrigin * 4.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }`;

/** Repeating textures: two samples at offsets picked by a smooth noise index, blended (no tiles). */
const ANTI_TILE = /* glsl */ `
#ifdef USE_MAP
  vec2 lvUv = vMapUv;
  float lvK = lvNoise(vec3(lvUv * 0.37, 0.5)) * 8.0, lvIa = floor(lvK), lvFa = fract(lvK);
  vec2 lvOffA = sin(vec2(3.0, 7.0) * lvIa), lvOffB = sin(vec2(3.0, 7.0) * (lvIa + 1.0));
  vec2 lvDx = dFdx(lvUv), lvDy = dFdy(lvUv);
  vec4 lvCa = textureGrad(map, lvUv + lvOffA, lvDx, lvDy), lvCb = textureGrad(map, lvUv + lvOffB, lvDx, lvDy);
  vec4 sampledDiffuseColor = mix(lvCa, lvCb, smoothstep(0.2, 0.8, lvFa - 0.1 * dot(lvCa.rgb - lvCb.rgb, vec3(1.0))));
  diffuseColor *= sampledDiffuseColor;
#endif`;

/** Per profile: what wears where. Reads lvP (noise space), lvN, lvUp, lvH, lvT, lvI, lvCurv, lvAge. */
const PROFILE: Record<LayerProfile, string> = {
  structure: /* glsl */ `
    // Grime and rising damp at the foot, rain streaks down the walls, crevices darker.
    float lvBase = 1.0 - smoothstep(0.0, 0.7 + 0.8 * lvNoise(lvP * vec3(0.9, 0.0, 0.9)), lvH);
    float lvWall = 1.0 - abs(lvUp);
    float lvStreak = smoothstep(0.58, 0.86, lvNoise(lvP * vec3(2.6, 0.22, 2.6))) * lvWall * (0.4 + 0.6 * lvAge);
    float lvCavity = 1.0 - smoothstep(0.04, 0.3, lvLuma(diffuseColor.rgb));
    float lvGrime = clamp(lvBase * 0.8 + lvStreak * 0.45 + lvCavity * 0.25, 0.0, 1.0) * (0.45 + 0.55 * lvFbm(lvP * 0.7)) * (0.55 + 0.45 * lvAge);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.6, 0.57, 0.5), lvGrime * 0.6);
    // Moss in damp country: on the base and the ledges, in patches.
    float lvMossy = uLvMoss * smoothstep(0.5, 0.78, lvFbm(lvP * 1.1) + lvBase * 0.3 + max(lvUp, 0.0) * 0.2 + lvCavity * 0.15) * clamp(lvBase * 0.9 + max(lvUp, 0.0) * 0.7, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.15, 0.22, 0.07), vec3(0.28, 0.34, 0.12), lvNoise(lvP * 7.0)), lvMossy * 0.85);
    // Dust on the tops in dry country.
    float lvDusty = uLvDust * smoothstep(0.35, 0.9, lvUp) * (0.45 + 0.55 * lvNoise(lvP * 1.9));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.63, 0.57, 0.47) * (0.85 + 0.3 * lvLuma(diffuseColor.rgb)), lvDusty * 0.55);
    // Chipped corners: the paint or plaster gone where edges get knocked.
    float lvChip = smoothstep(0.7, 0.78, lvNoise(lvP * 5.5)) * clamp(lvCurv * 1.4 + lvBase * 0.35, 0.0, 1.0) * lvAge;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lvLuma(diffuseColor.rgb)) * vec3(1.18, 1.12, 1.02) + 0.06, lvChip * 0.5);
    lvRough += lvGrime * 0.08 + lvDusty * 0.15 + lvMossy * 0.1;
    lvBump += lvMossy * lvNoise(lvP * 18.0) * 0.006 + lvChip * 0.003;
    lvPorous = 1.0;`,
  tree: /* glsl */ `
    float lvLeaf = max(step(4.5, uLvKind), smoothstep(0.02, 0.12, diffuseColor.g - diffuseColor.r));
    if (lvLeaf > 0.5) {
      // The crown: each tree its own shade, lighter on the sunny top and the outside, dry clusters.
      float lvCluster = lvNoise(lvP * 0.8 + lvI * 17.0);
      float lvDry = smoothstep(0.66, 0.86, lvCluster * 0.75 + (1.0 - lvT) * 0.15 + uLvDust * 0.35) * (0.5 + 0.5 * lvAge);
      diffuseColor.rgb *= vec3(1.0 + (lvI - 0.5) * 0.24, 1.0 + (lvI - 0.5) * 0.06, 1.0 - (lvI - 0.5) * 0.22);
      diffuseColor.rgb *= 0.8 + 0.28 * lvT * (0.55 + 0.45 * max(lvUp, 0.0)) + 0.12 * lvCluster;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.42, 0.18) * (0.6 + lvLuma(diffuseColor.rgb) * 1.6), lvDry * 0.6);
    } else {
      // Bark: moss and lichen low on the damp side, darker furrows.
      vec3 lvDamp = normalize(vec3(0.35, 0.0, -1.0));
      float lvSide = 0.5 + 0.5 * dot(normalize(vec3(lvN.x, 0.0, lvN.z) + 1e-4), lvDamp);
      float lvLow = 1.0 - smoothstep(0.05, 0.55, lvT);
      float lvMossy = clamp((uLvMoss * 0.85 + 0.12) * smoothstep(0.45, 0.72, lvFbm(lvP * vec3(3.0, 1.0, 3.0)) * 0.7 + lvSide * 0.35 + lvLow * 0.25) * (0.35 + 0.65 * lvLow), 0.0, 1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.16, 0.23, 0.07), vec3(0.3, 0.37, 0.13), lvNoise(lvP * 11.0)), lvMossy * 0.8);
      float lvLichen = smoothstep(0.72, 0.86, lvNoise(lvP * 4.5 + lvI * 9.0)) * (0.3 + 0.7 * uLvMoss) * (0.4 + 0.6 * lvLow);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.5 + vec3(0.3, 0.33, 0.26), lvLichen * 0.4);
      diffuseColor.rgb *= 0.86 + 0.24 * lvNoise(lvP * vec3(14.0, 1.4, 14.0));
      lvBump += lvMossy * lvNoise(lvP * 30.0) * 0.004;
      lvPorous = 1.0;
    }`,
  vegetation: /* glsl */ `
    // Each clump its own shade; lighter tips, darker bases; dry patches across the field.
    float lvField = lvNoise(lvWorld * 0.07) * 0.7 + lvNoise(lvWorld * 0.31) * 0.3;
    float lvDry = smoothstep(0.62, 0.85, lvField + uLvDust * 0.3 + (lvI - 0.5) * 0.2);
    diffuseColor.rgb *= vec3(1.0 + (lvI - 0.5) * 0.2, 1.0 + (lvI - 0.5) * 0.05, 1.0 - (lvI - 0.5) * 0.2);
    diffuseColor.rgb *= 0.74 + 0.36 * smoothstep(0.0, 1.0, lvT);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.48, 0.22) * (0.6 + lvLuma(diffuseColor.rgb) * 1.5), lvDry * 0.55);`,
  rock: /* glsl */ `
    // Each stone its own tone; dust settled in the hollows on top; lichen spots.
    diffuseColor.rgb *= 0.9 + 0.2 * lvI;
    float lvCavity = 1.0 - smoothstep(0.08, 0.35, lvLuma(diffuseColor.rgb));
    float lvDusty = (0.25 + 0.75 * uLvDust) * smoothstep(0.3, 0.8, lvUp) * (lvCavity * 0.6 + 0.4 * lvNoise(lvP * 2.2));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.55, 0.46), lvDusty * 0.45);
    float lvLichen = smoothstep(0.82, 0.86, lvNoise(lvP * 4.0 + lvI * 5.0)) * (0.25 + 0.75 * uLvMoss);
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.66, 0.68, 0.52), vec3(0.72, 0.58, 0.3), lvNoise(lvP * 1.3)), lvLichen * 0.5);
    lvPorous = 1.0;`,
  vehicle: /* glsl */ `
    float lvLow = 1.0 - smoothstep(0.0, 0.55 + 0.35 * lvNoise(lvP * vec3(1.5, 0.0, 1.5)), lvH);
    float lvMud = lvLow * smoothstep(0.35, 0.7, lvFbm(lvP * vec3(2.2, 7.0, 2.2))) * (0.35 + 0.65 * lvAge);
    float lvDusty = (0.25 + 0.5 * max(lvUp, 0.0) + 0.25 * lvLow) * (0.3 + 0.7 * uLvDust) * lvAge * (0.6 + 0.4 * lvNoise(lvP * 3.0));
    if (uLvKind > 2.5 && uLvKind < 3.5) {
      // Glass: a film of dust, nothing else.
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.58, 0.5), lvDusty * 0.25);
      lvRough += lvDusty * 0.2;
    } else {
      if (uLvKind < 0.5 || uLvKind > 0.5 && uLvKind < 1.5) {
        // Paint and bare metal: scratches through to the metal, rust at edges and low down.
        float lvLine = abs(fract(dot(lvP.xz, vec2(0.83, 0.55)) * 7.0 + lvNoise(lvP * 2.0) * 3.0) - 0.5);
        float lvScratch = smoothstep(0.03, 0.0, lvLine) * smoothstep(0.62, 0.8, lvNoise(lvP * 2.4 + lvI)) * lvAge;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.55, 0.53), lvScratch * 0.6);
        float lvRust = smoothstep(0.74, 0.9, lvFbm(lvP * 3.5) + lvLow * 0.2 + lvCurv * 0.35) * lvAge * (0.35 + 0.65 * max(uLvMoss, uLvWet));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.36, 0.16, 0.06), vec3(0.55, 0.28, 0.1), lvNoise(lvP * 9.0)), lvRust * 0.8);
        lvMetal *= 1.0 - lvRust; lvRough += lvRust * 0.45 - lvScratch * 0.2;
        lvBump += lvRust * lvNoise(lvP * 25.0) * 0.003;
        // An older car: the paint's colour faded.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lvLuma(diffuseColor.rgb)), lvAge * 0.18 * step(uLvKind, 0.5));
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.24, 0.17) * (0.8 + 0.4 * lvNoise(lvP * 6.0)), lvMud * 0.85);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.55, 0.46), lvDusty * 0.4);
      lvRough += lvMud * 0.35 + lvDusty * 0.2;
      lvPorous = 0.4;
    }`,
  weapon: /* glsl */ `
    // Metal: worn, polished edges and an uneven sheen; polymer and wood stay matte, with handling marks.
    float lvWear = clamp(lvCurv * 2.0, 0.0, 1.0) * smoothstep(0.35, 0.7, lvNoise(lvP * 1.5 + lvI * 3.0));
    if (uLvKind > 0.5 && uLvKind < 1.5) {
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.62, 0.6), lvWear * 0.5);
      lvRough += (lvNoise(lvP * 2.5) - 0.5) * 0.22 - lvWear * 0.25;
    } else if (uLvKind > 3.5 && uLvKind < 4.5) {
      diffuseColor.rgb *= 0.88 + 0.22 * lvNoise(lvP * vec3(0.4, 0.4, 6.0));
      lvRough += lvWear * -0.15;
    } else {
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + 0.03, lvWear * 0.3);
      lvRough += (lvNoise(lvP * 3.0) - 0.5) * 0.12 - lvWear * 0.12;
    }`,
  prop: /* glsl */ `
    float lvBase = 1.0 - smoothstep(0.0, 0.35 + 0.3 * lvNoise(lvP), lvH);
    float lvDusty = (0.3 + 0.7 * uLvDust) * smoothstep(0.4, 0.9, lvUp) * (0.4 + 0.6 * lvNoise(lvP * 2.5)) * lvAge;
    float lvGrime = lvBase * (0.5 + 0.5 * lvFbm(lvP)) * lvAge;
    diffuseColor.rgb *= 0.92 + 0.16 * lvI;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.58, 0.52), lvGrime * 0.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.57, 0.48), lvDusty * 0.4);
    float lvRust = uLvKind > 0.5 && uLvKind < 1.5 ? smoothstep(0.7, 0.85, lvFbm(lvP * 3.0) + lvBase * 0.3) * lvAge * (0.3 + 0.7 * uLvMoss) : 0.0;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.4, 0.19, 0.07), lvRust * 0.75);
    lvMetal *= 1.0 - lvRust; lvRough += lvDusty * 0.15 + lvGrime * 0.08 + lvRust * 0.4;
    lvPorous = 0.7;`,
};

// (A set, not userData: a cloned material copies userData but not the shader hook.)
const layered = new WeakSet<Material>();

/** The profile a game asset wears: by its category, vehicles by their asset ids. */
export function assetProfile(def: { numericId: number; category: string }): LayerProfile {
  if (VEHICLE_ASSETS.has(def.numericId)) return 'vehicle';
  switch (def.category) {
    case 'structure': case 'block': return 'structure';
    case 'tree': return 'tree';
    case 'vegetation': return 'vegetation';
    case 'rock': return 'rock';
    default: return 'prop';
  }
}
const VEHICLE_ASSETS: ReadonlySet<number> = new Set<number>(Object.values(VEHICLES).map((v) => v.asset));

/** Profiles whose models move (vehicles, weapons): their wear is laid in their own space. */
const LOCAL: ReadonlySet<LayerProfile> = new Set(['vehicle', 'weapon']);

/**
 * Lays the profile's surface layers onto a material (in place; chains earlier shader hooks).
 * `height` is the model's height (m), for where on it a point lies; `geometry` lets a repeating
 * texture be recognised.
 */
export function layerMaterial<T extends Material>(material: T, profile: LayerProfile, height = 2, geometry?: BufferGeometry): T {
  if (layered.has(material)) return material;
  const lit = material instanceof MeshStandardMaterial || material instanceof MeshLambertMaterial || material instanceof MeshPhongMaterial;
  if (!lit) return material;
  layered.add(material);
  const kind = kindOf(material), standard = material instanceof MeshStandardMaterial;
  const antiTile = tiles(geometry, (material as { map?: Texture | null }).map);
  const local = LOCAL.has(profile);
  const prevCompile = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  const uniforms = { uLvWet: environmentUniforms.uEnvWet, uLvMoss: ROCK_MOSS, uLvDust: LAYER_DUST, uLvKind: { value: kind }, uLvHeight: { value: Math.max(.3, height) } };
  material.onBeforeCompile = (shader, renderer) => {
    prevCompile(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 lvWorld; varying vec3 lvLocal; varying vec3 lvNormal; varying float lvSeed;`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX}`);
    let frag = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}`);
    if (antiTile) frag = frag.replace('#include <map_fragment>', ANTI_TILE);
    frag = frag.replace('#include <color_fragment>', `#include <color_fragment>
      float lvRough = 0.0, lvMetal = 1.0, lvBump = 0.0, lvPorous = 0.0;
      {
        vec3 lvN = normalize(lvNormal);
        float lvUp = lvN.y, lvH = lvLocal.y, lvT = clamp(lvLocal.y / uLvHeight, 0.0, 1.0), lvI = lvSeed;
        float lvAge = 0.35 + 0.65 * fract(lvSeed * 3.71);
        vec3 lvP = ${local ? 'lvLocal * 1.0 + lvSeed * 13.0' : 'lvWorld'};
        // Curvature (1 / radius, m): bends and corners of the surface.
        float lvCurv = clamp(length(fwidth(lvN)) / max(length(fwidth(lvWorld)), 1e-4) * 0.08, 0.0, 1.0);
        // Large tonal patches: no surface is one flat colour.
        diffuseColor.rgb *= 0.93 + 0.14 * lvFbm(lvP * 0.45);
        ${PROFILE[profile]}
        // Rain: porous surfaces darken, the tops turn glossy.
        float lvWetHere = uLvWet * lvPorous * (0.55 + 0.45 * max(lvUp, 0.0));
        diffuseColor.rgb *= 1.0 - 0.3 * lvWetHere;
        lvRough -= 0.4 * uLvWet * max(lvUp, 0.0) * lvPorous;
      }`);
    if (standard) {
      frag = frag
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + lvRough, 0.04, 1.0);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n  metalnessFactor *= lvMetal;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          if (lvBump != 0.0) {
            vec3 lvDpx = dFdx(-vViewPosition), lvDpy = dFdy(-vViewPosition);
            vec3 lvR1 = cross(lvDpy, normal), lvR2 = cross(normal, lvDpx);
            float lvDet = dot(lvDpx, lvR1);
            normal = normalize(abs(lvDet) * normal - sign(lvDet) * (dFdx(lvBump) * lvR1 + dFdy(lvBump) * lvR2));
          }`);
    }
    shader.fragmentShader = frag;
  };
  material.customProgramCacheKey = () => `${prevKey()}|layers-${profile}${antiTile ? '-tile' : ''}`;
  material.needsUpdate = true;
  return material;
}

/** Every lit mesh under `root` (a weapon, a vehicle built outside the asset library). */
export function layerObject(root: Object3D, profile: LayerProfile, height?: number): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) layerMaterial(m as Material, profile, height, o.geometry as BufferGeometry);
  });
}
