// Converte os dados oficiais brutos (data-raw/) no arquivo estático public/data/network.json
// consumido pelo site. Nada aqui roda no navegador: o site não chama nenhuma API.
//
// Fontes:
//   - GTFS da SPTrans (inclui Metrô e CPTM): traçados (shapes), estações, intervalos (frequencies),
//     terminais de ônibus.  data-raw/gtfs-sptrans.zip
//   - OpenStreetMap (© colaboradores do OSM, ODbL): rios, represas e limite do município,
//     apenas como contexto geográfico.  data-raw/osm-*.json
//
// Uso: npm run data:build

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { LINES } from '../src/data/lines-meta.js';

const RAW = new URL('../data-raw/', import.meta.url);
const OUT_DIR = new URL('../public/data/', import.meta.url);

// ---------------------------------------------------------------- projeção
// Equiretangular local centrada na Praça da Sé. Unidade: km. x = leste, z = sul.
const LAT0 = -23.5505;
const LON0 = -46.6333;
const KX = 111.32 * Math.cos((LAT0 * Math.PI) / 180);
const KZ = 110.574;
const proj = (lat, lon) => [(lon - LON0) * KX, (LAT0 - lat) * KZ];
const r3 = (v) => Math.round(v * 1000) / 1000;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------- CSV
function splitCSVLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCSV(text, filter) {
  const lines = text.split(/\r?\n/);
  const header = splitCSVLine(lines[0].replace(/^﻿/, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (filter && !filter(l)) continue;
    const cols = splitCSVLine(l);
    const o = {};
    header.forEach((h, j) => { o[h] = cols[j]; });
    rows.push(o);
  }
  return rows;
}

// ---------------------------------------------------------------- geometria
function simplifyDP(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = pts[b];
    const dx = B[0] - A[0], dz = B[1] - A[1];
    const len2 = dx * dx + dz * dz || 1e-12;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i];
      let t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(P[0] - (A[0] + t * dx), P[1] - (A[1] + t * dz));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Catmull-Rom centrípeta, reamostrada com espaçamento ~uniforme (km).
function smoothResample(pts, spacing) {
  if (pts.length < 2) return pts.slice();
  const P = [
    [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]],
    ...pts,
    [2 * pts.at(-1)[0] - pts.at(-2)[0], 2 * pts.at(-1)[1] - pts.at(-2)[1]],
  ];
  const dense = [];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const segLen = dist(p1, p2);
    const n = Math.max(1, Math.ceil(segLen / (spacing / 4)));
    const t01 = Math.pow(dist(p0, p1), 0.5) || 1e-4;
    const t12 = Math.pow(segLen, 0.5) || 1e-4;
    const t23 = Math.pow(dist(p2, p3), 0.5) || 1e-4;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const pt = [0, 0];
      for (let d = 0; d < 2; d++) {
        const m1 = (p2[d] - p1[d] + t12 * ((p1[d] - p0[d]) / t01 - (p2[d] - p0[d]) / (t01 + t12)));
        const m2 = (p2[d] - p1[d] + t12 * ((p3[d] - p2[d]) / t23 - (p3[d] - p1[d]) / (t12 + t23)));
        const a = 2 * p1[d] - 2 * p2[d] + m1 + m2;
        const b = -3 * p1[d] + 3 * p2[d] - 2 * m1 - m2;
        pt[d] = a * t * t * t + b * t * t + m1 * t + p1[d];
      }
      dense.push(pt);
    }
  }
  dense.push(pts.at(-1).slice());
  // reamostragem uniforme
  const out = [dense[0]];
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    const d = dist(dense[i - 1], dense[i]);
    acc += d;
    if (acc >= spacing) { out.push(dense[i]); acc = 0; }
  }
  if (dist(out.at(-1), dense.at(-1)) > spacing * 0.3) out.push(dense.at(-1));
  else out[out.length - 1] = dense.at(-1);
  return out;
}

function cumLengths(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i]));
  return c;
}

