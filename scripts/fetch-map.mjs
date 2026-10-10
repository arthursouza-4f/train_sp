// Baixa o mapa de fundo para public/map/ (só é preciso rodar para atualizar o mapa).
// O site final carrega tudo daqui: nenhum servidor de mapas é consultado durante o uso.
//
// - sp.pmtiles: recorte da região da rede (com margem) do mapa-múndi vetorial do Protomaps,
//   gerado a partir do OpenStreetMap. É um arquivo único; o navegador baixa só os pedaços
//   (tiles) que aparecem na tela, por requisições HTTP Range.
// - fonts/ e sprites/: fontes e ícones usados pelos rótulos do mapa.
//
// Requer o CLI `pmtiles` (https://github.com/protomaps/go-pmtiles): brew install pmtiles
// Uso: npm run map:fetch

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const OUT = new URL('../public/map/', import.meta.url);
const MAX_ZOOM = 14; // além disso o MapLibre amplia os vetores do z14 (fica nítido)
const MARGIN_KM = 6;
const ASSETS = 'https://protomaps.github.io/basemaps-assets';
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
// latim (com acentos), pontuação e setas
const RANGES = ['0-255', '256-511', '512-767', '768-1023', '7680-7935', '8192-8447', '8448-8703'];
const SPRITE = 'light';

mkdirSync(new URL('fonts/', OUT), { recursive: true });
mkdirSync(new URL('sprites/', OUT), { recursive: true });

// ------------------------------------------------------------ área: traçados + margem
const net = JSON.parse(readFileSync(new URL('../public/data/network.json', import.meta.url), 'utf8'));
const { lat0, lon0, kx, kz } = net.projection;
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const l of net.lines) {
  for (const sv of l.services) {
    for (let i = 0; i < sv.path.length; i += 2) {
      minX = Math.min(minX, sv.path[i]); maxX = Math.max(maxX, sv.path[i]);
      minZ = Math.min(minZ, sv.path[i + 1]); maxZ = Math.max(maxZ, sv.path[i + 1]);
    }
  }
}
const r3 = (v) => Math.round(v * 1000) / 1000;
const bbox = [
  r3(lon0 + (minX - MARGIN_KM) / kx), // oeste
  r3(lat0 - (maxZ + MARGIN_KM) / kz), // sul
  r3(lon0 + (maxX + MARGIN_KM) / kx), // leste
  r3(lat0 - (minZ - MARGIN_KM) / kz), // norte
];
console.log('Área:', bbox.join(','));

// ------------------------------------------------------------ tiles vetoriais
const builds = await (await fetch('https://build-metadata.protomaps.dev/builds.json')).json();
const latest = builds.at(-1).key;
console.log(`Extraindo de ${latest} até z${MAX_ZOOM}…`);
const res = spawnSync(
  'pmtiles',
  ['extract', `https://build.protomaps.com/${latest}`, new URL('sp.pmtiles', OUT).pathname, `--bbox=${bbox.join(',')}`, `--maxzoom=${MAX_ZOOM}`],
  { stdio: 'inherit' },
);
if (res.error?.code === 'ENOENT') throw new Error('CLI `pmtiles` não encontrado. Instale com: brew install pmtiles');
if (res.status !== 0) throw new Error('pmtiles extract falhou');

// ------------------------------------------------------------ fontes e ícones
async function get(url, file) {
  const r = await fetch(url);
  if (!r.ok) {
    console.log(`  (sem ${url.split('/').slice(-2).join('/')}: ${r.status})`);
    return;
  }
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
for (const font of FONTS) {
  const dir = new URL(`fonts/${font}/`, OUT);
  mkdirSync(dir, { recursive: true });
  for (const range of RANGES) await get(`${ASSETS}/fonts/${encodeURIComponent(font)}/${range}.pbf`, new URL(`${range}.pbf`, dir));
  console.log(`✓ fonte ${font}`);
}
for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) {
  await get(`${ASSETS}/sprites/v4/${SPRITE}${suffix}`, new URL(`sprites/${SPRITE}${suffix}`, OUT));
}
console.log('✓ ícones');
writeFileSync(new URL('area.json', OUT), JSON.stringify({ bbox, maxzoom: MAX_ZOOM, build: latest }, null, 2) + '\n');
if (existsSync(new URL('sp.pmtiles', OUT))) console.log('Pronto: public/map/');
