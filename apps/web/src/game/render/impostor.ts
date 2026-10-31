import {
  type BufferGeometry, Color, DoubleSide, FrontSide, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, MeshLambertMaterial, OrthographicCamera, PlaneGeometry, Scene,
  ShaderMaterial, Vector3, Vector4, WebGLRenderTarget, type Material, type Texture, type WebGLRenderer,
} from 'three';
import type { AssetVisual } from './asset-library';
import { windUniforms } from './asset-library';

/**
 * Depth impostors for distant vegetation.
 *
 * Baker: a model is rendered once from many directions over the upper hemisphere (a
 * hemi-octahedral grid of views, as in octahedral impostors), into two atlases: colour + coverage,
 * and object-space normal + depth (distance in front of or behind each view's plane). Edges are
 * dilated so mipmaps never pull in black, and coverage stays thick at a distance.
 *
 * Renderer: one camera-facing quad per instance. Its vertex shader picks the three views nearest
 * the direction the instance is seen from (by its own yaw) and projects the quad onto each view's
 * plane; the fragment shader marches the view ray against each view's depth (parallax, two steps,
 * bounded so shapes never smear), blends the three, lights it with the baked normals through the
 * scene's own lights and fog, and writes the surface's depth (so trunks meet the ground and
 * crowns cross each other correctly). Wind sways the crown; a screen-door dither fades it in
 * against the full model fading out (the same noise, complementary), so the switch never pops.
 */

/** Views per side of the hemi-octahedral grid. */
export const IMPOSTOR_GRID = 10;

/** Direction (upper hemisphere, y ≥ 0) → grid coordinates 0…1. */
export function hemiOctEncode(x: number, y: number, z: number): [number, number] {
  const l = Math.abs(x) + Math.abs(Math.max(0, y)) + Math.abs(z) || 1;
  const px = x / l, pz = z / l;
  return [(px + pz) * .5 + .5, (px - pz) * .5 + .5];
}
/** Grid coordinates 0…1 → unit direction. */
export function hemiOctDecode(u: number, v: number): [number, number, number] {
  const tx = u * 2 - 1, ty = v * 2 - 1, px = (tx + ty) * .5, pz = (tx - ty) * .5, y = 1 - Math.abs(px) - Math.abs(pz);
  const l = Math.hypot(px, y, pz) || 1;
  return [px / l, y / l, pz / l];
}

export interface ImpostorAtlas {
  albedo: Texture;
  normalDepth: Texture;
  /** Object-space centre of the baked sphere and its radius. */
  center: Vector3;
  radius: number;
  /** Lowest point of the model (its foot), object space. */
  bottom: number;
  bytes: number;
  dispose(): void;
}

const GLSL_OCT = /* glsl */ `
  vec2 impEncode(vec3 d) { d.y = max(d.y, 0.0); vec2 p = d.xz / (abs(d.x) + abs(d.y) + abs(d.z)); return vec2(p.x + p.y, p.x - p.y) * 0.5 + 0.5; }
  vec3 impDecode(vec2 uv) { vec2 t = uv * 2.0 - 1.0; vec2 p = vec2(t.x + t.y, t.x - t.y) * 0.5; return normalize(vec3(p.x, 1.0 - abs(p.x) - abs(p.y), p.y)); }
  void impBasis(vec3 f, out vec3 bx, out vec3 by) {
    vec3 up = abs(f.y) > 0.999 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0);
    bx = normalize(cross(up, f)); by = cross(f, bx);
  }`;

