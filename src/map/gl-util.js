// Utilitários das camadas WebGL2 desenhadas dentro do mapa (linhas e trens).

export function compileProgram(gl, vs, fs) {
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const u = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(prog, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(prog, name);
  }
  return { prog, u };
}

export const isWebGL2 = (gl) => typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

/**
 * Matriz final da camada = mainMatrix (Mercator → clip, float64, do MapLibre) · M, onde M leva os
 * "km Mercator" locais (y para cima) ao Mercator do mapa. Composta em float64 e só então
 * convertida para float32: evita tremidos de precisão de perto.
 */
export function composeMatrix(main, geo, out) {
  const s = geo.mercPerKm;
  // colunas de M: x → (s,0,0), y → (0,0,s), z → (0,s,0), translação → (mx0,my0,0)
  for (let r = 0; r < 4; r++) {
    const a0 = main[r], a1 = main[4 + r], a2 = main[8 + r], a3 = main[12 + r];
    out[r] = a0 * s;
    out[4 + r] = a2 * s;
    out[8 + r] = a1 * s;
    out[12 + r] = a0 * geo.mx0 + a1 * geo.my0 + a3;
  }
  return out;
}

/** km por px CSS no centro da tela dividido pelo w (clip) do centro: no shader, km/px = w · isso. */
export function pxScale(map, geo, matrix, tmp) {
  const c = map.getCenter();
  geo.toLocal(...geo.fromLngLat(c.lng, c.lat), tmp);
  const wc = matrix[3] * tmp.x + matrix[11] * tmp.z + matrix[15];
  const kmPerPx = 1 / (512 * Math.pow(2, map.getZoom()) * geo.mercPerKm);
  return kmPerPx / Math.max(wc, 1e-6);
}
