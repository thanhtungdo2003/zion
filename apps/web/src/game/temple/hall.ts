import {
  BoxGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, MeshStandardMaterial,
  type Object3D, PlaneGeometry, PointLight, RepeatWrapping, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2,
} from 'three';
import { HALL } from './simulation';

/**
 * Chánh Điện, built from primitives: a small hall (14 × 18 m) so it stays light on phones.
 * Altar towards −Z on a stepped dais, a seated statue on a lotus throne (a stand-in until the
 * real model is added: `replaceStatue`), red lacquered pillars with gold bands, a long offering
 * table with incense burner, candles and fruit, rows of cushions, lanterns. Seen from above and
 * from the door end, as the An Nhiên hall is.
 */
export interface Hall {
  root: Group;
  /** Where lotus lamps are set (world x, y, z), filled from the middle outwards. */
  lampSlots: Array<[number, number, number]>;
  /** Tip of the incense burner (smoke rises from here). */
  incense: [number, number, number];
  /** Flickering lights (candles, lanterns) and their base intensity. */
  flicker: Array<{ light: PointLight; base: number }>;
  statue: Group;
}

const mat = (color: number | string, roughness = .6, metalness = 0, extra: Partial<MeshStandardMaterial> = {}) => Object.assign(new MeshStandardMaterial({ color, roughness, metalness }), extra);
const GOLD = mat(0xd4a24a, .28, .95);
const GOLD_DARK = mat(0xa8792e, .35, .9);
const LACQUER = mat(0x8e1b1b, .38, .05);
const LACQUER_DARK = mat(0x5e1010, .45, .05);
const WOOD = mat(0x5a3720, .55);
const STONE = mat(0xb9b2a4, .8);
const CREAM = mat(0xe9dcc2, .85);