function projectOnPath(pts, cum, p, fromIdx = 0) {
  let best = { d: Infinity, s: 0, i: 0 };
  for (let i = fromIdx; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const dx = B[0] - A[0], dz = B[1] - A[1];
    const len2 = dx * dx + dz * dz || 1e-12;
    let t = ((p[0] - A[0]) * dx + (p[1] - A[1]) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p[0] - (A[0] + t * dx), p[1] - (A[1] + t * dz));
    if (d < best.d) best = { d, s: cum[i] + t * Math.sqrt(len2), i };
  }
  return best;
}

const flat = (pts) => pts.flatMap(([x, z]) => [r3(x), r3(z)]);

// ---------------------------------------------------------------- nomes
const NAME_FIX = {
  'Jundiai': 'Jundiaí',
  'Eng. Goulart': 'Engenheiro Goulart',
  'Eng Manoel Feio': 'Engenheiro Manoel Feio',
  'S. N. Sra. de Fátima-Sumaré': 'Santuário N. Sra. de Fátima-Sumaré',
  'Pinheiros Metrô': 'Pinheiros',
  'Lapa (linha 7)': 'Lapa',
  'Lapa (linha 8)': 'Lapa',
  'Vila Prudente (monotrilho)': 'Vila Prudente',
  'Oratorio': 'Oratório',
  'Aacd-Servidor': 'AACD-Servidor',
  'Bruno Covas-Mendes-Vila Natal': 'Bruno Covas/Mendes-Vila Natal',
  'Villa Lobos-Jaguaré': 'Villa-Lobos-Jaguaré',
  'Guarulhos Cecap': 'Guarulhos-Cecap',
  'Aeroporto Guarulhos': 'Aeroporto-Guarulhos',
  'Guilhermina Esperança': 'Guilhermina-Esperança',
  'Sesc-Pompeia': 'SESC-Pompeia',
  'Trianon-Masp': 'Trianon-Masp',
};

function prettyName(raw) {
  let s = raw.trim().replace(/\s*-\s*/g, '-');
  s = s.replace(/-(\p{Ll})/gu, (_, c) => '-' + c.toUpperCase());
  s = s.replace(/ (Da|De|Do|Das|Dos|E) /g, (_, w) => ' ' + w.toLowerCase() + ' ');
  return NAME_FIX[s] ?? s;
}

const HEADSIGN_FIX = { 'CORINTHIANS - ITAQUERA': 'Corinthians-Itaquera', 'PALMEIRAS - BARRA FUNDA': 'Palmeiras-Barra Funda' };

// ---------------------------------------------------------------- GTFS
console.log('Lendo GTFS…');
const zip = unzipSync(readFileSync(new URL('gtfs-sptrans.zip', RAW)));
const file = (n) => strFromU8(zip[n]);

const routes = parseCSV(file('routes.txt'));
const routeIds = new Set(LINES.flatMap((l) => l.routes));
const routeById = Object.fromEntries(routes.filter((r) => routeIds.has(r.route_id)).map((r) => [r.route_id, r]));
for (const id of routeIds) if (!routeById[id]) throw new Error(`route_id ausente no GTFS: ${id}`);

const calendar = Object.fromEntries(parseCSV(file('calendar.txt')).map((c) => [c.service_id, c]));
const trips = parseCSV(file('trips.txt')).filter((t) => routeIds.has(t.route_id));
const tripIds = new Set(trips.map((t) => t.trip_id));
const startsWithTrip = (l) => {
  const m = l.match(/^"([^"]*)"/);
  return m && tripIds.has(m[1]);
};
const freqs = parseCSV(file('frequencies.txt'), startsWithTrip);
const stopTimes = parseCSV(file('stop_times.txt'), startsWithTrip);
const stops = parseCSV(file('stops.txt'));
const stopById = Object.fromEntries(stops.map((s) => [s.stop_id, s]));

const shapeIds = new Set(trips.map((t) => t.shape_id));
const shapePts = {};
for (const r of parseCSV(file('shapes.txt'), (l) => {
  const m = l.match(/^"([^"]*)"/);
  return m && shapeIds.has(m[1]);
})) {
  (shapePts[r.shape_id] ??= []).push([+r.shape_pt_sequence, +r.shape_pt_lat, +r.shape_pt_lon]);
}
for (const k in shapePts) shapePts[k].sort((a, b) => a[0] - b[0]);

