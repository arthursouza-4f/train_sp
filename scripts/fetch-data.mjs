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

console.log('Pronto. Agora rode: npm run data:build');
