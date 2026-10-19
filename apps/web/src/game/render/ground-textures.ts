import {
  DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping,
  type MeshStandardMaterial, type WebGLRenderer,
} from 'three';
import { Surface } from '@zion/shared';
import type { GroundDetail } from '@/lib/settings';

/**
 * Photographed ground materials (CC0, Poly Haven; see public/textures/ground/README.md) layered on
 * the terrain. The palette colour of every vertex stays the base: a layer only adds its detail
 * (albedo divided by its mean colour), normal, roughness and height, so biomes keep their tint and
 * the game its look. Each vertex carries a weight per layer; the shader blends the two strongest
 * by height (gravel shows between the dirt, mud settles in the hollows), breaks tiling with a
 * second rotated sample, switches steep slopes to a side projection and fades the detail out far
 * away (no shimmer, no cost).
 */
export const GROUND_LAYERS = ['forest', 'meadow', 'mud', 'sand', 'cracked', 'gravel', 'rock', 'asphalt', 'concrete', 'dirt', 'snow', 'dry'] as const;
export type GroundLayer = (typeof GROUND_LAYERS)[number];
const L = Object.fromEntries(GROUND_LAYERS.map((n, i) => [n, i])) as Record<GroundLayer, number>;
export const GROUND_LAYER_COUNT = GROUND_LAYERS.length;
/** Metres one texture tile covers on the ground. */
const TILE: Record<GroundLayer, number> = { forest: 3.2, meadow: 3.4, mud: 3, sand: 3.6, cracked: 4, gravel: 2.8, rock: 4.5, asphalt: 3.6, concrete: 4, dirt: 3, snow: 4, dry: 3.4 };

const SIZE: Record<Exclude<GroundDetail, 'off'>, number> = { low: 256, medium: 512, high: 1024 };

/** Layer weights of a surface (sum 1), before the slope turns steep ground to rock. */
export function surfaceLayers(surface: Surface, temperature: number, humidity: number, out: Float32Array): void {
  out.fill(0);
  const add = (layer: GroundLayer, w: number) => { out[L[layer]]! += w; };
  switch (surface) {
    case Surface.Grass: add('meadow', 1); break;
    case Surface.DryGrass: add('dry', .8); add('cracked', .2); break;
    case Surface.ForestFloor: add('forest', .8); add('dirt', .2); break;
    case Surface.JungleFloor: add('forest', .55); add('mud', .45); break;
    case Surface.Sand: add('sand', 1); break;
    case Surface.Sandstone: add('cracked', .65); add('rock', .35); break;
    case Surface.Dirt: if (temperature > .62 && humidity < .35) add('cracked', 1); else { add('dirt', .75); add('gravel', .25); } break;
    case Surface.Mud: add('mud', 1); break;
    case Surface.Gravel: add('gravel', 1); break;
    case Surface.Rock: add('rock', 1); break;
    case Surface.Snow: add('snow', 1); break;
    case Surface.Seabed: add('sand', .7); add('mud', .3); break;
    case Surface.DirtRoad: add('gravel', .55); add('dirt', .45); break;
    case Surface.WheelTrack: add('dirt', .6); add('meadow', .4); break;
    case Surface.RoadVerge: add('meadow', .7); add('gravel', .3); break;
    case Surface.Asphalt: add('asphalt', 1); break;
    case Surface.MossyAsphalt: add('asphalt', .7); add('meadow', .3); break;
    case Surface.BrokenAsphalt: add('concrete', .6); add('gravel', .4); break;
    case Surface.GravelRoad: add('gravel', 1); break;
    default: add('dirt', 1);
  }
  // Damp ground: moss and mud creep into forest floors and verges.
  if (humidity > .7 && (surface === Surface.ForestFloor || surface === Surface.Grass || surface === Surface.RoadVerge)) add('mud', (humidity - .7) * 1.2);
}

/** Steep natural ground shows its rock (roads and paving keep their own surface). */
export function slopeToRock(surface: Surface, upness: number, w: Float32Array): void {
  if (surface >= Surface.DirtRoad || surface === Surface.Snow || surface === Surface.Seabed) return;
  const rock = Math.max(0, Math.min(1, (0.86 - upness) / 0.2));
  if (rock <= 0) return;
  for (let k = 0; k < w.length; k++) w[k]! *= 1 - rock;
  w[L.rock]! += rock;
}

