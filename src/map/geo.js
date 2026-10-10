// Conversões entre as coordenadas da rede (km, projeção equiretangular centrada na Sé — ver
// scripts/build-data.mjs) e as do mapa (lng/lat e Mercator).

const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8; // m, mesmo valor do MapLibre

export const mercX = (lng) => (180 + lng) / 360;
export const mercY = (lat) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;

export function createGeo({ lat0, lon0, kx, kz }) {
  const mx0 = mercX(lon0);
  const my0 = mercY(lat0);
  // unidades Mercator por km na latitude de referência
  const mercPerKm = 1000 / (EARTH_CIRCUMFERENCE * Math.cos((lat0 * Math.PI) / 180));

  return {
    lat0,
    lon0,
    mercPerKm,
    mx0,
    my0,
    /** km da rede → [lng, lat] */
    toLngLat: (x, z) => [lon0 + x / kx, lat0 - z / kz],
    /** [lng, lat] → km da rede */
    fromLngLat: (lng, lat) => [(lng - lon0) * kx, (lat0 - lat) * kz],
    /**
     * km da rede → "km Mercator" locais: Mercator com origem na Sé e escala de km na latitude de
     * referência. É o espaço da camada 3D dos trens (linear em relação ao Mercator do mapa).
     */
    toLocal(x, z, out) {
      out.x = (mercX(lon0 + x / kx) - mx0) / mercPerKm;
      out.z = (mercY(lat0 - z / kz) - my0) / mercPerKm;
      return out;
    },
  };
}
