import type { DocBuilder } from './build';

/**
 * Basic furniture as editable parts (frames, cushions, tops, legs in their own materials),
 * sized to real furniture: a sofa seat at 45 cm, tables at 75 cm, counters at 90 cm, a double
 * bed 160 × 200 cm. Each piece is a group whose origin is the middle of its back edge on the
 * floor, facing +z — the generator stands it against a wall and turns it into the room.
 */
export const FURNITURE_KINDS = ['sofa', 'armchair', 'coffee_table', 'tv_cabinet', 'bookshelf', 'rug', 'counter', 'stove', 'fridge', 'sink_unit', 'dining_table', 'chair', 'sideboard', 'bed', 'nightstand', 'wardrobe', 'desk', 'toilet', 'basin', 'bathtub', 'cabinet', 'shelves', 'crate', 'table'] as const;
export type FurnitureKind = (typeof FURNITURE_KINDS)[number];

/** Footprint (width along the wall × depth out from it) and height, metres. */
export const FURNITURE_SIZE: Record<FurnitureKind, [number, number, number]> = {
  sofa: [2, .9, .85], armchair: [.9, .85, .85], coffee_table: [1.1, .6, .42], tv_cabinet: [1.6, .45, .55], bookshelf: [1, .35, 1.9], rug: [2.4, 1.7, .01],
  counter: [2.4, .62, .92], stove: [.6, .62, .92], fridge: [.7, .7, 1.8], sink_unit: [1, .62, .92],
  dining_table: [1.8, .9, .75], chair: [.45, .5, .9], sideboard: [1.4, .45, .85],
  bed: [1.6, 2.1, .55], nightstand: [.45, .4, .55], wardrobe: [1.2, .6, 2], desk: [1.2, .6, .75],
  toilet: [.4, .68, .8], basin: [.55, .45, .85], bathtub: [1.7, .75, .55],
  cabinet: [.8, .4, .9], shelves: [1.2, .45, 1.8], crate: [.6, .6, .6], table: [1.2, .8, .75],
};

export interface FurnitureMaterials { wood: string; fabric: string; metal: string; ceramic: string; top: string }

