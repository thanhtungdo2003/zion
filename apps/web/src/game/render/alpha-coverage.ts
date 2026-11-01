import type { Material } from 'three';

/**
 * Leaves that do not thin out with distance. A cut-out leaf texture (alpha test) loses coverage in
 * its smaller mipmaps: each mip averages leaf and gap, so more and more texels fall under the
 * cut-off — tiny holes a few metres away, bigger and more of them further on, until the crown is
 * gone. The fix (Golus, "Anti-aliased alpha test: the esoteric alpha to coverage"; Castaño,
 * "Computing alpha mipmaps") is to scale alpha by the mip level the texture is read at, so the
 * covered share stays what it is at full size.
 */
export const ALPHA_COVERAGE = /* glsl */ `
  #if defined( USE_ALPHATEST ) && defined( USE_MAP )
    {
      vec2 alphaTexel = vMapUv * vec2(textureSize(map, 0));
      vec2 adx = dFdx(alphaTexel), ady = dFdy(alphaTexel);
      float alphaMip = max(0.0, 0.5 * log2(max(dot(adx, adx), dot(ady, ady))));
      diffuseColor.a *= 1.0 + alphaMip * 0.25;
    }
  #endif
  #include <alphatest_fragment>`;

/** Patches a built-in material in place (chains existing hooks); a no-op without alpha test. */
export function preserveAlphaCoverage<T extends Material>(mat: T): T {
  if (mat.userData.alphaCoverage || !(mat.alphaTest > 0)) return mat;
  mat.userData.alphaCoverage = true;
  const prevCompile = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', ALPHA_COVERAGE);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|acov1`;
  mat.needsUpdate = true;
  return mat;
}
