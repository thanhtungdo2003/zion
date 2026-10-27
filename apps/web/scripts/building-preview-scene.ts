/** Browser-only preview of generated battle royale buildings, bundled by building-preview-e2e.mjs. */
import { ACESFilmicToneMapping, AmbientLight, Color, DirectionalLight, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { createDefaultRegistry } from '@zion/assets';
import { Rng } from '@zion/shared';
import { masonryBuilding } from '../../../packages/worldgen/src/masonry';
import { modularBuilding } from '../../../packages/worldgen/src/battle-map';
import type { CampPart } from '../../../packages/worldgen/src/camp';
import { AssetLibrary } from '../src/game/render/asset-library';

const scene = new Scene(), camera = new PerspectiveCamera(50, 1280 / 800, .1, 500);
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1280, 800); renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = ACESFilmicToneMapping;
document.body.style.cssText = 'margin:0;background:#111;overflow:hidden';
document.body.appendChild(renderer.domElement);
scene.background = new Color(0x9db4c8);
scene.add(new AmbientLight(0xffffff, 1.1));
const sun = new DirectionalLight(0xffffff, 2.2); sun.position.set(30, 60, 20); scene.add(sun);
const ground = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: 0x6b6a55 })); ground.rotation.x = -Math.PI / 2; scene.add(ground);

const registry = createDefaultRegistry(), library = new AssetLibrary(registry, { game: true });
/** Each preview: its parts and where the camera looks from. */
const builds: Record<string, CampPart[]> = { brickL: [], concreteL: [], concreteRect: [], modular: [] };
masonryBuilding(builds.brickL!, [], 0, 0, 0, { material: 'brick', w: 10, d: 10, floors: 2, shape: 'L', interior: true }, 1, new Rng(11));
masonryBuilding(builds.concreteL!, [], 0, 0, 0, { material: 'concrete', finish: 'ivory', w: 18, d: 12, floors: 3, shape: 'L', interior: true }, 1, new Rng(7));
masonryBuilding(builds.concreteRect!, [], 0, 0, 0, { material: 'concrete', finish: 'gray', w: 18, d: 12, floors: 3, interior: true }, 1, new Rng(3));
modularBuilding(builds.modular!, 0, 0, 2, 1, false, 0, 5);

async function group(parts: CampPart[], maxY: number): Promise<Group> {
  const g = new Group();
  for (const p of parts) {
    if (p.y >= maxY) continue;
    const v = library.get(p.asset) ?? await library.load(p.asset)?.catch(() => undefined);
    if (!v) continue;
    const o = new Group();
    for (const part of v.parts) o.add(new Mesh(part.geometry, part.material));
    o.position.set(p.x, p.y, p.z); o.rotation.y = p.yaw; o.scale.setScalar(p.scale);
    g.add(o);
  }
  return g;
}

const report: Record<string, unknown> = {};
let current: Group | null = null;
async function capture(mode: string) {
  const [name, view] = mode.split(':') as [string, string];
  if (current) scene.remove(current);
  // Cut-away: only the ground floor's walls and furniture, seen from above.
  current = await group(builds[name]!, view === 'cut' ? 2.9 : 1e9);
  scene.add(current);
  if (view === 'cut') { camera.position.set(4, 22, 12); camera.lookAt(0, 0, 0); }
  else { camera.position.set(22, 14, -24); camera.lookAt(0, 4, 0); }
  renderer.render(scene, camera);
  report[mode] = { parts: builds[name]!.length, errors: library.errors.slice() };
  return report;
}
Object.assign(window, { building: { ready: true, capture, report } });
