// Mapa de fundo: tiles vetoriais do OpenStreetMap (recorte do Protomaps em public/map/sp.pmtiles,
// gerado por scripts/fetch-map.mjs) com um estilo claro e discreto, para as linhas aparecerem.
// Tudo é servido pelo próprio site: nenhum servidor de mapas externo é usado.

import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { layers, LIGHT } from '@protomaps/basemaps';

// Paleta: terra em cinza quente bem claro, água azul acinzentada, verdes suaves e vias brancas.
// Cores saturadas ficam reservadas para as linhas de trem.
const FLAVOR = {
  ...LIGHT,
  background: '#e9e7e2',
  earth: '#f1efeb',
  park_a: '#e1ebdb',
  park_b: '#d3e4ca',
  wood_a: '#dde8d6',
  wood_b: '#cfe2c5',
  scrub_a: '#e0e9d9',
  scrub_b: '#d4e3cb',
  hospital: '#f1e6e4',
  school: '#efe9df',
  industrial: '#e8e7e4',
  pedestrian: '#eeebe5',
  aerodrome: '#e6e6ea',
  runway: '#f6f6f8',
  zoo: '#dfe9e1',
  military: '#e6e4e0',
  sand: '#efebe0',
  beach: '#efebe0',
  water: '#c3dbea',
  buildings: '#e2dfd9',
  pier: '#ebe9e5',
  // vias
  other: '#f8f7f4',
  minor_service: '#f8f7f4',
  minor_a: '#fbfaf8',
  minor_b: '#ffffff',
  link: '#ffffff',
  major: '#ffffff',
  highway: '#fdf6e3',
  minor_service_casing: '#e6e3dd',
  minor_casing: '#e6e3dd',
  link_casing: '#e0dcd5',
  major_casing_early: '#e0dcd5',
  major_casing_late: '#e0dcd5',
  highway_casing_early: '#e3d9c0',
  highway_casing_late: '#e3d9c0',
  bridges_major: '#ffffff',
  bridges_highway: '#fdf6e3',
  tunnel_other: '#efede9',
  tunnel_minor: '#efede9',
  tunnel_link: '#efede9',
  tunnel_major: '#efede9',
  tunnel_highway: '#efede9',
  tunnel_other_casing: '#e6e3dd',
  tunnel_minor_casing: '#e6e3dd',
  tunnel_link_casing: '#e6e3dd',
  tunnel_major_casing: '#e6e3dd',
  tunnel_highway_casing: '#e6e3dd',
  railway: '#d3cfc8',
  boundaries: '#c4c0b9',
  // rótulos
  roads_label_minor: '#a29d95',
  roads_label_minor_halo: '#ffffff',
  roads_label_major: '#8f8a82',
  roads_label_major_halo: '#ffffff',
  subplace_label: '#9a958d',
  subplace_label_halo: '#f1efeb',
  city_label: '#5d5953',
  city_label_halo: '#f1efeb',
  state_label: '#b5b0a8',
  state_label_halo: '#f1efeb',
  country_label: '#a8a39b',
  address_label: '#a29d95',
  address_label_halo: '#ffffff',
  // ícones de pontos de interesse do mapa em tons apagados (não competem com as linhas)
  pois: {
    blue: '#6f8597',
    green: '#6a8a73',
    lapis: '#75809c',
    pink: '#97808f',
    red: '#9c7f7f',
    slategray: '#7f7b8d',
    tangerine: '#9a8670',
    turquoise: '#6d9191',
  },
  landcover: {
    grassland: '#e3ebda',
    barren: '#efebe1',
    urban_area: '#eceae5',
    farmland: '#e7ecdd',
    glacier: '#ffffff',
    scrub: '#e4eadb',
    forest: '#d8e5d0',
  },
};

let protocolAdded = false;

/** Estilo MapLibre completo do mapa de fundo. `base`: URL absoluta da pasta public/. */
export function createBasemapStyle(base) {
  if (!protocolAdded) {
    maplibregl.addProtocol('pmtiles', new Protocol().tile);
    protocolAdded = true;
  }
  const baseLayers = layers('protomaps', FLAVOR, { lang: 'pt' }).map((l) => {
    // pontos de interesse do mapa só bem de perto: as estações têm prioridade
    if (l.id === 'pois') return { ...l, minzoom: 16 };
    // ferrovias do OSM bem apagadas (as linhas da rede são desenhadas por cima)
    if (l.id === 'roads_rail') return { ...l, paint: { ...l.paint, 'line-opacity': 0.6 } };
    return l;
  });
  return {
    version: 8,
    glyphs: `${base}map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}map/sprites/light`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${base}map/sp.pmtiles`,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>',
      },
    },
    layers: baseLayers,
  };
}

/** Id da primeira camada de rótulos do mapa de fundo (as linhas entram logo abaixo dela). */
export function firstSymbolLayer(map) {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}
