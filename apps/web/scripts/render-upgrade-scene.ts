/** Browser-only visual regression scene, bundled by render-upgrade-e2e.mjs. */
import { ACESFilmicToneMapping, Box3, Color, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { createDefaultRegistry } from '@zion/assets';
import { EntityFlags } from '@zion/shared';
import { WorldGenerator } from '@zion/worldgen';
import { makeBaseSample } from '../../../packages/worldgen/src/fields';
import { buildTerrainGeometry, buildWaterGeometry } from '../src/game/render/terrain';
import { createWaterMaterial } from '../src/game/render/water';
import { groundMaterial } from '../src/game/render/natural-material';
import { GroundTextures } from '../src/game/render/ground-textures';
import { SkySystem } from '../src/game/render/sky';
import { Avatar } from '../src/game/render/avatars';
import { buildBBModel, mirrorCharacter, survivorTemplate } from '../src/game/render/character-model';
import { parseHumanAssets } from '../src/game/render/human-rig';

const scene = new Scene(), camera = new PerspectiveCamera(55, 1280 / 800, .1, 3000);
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1280, 800); renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap;
document.body.style.cssText = 'margin:0;background:#111;overflow:hidden';
document.body.appendChild(renderer.domElement);
const sky = new SkySystem(scene, 7123), mat = groundMaterial(), textures = new GroundTextures(mat);
textures.setDetail('medium', renderer);
const registry = createDefaultRegistry(), config = { seed: 7123, sizeChunks: 64 };
const modern = new WorldGenerator({ ...config, generatorVersion: 8 }, registry), legacy = new WorldGenerator({ ...config, generatorVersion: 7 }, registry);
modern.rawTerrain = legacy.rawTerrain = true;
let strength = 0, cx = 0, cz = 0, wetStrength = 0, wetCx = 0, wetCz = 0;
const base = makeBaseSample();
for (let z = 160; z < 1900; z += 64) for (let x = 160; x < 1900; x += 64) {
  if ([modern, legacy].some((gen) => gen.camp && Math.hypot(x - gen.camp.x, z - gen.camp.z) < 200)) continue;
  modern.fields.base(x, z, base);
  if (base.mountain > strength) { strength = base.mountain; cx = Math.floor(x / 32); cz = Math.floor(z / 32); }
  if (base.mountain > .5) {
    const column = modern.sampleColumn(x, z), score = base.mountain * Math.max(0, column.humidity - .5);
    if (column.height > 62 && column.temperature > .25 && score > wetStrength) { wetStrength = score; wetCx = Math.floor(x / 32); wetCz = Math.floor(z / 32); }
  }
}
const terrain: Mesh[][] = [];
const waterMaterial = createWaterMaterial(true);
for (const [gen, centerX, centerZ] of [[legacy, cx, cz], [modern, cx, cz], [modern, wetCx, wetCz]] as const) {
  const meshes: Mesh[] = [];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const chunk = gen.generateChunk(centerX + i, centerZ + j, 0), mesh = new Mesh(buildTerrainGeometry(chunk, 20, 7123), mat);
    mesh.position.set(chunk.cx * 32, 0, chunk.cz * 32); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); meshes.push(mesh);
    const waterGeometry = buildWaterGeometry(chunk);
    if (waterGeometry) {
      const water = new Mesh(waterGeometry, waterMaterial); water.position.copy(mesh.position); scene.add(water); meshes.push(water);
    }
  }
  terrain.push(meshes);
}
const raw = await (await fetch('/models/characters/teen-wasteland-survivor.bbmodel')).json(); raw.textures = [];
const human = await parseHumanAssets(await (await fetch('/models/characters/zion-survivor.glb')).arrayBuffer());
const avatar = new Avatar(survivorTemplate(mirrorCharacter(await buildBBModel(raw)), human), true);
avatar.addTo(scene); avatar.ground = () => 0;
const floor = new Mesh(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: new Color('#79785d'), roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const focus = new Vector3(cx * 32 + 16, modern.heightAt(cx * 32 + 16, cz * 32 + 16), cz * 32 + 16);
const wetFocus = new Vector3(wetCx * 32 + 16, modern.heightAt(wetCx * 32 + 16, wetCz * 32 + 16), wetCz * 32 + 16);
const wetColumn = modern.sampleColumn(wetFocus.x, wetFocus.z);
const report: Record<string, unknown> = { seed: 7123, chunk: [cx, cz], exposure: strength,
  wetChunk: [wetCx, wetCz], wetClimate: { humidity: wetColumn.humidity, temperature: wetColumn.temperature } };

function capture(mode: string) {
  const character = mode.startsWith('animation');
  terrain.forEach((meshes, k) => meshes.forEach((m) => { m.visible = !character && k === (mode === 'terrain-before' ? 0 : mode === 'terrain-wet' ? 2 : 1); }));
  floor.visible = avatar.root.visible = character;
  const night = mode === 'sky-night';
  if (character) {
    const speed = mode === 'animation-sprint' ? 6.2 : mode === 'animation-jog' ? 4.4 : 3.4, flags = EntityFlags.Grounded | (speed > 5 ? EntityFlags.Sprinting : 0);
    avatar.update(0, 0, 0, 0, EntityFlags.Grounded, 1 / 60, 0);
    let z = 0;
    for (let i = 0; i < 120; i++) {
      z -= speed / 60; avatar.update(0, 0, z, 0, flags, 1 / 60, i / 60);
      avatar.root.updateMatrixWorld(true);
    }
    avatar.root.updateMatrixWorld(true);
    const center = new Box3().setFromObject(avatar.root).getCenter(new Vector3());
    floor.position.z = z; camera.position.copy(center).add(new Vector3(3.5, .8, 4)); camera.lookAt(center);
    sky.update(.38, 30, center, 30); sky.follow(camera.position.x, camera.position.y, camera.position.z);
    const pose = (avatar as unknown as { mocap: { clip: string; time: number; weight: number; legs: unknown } }).mocap;
    report[mode] = { clip: pose.clip, time: pose.time, weight: pose.weight, legs: pose.legs };
  } else {
    const target = mode === 'terrain-wet' ? wetFocus : focus;
    camera.position.copy(target).add(new Vector3(31, 18, 37)); camera.lookAt(target);
    if (mode.startsWith('sky')) camera.lookAt(camera.position.clone().add(new Vector3(-.6, .5, -1)));
    sky.update(night ? .0 : .39, 100, target, 100); sky.follow(camera.position.x, camera.position.y, camera.position.z);
  }
  renderer.render(scene, camera);
  report[`${mode}-render`] = { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  return report;
}

// Compile all material paths on the GPU, then permit the CDP runner to capture the settled scene.
capture('terrain-after');
await renderer.compileAsync(scene, camera);
Object.assign(window, { upgrade: { ready: true, capture, report } });
