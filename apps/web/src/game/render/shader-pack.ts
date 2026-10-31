import { Color, DepthTexture, HalfFloatType, UnsignedIntType, Vector2, Vector3, WebGLRenderTarget, type Camera, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { NearBlurShader, setNearBlur } from './near-blur';

/**
 * Light rays from the sun: the bright sky around the sun's position on screen, blurred radially
 * towards it and added back (the "god rays" of shader packs). Occluders (trees, buildings) cut the
 * rays because they are dark in the image being blurred.
 */
const SunShafts = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new Vector2(.5, .5) },
    uVisible: { value: 0 },
    uColor: { value: new Color(1, .86, .62) },
    uStrength: { value: .55 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uVisible; uniform vec3 uColor; uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uVisible <= 0.0) { gl_FragColor = base; return; }
      vec2 delta = (vUv - uSun) * (1.0 / 48.0) * 0.92;
      vec2 uv = vUv; float decay = 1.0, rays = 0.0;
      for (int i = 0; i < 48; i++) {
        uv -= delta;
        vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float bright = max(0.0, max(c.r, max(c.g, c.b)) - 0.9);
        rays += bright * decay; decay *= 0.965;
      }
      float falloff = 1.0 - smoothstep(0.0, 0.9, distance(vUv, uSun));
      gl_FragColor = vec4(base.rgb + uColor * rays * 0.06 * uStrength * uVisible * falloff, base.a);
    }`,
};

/**
 * Colour grade in the spirit of Minecraft shader packs: a filmic contrast curve, richer colour,
 * warm highlights and cool shadows that follow the time of day, a soft vignette and fine grain.
 */
const Grade = {
  uniforms: {
    tDiffuse: { value: null },
    uWarm: { value: new Color(1.05, .98, .9) },
    uCool: { value: new Color(.92, .97, 1.08) },
    uSaturation: { value: 1.14 },
    uContrast: { value: 1.08 },
    uVignette: { value: .32 },
    uTime: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 uWarm; uniform vec3 uCool; uniform float uSaturation; uniform float uContrast; uniform float uVignette; uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Split toning: highlights warm, shadows cool.
      c *= mix(uCool, uWarm, smoothstep(0.05, 0.7, l));
      c = mix(vec3(l), c, uSaturation);
      // Gentle S-curve around mid grey (linear light).
      c = max(vec3(0.0), (c - 0.18) * uContrast + 0.18);
      float v = smoothstep(0.95, 0.25, distance(vUv, vec2(0.5)));
      c *= mix(1.0 - uVignette, 1.0, v);
      c += (hash(vUv * 977.0) - 0.5) * 0.012;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/**
 * The "shaders" graphics option: a post-processing chain over the normal render (ambient
 * occlusion in creases and under eaves, bloom so lamps, fire and the sun glow, sun shafts and a
 * cinematic grade), plus softer, sharper sun shadows set up by the engine. Off by default.
 */
export class ShaderPack {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly ao: GTAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly shafts = new ShaderPass(SunShafts);
  private readonly grade = new ShaderPass(Grade);
  private readonly near = new ShaderPass(NearBlurShader);
  private readonly size = new Vector2();
  private readonly sun = new Vector3();

  constructor(private readonly renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    renderer.getDrawingBufferSize(this.size);
    // With depth: the near blur reads it.
    const target = new WebGLRenderTarget(this.size.x, this.size.y, { type: HalfFloatType, depthTexture: new DepthTexture(this.size.x, this.size.y, UnsignedIntType) });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.ao = new GTAOPass(scene, camera, this.size.x, this.size.y);
    this.ao.updateGtaoMaterial({ radius: .6, distanceExponent: 1.4, thickness: 1, scale: 1.1, samples: 8 });
    this.ao.blendIntensity = .75;
    this.bloom = new UnrealBloomPass(new Vector2(this.size.x, this.size.y), .5, .55, .88);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.near);
    this.composer.addPass(this.ao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.shafts);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  /**
   * Renders a frame. `sunDir`: direction towards the sun; `night`: 0 day … 1 night (fewer rays,
   * cooler grade); `world`: draws the scene into the target instead of the plain render pass
   * (the zombie outline uses its own render).
   */
  /** The map's grade (environment): saturation and contrast as factors on the pack's own. */
  mapGrade = { saturation: 1, contrast: 1 };

  render(camera: PerspectiveCamera, sunDir: Vector3, night: number, elapsed: number, world?: (target: WebGLRenderTarget) => void, nearBlur = 0): void {
    this.renderer.getDrawingBufferSize(this.size);
    if (this.composer.readBuffer.width !== this.size.x || this.composer.readBuffer.height !== this.size.y) {
      this.composer.setPixelRatio(1);
      this.composer.setSize(this.size.x, this.size.y);
    }
    // The sun on screen (rays only while it is up and in front of the camera).
    this.sun.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
    const ahead = this.sun.z < 1 && Math.abs(this.sun.x) < 1.6 && Math.abs(this.sun.y) < 1.6;
    const u = this.shafts.uniforms;
    u.uSun!.value.set(this.sun.x * .5 + .5, this.sun.y * .5 + .5);
    u.uVisible!.value = ahead && sunDir.y > -.02 ? Math.min(1, (sunDir.y + .02) * 6) * (1 - night) : 0;
    const g = this.grade.uniforms;
    g.uTime!.value = elapsed % 100;
    g.uSaturation!.value = 1.14 * this.mapGrade.saturation;
    g.uContrast!.value = 1.08 * this.mapGrade.contrast;
    g.uWarm!.value.setRGB(1.06 - night * .1, .98 - night * .04, .9 + night * .1);
    g.uCool!.value.setRGB(.92 - night * .08, .97, 1.08 + night * .08);
    this.bloom.strength = .45 + night * .35;
    this.renderPass.enabled = !world;
    // Right after the scene: the render target holding its depth is still the one read.
    this.near.enabled = nearBlur > 0 && !!this.composer.readBuffer.depthTexture;
    if (this.near.enabled) setNearBlur(this.near.uniforms as Record<string, { value: unknown }>, this.composer.readBuffer.texture, this.composer.readBuffer.depthTexture!, camera, this.size, nearBlur);
    if (world) world(this.composer.readBuffer);
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
    this.ao.dispose();
    this.bloom.dispose();
  }
}
