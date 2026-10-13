import { Color, DepthTexture, HalfFloatType, Mesh, MeshBasicMaterial, NearestFilter, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderTarget, type Camera, type Object3D, type WebGLRenderer } from 'three';

const MASK_LAYER = 30;

/** Outlines detected targets; remembered silhouettes remain readable through occluders. */
export class ZombieOutline {
  // Keep lighting above 1.0 until the final tone mapping pass, just like direct rendering.
  private readonly world = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  private readonly mask = new WebGLRenderTarget(1, 1);
  private readonly white = new MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false });
  private readonly screen = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new Vector2();
  private readonly black = new Color(0);
  private readonly material = new ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { colorMap: { value: this.world.texture }, worldDepth: { value: null }, maskMap: { value: this.mask.texture }, maskDepth: { value: null }, pixel: { value: new Vector2(1, 1) } },
    vertexShader: 'varying vec2 uvScreen; void main(){ uvScreen=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: `
      varying vec2 uvScreen;
      uniform sampler2D colorMap, worldDepth, maskMap, maskDepth;
      uniform vec2 pixel;
      float hidden(vec2 p) {
        float body = texture2D(maskMap,p).r;
        float behind = step(texture2D(worldDepth,p).r + 0.0000002, texture2D(maskDepth,p).r);
        return body * behind;
      }
      void main() {
        float body = texture2D(maskMap,uvScreen).r;
        float edge=0.; float glow=0.;
        for(int i=0;i<12;i++) {
          float a=float(i)*6.2831853/12.; vec2 dir=vec2(cos(a),sin(a))*pixel;
          edge=max(edge,texture2D(maskMap,uvScreen+dir*1.6).r);
          glow+=hidden(uvScreen+dir*4.5)/12.;
        }
        float alpha=(1.-body)*min(0.9,edge*0.85+glow*0.23);
        vec3 base=texture2D(colorMap,uvScreen).rgb;
        gl_FragColor=vec4(mix(base,vec3(1.,0.025,0.015),alpha),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  private readonly quad = new Mesh(new PlaneGeometry(2, 2), this.material);

  constructor() {
    for (const target of [this.world, this.mask]) {
      target.depthTexture = new DepthTexture(1, 1);
      target.texture.minFilter = target.texture.magFilter = NearestFilter;
    }
    this.material.uniforms.worldDepth!.value = this.world.depthTexture;
    this.material.uniforms.maskDepth!.value = this.mask.depthTexture;
    this.screen.add(this.quad);
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, selected: readonly Object3D[]): void {
    if (!selected.length) { renderer.render(scene, camera); return; }
    renderer.getDrawingBufferSize(this.size);
    if (this.world.width !== this.size.x || this.world.height !== this.size.y) {
      this.world.setSize(this.size.x, this.size.y); this.mask.setSize(this.size.x, this.size.y);
    }
    const ratio = renderer.getPixelRatio();
    this.material.uniforms.pixel!.value.set(ratio / this.size.x, ratio / this.size.y);
    const target = renderer.getRenderTarget();
    const background = scene.background;
    const override = scene.overrideMaterial;
    const layers = camera.layers.mask;
    const autoClear = renderer.autoClear;
    const clearColor = renderer.getClearColor(new Color());
    const clearAlpha = renderer.getClearAlpha();
    const shadowUpdate = renderer.shadowMap.autoUpdate;
    const changed: Array<[Object3D, number]> = [];
    try {
      renderer.autoClear = true;
      renderer.setRenderTarget(this.world); renderer.render(scene, camera);
      renderer.shadowMap.autoUpdate = false;
      for (const root of selected) root.traverse((node) => {
        if (node instanceof Mesh) { changed.push([node, node.layers.mask]); node.layers.enable(MASK_LAYER); }
      });
      camera.layers.set(MASK_LAYER); scene.overrideMaterial = this.white; scene.background = this.black;
      renderer.setClearColor(0, 1); renderer.setRenderTarget(this.mask); renderer.render(scene, camera);
      renderer.setRenderTarget(target); renderer.render(this.screen, this.camera);
    } finally {
      for (const [node, mask] of changed) node.layers.mask = mask;
      camera.layers.mask = layers; scene.overrideMaterial = override; scene.background = background;
      renderer.autoClear = autoClear; renderer.shadowMap.autoUpdate = shadowUpdate;
      renderer.setClearColor(clearColor, clearAlpha); renderer.setRenderTarget(target);
    }
  }

  dispose(): void {
    this.world.dispose(); this.mask.dispose(); this.white.dispose();
    this.quad.geometry.dispose(); this.material.dispose();
  }
}
