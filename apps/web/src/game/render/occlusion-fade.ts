import { Vector3, type Material } from 'three';

/**
 * See-through occluders: a prop standing between the camera and the player fades out as a whole
 * (every instance carries an `aFade` 0…1 set by the prop renderer), so walls, roofs and trees never
 * hide the character, without a permanent see-through hole around it.
 */
export const occlusionUniforms = {
  uFadeCam: { value: new Vector3() },
  uFadeTarget: { value: new Vector3(0, -1e5, 0) },
  uFadeRadius: { value: 1.7 },
  /** Opacity of a fully faded model. */
  uFadeOpacity: { value: 0.04 },
};

const VERT_DECL = `
varying float vFade;
#ifdef USE_INSTANCING
  attribute float aFade;
#endif`;
const VERT_BODY = `
  #ifdef USE_INSTANCING
    vFade = aFade;
  #else
    vFade = 0.0;
  #endif`;

const FRAG_DECL = `
varying float vFade;`;

// Dissolve instead of alpha: a faded model's pixels are dropped entirely (screen-door dither
// while it fades), so it neither shows nor hides what is behind/inside it (no depth left over).
const FRAG_BODY = `
  if (vFade > 0.001) {
    float fadeN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (fadeN < vFade * 1.02) discard;
  }`;

/** Patches a built-in (Lambert/Standard/Phong…) material in place; chains existing hooks. */
export function applyOcclusionFade<T extends Material>(mat: T): T {
  if (mat.userData.occlusionFade) return mat;
  mat.userData.occlusionFade = true;
  const prevCompile = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile(shader, renderer);
    Object.assign(shader.uniforms, occlusionUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('void main() {', `void main() {\n${FRAG_BODY}`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|ofade3`;
  mat.needsUpdate = true;
  return mat;
}