const VERTEX_DECL = `
attribute vec4 groundA; attribute vec4 groundB; attribute vec4 groundC;
varying vec4 vGroundA; varying vec4 vGroundB; varying vec4 vGroundC; varying vec3 vGroundNormal;`;
const FRAGMENT_DECL = `
uniform highp sampler2DArray groundAlbedo; uniform highp sampler2DArray groundNormal; uniform highp sampler2DArray groundHeight;
uniform float groundOn; uniform float groundStrength; uniform float groundFar; uniform float groundTile[${GROUND_LAYER_COUNT}];
varying vec4 vGroundA; varying vec4 vGroundB; varying vec4 vGroundC; varying vec3 vGroundNormal;
vec2 groundTwist(vec2 uv) { return mat2(0.8253, -0.5646, 0.5646, 0.8253) * uv * 0.53 + vec2(0.37, 0.71); }`;

const COLOR = `
  vec3 groundBump = vec3(0.0); float groundFade = 0.0;
  if (groundOn > 0.5) {
    groundFade = 1.0 - smoothstep(groundFar * 0.55, groundFar, length(vViewPosition));
    if (groundFade > 0.0) {
      float gw[${GROUND_LAYER_COUNT}];
      gw[0] = vGroundA.x; gw[1] = vGroundA.y; gw[2] = vGroundA.z; gw[3] = vGroundA.w;
      gw[4] = vGroundB.x; gw[5] = vGroundB.y; gw[6] = vGroundB.z; gw[7] = vGroundB.w;
      gw[8] = vGroundC.x; gw[9] = vGroundC.y; gw[10] = vGroundC.z; gw[11] = vGroundC.w;
      int i0 = 0, i1 = 0; float w0 = -1.0, w1 = -1.0;
      for (int k = 0; k < ${GROUND_LAYER_COUNT}; k++) {
        float w = gw[k];
        if (w > w0) { i1 = i0; w1 = w0; i0 = k; w0 = w; } else if (w > w1) { i1 = k; w1 = w; }
      }
      w1 = max(w1, 0.0);
      vec3 gp = vNaturalPosition; vec3 gn = normalize(vGroundNormal);
      // Steep ground: project from the side instead of stretching the top view down the slope.
      float side = 1.0 - smoothstep(0.55, 0.8, gn.y);
      vec2 sideP = abs(gn.x) > abs(gn.z) ? gp.zy : gp.xy;
      vec2 uv0 = mix(gp.xz, sideP, step(0.5, side)) / groundTile[i0];
      vec2 uv1 = mix(gp.xz, sideP, step(0.5, side)) / groundTile[i1];
      // Height blend: the bumpier layer wins where the two meet.
      float h0 = texture(groundHeight, vec3(uv0, float(i0))).r, h1 = texture(groundHeight, vec3(uv1, float(i1))).r;
      float b0 = w0 + h0 * 0.45, b1 = w1 + h1 * 0.45, top = max(b0, b1) - 0.18;
      b0 = max(b0 - top, 0.0); b1 = w1 > 0.001 ? max(b1 - top, 0.0) : 0.0;
      float bs = b0 + b1; b0 /= bs; b1 /= bs;
      // Tiling breaker: a second, rotated and scaled sample, mixed in large patches.
      float twist = smoothstep(0.3, 0.7, naturalNoise(gp * 0.045 + 7.0));
      vec3 a0 = mix(texture(groundAlbedo, vec3(uv0, float(i0))).rgb, texture(groundAlbedo, vec3(groundTwist(uv0), float(i0))).rgb, twist);
      vec3 albedo = a0 * b0;
      vec3 n0 = texture(groundNormal, vec3(uv0, float(i0))).rgb, nrm = n0 * b0;
      if (b1 > 0.001) {
        albedo += mix(texture(groundAlbedo, vec3(uv1, float(i1))).rgb, texture(groundAlbedo, vec3(groundTwist(uv1), float(i1))).rgb, twist) * b1;
        nrm += texture(groundNormal, vec3(uv1, float(i1))).rgb * b1;
      }
      diffuseColor.rgb *= mix(vec3(1.0), albedo * 2.0, groundStrength * groundFade);
      vec2 t = (nrm.rg * 2.0 - 1.0) * groundFade * (1.0 - side);
      groundBump = vec3(t.x, 0.0, -t.y);
    }
  }`;

