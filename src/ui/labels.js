// Rótulos em DOM (texto nítido em qualquer tela) com "declutter" guloso por prioridade.

import { ICONS } from './icons.js';
import { escapeHtml } from '../core/util.js';

const OFFSETS = [
  [10, -8], // direita
  [-10, -8], // esquerda (ancorado pela direita)
  [0, -24], // acima
  [0, 10], // abaixo
];

export function createLabels(container, stage, net, lift, handlers) {
  const items = [];
  const frag = document.createDocumentFragment();

  for (const s of net.stations) {
    const el = document.createElement('div');
    el.className = 'lbl st' + (s.isTransfer ? ' major' : '');
    el.textContent = s.name;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onStation(s);
    });
    frag.appendChild(el);
    items.push({
      kind: 'station',
      ref: s,
      el,
      x: s.x,
      z: s.z,
      pri: s.isTransfer ? 70 + s.lines.length * 6 : s.isTerminal ? 55 : 20,
      maxDist: s.isTransfer ? 70 : s.isTerminal ? 50 : 15,
      gap: s.isTransfer ? 6 : 2,
    });
  }

  // badges com o número da linha nas pontas
  for (const line of net.lines) {
    const done = new Set();
    for (const sv of line.services.slice(0, 1)) {
      for (const end of [0, 1]) {
        const st = end === 0 ? sv.stops[0] : sv.stops.at(-1);
        if (done.has(st.station)) continue;
        done.add(st.station);
        // empurra o badge para fora, na direção do fim da linha
        const n = sv.path.length / 2;
        const i0 = end === 0 ? 0 : n - 1;
        const i1 = end === 0 ? Math.min(n - 1, 12) : Math.max(0, n - 13);
        const dx = sv.path[2 * i0] - sv.path[2 * i1];
        const dz = sv.path[2 * i0 + 1] - sv.path[2 * i1 + 1];
        const l = Math.hypot(dx, dz) || 1;
        const el = document.createElement('div');
        el.className = 'lbl badge' + (line.darkText ? ' dark-text' : '');
        el.style.setProperty('--c', line.color);
        el.textContent = line.number;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          handlers.onLine(line);
        });
        frag.appendChild(el);
        items.push({
          kind: 'badge',
          ref: line,
          el,
          x: st.station.x,
          z: st.station.z,
          dirX: dx / l,
          dirZ: dz / l,
          pri: 200,
          maxDist: 400,
          gap: 0,
        });
      }
    }
  }

  for (const p of net.pois) {
    const el = document.createElement('div');
    el.className = `lbl poi ${p.type}`;
    const short = p.type === 'airport' ? p.name.replace(/^Aeroporto (Internacional )?de /, '').replace(/\s*\(.*\)/, '') : p.name.replace(/^Terminal (Rodoviário )?/, p.type === 'rodoviaria' ? 'Rodoviária ' : '');
    el.innerHTML = `<span class="pico">${ICONS[p.type]}</span><span class="ptxt">${escapeHtml(short)}</span>`;
    el.title = p.name;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onPoi(p);
    });
    frag.appendChild(el);
    items.push({
      kind: 'poi',
      ref: p,
      el,
      x: p.x,
      z: p.z,
      pri: p.type === 'bus' ? 15 : 90,
      maxDist: p.type === 'bus' ? 9 : 75,
      gap: 2,
    });
  }

  // etiqueta que acompanha o trem selecionado
  const trainTag = document.createElement('div');
  trainTag.className = 'lbl train-tag';
  frag.appendChild(trainTag);

  container.appendChild(frag);
  for (const it of items) {
    it.w = it.el.offsetWidth;
    it.h = it.el.offsetHeight;
    it.on = false;
    it.px = -1e4;
    it.py = -1e4;
  }

  const P = { x: 0, y: 0, depth: 0 };
  const placed = [];
  const overlaps = (x, y, w, h, gap) => {
    for (const r of placed) {
      if (x < r.x + r.w + gap && x + w + gap > r.x && y < r.y + r.h + gap && y + h + gap > r.y) return true;
    }
    return false;
  };

  function update({ distance, selectedLines, selectedStation, isMobile }) {
    const W = stage.width;
    const H = stage.height;
    if (W < 50 || H < 50) return;
    const anySel = selectedLines && selectedLines.size > 0;
    const budget = isMobile ? 46 : 110;
    const candidates = [];
    for (const it of items) {
      let pri = it.pri;
      let maxDist = it.maxDist;
      if (it.kind === 'station') {
        const s = it.ref;
        const onSel = anySel && s.lines.some((l) => selectedLines.has(l));
        if (s === selectedStation) { pri = 1000; maxDist = 1e9; }
        else if (onSel) { pri += 120; maxDist = Math.max(maxDist, 80); }
        else if (anySel) { pri -= 10; maxDist *= 0.6; }
        it.el.classList.toggle('dimmed', anySel && !onSel && s !== selectedStation);
        it.el.classList.toggle('sel', s === selectedStation);
      } else if (it.kind === 'badge') {
        const selected = anySel && selectedLines.has(it.ref.id);
        if (anySel && !selected) pri = 150;
        // na visão geral, os badges das pontas no centro expandido só poluem
        if (!selected && distance > 22 && Math.hypot(it.x, it.z) < 7) { it.want = false; continue; }
      } else if (it.kind === 'poi' && it.ref.type === 'bus') {
        it.el.classList.toggle('named', distance < 4.5);
        if (selectedStation && it.ref.stationObj === selectedStation) { pri = 500; maxDist = 1e9; }
      }
      if (distance > maxDist || !stage.project(it.x, lift, it.z, P)) { it.want = false; continue; }
      if (P.x < -60 || P.x > W + 60 || P.y < -40 || P.y > H + 40) { it.want = false; continue; }
      if (!it.w) {
        it.w = it.el.offsetWidth;
        it.h = it.el.offsetHeight;
        if (!it.w) { it.want = false; continue; }
      }
      it.sx = P.x;
      it.sy = P.y;
      it.curPri = pri;
      candidates.push(it);
    }
    candidates.sort((a, b) => b.curPri - a.curPri);
    placed.length = 0;
    let shown = 0;
    for (const it of candidates) {
      it.want = false;
      if (shown >= budget && it.curPri < 500) continue;
      if (it.kind === 'badge') {
        const k = 20;
        const bx = it.sx + it.dirX * k - it.w / 2;
        // direção no mundo -> aproximação na tela (z cresce para baixo no norte-acima)
        const by = it.sy + it.dirZ * k - it.h / 2;
        const p = projectDir(it, k);
        const x = p ? p.x - it.w / 2 : bx;
        const y = p ? p.y - it.h / 2 : by;
        if (!overlaps(x, y, it.w, it.h, 1)) {
          placed.push({ x, y, w: it.w, h: it.h });
          it.want = true;
          it.tx = x;
          it.ty = y;
          shown++;
        }
        continue;
      }
      for (const [ox, oy] of OFFSETS) {
        const x = ox < 0 ? it.sx + ox - it.w : ox === 0 ? it.sx - it.w / 2 : it.sx + ox;
        const y = it.sy + oy + (oy === -8 ? 0 : 0);
        if (!overlaps(x, y, it.w, it.h, it.gap)) {
          placed.push({ x, y, w: it.w, h: it.h });
          it.want = true;
          it.tx = x;
          it.ty = y;
          shown++;
          break;
        }
      }
    }
    for (const it of items) {
      if (it.want) {
        if (Math.abs(it.tx - it.px) > 0.4 || Math.abs(it.ty - it.py) > 0.4) {
          it.el.style.transform = `translate3d(${it.tx.toFixed(1)}px,${it.ty.toFixed(1)}px,0)`;
          it.px = it.tx;
          it.py = it.ty;
        }
        if (!it.on) { it.el.classList.add('on'); it.on = true; }
      } else if (it.on) {
        it.el.classList.remove('on');
        it.on = false;
      }
    }
  }

  // projeta um ponto deslocado `px` pixels a partir da estação, na direção (mundo) do fim da linha
  const Q = { x: 0, y: 0, depth: 0 };
  function projectDir(it, px) {
    if (!stage.project(it.x + it.dirX * 0.5, lift, it.z + it.dirZ * 0.5, Q)) return null;
    const dx = Q.x - it.sx;
    const dy = Q.y - it.sy;
    const l = Math.hypot(dx, dy);
    if (l < 1e-3) return { x: it.sx, y: it.sy - px };
    return { x: it.sx + (dx / l) * px, y: it.sy + (dy / l) * px };
  }

  function updateTrainTag(train, html) {
    if (!train) {
      trainTag.classList.remove('on');
      return;
    }
    if (html !== undefined) trainTag.innerHTML = html;
    if (stage.project(train.x, lift, train.z, P)) {
      trainTag.style.transform = `translate3d(${(P.x - trainTag.offsetWidth / 2).toFixed(1)}px,${(P.y - 44).toFixed(1)}px,0)`;
      trainTag.classList.add('on');
    } else trainTag.classList.remove('on');
  }

  return { update, updateTrainTag, items };
}
