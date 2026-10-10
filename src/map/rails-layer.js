// Linhas da rede desenhadas numa camada WebGL2 própria dentro do mapa (abaixo dos rótulos):
// fitas com largura em px, contorno branco e as animações — linhas se desenhando na abertura,
// pulso suave correndo na linha selecionada e rastro em degradê atrás de cada trem.
//
// O rastro vem de uma textura (uma linha de texels por serviço) repintada a cada passo da simulação.

import { clamp, hexToRgb, needsDarkText } from '../core/util.js';
import { compileProgram, composeMatrix, isWebGL2 } from './gl-util.js';
import { RAIL_WIDTH, interp, railUnit } from './network-layers.js';

const MAX_LINES = 32;
const CASING = 1; // px de contorno de cada lado
const AURA = 3.5; // px extras do degradê do rastro, de cada lado

const VS = /* glsl */ `#version 300 es
  uniform mat4 uMatrix;
  uniform vec2 uResolution;
  uniform float uWidth;
  uniform float uUnit;
  uniform float uPass;   // 0 = contorno (+ degradê do rastro), 1 = miolo colorido
  uniform float uGroup;  // 0 = linhas apagadas, 1 = em destaque (desenhadas por cima)
  uniform vec4 uLineA[${MAX_LINES}]; // cor rgb, afastamento (unidades)
  uniform vec4 uLineC[${MAX_LINES}]; // fluxo, revelado (km), revelando, grupo
  uniform sampler2D uTrail;
  layout(location = 0) in vec2 aPos;
  layout(location = 1) in vec2 aPrev;
  layout(location = 2) in vec2 aNext;
  layout(location = 3) in vec4 aMeta; // lado (-1/1), km ao longo do traçado, linha, linha da textura
  layout(location = 4) in float aLen;
  out float vSidePx;
  out float vDist;
  out vec2 vUV;
  flat out int vLine;

  vec2 scr(vec4 c) { return c.xy / c.w * 0.5 * uResolution; }

  void main() {
    int li = int(aMeta.z + 0.5);
    vLine = li;
    vDist = aMeta.y;
    float H = float(textureSize(uTrail, 0).y);
    vUV = vec2(aMeta.y / aLen, (aMeta.w + 0.5) / H);
    if (abs(uLineC[li].w - uGroup) > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float trail = textureLod(uTrail, vUV, 0.0).r;
    float hw2 = uWidth * 0.5 + (uPass < 0.5 ? ${CASING.toFixed(1)} + ${AURA.toFixed(1)} * trail : 0.0);
    vSidePx = aMeta.x * hw2;
    vec4 c = uMatrix * vec4(aPos.x, 0.0, aPos.y, 1.0);
    vec4 ca = uMatrix * vec4(aPrev.x, 0.0, aPrev.y, 1.0);
    vec4 cb = uMatrix * vec4(aNext.x, 0.0, aNext.y, 1.0);
    // atrás da câmera: não extruda, o recorte da GPU cuida do resto
    if (c.w < 1e-4) { gl_Position = c; return; }
    vec2 s = scr(c);
    vec2 d0 = ca.w > 1e-4 ? s - scr(ca) : vec2(0.0);
    vec2 d1 = cb.w > 1e-4 ? scr(cb) - s : vec2(0.0);
    float l0 = length(d0);
    float l1 = length(d1);
    if (l0 < 1e-5 && l1 < 1e-5) { d1 = vec2(1.0, 0.0); l1 = 1.0; }
    d0 = l0 > 1e-5 ? d0 / l0 : d1 / l1;
    d1 = l1 > 1e-5 ? d1 / l1 : d0;
    vec2 t = d0 + d1;
    float lt = length(t);
    t = lt > 1e-4 ? t / lt : d1;
    vec2 nrm = vec2(-t.y, t.x); // esquerda do sentido do traçado
    float miter = 1.0 / max(dot(nrm, vec2(-d1.y, d1.x)), 0.6);
    // afastamento positivo = à direita do traçado
    vec2 off = nrm * (aMeta.x * hw2 - uLineA[li].w * uUnit) * miter;
    c.xy += off / (0.5 * uResolution) * c.w;
    gl_Position = c;
  }
`;

