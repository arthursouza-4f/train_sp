// Metadados das linhas sobre trilhos da Região Metropolitana de São Paulo.
// Usado tanto pelo script de build dos dados (scripts/build-data.mjs) quanto pelo app.
//
// - `routes`: route_id no GTFS oficial da SPTrans (cada route vira um "serviço" da linha).
// - `color`: cor oficial da linha (mesma do mapa oficial / route_color do GTFS).
// - `neon`: mesma matiz, mais luminosa, para o brilho no fundo escuro.
// - `kin`: parâmetros do modelo cinemático usado para ESTIMAR a posição dos trens:
//     vmax  velocidade de cruzeiro (m/s), acc/dec aceleração e frenagem (m/s²),
//     dwell tempo parado na plataforma (s), dwellX tempo em estações de integração (s).
// - `tripMin`: tempo típico de ponta a ponta (min) pela velocidade comercial da linha
//   (≈30–45 km/h no Metrô, 40–45 km/h nos trens metropolitanos). A velocidade de cruzeiro
//   é calibrada para fechar esse tempo; aceleração, frenagem e paradas seguem o modelo.
// - `minHeadway`: intervalo técnico mínimo (s). O GTFS traz alguns intervalos abaixo do
//   que a sinalização permite (ex.: 60 s na Linha 1); nesses casos usamos esse piso.
// - `open`/`close`: horário de operação oficial (partidas dos terminais), "HH:MM".
//   `satClose`: extensão de sábado para domingo, quando existe.

