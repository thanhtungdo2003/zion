import { MeshStandardMaterial, type Material } from 'three';

type NaturalSurface = 'ground' | 'rock' | 'tree';

/** Continuous metre-scale detail: no UV seams, extra textures or per-instance draw calls. */
export function naturalMaterial<T extends Material>(material: T, surface: NaturalSurface): T {
  const compile = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNaturalPosition;')
      .replace('#include <project_vertex>', `
        vec4 naturalPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          naturalPosition = instanceMatrix * naturalPosition;
        #endif
        vNaturalPosition = (modelMatrix * naturalPosition).xyz;
        #include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vNaturalPosition;
      float naturalHash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float naturalNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(naturalHash(i), naturalHash(i+vec3(1,0,0)),f.x),
                       mix(naturalHash(i+vec3(0,1,0)), naturalHash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(naturalHash(i+vec3(0,0,1)), naturalHash(i+vec3(1,0,1)),f.x),
                       mix(naturalHash(i+vec3(0,1,1)), naturalHash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }`);
    const detail = surface === 'tree' ? `
      float foliage = smoothstep(0.02, 0.12, diffuseColor.g - diffuseColor.r);
      float bark = naturalNoise(p * vec3(18.0, 1.2, 18.0));
      float leaf = naturalNoise(p * 7.0);
      float grain = mix(bark, leaf, foliage);
      float paleBark = (1.0 - foliage) * smoothstep(0.48, 0.72, diffuseColor.r);
      float barkMarks = smoothstep(0.65, 0.8, naturalNoise(p * vec3(3.0, 24.0, 3.0)));
      diffuseColor.rgb *= 0.82 + grain * 0.32 + broad * 0.16;
      diffuseColor.rgb *= 1.0 - paleBark * barkMarks * 0.55;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 0.98, 0.85), broad * 0.22);
    ` : surface === 'rock' ? `
      float strata = sin(p.y * 13.0 + broad * 7.0 + medium * 2.0) * 0.5 + 0.5;
      float vein = smoothstep(0.46, 0.5, medium) * (1.0 - smoothstep(0.5, 0.54, medium));
      diffuseColor.rgb *= 0.78 + broad * 0.24 + fine * 0.19 + strata * 0.09;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.17, 1.08, 0.92), vein * 0.35);
    ` : `
      // Large tonal patches (tens of metres) break up uniform fields, like real worn ground.
      float macro = naturalNoise(p * 0.018) * 0.65 + naturalNoise(p * 0.06) * 0.35;
      diffuseColor.rgb *= 0.78 + broad * 0.18 + medium * 0.16 + fine * 0.12 + macro * 0.14;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.02, 0.86), medium * 0.3);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 0.97, 0.84), smoothstep(0.45, 0.8, macro) * 0.45);
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 p = vNaturalPosition;
      float broad = naturalNoise(p * 0.23);
      float medium = naturalNoise(p * 2.3);
      // Fade sub-pixel grain with distance to avoid sparkling while walking.
      float grainFade = 1.0 - smoothstep(0.04, 0.18, length(fwidth(p)));
      float fine = mix(0.5, naturalNoise(p * 22.0), grainFade);
      ${detail}
      float naturalLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(naturalLuma), ${surface === 'ground' ? '0.2' : '0.12'});
    `);
    if (material instanceof MeshStandardMaterial) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float naturalHeight = (medium * 0.018 + fine * 0.006);
        vec3 naturalDx = dFdx(-vViewPosition), naturalDy = dFdy(-vViewPosition);
        vec3 naturalR1 = cross(naturalDy, normal), naturalR2 = cross(normal, naturalDx);
        float naturalDet = dot(naturalDx, naturalR1);
        normal = normalize(abs(naturalDet) * normal - sign(naturalDet) *
          (dFdx(naturalHeight) * naturalR1 + dFdy(naturalHeight) * naturalR2));
      `);
    }
  };
  material.customProgramCacheKey = () => `${key()}|natural-${surface}-2`;
  return material;
}

export function groundMaterial(): MeshStandardMaterial {
  return naturalMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0 }), 'ground');
}
