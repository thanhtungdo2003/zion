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
    world.y += sin(world.x * 0.35 + uTime * 1.3) * 0.03 + cos(world.z * 0.3 + uTime * 1.1) * 0.03;
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

  vec2 waveGrad(vec2 p, float t) {
    vec2 g = vec2(0.0);
    g += vec2(0.8, 0.3) * cos(dot(p, vec2(0.8, 0.3)) * 0.9 + t * 1.6) * 0.05;
    g += vec2(-0.4, 0.9) * cos(dot(p, vec2(-0.4, 0.9)) * 1.7 + t * 2.1) * 0.035;
    g += vec2(0.3, -0.7) * cos(dot(p, vec2(0.3, -0.7)) * 3.3 + t * 2.9) * 0.02;
    g += vec2(-0.9, -0.2) * cos(dot(p, vec2(-0.9, -0.2)) * 6.1 + t * 3.7) * 0.012;
    return g;
  }

  void main() {
    vec2 g = waveGrad(vWorld.xz, uTime);
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 view = normalize(cameraPosition - vWorld);
    float fresnel = pow(1.0 - max(dot(view, n), 0.0), 4.0);
    float shallow = 1.0 - smoothstep(0.0, 6.0, vDepth);
    vec3 base = mix(uDeep, uShallow, shallow) * uLight;
    vec3 col = mix(base, uSkyColor, clamp(fresnel * 0.85 + 0.08, 0.0, 1.0));
    vec3 h = normalize(uSunDir + view);
    float spec = pow(max(dot(n, h), 0.0), 220.0) * step(0.0, uSunDir.y);
    col += uSunColor * spec * 2.5;
    float foam = (1.0 - smoothstep(0.0, 0.35, vDepth)) * (0.55 + 0.45 * sin(uTime * 2.0 + vWorld.x * 2.1 + vWorld.z * 1.7));
    col = mix(col, vec3(0.92) * uLight + uSunColor * 0.1, clamp(foam, 0.0, 1.0) * 0.6);
    float alpha = mix(0.35, 0.9, smoothstep(0.0, 3.5, vDepth));
    alpha = max(alpha, fresnel);
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

/** Shared animated water shader: fresnel sky reflection, sun glint, depth tint and shore foam. */
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
