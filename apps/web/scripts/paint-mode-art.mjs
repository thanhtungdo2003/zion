// Paints the game-mode key art: node scripts/paint-mode-art.mjs <path to apps/web>
// Paints the three game-mode key arts (flat, layered silhouettes in the UI palette) to WebP.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const web = process.argv[2];
const req = createRequire(createRequire(`${web}/package.json`).resolve('next/package.json'));
const sharp = req('sharp');
const W = 1600, H = 1000;
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/* ----------------------------------------------------------------------------- shared bits */
function pine(x, base, h, fill) {
  const w = h * .34;
  let d = `M${x} ${base - h}`;
  for (let i = 0; i < 4; i++) { const y = base - h + (i + 1) * h * .22; const ww = w * (.35 + i * .22); d += ` L${x + ww} ${y} L${x + ww * .45} ${y}`; }
  d += ` L${x + w} ${base} L${x - w} ${base}`;
  for (let i = 3; i >= 0; i--) { const y = base - h + (i + 1) * h * .22; const ww = w * (.35 + i * .22); d += ` L${x - ww * .45} ${y} L${x - ww} ${y}`; }
  return `<path d="${d}Z" fill="${fill}"/>`;
}
function ridge(base, amp, step, fill, phase = 0) {
  let d = `M0 ${H}`;
  for (let x = 0; x <= W + step; x += step) d += ` L${x} ${base - Math.abs(Math.sin(x * .004 + phase)) * amp - Math.sin(x * .013 + phase * 2) * amp * .25}`;
  return `<path d="${d} L${W} ${H}Z" fill="${fill}"/>`;
}
/** Shambling figure: hunched, one arm out. `axe` raises a fire axe. */
function zombie(x, y, s, fill, axe = false, flip = 1) {
  const t = (px, py) => `${x + px * s * flip} ${y + py * s}`;
  let g = `<g fill="${fill}" stroke="${fill}" stroke-linecap="round" stroke-linejoin="round">`;
  g += `<circle cx="${x + 8 * s * flip}" cy="${y - 92 * s}" r="${9 * s}"/>`;
  g += `<path d="M${t(-6, -80)} L${t(12, -82)} L${t(10, -40)} L${t(-8, -42)}Z"/>`;
  g += `<path d="M${t(-4, -42)} L${t(-14, 0)} M${t(6, -42)} L${t(14, -2)}" stroke-width="${7 * s}" fill="none"/>`;
  if (axe) {
    g += `<path d="M${t(10, -76)} L${t(26, -100)} L${t(30, -126)}" stroke-width="${6 * s}" fill="none"/>`;
    g += `<path d="M${t(22, -150)} L${t(40, -98)}" stroke-width="${4 * s}" fill="none" stroke="#3b2a20"/>`;
    g += `<path d="M${t(20, -150)} L${t(4, -146)} Q${t(0, -132)} ${t(10, -124)} L${t(26, -134)}Z" fill="#9aa1a6" stroke="none"/>`;
  } else g += `<path d="M${t(10, -76)} L${t(36, -70)} L${t(48, -72)}" stroke-width="${6 * s}" fill="none"/>`;
  g += `<path d="M${t(-4, -76)} L${t(18, -62)} L${t(30, -60)}" stroke-width="${6 * s}" fill="none"/>`;
  return g + '</g>';
}
/** Standing soldier with a rifle at the ready. */
function soldier(x, y, s, fill) {
  const t = (px, py) => `${x + px * s} ${y + py * s}`;
  let g = `<g fill="${fill}" stroke="${fill}" stroke-linecap="round" stroke-linejoin="round">`;
  g += `<circle cx="${x}" cy="${y - 96 * s}" r="${9 * s}"/>`;
  g += `<path d="M${t(-9, -104)} Q${t(0, -114)} ${t(10, -104)}Z"/>`;
  g += `<path d="M${t(-11, -86)} L${t(11, -86)} L${t(9, -44)} L${t(-9, -44)}Z"/>`;
  g += `<path d="M${t(-6, -44)} L${t(-10, 0)} M${t(6, -44)} L${t(12, 0)}" stroke-width="${8 * s}" fill="none"/>`;
  g += `<path d="M${t(-8, -82)} L${t(-2, -62)} L${t(30, -70)} M${t(8, -82)} L${t(20, -68)}" stroke-width="${6 * s}" fill="none"/>`;
  g += `<path d="M${t(-12, -66)} L${t(58, -76)}" stroke-width="${5 * s}" fill="none"/>`;
  g += `<path d="M${t(10, -70)} L${t(14, -56)} L${t(20, -58)} L${t(18, -71)}Z"/>`;
  return g + '</g>';
}
function grain(opacity) {
  return `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 ${opacity} 0"/></filter><rect width="${W}" height="${H}" filter="url(#n)"/>`;
}

