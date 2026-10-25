import { DataTexture, EquirectangularReflectionMapping, LinearFilter, MeshStandardMaterial, RGBAFormat, SRGBColorSpace, type Material, type MeshLambertMaterial } from 'three';

/**
 * Surface labels on Blockbench cubes: a cube named `stock#wood` or `trim#gold` is drawn with that
 * surface's light response (rough wood, bright gold, worn steel…) instead of the flat matte look.
 * Unlabelled cubes keep the model's plain material.
 */
export const SURFACES = {
  wood: { metalness: 0, roughness: .85 },
  gold: { metalness: 1, roughness: .22 },
  brass: { metalness: 1, roughness: .35 },
  copper: { metalness: 1, roughness: .35 },
  steel: { metalness: .85, roughness: .38 },
  iron: { metalness: .8, roughness: .55 },
  metal: { metalness: .85, roughness: .42 },
  aluminium: { metalness: .9, roughness: .3 },
  chrome: { metalness: 1, roughness: .08 },
  polymer: { metalness: 0, roughness: .6 },
  plastic: { metalness: 0, roughness: .5 },
  rubber: { metalness: 0, roughness: .95 },
  leather: { metalness: 0, roughness: .8 },
  fabric: { metalness: 0, roughness: 1 },
  glass: { metalness: 0, roughness: .04 },
} as const;
export type Surface = keyof typeof SURFACES;

const ALIASES: Record<string, Surface> = { aluminum: 'aluminium', gun: 'steel', golden: 'gold' };
const LABEL = new RegExp(`#(${[...Object.keys(SURFACES), ...Object.keys(ALIASES)].join('|')})\\b`, 'i');

/** The surface label in a cube name (`receiver:upper#steel` → steel), or null. */
export function surfaceOf(name: string | undefined): Surface | null {
  const m = name ? LABEL.exec(name) : null;
  if (!m) return null;
  const key = m[1]!.toLowerCase();
  return (ALIASES[key] ?? key) as Surface;
}

// What metals reflect: a soft sky above, a bright horizon band, a dark ground (no renderer needed,
// three prefilters it per renderer).
let environment: DataTexture | null = null;
function reflections(): DataTexture {
  if (environment) return environment;
  const w = 64, h = 32, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = y / (h - 1), o = (y * w + x) * 4;
    // v = 0 bottom (ground) … 1 top (sky).
    const sky = v > .5 ? 150 + 90 * Math.exp(-((v - .55) ** 2) / .004) + (v - .5) * 120 : 40 + v * 90;
    const lamp = Math.exp(-(((x / w) - .3) ** 2 + (v - .8) ** 2) / .004) * 255;
    data[o] = Math.min(255, sky * .95 + lamp); data[o + 1] = Math.min(255, sky * .98 + lamp); data[o + 2] = Math.min(255, sky + lamp); data[o + 3] = 255;
  }
  environment = new DataTexture(data, w, h, RGBAFormat);
  environment.mapping = EquirectangularReflectionMapping;
  environment.colorSpace = SRGBColorSpace;
  environment.magFilter = environment.minFilter = LinearFilter;
  environment.needsUpdate = true;
  return environment;
}

const cache = new WeakMap<Material, Map<Surface, MeshStandardMaterial>>();
/** The labelled version of a model's plain (Lambert) material: same texture, that surface's light. */
export function surfaceMaterial(base: MeshLambertMaterial, surface: Surface): MeshStandardMaterial {
  let bySurface = cache.get(base);
  if (!bySurface) cache.set(base, (bySurface = new Map()));
  let m = bySurface.get(surface);
  if (!m) {
    const s = SURFACES[surface];
    m = new MeshStandardMaterial({
      map: base.map, color: base.color, alphaTest: base.alphaTest, metalness: s.metalness, roughness: s.roughness,
      envMap: reflections(), envMapIntensity: s.metalness > .5 ? 1 : .35,
      ...(surface === 'glass' ? { transparent: true, opacity: .45, depthWrite: false } : {}),
    });
    m.name = `${base.name || 'model'}#${surface}`;
    bySurface.set(surface, m);
  }
  return m;
}
