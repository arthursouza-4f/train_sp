import './style.css';
import { loadNetwork } from './data/network.js';
import { Simulator } from './sim/model.js';
import { SimClock } from './core/time.js';
import { Stage } from './render/stage.js';
import { createGround } from './render/ground.js';
import { createRails } from './render/rails.js';
import { createStations } from './render/stations.js';
import { createTrains } from './render/trains.js';
import { createLabels } from './ui/labels.js';
import { createUI } from './ui/ui.js';
import { clamp } from './core/util.js';

const INTRO = 3.2; // s

async function main() {
  const loader = document.getElementById('loader');
  let net;
  try {
    net = await loadNetwork(`${import.meta.env.BASE_URL}data/network.json`);
  } catch (err) {
    loader.querySelector('p').textContent = 'Não foi possível carregar os dados da rede.';
    throw err;
  }

  let stage;
  try {
    stage = new Stage(document.getElementById('scene'));
  } catch (err) {
    loader.querySelector('p').textContent = 'Seu navegador não suporta WebGL 2, necessário para o mapa 3D.';
    throw err;
  }
  const bb = net.bbox;
  stage.bounds = { minX: bb.minX - 6, maxX: bb.maxX + 6, minZ: bb.minZ - 6, maxZ: bb.maxZ + 6 };

  createGround(stage, net.context);
  const rails = createRails(stage, net);
  const stations = createStations(stage, net, rails.LIFT);
  const trainsR = createTrains(stage, rails.LIFT);
  const clock = new SimClock();
  const sim = new Simulator(net);

  // ------------------------------------------------------------ seleção
  const sel = { lines: new Set(), station: null, train: null, poi: null, follow: false };
  let labelsDirty = true;

  const CORE = { minX: -17, maxX: 19, minZ: -13, maxZ: 13 }; // centro expandido
  const resetView = (duration = 1.6) =>
    stage.fitBox(CORE.minX, CORE.maxX, CORE.minZ, CORE.maxZ, { polar: 0.82, azimuth: -0.18, padding: 1.0, duration });

  // áreas da tela cobertas pela interface: a câmera centraliza no espaço livre
  const topbar = document.querySelector('.topbar');
  const sheetEl = document.getElementById('sheet');
  const navEl = document.getElementById('lines-nav');
  stage.onBeforeFly = () => {
    const top = topbar.getBoundingClientRect().bottom + 6;
    const open = !sheetEl.hidden;
    if (stage.width >= 900) {
      stage.insets = { top, left: navEl.getBoundingClientRect().right + 10, right: open ? sheetEl.offsetWidth + 24 : 64, bottom: 16 };
    } else {
      stage.insets = { top, left: 0, right: 0, bottom: open ? sheetEl.offsetHeight + 4 : navEl.offsetHeight };
    }
  };

  function applySelection() {
    stations.setSelection(sel.lines, sel.station);
    ui.setNavSelection(sel.lines);
    labelsDirty = true;
  }

  function fitLine(line) {
    const pts = line.services.flatMap((sv) => Array.from(sv.path));
    const a = line.services[0].stops[0].station;
    const b = line.services[0].stops.at(-1).station;
    stage.fitPoints(pts, { polar: 0.6, padding: 1.12, align: Math.atan2(b.z - a.z, b.x - a.x) });
  }

  function focusStation(s) {
    const d = clamp(stage.distance, 3.5, 8);
    stage.flyTo({ target: { x: s.x, z: s.z }, distance: d, polar: Math.max(0.55, Math.min(0.95, currentPolar())), duration: 1.3 });
  }

  function currentPolar() {
    const off = stage.camera.position.clone().sub(stage.controls.target);
    return Math.acos(clamp(off.y / off.length(), -1, 1));
  }

  function selectLine(line, { toggle = false, fly = true } = {}) {
    if (toggle && sel.lines.size === 1 && sel.lines.has(line.id) && !sel.station && !sel.train && !sel.poi) {
      clearSelection(true);
      return;
    }
    Object.assign(sel, { lines: new Set([line.id]), station: null, train: null, poi: null, follow: false });
    applySelection();
    ui.showLine(line);
    if (fly) fitLine(line);
  }

  function selectStation(s, { fly = true } = {}) {
    Object.assign(sel, { lines: new Set(s.lines), station: s, train: null, poi: null, follow: false });
    applySelection();
    ui.showStation(s);
    if (fly) focusStation(s);
  }

  function selectTrain(tr) {
    Object.assign(sel, { lines: new Set([tr.line.id]), station: null, train: tr, poi: null, follow: false });
    applySelection();
    ui.showTrain(tr);
    labels.updateTrainTag(tr, trainTagHtml(tr));
    stage.flyTo({ target: { x: tr.x, z: tr.z }, distance: Math.min(stage.distance, 7), duration: 1.1 });
  }

  function selectPoi(p) {
    const s = p.stationObj;
    Object.assign(sel, { lines: new Set(s?.lines ?? []), station: s ?? null, train: null, poi: p, follow: false });
    applySelection();
    ui.showPoi(p);
    stage.flyTo({ target: { x: p.x, z: p.z }, distance: clamp(stage.distance, 2.5, 6), duration: 1.2 });
  }

  function clearSelection(fly) {
    Object.assign(sel, { lines: new Set(), station: null, train: null, poi: null, follow: false });
    applySelection();
    ui.close();
    labels.updateTrainTag(null);
    if (fly) resetView(1.3);
  }

  const trainTagHtml = (tr) =>
    `<span class="badge sm ${tr.line.darkText ? 'dark-text' : ''}" style="--c:${tr.line.color}">${tr.line.number}</span> → ${tr.run.headsign}`;

  const app = {
    net,
    sim,
    clock,
    selectLine,
    selectStation,
    selectTrain,
    selectPoi,
    clearSelection,
    fitLine,
    focusStation,
    setFollow(on) {
      sel.follow = on && !!sel.train;
      if (sel.follow) stage.flyTo({ target: { x: sel.train.x, z: sel.train.z }, distance: Math.min(stage.distance, 4.5), polar: 0.9, duration: 1 });
    },
    isFollowing: () => sel.follow,
    onTimeJump() {
      labelsDirty = true;
      ui.view?.tick?.();
    },
  };
  const ui = createUI(app);
  const labels = createLabels(document.getElementById('labels'), stage, net, rails.LIFT, {
    onStation: (s) => selectStation(s),
    onPoi: (p) => selectPoi(p),
    onLine: (l) => selectLine(l),
  });

  // ------------------------------------------------------------ toque / clique no mapa
  const canvas = stage.canvas;
  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, multi: !e.isPrimary };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId || down.multi) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved > 7 || dt > 650) return;
    const r = canvas.getBoundingClientRect();
    pick(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'touch');
  });
  stage.onUserStart = () => {
    if (sel.follow) {
      sel.follow = false;
      if (ui.view?.type === 'train') ui.showTrain(sel.train);
    }
  };

  const P = { x: 0, y: 0, depth: 0 };
  function pick(x, y, touch) {
    const tTrain = touch ? 26 : 18;
    const tStation = touch ? 20 : 13;
    const tLine = touch ? 18 : 11;
    let bestTrain = null;
    let dTrain = Infinity;
    for (const tr of sim.trains) {
      if (tr.alpha < 0.3) continue;
      if (sel.lines.size && !sel.lines.has(tr.line.id)) continue;
      if (!stage.project(tr.x, rails.LIFT, tr.z, P)) continue;
      const d = Math.hypot(P.x - x, P.y - y);
      if (d < dTrain) { dTrain = d; bestTrain = tr; }
    }
    let bestSt = null;
    let dSt = Infinity;
    for (const s of net.stations) {
      if (!stage.project(s.x, rails.LIFT, s.z, P)) continue;
      const d = Math.hypot(P.x - x, P.y - y) - (s.isTransfer ? 3 : 0);
      if (d < dSt) { dSt = d; bestSt = s; }
    }
    if (bestTrain && dTrain < tTrain && (dTrain < dSt * 0.9 || dSt > tStation)) return selectTrain(bestTrain);
    if (bestSt && dSt < tStation) return selectStation(bestSt);

    // linha mais próxima (distância ao segmento projetado)
    let bestLine = null;
    let dLine = Infinity;
    const A = { x: 0, y: 0, depth: 0 };
    for (const line of net.lines) {
      for (const sv of line.services) {
        let has = false;
        for (let i = 0; i < sv.path.length; i += 4) {
          const ok = stage.project(sv.path[i], rails.LIFT, sv.path[i + 1], P);
          if (ok && has) {
            const vx = P.x - A.x, vy = P.y - A.y;
            const l2 = vx * vx + vy * vy || 1e-6;
            const t = clamp(((x - A.x) * vx + (y - A.y) * vy) / l2, 0, 1);
            const d = Math.hypot(x - (A.x + t * vx), y - (A.y + t * vy));
            if (d < dLine) { dLine = d; bestLine = line; }
          }
          has = ok;
          A.x = P.x; A.y = P.y;
        }
      }
    }
    if (bestLine && dLine < tLine) return selectLine(bestLine);
    if (sel.lines.size || sel.station || sel.train || sel.poi) clearSelection(false);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) clearSelection(false);
  });

  // ------------------------------------------------------------ ferramentas
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (sel.train || sel.station || sel.lines.size) clearSelection(true);
    else resetView(1.3);
  });
  const tiltBtn = document.getElementById('btn-tilt');
  tiltBtn.addEventListener('click', () => {
    const flat = currentPolar() < 0.2;
    stage.flyTo({ polar: flat ? 0.85 : 0.001, duration: 1 });
    tiltBtn.textContent = flat ? '2D' : '3D';
  });

  if (import.meta.env.DEV) window.__tv = { stage, rails, stations, trainsR, sim, clock, net, sel, app };

  // ------------------------------------------------------------ loop
  stage.camera.position.set(0, 150, 0.01);
  stage.controls.target.set(0, 0, 0);
  stage.camera.lookAt(stage.controls.target);
  setTimeout(() => resetView(INTRO), 250);
  tiltBtn.textContent = '2D';

  const t0 = performance.now();
  let last = t0;
  let lastLabels = 0;
  const camKey = { px: 0, py: 0, pz: 0, tx: 0, tz: 0 };
  let lastTrainId = null;
  let firstFrame = true;

  function frame(now) {
    requestAnimationFrame(frame);
    tick(now);
  }

  function tick(now) {
    const dtMs = now - last;
    const dt = clamp(dtMs / 1000, 0, 0.1);
    last = now;
    const T = (now - t0) / 1000;
    stage.shared.uTime.value = T;

    if (T < INTRO + 0.5) rails.setReveal(clamp(T / INTRO, 0, 1));
    stations.uniforms.uAppear.value = clamp((T - 0.35) / INTRO, 0, 1);

    const state = clock.state();
    const trains = sim.update(state);

    // trem selecionado: o objeto é recriado só quando a viagem termina
    let curTrain = null;
    if (sel.train) {
      curTrain = sim.byId.get(sel.train.id) ?? null;
      if (curTrain) sel.train = curTrain;
      else sel.follow = false;
    }
    if (sel.follow && curTrain && !stage.anim) {
      const c = stage.controls;
      const k = 1 - Math.exp(-dt * 5);
      const dx = (curTrain.x - c.target.x) * k;
      const dz = (curTrain.z - c.target.z) * k;
      c.target.x += dx;
      c.target.z += dz;
      stage.camera.position.x += dx;
      stage.camera.position.z += dz;
    }

    stage.update(dt);
    const dist = stage.distance;
    stage.shared.uFog.value.set(dist * 1.7 + 8, dist * 4.2 + 45);

    rails.update(dt, { selectedLines: sel.lines, distance: dist });
    rails.paintTrails(trains);
    stations.update(dt, dist);
    trainsR.update(trains, { selectedTrain: curTrain, selectedLines: sel.lines, distance: dist, appear: T > INTRO * 0.75 ? 1 : 0 });

    // rótulos: a cada quadro enquanto a câmera se move; senão, 4×/s
    const cp = stage.camera.position;
    const tg = stage.controls.target;
    const moved =
      Math.abs(cp.x - camKey.px) + Math.abs(cp.y - camKey.py) + Math.abs(cp.z - camKey.pz) + Math.abs(tg.x - camKey.tx) + Math.abs(tg.z - camKey.tz) > 1e-4 * dist;
    if (T > INTRO * 0.6 && (moved || labelsDirty || now - lastLabels > 250)) {
      labels.update({ distance: dist, selectedLines: sel.lines, selectedStation: sel.station, isMobile: stage.isMobile });
      Object.assign(camKey, { px: cp.x, py: cp.y, pz: cp.z, tx: tg.x, tz: tg.z });
      labelsDirty = false;
      lastLabels = now;
    }
    const tagId = curTrain?.id ?? null;
    labels.updateTrainTag(curTrain, tagId !== lastTrainId && curTrain ? trainTagHtml(curTrain) : undefined);
    lastTrainId = tagId;

    ui.frame(dt, state, trains.length);
    stage.render();
    if (!firstFrame) stage.adapt(dtMs, now);
    if (firstFrame) {
      firstFrame = false;
      loader.classList.add('out');
      setTimeout(() => loader.remove(), 800);
    }
  }
  requestAnimationFrame(frame);
  if (import.meta.env.DEV) {
    // depuração: renderiza quadros manualmente (útil com a aba em segundo plano)
    window.__tv.step = (n = 1, ms = 33) => {
      for (let i = 0; i < n; i++) tick(last + ms);
    };
  }
}

main();