function hourlyHeadways(tripId) {
  const hw = new Array(24).fill(0);
  for (const f of freqs.filter((f) => f.trip_id === tripId)) {
    const h0 = parseInt(f.start_time, 10);
    const h1 = parseInt(f.end_time, 10);
    for (let h = h0; h <= h1 && h < 24; h++) hw[h] = +f.headway_secs;
  }
  return hw;
}

function serviceDays(serviceId) {
  const c = calendar[serviceId];
  if (!c) return 'all';
  const wk = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].every((d) => c[d] === '1');
  const sat = c.saturday === '1';
  const sun = c.sunday === '1';
  if (wk && sat && sun) return 'all';
  if (wk && !sat && !sun) return 'weekdays';
  if (wk && sat) return 'mon-sat';
  return 'other';
}

// ---------------------------------------------------------------- linhas e serviços
const railStops = new Map(); // stop_id -> {id, name, p, lines:Set}
const lineOut = [];
const donorPaths = [];
const JOIN_DONOR = 0.36;

for (const meta of LINES) {
  const services = [];
  for (const routeId of meta.routes) {
    const rt = trips.filter((t) => t.route_id === routeId).sort((a, b) => a.direction_id - b.direction_id);
    const t0 = rt.find((t) => t.direction_id === '0');
    const t1 = rt.find((t) => t.direction_id === '1');
    const seq = (t) => stopTimes.filter((s) => s.trip_id === t.trip_id).sort((a, b) => a.stop_sequence - b.stop_sequence).map((s) => s.stop_id);
    const s0 = seq(t0);
    const s1 = seq(t1);
    const rev = [...s1].reverse();
    if (rev.join() !== s0.join()) {
      console.warn(`  ! ${routeId}: sentidos com paradas diferentes`);
    }

    // traçado: shape do sentido 0
    const raw = shapePts[t0.shape_id].map(([, lat, lon]) => proj(lat, lon));
    const dedup = raw.filter((p, i) => i === 0 || dist(p, raw[i - 1]) > 0.002);
    let simp = simplifyDP(dedup, 0.004);
    // Alguns shapes do GTFS não chegam até a estação terminal (ex.: Linha 12 começa no
    // Tatuapé, não no Brás). Completa o trecho com o traçado de outra linha que já passa
    // pelas duas estações.
    const stopP = (sid) => proj(+stopById[sid].stop_lat, +stopById[sid].stop_lon);
    const borrow = (aStop, bStop) => {
      for (const sv of donorPaths) {
        const ia = sv.stops.findIndex((p) => dist(p, stopP(aStop)) < JOIN_DONOR);
        const ib = sv.stops.findIndex((p) => dist(p, stopP(bStop)) < JOIN_DONOR);
        if (ia < 0 || ib < 0) continue;
        const sa = projectOnPath(sv.path, sv.cum, stopP(aStop)).s;
        const sb = projectOnPath(sv.path, sv.cum, stopP(bStop)).s;
        const lo = Math.min(sa, sb), hi = Math.max(sa, sb);
        const seg = sv.path.filter((_, i) => sv.cum[i] >= lo && sv.cum[i] <= hi);
        return sa <= sb ? seg : seg.reverse();
      }
      return null;
    };
    if (dist(stopP(s0[0]), simp[0]) > 0.15) {
      const seg = borrow(s0[0], s0[1]);
      if (seg) {
        const k = projectOnPath(simp, cumLengths(simp), seg.at(-1)).i;
        simp = seg.concat(simp.slice(k + 1));
        console.log(`  * ${routeId}: trecho inicial completado com traçado de outra linha`);
      }
    }
    if (dist(stopP(s0.at(-1)), simp.at(-1)) > 0.15) {
      const seg = borrow(s0.at(-2), s0.at(-1));
      if (seg) {
        const k = projectOnPath(simp, cumLengths(simp), seg[0]).i;
        simp = simp.slice(0, k + 1).concat(seg);
        console.log(`  * ${routeId}: trecho final completado com traçado de outra linha`);
      }
    }
    const path = smoothResample(simp, 0.03);
    const cum = cumLengths(path);
    donorPaths.push({ path, cum, stops: s0.map(stopP) });

    let from = 0;
    const stopList = [];
    for (const sid of s0) {
      const st = stopById[sid];
      const p = proj(+st.stop_lat, +st.stop_lon);
      const pr = projectOnPath(path, cum, p, Math.max(0, from - 2));
      if (pr.d > 0.15) console.warn(`  ! ${routeId}: estação ${st.stop_name} a ${(pr.d * 1000).toFixed(0)} m do traçado`);
      from = pr.i;
      stopList.push({ stop: sid, s: r3(pr.s) });
      if (!railStops.has(sid)) railStops.set(sid, { id: sid, name: prettyName(st.stop_name), p, lines: new Set() });
      railStops.get(sid).lines.add(meta.id);
    }
    for (let i = 1; i < stopList.length; i++) {
      if (stopList[i].s <= stopList[i - 1].s) console.warn(`  ! ${routeId}: ordem das estações fora do traçado em ${i}`);
    }

    const headsign = (t) => HEADSIGN_FIX[t.trip_headsign] ?? prettyName(stopById[(t === t0 ? s0 : s1).at(-1)].stop_name);
    services.push({
      id: routeId,
      days: serviceDays(t0.service_id),
      path: flat(path),
      length: r3(cum.at(-1)),
      stops: stopList,
      dirs: [
        { headsign: headsign(t0), hw: hourlyHeadways(t0.trip_id) },
        { headsign: headsign(t1), hw: hourlyHeadways(t1.trip_id) },
      ],
    });
    console.log(`  ${meta.id.padEnd(4)} ${routeId.padEnd(9)} ${cum.at(-1).toFixed(1)} km, ${stopList.length} estações, ${path.length} pts`);
  }
  lineOut.push({ id: meta.id, gtfsColor: '#' + routeById[meta.routes[0]].route_color, services });
}

