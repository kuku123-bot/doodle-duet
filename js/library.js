// Built-in inspiration pictures: original line drawings made for this app (clean outlines + soft colours, easy to copy
// or trace), step-by-step lessons, and big emoji (drawn by the device's own emoji font). Your own photos are added in
// the Ideas rail and stay on your device until you share one.
import { loadImage, makeCanvas } from './util.js';

const INK = '#3b3346';
const wrap = (body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg || '#fffdf8'}"/><g fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
const S = (d, fill) => `<path d="${d}"${fill ? ` fill="${fill}"` : ''}/>`;
const C = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}"${fill ? ` fill="${fill}"` : ''}/>`;
const E = (cx, cy, rx, ry, fill) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${fill ? ` fill="${fill}"` : ''}/>`;
const dot = (cx, cy, r = 5) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${INK}" stroke="none"/>`;
const blush = (cx, cy) => `<ellipse cx="${cx}" cy="${cy}" rx="9" ry="5" fill="#ffb3c4" stroke="none" opacity=".8"/>`;
const guide = (d) => `<path d="${d}" stroke="#7aa7ff" stroke-width="2.5" stroke-dasharray="6 6"/>`;
const label = (x, y, t, size = 16) => `<text x="${x}" y="${y}" font-family="ui-rounded, system-ui, sans-serif" font-size="${size}" font-weight="700" fill="${INK}" stroke="none" text-anchor="middle">${t}</text>`;

