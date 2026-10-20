import {
  Box3, DoubleSide, HalfFloatType, PerspectiveCamera, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget,
  type Material, type Mesh, type Object3D, type Scene, type WebGLRenderer,
} from 'three';
import { scopeFov } from '../scope';

/**
 * Magnified optics without an overlay: the world is rendered a second time through a narrow
 * "scope camera" (same eye and direction as the gameplay camera, field of view divided by the
 * optic's power) into a render target, and that image is drawn ON the optic's `lens` block.
 *
 * The lens samples the target by SCREEN position, so the magnified picture is centred on the
 * screen centre (where the aimed sight line points) and everything outside the lens is the normal
 * frame — no black vignette. The scope pass is scissored to the lens' footprint on screen, so it
 * costs only the pixels the lens covers.
 */

export type ScopeReticle = 'duplex' | 'mildot' | 'rocket' | 'dot' | 'holo' | null;
const RETICLE_CODE: Record<NonNullable<ScopeReticle>, number> = { duplex: 1, mildot: 2, rocket: 3, dot: 4, holo: 5 };

const fragment = /* glsl */ `
  uniform sampler2D tScope;
  uniform vec2 uResolution;
  uniform float uPxPerMil;
  uniform float uRadiusPx;
  uniform float uReticle;
  uniform float uNight;
  uniform float uSee;
  uniform float uHasRim;
  uniform vec2 uCenterPx;
  varying float vRim;
  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    vec3 col = texture2D(tScope, uv).rgb;
    if (uNight > 0.5) {
      float l = dot(col, vec3(0.299, 0.587, 0.114)) * 3.2;
      col = vec3(0.3, 1.0, 0.4) * l;
    }
    vec2 p = gl_FragCoord.xy - uResolution * 0.5;
    float ink = 0.0;
    if (uReticle > 0.5 && uReticle < 3.5) {
      float thin = (abs(p.x) < 0.8 || abs(p.y) < 0.8) ? 1.0 : 0.0;
      float post = uRadiusPx * 0.32;
      float thick = ((abs(p.x) < 2.2 && abs(p.y) > post) || (abs(p.y) < 2.2 && abs(p.x) > post)) ? 1.0 : 0.0;
      ink = max(thin, thick);
      if (uReticle > 1.5 && uReticle < 2.5) {
        // Mil-dots on both lines, one per mil, out to 5 mils.
        vec2 m = p / uPxPerMil;
        vec2 nearest = floor(m + 0.5);
        float within = max(abs(nearest.x), abs(nearest.y)) <= 5.0 ? 1.0 : 0.0;
        float d = min(length(p - vec2(nearest.x * uPxPerMil, 0.0)), length(p - vec2(0.0, nearest.y * uPxPerMil)));
        ink = max(ink, step(d, 2.2) * within);
      }
      if (uReticle > 2.5) {
        // Rocket sight: a chevron and range ticks under it.
        float chevron = abs(abs(p.x) + p.y) < 1.2 && p.y < 0.0 && p.y > -uRadiusPx * 0.12 ? 1.0 : 0.0;
        float ticks = abs(p.x) < uRadiusPx * 0.06 && mod(-p.y, uRadiusPx * 0.12) < 1.2 && p.y < -uRadiusPx * 0.12 ? 1.0 : 0.0;
        ink = max(chevron, ticks);
      }
    }
    col = mix(col, vec3(0.015), clamp(ink, 0.0, 1.0));
    if (uSee < 0.5) {
      // Looking down a tube: the picture darkens from the middle of the lens out to its rim.
      float edge = uHasRim > 0.5 ? vRim : length(gl_FragCoord.xy - uCenterPx) / max(uRadiusPx, 1.0);
      float shade = smoothstep(0.5, 1.0, edge);
      col *= 1.0 - 0.6 * shade * shade;
    }
    // Red dot / holographic: an illuminated dot (and the holo's 65 MOA ring) on the lens.
    float glow = 0.0;
    float r = length(p);
    if (uReticle > 3.5) glow = 1.0 - smoothstep(max(1.5, uRadiusPx * 0.02), max(2.5, uRadiusPx * 0.02) + 1.0, r);
    if (uReticle > 4.5) glow = max(glow, 1.0 - smoothstep(1.0, 2.0, abs(r - uRadiusPx * 0.45)));
    col = mix(col, vec3(1.0, 0.08, 0.05) * 2.0, glow);
    // Unmagnified sights: the lens is clear glass, only the reticle shows on the world behind it.
    gl_FragColor = vec4(col, uSee > 0.5 ? max(glow, ink) : 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const vertex = /* glsl */ `
  attribute float rim;
  varying float vRim;
  void main() {
    vRim = rim;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export interface ScopeView {
  magnification: number;
  reticle: ScopeReticle;
  nightVision: boolean;
}

export class ScopeLens {
  private readonly target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  private readonly camera = new PerspectiveCamera();
  private readonly size = new Vector2();
  private readonly box = new Box3();
  private readonly corner = new Vector3();
  private readonly material = new ShaderMaterial({
    uniforms: {
      tScope: { value: this.target.texture },
      uResolution: { value: new Vector2(1, 1) },
      uPxPerMil: { value: 1 },
      uRadiusPx: { value: 100 },
      uReticle: { value: 0 },
      uNight: { value: 0 },
      uSee: { value: 0 },
      uHasRim: { value: 0 },
      uCenterPx: { value: new Vector2() },
    },
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    vertexShader: vertex,
    fragmentShader: fragment,
  });
  private active: { mesh: Mesh; material: Material | Material[]; visible: boolean } | null = null;
  private warmed: Mesh | null = null;

  /**
   * Gets everything ready before the scope comes up (an optic with a lens is in hand), so raising
   * it does not stall: the picture's render target is allocated and the lens shader compiled.
   */
  warm(renderer: WebGLRenderer, lens: Mesh, camera: PerspectiveCamera): void {
    if (this.warmed === lens) return;
    this.warmed = lens;
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x)), h = Math.max(1, Math.floor(this.size.y));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    renderer.initRenderTarget(this.target);
    if (this.active) return;
    const material = lens.material, visible = lens.visible;
    lens.material = this.material; lens.visible = true;
    renderer.compile(lens, camera);
    lens.material = material; lens.visible = visible;
  }

  /**
   * Renders the magnified view for this frame and puts it on `lens`. Call once per frame, before
   * the main render, while scoped. `hide` (the first-person gun) is left out of the scope image.
   */
  render(renderer: WebGLRenderer, scene: Scene, main: PerspectiveCamera, lens: Mesh, hide: Object3D, view: ScopeView): void {
    if (this.active && this.active.mesh !== lens) this.release();
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x)), h = Math.max(1, Math.floor(this.size.y));
    if (view.magnification > 1 && (this.target.width !== w || this.target.height !== h)) this.target.setSize(w, h);

    // Same eye and direction as the gameplay camera, field of view divided by the power.
    main.updateMatrixWorld();
    main.matrixWorld.decompose(this.camera.position, this.camera.quaternion, this.corner);
    this.camera.fov = scopeFov(main.fov, Math.max(1, view.magnification));
    this.camera.aspect = main.aspect;
    this.camera.near = Math.max(main.near, 0.05);
    this.camera.far = main.far;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    // Footprint of the lens on screen: the scope pass only fills those pixels.
    const rect = this.footprint(lens, main, w, h);
    const radiusPx = rect ? Math.max(rect.w, rect.h) / 2 : Math.min(w, h) / 4;
    if (view.magnification > 1 && rect) {
      const before = renderer.getRenderTarget();
      const wasVisible = hide.visible, lensVisible = lens.visible;
      hide.visible = false; lens.visible = false;
      // Shadows are drawn once a frame, by the main pass; the scope picture reuses them.
      const shadows = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      this.target.scissor.set(rect.x, rect.y, rect.w, rect.h);
      this.target.scissorTest = true;
      renderer.setRenderTarget(this.target);
      renderer.clear();
      renderer.render(scene, this.camera);
      renderer.setRenderTarget(before);
      renderer.shadowMap.autoUpdate = shadows;
      hide.visible = wasVisible; lens.visible = lensVisible;
    }

    const u = this.material.uniforms;
    u.uResolution!.value.set(w, h);
    // One mil (1/1000 rad) seen through the scope, in screen pixels at the centre.
    u.uPxPerMil!.value = 0.001 * (h / 2) / Math.tan((this.camera.fov * Math.PI) / 360);
    u.uRadiusPx!.value = radiusPx;
    u.uReticle!.value = view.reticle ? RETICLE_CODE[view.reticle] : 0;
    u.uNight!.value = view.nightVision ? 1 : 0;
    u.uSee!.value = view.magnification > 1 ? 0 : 1;
    u.uHasRim!.value = lens.geometry.getAttribute('rim') ? 1 : 0;
    u.uCenterPx!.value.set(rect ? rect.x + rect.w / 2 : w / 2, rect ? rect.y + rect.h / 2 : h / 2);

    if (!this.active) this.active = { mesh: lens, material: lens.material, visible: lens.visible };
    lens.material = this.material;
    lens.visible = true;
  }

  /** Puts the lens back as authored (clear) when no longer scoped. */
  release(): void {
    if (!this.active) return;
    this.active.mesh.material = this.active.material;
    this.active.mesh.visible = this.active.visible;
    this.active = null;
  }

  dispose(): void {
    this.release();
    this.target.dispose();
    this.material.dispose();
  }

  private footprint(lens: Mesh, camera: PerspectiveCamera, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
    const geometry = lens.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    this.box.copy(geometry.boundingBox!);
    lens.updateMatrixWorld();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      this.corner.set(i & 1 ? this.box.max.x : this.box.min.x, i & 2 ? this.box.max.y : this.box.min.y, i & 4 ? this.box.max.z : this.box.min.z)
        .applyMatrix4(lens.matrixWorld).project(camera);
      if (this.corner.z > 1) continue; // behind the camera
      const sx = (this.corner.x * 0.5 + 0.5) * w, sy = (this.corner.y * 0.5 + 0.5) * h;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2);
    x1 = Math.min(w, Math.ceil(x1) + 2); y1 = Math.min(h, Math.ceil(y1) + 2);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
}