const bakeNormalVertex = /* glsl */ `
  varying vec3 vN; varying vec3 vP; varying vec2 vUv2;
  void main() { vN = normal; vP = position; vUv2 = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const bakeNormalVertexNoUv = /* glsl */ `
  varying vec3 vN; varying vec3 vP; varying vec2 vUv2;
  void main() { vN = normal; vP = position; vUv2 = vec2(0.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const bakeNormalFragment = /* glsl */ `
  uniform sampler2D uMap; uniform float uHasMap; uniform float uAlphaTest; uniform vec3 uCenter; uniform vec3 uDir; uniform float uRadius;
  varying vec3 vN; varying vec3 vP; varying vec2 vUv2;
  void main() {
    if (uHasMap > 0.5 && texture2D(uMap, vUv2).a < uAlphaTest) discard;
    vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
    // Leaves are thin: a back face lit from behind still reads as facing the viewer.
    if (dot(n, uDir) < 0.0) n = reflect(n, uDir);
    float d = clamp(dot(vP - uCenter, uDir) / uRadius, -1.0, 1.0);
    gl_FragColor = vec4(n * 0.5 + 0.5, d * 0.5 + 0.5);
  }`;

/** Fills transparent texels with the colour of the nearest covered ones (no dark halo in mips). */
const dilateFragment = /* glsl */ `
  uniform sampler2D uSrc; uniform sampler2D uMask; uniform vec2 uTexel; uniform float uKeepAlpha;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uSrc, vUv);
    float m = texture2D(uMask, vUv).a;
    if (m > 0.5) { gl_FragColor = c; return; }
    vec4 sum = vec4(0.0); float w = 0.0;
    for (int y = -4; y <= 4; y++) for (int x = -4; x <= 4; x++) {
      vec2 o = vec2(float(x), float(y)) * uTexel;
      float k = texture2D(uMask, vUv + o).a > 0.5 ? 1.0 / (1.0 + float(x * x + y * y)) : 0.0;
      sum += texture2D(uSrc, vUv + o) * k; w += k;
    }
    vec4 f = w > 0.0 ? sum / w : c;
    // Colour atlas: coverage stays 0 outside; normal/depth atlas: depth comes along too.
    gl_FragColor = vec4(f.rgb, uKeepAlpha > 0.5 ? c.a : f.a);
  }`;

/** Renders models into impostor atlases (once per model; a few dozen small draws). */
export class ImpostorBaker {
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, .01, 100);
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad = new Mesh(new PlaneGeometry(2, 2));
  private readonly quadScene = new Scene();
  private readonly dilate = new ShaderMaterial({
    uniforms: { uSrc: { value: null }, uMask: { value: null }, uTexel: { value: [0, 0] }, uKeepAlpha: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: dilateFragment, depthTest: false, depthWrite: false,
  });
  /** Pixels per view (the atlas is grid × this square). */
  cell: number;

  constructor(private readonly renderer: WebGLRenderer, cell = 64) {
    this.cell = cell;
    this.quad.material = this.dilate;
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  bake(v: AssetVisual): ImpostorAtlas {
    const r = this.renderer, size = IMPOSTOR_GRID * this.cell;
    // Bounds of every part (the model's own frame: no instance transform).
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of v.parts) { p.geometry.computeBoundingBox(); const b = p.geometry.boundingBox!; min.min(b.min); max.max(b.max); }
    const center = min.clone().add(max).multiplyScalar(.5), radius = Math.max(.1, max.clone().sub(min).length() * .5 * 1.02);

    const albedoScene = new Scene(), normalScene = new Scene(), owned: Material[] = [];
    const normalMats: ShaderMaterial[] = [];
    for (const p of v.parts) {
      if (!p.geometry.getAttribute('normal')) p.geometry.computeVertexNormals();
      const src = p.material as Material & { map?: Texture | null; color?: Color; alphaTest?: number; vertexColors?: boolean };
      const hasUv = !!p.geometry.getAttribute('uv'), hasColor = !!p.geometry.getAttribute('color');
      const basic = new MeshBasicMaterial({ map: hasUv ? src.map ?? null : null, color: src.color ?? new Color(1, 1, 1), vertexColors: hasColor && (src.vertexColors ?? true), alphaTest: Math.max(.3, src.alphaTest ?? 0), side: DoubleSide });
      const nm = new ShaderMaterial({
        uniforms: { uMap: { value: hasUv ? src.map ?? null : null }, uHasMap: { value: hasUv && src.map ? 1 : 0 }, uAlphaTest: { value: Math.max(.3, src.alphaTest ?? 0) }, uCenter: { value: center }, uDir: { value: new Vector3() }, uRadius: { value: radius } },
        vertexShader: hasUv ? bakeNormalVertex : bakeNormalVertexNoUv, fragmentShader: bakeNormalFragment, side: DoubleSide,
      });
      owned.push(basic, nm); normalMats.push(nm);
      albedoScene.add(new Mesh(p.geometry, basic));
      normalScene.add(new Mesh(p.geometry, nm));
    }

    const target = () => new WebGLRenderTarget(size, size, { depthBuffer: true, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
    const rawAlbedo = target(), rawNormal = target();
    const prev = { target: r.getRenderTarget(), autoClear: r.autoClear, clear: r.getClearColor(new Color()), alpha: r.getClearAlpha(), scissor: r.getScissorTest(), viewport: r.getViewport(new Vector4()) };
    r.autoClear = false;
    r.setClearColor(0x000000, 0);
    for (const rt of [rawAlbedo, rawNormal]) { r.setRenderTarget(rt); r.setScissorTest(false); r.clear(true, true, true); }
    const cam = this.camera;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius; cam.near = .01; cam.far = radius * 6; cam.updateProjectionMatrix();
    r.setScissorTest(true);
    for (let j = 0; j < IMPOSTOR_GRID; j++) for (let i = 0; i < IMPOSTOR_GRID; i++) {
      const [dx, dy, dz] = hemiOctDecode(i / (IMPOSTOR_GRID - 1), j / (IMPOSTOR_GRID - 1));
      cam.up.set(0, 1, 0);
      if (Math.abs(dy) > .999) cam.up.set(0, 0, -1);
      cam.position.set(center.x + dx * radius * 3, center.y + dy * radius * 3, center.z + dz * radius * 3);
      cam.lookAt(center);
      cam.updateMatrixWorld();
      for (const m of normalMats) (m.uniforms.uDir!.value as Vector3).set(dx, dy, dz);
      const x = i * this.cell, y = j * this.cell;
      for (const [rt, sc] of [[rawAlbedo, albedoScene], [rawNormal, normalScene]] as const) {
        r.setRenderTarget(rt);
        rt.viewport.set(x, y, this.cell, this.cell); rt.scissor.set(x, y, this.cell, this.cell);
        r.setViewport(x, y, this.cell, this.cell); r.setScissor(x, y, this.cell, this.cell);
        r.render(sc, cam);
      }
    }
    r.setScissorTest(false);

    // Dilate both into mipmapped atlases (coverage from the colour atlas).
    const final = () => new WebGLRenderTarget(size, size, { depthBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
    const albedo = final(), normalDepth = final();
    const u = this.dilate.uniforms;
    u.uMask!.value = rawAlbedo.texture; u.uTexel!.value = [1 / size, 1 / size];
    for (const [src, dst, keep] of [[rawAlbedo, albedo, 1], [rawNormal, normalDepth, 0]] as const) {
      u.uSrc!.value = src.texture; u.uKeepAlpha!.value = keep;
      r.setRenderTarget(dst); dst.viewport.set(0, 0, size, size); r.setViewport(0, 0, size, size);
      r.clear(true, false, false);
      r.render(this.quadScene, this.quadCamera);
    }
    r.setRenderTarget(prev.target); r.autoClear = prev.autoClear; r.setClearColor(prev.clear, prev.alpha); r.setScissorTest(prev.scissor); r.setViewport(prev.viewport);
    rawAlbedo.dispose(); rawNormal.dispose();
    for (const m of owned) m.dispose();
    return {
      albedo: albedo.texture, normalDepth: normalDepth.texture, center, radius, bottom: min.y,
      bytes: size * size * 4 * 2 * 4 / 3,
      dispose: () => { albedo.dispose(); normalDepth.dispose(); },
    };
  }

  dispose(): void { this.quad.geometry.dispose(); this.dilate.dispose(); }
}

/* ------------------------------------------------------------------------------ renderer */

export interface ImpostorOptions {
  /** Fade-in band (m): fully the model before `near`, fully the impostor after `near + band`. */
  near: number; band: number;
  /** Ray-marched depth (parallax) and per-pixel depth writes; off for the very far ring. */
  depth: boolean;
}

/** The quad every impostor instance draws (scaled in the shader to the baked sphere). */
export const impostorQuad = (): BufferGeometry => new PlaneGeometry(1, 1);

/** A material drawing instances of one baked model through the scene's lights and fog. */
export function impostorMaterial(atlas: ImpostorAtlas, opts: ImpostorOptions): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ alphaTest: .42, side: FrontSide });
  const uniforms = {
    impAlbedo: { value: atlas.albedo }, impNormal: { value: atlas.normalDepth }, impCenter: { value: atlas.center }, impRadius: { value: atlas.radius },
    impGrid: { value: IMPOSTOR_GRID }, impFade: { value: [opts.near, opts.band] }, impBottom: { value: atlas.bottom }, uTime: windUniforms.uTime,
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (opts.depth) shader.defines = { ...(shader.defines ?? {}), IMP_DEPTH: '' };
    const decl = /* glsl */ `
      uniform sampler2D impAlbedo; uniform sampler2D impNormal; uniform vec3 impCenter; uniform float impRadius; uniform float impGrid; uniform vec2 impFade; uniform float impBottom; uniform float uTime;
      varying vec4 vImpA; varying vec4 vImpB; varying vec4 vImpC; varying vec3 vRayA; varying vec3 vRayB; varying vec3 vRayC; varying vec4 vImpW; varying vec4 vImpI;
      ${GLSL_OCT}`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${decl}
        vec4 impFrame(vec2 cell, vec3 C, vec3 P, vec3 cam, out vec3 ray) {
          vec3 f = impDecode(cell / (impGrid - 1.0)), bx, by; impBasis(f, bx, by);
          vec3 r = normalize(P - cam);
          float t = dot(C - cam, f) / min(dot(r, f), -1e-4);
          vec3 q = cam + r * t - C;
          ray = vec3(dot(r, bx), dot(r, by), dot(r, f));
          return vec4(vec2(dot(q, bx), dot(q, by)) / (2.0 * impRadius) + 0.5, cell);
        }`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 0.0, 1.0);')
      .replace('#include <begin_vertex>', `
        mat4 impM = modelMatrix * instanceMatrix;
        float impScale = length(impM[0].xyz);
        vec3 impCam = (inverse(impM) * vec4(cameraPosition, 1.0)).xyz;
        vec3 impV = normalize(impCam - impCenter);
        vec3 impUp = abs(impV.y) > 0.999 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0);
        vec3 impBx = normalize(cross(impUp, impV)), impBy = cross(impV, impBx);
        vec3 transformed = impCenter + (impBx * position.x + impBy * position.y) * 2.0 * impRadius;
        // The three views nearest the direction it is seen from, and their weights.
        vec2 g = impEncode(impV) * (impGrid - 1.0), f0 = min(floor(g), vec2(impGrid - 2.0)), fr = g - f0;
        vec2 cA = f0, cB, cC = f0 + 1.0; vec3 w;
        if (fr.x > fr.y) { cB = f0 + vec2(1.0, 0.0); w = vec3(1.0 - fr.x, fr.x - fr.y, fr.y); }
        else { cB = f0 + vec2(0.0, 1.0); w = vec3(1.0 - fr.y, fr.y - fr.x, fr.x); }
        vImpA = impFrame(cA, impCenter, transformed, impCam, vRayA);
        vImpB = impFrame(cB, impCenter, transformed, impCam, vRayB);
        vImpC = impFrame(cC, impCenter, transformed, impCam, vRayC);
        vec3 impWorld = (impM * vec4(impCenter, 1.0)).xyz;
        vImpW = vec4(w, distance(cameraPosition, impWorld));
        vImpI = vec4(impM[0].x / impScale, -impM[0].z / impScale, impScale, 0.0);
        // Wind: the crown sways (more towards the top), each tree in its own rhythm.
        float h = clamp((transformed.y - impBottom) / (2.0 * impRadius), 0.0, 1.0);
        float phase = dot(impWorld.xz, vec2(0.071, 0.113));
        transformed.x += h * h * impRadius * 0.025 * sin(uTime * 1.3 + phase);
        transformed.z += h * h * impRadius * 0.015 * sin(uTime * 1.05 + phase * 1.7);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${decl}
        vec3 impNrm; float impDepth;
        vec4 impTap(vec4 fr, vec3 ray, out vec4 nd) {
          vec2 uv = fr.xy;
          #ifdef IMP_DEPTH
            // Two steps along the view ray to the baked surface, bounded (no smearing).
            for (int k = 0; k < 2; k++) {
              float d = texture2D(impNormal, (fr.zw + clamp(uv, 0.0, 1.0)) / impGrid).a * 2.0 - 1.0;
              float s = clamp(d / min(ray.z, -0.2), -1.0, 1.0);
              uv = fr.xy + ray.xy * s * 0.5;
            }
          #endif
          vec2 a = (fr.zw + clamp(uv, 0.002, 0.998)) / impGrid;
          nd = texture2D(impNormal, a);
          // Outside the cell's square there is nothing.
          float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          return texture2D(impAlbedo, a) * vec4(1.0, 1.0, 1.0, inside);
        }`)
      .replace('#include <map_fragment>', `
        vec4 ndA, ndB, ndC;
        vec4 tA = impTap(vImpA, vRayA, ndA), tB = impTap(vImpB, vRayB, ndB), tC = impTap(vImpC, vRayC, ndC);
        vec3 iw = vImpW.xyz;
        vec4 tex = tA * iw.x + tB * iw.y + tC * iw.z;
        vec4 nd = ndA * iw.x + ndB * iw.y + ndC * iw.z;
        // Coverage thins in small mips: held up with distance so far crowns stay full.
        tex.a = min(1.0, tex.a * mix(1.0, 1.7, smoothstep(120.0, 600.0, vImpW.w)));
        diffuseColor *= tex;
        vec3 on = nd.rgb * 2.0 - 1.0;
        vec3 wn = vec3(on.x * vImpI.x + on.z * vImpI.y, on.y, -on.x * vImpI.y + on.z * vImpI.x);
        impNrm = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        impDepth = nd.a * 2.0 - 1.0;
        // Fades in against the full model fading out: the same screen-door noise, complementary.
        float impN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (impN >= smoothstep(impFade.x, impFade.x + impFade.y, vImpW.w) * 1.02) discard;`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n        normal = impNrm;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        #ifdef IMP_DEPTH
          float impZ = -vViewPosition.z + impDepth * impRadius * vImpI.z;
          vec4 impClip = projectionMatrix * vec4(0.0, 0.0, impZ, 1.0);
          gl_FragDepth = clamp(impClip.z / impClip.w * 0.5 + 0.5, 0.0, 1.0);
        #endif`);
  };
  mat.customProgramCacheKey = () => `impostor-${opts.depth ? 'd' : 'f'}`;
  mat.userData.impFade = uniforms.impFade;
  return mat;
}
