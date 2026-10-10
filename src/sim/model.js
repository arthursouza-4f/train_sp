// Estimativa da posição dos trens.
//
// 1. Partidas: cada terminal despacha trens do horário de abertura ao de fechamento, com o
//    intervalo (headway) da tabela oficial para aquela hora (GTFS SPTrans, frequencies.txt).
// 2. Percurso: entre estações o trem acelera até a velocidade de cruzeiro, mantém e freia
//    (perfil trapezoidal). Em cada plataforma soma-se um tempo de parada fixo.
// 3. Posição = distância percorrida desde a partida, projetada no traçado real da linha.

import { lowerBound } from '../core/util.js';
import { pathPoint } from '../data/network.js';

const TERMINAL_HOLD = 40; // s que o trem continua visível parado no terminal de chegada
const FADE = 6; // s de fade in/out

const parseHM = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 3600 + m * 60;
};

function segKin(D, { vmax, acc, dec }) {
  const dA = (vmax * vmax) / (2 * acc);
  const dD = (vmax * vmax) / (2 * dec);
  if (dA + dD <= D) {
    const tA = vmax / acc;
    const tD = vmax / dec;
    const tC = (D - dA - dD) / vmax;
    return { D, v: vmax, tA, tC, dA, T: tA + tC + tD, acc, dec };
  }
  const v = Math.sqrt((2 * D * acc * dec) / (acc + dec));
  const tA = v / acc;
  const tD = v / dec;
  return { D, v, tA, tC: 0, dA: (v * v) / (2 * acc), T: tA + tD, acc, dec };
}

/** [distância percorrida no trecho (m), velocidade (m/s)] após `tau` s da partida. */
function segPos(seg, tau) {
  if (tau <= 0) return [0, 0];
  if (tau >= seg.T) return [seg.D, 0];
  if (tau < seg.tA) return [0.5 * seg.acc * tau * tau, seg.acc * tau];
  if (tau < seg.tA + seg.tC) return [seg.dA + seg.v * (tau - seg.tA), seg.v];
  const r = seg.T - tau;
  return [seg.D - 0.5 * seg.dec * r * r, seg.dec * r];
}

export function headwayAt(hw, hour, min = 0) {
  let v = hw[hour];
  if (!v) {
    for (let d = 1; d < 24 && !v; d++) v = hw[(hour + 24 - d) % 24] || hw[(hour + d) % 24];
  }
  return Math.max(v || 600, min);
}

function profile(order, u, kin) {
  const n = order.length;
  const arr = new Float64Array(n);
  const dep = new Float64Array(n);
  const segs = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    arr[i] = t;
    if (i > 0 && i < n - 1) t += order[i].station.isTransfer ? kin.dwellX : kin.dwell;
    dep[i] = t;
    if (i < n - 1) {
      const seg = segKin(Math.max(1, u[i + 1] - u[i]), kin);
      segs.push(seg);
      t += seg.T;
    }
  }
  return { arr, dep, segs, T: t };
}

function buildRun(sv, dir) {
  const line = sv.line;
  const n = sv.stops.length;
  const order = dir === 0 ? sv.stops : [...sv.stops].reverse();
  const s0 = sv.stops[0].s;
  const sN = sv.stops[n - 1].s;
  const u = order.map((st) => (dir === 0 ? st.s - s0 : sN - st.s) * 1000);
  let kin = line.kin;
  // calibra a velocidade de cruzeiro para o tempo típico de viagem da linha (só no serviço
  // principal; ramais usam a mesma velocidade calibrada)
  const target = line.tripMin && sv.index === 0 ? line.tripMin * 60 : null;
  if (target) {
    let lo = 4;
    let hi = 40;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (profile(order, u, { ...kin, vmax: mid }).T > target) lo = mid;
      else hi = mid;
    }
    line.vCal = Math.min(kin.vmax * 1.15, (lo + hi) / 2);
  }
  if (line.vCal) kin = { ...kin, vmax: line.vCal };
  const { arr, dep, segs } = profile(order, u, kin);
  return {
    sv,
    dir,
    order,
    u,
    arr,
    dep,
    segs,
    T: arr[n - 1],
    s0,
    sN,
    headsign: sv.dirs[dir].headsign,
    hw: sv.dirs[dir].hw,
    depCache: new Map(),
  };
}