const FS = /* glsl */ `#version 300 es
  precision highp float;
  uniform float uWidth;
  uniform float uPass;
  uniform float uTime;
  uniform vec4 uLineA[${MAX_LINES}];
  uniform vec4 uLineB[${MAX_LINES}]; // contorno rgb, opacidade
  uniform vec4 uLineC[${MAX_LINES}];
  uniform sampler2D uTrail;
  in float vSidePx;
  in float vDist;
  in vec2 vUV;
  flat in int vLine;
  out vec4 outColor;

  void main() {
    vec4 A = uLineA[vLine];
    vec4 B = uLineB[vLine];
    vec4 C = uLineC[vLine];
    if (vDist > C.y) discard;
    float d = abs(vSidePx);
    float trail = texture(uTrail, vUV).r;
    vec3 col;
    float a;
    if (uPass < 0.5) {
      // contorno + degradê na cor da linha atrás do trem
      float inner = uWidth * 0.5 + ${CASING.toFixed(1)};
      float ai = 1.0 - smoothstep(inner - 0.6, inner + 0.6, d);
      float t = clamp((d - inner) / ${AURA.toFixed(1)}, 0.0, 1.0);
      float aw = trail * 0.5 * (1.0 - t) * (1.0 - t) * (1.0 - ai);
      a = ai * 0.95 + aw;
      col = B.rgb * ai * 0.95 + A.rgb * aw;
    } else {
      float hw = uWidth * 0.5;
      a = 1.0 - smoothstep(hw - 0.6, hw + 0.6, d);
      // pulso suave correndo na linha selecionada
      float flow = C.x * pow(max(0.0, sin(vDist * 3.2 - uTime * 2.6)), 10.0);
      // ponta clara enquanto a linha se desenha
      float tip = C.z * (1.0 - smoothstep(0.0, 1.2, C.y - vDist));
      float k = clamp(trail * 0.42 + flow * 0.55 + tip * 0.7, 0.0, 0.85);
      col = mix(A.rgb, vec3(1.0), k) * a;
    }
    outColor = vec4(col, a) * B.w;
  }
`;

