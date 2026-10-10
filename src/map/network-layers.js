// Estações, rótulos, plaquinhas das linhas e pontos de interesse como camadas nativas do MapLibre
// (nítidas em qualquer zoom, com anti-colisão de rótulos feita pelo próprio mapa).
// As linhas em si são desenhadas na camada WebGL própria (rails-layer.js); aqui fica só uma
// camada invisível delas, usada para o toque/clique e para posicionar as plaquinhas.

// largura da linha (px) por zoom — usada também pelos trens para ficarem em cima dela
export const RAIL_WIDTH = [[9, 2], [11, 2.8], [13, 4], [15, 6], [17, 9]];

/** Deslocamento lateral (px) de 1 "unidade" de afastamento entre linhas paralelas, no zoom z. */
export const railUnit = (z) => interp(RAIL_WIDTH, z) + 1.5;

export function interp(stops, z) {
  if (z <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z1, v1] = stops[i];
    if (z <= z1) {
      const [z0, v0] = stops[i - 1];
      return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
    }
  }
  return stops.at(-1)[1];
}

const zoomExpr = (stops, f = (v) => v) => ['interpolate', ['linear'], ['zoom'], ...stops.flatMap(([z, v]) => [z, f(v)])];

const DIM = ['boolean', ['feature-state', 'dim'], false];
const SHOWN = ['boolean', ['feature-state', 'shown'], false];

// camadas que só aparecem depois que as linhas terminam de se desenhar na abertura
const LATE_LAYERS = ['rail-shields', 'poi-bus', 'poi-major', 'st-label', 'st-label-major', 'st-label-sel'];

