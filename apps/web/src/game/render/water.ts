import { Color, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, type Mesh } from 'three';

const vertex = /* glsl */ `
  #include <fog_pars_vertex>
  attribute float depth;
  uniform float uDefaultDepth;
  uniform float uTime;
  varying vec3 vWorld;
  varying float vDepth;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y += sin(world.x * 0.35 + uTime * 1.3) * 0.04 + cos(world.z * 0.3 + uTime * 1.1) * 0.04 + sin((world.x + world.z) * 0.12 + uTime * 0.7) * 0.05;
    vWorld = world.xyz;
    #ifdef USE_DEPTH_ATTR
      vDepth = depth;
    #else
      vDepth = uDefaultDepth;
    #endif
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uLight;
  varying vec3 vWorld;
  varying float vDepth;

  // Smooth value noise and its gradient, for ripples that never look tiled.
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec3 noised(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    float v = a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
    vec2 g = du * vec2(b - a + (a - b - c + d) * u.y, c - a + (a - b - c + d) * u.x);
    return vec3(v, g);
  }
  /** Surface slope: long swell, wind chop and fine ripples, each drifting its own way. */
  vec2 waveGrad(vec2 p, float t, float detail) {
    vec2 g = vec2(0.0);
    g += vec2(0.8, 0.3) * cos(dot(p, vec2(0.8, 0.3)) * 0.35 + t * 0.9) * 0.06;
    g += vec2(-0.4, 0.9) * cos(dot(p, vec2(-0.4, 0.9)) * 0.6 + t * 1.3) * 0.04;
    g += noised(p * 0.35 + vec2(t * 0.06, t * 0.04)).yz * 0.12;
    g += noised(p * 0.9 - vec2(t * 0.11, -t * 0.07)).yz * 0.07 * detail;
    g += noised(p * 2.3 + vec2(-t * 0.23, t * 0.19)).yz * 0.035 * detail;
    g += noised(p * 5.7 + vec2(t * 0.41, t * 0.33)).yz * 0.015 * detail;
    return g;
  }

  void main() {
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 view = toEye / dist;
    // Fine ripples fade with distance (no shimmer); the far surface reads as calm sheen.
    float detail = 1.0 - smoothstep(30.0, 220.0, dist);
    vec2 g = waveGrad(vWorld.xz, uTime, detail) * mix(0.45, 1.0, detail);
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    float cosTheta = max(dot(view, n), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);
    // Sky reflection: horizon colour low, a deeper blue towards the zenith.
    vec3 r = reflect(-view, n);
    vec3 zenith = uSkyColor * vec3(0.55, 0.7, 1.0) * 0.85;
    vec3 sky = mix(uSkyColor * 1.05, zenith, smoothstep(0.0, 0.6, max(r.y, 0.0)));
    // Light is absorbed with depth: clear and greenish over the shallows, dark blue in the deep.
    float absorb = 1.0 - exp(-vDepth * 0.32);
    vec3 body = mix(uShallow * 1.15, uDeep * 0.8, absorb) * uLight;
    // Light passing through the backs of the waves.
    float sss = pow(max(dot(view, -uSunDir), 0.0), 3.0) * max(g.x + g.y, 0.0) * 4.0;
    body += uShallow * uSunColor * sss * 0.35 * step(0.0, uSunDir.y);
    vec3 col = mix(body, sky, clamp(fresnel, 0.0, 1.0));
    // Sun: a tight glint plus a broad sheen, sparkling on the ripples.
    vec3 h = normalize(uSunDir + view);
    float nh = max(dot(n, h), 0.0), above = smoothstep(-0.05, 0.1, uSunDir.y);
    col += uSunColor * (pow(nh, 900.0) * 6.0 + pow(nh, 120.0) * 0.6) * above;
    // Shore: foam that breaks up into streaks and lines lapping in towards the beach.
    float shore = 1.0 - smoothstep(0.0, 0.9, vDepth);
    float lap = 0.5 + 0.5 * sin(vDepth * 9.0 - uTime * 1.6 + noised(vWorld.xz * 0.6).x * 4.0);
    float streaks = smoothstep(0.35, 0.8, noised(vWorld.xz * 1.7 + vec2(uTime * 0.15, 0.0)).x);
    float foam = clamp(shore * (0.45 + 0.55 * lap) * (0.4 + 0.6 * streaks) * 1.4, 0.0, 1.0);
    col = mix(col, vec3(0.93, 0.95, 0.96) * uLight + uSunColor * 0.08, foam * 0.75);
    // See into the shallows; the deep water and grazing angles are opaque.
    float alpha = mix(0.25, 0.93, smoothstep(0.0, 3.0, vDepth));
    alpha = clamp(max(alpha, fresnel) + foam * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export interface WaterUniforms {
  uTime: { value: number };
  uSunDir: { value: Vector3 };
  uSunColor: { value: Color };
  uSkyColor: { value: Color };
  uDeep: { value: Color };
  uShallow: { value: Color };
  uLight: { value: number };
  uDefaultDepth: { value: number };
}

/**
 * Shared animated water shader: layered noise ripples (fading with distance), Schlick fresnel
 * over a sky gradient, depth absorption, light through the waves, sun glint and broken shore foam.
 */
export function createWaterMaterial(useDepthAttribute: boolean, shared?: WaterUniforms): ShaderMaterial {
  const own: WaterUniforms = shared ?? {
    uTime: { value: 0 },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Color(1, 1, 1) },
    uSkyColor: { value: new Color(0.5, 0.65, 0.8) },
    uDeep: { value: new Color(0x0e3b52) },
    uShallow: { value: new Color(0x2f8c8a) },
    uLight: { value: 1 },
    uDefaultDepth: { value: 12 },
  };
  const mat = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog]),
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    fog: true,
    defines: useDepthAttribute ? { USE_DEPTH_ATTR: 1 } : {},
  });
  // Merge clones uniforms; re-link the shared objects so one update drives every water material.
  Object.assign(mat.uniforms, own);
  return mat;
}

export function getWaterUniforms(mat: ShaderMaterial): WaterUniforms {
  return mat.uniforms as unknown as WaterUniforms;
}

/** Large sea plane that follows the camera (snapped to avoid texture swimming). */
export function createOceanGeometry(): PlaneGeometry {
  const g = new PlaneGeometry(6000, 6000, 1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function snapOcean(mesh: Mesh, camX: number, camZ: number, seaLevel: number): void {
  mesh.position.set(Math.round(camX / 64) * 64, seaLevel, Math.round(camZ / 64) * 64);
}