export function createRailsLayer(net, geo) {
  // ------------------------------------------------------------ geometria
  const services = net.lines.flatMap((l) => l.services);
  let total = 0;
  for (const sv of services) total += sv.path.length / 2;
  const F = 11; // floats por vértice
  const verts = new Float32Array(total * 2 * F);
  const index = new Uint32Array((total - services.length) * 6);
  const tmp = { x: 0, z: 0 };
  let v = 0;
  let ii = 0;
  let maxLen = 0;
  services.forEach((sv, row) => {
    sv.trailRow = row;
    maxLen = Math.max(maxLen, sv.length);
    const n = sv.path.length / 2;
    const pts = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      geo.toLocal(sv.path[2 * i], sv.path[2 * i + 1], tmp);
      pts[2 * i] = tmp.x;
      pts[2 * i + 1] = tmp.z;
    }
    const base = v;
    for (let i = 0; i < n; i++) {
      const ip = Math.max(0, i - 1);
      const inx = Math.min(n - 1, i + 1);
      for (const side of [-1, 1]) {
        const o = v * F;
        verts[o] = pts[2 * i];
        verts[o + 1] = pts[2 * i + 1];
        verts[o + 2] = pts[2 * ip];
        verts[o + 3] = pts[2 * ip + 1];
        verts[o + 4] = pts[2 * inx];
        verts[o + 5] = pts[2 * inx + 1];
        verts[o + 6] = side;
        verts[o + 7] = sv.cum[i]; // km na métrica da rede (mesma do s da simulação)
        verts[o + 8] = sv.line.index;
        verts[o + 9] = row;
        verts[o + 10] = sv.length;
        v++;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + 2 * i;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], ii);
      ii += 6;
    }
  });

  // ------------------------------------------------------------ rastro (textura R8: x = posição, y = serviço)
  const TW = clamp(Math.ceil(maxLen / 0.02), 256, 2048);
  const TH = services.length;
  const trail = new Uint8Array(TW * TH);
  let trailDirty = true;

  // ------------------------------------------------------------ estado por linha
  const lineA = new Float32Array(MAX_LINES * 4);
  const lineB = new Float32Array(MAX_LINES * 4);
  const lineC = new Float32Array(MAX_LINES * 4);
  const state = net.lines.map((line) => {
    const rgb = hexToRgb(line.color);
    const casing = needsDarkText(line.color) ? rgb.map((c) => c * 0.72) : [1, 1, 1];
    lineA.set([...rgb, line.offsetK ?? 0], line.index * 4);
    lineB.set([...casing, 1], line.index * 4);
    return { line, alpha: 1, flow: 0, reveal: 0, length: Math.max(...line.services.map((s) => s.length)) };
  });

  const matrix = new Float32Array(16);
  let map = null;
  let gl = null;
  let prog = null;
  let vao = null;
  let tex = null;
  let disabled = false;

  const layer = {
    id: 'rails',
    type: 'custom',
    renderingMode: '2d',
    onAdd(m, context) {
      map = m;
      if (!isWebGL2(context)) {
        disabled = true;
        return;
      }
      gl = context;
      try {
        prog = compileProgram(gl, VS, FS);
      } catch (err) {
        disabled = true;
        console.error(err);
        return;
      }
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      const B = 4 * F;
      const attr = (loc, size, off) => {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, B, off * 4);
      };
      attr(0, 2, 0);
      attr(1, 2, 2);
      attr(2, 2, 4);
      attr(3, 4, 6);
      attr(4, 1, 10);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, TW, TH, 0, gl.RED, gl.UNSIGNED_BYTE, trail);
      gl.bindTexture(gl.TEXTURE_2D, null);
      trailDirty = false;
    },
    render(context, args) {
      if (disabled) return;
      composeMatrix(args.defaultProjectionData.mainMatrix, geo, matrix);
      const zoom = map.getZoom();
      const canvas = map.getCanvas();
      gl.useProgram(prog.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (trailDirty) {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TW, TH, gl.RED, gl.UNSIGNED_BYTE, trail);
        trailDirty = false;
      }
      const u = prog.u;
      gl.uniformMatrix4fv(u.uMatrix, false, matrix);
      gl.uniform2f(u.uResolution, canvas.clientWidth, canvas.clientHeight);
      gl.uniform1f(u.uWidth, interp(RAIL_WIDTH, zoom));
      gl.uniform1f(u.uUnit, railUnit(zoom));
      gl.uniform1f(u.uTime, performance.now() / 1000);
      gl.uniform1i(u.uTrail, 0);
      gl.uniform4fv(u.uLineA, lineA);
      gl.uniform4fv(u.uLineB, lineB);
      gl.uniform4fv(u.uLineC, lineC);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vao);
      // linhas apagadas primeiro; as em destaque por cima (contorno e miolo de cada grupo)
      for (const group of [0, 1]) {
        gl.uniform1f(u.uGroup, group);
        for (const pass of [0, 1]) {
          gl.uniform1f(u.uPass, pass);
          gl.drawElements(gl.TRIANGLES, index.length, gl.UNSIGNED_INT, 0);
        }
      }
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
  };

  return {
    layer,
    get enabled() {
      return !disabled;
    },
    /** Abertura: revela as linhas em sequência. p: 0..1. */
    setReveal(p) {
      const nl = net.lines.length;
      for (const st of state) {
        const order = st.line.index / nl;
        const local = clamp((p - order * 0.55) / 0.45, 0, 1);
        const k = 1 - Math.pow(1 - local, 2.2);
        st.reveal = k >= 1 ? 1e9 : k * (st.length + 0.5);
        const o = st.line.index * 4;
        lineC[o + 1] = st.reveal;
        lineC[o + 2] = k > 0 && k < 1 ? 1 : 0;
      }
    },
    revealOf: (line) => state[line.index].reveal,
    /** Destaque: linha selecionada pulsa; as demais apagam (transição suave). Retorna true enquanto anima. */
    update(dt, selectedLines) {
      const any = selectedLines.size > 0;
      const k = 1 - Math.exp(-dt * 7);
      let moving = false;
      for (const st of state) {
        const on = any && selectedLines.has(st.line.id);
        const ta = !any || on ? 1 : 0.22;
        st.alpha = Math.abs(ta - st.alpha) < 0.003 ? ta : st.alpha + (ta - st.alpha) * k;
        st.flow = Math.abs((on ? 1 : 0) - st.flow) < 0.003 ? (on ? 1 : 0) : st.flow + ((on ? 1 : 0) - st.flow) * k;
        if (st.flow > 0 || st.alpha !== ta) moving = true;
        const o = st.line.index * 4;
        lineB[o + 3] = st.alpha;
        lineC[o] = st.flow;
        lineC[o + 3] = !any || on ? 1 : 0;
      }
      return moving;
    },
    /** Pinta o rastro de cada trem (mais longo quanto mais rápido; some parado). */
    paintTrails(trains) {
      trail.fill(0);
      for (const tr of trains) {
        const row = tr.sv.trailRow;
        if (row === undefined) continue;
        const L = tr.sv.length;
        const len = tr.at >= 0 ? 0.06 : 0.12 + (tr.v / 25) * 0.55; // km
        const sign = tr.dir === 0 ? -1 : 1; // fica atrás do trem
        const head = (tr.s / L) * (TW - 1);
        const tail = ((tr.s + sign * len) / L) * (TW - 1);
        const a = Math.max(0, Math.floor(Math.min(head, tail)));
        const b = Math.min(TW - 1, Math.ceil(Math.max(head, tail)));
        const span = Math.abs(tail - head) || 1;
        const amp = 255 * tr.alpha;
        const o = row * TW;
        for (let i = a; i <= b; i++) {
          const f = 1 - Math.abs(i - head) / span; // 1 na cabeça → 0 na cauda
          if (f <= 0) continue;
          const val = amp * f * f;
          if (val > trail[o + i]) trail[o + i] = val;
        }
      }
      trailDirty = true;
    },
  };
}
