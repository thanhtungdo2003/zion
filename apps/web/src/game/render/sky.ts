import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  LinearFilter,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  RepeatWrapping,
  TextureLoader,
  Vector3,
  type Scene,
} from 'three';
import { cloudShader } from './clouds';

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNight;
  uniform float uTime;
  uniform float uCloudTime;
  uniform float uCloudSeed;
  uniform sampler2D uSkyImage;
  uniform float uSkyReady;
  uniform sampler2D uNightImage;
  uniform float uNightReady;
  varying vec3 vDir;

  ${cloudShader}

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.45, h));
    col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));
    // Equirectangular photo; fade the captured horizon/sun into the live atmosphere.
    vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5,
                   asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5);
    // Day: a photographed sky (CC0, Poly Haven); night: a photographed starry night sky.
    vec3 day = texture2D(uSkyImage, uv).rgb * mix(vec3(1.15), uHorizon * 0.7 + vec3(0.3), uNight) * mix(1.0, 0.055, uNight);
    vec3 night = texture2D(uNightImage, uv).rgb * vec3(0.72, 0.78, 0.95);
    vec3 photo = mix(day, night, uNight * uNightReady);
    float ready = mix(uSkyReady, max(uSkyReady, uNightReady), uNight);
    col = mix(col, photo, ready * smoothstep(0.04, 0.22, h) * 0.92);
    vec2 clouds = cloudDensity(d, uCloudTime, uCloudSeed);
    float cloudAlpha = clamp(clouds.x + clouds.y, 0.0, 0.8);
    vec3 cloudColor = mix(vec3(0.8, 0.85, 0.92), uHorizon * 0.5, uNight);
    cloudColor = mix(cloudColor, uHorizon, (1.0 - smoothstep(0.0, 0.35, uSunDir.y)) * 0.35);
    col = mix(col, cloudColor, cloudAlpha);
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 6.0) * 0.25 + pow(sd, 64.0) * 0.35);
    col += uSunColor * smoothstep(0.9993, 0.9997, sd) * 4.0 * (1.0 - cloudAlpha);
    vec3 moonDir = -uSunDir;
    float md = max(dot(d, moonDir), 0.0);
    col += vec3(0.75, 0.8, 0.95) * smoothstep(0.9990, 0.9994, md) * uNight * 1.5;
    col += vec3(0.2, 0.25, 0.4) * pow(md, 24.0) * uNight * 0.3;
    if (uNight > 0.01 && h > 0.0 && uNightReady < 0.5) {
      vec3 cell = floor(d * 380.0);
      float s = hash(cell);
      float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + s * 50.0);
      col += vec3(step(0.9975, s) * twinkle * uNight * smoothstep(0.0, 0.2, h) * (1.0 - cloudAlpha));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface SkyKey {
  e: number;
  top: Color;
  horizon: Color;
}

/** Sky gradients keyed by sun elevation (sin of altitude). */
const KEYS: SkyKey[] = [
  { e: -1, top: new Color(0x01030a), horizon: new Color(0x070c18) },
  { e: -0.18, top: new Color(0x040a1c), horizon: new Color(0x111a30) },
  { e: -0.06, top: new Color(0x1a2448), horizon: new Color(0x5b4560) },
  { e: 0.03, top: new Color(0x32508a), horizon: new Color(0xe39a62) },
  { e: 0.15, top: new Color(0x3f6fb8), horizon: new Color(0xd8c2a2) },
  { e: 0.35, top: new Color(0x3a78cc), horizon: new Color(0xa8c6e4) },
  { e: 1, top: new Color(0x2f6cc6), horizon: new Color(0x9fc2e6) },
];