// ---------------------------------------------------------------- complexos de estações (integrações)
// Paradas de linhas diferentes a menos de JOIN_KM viram a mesma estação (integração).
const JOIN_KM = 0.36;
const stopArr = [...railStops.values()];
const parent = new Map(stopArr.map((s) => [s.id, s.id]));
const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
for (let i = 0; i < stopArr.length; i++) {
  for (let j = i + 1; j < stopArr.length; j++) {
    const a = stopArr[i], b = stopArr[j];
    const d = dist(a.p, b.p);
    const sameLine = [...a.lines].some((l) => b.lines.has(l));
    if ((sameLine && d < 0.12) || (!sameLine && d < JOIN_KM)) parent.set(find(a.id), find(b.id));
  }
}
const groups = new Map();
for (const s of stopArr) {
  const r = find(s.id);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(s);
}

const stationOut = [];
const stationOfStop = {};
const LINE_ORDER = Object.fromEntries(LINES.map((l, i) => [l.id, i]));
for (const members of groups.values()) {
  const lines = [...new Set(members.flatMap((m) => [...m.lines]))].sort((a, b) => LINE_ORDER[a] - LINE_ORDER[b]);
  const cx = members.reduce((a, m) => a + m.p[0], 0) / members.length;
  const cz = members.reduce((a, m) => a + m.p[1], 0) / members.length;
  // nome: o mais frequente; desempate pelo mais longo
  const names = {};
  for (const m of members) names[m.name] = (names[m.name] ?? 0) + 1;
  const name = Object.entries(names).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
  const id = 'S' + stationOut.length;
  const lineNames = {};
  for (const m of members) for (const l of m.lines) lineNames[l] = m.name;
  stationOut.push({ id, name, x: r3(cx), z: r3(cz), lines, lineNames, stops: members.map((m) => m.id) });
  for (const m of members) stationOfStop[m.id] = id;
}
for (const L of lineOut) for (const sv of L.services) for (const st of sv.stops) st.station = stationOfStop[st.stop];

// "conexão a pé": estações distintas e próximas, sem linhas em comum.
// Algumas transferências fora da estação são gratuitas por corredor interno (FREE_LINKS).
const FREE_LINKS = [['Paulista', 'Consolação']];
const WALK_LINKS = [['Luz', 'Júlio Prestes']];
const linked = (list, a, b) => list.some(([p, q]) => (a.name === p && b.name === q) || (a.name === q && b.name === p));
for (const a of stationOut) {
  a.walk = stationOut
    .filter((b) => b !== a && (linked(FREE_LINKS, a, b) || linked(WALK_LINKS, a, b) ||
      (dist([a.x, a.z], [b.x, b.z]) < 0.55 && !b.lines.some((l) => a.lines.includes(l)))))
    .map((b) => ({ station: b.id, m: Math.round(dist([a.x, a.z], [b.x, b.z]) * 1000), free: linked(FREE_LINKS, a, b) }));
}

