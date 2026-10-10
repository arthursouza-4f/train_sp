import { LINES } from './lines-meta.js';
import { neonize, needsDarkText, lowerBound, hexToRgb } from '../core/util.js';

export async function loadNetwork(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao carregar ${url}: ${res.status}`);
  return prepare(await res.json());
}

function prepare(raw) {
  const stations = raw.stations.map((s, i) => ({ ...s, index: i, services: [], pois: [], walkTo: [] }));
  const stationById = new Map(stations.map((s) => [s.id, s]));

  const lines = raw.lines.map((L, li) => {
    const meta = LINES.find((m) => m.id === L.id);
    const line = {
      ...meta,
      index: li,
      neon: meta.neon ? hexToRgb(meta.neon) : neonize(meta.color),
      darkText: needsDarkText(meta.color),
      services: [],
      stations: [],
    };
    line.services = L.services.map((sv, si) => {
      const path = new Float32Array(sv.path);
      const n = path.length / 2;
      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        cum[i] = cum[i - 1] + Math.hypot(path[2 * i] - path[2 * i - 2], path[2 * i + 1] - path[2 * i - 1]);
      }
      const service = {
        id: sv.id,
        key: `${line.id}:${si}`,
        line,
        index: si,
        days: sv.days,
        path,
        cum,
        length: cum[n - 1],
        stops: sv.stops.map((st) => ({ s: st.s, station: stationById.get(st.station) })),
        dirs: sv.dirs,
      };
      for (const st of service.stops) {
        if (!st.station.services.includes(service)) st.station.services.push(service);
        if (!line.stations.includes(st.station)) line.stations.push(st.station);
      }
      return service;
    });
    line.length = line.services.reduce((a, s) => a + (s.stops.at(-1).s - s.stops[0].s), 0);
    return line;
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));
  for (const s of stations) {
    s.lineObjs = s.lines.map((id) => lineById.get(id));
    s.isTransfer = s.lines.length > 1;
    s.isTerminal = s.services.some((sv) => sv.stops[0].station === s || sv.stops.at(-1).station === s);
  }
  for (const s of stations) {
    s.walkTo = (s.walk ?? []).map((w) => ({ station: stationById.get(w.station), m: w.m, free: w.free }));
  }

  const pois = raw.pois.map((p, i) => ({ ...p, index: i, stationObj: p.station ? stationById.get(p.station) : null }));
  for (const p of pois) if (p.stationObj) p.stationObj.pois.push(p);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of stations) {
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
  }

  return {
    raw,
    lines,
    lineById,
    stations,
    stationById,
    pois,
    context: raw.context,
    sources: raw.sources,
    bbox: { minX, maxX, minZ, maxZ },
  };
}

/** Ponto do traçado a `s` km do início. Escreve em `out` = {x, z, a (ângulo do rumo)}. */
export function pathPoint(service, s, out) {
  const { path, cum } = service;
  const n = cum.length;
  if (s <= 0) s = 0;
  if (s >= cum[n - 1]) s = cum[n - 1];
  let i = lowerBound(cum, s) - 1;
  if (i < 0) i = 0;
  if (i > n - 2) i = n - 2;
  const segLen = cum[i + 1] - cum[i] || 1e-6;
  const t = (s - cum[i]) / segLen;
  const x0 = path[2 * i], z0 = path[2 * i + 1];
  const x1 = path[2 * i + 2], z1 = path[2 * i + 3];
  out.x = x0 + (x1 - x0) * t;
  out.z = z0 + (z1 - z0) * t;
  out.a = Math.atan2(z1 - z0, x1 - x0);
  return out;
}