/* -------------------------------------------------------------------------------- infection */
function infection() {
  seed = 13;
  let s = `<defs><radialGradient id="moon" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ff4a3a"/><stop offset=".55" stop-color="#c0161c"/><stop offset="1" stop-color="#c0161c" stop-opacity="0"/></radialGradient>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07070a"/><stop offset=".65" stop-color="#2a0709"/><stop offset="1" stop-color="#4a0c0c"/></linearGradient>
  <radialGradient id="lamp" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffb000" stop-opacity=".45"/><stop offset="1" stop-color="#ffb000" stop-opacity="0"/></radialGradient><linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a1414" stop-opacity="0"/><stop offset="1" stop-color="#a51b1b" stop-opacity=".55"/></linearGradient></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  for (let i = 0; i < 90; i++) s += `<circle cx="${rnd() * W}" cy="${rnd() * 420}" r="${rnd() * 1.6 + .3}" fill="#f3d6cf" opacity="${.25 + rnd() * .5}"/>`;
  s += `<circle cx="1080" cy="300" r="330" fill="url(#moon)" opacity=".55"/><circle cx="1080" cy="300" r="170" fill="#d42a22"/><circle cx="1036" cy="262" r="38" fill="#b31c18" opacity=".7"/><circle cx="1130" cy="340" r="26" fill="#b31c18" opacity=".6"/><circle cx="1110" cy="236" r="16" fill="#b31c18" opacity=".6"/>`;
  // bats
  for (let i = 0; i < 9; i++) { const x = 820 + rnd() * 600, y = 120 + rnd() * 260, k = .6 + rnd() * .8; s += `<path d="M${x} ${y} q${8 * k} ${-10 * k} ${18 * k} ${-2 * k} q${-4 * k} ${6 * k} ${4 * k} ${9 * k} q${-14 * k} ${-6 * k} ${-22 * k} ${-7 * k} q${-8 * k} ${1 * k} ${-22 * k} ${7 * k} q${8 * k} ${-3 * k} ${4 * k} ${-9 * k} q${10 * k} ${-8 * k} ${18 * k} ${2 * k}Z" fill="#0b0506"/>`; }
  // far town: apartment block, chapel and bell tower, water tower
  const far = '#16080a';
  s += `<path d="M80 640 V430 H420 V640Z" fill="${far}"/>`;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) if (rnd() < .28) s += `<rect x="${102 + c * 40}" y="${452 + r * 36}" width="18" height="14" fill="${rnd() < .5 ? '#ffb000' : '#ff6a3a'}" opacity="${.5 + rnd() * .4}"/>`;
  s += `<path d="M430 640 V520 L520 470 L610 520 V640Z" fill="${far}"/><path d="M620 640 V380 L650 340 L680 380 V640Z" fill="${far}"/><path d="M640 360 h20 v-26 h-20Z" fill="#2a0c0d"/><path d="M650 300 v40 M638 314 h24" stroke="${far}" stroke-width="7"/>`;
  s += `<path d="M1300 640 V560 H1316 V500 H1384 V560 H1400 V640Z" fill="${far}"/><path d="M1290 500 H1410 V440 H1290Z" fill="${far}"/><path d="M1300 640 L1350 500 L1400 640" stroke="${far}" stroke-width="6" fill="none"/>`;
  // containers
  for (const [x, y, c] of [[1440, 590, '#1d0a0b'], [1500, 590, '#220b0c'], [1460, 560, '#1a090a']]) s += `<rect x="${x}" y="${y}" width="120" height="50" fill="${c}"/>`;
  s += ridge(700, 26, 40, '#1b0708', 1.3);
  // perimeter wall with lamp posts
  s += `<rect x="0" y="640" width="${W}" height="70" fill="#120607"/>`;
  for (let x = 0; x < W; x += 140) s += `<rect x="${x}" y="634" width="128" height="8" fill="#1c0909"/>`;
  for (const x of [240, 760, 1240]) s += `<path d="M${x} 760 V560 h34" stroke="#0a0405" stroke-width="7" fill="none"/><circle cx="${x + 34}" cy="566" r="9" fill="#ffd27a"/><circle cx="${x + 34}" cy="566" r="90" fill="url(#lamp)"/>`;
  // graveyard
  for (let i = 0; i < 16; i++) {
    const x = 60 + i * 52 + rnd() * 16, y = 780 + rnd() * 30, k = .7 + rnd() * .5;
    s += i % 4 === 0 ? `<path d="M${x} ${y} v${-54 * k} M${x - 16 * k} ${y - 40 * k} h${32 * k}" stroke="#0d0506" stroke-width="${8 * k}"/>` : `<path d="M${x - 14 * k} ${y} v${-30 * k} a${14 * k} ${14 * k} 0 0 1 ${28 * k} 0 v${30 * k}Z" fill="#0d0506" transform="rotate(${(rnd() - .5) * 14} ${x} ${y})"/>`;
  }
  // crashed helicopter wreck in the plaza
  s += `<g fill="#0c0405"><path d="M900 820 q20 -70 120 -70 h120 l40 30 h60 l10 -20 h20 l-10 60 h-60 q-20 30 -80 30 h-200Z"/><path d="M960 752 l-160 -40 M1000 750 l200 -70" stroke="#0c0405" stroke-width="9"/><rect x="920" y="830" width="230" height="8"/></g>`;
  s += `<rect x="0" y="560" width="${W}" height="440" fill="url(#fog)"/>`;
  // ground
  s += `<path d="M0 860 Q400 830 800 850 T1600 840 V1000 H0Z" fill="#090304"/>`;
  // horde with axes, one human holding the line
  const horde = [[1020, 905, 1.25, true, -1], [1180, 925, 1.5, true, -1], [1330, 900, 1.15, false, -1], [1440, 935, 1.65, true, -1], [880, 900, .95, false, -1], [1530, 890, .9, false, -1]];
  for (const [x, y, k, axe, f] of horde) s += zombie(x, y, k, '#050203', axe, f);
  for (const [x, y, k] of [[1180, 925, 1.5], [1440, 935, 1.65], [1020, 905, 1.25]]) s += `<circle cx="${x - 6 * k}" cy="${y - 94 * k}" r="${2.2 * k}" fill="#ff2d2d"/>`;
  s += soldier(430, 960, 2.3, '#040203');
  // muzzle flash
  s += `<path d="M566 784 l60 -14 l-42 22 l52 6 l-56 4 l30 26 l-44 -24Z" fill="#ffd27a"/><circle cx="566" cy="786" r="70" fill="url(#lamp)"/>`;
  s += grain(.08);
  return s;
}

/* -------------------------------------------------------------------------------- survival */
function survival() {
  seed = 3;
  let s = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121a1c"/><stop offset=".6" stop-color="#3b3a2e"/><stop offset="1" stop-color="#8a5a2c"/></linearGradient>
  <radialGradient id="fire" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffb000" stop-opacity=".55"/><stop offset="1" stop-color="#ffb000" stop-opacity="0"/></radialGradient></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  s += `<circle cx="1180" cy="520" r="110" fill="#e9b65a" opacity=".85"/>`;
  s += ridge(560, 90, 30, '#2c3029', .4) + ridge(640, 70, 30, '#202620', 2.1);
  for (let i = 0; i < 40; i++) s += pine(rnd() * W, 690 + rnd() * 20, 120 + rnd() * 120, '#18201b');
  // watchtower and camp wall
  s += `<g fill="#0f1411"><path d="M260 760 L290 470 h12 L290 760Z M380 760 L350 470 h12 L392 760Z"/><rect x="262" y="440" width="128" height="40"/><path d="M252 440 L326 392 L400 440Z"/><path d="M276 600 L376 520 M276 520 L376 600" stroke="#0f1411" stroke-width="7"/></g>`;
  for (let x = 0; x < 760; x += 30) s += `<path d="M${x} 790 v-80 l14 -14 l14 14 v80Z" fill="#141b16"/>`;
  s += ridge(780, 26, 40, '#11160f', 3.2);
  for (let i = 0; i < 26; i++) s += pine(rnd() * W, 830 + rnd() * 40, 200 + rnd() * 160, '#0b100c');
  // tent, fire, survivor
  s += `<path d="M720 900 L860 720 L1000 900Z" fill="#2d2c22"/><path d="M860 720 V900" stroke="#11140f" stroke-width="6"/><path d="M820 900 L860 800 L900 900Z" fill="#11140f"/>`;
  s += `<circle cx="1110" cy="880" r="200" fill="url(#fire)"/><path d="M1080 905 q10 -60 30 -90 q4 40 24 60 q6 -24 0 -40 q30 30 18 70Z" fill="#ffb000"/><path d="M1096 905 q8 -30 16 -46 q6 24 16 30 q4 -10 2 -20 q14 18 6 36Z" fill="#ffe08a"/><path d="M1060 910 l100 -14 M1066 896 l96 16" stroke="#3a2a1c" stroke-width="9"/>`;
  s += soldier(1260, 960, 2.1, '#070a08');
  s += zombie(1500, 900, 1.2, '#0b100c', false, -1) + zombie(140, 930, 1.4, '#070a08', false, 1);
  s += `<path d="M0 940 Q600 900 1600 930 V1000 H0Z" fill="#060806"/>`;
  s += grain(.07);
  return s;
}

/* --------------------------------------------------------------------------- battle royale */
function battle() {
  seed = 21;
  let s = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d5874"/><stop offset=".7" stop-color="#9cb6b8"/><stop offset="1" stop-color="#d9c9a0"/></linearGradient></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  for (let i = 0; i < 7; i++) { const x = rnd() * W, y = 120 + rnd() * 260, w = 160 + rnd() * 220; s += `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${w * .16}" fill="#e8eef0" opacity=".55"/>`; }
  // island seen from the plane: sea, coast, hills, roads
  s += `<rect y="600" width="${W}" height="400" fill="#2c6f7e"/>`;
  s += `<path d="M120 1000 Q160 760 420 700 Q700 640 980 690 Q1300 650 1520 760 Q1600 840 1600 1000Z" fill="#d9c58f"/>`;
  s += `<path d="M150 1000 Q200 790 440 730 Q700 672 980 716 Q1290 690 1500 790 Q1580 860 1580 1000Z" fill="#5d7a41"/>`;
  s += `<path d="M300 1000 Q420 800 700 780 Q980 760 1240 840 Q1380 900 1420 1000Z" fill="#4b6936"/>`;
  s += `<path d="M380 1000 Q600 860 820 860 T1300 960" stroke="#b9ad8d" stroke-width="8" fill="none"/>`;
  for (let i = 0; i < 18; i++) { const x = 560 + rnd() * 520, y = 820 + rnd() * 120; s += `<rect x="${x}" y="${y}" width="${14 + rnd() * 18}" height="${10 + rnd() * 10}" fill="#d7d2c4"/>`; }
  // red zone ring
  s += `<ellipse cx="860" cy="880" rx="560" ry="170" fill="none" stroke="#ff263d" stroke-width="7" opacity=".9"/><ellipse cx="900" cy="900" rx="260" ry="80" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="22 14" opacity=".85"/>`;
  // transport plane
  s += `<g fill="#3a4246"><path d="M180 250 L760 170 L790 196 L210 290Z"/><path d="M420 220 L540 70 L590 72 L500 214Z M450 270 L560 380 L612 378 L520 262Z"/><path d="M700 178 L760 110 L784 112 L760 186Z"/><circle cx="240" cy="270" r="6" fill="#1b2023"/></g>`;
  // parachutes
  for (const [x, y, k, c] of [[1040, 260, 1.4, '#db293e'], [1260, 380, 1, '#ffb000'], [1380, 200, .8, '#db293e'], [900, 470, .7, '#e8e4da']]) {
    s += `<path d="M${x - 70 * k} ${y} Q${x} ${y - 70 * k} ${x + 70 * k} ${y} Q${x} ${y - 18 * k} ${x - 70 * k} ${y}Z" fill="${c}"/>`;
    s += `<path d="M${x - 66 * k} ${y} L${x} ${y + 90 * k} M${x + 66 * k} ${y} L${x} ${y + 90 * k} M${x} ${y - 10 * k} L${x} ${y + 90 * k}" stroke="#262626" stroke-width="${1.5 * k}"/>`;
    s += `<circle cx="${x}" cy="${y + 96 * k}" r="${7 * k}" fill="#1c1c1c"/><path d="M${x - 6 * k} ${y + 104 * k} h${12 * k} l${3 * k} ${26 * k} h${-18 * k}Z" fill="#1c1c1c"/>`;
  }
  s += grain(.05);
  return s;
}

const out = `${web}/public/images/modes`;
mkdirSync(out, { recursive: true });
for (const [name, body] of [['infection', infection()], ['survival', survival()], ['battle-royale', battle()]]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  await sharp(Buffer.from(svg)).webp({ quality: 82 }).toFile(`${out}/${name}.webp`);
  console.log(name);
}