/** Horários de partida (s desde 00:00 do dia de operação) do terminal de origem. */
export function departures(run, type) {
  let cached = run.depCache.get(type);
  if (cached) return cached;
  const line = run.sv.line;
  const out = [];
  const weekdaysOnly = line.weekdaysOnly || run.sv.days === 'weekdays';
  const hours = run.hw.map((h, i) => (h > 0 ? i : -1)).filter((i) => i >= 0);
  if (hours.length && !(weekdaysOnly && type !== 'wkd')) {
    const open = line.open ? parseHM(line.open) : hours[0] * 3600;
    let close = line.close ? parseHM(line.close) : (hours.at(-1) + 1) * 3600 - 60;
    if (type === 'sat' && line.satClose) close = parseHM(line.satClose);
    for (let t = open; t <= close + 0.5; ) {
      out.push(t);
      t += headwayAt(run.hw, Math.floor(t / 3600) % 24, line.minHeadway);
    }
  }
  cached = Float64Array.from(out);
  run.depCache.set(type, cached);
  return cached;
}

function evalRun(run, e, tr) {
  const { arr, dep, segs, u } = run;
  const n = arr.length;
  if (e >= arr[n - 1]) {
    tr.u = u[n - 1];
    tr.v = 0;
    tr.at = n - 1;
    tr.prev = n - 1;
    tr.next = n - 1;
    tr.eta = 0;
    tr.dwellLeft = 0;
    return;
  }
  let i = lowerBound(arr, e + 1e-9) - 1;
  if (i < 0) i = 0;
  if (e < dep[i]) {
    tr.u = u[i];
    tr.v = 0;
    tr.at = i;
    tr.prev = i;
    tr.next = i + 1;
    tr.eta = arr[i + 1] - e;
    tr.dwellLeft = dep[i] - e;
  } else {
    const [d, v] = segPos(segs[i], e - dep[i]);
    tr.u = u[i] + d;
    tr.v = v;
    tr.at = -1;
    tr.prev = i;
    tr.next = i + 1;
    tr.eta = arr[i + 1] - e;
    tr.dwellLeft = 0;
  }
}

export class Simulator {
  constructor(net) {
    this.net = net;
    this.runs = [];
    for (const line of net.lines) {
      for (const sv of line.services) {
        sv.runs = [buildRun(sv, 0), buildRun(sv, 1)];
        this.runs.push(...sv.runs);
      }
    }
    this.trains = [];
    this.byId = new Map();
    this.countByLine = new Map();
    this._pt = { x: 0, z: 0, a: 0 };
  }

  update(state) {
    const list = [];
    const seen = new Map();
    this.countByLine.clear();
    for (const run of this.runs) {
      for (let dayOff = 0; dayOff < 2; dayOff++) {
        const deps = departures(run, dayOff === 0 ? state.type : state.prevType);
        if (!deps.length) continue;
        const t = state.sec + dayOff * 86400;
        const span = run.T + TERMINAL_HOLD;
        for (let i = lowerBound(deps, t - span); i < deps.length && deps[i] <= t; i++) {
          const id = `${run.sv.key}|${run.dir}|${state.day - dayOff}|${i}`;
          let tr = this.byId.get(id);
          if (!tr) tr = { id, run, line: run.sv.line, sv: run.sv, dir: run.dir, depart: deps[i] };
          const e = t - deps[i];
          tr.e = e;
          evalRun(run, e, tr);
          tr.progress = tr.u / run.u.at(-1);
          tr.s = run.dir === 0 ? run.s0 + tr.u / 1000 : run.sN - tr.u / 1000;
          pathPoint(run.sv, tr.s, this._pt);
          tr.x = this._pt.x;
          tr.z = this._pt.z;
          tr.a = run.dir === 0 ? this._pt.a : this._pt.a + Math.PI;
          tr.alpha = Math.min(1, e / FADE, (span - e) / FADE);
          seen.set(id, tr);
          list.push(tr);
          this.countByLine.set(tr.line.id, (this.countByLine.get(tr.line.id) ?? 0) + 1);
        }
      }
    }
    this.byId = seen;
    this.trains = list;
    return list;
  }

  /** Próximas chegadas estimadas numa estação: [{run, etas:[s], first?}] por linha/sentido. */
  nextArrivals(station, state, count = 3) {
    const out = [];
    for (const sv of station.services) {
      for (const run of sv.runs) {
        const k = run.order.findIndex((st) => st.station === station);
        if (k < 0 || k === run.order.length - 1) continue; // terminal de chegada: não embarca
        const etas = [];
        for (let dayOff = 1; dayOff >= 0 && etas.length < count; dayOff--) {
          const deps = departures(run, dayOff === 0 ? state.type : state.prevType);
          const t = state.sec + dayOff * 86400;
          for (let i = lowerBound(deps, t - run.dep[k]); i < deps.length && etas.length < count; i++) {
            etas.push(deps[i] + run.arr[k] - t);
          }
        }
        let first = null;
        if (!etas.length) {
          const tomorrow = departures(run, state.nextType);
          if (tomorrow.length) first = tomorrow[0] + run.arr[k];
        }
        out.push({ run, k, etas, first, closed: departures(run, state.type).length === 0 });
      }
    }
    return out;
  }
}
