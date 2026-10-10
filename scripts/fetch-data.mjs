// Baixa os dados brutos usados pelo build (só é preciso rodar para atualizar os dados).
// O site final NÃO acessa nenhuma API: tudo vira public/data/network.json.
//
// Uso: npm run data:fetch   (depois: npm run data:build)

import { writeFileSync, mkdirSync } from 'node:fs';

const RAW = new URL('../data-raw/', import.meta.url);
mkdirSync(RAW, { recursive: true });

const UA = { 'User-Agent': 'TrainView-SP data build (static site)', Accept: '*/*' };

async function download(url, name, init = {}) {
  process.stdout.write(`↓ ${name} … `);
  const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} em ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(new URL(name, RAW), buf);
  console.log(`${(buf.length / 1024).toFixed(0)} KB`);
}

// GTFS oficial da SPTrans (espelho público do Mobility Database; o original exige login
// em sptrans.com.br/desenvolvedores). Inclui as linhas do Metrô e da CPTM.
await download('https://files.mobilitydatabase.org/mdb-8/latest.zip', 'gtfs-sptrans.zip');

// Contexto geográfico (OpenStreetMap via Overpass).
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const overpass = (q, name) =>
  download(OVERPASS, name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'data=' + encodeURIComponent(q),
  });

const BBOX = '(-23.95,-47.05,-23.15,-46.15)';
await overpass(
  `[out:json][timeout:120];(way["waterway"="river"]["name"~"^Rio (Tietê|Pinheiros|Tamanduateí|Juqueri|Baquirivu-Guaçu|Aricanduva|Jundiaí)$"]${BBOX};` +
    `way["waterway"="canal"]["name"~"Pinheiros"]${BBOX};);out geom;`,
  'osm-rivers.json',
);
await overpass(
  '[out:json][timeout:120];(relation["natural"="water"]["name"~"(Billings|Guarapiranga|Rio Grande)"](-23.95,-46.9,-23.55,-46.3);' +
    'way["natural"="water"]["name"~"(Billings|Guarapiranga)"](-23.95,-46.9,-23.55,-46.3););out geom;',
  'osm-lakes.json',
);
await overpass('[out:json][timeout:120];relation(298285);out geom;', 'osm-city.json');

console.log('Pronto. Agora rode: npm run data:build');