function box(w: number, h: number, d: number, m: MeshStandardMaterial, x: number, y: number, z: number, parent: Object3D, shadow = true): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), m); mesh.position.set(x, y, z);
  mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function cyl(rt: number, rb: number, h: number, m: MeshStandardMaterial, x: number, y: number, z: number, parent: Object3D, seg = 20): Mesh {
  const mesh = new Mesh(new CylinderGeometry(rt, rb, h, seg), m); mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

/** Polished floor: large warm tiles with thin joints and a little variation. */
function floorTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 0.9 + ((x * 7 + y * 13) % 5) * .03;
    g.fillStyle = `rgb(${Math.round(150 * v)},${Math.round(92 * v)},${Math.round(60 * v)})`; g.fillRect(x * 128, y * 128, 128, 128);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(60,30,15,${.04 + (i % 3) * .02})`; g.fillRect(x * 128 + ((i * 37) % 128), y * 128 + ((i * 53) % 128), 18, 2); }
  }
  g.strokeStyle = 'rgba(40,20,10,.65)'; g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke(); }
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(HALL.width / 4, HALL.depth / 4); t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** Back wall: deep red with a gold lattice of lotus roundels. */
function wallTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6e1414'; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = 'rgba(214,162,74,.55)'; g.lineWidth = 2;
  for (let x = 32; x < 512; x += 64) for (let y = 32; y < 256; y += 64) {
    g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; g.beginPath(); g.ellipse(x + Math.cos(a) * 10, y + Math.sin(a) * 10, 6, 3, a, 0, Math.PI * 2); g.stroke(); }
  }
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(3, 1.5); t.colorSpace = SRGBColorSpace;
  return t;
}

/** A ring of lotus petals (lathe petals rotated round the axis). */
function lotusRing(radius: number, petals: number, size: number, m: MeshStandardMaterial, tilt: number): Group {
  const g = new Group();
  const profile = [new Vector2(0, 0), new Vector2(size * .45, size * .25), new Vector2(size * .5, size * .6), new Vector2(size * .3, size * .9), new Vector2(0, size)];
  const geo = new LatheGeometry(profile, 8);
  for (let i = 0; i < petals; i++) {
    const a = i / petals * Math.PI * 2, petal = new Mesh(geo, m);
    petal.scale.set(1, 1, .35); petal.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    petal.rotation.set(0, -a + Math.PI / 2, 0); petal.rotateX(-tilt); petal.castShadow = true; g.add(petal);
  }
  return g;
}

/** The stand-in statue: a seated figure in meditation on a lotus throne, about 3.4 m high. */
export function buildStatue(): Group {
  const s = new Group();
  const skin = mat(0xd9a640, .3, .9), robe = mat(0xc28a2c, .38, .85), hair = mat(0x6b4a1c, .5, .6);
  // Throne: octagonal plinth, then a double lotus.
  cyl(1.35, 1.5, .45, LACQUER_DARK, 0, .225, 0, s, 8);
  cyl(1.25, 1.35, .08, GOLD, 0, .49, 0, s, 8);
  const lotusDown = lotusRing(1.05, 16, .45, GOLD_DARK, 2.3); lotusDown.position.y = .95; s.add(lotusDown);
  const lotusUp = lotusRing(1.05, 16, .5, GOLD, .55); lotusUp.position.y = .78; s.add(lotusUp);
  cyl(1.05, .9, .25, GOLD_DARK, 0, .82, 0, s, 24);
  // Crossed legs: a wide flattened ring of robe with the knees forward.
  const legs = new Mesh(new SphereGeometry(1, 28, 16), robe); legs.scale.set(1.05, .32, .72); legs.position.set(0, 1.18, .12); legs.castShadow = true; s.add(legs);
  for (const side of [-1, 1]) { const knee = new Mesh(new SphereGeometry(.3, 16, 12), robe); knee.scale.set(1.2, .7, 1); knee.position.set(side * .72, 1.18, .42); s.add(knee); }
  // Torso and robe (one shoulder bare), slightly tapered.
  const torso = new Mesh(new LatheGeometry([new Vector2(0, 0), new Vector2(.62, 0), new Vector2(.66, .35), new Vector2(.6, .75), new Vector2(.5, 1.0), new Vector2(.22, 1.12), new Vector2(0, 1.14)], 28), robe);
  torso.scale.set(1, 1, .72); torso.position.y = 1.25; torso.castShadow = true; s.add(torso);
  const chest = new Mesh(new SphereGeometry(.42, 20, 14), skin); chest.scale.set(.8, .9, .55); chest.position.set(.18, 2.0, .16); s.add(chest);
  const drape = new Mesh(new TorusGeometry(.55, .07, 8, 24, Math.PI), robe); drape.position.set(-.05, 1.95, .2); drape.rotation.set(0, 0, -2.3); s.add(drape);
  // Arms down to the hands resting in the lap (meditation), right palm over left.
  for (const side of [-1, 1]) {
    const upper = new Mesh(new CylinderGeometry(.16, .19, .7, 12), side < 0 ? robe : skin); upper.position.set(side * .62, 1.95, .05); upper.rotation.z = side * .22; s.add(upper);
    const fore = new Mesh(new CylinderGeometry(.13, .16, .62, 12), side < 0 ? robe : skin); fore.position.set(side * .4, 1.52, .42); fore.rotation.set(1.2, 0, side * -.9); s.add(fore);
  }
  const hands = new Mesh(new SphereGeometry(.22, 16, 10), skin); hands.scale.set(1.4, .45, .9); hands.position.set(0, 1.42, .56); s.add(hands);
  // Neck, head, ears, the hair curls and the crown knot.
  cyl(.15, .17, .2, skin, 0, 2.42, .02, s, 14);
  const head = new Mesh(new SphereGeometry(.34, 28, 20), skin); head.scale.set(.92, 1.08, .95); head.position.set(0, 2.78, .04); head.castShadow = true; s.add(head);
  for (const side of [-1, 1]) { const ear = new Mesh(new SphereGeometry(.09, 10, 8), skin); ear.scale.set(.5, 1.8, .8); ear.position.set(side * .32, 2.68, .02); s.add(ear); }
  const cap = new Mesh(new SphereGeometry(.35, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.1), hair); cap.position.set(0, 2.84, .02); cap.scale.set(.96, 1, .98); s.add(cap);
  for (let i = 0; i < 40; i++) {
    const a = i * 2.39996, r = .3 * Math.sqrt((i + .5) / 40), curl = new Mesh(new SphereGeometry(.045, 6, 5), hair);
    curl.position.set(Math.cos(a) * r, 2.84 + Math.sqrt(Math.max(0, .12 - r * r)) * .9 + .08, .02 + Math.sin(a) * r); s.add(curl);
  }
  const knot = new Mesh(new SphereGeometry(.15, 14, 10), hair); knot.position.set(0, 3.2, .02); s.add(knot);
  const jewel = new Mesh(new ConeGeometry(.06, .16, 10), mat(0xffc85a, .2, .6, { emissive: new Color(0xffa020), emissiveIntensity: .6 })); jewel.position.set(0, 3.36, .02); s.add(jewel);
  // Face hints: closed eyes and the mark between the brows.
  for (const side of [-1, 1]) { const lid = new Mesh(new TorusGeometry(.055, .012, 4, 10, Math.PI), hair); lid.position.set(side * .11, 2.8, .35); lid.rotation.z = Math.PI; s.add(lid); }
  const urna = new Mesh(new SphereGeometry(.018, 6, 5), mat(0xffffff, .2)); urna.position.set(0, 2.9, .36); s.add(urna);
  // Halo: a gold ring with a soft glowing disc and flame tips behind the head.
  const glow = new Mesh(new CircleGeometry(.95, 48), mat(0xffd27a, .6, 0, { emissive: new Color(0xffb84a), emissiveIntensity: .55, transparent: true, opacity: .55, side: DoubleSide })); glow.position.set(0, 2.85, -.42); s.add(glow);
  const ring = new Mesh(new TorusGeometry(.98, .05, 8, 64), GOLD); ring.position.set(0, 2.85, -.4); s.add(ring);
  for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, f = new Mesh(new ConeGeometry(.07, .26, 6), GOLD); f.position.set(Math.cos(a) * 1.1, 2.85 + Math.sin(a) * 1.1, -.4); f.rotation.z = a - Math.PI / 2; s.add(f); }
  return s;
}

export function buildHall(): Hall {
  const root = new Group(), W = HALL.width, D = HALL.depth, back = -D / 2;
  // Floor and the red runner up the aisle.
  const floor = new Mesh(new PlaneGeometry(W, D), mat(0xffffff, .32, .05, { map: floorTexture() })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; root.add(floor);
  const runner = new Mesh(new PlaneGeometry(1.6, D - 5), mat(0x9a1f1f, .9)); runner.rotation.x = -Math.PI / 2; runner.position.set(0, .005, 2.2); runner.receiveShadow = true; root.add(runner);
  for (const side of [-1, 1]) { const edge = new Mesh(new PlaneGeometry(.08, D - 5), GOLD_DARK); edge.rotation.x = -Math.PI / 2; edge.position.set(side * .78, .007, 2.2); root.add(edge); }
  // Walls: back (patterned red with a gold frieze), sides (cream above a red dado), low front sill.
  const backWall = new Mesh(new PlaneGeometry(W, 7), mat(0xffffff, .7, 0, { map: wallTexture() })); backWall.position.set(0, 3.5, back); backWall.receiveShadow = true; root.add(backWall);
  box(W, .25, .2, GOLD, 0, 6.2, back + .1, root, false);
  for (const side of [-1, 1]) {
    const wall = new Mesh(new PlaneGeometry(D, 7), CREAM); wall.position.set(side * W / 2, 3.5, 0); wall.rotation.y = -side * Math.PI / 2; wall.receiveShadow = true; root.add(wall);
    box(.12, 1.1, D, LACQUER, side * (W / 2 - .06), .55, 0, root, false);
    box(.14, .06, D, GOLD_DARK, side * (W / 2 - .07), 1.12, 0, root, false);
    // Tall lattice windows with warm light behind.
    for (const z of [-3.5, 1, 5.5]) {
      box(.08, 2.4, 1.6, mat(0xffe2a8, .9, 0, { emissive: new Color(0xffc070), emissiveIntensity: .45 }), side * (W / 2 - .05), 3.2, z, root, false);
      for (let k = -2; k <= 2; k++) box(.1, 2.4, .05, WOOD, side * (W / 2 - .09), 3.2, z + k * .36, root, false);
      for (let k = -2; k <= 2; k++) box(.1, .05, 1.6, WOOD, side * (W / 2 - .09), 3.2 + k * .5, z, root, false);
    }
  }
  box(W, .35, .3, STONE, 0, .175, D / 2 - .15, root);
  // Pillars: two rows, lacquered, gold bands, stone bases; beams across the top.
  for (const x of [-5.2, 5.2]) for (const z of [-6.4, -2.6, 1.2, 5]) {
    cyl(.38, .42, .3, STONE, x, .15, z, root, 16);
    cyl(.27, .29, 6.4, LACQUER, x, 3.5, z, root, 20);
    for (const y of [.6, 5.9]) cyl(.3, .3, .12, GOLD, x, y, z, root, 20);
  }
  for (const z of [-6.4, -2.6, 1.2, 5]) box(10.8, .3, .32, LACQUER_DARK, 0, 6.6, z, root, false);
  // Dais: three steps up to the statue, gold edged.
  for (let i = 0; i < 3; i++) {
    const h = .2 * (i + 1), depth = 3.8 - i * .45, z = back + depth / 2;
    box(9 - i * 1.2, h, depth, i === 2 ? LACQUER_DARK : WOOD, 0, h / 2, z, root);
    box(9 - i * 1.2, .03, .04, GOLD, 0, h, back + depth, root, false);
  }
  const statue = buildStatue(); statue.scale.setScalar(.9); statue.position.set(0, .6, back + 1.45); root.add(statue);
  // Banners either side of the statue.
  for (const side of [-1, 1]) {
    box(.9, 3.4, .04, mat(0xc9a14a, .7), side * 2.6, 3.4, back + .1, root, false);
    box(.75, 3.2, .05, mat(0xa31d1d, .75), side * 2.6, 3.4, back + .13, root, false);
    for (let k = 0; k < 5; k++) box(.32, .32, .02, mat(0xe8c26a, .5, .4), side * 2.6, 4.6 - k * .6, back + .17, root, false);
  }
  // Long offering table in front of the dais.
  const tz = HALL.altar.z - .6, tableTop = .9;
  box(4.4, .08, .8, LACQUER, 0, tableTop, tz, root);
  box(4.5, .04, .9, GOLD, 0, tableTop - .06, tz, root, false);
  box(4.2, .82, .7, LACQUER_DARK, 0, .43, tz, root);
  box(4.0, .5, .02, GOLD_DARK, 0, .5, tz + .36, root, false);
  // Bronze incense burner (centre), candles, fruit plates and flower vases.
  const bronze = mat(0x7a5a32, .4, .85);
  cyl(.24, .18, .26, bronze, 0, tableTop + .17, tz, root, 18);
  cyl(.27, .27, .03, bronze, 0, tableTop + .31, tz, root, 18);
  for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; cyl(.025, .02, .1, bronze, Math.cos(a) * .15, tableTop + .05, tz + Math.sin(a) * .15, root, 6); }
  for (let k = -1; k <= 1; k++) cyl(.006, .006, .3, mat(0x8a2a1a, .8), k * .05, tableTop + .45, tz, root, 4);
  const flicker: Hall['flicker'] = [];
  for (const side of [-1, 1]) {
    cyl(.05, .07, .32, GOLD_DARK, side * 1.85, tableTop + .2, tz, root, 12);
    const candle = cyl(.035, .035, .16, mat(0xf2e6c8, .7), side * 1.85, tableTop + .44, tz, root, 10);
    const flame = new Mesh(new ConeGeometry(.025, .08, 8), mat(0xffd27a, 1, 0, { emissive: new Color(0xffa83a), emissiveIntensity: 3 })); flame.position.set(0, .12, 0); candle.add(flame);
    const light = new PointLight(0xffb060, 1.6, 6, 1.6); light.position.set(side * 1.85, tableTop + .7, tz + .1); root.add(light); flicker.push({ light, base: 1.6 });
    // Fruit plate and a vase of lotus buds.
    cyl(.2, .14, .04, GOLD, side * 1.2, tableTop + .06, tz - .1, root, 16);
    for (let f = 0; f < 5; f++) { const fruit = new Mesh(new SphereGeometry(.07, 10, 8), mat([0xe8a23a, 0xd8422a, 0x9ac040][f % 3]!, .6)); fruit.position.set(side * 1.2 + Math.cos(f * 1.3) * .08, tableTop + .14 + (f === 4 ? .08 : 0), tz - .1 + Math.sin(f * 1.3) * .08); root.add(fruit); }
    cyl(.07, .1, .32, mat(0x3a6a8a, .3, .2), side * .6, tableTop + .2, tz - .15, root, 14);
    for (let f = 0; f < 3; f++) { const stem = cyl(.006, .006, .5, mat(0x3a6a2a, .8), side * .6 + (f - 1) * .04, tableTop + .55, tz - .15, root, 4); stem.rotation.z = (f - 1) * .2; const bud = new Mesh(new SphereGeometry(.05, 8, 8), mat(0xf2a6c0, .6)); bud.scale.y = 1.5; bud.position.y = .28; stem.add(bud); }
  }
  // Kneeling cushion at the offering place, cushions for every seat.
  const cushion = new Mesh(new CylinderGeometry(.34, .36, .1, 20), mat(0xc9a14a, .9)); cushion.position.set(HALL.altar.x, .05, HALL.altar.z); cushion.receiveShadow = true; root.add(cushion);
  for (const s of HALL.seats) { const c = new Mesh(new CylinderGeometry(.28, .3, .08, 16), mat(0xb8862e, .95)); c.position.set(s.x, .04, s.z); c.receiveShadow = true; root.add(c); }
  // Red lanterns hanging between the pillars (two of them carry a light).
  for (const [x, z, lit] of [[-5.2, -4.5, true], [5.2, -4.5, true], [-5.2, 3.1, false], [5.2, 3.1, false]] as const) {
    cyl(.01, .01, 1.4, mat(0x2a1a10, .8), x, 5.3, z, root, 4);
    const body = new Mesh(new SphereGeometry(.32, 16, 12), mat(0xd8342f, .6, 0, { emissive: new Color(0xff5a2a), emissiveIntensity: .7 })); body.scale.y = .85; body.position.set(x, 4.4, z); root.add(body);
    cyl(.18, .18, .06, GOLD, x, 4.7, z, root, 12); cyl(.18, .18, .06, GOLD, x, 4.1, z, root, 12);
    if (lit) { const l = new PointLight(0xff8a50, 2.2, 9, 1.8); l.position.set(x, 4.2, z); root.add(l); flicker.push({ light: l, base: 2.2 }); }
  }
  const lampSlots: Hall['lampSlots'] = [-.5, .5, -1, 1, -1.45, 1.45, -.25, .25, -.75, .75, -1.25, 1.25].map((x) => [x, tableTop + .04, tz + (Math.abs(x) % .5 === .25 ? .22 : .2)]);
  return { root, lampSlots, incense: [0, tableTop + .62, tz], flicker, statue };
}

/** A lotus lamp: pink petals round a small glowing candle. */
export function lotusLamp(tint: number): Group {
  const g = new Group();
  const ring = lotusRing(.035, 8, .07, mat(tint, .6), .5); g.add(ring);
  const ring2 = lotusRing(.02, 6, .06, mat(new Color(tint).lerp(new Color(0xffffff), .4).getHex(), .6), .2); g.add(ring2);
  const flame = new Mesh(new SphereGeometry(.014, 6, 6), mat(0xffe0a0, 1, 0, { emissive: new Color(0xffb050), emissiveIntensity: 3 })); flame.position.y = .06; g.add(flame);
  return g;
}