function sampleKeys(e: number, top: Color, horizon: Color): void {
  for (let i = 1; i < KEYS.length; i++) {
    const b = KEYS[i]!;
    if (e <= b.e) {
      const a = KEYS[i - 1]!;
      const t = (e - a.e) / (b.e - a.e);
      top.copy(a.top).lerp(b.top, t);
      horizon.copy(a.horizon).lerp(b.horizon, t);
      return;
    }
  }
  top.copy(KEYS[KEYS.length - 1]!.top);
  horizon.copy(KEYS[KEYS.length - 1]!.horizon);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const SUN_LOW = new Color(0xffa860);
const SUN_HIGH = new Color(0xfff3e2);
const MOON = new Color(0x8ea6ff);
/** Ambient sky fill at night (moonlit, readable but clearly night). */
const NIGHT_FILL = new Color(0x6a7ca6);
const WHITE = new Color(0xffffff);
/** Soft dusk/dawn sky fill so twilight stays readable. */
const TWILIGHT_FILL = new Color(0xc8b8c8);
/** Axial tilt: noon sun sits towards +Z (south; the cold north is at z = 0). */
const LATITUDE = 0.5;

/**
 * Day/night cycle driven by the server's authoritative time of day: sun/moon direction, sky
 * dome, fog, hemisphere ambient and a single shadow-casting directional light (sun by day,
 * moon by night) that follows the player.
 */
export class SkySystem {
  readonly sunDir = new Vector3(0, 1, 0);
  readonly sunColor = new Color();
  readonly horizon = new Color();
  readonly top = new Color();
  readonly light: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly fog: Fog;
  private readonly dome: Mesh;
  private readonly material: ShaderMaterial;
  private readonly skyImage;
  private readonly nightImage;
  private disposed = false;
  /** 0 by day … 1 at full night. */
  night = 0;
  /** Overall scene brightness factor for custom shaders. */
  lightLevel = 1;

  constructor(private readonly scene: Scene, cosmeticSeed = 0) {
    this.material = new ShaderMaterial({
      uniforms: {
        uTop: { value: this.top },
        uHorizon: { value: this.horizon },
        uSunDir: { value: this.sunDir },
        uSunColor: { value: this.sunColor },
        uNight: { value: 0 },
        uTime: { value: 0 },
        uCloudTime: { value: 0 },
        uCloudSeed: { value: (cosmeticSeed >>> 0) % 10000 },
        uSkyImage: { value: null },
        uSkyReady: { value: 0 },
        uNightImage: { value: null },
        uNightReady: { value: 0 },
      },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.nightImage = new TextureLoader().load('/textures/sky/night-sky-2.jpg', (texture) => {
      if (this.disposed) { texture.dispose(); return; }
      this.material.uniforms.uNightReady!.value = 1;
    });
    this.nightImage.colorSpace = SRGBColorSpace;
    this.nightImage.wrapS = RepeatWrapping;
    // Crisp stars: no mip blur (the dome is always seen at about full resolution).
    this.nightImage.minFilter = LinearFilter;
    this.nightImage.generateMipmaps = false;
    this.material.uniforms.uNightImage!.value = this.nightImage;
    this.skyImage = new TextureLoader().load('/textures/sky/day-sky-2.jpg', (texture) => {
      if (this.disposed) { texture.dispose(); return; }
      this.material.uniforms.uSkyReady!.value = 1;
    });
    this.skyImage.colorSpace = SRGBColorSpace;
    this.skyImage.wrapS = RepeatWrapping;
    this.material.uniforms.uSkyImage!.value = this.skyImage;
    this.dome = new Mesh(new SphereGeometry(1, 32, 16), this.material);
    this.dome.scale.setScalar(2000);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.light = new DirectionalLight(0xffffff, 2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    const cam = this.light.shadow.camera;
    cam.left = -70;
    cam.right = 70;
    cam.top = 70;
    cam.bottom = -70;
    cam.near = 1;
    cam.far = 600;
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.5;
    scene.add(this.light, this.light.target);

    this.hemi = new HemisphereLight(0xbcd4ff, 0x3a3326, 0.6);
    scene.add(this.hemi);

    // A light haze from a few dozen metres out that thickens with distance.
    this.fog = new Fog(0xa8c6e4, 35, 560);
    scene.fog = this.fog;
  }

  update(timeOfDay: number, elapsed: number, focus: Vector3, serverSeconds = elapsed): void {
    const angle = (timeOfDay - 0.25) * Math.PI * 2;
    const s = Math.sin(angle);
    this.sunDir.set(Math.cos(angle), s * Math.cos(LATITUDE), s * Math.sin(LATITUDE)).normalize();
    const e = this.sunDir.y;
    sampleKeys(e, this.top, this.horizon);
    this.night = smooth(0.02, -0.2, e);
    this.sunColor.copy(SUN_LOW).lerp(SUN_HIGH, smooth(0.0, 0.35, e));

    const day = smooth(-0.06, 0.2, e);
    // Twilight (sun just around the horizon): neither sun nor moon lights much, so lift the fill.
    const twilight = 1 - smooth(0, 0.3, Math.abs(e));
    const moonUp = -e;
    const usingSun = e > -0.03;
    const dir = usingSun ? this.sunDir : this.sunDir.clone().negate();
    if (usingSun) {
      this.light.color.copy(this.sunColor);
      this.light.intensity = 0.9 + 1.7 * day + 0.6 * twilight;
    } else {
      this.light.color.copy(MOON);
      // Moonlight is the night's key light: strong enough against the fill to cast clear shadows.
      this.light.intensity = 1.25 + 0.65 * smooth(0.0, 0.25, moonUp) + 0.6 * twilight;
    }
    // Shadow camera follows the focus point, snapped to shadow texels to prevent shimmering.
    const texel = 140 / 2048;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.light.target.position.set(fx, focus.y, fz);
    this.light.position.set(fx + dir.x * 250, focus.y + Math.max(0.15, dir.y) * 250, fz + dir.z * 250);
    this.light.target.updateMatrixWorld();

    this.hemi.color.copy(NIGHT_FILL).lerp(this.top.clone().lerp(WHITE, 0.35), day)
      .lerp(TWILIGHT_FILL, twilight * 0.75);
    this.hemi.groundColor.setRGB(0.23, 0.2, 0.15);
    // Ambient never drops to black: twilight keeps sky fill, moonlit nights stay readable.
    // Bright enough to play comfortably at night; dusk and dawn are nearly as clear as day.
    this.hemi.intensity = 0.75 + 0.25 * day + 0.2 * this.night + 1.1 * twilight;
    this.lightLevel = Math.min(1, 0.5 + 0.5 * day + 0.5 * twilight);

    this.fog.color.copy(this.horizon).multiplyScalar(0.92);
    this.material.uniforms.uNight!.value = this.night;
    this.material.uniforms.uTime!.value = elapsed;
    this.material.uniforms.uCloudTime!.value = serverSeconds;
  }

  follow(x: number, y: number, z: number): void {
    this.dome.position.set(x, y, z);
  }

  dispose(): void {
    this.disposed = true;
    this.scene.remove(this.dome, this.light, this.light.target, this.hemi);
    if (this.scene.fog === this.fog) this.scene.fog = null;
    this.dome.geometry.dispose();
    this.material.dispose();
    this.skyImage.dispose();
    this.nightImage.dispose();
    this.light.dispose();
  }
}
