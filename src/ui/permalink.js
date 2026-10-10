// Link compartilhável: o que está selecionado vai para o endereço (#estacao=pinheiros, #linha=4,
// #trem=…, #local=…). Abrir o link reproduz a seleção.

export const slugify = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function createPermalink(net) {
  // nomes repetidos (ex.: Lapa da Linha 7 e Lapa da Linha 8) ganham o número da linha
  const count = new Map();
  for (const s of net.stations) count.set(slugify(s.name), (count.get(slugify(s.name)) ?? 0) + 1);
  const stationSlug = new Map();
  const bySlug = new Map();
  for (const s of net.stations) {
    let k = slugify(s.name);
    if (count.get(k) > 1) k += '-' + s.lineObjs.map((l) => l.number).join('-');
    stationSlug.set(s, k);
    bySlug.set(k, s);
  }
  const poiSlug = (p) => slugify(p.name);

  return {
    stationSlug: (s) => stationSlug.get(s),
    /** Fragmento do endereço para a seleção atual ('' = nada selecionado). */
    hashFor(sel) {
      // id do trem 'L9:0|1|20736|129' vira 'L9.0.1.20736.129' (link sem caracteres escapados)
      if (sel.train) return `#trem=${sel.train.id.replace(':', '.').replaceAll('|', '.')}`;
      if (sel.poi) return `#local=${poiSlug(sel.poi)}`;
      if (sel.station) return `#estacao=${stationSlug.get(sel.station)}`;
      if (sel.lines.size === 1) return `#linha=${net.lineById.get([...sel.lines][0]).number}`;
      return '';
    },
    /** Lê o fragmento: { type: 'station'|'line'|'train'|'poi', ref } ou null. */
    parse(hash) {
      const p = new URLSearchParams(hash.replace(/^#/, ''));
      if (p.has('estacao')) {
        const s = bySlug.get(p.get('estacao'));
        return s ? { type: 'station', ref: s } : null;
      }
      if (p.has('linha')) {
        const n = p.get('linha').replace(/^l/i, '');
        const line = net.lines.find((l) => l.number === n || slugify(l.name) === slugify(n));
        return line ? { type: 'line', ref: line } : null;
      }
      if (p.has('trem')) {
        const parts = p.get('trem').split(/[.:|]/);
        const id = `${parts[0]}:${parts.slice(1).join('|')}`;
        const line = net.lineById.get(parts[0]);
        return { type: 'train', ref: id, line };
      }
      if (p.has('local')) {
        const poi = net.pois.find((x) => poiSlug(x) === p.get('local'));
        return poi ? { type: 'poi', ref: poi } : null;
      }
      return null;
    },
  };
}