console.log(`\n${stationOut.length} estações; integrações:`);
for (const s of stationOut.filter((s) => s.lines.length > 1)) console.log(`  ${s.name}: ${s.lines.join(' ')}`);
console.log('Conexões a pé:');
for (const s of stationOut.filter((s) => s.walk.length)) console.log(`  ${s.name} -> ${s.walk.map((w) => stationOut.find((o) => o.id === w.station).name + ' ' + w.m + 'm').join(', ')}`);

// ---------------------------------------------------------------- terminais de ônibus (SPTrans)
function cleanTerminal(n) {
  let s = n.replace(/\s+/g, ' ').trim();
  s = s.replace(/,\s*\d+$/, '');
  s = s.replace(/\s*Ref\.:.*$/i, '');
  s = s.replace(/\s*-?\s*\b(Plat\.?|Plataforma|Pl\.?|Pmv|Desemb\.?)\b.*$/i, '');
  s = s.replace(/\s*\((lado|sul|norte)[^)]*\)/i, '').replace(/\s+Lado\s+(Norte|Sul)\b.*$/i, '');
  s = s.replace(/\s+(Pl\s?\d+|\d+)$/i, '');
  s = s.replace(/\s*-\s*(Sul|Central)$/i, '').replace(/\s+(Sul|Central)$/i, '');
  s = s.replace(/\bSto\.\s*/g, 'Santo ').replace(/\bSta\.\s*/g, 'Santa ')
    .replace(/\bS\.\s*Mateus/g, 'São Mateus').replace(/\bS\.\s*Miguel/g, 'São Miguel')
    .replace(/\bV\.\s*Prudente/g, 'Vila Prudente').replace(/\bSacoma\b/g, 'Sacomã')
    .replace(/\bCptm\b/g, 'CPTM').replace(/\bDo\b/g, 'do').replace(/\(cidade Universitária\)/, '(Cidade Universitária)')
    .replace(/Estação CPTM /, '').replace(/^Terminal CPTM /, 'Terminal ');
  return s.replace(/\s{2,}/g, ' ').trim();
}

const termStops = stops.filter((s) => /^term(inal|\.)/i.test(s.stop_name));
const termGroups = new Map();
for (const s of termStops) {
  const name = cleanTerminal(s.stop_name);
  if (!termGroups.has(name)) termGroups.set(name, []);
  termGroups.get(name).push(proj(+s.stop_lat, +s.stop_lon));
}
let terminals = [];
for (const [name, pts] of termGroups) {
  const c = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  if (terminals.some((t) => dist(t.p, c) < 0.06)) continue;
  terminals.push({ name, p: c });
}

const poiOut = [];
for (const t of terminals) {
  let best = null;
  for (const s of stationOut) {
    const d = dist(t.p, [s.x, s.z]);
    if (d < 0.5 && (!best || d < best.d)) best = { s, d };
  }
  poiOut.push({ type: 'bus', name: t.name, x: r3(t.p[0]), z: r3(t.p[1]), station: best?.s.id ?? null, m: best ? Math.round(best.d * 1000) : null });
}

