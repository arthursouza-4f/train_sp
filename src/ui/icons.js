// Ícones SVG simples (traço), usados nos painéis e, rasterizados, nos marcadores do mapa.
export const ICON_PATHS = {
  bus: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 21v-3M16 21v-3"/><circle cx="8.5" cy="14.5" r=".6"/><circle cx="15.5" cy="14.5" r=".6"/>',
  rodoviaria: '<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M3 11h18M7 20v-3M17 20v-3M8 5v6M14 5v6"/>',
  airport: '<path d="M10.5 3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V9l7 4v2l-7-2v5l2 1.5V21l-3.5-1L8.5 21v-1.5l2-1.5v-5l-7 2v-2l7-4z"/>',
  walk: '<circle cx="13" cy="4" r="1.6"/><path d="M10 21l2-6 3 3v3M9 12l2-4 4 2 2 3M11 8l-2 1-1 3"/>',
  transfer: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  train: '<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 11h12M9 21l-2-2M15 21l2-2"/><circle cx="9.5" cy="14" r=".6"/><circle cx="14.5" cy="14" r=".6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};

export const ICONS = Object.fromEntries(
  Object.entries(ICON_PATHS).map(([k, d]) => [k, `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`]),
);

// cor de cada tipo de ponto de interesse (marcadores no mapa e ícones nos painéis)
export const POI_COLOR = {
  bus: '#13795b',
  rodoviaria: '#b45f06',
  airport: '#5146b8',
};

export const POI_LABEL = {
  bus: 'Terminal de ônibus (SPTrans)',
  rodoviaria: 'Terminal rodoviário',
  airport: 'Aeroporto',
};