/** Builds a piece under `parent`; returns its group id. */
export function furniture(b: DocBuilder, kind: FurnitureKind, parent: string | null, m: FurnitureMaterials, at: { position: [number, number, number]; yaw: number; tilt?: number }): string {
  const [w, d, h] = FURNITURE_SIZE[kind];
  const g = b.group(label(kind), parent, { position: at.position, rotation: [at.tilt ?? 0, at.yaw, 0] }, { tags: ['furniture', kind] });
  const W = w / 2;
  const legs = (top: number, inset: number, size = .05, mat = m.wood) => {
    for (const [x, z] of [[-W + inset, inset], [W - inset, inset], [-W + inset, d - inset], [W - inset, d - inset]] as const)
      b.box('Chân', g, [x - size / 2, 0, z - size / 2], [x + size / 2, top, z + size / 2], mat);
  };
  switch (kind) {
    case 'sofa':
    case 'armchair': {
      b.box('Đế', g, [-W, .1, 0], [W, .42, d], m.fabric);
      b.box('Tựa lưng', g, [-W, .42, 0], [W, h, .22], m.fabric);
      b.box('Tay trái', g, [-W, .42, 0], [-W + .16, .66, d], m.fabric);
      b.box('Tay phải', g, [W - .16, .42, 0], [W, .66, d], m.fabric);
      const seats = kind === 'sofa' ? 3 : 1, sw = (w - .32) / seats;
      for (let i = 0; i < seats; i++) b.box('Đệm', g, [-W + .16 + i * sw + .01, .42, .22], [-W + .16 + (i + 1) * sw - .01, .52, d - .02], m.fabric);
      legs(.1, .06, .05);
      break;
    }
    case 'coffee_table': case 'dining_table': case 'table': case 'desk': {
      b.box('Mặt bàn', g, [-W, h - .04, 0], [W, h, d], m.wood);
      legs(h - .04, .07, .06);
      if (kind === 'desk') b.box('Ngăn kéo', g, [W - .45, h - .2, .02], [W - .05, h - .04, d - .02], m.wood);
      break;
    }
    case 'tv_cabinet': case 'sideboard': case 'cabinet': case 'nightstand': {
      b.box('Thân tủ', g, [-W, .08, 0], [W, h, d], m.wood);
      b.box('Đế', g, [-W + .03, 0, .03], [W - .03, .08, d - .03], m.wood, { collision: 'none' });
      if (kind === 'tv_cabinet') b.box('Màn hình', g, [-.55, h, .1], [.55, h + .65, .14], m.metal);
      break;
    }
    case 'bookshelf': case 'shelves': {
      b.box('Hông trái', g, [-W, 0, 0], [-W + .03, h, d], m.wood);
      b.box('Hông phải', g, [W - .03, 0, 0], [W, h, d], m.wood);
      b.box('Lưng', g, [-W, 0, 0], [W, h, .02], m.wood);
      for (let i = 0; i <= 4; i++) { const y = i * (h - .03) / 4; b.box('Đợt', g, [-W + .03, y, .02], [W - .03, y + .03, d], m.wood); }
      break;
    }
    case 'rug': b.box('Thảm', g, [-W, 0, 0], [W, .012, d], m.fabric, { collision: 'none' }); break;
    case 'counter': case 'sink_unit': {
      b.box('Tủ bếp', g, [-W, .1, 0], [W, h - .04, d - .02], m.wood);
      b.box('Chân tủ', g, [-W + .02, 0, 0], [W - .02, .1, d - .08], m.metal);
      b.box('Mặt đá', g, [-W, h - .04, 0], [W, h, d], m.top);
      if (kind === 'sink_unit') b.box('Chậu rửa', g, [-.3, h - .02, .12], [.3, h + .01, .5], m.metal);
      break;
    }
    case 'stove': {
      b.box('Thân bếp', g, [-W, 0, 0], [W, h - .02, d], m.ceramic);
      b.box('Mặt bếp', g, [-W, h - .02, 0], [W, h, d], m.metal);
      break;
    }
    case 'fridge': b.box('Tủ lạnh', g, [-W, 0, 0], [W, h, d], m.ceramic); b.box('Tay nắm', g, [W - .1, h * .55, d], [W - .07, h * .85, d + .03], m.metal); break;
    case 'chair': {
      b.box('Mặt ghế', g, [-W, .43, .05], [W, .47, d], m.wood);
      b.box('Tựa', g, [-W, .47, .05], [W, h, .09], m.wood);
      legs(.43, .04, .04);
      break;
    }
    case 'bed': {
      b.box('Khung giường', g, [-W, .1, 0], [W, .32, d], m.wood);
      b.box('Đầu giường', g, [-W, 0, 0], [W, 1, .06], m.wood);
      b.box('Nệm', g, [-W + .04, .32, .06], [W - .04, .52, d - .03], m.fabric);
      for (const s of [-1, 1]) b.box('Gối', g, [s < 0 ? -W + .12 : .08, .52, .12], [s < 0 ? -.08 : W - .12, .62, .5], m.fabric, { collision: 'none' });
      legs(.1, .05, .06);
      break;
    }
    case 'wardrobe': b.box('Tủ áo', g, [-W, 0, 0], [W, h, d], m.wood); b.box('Khe cửa', g, [-.01, .1, d], [.01, h - .1, d + .01], m.metal, { collision: 'none' }); break;
    case 'toilet': {
      b.box('Bệ', g, [-.18, 0, .25], [.18, .4, .65], m.ceramic);
      b.box('Két nước', g, [-W, .4, 0], [W, .8, .2], m.ceramic);
      break;
    }
    case 'basin': b.box('Chân', g, [-.1, 0, .1], [.1, .75, .3], m.ceramic); b.box('Chậu', g, [-W, .75, 0], [W, h, d], m.ceramic); break;
    case 'bathtub': {
      b.box('Thành bồn', g, [-W, 0, 0], [W, h, .06], m.ceramic); b.box('Thành bồn', g, [-W, 0, d - .06], [W, h, d], m.ceramic);
      b.box('Thành bồn', g, [-W, 0, .06], [-W + .06, h, d - .06], m.ceramic); b.box('Thành bồn', g, [W - .06, 0, .06], [W, h, d - .06], m.ceramic);
      b.box('Đáy bồn', g, [-W + .06, 0, .06], [W - .06, .1, d - .06], m.ceramic);
      break;
    }
    case 'crate': b.box('Thùng', g, [-W, 0, 0], [W, h, d], m.wood); break;
  }
  return g;
}

const LABEL: Record<FurnitureKind, string> = {
  sofa: 'Sofa', armchair: 'Ghế bành', coffee_table: 'Bàn trà', tv_cabinet: 'Kệ TV', bookshelf: 'Kệ sách', rug: 'Thảm', counter: 'Tủ bếp', stove: 'Bếp', fridge: 'Tủ lạnh', sink_unit: 'Bồn rửa',
  dining_table: 'Bàn ăn', chair: 'Ghế', sideboard: 'Tủ ly', bed: 'Giường', nightstand: 'Tủ đầu giường', wardrobe: 'Tủ quần áo', desk: 'Bàn học', toilet: 'Bồn cầu', basin: 'Lavabo',
  bathtub: 'Bồn tắm', cabinet: 'Tủ', shelves: 'Kệ', crate: 'Thùng gỗ', table: 'Bàn',
};
export const label = (k: FurnitureKind) => LABEL[k];