// Terminais rodoviários e aeroportos (coordenadas públicas dos equipamentos).
const SPECIAL = [
  { type: 'rodoviaria', name: 'Terminal Rodoviário Tietê', lat: -23.5163, lon: -46.6252, station: 'Portuguesa-Tietê' },
  { type: 'rodoviaria', name: 'Terminal Rodoviário Barra Funda', lat: -23.5258, lon: -46.6669, station: 'Palmeiras-Barra Funda' },
  { type: 'rodoviaria', name: 'Terminal Rodoviário Jabaquara', lat: -23.6461, lon: -46.6413, station: 'Jabaquara' },
  { type: 'airport', name: 'Aeroporto Internacional de Guarulhos (GRU)', lat: -23.4313, lon: -46.4730, station: 'Aeroporto-Guarulhos' },
  { type: 'airport', name: 'Aeroporto de Congonhas (CGH)', lat: -23.6267, lon: -46.6556, station: 'Aeroporto de Congonhas' },
];
for (const sp of SPECIAL) {
  const st = stationOut.find((s) => s.name === sp.station);
  if (!st) console.warn(`  ! estação não encontrada para POI: ${sp.station}`);
  const [x, z] = proj(sp.lat, sp.lon);
  poiOut.push({ type: sp.type, name: sp.name, x: r3(x), z: r3(z), station: st?.id ?? null, m: st ? Math.round(dist([x, z], [st.x, st.z]) * 1000) : null });
}
console.log(`\n${poiOut.length} pontos de interesse (${poiOut.filter((p) => p.station).length} integrados a estações)`);
for (const p of poiOut.filter((p) => p.station)) console.log(`  ${p.type.padEnd(10)} ${p.name} -> ${stationOut.find((s) => s.id === p.station).name} (${p.m} m)`);

// ---------------------------------------------------------------- contexto OSM
function assembleRings(ways) {
  // ways: arrays de [x,z]; junta pontas coincidentes
  const segs = ways.map((w) => w.slice());
  const rings = [];
  const key = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  while (segs.length) {
    let ring = segs.pop();
    let changed = true;
    while (changed && key(ring[0]) !== key(ring.at(-1))) {
      changed = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (key(s[0]) === key(ring.at(-1))) { ring = ring.concat(s.slice(1)); }
        else if (key(s.at(-1)) === key(ring.at(-1))) { ring = ring.concat(s.slice(0, -1).reverse()); }
        else if (key(s.at(-1)) === key(ring[0])) { ring = s.concat(ring.slice(1)); }
        else if (key(s[0]) === key(ring[0])) { ring = s.slice().reverse().concat(ring.slice(1)); }
        else continue;
        segs.splice(i, 1);
        changed = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

const osm = (n) => JSON.parse(readFileSync(new URL(n, RAW), 'utf8')).elements;
const geomPts = (g) => g.map((p) => proj(p.lat, p.lon));

const rivers = [];
for (const e of osm('osm-rivers.json')) {
  if (!e.geometry) continue;
  const pts = simplifyDP(geomPts(e.geometry), 0.03);
  if (pts.length > 1) rivers.push({ name: e.tags.name, major: /Tiet|Pinheiros/.test(e.tags.name), pts: flat(pts) });
}

const lakes = [];
for (const e of osm('osm-lakes.json')) {
  let outer;
  if (e.type === 'relation') outer = e.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => geomPts(m.geometry));
  else if (e.geometry) outer = [geomPts(e.geometry)];
  else continue;
  for (const ring of assembleRings(outer)) {
    const closed = dist(ring[0], ring.at(-1)) < 0.01;
    const s = simplifyDP(ring, 0.04);
    if (s.length > 3 && closed) lakes.push({ name: e.tags.name, pts: flat(s) });
  }
}

const cityRel = osm('osm-city.json')[0];
const cityRings = assembleRings(cityRel.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => geomPts(m.geometry)))
  .filter((r) => r.length > 50)
  .map((r) => flat(simplifyDP(r, 0.05)));

// ---------------------------------------------------------------- saída
const out = {
  version: 1,
  generated: new Date().toISOString(),
  sources: {
    gtfs: 'SPTrans GTFS (via Mobility Database mdb-8)',
    gtfsDate: Object.values(zip).length ? 'feed ' + (calendar.USD?.start_date ?? '') + '–' + (calendar.USD?.end_date ?? '') : '',
    osm: '© colaboradores do OpenStreetMap (ODbL)',
  },
  projection: { lat0: LAT0, lon0: LON0, kx: KX, kz: KZ, unit: 'km' },
  lines: lineOut,
  stations: stationOut.map(({ stops, ...s }) => s),
  pois: poiOut,
  context: { rivers, lakes, city: cityRings },
};

mkdirSync(OUT_DIR, { recursive: true });
const json = JSON.stringify(out);
writeFileSync(new URL('network.json', OUT_DIR), json);
console.log(`\nOK: public/data/network.json (${(json.length / 1024).toFixed(0)} KB)`);
