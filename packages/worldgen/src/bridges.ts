import { BRIDGE_ASSET, CAMP_ASSET, VEHICLE_ASSET } from '@zion/assets';
import { CHUNK_SIZE, hash3, quantizeHeight, quantizeLocal, quantizeRotation, quantizeScale, type PropInstance } from '@zion/shared';
import { makeColumnSample, type WorldGenerator } from './generator';

export interface BridgeSpan {
  a: { x: number; z: number; y: number };
  b: { x: number; z: number; y: number };
  length: number;
  halfWidth: number;
  clearHalfWidth: number;
  kind: 'large' | 'wood' | 'stone' | 'asphalt';
  bay?: { side: number; start: number; end: number };
}

/** All decoration is kept outside the protected vehicle corridor. */
export function buildBridgeProps(gen: WorldGenerator, bridges: readonly BridgeSpan[], add: (x: number, y: number, z: number, asset: number, yaw?: number, scale?: number) => void): void {
  const sample = makeColumnSample();
  for (let index = 0; index < bridges.length; index++) {
    const bridge = bridges[index]!;
    const { a, b, length, halfWidth, kind } = bridge;
    const ux = (b.x - a.x) / length, uz = (b.z - a.z) / length, nx = -uz, nz = ux;
    // Local Z follows the road, local X spans its width. Quantized cardinal yaw is exact.
    const yaw = Math.atan2(ux, uz), large = kind === 'large', tile = large ? 4 : 2;
    const point = (along: number, across: number) => ({ x: a.x + ux * along + nx * across, z: a.z + uz * along + nz * across });
    const rows = Math.ceil(length / tile), columns = Math.round(halfWidth * 2 / tile);
    // The last row overlaps the previous one, never leaves a crack at the far abutment.
    for (let row = 0; row < rows; row++) {
      const along = Math.min((row + .5) * tile, length - tile / 2);
      for (let col = 0; col < columns; col++) {
        const across = -halfWidth + (col + .5) * tile, p = point(along, across);
        const roll = hash3(gen.seed, index, row * columns + col, 0xb71) % 10;
        const edge = Math.abs(across) > bridge.clearHalfWidth;
        const asset = kind === 'wood' ? BRIDGE_ASSET.woodenDeck : kind === 'stone' ? BRIDGE_ASSET.stoneDeck
          : large ? (edge && roll < 7 ? [BRIDGE_ASSET.moss, BRIDGE_ASSET.moss2, BRIDGE_ASSET.moss3][roll % 3]! : roll === 0 ? BRIDGE_ASSET.moss : BRIDGE_ASSET.asphalt)
          : edge && roll < 6 ? BRIDGE_ASSET.smallMoss : BRIDGE_ASSET.smallAsphalt;
        // A centimetre of overlap absorbs network position quantization at tile seams.
        add(p.x, a.y, p.z, asset, yaw, 1.006);
      }
      if (bridge.bay && along >= bridge.bay.start && along < bridge.bay.end) {
        for (const across of [10, 14]) {
          const p = point(along, across * bridge.bay.side);
          add(p.x, a.y, p.z, row % 3 ? BRIDGE_ASSET.moss3 : BRIDGE_ASSET.moss2, yaw, 1.006);
        }
      }
      if (large && row % 2 === 0) {
        const p = point(along, 0); add(p.x, a.y + .015, p.z, BRIDGE_ASSET.laneMark, yaw);
      }
    }
    const railStep = kind === 'wood' || kind === 'stone' ? 2 : 1.125;
    for (let along = railStep / 2; along < length; along += railStep) for (const side of [-1, 1]) {
      const inBay = bridge.bay && bridge.bay.side === side && along >= bridge.bay.start && along <= bridge.bay.end;
      const p = point(along, side * (halfWidth + (inBay ? 8 : 0) - .2));
      add(p.x, a.y, p.z, CAMP_ASSET[kind === 'wood' ? 'wooden-fence' : kind === 'stone' ? 'large-stone-brick-wall' : 'iron-fence'], yaw + Math.PI / 2, .5);
    }
    if (bridge.bay) {
      for (const along of [bridge.bay.start, bridge.bay.end]) for (let across = halfWidth + .5625; across < halfWidth + 8; across += 1.125) {
        const p = point(along, across * bridge.bay.side);
        add(p.x, a.y, p.z, CAMP_ASSET['iron-fence'], yaw, .5);
      }
      for (let along = bridge.bay.start + 4; along < bridge.bay.end; along += 20) {
        const p = point(along, bridge.bay.side * 14);
        gen.sampleColumn(p.x, p.z, sample);
        for (let y = a.y - 1.25 - 12; y > sample.height - 12; y -= 12) add(p.x, y, p.z, BRIDGE_ASSET.steelPier, yaw);
      }
    }
    // Supports descend to the natural bed; water and seabed are never replaced by a causeway.
    for (let along = large ? 8 : 3; along < length - 2; along += large ? 20 : 8) for (const side of [-1, 1]) {
      const p = point(along, side * (halfWidth - (large ? 1.5 : .65)));
      gen.sampleColumn(p.x, p.z, sample);
      const top = a.y - (large ? 1.25 : .6), bed = sample.height - .4;
      const unit = large ? 12 : 3;
      const count = Math.max(1, Math.ceil((top - bed) / unit));
      for (let layer = 0; layer < count; layer++) {
        const height = Math.min(unit, top - bed - layer * unit);
        if (height <= 0) continue;
        // Stack full modules from the deck down; the bottom may be buried in the bed.
        add(p.x, top - (layer + 1) * unit, p.z, large ? BRIDGE_ASSET.steelPier : BRIDGE_ASSET.stonePier, yaw);
      }
    }
    if (kind === 'wood') for (let along = 3; along < length - 1; along += 8) {
      const p = point(along, 0);
      add(p.x, a.y - .99, p.z, CAMP_ASSET['old-wooden-beam'], yaw, 2);
    }
    // Sparse refuges on the outer shoulder; the centre remains eight metres clear.
    if (large && length >= 64 && hash3(gen.seed, index, 0, 0xcab) % 3 !== 0) {
      const along = Math.floor(length * .5 / tile) * tile, side = bridge.bay?.side ?? (index % 2 ? -1 : 1);
      const across = bridge.bay ? 12 : 6;
      // Camp-sized tent; on a narrow shoulder it turns lengthwise and stays clear of the lane.
      let p = point(along - (bridge.bay ? 10 : 0), side * (bridge.bay ? across : 5.8));
      add(p.x, a.y, p.z, CAMP_ASSET['field-tent'], yaw + (bridge.bay ? 0 : Math.PI / 2), bridge.bay ? 1 : .9);
      p = point(along - (bridge.bay ? 3 : -7), side * across);
      add(p.x, a.y, p.z, CAMP_ASSET['military-wooden-crate'], yaw, 1);
      p = point(along - (bridge.bay ? 16 : 7), side * (across + .5));
      add(p.x, a.y, p.z, CAMP_ASSET['rusty-oil-barrel'], yaw);
      // A tank occupies a long shoulder bay rather than either traffic lane.
      if (bridge.bay) {
        p = point(along + 10, side * across);
        if (index % 2 === 0) add(p.x, a.y, p.z, CAMP_ASSET['old-rusty-tank'], yaw, .9); // 7.6 m wide: fills the 8 m bay.
        else add(p.x, a.y, p.z, VEHICLE_ASSET.bus, yaw + Math.PI / 2);
      } else if (length >= 80) {
        p = point(along + 15, -side * 6);
        add(p.x, a.y, p.z, VEHICLE_ASSET.car, yaw);
      }
      p = point(along - 10, -side * 6);
      add(p.x, a.y, p.z, VEHICLE_ASSET.motorcycle, yaw);
    }
  }
}

export function bridgeProp(x: number, y: number, z: number, asset: number, yaw = 0, scale = 1): { key: string; prop: PropInstance } {
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
  return { key: `${cx}:${cz}`, prop: { asset, lx: quantizeLocal(x - cx * CHUNK_SIZE), lz: quantizeLocal(z - cz * CHUNK_SIZE), yq: quantizeHeight(y), rot: quantizeRotation(yaw), scale: quantizeScale(scale) } };
}
