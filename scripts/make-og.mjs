// Gera public/og-image.png (1200×630): a imagem de prévia quando o link é compartilhado
// (WhatsApp, Telegram, redes sociais). Desenha as linhas reais da rede a partir do network.json.
//
// Uso: npm run og   (rode de novo se as linhas mudarem)

import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { LINES } from '../src/data/lines-meta.js';

const W = 1200;
const H = 630;
const net = JSON.parse(readFileSync(new URL('../public/data/network.json', import.meta.url), 'utf8'));
const meta = Object.fromEntries(LINES.map((l) => [l.id, l]));

// enquadramento: centro expandido à direita, linhas saindo pelas bordas
const S = 13.5; // px por km
const CX = 830;
const CY = 330;
const C0 = { x: 3, z: -2 }; // km
const px = (x, z) => [(CX + (x - C0.x) * S).toFixed(1), (CY + (z - C0.z) * S).toFixed(1)];

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

const paths = [];
const trains = [];
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const line of net.lines) {
  const color = meta[line.id].color;
  for (const sv of line.services) {
    const pts = [];
    for (let i = 0; i < sv.path.length; i += 2) pts.push(px(sv.path[i], sv.path[i + 1]).join(','));
    const d = 'M' + pts.join('L');
    const casing = lum(color) > 0.62 ? '#9b9b9b' : '#ffffff';
    paths.push({ d, color, casing, order: line.services.indexOf(sv) });
    // alguns "trens" ao longo da linha
    const n = sv.path.length / 2;
    let len = 0;
    for (let i = 1; i < n; i++) len += Math.hypot(sv.path[2 * i] - sv.path[2 * i - 2], sv.path[2 * i + 1] - sv.path[2 * i - 1]);
    for (let k = 0; k < Math.max(1, Math.round(len / 9)); k++) {
      const i = Math.floor(rand() * (n - 2));
      const [x0, z0] = [sv.path[2 * i], sv.path[2 * i + 1]];
      const [x1, z1] = [sv.path[2 * i + 2], sv.path[2 * i + 3]];
      const [ax, ay] = px(x0, z0).map(Number);
      const ang = (Math.atan2(z1 - z0, x1 - x0) * 180) / Math.PI;
      trains.push(`<g transform="translate(${ax} ${ay}) rotate(${ang.toFixed(1)})"><rect x="-13" y="-5" width="26" height="10" rx="5" fill="${color}" stroke="#ffffff" stroke-width="2.2"/></g>`);
    }
  }
}
const stations = net.stations
  .map((s) => {
    const [x, y] = px(s.x, s.z);
    const t = s.lines.length > 1;
    const stroke = t ? '#3a3a3a' : meta[s.lines[0]].color;
    return `<circle cx="${x}" cy="${y}" r="${t ? 4.6 : 3.2}" fill="#ffffff" stroke="${stroke}" stroke-width="${t ? 2.2 : 1.8}"/>`;
  })
  .join('');

const badges = LINES.map((l, i) => {
  const x = 72 + i * 31;
  const dark = lum(l.color) > 0.62;
  return `<rect x="${x}" y="452" width="26" height="26" rx="6" fill="${l.color}"/>
    <text x="${x + 13}" y="470" font-size="13" font-weight="700" text-anchor="middle" fill="${dark ? '#1d1d1d' : '#ffffff'}">${l.number}</text>`;
}).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
  <defs>
    <linearGradient id="fade" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#f1efeb" stop-opacity="1"/>
      <stop offset="0.42" stop-color="#f1efeb" stop-opacity="0.96"/>
      <stop offset="0.62" stop-color="#f1efeb" stop-opacity="0"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M48 0H0V48" fill="none" stroke="#e6e3dd" stroke-width="1.5"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="#f1efeb"/>
  <rect width="${W}" height="${H}" fill="url(#grid)" opacity="0.7"/>
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    ${paths.map((p) => `<path d="${p.d}" stroke="${p.casing}" stroke-width="9"/>`).join('')}
    ${paths.map((p) => `<path d="${p.d}" stroke="${p.color}" stroke-width="5"/>`).join('')}
  </g>
  ${stations}
  ${trains.join('')}
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  <g transform="translate(72 0)">
    <rect x="0" y="170" width="58" height="58" rx="13" fill="#1d1d1f"/>
    <path d="M9 200 C21 196 25 181 48 177" stroke="#ffffff" stroke-width="5.5" fill="none" stroke-linecap="round"/>
    <circle cx="34" cy="185" r="6.5" fill="#EE372F"/>
    <text x="76" y="218" font-size="56" font-weight="800" fill="#1d1d1f" letter-spacing="-1">TrainView <tspan fill="#6b6760">SP</tspan></text>
    <text x="0" y="296" font-size="34" font-weight="600" fill="#1d1d1f">Metrô e trens de São Paulo</text>
    <text x="0" y="340" font-size="34" font-weight="600" fill="#1d1d1f">em 3D, em tempo real</text>
    <text x="0" y="396" font-size="20" fill="#6b6760">Posições estimadas pela tabela oficial · projeto independente</text>
  </g>
  ${badges}
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: W },
  font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica Neue' },
}).render().asPng();
writeFileSync(new URL('../public/og-image.png', import.meta.url), png);
console.log(`OK: public/og-image.png (${(png.length / 1024).toFixed(0)} KB)`);
