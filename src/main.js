import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import { loadNetwork } from './data/network.js';
import { Simulator } from './sim/model.js';
import { SimClock } from './core/time.js';
import { createGeo } from './map/geo.js';
import { createBasemapStyle, firstSymbolLayer } from './map/basemap.js';
import { addNetworkLayers } from './map/network-layers.js';
import { addMapImages } from './map/images.js';
import { createRailsLayer } from './map/rails-layer.js';
import { createTrainsLayer } from './map/trains-layer.js';
import { createUI } from './ui/ui.js';
import { clamp, easeInOutCubic } from './core/util.js';

const INTRO = 3.2; // s: linhas se desenhando + câmera descendo até a visão inicial
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = Math.PI / 180;
// visão inicial: centro expandido (km da rede); na tela em pé, um recorte mais estreito
const CORE = { minX: -17, maxX: 19, minZ: -13, maxZ: 13 };
const CORE_PORTRAIT = { minX: -10, maxX: 12, minZ: -12, maxZ: 11 };
const VIEW = { pitch: 47, bearing: 10 };

async function main() {
  const loader = document.getElementById('loader');
  const fail = (msg, err) => {
    loader.querySelector('p').textContent = msg;
    throw err;
  };
  let net;
  try {
    net = await loadNetwork(`${import.meta.env.BASE_URL}data/network.json`);
  } catch (err) {
    fail('Não foi possível carregar os dados da rede.', err);
  }

  const geo = createGeo(net.raw.projection);
  const isMobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
  const base = new URL(import.meta.env.BASE_URL, location.href).href;
  const bb = net.bbox;
  const M = 9; // km de folga ao redor da rede
  const [w, s] = geo.toLngLat(bb.minX - M, bb.maxZ + M);
  const [e, n] = geo.toLngLat(bb.maxX + M, bb.minZ - M);
  const [w0, s0] = geo.toLngLat(bb.minX, bb.maxZ);
  const [e0, n0] = geo.toLngLat(bb.maxX, bb.minZ);

  let map;
  try {
    map = new maplibregl.Map({
      container: 'map',
      style: createBasemapStyle(base),
      bounds: [w0, s0, e0, n0],
      fitBoundsOptions: { padding: 24 },
      maxBounds: [w, s, e, n],
      minZoom: 8,
      maxZoom: 19.6,
      maxPitch: 70,
      attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      canvasContextAttributes: { antialias: !isMobile, powerPreference: 'high-performance' },
      fadeDuration: 250,
      validateStyle: false,
      refreshExpiredTiles: false,
      renderWorldCopies: false,
    });
  } catch (err) {
    fail('Seu navegador não suporta WebGL 2, necessário para o mapa.', err);
  }
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

  const clock = new SimClock();
  const sim = new Simulator(net);
  const railsL = createRailsLayer(net, geo);
  const trainsL = createTrainsLayer(geo);
  let layers = null;

  // ------------------------------------------------------------ seleção
  const sel = { lines: new Set(), station: null, train: null, poi: null, follow: false };
  const EMPTY = { station: null, train: null, poi: null, follow: false };
  let force = true; // recalcula a simulação no próximo quadro

  // áreas da tela cobertas pela interface: a câmera centraliza no espaço livre
  const topbar = document.querySelector('.topbar');
  const sheetEl = document.getElementById('sheet');
  const navEl = document.getElementById('lines-nav');
  function padding() {
    const top = topbar.getBoundingClientRect().bottom + 6;
    const open = !sheetEl.hidden;
    if (map.getContainer().clientWidth >= 900) {
      return { top, left: navEl.getBoundingClientRect().right + 10, right: open ? sheetEl.offsetWidth + 24 : 64, bottom: 16 };
    }
    return { top, left: 0, right: 0, bottom: open ? sheetEl.offsetHeight + 4 : navEl.offsetHeight };
  }

  const ease = (opts, duration = 1300) =>
    map.easeTo({ ...opts, padding: padding(), duration: REDUCED_MOTION ? 0 : duration, easing: easeInOutCubic, essential: true });

  /**
   * Enquadra pontos (km da rede, x,z intercalados). `align`: direção (rad, no plano x/z) que deve
   * ficar no eixo mais comprido da área livre — gira o mapa para a linha caber maior.
   */
  function fitPoints(pts, { pitch = VIEW.pitch, bearing, align, pad = 1.12, duration = 1400 } = {}) {
    const p = padding();
    const el = map.getContainer();
    const W = Math.max(80, el.clientWidth - p.left - p.right);
    const H = Math.max(80, el.clientHeight - p.top - p.bottom);
    let b = (bearing ?? map.getBearing()) * DEG;
    if (align !== undefined) {
      // retrato: linha na vertical da tela; paisagem: na horizontal
      const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      const cands = W < H ? [align + Math.PI / 2, align - Math.PI / 2] : [align, align + Math.PI];
      b = cands.map(norm).sort((x, y) => Math.abs(x) - Math.abs(y))[0];
    }
    // eixos da tela no chão: direita = (cos b, sin b), cima = (sin b, -cos b) em (leste, sul)
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const u = pts[i] * cb + pts[i + 1] * sb;
      const v = pts[i] * sb - pts[i + 1] * cb;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const wKm = Math.max(1.5, (maxU - minU) * pad);
    const hKm = Math.max(1.5, (maxV - minV) * pad * (0.25 + 0.85 * Math.cos(pitch * DEG)));
    const pxPerKm = Math.min(W / wKm, H / hKm);
    const zoom = clamp(Math.log2(pxPerKm / (512 * geo.mercPerKm)), map.getMinZoom(), 16.5);
    const cu = (minU + maxU) / 2;
    const cv = (minV + maxV) / 2;
    ease({ center: geo.toLngLat(cu * cb + cv * sb, cu * sb - cv * cb), zoom, bearing: b / DEG, pitch }, duration);
  }
  function resetView(duration = 1300) {
    const el = map.getContainer();
    const b = el.clientWidth < el.clientHeight * 0.8 ? CORE_PORTRAIT : CORE;
    fitPoints([b.minX, b.minZ, b.maxX, b.maxZ, b.minX, b.maxZ, b.maxX, b.minZ], { ...VIEW, pad: 1, duration });
  }

  function fitLine(line) {
    const pts = line.services.flatMap((sv) => Array.from(sv.path));
    const a = line.services[0].stops[0].station;
    const b = line.services[0].stops.at(-1).station;
    fitPoints(pts, { pitch: 35, align: Math.atan2(b.z - a.z, b.x - a.x) });
  }
  const focusStation = (s) =>
    ease({ center: geo.toLngLat(s.x, s.z), zoom: clamp(map.getZoom(), 13.4, 15.5), pitch: clamp(map.getPitch(), 30, 55) });

  function applySelection() {
    layers?.setSelection(sel.lines, sel.station);
    const st = sel.station;
    trainsL.setPulse(st, st ? (st.isTransfer ? [0.12, 0.12, 0.13] : st.lineObjs[0].rgb) : null);
    ui.setNavSelection(sel.lines);
    force = true;
  }

  function selectLine(line, { toggle = false, fly = true } = {}) {
    if (toggle && sel.lines.size === 1 && sel.lines.has(line.id) && !sel.station && !sel.train && !sel.poi) {
      clearSelection(true);
      return;
    }
    Object.assign(sel, EMPTY, { lines: new Set([line.id]) });
    applySelection();
    ui.showLine(line);
    if (fly) fitLine(line);
  }

  function selectStation(s, { fly = true } = {}) {
    Object.assign(sel, EMPTY, { lines: new Set(s.lines), station: s });
    applySelection();
    ui.showStation(s);
    if (fly) focusStation(s);
  }

  function selectTrain(tr) {
    Object.assign(sel, EMPTY, { lines: new Set([tr.line.id]), train: tr });
    applySelection();
    ui.showTrain(tr);
    setTrainTag(tr);
    ease({ center: geo.toLngLat(tr.x, tr.z), zoom: Math.max(map.getZoom(), 13.4) }, 1100);
  }

  function selectPoi(p) {
    const s = p.stationObj;
    Object.assign(sel, EMPTY, { lines: new Set(s?.lines ?? []), station: s ?? null, poi: p });
    applySelection();
    ui.showPoi(p);
    ease({ center: geo.toLngLat(p.x, p.z), zoom: clamp(map.getZoom(), 14, 15.8) }, 1200);
  }

  function clearSelection(fly) {
    Object.assign(sel, EMPTY, { lines: new Set() });
    applySelection();
    ui.close();
    setTrainTag(null);
    if (fly) resetView();
  }

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
      if (sel.follow) ease({ center: geo.toLngLat(sel.train.x, sel.train.z), zoom: Math.max(map.getZoom(), 16.4), pitch: 58 }, 1200);
    },
    isFollowing: () => sel.follow,
    onTimeJump() {
      force = true;
      ui.view?.tick?.();
    },
  };
  const ui = createUI(app);

  // ------------------------------------------------------------ etiqueta do trem selecionado
  const tag = document.createElement('div');
  tag.className = 'train-tag';
  document.getElementById('labels').appendChild(tag);
  let tagTrainId = null;
  function setTrainTag(tr) {
    if (!tr) {
      tag.classList.remove('on');
      tagTrainId = null;
      return;
    }
    if (tr.id !== tagTrainId) {
      tag.innerHTML = `<span class="badge sm ${tr.line.darkText ? 'dark-text' : ''}" style="--c:${tr.line.color}">${tr.line.number}</span> ${tr.run.headsign}`;
      tagTrainId = tr.id;
    }
    const p = map.project(geo.toLngLat(tr.x, tr.z));
    tag.style.transform = `translate3d(${(p.x - tag.offsetWidth / 2).toFixed(1)}px,${(p.y - 46).toFixed(1)}px,0)`;
    tag.classList.add('on');
  }

  // ------------------------------------------------------------ toque / clique no mapa
  function trainAt(pt) {
    let best = null;
    let dBest = Infinity;
    for (const tr of sim.trains) {
      if (tr.alpha < 0.3) continue;
      if (sel.lines.size && !sel.lines.has(tr.line.id)) continue;
      const p = map.project(geo.toLngLat(tr.x, tr.z));
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d < dBest) { dBest = d; best = tr; }
    }
    return { train: best, d: dBest };
  }

  function pick(pt, touch) {
    if (!layers) return;
    const tTrain = touch ? 26 : 18;
    const tStation = touch ? 18 : 11;
    const { train, d: dTrain } = trainAt(pt);
    const st = layers.stationAt(pt, tStation);
    let dSt = Infinity;
    if (st) {
      const p = map.project(geo.toLngLat(st.x, st.z));
      dSt = Math.hypot(p.x - pt.x, p.y - pt.y);
    }
    if (train && dTrain < tTrain && (dTrain < dSt * 0.9 || dSt > tStation)) return selectTrain(train);
    if (st) return selectStation(st);
    const poi = layers.poiAt(pt, tStation);
    if (poi) return selectPoi(poi);
    const line = layers.lineAt(pt, touch ? 10 : 5);
    if (line) return selectLine(line);
    if (sel.lines.size || sel.station || sel.train || sel.poi) clearSelection(false);
  }

  map.on('click', (ev) => pick(ev.point, ev.originalEvent?.pointerType === 'touch' || isMobile));
  // arrastar o mapa para de seguir o trem (zoom e giro continuam seguindo)
  map.on('dragstart', () => {
    if (sel.follow) {
      sel.follow = false;
      if (ui.view?.type === 'train') ui.showTrain(sel.train);
    }
  });
  // cursor de "clicável" (desktop)
  if (!isMobile) {
    let hoverPending = false;
    map.on('mousemove', (ev) => {
      if (hoverPending || !layers) return;
      hoverPending = true;
      requestAnimationFrame(() => {
        hoverPending = false;
        const b = [[ev.point.x - 6, ev.point.y - 6], [ev.point.x + 6, ev.point.y + 6]];
        const hit = map.queryRenderedFeatures(b, { layers: layers.INTERACTIVE }).length > 0 || trainAt(ev.point).d < 14;
        map.getCanvas().style.cursor = hit ? 'pointer' : '';
      });
    });
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !document.querySelector('dialog[open]')) clearSelection(false);
  });

  // ------------------------------------------------------------ ferramentas
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (sel.train || sel.station || sel.lines.size) clearSelection(true);
    else resetView();
  });
  const tiltBtn = document.getElementById('btn-tilt');
  const syncTilt = () => (tiltBtn.textContent = map.getPitch() < 10 ? '3D' : '2D');
  tiltBtn.addEventListener('click', () => ease({ pitch: map.getPitch() < 10 ? VIEW.pitch : 0 }, 900));
  map.on('pitchend', syncTilt);

  // ------------------------------------------------------------ abertura
  let introStart = null;
  let introDone = false;
  // km ao longo de cada linha em que a estação "acende" durante a abertura
  for (const st of net.stations) {
    st.revealAt = st.lineObjs.map((line) => ({
      line,
      s: Math.min(...line.services.flatMap((sv) => sv.stops.filter((x) => x.station === st).map((x) => x.s))),
    }));
  }
  function revealStations() {
    for (const st of net.stations) {
      if (st.revealAt.some((r) => railsL.revealOf(r.line) >= r.s)) layers.show(st);
    }
  }
  function finishIntro() {
    introDone = true;
    railsL.setReveal(1);
    for (const st of net.stations) layers.show(st);
    trainsL.setAppear(1);
    layers.showLabels();
  }

  map.on('load', async () => {
    await addMapImages(map, net);
    layers = addNetworkLayers(map, net, geo, { beforeLabels: firstSymbolLayer(map) });
    map.addLayer(railsL.layer, 'rail-hit');
    map.addLayer(trainsL.layer, 'rail-shields');
    layers.setSelection(sel.lines, sel.station);
    if (REDUCED_MOTION) {
      finishIntro();
      resetView(0);
    } else {
      railsL.setReveal(0);
      introStart = performance.now();
      resetView(INTRO * 1000);
    }
    syncTilt();
    loader.classList.add('out');
    setTimeout(() => loader.remove(), 800);
  });

  if (import.meta.env.DEV) window.__tv = { map, geo, sim, clock, net, sel, app, railsL, trainsL, get layers() { return layers; } };

  // ------------------------------------------------------------ loop
  // A simulação roda no ritmo necessário para o movimento parecer contínuo na tela (de longe os
  // trens andam menos de 1 px/s): poupa bateria. Animações contínuas pedem todos os quadros.
  let last = performance.now();
  let lastSim = -1e9;
  let trains = [];
  let curTrain = null;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = clamp((now - last) / 1000, 0, 0.1);
    last = now;
    if (!layers) return;
    let animating = false;

    if (introStart !== null && !introDone) {
      const T = (now - introStart) / 1000;
      railsL.setReveal(clamp(T / INTRO, 0, 1));
      revealStations();
      trainsL.setAppear(clamp((T - INTRO * 0.7) / 0.7, 0, 1));
      if (T > INTRO + 0.4) finishIntro();
      animating = true;
    }
    if (railsL.update(dt, sel.lines)) animating = true;
    if (trainsL.animating) animating = true;

    const state = clock.state();
    const pxPerKm = 512 * Math.pow(2, map.getZoom()) * geo.mercPerKm;
    const fps = clamp(0.025 * pxPerKm * clock.rate * 3, 4, 60); // ~3 quadros por px do trem mais rápido
    const due = force || animating || sel.follow || now - lastSim >= 1000 / fps;
    if (due) {
      force = false;
      lastSim = now;
      trains = sim.update(state);
      // trem selecionado: o objeto é recriado só quando a viagem termina
      curTrain = null;
      if (sel.train) {
        curTrain = sim.byId.get(sel.train.id) ?? null;
        if (curTrain) sel.train = curTrain;
        else sel.follow = false;
      }
      trainsL.update(trains, { selectedTrain: curTrain, selectedLines: sel.lines });
      railsL.paintTrails(trains);
      map.triggerRepaint();
    }
    if (sel.follow && curTrain && !map.isEasing()) {
      const c = map.getCenter();
      const [lng, lat] = geo.toLngLat(curTrain.x, curTrain.z);
      const k = 1 - Math.exp(-dt * 5);
      map.jumpTo({ center: [c.lng + (lng - c.lng) * k, c.lat + (lat - c.lat) * k] });
    }
    if (curTrain) setTrainTag(curTrain);
    else if (tagTrainId) setTrainTag(null);
    ui.frame(dt, state, trains.length);
  }
  requestAnimationFrame(frame);
}

main();