export const LINES = [
  {
    id: 'L1', number: '1', name: 'Azul', color: '#0455A1', neon: '#2186FF', system: 'Metrô', operator: 'Metrô',
    routes: ['METRÔ L1'],
    tripMin: 37,
    kin: { vmax: 20, acc: 1.0, dec: 1.0, dwell: 28, dwellX: 40 },
    minHeadway: 118, open: '04:40', close: '24:00', satClose: '25:00',
  },
  {
    id: 'L2', number: '2', name: 'Verde', color: '#007E5E', neon: '#00C98F', system: 'Metrô', operator: 'Metrô',
    routes: ['METRÔ L2'],
    tripMin: 27,
    kin: { vmax: 20, acc: 1.0, dec: 1.0, dwell: 28, dwellX: 40 },
    minHeadway: 120, open: '04:40', close: '24:00', satClose: '25:00',
  },
  {
    id: 'L3', number: '3', name: 'Vermelha', color: '#EE372F', neon: '#FF3B30', system: 'Metrô', operator: 'Metrô',
    routes: ['METRÔ L3'],
    tripMin: 36,
    kin: { vmax: 22, acc: 1.0, dec: 1.0, dwell: 28, dwellX: 42 },
    minHeadway: 118, open: '04:40', close: '24:00', satClose: '25:00',
  },
  {
    id: 'L4', number: '4', name: 'Amarela', color: '#FFD400', neon: '#FFD400', system: 'Metrô', operator: 'ViaQuatro',
    routes: ['METRÔ L4'],
    tripMin: 23,
    kin: { vmax: 22, acc: 1.1, dec: 1.1, dwell: 25, dwellX: 35 },
    minHeadway: 90, open: '04:40', close: '24:00', satClose: '25:00',
  },
  {
    id: 'L5', number: '5', name: 'Lilás', color: '#9B3894', neon: '#C860D2', system: 'Metrô', operator: 'ViaMobilidade',
    routes: ['METRÔ L5'],
    tripMin: 35,
    kin: { vmax: 22, acc: 1.1, dec: 1.1, dwell: 25, dwellX: 35 },
    minHeadway: 100, open: '04:40', close: '24:00', satClose: '25:00',
  },
  {
    id: 'L6', number: '6', name: 'Laranja', color: '#FF6600', neon: '#FF7A1A', system: 'Metrô', operator: 'Linha Uni',
    routes: ['METRÔ L6'],
    tripMin: 9,
    kin: { vmax: 22, acc: 1.1, dec: 1.1, dwell: 25, dwellX: 35 },
    minHeadway: 100, weekdaysOnly: true, note: 'Operação parcial / assistida (dias úteis).',
  },
  {
    id: 'L7', number: '7', name: 'Rubi', color: '#CA016B', neon: '#FF2D93', system: 'Trem metropolitano', operator: 'TIC Trens',
    routes: ['CPTM L07'],
    tripMin: 80,
    kin: { vmax: 25, acc: 0.8, dec: 0.8, dwell: 38, dwellX: 50 },
    minHeadway: 180, open: '04:00', close: '24:00',
  },
  {
    id: 'L8', number: '8', name: 'Diamante', color: '#97A098', neon: '#C6D0C7', system: 'Trem metropolitano', operator: 'ViaMobilidade',
    routes: ['CPTM L08'],
    tripMin: 70,
    kin: { vmax: 25, acc: 0.8, dec: 0.8, dwell: 35, dwellX: 45 },
    minHeadway: 180, open: '04:00', close: '24:00',
  },
  {
    id: 'L9', number: '9', name: 'Esmeralda', color: '#01A9A7', neon: '#00D9C8', system: 'Trem metropolitano', operator: 'ViaMobilidade',
    routes: ['CPTM L09'],
    tripMin: 58,
    kin: { vmax: 25, acc: 0.8, dec: 0.8, dwell: 35, dwellX: 45 },
    minHeadway: 180, open: '04:00', close: '24:00',
  },
  {
    id: 'L10', number: '10', name: 'Turquesa', color: '#049FC3', neon: '#1EC8F2', system: 'Trem metropolitano', operator: 'CPTM',
    routes: ['CPTM L10'],
    tripMin: 70,
    kin: { vmax: 25, acc: 0.8, dec: 0.8, dwell: 38, dwellX: 50 },
    minHeadway: 180, open: '04:00', close: '24:00',
  },
  {
    id: 'L11', number: '11', name: 'Coral', color: '#F68368', neon: '#FF9F86', system: 'Trem metropolitano', operator: 'Trivia Trens / CPTM',
    routes: ['CPTM L11'],
    tripMin: 75,
    kin: { vmax: 25, acc: 0.8, dec: 0.8, dwell: 38, dwellX: 50 },
    minHeadway: 180, open: '04:00', close: '24:00',
  },
  {
    id: 'L12', number: '12', name: 'Safira', color: '#133C8D', neon: '#4F63F0', system: 'Trem metropolitano', operator: 'Trivia Trens / CPTM',
    routes: ['CPTM L12'],
    tripMin: 55,
    kin: { vmax: 25, acc: 0.8, dec: 0.8, dwell: 38, dwellX: 50 },
    minHeadway: 180, open: '04:00', close: '24:00',
  },
  {
    id: 'L13', number: '13', name: 'Jade', color: '#00B352', neon: '#1AE070', system: 'Trem metropolitano', operator: 'Trivia Trens / CPTM',
    routes: ['CPTM L13'],
    tripMin: 13,
    kin: { vmax: 25, acc: 0.8, dec: 0.8, dwell: 45, dwellX: 60 },
    minHeadway: 300, open: '04:00', close: '24:00',
  },
  {
    id: 'L15', number: '15', name: 'Prata', color: '#C0C0C0', neon: '#E2E6EB', system: 'Monotrilho', operator: 'Metrô',
    routes: ['METRÔ 15'],
    tripMin: 25,
    kin: { vmax: 22, acc: 1.0, dec: 1.0, dwell: 25, dwellX: 35 },
    minHeadway: 180, open: '04:40', close: '24:00', satClose: '25:00',
  },
  {
    id: 'L17', number: '17', name: 'Ouro', color: '#D48500', neon: '#F2A51C', system: 'Monotrilho', operator: 'Metrô',
    routes: ['METRÔ17A', 'METRÔ17W'],
    tripMin: 12,
    kin: { vmax: 20, acc: 1.0, dec: 1.0, dwell: 25, dwellX: 35 },
    minHeadway: 180, weekdaysOnly: true, note: 'Operação parcial / assistida (dias úteis).',
  },
];

export const LINE_BY_ID = Object.fromEntries(LINES.map((l) => [l.id, l]));

// Entidades citadas no aviso de isenção (o site não tem vínculo com nenhuma delas).
export const ENTITIES = [
  'Metrô (Companhia do Metropolitano de São Paulo)',
  'CPTM (Companhia Paulista de Trens Metropolitanos)',
  'ViaQuatro', 'ViaMobilidade', 'TIC Trens', 'Trivia Trens', 'Linha Uni',
  'SPTrans', 'EMTU', 'Governo do Estado de São Paulo', 'Prefeitura de São Paulo',
];
