/** Soft wind-driven cloud density, sampled on a sky plane rather than polygon puffs. */
export const cloudShader = /* glsl */ `
  float cloudHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float cloudNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), f.x),
               mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0)), f.x), f.y);
  }
  float cloudField(vec2 p) {
    float n = 0.0;
    float weight = 0.55;
    for (int i = 0; i < 4; i++) {
      n += cloudNoise(p) * weight;
      p = mat2(1.6, -1.2, 1.2, 1.6) * p + 7.3;
      weight *= 0.5;
    }
    return n;
  }
  vec2 cloudDensity(vec3 direction, float seconds, float seed) {
    vec2 p = direction.xz / max(direction.y, 0.12) * 2.4;
    p += vec2(seed, seed * 0.73) - vec2(0.007, 0.003) * seconds;
    float density = cloudField(p);
    float thin = cloudField(p * 1.7 + vec2(seconds * 0.002, 19.0));
    float fade = smoothstep(0.02, 0.18, direction.y);
    return vec2(smoothstep(0.52, 0.79, density) * 0.65,
                smoothstep(0.57, 0.85, thin) * 0.16) * fade;
  }
`;