export function addNetworkLayers(map, net, geo, { beforeLabels }) {
  const ll = (x, z) => geo.toLngLat(x, z).map((v) => Math.round(v * 1e6) / 1e6);

  // ------------------------------------------------------------ fontes
  const rails = net.lines.flatMap((line) =>
    line.services.map((sv) => {
      const coords = [];
      for (let i = 0; i < sv.path.length; i += 2) coords.push(ll(sv.path[i], sv.path[i + 1]));
      return {
        type: 'Feature',
        id: line.index, // feature-state por linha (vale para todos os ramais)
        properties: { line: line.id, k: line.offsetK },
        geometry: { type: 'LineString', coordinates: coords },
      };
    }),
  );
  const stations = net.stations.map((s) => ({
    type: 'Feature',
    id: s.index,
    properties: {
      id: s.id,
      name: s.name,
      transfer: s.isTransfer,
      major: s.isTransfer || s.isTerminal,
      color: s.isTransfer ? '#3a3a3a' : s.lineObjs[0].color,
      rank: -(s.lines.length * 10 + (s.isTerminal ? 5 : 0)),
    },
    geometry: { type: 'Point', coordinates: ll(s.x, s.z) },
  }));
  const pois = net.pois.map((p) => ({
    type: 'Feature',
    id: p.index,
    properties: {
      index: p.index,
      type: p.type,
      short:
        p.type === 'airport'
          ? p.name.replace(/^Aeroporto (Internacional )?de /, '').replace(/\s*\(.*\)/, '')
          : p.name.replace(/^Terminal (Rodoviário )?/, p.type === 'rodoviaria' ? 'Rodoviária ' : ''),
    },
    geometry: { type: 'Point', coordinates: ll(p.x, p.z) },
  }));
  const fc = (features) => ({ type: 'FeatureCollection', features });
  map.addSource('rails', { type: 'geojson', data: fc(rails), tolerance: 0.2 });
  map.addSource('stations', { type: 'geojson', data: fc(stations) });
  map.addSource('pois', { type: 'geojson', data: fc(pois) });

  // ------------------------------------------------------------ linhas: só para o toque (invisível)
  map.addLayer(
    {
      id: 'rail-hit',
      type: 'line',
      source: 'rails',
      paint: {
        'line-color': '#000',
        'line-opacity': 0,
        'line-width': zoomExpr(RAIL_WIDTH, (w) => w + 8),
        'line-offset': ['interpolate', ['linear'], ['zoom'], ...RAIL_WIDTH.flatMap(([z]) => [z, ['*', ['get', 'k'], railUnit(z)]])],
      },
    },
    beforeLabels,
  );

  // ------------------------------------------------------------ estações (acima de tudo)
  const radius = [[9, 2.2], [11, 3], [13, 4.2], [15, 6], [17, 8]];
  map.addLayer({
    id: 'st-circle',
    type: 'circle',
    source: 'stations',
    paint: {
      'circle-radius': zoomExpr(radius, (r) => ['case', ['get', 'transfer'], r * 1.35, r]),
      'circle-color': '#ffffff',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': zoomExpr([[9, 1.1], [13, 1.8], [16, 2.6]]),
      'circle-opacity': ['case', ['!', SHOWN], 0, DIM, 0.45, 1],
      'circle-stroke-opacity': ['case', ['!', SHOWN], 0, DIM, 0.3, 1],
      'circle-pitch-alignment': 'map',
    },
  });
  map.addLayer({
    id: 'st-sel',
    type: 'circle',
    source: 'stations',
    filter: ['==', ['get', 'id'], ''],
    paint: {
      'circle-radius': zoomExpr(radius, (r) => r * 1.35 + 4),
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#1d1d1f',
      'circle-stroke-width': 2,
      'circle-pitch-alignment': 'map',
    },
  });

  // ------------------------------------------------------------ rótulos (camadas de cima têm prioridade)
  const hidden = { visibility: 'none' };
  const text = (size) => ({
    ...hidden,
    'text-field': ['get', 'name'],
    'text-font': ['Noto Sans Medium'],
    'text-size': zoomExpr(size),
    'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
    'text-radial-offset': 0.75,
    'text-justify': 'auto',
    'text-padding': 3,
    'text-max-width': 9,
  });
  const textPaint = (color) => ({
    'text-color': color,
    'text-halo-color': 'rgba(255,255,255,0.95)',
    'text-halo-width': 1.6,
    'text-halo-blur': 0.3,
    'text-opacity': ['case', DIM, 0.45, 1],
  });
  map.addLayer({
    id: 'rail-shields',
    type: 'symbol',
    source: 'rails',
    minzoom: 9,
    maxzoom: 15.5,
    layout: {
      ...hidden,
      'symbol-placement': 'line',
      'symbol-spacing': zoomExpr([[9, 180], [12, 320], [15, 480]]),
      'icon-image': ['concat', 'shield-', ['get', 'line']],
      'icon-rotation-alignment': 'viewport',
      'icon-padding': 6,
    },
    paint: { 'icon-opacity': ['case', DIM, 0.3, 1] },
  });
  map.addLayer({
    id: 'poi-bus',
    type: 'symbol',
    source: 'pois',
    minzoom: 12.5,
    filter: ['==', ['get', 'type'], 'bus'],
    layout: {
      ...hidden,
      'icon-image': 'poi-bus',
      'icon-size': zoomExpr([[12.5, 0.75], [15, 0.95]]),
      'text-field': ['step', ['zoom'], '', 14.5, ['get', 'short']],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-variable-anchor': ['left', 'right'],
      'text-radial-offset': 1.1,
      'text-optional': true,
    },
    paint: { 'text-color': '#13795b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
  });
  map.addLayer({
    id: 'poi-major',
    type: 'symbol',
    source: 'pois',
    minzoom: 9.5,
    filter: ['!=', ['get', 'type'], 'bus'],
    layout: {
      ...hidden,
      'icon-image': ['concat', 'poi-', ['get', 'type']],
      'icon-size': zoomExpr([[9.5, 0.8], [14, 1]]),
      'text-field': ['get', 'short'],
      'text-font': ['Noto Sans Medium'],
      'text-size': zoomExpr([[10, 10.5], [14, 12]]),
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
      'text-radial-offset': 1.2,
      'text-optional': true,
      'symbol-sort-key': -50,
    },
    paint: {
      'text-color': ['match', ['get', 'type'], 'airport', '#4a40a8', '#9a5005'],
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
    },
  });
  map.addLayer({
    id: 'st-label',
    type: 'symbol',
    source: 'stations',
    minzoom: 12.3,
    filter: ['!', ['get', 'major']],
    layout: text([[12.3, 10.5], [14, 11.5], [16, 13]]),
    paint: textPaint('#3b3b3d'),
  });
  map.addLayer({
    id: 'st-label-major',
    type: 'symbol',
    source: 'stations',
    minzoom: 9.6,
    filter: ['get', 'major'],
    layout: { ...text([[10, 11], [13, 12.5], [16, 14]]), 'symbol-sort-key': ['get', 'rank'] },
    paint: textPaint('#1d1d1f'),
  });
  map.addLayer({
    id: 'st-label-sel',
    type: 'symbol',
    source: 'stations',
    filter: ['in', ['get', 'id'], ['literal', []]],
    layout: { ...text([[9, 11], [13, 13], [16, 14.5]]), 'symbol-sort-key': ['get', 'rank'] },
    paint: { ...textPaint('#111111'), 'text-halo-width': 2 },
  });

  const STATION_LAYERS = ['st-circle', 'st-label', 'st-label-major', 'st-label-sel'];
  const POI_LAYERS = ['poi-bus', 'poi-major'];
  const MINOR = ['!', ['get', 'major']];
  const MAJOR = ['get', 'major'];

  function nearest(features, point, key) {
    let best = null;
    let bd = Infinity;
    for (const f of features) {
      const p = map.project(f.geometry.coordinates);
      const d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d < bd) { bd = d; best = f.properties[key]; }
    }
    return best;
  }
  const box = (p, t) => [[p.x - t, p.y - t], [p.x + t, p.y + t]];
  const shown = new Uint8Array(net.stations.length);

  return {
    INTERACTIVE: [...STATION_LAYERS, ...POI_LAYERS, 'rail-hit', 'rail-shields'],
    /** Estação aparece (abertura: quando a linha chega até ela). */
    show(station) {
      if (shown[station.index]) return;
      shown[station.index] = 1;
      map.setFeatureState({ source: 'stations', id: station.index }, { shown: true });
    },
    /** Rótulos, plaquinhas e pontos de interesse aparecem (com o fade do próprio mapa). */
    showLabels() {
      for (const id of LATE_LAYERS) map.setLayoutProperty(id, 'visibility', 'visible');
    },
    /** Destaque: linhas/estações fora da seleção ficam apagadas. */
    setSelection(selLines, selStation) {
      const any = selLines.size > 0 || !!selStation;
      for (const line of net.lines) {
        const dim = selLines.size > 0 && !selLines.has(line.id);
        map.setFeatureState({ source: 'rails', id: line.index }, { dim });
      }
      for (const s of net.stations) {
        const dim = any && s !== selStation && !s.lines.some((l) => selLines.has(l));
        map.setFeatureState({ source: 'stations', id: s.index }, { dim });
      }
      const ids = net.stations.filter((s) => s === selStation || s.lines.some((l) => selLines.has(l))).map((s) => s.id);
      const notSel = ['!', ['in', ['get', 'id'], ['literal', ids]]];
      map.setFilter('st-label-sel', ['in', ['get', 'id'], ['literal', ids]]);
      map.setFilter('st-label', ['all', MINOR, notSel]);
      map.setFilter('st-label-major', ['all', MAJOR, notSel]);
      map.setFilter('st-sel', ['==', ['get', 'id'], selStation?.id ?? '']);
    },
    stationAt(point, tol) {
      const fs = map.queryRenderedFeatures(box(point, tol), { layers: STATION_LAYERS });
      const id = fs.length ? nearest(fs, point, 'id') : null;
      return id ? net.stationById.get(id) : null;
    },
    poiAt(point, tol) {
      const fs = map.queryRenderedFeatures(box(point, tol), { layers: POI_LAYERS });
      const i = fs.length ? nearest(fs, point, 'index') : null;
      return i != null ? net.pois[i] : null;
    },
    lineAt(point, tol) {
      const fs = map.queryRenderedFeatures(box(point, tol), { layers: ['rail-shields', 'rail-hit'] });
      const f = fs.find((x) => !map.getFeatureState({ source: 'rails', id: x.id }).dim) ?? fs[0];
      return f ? net.lineById.get(f.properties.line) : null;
    },
  };
}
