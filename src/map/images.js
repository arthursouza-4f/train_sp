// Imagens desenhadas em canvas e registradas no mapa: plaquinhas com o número das linhas e
// marcadores dos pontos de interesse.

import { ICON_PATHS, POI_COLOR } from '../ui/icons.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Plaquinha "número da linha" (cor oficial, contorno branco). */
function shield(line, pr) {
  const h = 18;
  const font = `700 ${11 * pr}px ${FONT}`;
  const c = document.createElement('canvas').getContext('2d');
  c.font = font;
  const w = Math.max(h, Math.ceil(c.measureText(line.number).width / pr) + 10);
  const W = (w + 3) * pr;
  const H = (h + 3) * pr;
  c.canvas.width = W;
  c.canvas.height = H;
  c.font = font;
  roundRect(c, 1.5 * pr, 1.5 * pr, w * pr, h * pr, 4.5 * pr);
  c.lineWidth = 3 * pr;
  c.strokeStyle = '#ffffff';
  c.stroke();
  c.fillStyle = line.color;
  c.fill();
  c.fillStyle = line.darkText ? '#1d1d1d' : '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(line.number, W / 2, H / 2 + 0.5 * pr);
  return c.getImageData(0, 0, W, H);
}

/** Marcador de ponto de interesse: quadrado branco com o ícone na cor do tipo. */
function poiMarker(type, pr) {
  const s = 22;
  const color = POI_COLOR[type];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${14 * pr}" height="${14 * pr}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[type]}</svg>`;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas').getContext('2d');
      const S = (s + 2) * pr;
      c.canvas.width = S;
      c.canvas.height = S;
      roundRect(c, 1 * pr, 1 * pr, s * pr, s * pr, 6 * pr);
      c.fillStyle = '#ffffff';
      c.fill();
      c.lineWidth = 1.5 * pr;
      c.strokeStyle = color;
      c.stroke();
      c.drawImage(img, (S - 14 * pr) / 2, (S - 14 * pr) / 2);
      resolve(c.getImageData(0, 0, S, S));
    };
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

export async function addMapImages(map, net) {
  const pr = Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 1)));
  for (const line of net.lines) map.addImage(`shield-${line.id}`, shield(line, pr), { pixelRatio: pr });
  await Promise.all(
    Object.keys(POI_COLOR).map(async (type) => {
      const img = await poiMarker(type, pr);
      if (img) map.addImage(`poi-${type}`, img, { pixelRatio: pr });
    }),
  );
}