// Earth, rock and grass are matte: no highlights, no sheen (the layers' roughness is not used).
const MATTE = `
  material.specularColor = vec3(0.0);
  material.specularF90 = 0.0;
  material.roughness = 1.0;`;
const NORMAL = `
  if (groundOn > 0.5 && groundFade > 0.0) {
    vec3 gnw = normalize(normalize(vGroundNormal) + groundBump * 0.9);
    normal = normalize((viewMatrix * vec4(gnw, 0.0)).xyz);
  }`;

function emptyArray(): DataArrayTexture {
  const t = new DataArrayTexture(new Uint8Array(4 * GROUND_LAYER_COUNT).fill(128), 1, 1, GROUND_LAYER_COUNT);
  t.needsUpdate = true;
  return t;
}

async function loadLayers(base: string, suffix: string, size: number): Promise<Uint8Array<ArrayBuffer>> {
  const data = new Uint8Array(size * size * 4 * GROUND_LAYER_COUNT);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const images = await Promise.all(GROUND_LAYERS.map(async (name) => {
    const res = await fetch(`${base}/${name}-${suffix}`);
    if (!res.ok) throw new Error(`ground texture ${name}-${suffix}: ${res.status}`);
    return createImageBitmap(await res.blob());
  }));
  images.forEach((img, k) => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    data.set(ctx.getImageData(0, 0, size, size).data, k * size * size * 4);
    img.close();
  });
  return data;
}

function arrayTexture(data: Uint8Array<ArrayBuffer>, size: number, anisotropy: number): DataArrayTexture {
  const t = new DataArrayTexture(data, size, size, GROUND_LAYER_COUNT);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Owns the layer textures of the terrain material and swaps them with the quality setting. */
export class GroundTextures {
  private readonly uniforms = {
    groundAlbedo: { value: emptyArray() }, groundNormal: { value: emptyArray() }, groundHeight: { value: emptyArray() },
    groundOn: { value: 0 }, groundStrength: { value: .85 }, groundFar: { value: 150 },
    groundTile: { value: GROUND_LAYERS.map((n) => TILE[n]) },
  };
  private detail: GroundDetail = 'off';
  private loading = 0;

  constructor(material: MeshStandardMaterial) {
    const compile = material.onBeforeCompile.bind(material);
    const key = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      compile(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${VERTEX_DECL}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          vGroundA = groundA; vGroundB = groundB; vGroundC = groundC;
          vGroundNormal = normalize(mat3(modelMatrix) * objectNormal);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${FRAGMENT_DECL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>${COLOR}`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>${MATTE}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${NORMAL}`);
    };
    material.customProgramCacheKey = () => `${key()}|ground-layers-2`;
  }

  /** Loads the layers for a quality level (the plain ground shows until they arrive). */
  setDetail(detail: GroundDetail, renderer: WebGLRenderer): void {
    if (detail === this.detail) return;
    this.detail = detail;
    const ticket = ++this.loading;
    if (detail === 'off') { this.uniforms.groundOn.value = 0; return; }
    const size = SIZE[detail], dir = `/textures/ground/${size === 1024 ? 1024 : 512}`;
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    void Promise.all([loadLayers(dir, 'a.webp', size), loadLayers(dir, 'n.webp', size), loadLayers('/textures/ground/h', 'h.png', 256)])
      .then(([albedo, normal, height]) => {
        if (ticket !== this.loading) return;
        for (const u of [this.uniforms.groundAlbedo, this.uniforms.groundNormal, this.uniforms.groundHeight]) u.value.dispose();
        this.uniforms.groundAlbedo.value = arrayTexture(albedo, size, anisotropy);
        this.uniforms.groundNormal.value = arrayTexture(normal, size, anisotropy);
        this.uniforms.groundHeight.value = arrayTexture(height, 256, 1);
        this.uniforms.groundOn.value = 1;
      })
      .catch((err: unknown) => { console.warn('ground textures unavailable:', err); });
  }

  dispose(): void {
    for (const u of [this.uniforms.groundAlbedo, this.uniforms.groundNormal, this.uniforms.groundHeight]) u.value.dispose();
  }
}