const ART = [
  // ---------------------------------------------------------------- animals
  { id: 'cat', name: 'Cat face', cat: 'Animals', svg: wrap(
    S('M48 82 L56 36 L86 62 Q100 58 114 62 L144 36 L152 82 Q166 104 158 130 Q146 166 100 168 Q54 166 42 130 Q34 104 48 82Z', '#ffd9a8') +
    S('M60 52 L64 72 L76 64Z', '#ffb3c4') + S('M140 52 L136 72 L124 64Z', '#ffb3c4') +
    dot(78, 112, 7) + dot(122, 112, 7) + S('M94 126 L106 126 L100 133Z', '#ff8fab') + S('M100 133 Q100 142 90 144 M100 133 Q100 142 110 144') +
    S('M40 120 L70 124 M40 136 L70 132 M160 120 L130 124 M160 136 L130 132') + blush(64, 132) + blush(136, 132)) },
  { id: 'bunny', name: 'Bunny', cat: 'Animals', svg: wrap(
    E(78, 56, 14, 40, '#fff') + E(122, 56, 14, 40, '#fff') + E(78, 58, 6, 26, '#ffc9d6') + E(122, 58, 6, 26, '#ffc9d6') +
    E(100, 128, 54, 46, '#fff') + dot(80, 122, 6) + dot(120, 122, 6) + S('M95 136 Q100 141 105 136') + S('M100 136 L100 132') + blush(68, 140) + blush(132, 140)) },
  { id: 'bear', name: 'Teddy bear', cat: 'Animals', svg: wrap(
    C(52, 60, 20, '#c98b5a') + C(148, 60, 20, '#c98b5a') + C(52, 60, 9, '#f1c39a') + C(148, 60, 9, '#f1c39a') +
    C(100, 108, 58, '#c98b5a') + E(100, 130, 26, 20, '#f1c39a') + dot(78, 100, 6) + dot(122, 100, 6) + E(100, 122, 9, 6, INK) + S('M100 128 L100 136 M90 140 Q100 146 110 140')) },
  { id: 'fox', name: 'Fox', cat: 'Animals', svg: wrap(
    S('M40 60 L62 26 L84 70 Z', '#ff9a52') + S('M160 60 L138 26 L116 70 Z', '#ff9a52') +
    S('M36 66 Q100 40 164 66 Q160 116 100 168 Q40 116 36 66Z', '#ff9a52') + S('M50 90 Q74 120 100 168 Q126 120 150 90 Q126 110 100 110 Q74 110 50 90Z', '#fff') +
    dot(76, 92, 6) + dot(124, 92, 6) + C(100, 160, 7, INK)) },
  { id: 'owl', name: 'Owl', cat: 'Animals', svg: wrap(
    S('M50 54 L64 70 M150 54 L136 70') + S('M52 60 Q100 30 148 60 Q170 120 140 164 Q100 180 60 164 Q30 120 52 60Z', '#a98be6') +
    E(100, 138, 30, 28, '#e7dcff') + C(76, 88, 20, '#fff') + C(124, 88, 20, '#fff') + dot(78, 90, 8) + dot(122, 90, 8) + S('M94 104 L100 116 L106 104Z', '#ffc14d') +
    S('M86 132 q4 5 8 0 M106 132 q4 5 8 0 M96 146 q4 5 8 0')) },
  { id: 'penguin', name: 'Penguin', cat: 'Animals', svg: wrap(
    E(100, 112, 54, 66, '#4b4a63') + S('M100 60 Q60 70 62 120 Q66 170 100 172 Q134 170 138 120 Q140 70 100 60Z', '#fff') +
    dot(84, 94, 6) + dot(116, 94, 6) + S('M90 108 L110 108 L100 120Z', '#ffad42') + S('M70 176 l14 -8 l2 10Z M130 176 l-14 -8 l-2 10Z', '#ffad42') + blush(74, 112) + blush(126, 112)) },
  { id: 'fish', name: 'Fish', cat: 'Animals', svg: wrap(
    S('M30 100 Q80 40 140 100 Q80 160 30 100Z', '#7cc7ff') + S('M138 100 L176 70 L170 100 L176 130Z', '#5aa9ef') + dot(64, 92, 6) + S('M90 76 Q100 100 90 124 M108 80 Q118 100 108 120') + C(160, 44, 6) + C(176, 26, 4)) },
  { id: 'whale', name: 'Whale', cat: 'Animals', svg: wrap(
    S('M24 120 Q30 70 96 72 Q150 74 164 112 L184 92 L180 126 L190 148 L162 134 Q140 160 84 160 Q30 158 24 120Z', '#8fb6ff') + S('M30 130 Q90 146 156 130', null) +
    dot(66, 108, 5) + S('M92 72 Q86 50 72 44 M92 72 Q98 50 112 46') + blush(80, 122)) },
  { id: 'frog', name: 'Frog', cat: 'Animals', svg: wrap(
    C(68, 66, 22, '#8ed081') + C(132, 66, 22, '#8ed081') + E(100, 118, 70, 50, '#8ed081') + C(68, 64, 11, '#fff') + C(132, 64, 11, '#fff') + dot(70, 66, 6) + dot(130, 66, 6) +
    S('M66 118 Q100 146 134 118') + blush(56, 128) + blush(144, 128)) },
  { id: 'chick', name: 'Chick', cat: 'Animals', svg: wrap(
    C(100, 112, 58, '#ffe073') + S('M98 54 Q92 36 104 30 M100 54 Q108 40 118 42') + dot(80, 104, 6) + dot(120, 104, 6) + S('M90 118 L110 118 L100 130Z', '#ff9a3c') + S('M44 116 Q30 104 36 134') + S('M156 116 Q170 104 164 134') + S('M84 168 l-6 14 M116 168 l6 14') + blush(70, 124) + blush(130, 124)) },
  { id: 'butterfly', name: 'Butterfly', cat: 'Animals', svg: wrap(
    S('M100 96 Q70 30 36 50 Q20 80 60 100 Q24 118 46 150 Q74 168 100 112Z', '#ffb0d0') + S('M100 96 Q130 30 164 50 Q180 80 140 100 Q176 118 154 150 Q126 168 100 112Z', '#ffb0d0') +
    C(66, 72, 9, '#fff') + C(134, 72, 9, '#fff') + C(70, 132, 7, '#fff') + C(130, 132, 7, '#fff') + E(100, 108, 7, 32, INK) + S('M98 78 Q90 56 80 52 M102 78 Q110 56 120 52')) },
  { id: 'snail', name: 'Snail', cat: 'Animals', svg: wrap(
    S('M20 160 L170 160 Q184 160 180 146 Q176 120 150 118 L150 150', '#ffe2b8') + C(96, 112, 48, '#ff9fb4') + S('M96 112 m-8 0 a8 8 0 1 0 16 0 a16 16 0 1 0 -32 0 a24 24 0 1 0 48 0 a32 32 0 1 0 -64 0') +
    S('M160 118 L156 90 M172 120 L176 92') + dot(156, 88, 5) + dot(176, 90, 5)) },
  { id: 'bee', name: 'Bee', cat: 'Animals', svg: wrap(
    E(76, 74, 26, 20, '#e8f4ff') + E(124, 74, 26, 20, '#e8f4ff') + E(100, 120, 52, 40, '#ffd84d') + S('M84 82 Q78 120 84 158 M116 82 Q122 120 116 158', null) + `<path d="M84 82 Q78 120 84 158 L100 160 L100 80Z" fill="${INK}" stroke="none" opacity=".85"/>` +
    S('M150 120 L170 120') + dot(62, 116, 5) + S('M54 128 Q62 134 70 128')) },
  { id: 'dog', name: 'Puppy', cat: 'Animals', svg: wrap(
    S('M58 60 Q30 60 34 110 Q40 128 56 118 Z', '#a26f4a') + S('M142 60 Q170 60 166 110 Q160 128 144 118 Z', '#a26f4a') + E(100, 106, 52, 56, '#f2d2b0') + E(100, 136, 28, 22, '#fff') +
    dot(80, 100, 6) + dot(120, 100, 6) + E(100, 124, 10, 7, INK) + S('M100 131 L100 140 M88 142 Q100 152 112 142') + S('M106 146 q2 12 -6 12 q-6 0 -6 -10', '#ff8fab')) },

  // ---------------------------------------------------------------- faces & people (symmetric ones are great for Split mode)
  { id: 'face', name: 'Smiling face', cat: 'Faces', svg: wrap(
    S('M60 74 Q60 30 100 30 Q140 30 140 74 L140 104 Q140 160 100 168 Q60 160 60 104Z', '#ffe1c9') + S('M56 90 Q46 92 48 106 Q50 118 60 116 M144 90 Q154 92 152 106 Q150 118 140 116', '#ffe1c9') +
    S('M56 84 Q54 26 100 24 Q150 24 144 84 Q140 50 118 46 Q96 62 60 70Z', '#6b4b3e') +
    S('M74 92 Q82 86 90 92 M110 92 Q118 86 126 92') + dot(82, 102, 5) + dot(118, 102, 5) + S('M100 106 Q96 120 102 124') + S('M84 138 Q100 150 116 138') + blush(72, 124) + blush(128, 124)) },
  { id: 'faceguide', name: 'Face proportions', cat: 'Lessons', svg: wrap(
    E(100, 100, 56, 74, '#fff6ee') + guide('M100 22 L100 178 M44 92 L156 92 M52 128 L148 128 M58 150 L142 150') +
    E(76, 92, 13, 7) + E(124, 92, 13, 7) + dot(76, 92, 4) + dot(124, 92, 4) + S('M100 96 L94 124 L104 126') + S('M84 148 Q100 156 116 148') + S('M44 92 Q36 100 44 120 M156 92 Q164 100 156 120') +
    label(100, 196, 'eyes sit halfway down', 13)) },
  { id: 'eye', name: 'Eye study', cat: 'Lessons', svg: wrap(
    S('M24 100 Q100 40 176 100 Q100 152 24 100Z', '#fff') + C(100, 98, 32, '#7fb6d8') + C(100, 98, 15, INK) + `<circle cx="110" cy="88" r="7" fill="#fff" stroke="none"/>` +
    S('M24 100 Q100 34 176 100') + S('M40 84 L30 70 M62 70 L56 54 M88 62 L86 46 M114 62 L118 46 M140 70 L148 56 M160 84 L172 72') + S('M40 120 Q100 150 160 120', null)) },
  { id: 'lips', name: 'Lips', cat: 'Faces', svg: wrap(
    S('M30 102 Q60 70 86 80 Q100 86 114 80 Q140 70 170 102 Q140 150 100 150 Q60 150 30 102Z', '#ff7f9a') + S('M30 102 Q100 112 170 102') + S('M60 96 Q100 104 140 96', null)) },
  { id: 'kid', name: 'Kid with buns', cat: 'Faces', svg: wrap(
    C(54, 52, 22, '#3f2f2a') + C(146, 52, 22, '#3f2f2a') + C(100, 104, 60, '#ffd9bf') + S('M42 98 Q50 40 100 40 Q150 40 158 98 Q130 70 100 76 Q70 70 42 98Z', '#3f2f2a') +
    dot(80, 110, 7) + dot(120, 110, 7) + S('M90 132 Q100 140 110 132') + blush(68, 128) + blush(132, 128)) },
  { id: 'robot', name: 'Robot', cat: 'Faces', svg: wrap(
    S('M100 40 L100 24') + C(100, 20, 6, '#ff8fab') + `<rect x="40" y="40" width="120" height="100" rx="22" fill="#cfe3ff"/>` + `<rect x="58" y="62" width="84" height="48" rx="14" fill="#fff"/>` +
    C(82, 86, 9, '#5aa9ef') + C(118, 86, 9, '#5aa9ef') + S('M84 124 L116 124') + `<rect x="62" y="144" width="76" height="36" rx="10" fill="#cfe3ff"/>` + C(28, 92, 10, '#cfe3ff') + C(172, 92, 10, '#cfe3ff')) },

  // ---------------------------------------------------------------- nature
  { id: 'tulip', name: 'Tulip', cat: 'Nature', svg: wrap(
    S('M100 96 L100 182') + S('M100 150 Q70 150 60 118 Q90 120 100 150Z', '#8ed081') + S('M100 166 Q132 162 142 132 Q110 136 100 166Z', '#8ed081') +
    S('M64 44 L82 60 L100 36 L118 60 L136 44 Q140 96 100 100 Q60 96 64 44Z', '#ff7f9a')) },
  { id: 'daisy', name: 'Daisy', cat: 'Nature', svg: wrap(
    S('M100 120 L100 186') + S('M100 160 Q120 140 140 148 Q124 170 100 160Z', '#8ed081') +
    [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<ellipse cx="100" cy="66" rx="14" ry="26" fill="#fff" transform="rotate(${a} 100 92)"/>`).join('') + C(100, 92, 18, '#ffd84d')) },
  { id: 'sunflower', name: 'Sunflower', cat: 'Nature', svg: wrap(
    S('M100 130 L100 190') + [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => `<ellipse cx="100" cy="42" rx="11" ry="24" fill="#ffc93c" transform="rotate(${a} 100 82)"/>`).join('') +
    C(100, 82, 26, '#8a5a3c') + S('M88 74 l4 4 M104 70 l4 4 M96 90 l4 4 M110 86 l4 4')) },
  { id: 'tree', name: 'Tree', cat: 'Nature', svg: wrap(
    S('M88 186 L92 122 L108 122 L112 186Z', '#b98458') + S('M100 20 Q140 20 150 56 Q176 66 168 100 Q166 130 130 132 Q116 146 100 134 Q84 146 70 132 Q34 130 32 100 Q24 66 50 56 Q60 20 100 20Z', '#8ed081') +
    C(76, 76, 6, '#ff7f7f') + C(124, 64, 6, '#ff7f7f') + C(136, 104, 6, '#ff7f7f') + C(84, 110, 6, '#ff7f7f')) },
  { id: 'cactus', name: 'Cactus', cat: 'Nature', svg: wrap(
    S('M80 150 L80 60 Q80 40 100 40 Q120 40 120 60 L120 150Z', '#7fcf9a') + S('M80 112 L62 112 Q50 112 50 100 L50 76 Q50 66 58 66 Q66 66 66 76 L66 96 L80 96', '#7fcf9a') + S('M120 100 L140 100 Q150 100 150 88 L150 70 Q150 60 142 60 Q134 60 134 70 L134 86 L120 86', '#7fcf9a') +
    S('M60 150 L140 150 L132 186 L68 186Z', '#ff9f6b') + dot(92, 84, 4) + dot(108, 84, 4) + S('M94 96 Q100 101 106 96') + C(100, 36, 7, '#ff8fab')) },
  { id: 'mushroom', name: 'Mushroom', cat: 'Nature', svg: wrap(
    S('M80 118 L76 176 Q100 186 124 176 L120 118Z', '#fff5e6') + S('M24 118 Q24 40 100 40 Q176 40 176 118Z', '#ff6f6f') + C(70, 76, 11, '#fff') + C(118, 64, 14, '#fff') + C(148, 98, 9, '#fff') + C(48, 104, 7, '#fff') +
    dot(90, 146, 4) + dot(110, 146, 4) + S('M94 158 Q100 163 106 158')) },
  { id: 'sun', name: 'Happy sun', cat: 'Nature', svg: wrap(
    C(100, 100, 40, '#ffd84d') + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M100 44 L100 22" transform="rotate(${a} 100 100)"/>`).join('') + dot(86, 94, 5) + dot(114, 94, 5) + S('M86 110 Q100 122 114 110') + blush(76, 108) + blush(124, 108)) },
  { id: 'moon', name: 'Moon & stars', cat: 'Nature', svg: wrap(
    S('M120 30 Q60 40 60 100 Q60 160 120 170 Q74 140 78 100 Q82 56 120 30Z', '#ffe58a') + S('M150 60 l5 12 l12 5 l-12 5 l-5 12 l-5 -12 l-12 -5 l12 -5Z', '#ffe58a') + S('M140 130 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3Z', '#ffe58a'), '#f3f0ff') },
  { id: 'cloud', name: 'Rain cloud', cat: 'Nature', svg: wrap(
    S('M50 120 Q30 120 32 100 Q34 80 56 82 Q60 52 92 54 Q112 34 136 54 Q168 54 166 86 Q182 92 176 112 Q172 122 156 120Z', '#fff') + dot(86, 96, 5) + dot(116, 96, 5) + S('M94 106 Q101 112 108 106') +
    S('M64 140 l-6 14 M100 140 l-6 14 M136 140 l-6 14', null) + `<g stroke="#5aa9ef">${S('M64 140 l-6 14 M100 140 l-6 14 M136 140 l-6 14')}</g>`, '#eef6ff') },
  { id: 'leaf', name: 'Leaf', cat: 'Nature', svg: wrap(
    S('M40 160 Q30 60 160 40 Q170 150 40 160Z', '#8ed081') + S('M40 160 Q100 100 150 50') + S('M76 122 L70 96 M96 104 L92 76 M116 86 L114 62 M84 114 L110 116 M104 96 L128 96 M120 80 L142 78')) },

  // ---------------------------------------------------------------- food
  { id: 'cupcake', name: 'Cupcake', cat: 'Food', svg: wrap(
    S('M56 110 L66 176 L134 176 L144 110Z', '#9fd3ff') + S('M80 112 L84 176 M100 112 L100 176 M120 112 L116 176') +
    S('M46 112 Q40 84 66 82 Q66 52 100 52 Q134 52 134 82 Q160 84 154 112Z', '#ffc2dd') + C(100, 42, 10, '#ff6f6f') + S('M100 32 Q104 22 112 20') + S('M70 96 l4 -4 M92 72 l4 2 M120 92 l4 -3 M110 70 l-3 4', null)) },
  { id: 'icecream', name: 'Ice cream', cat: 'Food', svg: wrap(
    S('M66 100 L100 184 L134 100Z', '#f5c27a') + S('M74 118 L120 104 M80 136 L126 122 M88 154 L116 146 M78 104 L110 168 M98 102 L118 146') +
    C(80, 86, 24, '#ffb3c9') + C(120, 86, 24, '#b6e3a8') + C(100, 58, 26, '#fff1b8') + C(100, 30, 8, '#ff6f6f')) },
  { id: 'donut', name: 'Donut', cat: 'Food', svg: wrap(
    C(100, 100, 66, '#e9b07a') + S('M44 96 Q46 46 100 40 Q156 44 158 100 Q150 118 136 108 Q126 128 108 116 Q94 136 80 118 Q62 126 56 108 Q44 112 44 96Z', '#ff9ec4') + C(100, 96, 18, '#fffdf8') +
    `<g stroke-width="5">${S('M70 70 l8 -4 M128 66 l6 6 M140 92 l4 8 M84 124 l-4 6 M60 96 l2 8 M112 60 l8 0', null)}</g>`) },
  { id: 'strawberry', name: 'Strawberry', cat: 'Food', svg: wrap(
    S('M100 60 Q160 52 160 96 Q156 150 100 180 Q44 150 40 96 Q40 52 100 60Z', '#ff6f6f') + S('M70 56 L84 66 L100 50 L116 66 L130 56 L122 72 L100 76 L78 72Z', '#8ed081') + S('M100 50 L100 32') +
    [[76, 96], [100, 100], [124, 96], [86, 124], [114, 124], [100, 148]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="3" ry="5" fill="#fff3a8" stroke="none"/>`).join('')) },
  { id: 'coffee', name: 'Coffee cup', cat: 'Food', svg: wrap(
    S('M44 84 L156 84 L146 160 Q144 176 128 176 L72 176 Q56 176 54 160Z', '#fff') + S('M152 98 Q182 98 180 124 Q178 148 148 144') + E(100, 84, 56, 10, '#a8714c') +
    S('M84 60 Q76 48 86 38 Q94 28 86 18 M112 62 Q104 50 114 40 Q122 30 114 20') + dot(86, 120, 5) + dot(114, 120, 5) + S('M92 134 Q100 141 108 134') + blush(76, 132) + blush(124, 132)) },
  { id: 'avocado', name: 'Avocado', cat: 'Food', svg: wrap(
    S('M100 20 Q130 20 136 70 Q170 120 150 158 Q130 184 100 184 Q70 184 50 158 Q30 120 64 70 Q70 20 100 20Z', '#7fb069') + S('M100 36 Q122 36 124 76 Q152 118 138 150 Q124 170 100 170 Q76 170 62 150 Q48 118 76 76 Q78 36 100 36Z', '#e3f2a8') +
    C(100, 128, 24, '#a8714c') + dot(86, 86, 4) + dot(114, 86, 4) + S('M94 96 Q100 101 106 96')) },
  { id: 'watermelon', name: 'Watermelon', cat: 'Food', svg: wrap(
    S('M24 70 L176 70 Q170 170 100 172 Q30 170 24 70Z', '#7fcf7f') + S('M36 70 L164 70 Q160 156 100 158 Q40 156 36 70Z', '#ff7a8a') +
    [[70, 96], [100, 104], [130, 96], [84, 128], [116, 128]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="4" ry="7" fill="${INK}" stroke="none"/>`).join('')) },
  { id: 'cake', name: 'Birthday cake', cat: 'Food', svg: wrap(
    S('M36 110 L164 110 L164 176 L36 176Z', '#ffe1ec') + S('M36 110 Q52 130 68 110 Q84 130 100 110 Q116 130 132 110 Q148 130 164 110', null) + S('M36 110 Q52 130 68 110 Q84 130 100 110 Q116 130 132 110 Q148 130 164 110 L164 110 L36 110Z', '#fff') +
    S('M78 110 L78 76 M100 110 L100 76 M122 110 L122 76') + S('M78 76 q-6 -10 0 -18 q6 8 0 18 M100 76 q-6 -10 0 -18 q6 8 0 18 M122 76 q-6 -10 0 -18 q6 8 0 18', '#ffc14d') +
    C(64, 146, 6, '#ff6f9a') + C(100, 152, 6, '#5aa9ef') + C(136, 146, 6, '#8ed081')) },

  // ---------------------------------------------------------------- things
  { id: 'house', name: 'Cozy house', cat: 'Things', svg: wrap(
    S('M40 100 L40 176 L160 176 L160 100', '#fff1d6') + S('M24 104 L100 36 L176 104Z', '#ff8a7a') + S('M132 64 L132 40 L150 40 L150 80', '#ff8a7a') + `<rect x="86" y="128" width="30" height="48" rx="4" fill="#c98b5a"/>` +
    `<rect x="52" y="116" width="24" height="24" rx="3" fill="#bfe3ff"/>` + `<rect x="128" y="116" width="24" height="24" rx="3" fill="#bfe3ff"/>` + S('M64 116 L64 140 M52 128 L76 128 M140 116 L140 140 M128 128 L152 128') + dot(110, 154, 3)) },
  { id: 'heart', name: 'Heart', cat: 'Love', svg: wrap(
    S('M100 170 Q30 120 30 76 Q30 40 64 38 Q88 38 100 62 Q112 38 136 38 Q170 40 170 76 Q170 120 100 170Z', '#ff6f91') + `<path d="M58 66 Q60 54 72 52" stroke="#fff" stroke-width="6"/>`) },
  { id: 'twohearts', name: 'Two hearts', cat: 'Love', svg: wrap(
    S('M76 140 Q24 104 24 70 Q24 44 50 42 Q68 42 76 60 Q84 42 102 42 Q128 44 128 70 Q128 104 76 140Z', '#ff8fab') +
    S('M132 168 Q90 140 90 112 Q90 92 110 90 Q126 90 132 104 Q138 90 154 90 Q174 92 174 112 Q174 140 132 168Z', '#ffb3c6')) },
  { id: 'letter', name: 'Love letter', cat: 'Love', svg: wrap(
    `<rect x="26" y="56" width="148" height="100" rx="8" fill="#fff6e8"/>` + S('M26 64 L100 116 L174 64') + S('M26 150 L84 104 M174 150 L116 104') +
    S('M100 128 Q82 114 82 102 Q82 92 92 92 Q98 92 100 98 Q102 92 108 92 Q118 92 118 102 Q118 114 100 128Z', '#ff6f91')) },
  { id: 'rose', name: 'Rose', cat: 'Love', svg: wrap(
    S('M100 104 L100 188') + S('M100 150 Q72 144 62 120 Q92 120 100 150Z', '#8ed081') + S('M100 168 Q130 160 138 138 Q110 140 100 168Z', '#8ed081') +
    S('M58 64 Q54 116 100 116 Q146 116 142 64 Q124 84 100 72 Q76 84 58 64Z', '#ff5f7e') + S('M70 62 Q70 26 100 24 Q130 26 130 62 Q130 86 100 86 Q70 86 70 62Z', '#ff7f97') +
    S('M100 42 Q116 44 114 60 Q110 74 96 72 Q84 68 88 56 Q92 48 102 52') + S('M74 52 Q84 70 100 72 M126 52 Q116 70 100 72')) },
  { id: 'ring', name: 'Ring', cat: 'Love', svg: wrap(
    C(100, 124, 46, null) + C(100, 124, 36, null) + S('M84 72 L100 52 L116 72 L100 86Z', '#bfe8ff') + S('M84 72 L116 72 M100 52 L94 72 L100 86 L106 72Z') + S('M140 46 l4 8 l8 4 l-8 4 l-4 8 l-4 -8 l-8 -4 l8 -4Z', '#ffe58a')) },
  { id: 'balloon', name: 'Balloons', cat: 'Things', svg: wrap(
    E(76, 70, 30, 36, '#ff7f9a') + E(126, 82, 30, 36, '#7cc7ff') + S('M72 106 l4 8 l4 -8Z M122 118 l4 8 l4 -8Z', null) + S('M76 112 Q70 150 98 186 M126 124 Q130 160 98 186') + `<path d="M62 54 Q66 44 76 42" stroke="#fff" stroke-width="5"/>`) },
  { id: 'rocket', name: 'Rocket', cat: 'Things', svg: wrap(
    S('M100 20 Q140 50 136 120 L64 120 Q60 50 100 20Z', '#f2f4ff') + C(100, 76, 16, '#7cc7ff') + S('M64 96 L40 130 L64 124Z', '#ff7f7f') + S('M136 96 L160 130 L136 124Z', '#ff7f7f') +
    S('M76 120 L124 120 L116 136 L84 136Z', '#a9a9c8') + S('M86 140 Q100 196 114 140Z', '#ffc14d')) },
  { id: 'umbrella', name: 'Umbrella', cat: 'Things', svg: wrap(
    S('M24 100 Q30 36 100 34 Q170 36 176 100 Q158 88 138 100 Q120 86 100 100 Q80 86 62 100 Q42 88 24 100Z', '#a98be6') + S('M100 100 L100 166 Q100 180 86 180 Q74 180 74 168') + S('M100 34 L100 22')) },
  { id: 'bike', name: 'Bicycle', cat: 'Things', svg: wrap(
    C(52, 132, 32) + C(148, 132, 32) + S('M52 132 L82 82 L132 82 L148 132 M82 82 L100 132 L132 82 M100 132 L52 132 M74 70 L92 70 M132 82 L126 62 L144 62')) },
  { id: 'teapot', name: 'Teapot', cat: 'Things', svg: wrap(
    S('M50 92 Q50 64 100 64 Q150 64 150 92 L150 140 Q150 168 100 168 Q50 168 50 140Z', '#bfe3c9') + S('M150 100 Q176 100 172 124 Q168 140 150 140') + S('M50 104 L24 84 L32 120 L50 130', '#bfe3c9') +
    E(100, 64, 30, 8, '#bfe3c9') + C(100, 50, 8, '#ffb3c4') + dot(86, 110, 5) + dot(114, 110, 5) + S('M92 124 Q100 130 108 124')) },
  { id: 'boat', name: 'Sailboat', cat: 'Things', svg: wrap(
    S('M30 140 L170 140 L150 172 L50 172Z', '#ff9f6b') + S('M100 140 L100 30') + S('M100 36 L150 128 L100 128Z', '#fff') + S('M96 52 L56 128 L96 128Z', '#ffe58a') +
    `<g stroke="#5aa9ef">${S('M10 184 Q30 176 50 184 Q70 192 90 184 Q110 176 130 184 Q150 192 170 184 Q182 178 194 184')}</g>`, '#f2f9ff') },
  { id: 'star', name: 'Cute star', cat: 'Things', svg: wrap(
    S('M100 22 L122 72 L176 76 L134 110 L148 164 L100 136 L52 164 L66 110 L24 76 L78 72Z', '#ffd84d') + dot(86, 98, 5) + dot(114, 98, 5) + S('M92 112 Q100 119 108 112') + blush(76, 110) + blush(124, 110)) },

  // ---------------------------------------------------------------- lessons
  { id: 'cat-steps', name: 'Cat in 4 steps', cat: 'Lessons', svg: wrap(
    `<g stroke-width="3">` +
    `<rect x="4" y="4" width="92" height="92" rx="10" stroke="#e3dcef"/><rect x="104" y="4" width="92" height="92" rx="10" stroke="#e3dcef"/><rect x="4" y="104" width="92" height="92" rx="10" stroke="#e3dcef"/><rect x="104" y="104" width="92" height="92" rx="10" stroke="#e3dcef"/>` +
    E(50, 56, 30, 24) +
    E(150, 56, 30, 24) + S('M126 44 L128 22 L144 34 M174 44 L172 22 L156 34') +
    E(50, 156, 30, 24) + S('M26 144 L28 122 L44 134 M74 144 L72 122 L56 134') + dot(40, 154, 3.5) + dot(60, 154, 3.5) + S('M47 162 L53 162 L50 166Z') +
    E(150, 156, 30, 24, '#ffd9a8') + S('M126 144 L128 122 L144 134 M174 144 L172 122 L156 134', '#ffd9a8') + dot(140, 154, 3.5) + dot(160, 154, 3.5) + S('M147 162 L153 162 L150 166Z') + S('M118 158 L136 160 M118 166 L136 164 M182 158 L164 160 M182 166 L164 164') +
    `</g>` + label(16, 22, '1', 14) + label(116, 22, '2', 14) + label(16, 122, '3', 14) + label(116, 122, '4', 14)) },
  { id: 'cube', name: 'Cube in perspective', cat: 'Lessons', svg: wrap(
    guide('M10 60 L190 60') + S('M60 90 L120 74 L170 96 L110 114Z', '#f6f1ff') + S('M60 90 L60 160 L110 186 L110 114Z', '#e7dcff') + S('M110 114 L110 186 L170 162 L170 96Z', '#d3c4ff') +
    guide('M60 90 L10 60 M170 96 L190 60') + label(100, 40, 'horizon line', 13)) },
  { id: 'sphere', name: 'Shading a ball', cat: 'Lessons', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><radialGradient id="g" cx="38%" cy="34%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#b7a6e8"/><stop offset="1" stop-color="#4a3a7a"/></radialGradient></defs><rect width="200" height="200" fill="#fffdf8"/><ellipse cx="108" cy="168" rx="56" ry="12" fill="#3b3346" opacity=".22"/><circle cx="100" cy="98" r="62" fill="url(#g)" stroke="#3b3346" stroke-width="4"/><path d="M168 30 l-24 22" stroke="#ffb020" stroke-width="5" stroke-linecap="round"/><circle cx="174" cy="24" r="10" fill="#ffd84d"/><text x="100" y="194" font-family="ui-rounded,system-ui,sans-serif" font-size="13" font-weight="700" fill="#3b3346" text-anchor="middle">light, shadow, cast shadow</text></svg>` },
  { id: 'hand', name: 'Simple hand', cat: 'Lessons', svg: wrap(
    S('M64 180 L60 110 Q56 92 60 70 Q62 60 70 60 Q78 60 78 70 L80 100 L82 44 Q82 34 92 34 Q100 34 100 44 L100 96 L104 36 Q104 26 114 26 Q122 26 122 36 L120 98 L126 50 Q128 42 136 42 Q144 44 142 54 L138 112 Q150 96 160 100 Q170 106 162 120 Q146 150 132 180Z', '#ffe1c9')) },
  { id: 'shapes', name: 'Warm-up shapes', cat: 'Lessons', svg: wrap(
    C(50, 50, 30) + `<rect x="120" y="22" width="58" height="58" rx="4"/>` + S('M50 120 L80 176 L20 176Z') + E(150, 148, 34, 22) + guide('M10 100 L190 100 M100 10 L100 190')) },
];

export const CATEGORIES = ['Animals', 'Faces', 'Nature', 'Food', 'Things', 'Love', 'Lessons', 'Emoji', 'My photos'];
export const EMOJI = (
  '🐱 🐶 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦉 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🦑 🐠 🐳 🐬 🦈 🦀 🦖 🐉 🦒 🐘 🦔 🦥 🦦 🦩 ' +
  '🌸 🌷 🌹 🌻 🌼 🌵 🌴 🌳 🍄 🍀 🍁 🌈 ☀️ 🌙 ⭐ ☁️ ⛄ 🔥 💧 🌊 🌋 🏝️ 🏔️ 🌍 🪐 ' +
  '🍎 🍓 🍒 🍑 🍉 🍋 🍌 🍍 🥑 🥕 🌽 🍔 🍕 🌮 🍣 🍩 🍪 🎂 🧁 🍦 ☕ 🧋 🍵 🥐 🍰 ' +
  '🏠 🏰 🗼 ⛺ 🚗 🚲 ✈️ 🚀 ⛵ 🚂 🎈 🎁 🎀 💌 💍 👑 🎸 🎹 📷 💡 ⏰ 🔑 ☂️ 🧸 🪁 🎨 ✏️ 📚 🕯️ 🧲 ' +
  '😀 😊 😍 🥰 😎 🤓 😴 🤔 😂 😭 😡 😱 🥳 🤠 👻 🤖 👽 💀 👀 👄 💪 👋 ❤️ 💕 💞'
).split(' ').filter(Boolean);

export const libItem = (id) => ART.find((a) => a.id === id);
export function itemsIn(cat) {
  if (cat === 'Emoji') return EMOJI.map((e) => ({ id: 'emoji:' + e, src: 'emoji:' + e, name: e, emoji: e }));
  return ART.filter((a) => a.cat === cat).map((a) => ({ id: a.id, src: 'lib:' + a.id, name: a.name, svg: a.svg }));
}
export const svgUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

const cache = new Map();
/** src is lib:<id>, emoji:<char>, or a data: URL. Returns a drawable (Image or canvas) or null while loading. */
export function getImage(src, onReady) {
  const c = cache.get(src);
  if (c) { if (c.img) return c.img; if (onReady) c.wait.push(onReady); return null; }
  const entry = { img: null, wait: onReady ? [onReady] : [] };
  cache.set(src, entry);
  const done = (img) => { entry.img = img; for (const f of entry.wait) f(img); entry.wait = []; };
  if (src.startsWith('emoji:')) {
    const [cv, x] = makeCanvas(256, 256, {});
    x.font = '200px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(src.slice(6), 128, 140);
    done(cv);
  } else if (src.startsWith('lib:')) {
    const it = libItem(src.slice(4));
    if (it) loadImage(svgUrl(it.svg)).then(done).catch(() => {});
  } else if (src.startsWith('data:image/')) loadImage(src).then(done).catch(() => {});
  return entry.img;
}
export function nameOf(src) {
  if (src.startsWith('lib:')) { const it = libItem(src.slice(4)); return it ? it.name : 'Picture'; }
  if (src.startsWith('emoji:')) return src.slice(6);
  return 'Photo';
}
export function aspectOf(img) { return img ? (img.naturalWidth || img.width) / (img.naturalHeight || img.height || 1) : 1; }
