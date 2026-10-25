import { DepthTexture, HalfFloatType, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, UnsignedIntType, Vector2, WebGLRenderTarget, type Camera, type PerspectiveCamera, type Texture, type WebGLRenderer } from 'three';

/**
 * Things right in front of the eye (the gun and hands, a wall pressed against) drawn out of focus,
 * as an eye focused on the distance sees them: a disc blur whose size grows the nearer a pixel is
 * (from `sharpFrom` metres in to `blurAt` and nearer), sampled only from pixels that are near too
 * so the sharp distance does not bleed into it.
 */
export const NearBlurShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    tDepth: { value: null as Texture | null },
    uNear: { value: .015 },
    uFar: { value: 1000 },
    uSharpFrom: { value: .6 },
    uBlurAt: { value: .22 },
    uRadius: { value: 4 },
    uTexel: { value: new Vector2(1 / 1024, 1 / 768) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse; uniform sampler2D tDepth;
    uniform float uNear; uniform float uFar; uniform float uSharpFrom; uniform float uBlurAt; uniform float uRadius; uniform vec2 uTexel;
    varying vec2 vUv;
    float dist(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
    float amount(float d) { return 1.0 - smoothstep(uBlurAt, uSharpFrom, d); }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float k = amount(dist(vUv));
      if (k <= 0.001 || uRadius <= 0.0) {
        gl_FragColor = base;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        return;
      }
      vec3 sum = base.rgb; float n = 1.0;
      for (int i = 0; i < 16; i++) {
        float a = float(i) * 2.39996;
        float r = sqrt((float(i) + .5) / 16.0) * uRadius * k;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
        float w = amount(dist(uv));
        sum += texture2D(tDiffuse, uv).rgb * w; n += w;
      }
      gl_FragColor = vec4(sum / n, base.a);
      // On screen: the renderer's tone mapping and output colour space (nothing into a target).
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/** The near blur over a plain render (no post-processing chain): the scene into a target with depth, then blurred to the screen. */
export class NearBlur {
  private target: WebGLRenderTarget | null = null;
  private readonly size = new Vector2();
  private readonly quad: Mesh;
  private readonly scene = new Scene();
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly material = new ShaderMaterial({ ...NearBlurShader, uniforms: structuredClone({ ...NearBlurShader.uniforms, tDiffuse: { value: null }, tDepth: { value: null } }), depthTest: false, depthWrite: false });

  constructor() {
    this.material.uniforms.uTexel!.value = new Vector2();
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);
  }

  /** `strength` 0…1 (lowered while aiming down the sights). */
  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, strength: number, draw?: (target: WebGLRenderTarget) => void): void {
    renderer.getDrawingBufferSize(this.size);
    if (!this.target || this.target.width !== this.size.x || this.target.height !== this.size.y) {
      this.target?.dispose();
      this.target = new WebGLRenderTarget(this.size.x, this.size.y, { type: HalfFloatType, depthTexture: new DepthTexture(this.size.x, this.size.y, UnsignedIntType) });
    }
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    if (draw) draw(this.target); else { renderer.clear(); renderer.render(scene, camera); }
    renderer.setRenderTarget(before);
    setNearBlur(this.material.uniforms, this.target.texture, this.target.depthTexture!, camera, this.size, strength);
    renderer.render(this.scene, this.cam);
  }

  dispose(): void { this.target?.dispose(); this.material.dispose(); this.quad.geometry.dispose(); }
}

/** Fills the blur's uniforms for this frame. */
export function setNearBlur(u: Record<string, { value: unknown }>, color: Texture, depth: Texture, camera: Camera, size: Vector2, strength: number): void {
  u.tDiffuse!.value = color; u.tDepth!.value = depth;
  const cam = camera as PerspectiveCamera;
  u.uNear!.value = cam.near; u.uFar!.value = cam.far;
  (u.uTexel!.value as Vector2).set(1 / size.x, 1 / size.y);
  // About 0.4 % of the screen height at full strength.
  u.uRadius!.value = Math.max(0, strength) * size.y * .004;
}
