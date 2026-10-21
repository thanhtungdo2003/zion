/** Reproducible, explicit offline application of the same passes used by /studio/world. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createDefaultRegistry } from '@zion/assets';
import { BATTLE_MAP, BATTLE_FLIGHT, BATTLE_LOBBY_RADIUS, BATTLE_TIME_OF_DAY } from '@zion/shared';
import { WorldGenerator, normalizeSeed, authoredWorld, openIsland, checkpoint, currentIsland, readIslandDocument, terrainPass, townRoadPass, townParcels, ruralSettlementPass } from '../src/index';

process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));
const registry = createDefaultRegistry();
const make = (battleIsland = currentIsland(openIsland())) => new WorldGenerator({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, mode: 'battle-royale', battleIsland }, registry);
const baseline = make(), base = authoredWorld(baseline);
let doc = openIsland();
await mkdir('docs/world-editor/evidence', { recursive: true });
await writeFile('docs/world-editor/island-baseline.json', JSON.stringify(doc, null, 2) + '\n');
const sha = (data: string) => createHash('sha256').update(data).digest('hex');
await writeFile('docs/world-editor/evidence/baseline-manifest.json', JSON.stringify({
  runtimeMetadata: BATTLE_MAP, authoredMapId: base.map.id, authoredMapName: base.map.name,
  generatorConfig: baseline.config, coastVertices: base.map.coast.length, zones: base.areas(),
  siteCount: base.structures().length, sitesSha256: sha(JSON.stringify(base.structures())),
  lootSpotCount: base.lootSpots().length, lootSha256: sha(JSON.stringify(base.lootSpots())),
  assetIds: [...new Set(base.structures().flatMap(s=>s.parts.map(p=>p.asset)))].sort((a,b)=>a-b),
  gameplay: { flight: BATTLE_FLIGHT, lobbyRadius: BATTLE_LOBBY_RADIUS, timeOfDay: BATTLE_TIME_OF_DAY,
    battleRulesSourceSha256: sha(await readFile('apps/server/src/game/battle-royale.ts','utf8')) },
  classification: { originalSites: 'keep: no move, deletion or replacement', supplementalHomes: 'additive: deterministic road-frontage lots; reusable Zion assets' },
},null,2)+'\n');
doc = checkpoint(doc, 'terrain', terrainPass(currentIsland(doc)));
const terrain = make(currentIsland(doc));
const roadPass = townRoadPass(currentIsland(doc), authoredWorld(terrain).structures(), (x,z) => terrain.heightAt(x,z));
doc = checkpoint(doc, 'roads', roadPass.map);
const settlement = ruralSettlementPass(currentIsland(doc), base.structures(), registry, (x,z)=>terrain.heightAt(x,z),(x,z)=>base.coastDistance(x,z));
doc = checkpoint(doc, 'settlement', settlement.map);
doc = checkpoint(doc, 'environment', { ...currentIsland(doc), dressExtraBuildings: true });
await writeFile('docs/world-editor/island-revision.json', JSON.stringify(doc, null, 2) + '\n');
const loaded = readIslandDocument(await readFile('docs/world-editor/island-revision.json', 'utf8'));
const edited = make(currentIsland(loaded)), world = authoredWorld(edited);
let changed = 0, maxDelta = 0, squares = 0, protectedDelta = 0;
for (let z = 0; z <= 4096; z += 16) for (let x = 0; x <= 4096; x += 16) {
  const delta = Math.abs(edited.heightAt(x,z)-baseline.heightAt(x,z));
  if (delta > .001) changed++;
  maxDelta = Math.max(maxDelta,delta); squares++;
  if (Math.abs(base.coastDistance(x,z)) < 100) protectedDelta = Math.max(protectedDelta,delta);
}
const sites = world.structures(), originals = base.structures();
const report = {
  status: 'offline revision; not activated on live server; gameplay visual review pending',
  seed: BATTLE_MAP.seed, sampleSpacingMetres: 16, sampledColumns: squares,
  changedColumns: changed, maximumHeightDeltaMetres: maxDelta, coastalMaximumDeltaMetres: protectedDelta,
  roadsBefore: base.map.roads.length, roadsAfter: world.map.roads.length, rejectedRoads: roadPass.rejected,
  blocks: new Set(townParcels(world.map).map(p => p.block)).size, townParcels: townParcels(world.map).length,
  ruralFrontageParcels: settlement.parcels.length, supplementalHomes: world.map.extraBuildings,
  originalStructureCount: originals.length, structureCount: sites.length,
  originalStructuresPreserved: JSON.stringify(originals) === JSON.stringify(sites.slice(0,originals.length)),
  originalLootPreserved: JSON.stringify(base.lootSpots()) === JSON.stringify(world.lootSpots()),
  zoneAnchorsPreserved: JSON.stringify(base.areas()) === JSON.stringify(world.areas()),
  spawns: edited.findSpawnPoints(96,65).length,
  roundTrip: JSON.stringify(currentIsland(loaded)) === JSON.stringify(currentIsland(doc)),
  incomplete: ['town roads and enclosed blocks rejected by preservation constraints', 'existing building relocation', 'end-to-end walking/driving and BR match', 'gameplay perspective visual review', 'server activation and client revision distribution'],
};
await writeFile('docs/world-editor/evidence/validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.originalStructuresPreserved || !report.originalLootPreserved || !report.zoneAnchorsPreserved || protectedDelta > .001 || !report.roundTrip || report.spawns < 32) throw new Error('Island preservation failed');
