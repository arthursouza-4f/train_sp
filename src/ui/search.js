// Busca de estações, linhas e terminais. No computador o campo fica fixo acima das linhas; no
// celular abre por cima do mapa pelo botão de lupa. Sem texto, mostra as estações favoritas.

import { ICONS } from './icons.js';
import { escapeHtml as esc } from '../core/util.js';

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const badge = (line) =>
  `<span class="badge sm ${line.darkText ? 'dark-text' : ''}" style="--c:${line.color}">${line.number}</span>`;

export function createSearch(app, favorites) {
  const { net } = app;
  const root = document.getElementById('search');
  const input = document.getElementById('search-input');
  const list = document.getElementById('search-results');
  const openBtn = document.getElementById('btn-search');
  const closeBtn = document.getElementById('search-close');

  const items = [
    ...net.stations.map((s) => ({
      type: 'station',
      ref: s,
      key: norm(s.name),
      rank: s.isTransfer ? 0 : 1,
      html: `<span class="sr-ico st ${s.isTransfer ? 'x' : ''}" style="--c:${s.lineObjs[0].color}"></span>
        <span class="sr-name">${esc(s.name)}</span><span class="sr-badges">${s.lineObjs.map(badge).join('')}</span>`,
    })),
    ...net.lines.map((l) => ({
      type: 'line',
      ref: l,
      key: norm(`linha ${l.number} ${l.name}`),
      number: l.number,
      rank: 0,
      html: `${badge(l)}<span class="sr-name">Linha ${l.number}-${esc(l.name)}</span><span class="sr-kind">${esc(l.system)}</span>`,
    })),
    ...net.pois.map((p) => ({
      type: 'poi',
      ref: p,
      key: norm(p.name),
      rank: p.type === 'bus' ? 3 : 2,
      html: `<span class="sr-ico poi ${p.type}">${ICONS[p.type]}</span><span class="sr-name">${esc(p.name)}</span>`,
    })),
  ];

  function score(it, q) {
    if (it.type === 'line' && (q === it.number || q === `l${it.number}` || q === `linha ${it.number}`)) return -1;
    const i = it.key.indexOf(q);
    if (i < 0) return null;
    if (i === 0) return 0;
    if (/[\s\-(/]/.test(it.key[i - 1])) return 1; // começo de palavra
    return 2;
  }

  function results(text) {
    const q = norm(text).trim().replace(/\s+/g, ' ');
    if (!q) {
      return favorites
        .list()
        .map((id) => items.find((it) => it.type === 'station' && it.ref.id === id))
        .filter(Boolean);
    }
    return items
      .map((it) => ({ it, s: score(it, q) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => a.s - b.s || a.it.rank - b.it.rank || a.it.key.length - b.it.key.length)
      .slice(0, 8)
      .map((x) => x.it);
  }

  let shown = [];
  let active = -1;
  function render() {
    shown = results(input.value);
    active = shown.length && input.value.trim() ? 0 : -1;
    if (!shown.length) {
      list.innerHTML = input.value.trim()
        ? '<li class="sr-empty">Nada encontrado</li>'
        : '<li class="sr-empty">Digite o nome de uma estação ou linha. Toque na ★ de uma estação para ela aparecer aqui.</li>';
    } else {
      const head = input.value.trim() ? '' : '<li class="sr-head">Favoritas</li>';
      list.innerHTML = head + shown.map((it, i) => `<li role="option" class="sr ${i === active ? 'on' : ''}" data-i="${i}">${it.html}</li>`).join('');
    }
    list.hidden = false;
  }
  function highlight() {
    list.querySelectorAll('.sr').forEach((el) => el.classList.toggle('on', +el.dataset.i === active));
    list.querySelector('.sr.on')?.scrollIntoView({ block: 'nearest' });
  }
  function choose(it) {
    if (!it) return;
    close();
    if (it.type === 'station') app.selectStation(it.ref);
    else if (it.type === 'line') app.selectLine(it.ref);
    else app.selectPoi(it.ref);
  }
  function open() {
    root.classList.add('open');
    input.focus();
    render();
  }
  function close() {
    root.classList.remove('open');
    list.hidden = true;
    input.value = '';
    input.blur();
  }

  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(shown[Math.max(0, active)]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  // pointerdown (e não click) para escolher antes de o campo perder o foco
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('.sr');
    if (!li) return;
    e.preventDefault();
    choose(shown[+li.dataset.i]);
  });
  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  document.addEventListener('pointerdown', (e) => {
    if (!root.contains(e.target) && e.target !== openBtn && !openBtn.contains(e.target)) {
      if (root.classList.contains('open') || !list.hidden) close();
    }
  });
  // atalho "/" para buscar (computador)
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      open();
    }
  });

  return { open, close };
}
