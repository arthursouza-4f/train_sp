// Interface: barra de linhas, painel de detalhes (linha / estação / trem / ponto de interesse),
// painel de horário, aviso e diálogo "Sobre".

import { ICONS, POI_LABEL } from './icons.js';
import { escapeHtml as esc, fmtHM, fmtHMS, fmtMin } from '../core/util.js';
import { headwayAt, departures } from '../sim/model.js';
import { ENTITIES } from '../data/lines-meta.js';

const $ = (id) => document.getElementById(id);

const badge = (line, cls = '') =>
  `<span class="badge ${cls} ${line.darkText ? 'dark-text' : ''}" style="--c:${line.color}">${line.number}</span>`;
const lineTitle = (line) => `Linha ${line.number}-${line.name}`;

export function createUI(app) {
  const { net, sim, clock } = app;
  const nav = $('lines-nav');
  const sheet = $('sheet');
  const body = $('sheet-body');
  const timePanel = $('time-panel');
  const toast = $('toast');
  let view = null; // { type, ref, tick() }

  // ------------------------------------------------------------ barra de linhas
  const chips = new Map();
  const all = document.createElement('button');
  all.className = 'line-chip all';
  all.textContent = 'Todas';
  all.addEventListener('click', () => app.clearSelection(true));
  nav.appendChild(all);
  for (const line of net.lines) {
    const b = document.createElement('button');
    b.className = 'line-chip';
    b.style.setProperty('--c', line.color);
    b.innerHTML = `${badge(line)}<span class="ln-name">${esc(line.name)}</span><span class="ln-count"></span>`;
    b.title = lineTitle(line);
    b.addEventListener('click', () => app.selectLine(line, { toggle: true }));
    nav.appendChild(b);
    chips.set(line.id, b);
  }

  function setNavSelection(lineIds) {
    nav.classList.toggle('has-sel', lineIds.size > 0);
    for (const [id, b] of chips) b.classList.toggle('on', lineIds.has(id));
    const first = [...lineIds][0];
    if (first && lineIds.size === 1) chips.get(first)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  // ------------------------------------------------------------ painel
  function open(v) {
    view = v;
    const scroll = body.scrollTop;
    body.innerHTML = v.html;
    body.scrollTop = v.keepScroll ? scroll : 0;
    v.bind?.(body);
    v.tick?.();
    sheet.hidden = false;
    sheet.classList.remove('collapsed', 'expanded');
    document.body.classList.add('has-sheet');
  }
  function close() {
    view = null;
    sheet.hidden = true;
    document.body.classList.remove('has-sheet');
  }
  $('sheet-close').addEventListener('click', () => app.clearSelection(false));
  // painel no celular: compacto / meio / expandido (toque ou arraste na alça)
  const STATES = ['collapsed', '', 'expanded'];
  const sheetState = () => (sheet.classList.contains('collapsed') ? 0 : sheet.classList.contains('expanded') ? 2 : 1);
  const setSheetState = (i) => {
    sheet.classList.remove('collapsed', 'expanded');
    if (STATES[i]) sheet.classList.add(STATES[i]);
  };
  let dragY = null;
  let dragged = false;
  $('sheet-handle').addEventListener('pointerdown', (e) => {
    dragY = e.clientY;
    dragged = false;
  });
  window.addEventListener('pointerup', (e) => {
    if (dragY === null) return;
    const dy = e.clientY - dragY;
    dragY = null;
    if (Math.abs(dy) > 30) {
      dragged = true;
      setSheetState(Math.max(0, Math.min(2, sheetState() + (dy < 0 ? 1 : -1))));
    }
  });
  $('sheet-handle').addEventListener('click', () => {
    if (dragged) return;
    setSheetState(sheetState() === 1 ? 2 : 1);
  });

  const bindClicks = (root) => {
    root.querySelectorAll('[data-station]').forEach((el) =>
      el.addEventListener('click', () => app.selectStation(net.stationById.get(el.dataset.station))));
    root.querySelectorAll('[data-line]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        app.selectLine(net.lineById.get(el.dataset.line));
      }));
    root.querySelectorAll('[data-poi]').forEach((el) =>
      el.addEventListener('click', () => app.selectPoi(net.pois[+el.dataset.poi])));
  };

  // ---------------- linha
  function showLine(line) {
    const sv0 = line.services[0];
    const run = sv0.runs[0];
    const trip = Math.round(run.T / 60);
    const openStr = line.open ?? fmtHM(run.hw.findIndex((h) => h > 0) * 3600);
    const lastH = 23 - [...run.hw].reverse().findIndex((h) => h > 0);
    const closeStr = line.close ? (line.close === '24:00' ? '0h' : line.close) : fmtHM((lastH + 1) * 3600);
    const stopsHtml = line.services
      .map((sv, si) => {
        const items = sv.stops
          .map(({ station: s }) => {
            const others = s.lineObjs.filter((l) => l !== line);
            return `<li class="${s.isTransfer ? 'x' : ''}" data-station="${s.id}">
              <span class="dot"></span><span class="nm">${esc(s.name)}</span>
              <span class="xs">${others.map((l) => badge(l, 'sm')).join('')}</span></li>`;
          })
          .join('');
        const title = line.services.length > 1 ? `<div class="sec-title">${si === 0 ? 'Trecho principal' : 'Ramal'}: ${esc(sv.stops[0].station.name)} ↔ ${esc(sv.stops.at(-1).station.name)}</div>` : '';
        return `${title}<ul class="stops" style="--c:${line.color}">${items}</ul>`;
      })
      .join('');
    open({
      type: 'line',
      ref: line,
      html: `
        <div class="sh-head">${badge(line)}<div>
          <h2 class="sh-title">${lineTitle(line)}</h2>
          <div class="sh-sub">${esc(line.system)} · operação: ${esc(line.operator)}</div></div></div>
        ${line.note ? `<p class="sh-note">${esc(line.note)} Horários conforme o GTFS oficial.</p>` : ''}
        <div class="stats">
          <div class="stat"><div class="k">Em circulação</div><div class="v" id="v-count">–</div></div>
          <div class="stat"><div class="k">Intervalo agora</div><div class="v" id="v-hw">–</div></div>
          <div class="stat"><div class="k">Extensão</div><div class="v">${line.length.toFixed(1)}<small> km</small></div></div>
          <div class="stat"><div class="k">Estações</div><div class="v">${line.stations.length}</div></div>
          <div class="stat"><div class="k">Viagem</div><div class="v">~${trip}<small> min</small></div></div>
          <div class="stat"><div class="k">Funciona</div><div class="v" style="font-size:13px">${openStr}–${closeStr}${line.weekdaysOnly ? '<small> (úteis)</small>' : ''}</div></div>
        </div>
        <div class="sec-title">Estações <span class="est">toque para ver próximos trens</span></div>
        ${stopsHtml}
        <div class="btn-row"><button class="btn" id="b-fit">Enquadrar linha</button></div>`,
      bind(root) {
        bindClicks(root);
        root.querySelector('#b-fit').addEventListener('click', () => app.fitLine(line));
      },
      tick() {
        const st = clock.state();
        const n = sim.countByLine.get(line.id) ?? 0;
        const vc = $('v-count');
        if (vc) vc.innerHTML = `${n}<small> trens</small>`;
        const hour = Math.floor(st.sec / 3600);
        const deps = departures(run, st.type);
        const running = deps.length && st.sec >= deps[0] - 60 && st.sec <= deps.at(-1) + run.T;
        const hw = headwayAt(run.hw, hour, line.minHeadway);
        const vh = $('v-hw');
        if (vh) vh.innerHTML = running ? `${hw >= 60 ? Math.round((hw / 60) * 10) / 10 : hw}<small> ${hw >= 60 ? 'min' : 's'}</small>` : '<small>fechada</small>';
      },
    });
  }

  // ---------------- estação
  function showStation(s) {
    const linesHtml = s.lineObjs.map((l) => `<button class="badge ${l.darkText ? 'dark-text' : ''}" data-line="${l.id}" style="--c:${l.color};border:0;cursor:pointer" title="${esc(lineTitle(l))}">${l.number}</button>`).join('');
    const conn = [];
    if (s.isTransfer) {
      conn.push(`<li><span class="ci free">${ICONS.transfer}</span><span class="ct">Integração entre linhas ${s.lineObjs.map((l) => badge(l, 'sm')).join(' ')}<small>Na mesma estação</small></span><span class="tag free">GRATUITA</span></li>`);
    }
    for (const w of s.walkTo) {
      conn.push(`<li class="clickable" data-station="${w.station.id}"><span class="ci walk ${w.free ? 'free' : ''}">${ICONS.walk}</span>
        <span class="ct">${w.free ? 'Transferência por corredor' : 'Conexão a pé'} — ${esc(w.station.name)} ${w.station.lineObjs.map((l) => badge(l, 'sm')).join(' ')}
        <small>~${w.m} m em linha reta</small></span>${w.free ? '<span class="tag free">GRATUITA</span>' : ''}</li>`);
    }
    for (const p of s.pois) {
      const extra = p.type === 'bus'
        ? '<small>Ônibus municipais · integração via Bilhete Único</small>'
        : p.type === 'airport'
          ? `<small>${p.m > 1200 ? 'Conexão com os terminais por transporte interno do aeroporto' : `~${p.m} m da estação`}</small>`
          : `<small>Ônibus intermunicipais e interestaduais · ~${p.m} m</small>`;
      conn.push(`<li class="clickable" data-poi="${p.index}"><span class="ci ${p.type}">${ICONS[p.type]}</span>
        <span class="ct">${esc(p.name)}${extra}</span>${p.type === 'bus' ? '<span class="tag paid">TARIFADA</span>' : ''}</li>`);
    }
    const sub = s.isTransfer ? `Estação de integração · ${s.lines.length} linhas` : `${lineTitle(s.lineObjs[0])} · ${esc(s.lineObjs[0].system)}`;
    open({
      type: 'station',
      ref: s,
      html: `
        <div class="sh-head"><div>
          <h2 class="sh-title">${esc(s.name)}</h2>
          <div class="sh-sub">${sub}</div>
          <div class="sh-badges">${linesHtml}</div></div></div>
        <div class="sec-title">Próximos trens <span class="est">estimativa pela tabela</span></div>
        <div class="dirs" id="v-dirs"></div>
        ${conn.length ? `<div class="sec-title">Integrações e conexões</div><ul class="conn">${conn.join('')}</ul>` : ''}
        <div class="btn-row"><button class="btn" id="b-center">Centralizar no mapa</button></div>`,
      bind(root) {
        bindClicks(root);
        root.querySelector('#b-center').addEventListener('click', () => app.focusStation(s));
      },
      tick() {
        const st = clock.state();
        const rows = sim.nextArrivals(s, st, 3);
        const el = $('v-dirs');
        if (!el) return;
        el.innerHTML = rows
          .map(({ run, etas, first, closed }) => {
            const l = run.sv.line;
            const none = closed
              ? `Sem operação hoje${l.weekdaysOnly ? ' (funciona em dias úteis)' : ''}`
              : `Sem mais trens hoje${first != null ? ` · primeiro amanhã ~${fmtHM(first)}` : ''}`;
            const chipsHtml = etas.length
              ? etas.map((e, i) => `<span class="eta ${i === 0 ? 'first' : ''} ${i === 0 && l.darkText ? 'dark-text' : ''}">${e < 20 ? 'na plataforma' : fmtMin(e)}${i === 0 && e >= 45 ? ` <small>${fmtHM(st.sec + e)}</small>` : ''}</span>`).join('')
              : `<span class="none">${none}</span>`;
            return `<div class="dir-card" style="--c:${l.color}"><div class="dh">${badge(l, 'sm')} <span class="to">Sentido</span> ${esc(run.headsign)}</div><div class="etas">${chipsHtml}</div></div>`;
          })
          .join('') || '<span class="none">Sem informações de horário.</span>';
      },
    });
  }

  // ---------------- trem
  function showTrain(tr) {
    const line = tr.line;
    const run = tr.run;
    const total = run.u.at(-1);
    const ticks = run.u.map((u) => `<span class="tick" style="left:${((u / total) * 100).toFixed(2)}%"></span>`).join('');
    open({
      type: 'train',
      ref: tr,
      html: `
        <div class="sh-head">${badge(line)}<div>
          <h2 class="sh-title">Sentido ${esc(run.headsign)}</h2>
          <div class="sh-sub">${lineTitle(line)} · trem estimado</div></div></div>
        <p class="sh-note">Posição calculada pela tabela de intervalos — o trem real pode estar adiantado ou atrasado.</p>
        <div class="stats">
          <div class="stat" style="grid-column: span 2"><div class="k" id="v-tk">Próxima estação</div><div class="v" id="v-next" style="font-size:15px">–</div></div>
          <div class="stat"><div class="k">Chega em</div><div class="v" id="v-eta">–</div></div>
          <div class="stat"><div class="k">Velocidade</div><div class="v" id="v-speed">–</div></div>
          <div class="stat"><div class="k">Partiu</div><div class="v" id="v-dep">${fmtHM(tr.depart)}</div></div>
          <div class="stat"><div class="k">Fim da viagem</div><div class="v" id="v-end">${fmtHM(tr.depart + run.T)}</div></div>
        </div>
        <div class="progress" style="--c:${line.color}"><span class="rail"></span><span class="done" id="v-done"></span>${ticks}<span class="me" id="v-me"></span></div>
        <div class="progress-ends"><span>${esc(run.order[0].station.name)}</span><span>${esc(run.order.at(-1).station.name)}</span></div>
        <div class="btn-row">
          <button class="btn primary" id="b-follow">Seguir trem</button>
          <button class="btn" data-line="${line.id}">Ver linha</button>
        </div>`,
      bind(root) {
        bindClicks(root);
        const b = root.querySelector('#b-follow');
        const sync = () => {
          b.textContent = app.isFollowing() ? 'Parar de seguir' : 'Seguir trem';
          b.classList.toggle('primary', !app.isFollowing());
        };
        b.addEventListener('click', () => {
          app.setFollow(!app.isFollowing());
          sync();
        });
        sync();
      },
      tick() {
        const cur = sim.byId.get(tr.id);
        if (!cur) {
          const n = $('v-next');
          if (n) n.textContent = 'Viagem encerrada';
          return;
        }
        const next = run.order[cur.next]?.station;
        const at = cur.at >= 0 ? run.order[cur.at].station : null;
        const k = $('v-tk');
        const n = $('v-next');
        if (at && cur.at === run.order.length - 1) {
          k.textContent = 'Situação';
          n.textContent = `Chegou em ${at.name}`;
        } else if (at) {
          k.textContent = 'Parado na plataforma';
          n.textContent = at.name;
        } else {
          k.textContent = 'Próxima estação';
          n.textContent = next?.name ?? '–';
        }
        $('v-eta').innerHTML = at ? `<small>sai em</small> ${Math.max(0, Math.round(cur.dwellLeft))}<small> s</small>` : cur.eta < 60 ? `${Math.round(cur.eta)}<small> s</small>` : `${Math.round(cur.eta / 60)}<small> min</small>`;
        $('v-speed').innerHTML = `${Math.round(cur.v * 3.6)}<small> km/h</small>`;
        const pct = (cur.progress * 100).toFixed(2);
        $('v-done').style.width = pct + '%';
        $('v-me').style.left = pct + '%';
      },
    });
  }

  // ---------------- ponto de interesse
  function showPoi(p) {
    const s = p.stationObj;
    const desc = {
      bus: 'Terminal de ônibus urbano da SPTrans. A integração com o Metrô/trem é feita com o Bilhete Único (tarifa integrada).',
      rodoviaria: 'Terminal rodoviário de ônibus intermunicipais e interestaduais, com acesso pela estação.',
      airport: 'Aeroporto com acesso pela rede sobre trilhos.',
    }[p.type];
    open({
      type: 'poi',
      ref: p,
      html: `
        <div class="sh-head"><span class="conn"><span class="ci ${p.type}" style="width:38px;height:38px">${ICONS[p.type]}</span></span><div>
          <h2 class="sh-title">${esc(p.name)}</h2>
          <div class="sh-sub">${POI_LABEL[p.type]}</div></div></div>
        <p class="sh-desc">${desc}</p>
        ${s ? `<div class="sec-title">Estação</div><ul class="conn"><li class="clickable" data-station="${s.id}"><span class="ci free">${ICONS.train}</span>
          <span class="ct">${esc(s.name)} ${s.lineObjs.map((l) => badge(l, 'sm')).join(' ')}<small>~${p.m} m em linha reta</small></span></li></ul>` : '<p class="none">Sem estação da rede a menos de 500 m.</p>'}`,
      bind: bindClicks,
    });
  }

  // ------------------------------------------------------------ relógio e contagem
  const clockEl = $('clock');
  const modeEl = $('clock-mode');
  const clockBtn = $('clock-btn');
  const countEl = $('train-count');
  let lastCount = -1;
  let lastClock = '';
  function updateStatus(state, total) {
    const live = clock.isLive;
    const txt = live ? fmtHMS(state.sec) : fmtHM(state.sec);
    if (txt !== lastClock) {
      clockEl.textContent = txt;
      lastClock = txt;
    }
    clockBtn.classList.toggle('sim', !live);
    const dayName = { wkd: 'DIA ÚTIL', sat: 'SÁBADO', sun: 'DOMINGO' }[state.type];
    modeEl.textContent = live ? 'AO VIVO' : `SIMULAÇÃO${clock.rate !== 1 ? ` ${clock.rate}×` : ''}${clock.dayOverride ? ' · ' + dayName : ''}`;
    if (total !== lastCount) {
      countEl.innerHTML = `<b>${total}</b> <span>trens</span>`;
      lastCount = total;
      for (const line of net.lines) {
        const c = chips.get(line.id).querySelector('.ln-count');
        const n = sim.countByLine.get(line.id) ?? 0;
        c.textContent = n ? String(n) : '';
      }
    }
  }

  // ------------------------------------------------------------ painel de horário
  const slider = $('tp-slider');
  const tpTime = $('tp-time');
  clockBtn.addEventListener('click', () => {
    timePanel.hidden = !timePanel.hidden;
    syncTimePanel();
  });
  slider.addEventListener('input', () => {
    clock.setTimeOfDay(+slider.value * 60);
    syncTimePanel(true);
    app.onTimeJump();
  });
  $('tp-live').addEventListener('click', () => {
    clock.goLive();
    syncTimePanel();
    app.onTimeJump();
  });
  timePanel.querySelectorAll('[data-speed]').forEach((b) =>
    b.addEventListener('click', () => {
      clock.setRate(+b.dataset.speed);
      syncTimePanel();
    }));
  timePanel.querySelectorAll('[data-day]').forEach((b) =>
    b.addEventListener('click', () => {
      clock.setDayOverride(clock.dayOverride === b.dataset.day ? null : b.dataset.day);
      syncTimePanel();
      app.onTimeJump();
    }));
  function syncTimePanel(fromSlider = false) {
    if (timePanel.hidden) return;
    const st = clock.state();
    if (!fromSlider) slider.value = String(Math.floor(st.sec / 60));
    tpTime.textContent = fmtHM(st.sec);
    $('tp-live').classList.toggle('on', clock.isLive);
    timePanel.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === clock.rate));
    timePanel.querySelectorAll('[data-day]').forEach((b) => b.classList.toggle('on', clock.dayOverride === b.dataset.day));
  }
  document.addEventListener('pointerdown', (e) => {
    if (!timePanel.hidden && !timePanel.contains(e.target) && !clockBtn.contains(e.target)) timePanel.hidden = true;
  });

  // ------------------------------------------------------------ aviso "sem trens"
  let toastShown = false;
  function checkIdle(total, state) {
    const idle = total === 0;
    if (idle && !toastShown) {
      toastShown = true;
      toast.innerHTML = `<span>Nenhum trem em circulação às ${fmtHM(state.sec)} (a operação vai das 4h à 0h).</span><button class="btn primary" id="t-sim">Ver às 18h</button>`;
      toast.hidden = false;
      $('t-sim').addEventListener('click', () => {
        clock.setTimeOfDay(18 * 3600);
        toast.hidden = true;
        app.onTimeJump();
      });
    } else if (!idle && toastShown) {
      toastShown = false;
      toast.hidden = true;
    }
  }

  // ------------------------------------------------------------ sobre
  const about = $('about');
  $('about-entities').textContent = ENTITIES.join(', ');
  $('about-gtfs').textContent = `${net.sources.gtfs}; dados processados em ${new Date(net.raw.generated).toLocaleDateString('pt-BR')}`;
  document.querySelectorAll('[data-open="about"]').forEach((b) =>
    b.addEventListener('click', () => (about.showModal ? about.showModal() : about.setAttribute('open', ''))));
  about.addEventListener('click', (e) => {
    if (e.target === about) about.close();
  });

  let tickAcc = 0;
  return {
    setNavSelection,
    showLine,
    showStation,
    showTrain,
    showPoi,
    close,
    get view() {
      return view;
    },
    frame(dt, state, total) {
      updateStatus(state, total);
      tickAcc += dt;
      if (tickAcc > 0.5) {
        tickAcc = 0;
        view?.tick?.();
        syncTimePanel();
        checkIdle(total, state);
      }
    },
  };
}
