// Trens em 3D: camada WebGL2 própria dentro do mapa.
// Cada trem é um modelo low-poly com nariz em bico nas duas pontas, instanciado (comprimento real de
// perto, tamanho mínimo em px de longe), com faróis na frente, lanternas atrás e sombra suave no chão.
// De longe o trem fica na cor da linha; de perto ganha a pintura (carroceria clara, faixa na cor da
// linha, janelas e para-brisa escuros). O trem selecionado ganha um anel
// pulsante; a estação selecionada, uma onda no chão. Uma chamada de desenho para todos os trens.
//
// Espaço da camada: "km Mercator" locais (ver geo.toLocal) com y para cima: x = leste, z = sul.

import { clamp, lerp } from '../core/util.js';
import { compileProgram, composeMatrix, isWebGL2, pxScale } from './gl-util.js';
import { railUnit } from './network-layers.js';

const CAP = 1200;
const STRIDE = 10; // floats por instância: pos(3) ângulo afastamento alpha selecionado cor(3)

// dimensões do trem e posição na via, em comum entre a caixa e a sombra
const TRAIN_GEOM = /* glsl */ `
  uniform mat4 uMatrix;
  uniform float uPx;      // km por px CSS, por unidade de w (clip)
  uniform float uLenPx;
  uniform float uWidPx;
  uniform float uRealLen;
  uniform float uRealWid;
  uniform float uUnit;    // px de 1 unidade de afastamento entre linhas
  uniform float uAppear;
  layout(location = 2) in vec3 iPos;
  layout(location = 3) in vec4 iData; // ângulo, afastamento (unidades), alpha, selecionado
  layout(location = 4) in vec3 iColor;
  float wpp;
  float L;
  float W;
  float lane;
  vec2 dir;
  void trainFrame() {
    vec4 cc = uMatrix * vec4(iPos, 1.0);
    wpp = max(cc.w, 1e-4) * uPx;
    float s = 1.0 + iData.w * 0.35;
    float w0 = max(uRealWid, uWidPx * wpp);
    L = max(uRealLen, uLenPx * wpp) * s;
    W = w0 * s;
    // cada sentido numa "pista" (à direita de quem anda) + afastamento da própria linha
    lane = iData.y * uUnit * wpp + w0 * 0.62;
    dir = vec2(cos(iData.x), sin(iData.x));
  }
  // de coordenadas do trem (x = frente, z = direita) para o mundo, já na pista do sentido
  vec3 place(vec3 p) {
    vec3 r = vec3(p.x * dir.x - p.z * dir.y, p.y, p.x * dir.y + p.z * dir.x);
    r += vec3(-dir.y, 0.0, dir.x) * lane;
    return iPos + r;
  }
`;

const BODY_VS = /* glsl */ `#version 300 es
  ${TRAIN_GEOM}
  // x = âncora (-0.5 traseira / 0.5 frente) · L + deslocamento · comprimento do nariz
  layout(location = 0) in vec4 aPos;    // âncora, deslocamento, altura (0..1), lado (-0.5..0.5)
  layout(location = 1) in vec4 aNormal; // normal (proporções de referência), nariz (t · ±1)
  out vec3 vN;
  out vec3 vNL;
  out float vX;
  out float vY;
  out float vNose;
  out float vLenPx;
  out vec3 vColor;
  out float vAlpha;
  out float vSel;
  void main() {
    trainFrame();
    float H = W * 0.95;
    float noseLen = min(1.6 * W, 0.3 * L);
    vec3 p = vec3(aPos.x * L + aPos.y * noseLen, aPos.z * H, aPos.w * W);
    // normal corrigida para o nariz mais curto ou mais longo que o de referência (1,6 larguras)
    vec3 nl = normalize(vec3(aNormal.x * 1.6 * W / noseLen, aNormal.y, aNormal.z));
    vN = vec3(nl.x * dir.x - nl.z * dir.y, nl.y, nl.x * dir.y + nl.z * dir.x);
    vNL = nl;
    vX = p.x / L;
    vY = aPos.z;
    vNose = aNormal.w;
    vLenPx = L / wpp;
    vColor = iColor;
    vAlpha = iData.z * uAppear;
    vSel = iData.w;
    gl_Position = uMatrix * vec4(place(p), 1.0);
  }
`;

const BODY_FS = /* glsl */ `#version 300 es
  precision highp float;
  in vec3 vN;
  in vec3 vNL;
  in float vX;
  in float vY;
  in float vNose;
  in float vLenPx;
  in vec3 vColor;
  in float vAlpha;
  in float vSel;
  out vec4 outColor;
  void main() {
    vec3 n = normalize(vN);
    float light = 0.84 + 0.18 * max(dot(n, normalize(vec3(-0.35, 1.0, -0.45))), 0.0);
    float t = abs(vNose);                 // 0 no corpo → 1 na ponta do nariz
    float isFront = step(0.0, vNose);
    float nose = step(0.02, t);
    float side = step(0.45, abs(vNL.z));
    float roof = step(0.9, vY) * (1.0 - nose);
    // para-brisa: faces do nariz voltadas para frente e para cima
    float shield = step(0.38, t) * step(0.22, abs(vNL.x)) * step(0.12, vNL.y) * step(0.42, vY);

    // de longe: o trem todo na cor da linha (identificação), teto e para-brisa mais claros/escuros
    vec3 far = mix(vColor, vec3(1.0), roof * 0.35);
    far = mix(far, vColor * 0.45, shield * 0.6);

    // de perto: carroceria clara, faixa na cor da linha subindo pelo nariz, janelas escuras
    vec3 liv = vec3(0.97, 0.975, 0.98);
    float lo = 0.15 + t * t * 0.28;
    float hi = 0.33 + t * t * 0.3;
    float stripe = step(lo, vY) * step(vY, hi);
    float stripe2 = step(hi + 0.02, vY) * step(vY, hi + 0.06) * (1.0 - nose);
    liv = mix(liv, vColor, max(stripe, stripe2 * 0.8));
    float win = (1.0 - nose) * side * step(0.5, vY) * step(vY, 0.77);
    liv = mix(liv, vec3(0.14, 0.16, 0.2), max(win * 0.92, shield));
    liv = mix(liv, vec3(0.86, 0.87, 0.89), roof);
    liv = mix(liv, vec3(0.3, 0.31, 0.33), step(vY, 0.07));
    // divisão entre os 6 carros (só no corpo)
    float cx = fract((vX + 0.5) * 6.0);
    float fw = fwidth(cx);
    float gap = (1.0 - smoothstep(0.0, fw * 1.5 + 0.01, min(cx, 1.0 - cx))) * (1.0 - nose);
    liv *= 1.0 - gap * 0.4;

    float near = smoothstep(45.0, 150.0, vLenPx);
    vec3 col = mix(far, liv, near) * light;

    // faróis (frente) e lanternas (traseira): de perto, lâmpadas na ponta; de longe, a ponta inteira
    float lampNear = step(0.82, t) * step(0.16, vY) * step(vY, 0.36);
    float lampFar = smoothstep(0.55, 0.9, t);
    float lamp = mix(lampFar, lampNear, near);
    vec3 lampCol = mix(vec3(0.85, 0.1, 0.13), vec3(1.0, 0.97, 0.82), isFront);
    col = mix(col, lampCol, lamp * mix(0.75, 1.0, isFront));
    col = mix(col, vec3(1.0), vSel * 0.1);
    outColor = vec4(col * vAlpha, vAlpha);
  }
`;

const SHADOW_VS = /* glsl */ `#version 300 es
  ${TRAIN_GEOM}
  layout(location = 0) in vec2 aCorner;
  out vec2 vP;
  out vec2 vHalf;
  out float vM;
  out float vAlpha;
  out float vSel;
  out vec3 vColor;
  void main() {
    trainFrame();
    float m = max(3.0 * wpp, W * 0.35) + iData.w * 12.0 * wpp;
    vec2 hs = vec2(L * 0.5, W * 0.5);
    vec2 local = aCorner * (hs + m);
    vec3 w = place(vec3(local.x, 0.0, local.y));
    w += vec3(0.6, 0.0, 0.8) * W * 0.35 * (1.0 - iData.w); // luz vindo de noroeste
    gl_Position = uMatrix * vec4(w, 1.0);
    vP = local;
    vHalf = hs;
    vM = m;
    vAlpha = iData.z * uAppear;
    vSel = iData.w;
    vColor = iColor;
  }
`;

const SHADOW_FS = /* glsl */ `#version 300 es
  precision highp float;
  uniform float uTime;
  in vec2 vP;
  in vec2 vHalf;
  in float vM;
  in float vAlpha;
  in float vSel;
  in vec3 vColor;
  out vec4 outColor;
  void main() {
    // cápsula (pontas arredondadas, como o nariz): 0 sob o trem, 1 na borda da sombra
    float r = vHalf.y;
    vec2 q = abs(vP) - vec2(vHalf.x - r, 0.0);
    float d = max(length(max(q, 0.0)) - r, 0.0) / vM;
    if (d > 1.0) discard;
    vec3 col = vec3(0.1, 0.1, 0.12);
    float a = (1.0 - smoothstep(0.0, 1.0, d)) * 0.22;
    if (vSel > 0.5) {
      // anel pulsante do trem selecionado
      float ph = fract(uTime * 0.7);
      float ring = (1.0 - smoothstep(0.0, 0.07, abs(d - (0.18 + ph * 0.78)))) * (1.0 - ph);
      float fill = (1.0 - smoothstep(0.1, 0.3, d)) * 0.25;
      col = vColor;
      a = max(ring * 0.85, fill);
    }
    a *= vAlpha;
    outColor = vec4(col * a, a);
  }
`;

// onda no chão sob a estação selecionada
const PULSE_VS = /* glsl */ `#version 300 es
  uniform mat4 uMatrix;
  uniform float uPx;
  uniform vec3 uCenter;
  uniform float uRadius; // px
  layout(location = 0) in vec2 aCorner;
  out vec2 vP;
  void main() {
    vec4 cc = uMatrix * vec4(uCenter, 1.0);
    float wpp = max(cc.w, 1e-4) * uPx;
    vP = aCorner;
    gl_Position = uMatrix * vec4(uCenter + vec3(aCorner.x, 0.0, aCorner.y) * uRadius * wpp, 1.0);
  }
`;

const PULSE_FS = /* glsl */ `#version 300 es
  precision highp float;
  uniform float uTime;
  uniform vec3 uColor;
  in vec2 vP;
  out vec4 outColor;
  void main() {
    float r = length(vP);
    if (r > 1.0) discard;
    float a = 0.0;
    for (int i = 0; i < 2; i++) {
      float ph = fract(uTime * 0.55 + float(i) * 0.5);
      a += (1.0 - smoothstep(0.0, 0.05, abs(r - (0.22 + ph * 0.78)))) * (1.0 - ph) * 0.7;
    }
    a = min(a, 1.0);
    outColor = vec4(uColor * a, a);
  }
`;

// Trem com nariz em bico nas duas pontas, low-poly (normais por face).
// Seção: perfil (lado, altura) com teto arredondado; ao longo do nariz o perfil estreita e o teto
// desce (para-brisa inclinado) até uma ponta baixa.
const PROFILE = [
  [0.45, 0.0], [0.5, 0.08], [0.5, 0.66], [0.47, 0.84], [0.36, 0.95], [0.16, 1.0],
  [-0.16, 1.0], [-0.36, 0.95], [-0.47, 0.84], [-0.5, 0.66], [-0.5, 0.08], [-0.45, 0.0],
];
// estações do nariz: t (0 = base, 1 = ponta), largura, altura do topo, altura da base
const NOSE = [
  [0.0, 1.0, 1.0, 0.0],
  [0.22, 0.99, 0.97, 0.0],
  [0.42, 0.96, 0.88, 0.02],
  [0.62, 0.9, 0.73, 0.04],
  [0.8, 0.79, 0.57, 0.07],
  [0.93, 0.6, 0.44, 0.1],
  [1.0, 0.36, 0.36, 0.14],
];
// proporções de referência para as normais (largura 1)
const REF = { L: 12, nose: 1.6, H: 0.95 };

function trainGeometry() {
  // anéis da ponta traseira até a ponta dianteira: [âncora, deslocamento, t·fim, pontos[(lado, altura)]]
  const ring = (end, [t, ws, top, bot]) => ({
    anchor: end * 0.5,
    off: end * (t - 1),
    nose: end * t,
    pts: PROFILE.map(([z, y]) => [z * ws, bot + y * (top - bot)]),
  });
  const rings = [...NOSE.slice().reverse().map((s) => ring(-1, s)), ...NOSE.map((s) => ring(1, s))];
  const ref = (r, [z, y]) => [r.anchor * REF.L + r.off * REF.nose, y * REF.H, z];
  const out = [];
  const tri = (a, b, c, outward) => {
    const u = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
    const v = [c.p[0] - a.p[0], c.p[1] - a.p[1], c.p[2] - a.p[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    n = n.map((x) => x / l);
    // garante sentido anti-horário visto de fora (para o descarte de faces traseiras)
    if (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) {
      [b, c] = [c, b];
      n = n.map((x) => -x);
    }
    for (const q of [a, b, c]) out.push(...q.a, ...n, q.nose);
  };
  const vert = (r, i) => {
    const [z, y] = r.pts[i];
    return { a: [r.anchor, r.off, y, z], p: ref(r, r.pts[i]), nose: r.nose };
  };
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k];
    const B = rings[k + 1];
    for (let i = 0; i < PROFILE.length - 1; i++) {
      const a0 = vert(A, i), a1 = vert(A, i + 1), b0 = vert(B, i), b1 = vert(B, i + 1);
      const c = [0, 1, 2].map((j) => (a0.p[j] + a1.p[j] + b0.p[j] + b1.p[j]) / 4);
      const outward = [c[0] * 0.15, c[1] - 0.45, c[2]];
      tri(a0, b0, b1, outward);
      tri(a0, b1, a1, outward);
    }
  }
  // tampas das pontas
  for (const [r, end] of [[rings[0], -1], [rings.at(-1), 1]]) {
    const cz = 0;
    const cy = r.pts.reduce((s, p) => s + p[1], 0) / r.pts.length;
    const center = { a: [r.anchor, end * 0.04, cy, cz], p: [r.anchor * REF.L + end * 0.04 * REF.nose, cy * REF.H, cz], nose: r.nose };
    for (let i = 0; i < PROFILE.length - 1; i++) tri(center, vert(r, i), vert(r, i + 1), [end, 0, 0]);
  }
  return { verts: new Float32Array(out), count: out.length / 8 };
}

const TRAIN = trainGeometry();

export function createTrainsLayer(geo) {
  const inst = new Float32Array(CAP * STRIDE);
  const matrix = new Float32Array(16);
  const tmp = { x: 0, z: 0 };
  let count = 0;
  let selectedIndex = -1;
  let appear = 0;
  let pulse = null; // { x, z, color: [r,g,b] } em km locais
  let map = null;
  let gl = null;
  let body = null;
  let shadow = null;
  let pulseProg = null;
  let vaoBody = null;
  let vaoQuad = null;
  let vaoPulse = null;
  let instBuf = null;
  let dirty = false;
  let disabled = false;

  function instanceAttribs() {
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const B = STRIDE * 4;
    for (const [loc, size, off] of [[2, 3, 0], [3, 4, 3], [4, 3, 7]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, B, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
  }
  function quadBuffer() {
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  }

  const layer = {
    id: 'trains',
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, context) {
      map = m;
      if (!isWebGL2(context)) {
        disabled = true;
        console.warn('WebGL2 indisponível: trens 3D desativados');
        return;
      }
      gl = context;
      try {
        body = compileProgram(gl, BODY_VS, BODY_FS);
        shadow = compileProgram(gl, SHADOW_VS, SHADOW_FS);
        pulseProg = compileProgram(gl, PULSE_VS, PULSE_FS);
      } catch (err) {
        disabled = true;
        console.error(err);
        return;
      }
      instBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);

      vaoBody = gl.createVertexArray();
      gl.bindVertexArray(vaoBody);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, TRAIN.verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
      instanceAttribs();

      vaoQuad = gl.createVertexArray();
      gl.bindVertexArray(vaoQuad);
      quadBuffer();
      instanceAttribs();

      vaoPulse = gl.createVertexArray();
      gl.bindVertexArray(vaoPulse);
      quadBuffer();

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      dirty = true;
    },
    render(context, args) {
      if (disabled) return;
      composeMatrix(args.defaultProjectionData.mainMatrix, geo, matrix);
      const px = pxScale(map, geo, matrix, tmp);
      const zoom = map.getZoom();
      const time = performance.now() / 1000;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);

      if (pulse) {
        const p = pulseProg.u;
        gl.useProgram(pulseProg.prog);
        gl.uniformMatrix4fv(p.uMatrix, false, matrix);
        gl.uniform1f(p.uPx, px);
        gl.uniform3f(p.uCenter, pulse.x, 0.002, pulse.z);
        gl.uniform1f(p.uRadius, lerp(26, 40, clamp((zoom - 10) / 6, 0, 1)));
        gl.uniform1f(p.uTime, time);
        gl.uniform3fv(p.uColor, pulse.color);
        gl.depthMask(false);
        gl.disable(gl.DEPTH_TEST);
        gl.bindVertexArray(vaoPulse);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.enable(gl.DEPTH_TEST);
      }
      if (!count || appear <= 0) {
        gl.bindVertexArray(null);
        return;
      }
      if (dirty) {
        gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, count * STRIDE);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        dirty = false;
      }
      const t = clamp((zoom - 9) / (16 - 9), 0, 1);
      const set = (prog) => {
        const u = prog.u;
        gl.useProgram(prog.prog);
        gl.uniformMatrix4fv(u.uMatrix, false, matrix);
        gl.uniform1f(u.uPx, px);
        gl.uniform1f(u.uLenPx, lerp(9, 18, t));
        gl.uniform1f(u.uWidPx, lerp(3.8, 7, t));
        gl.uniform1f(u.uRealLen, 0.13);
        gl.uniform1f(u.uRealWid, 0.0038); // um pouco mais largo que o real (3,2 m), para ler melhor
        gl.uniform1f(u.uUnit, railUnit(zoom));
        gl.uniform1f(u.uAppear, appear);
        if (u.uTime) gl.uniform1f(u.uTime, time);
      };
      // sombras e anel (sem escrever profundidade)
      set(shadow);
      gl.depthMask(false);
      gl.bindVertexArray(vaoQuad);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      // caixas
      set(body);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.bindVertexArray(vaoBody);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, TRAIN.count, count);
      gl.bindVertexArray(null);
      gl.disable(gl.CULL_FACE);
    },
  };

  return {
    layer,
    get enabled() {
      return !disabled;
    },
    /** Há animação contínua (anel do trem ou onda da estação)? */
    get animating() {
      return !!pulse || selectedIndex >= 0;
    },
    setAppear(v) {
      appear = v;
    },
    /** Onda no chão sob a estação selecionada (null para tirar). */
    setPulse(station, color) {
      pulse = station ? { ...geo.toLocal(station.x, station.z, { x: 0, z: 0 }), color } : null;
    },
    /** Atualiza as instâncias a partir da simulação (não desenha: chame map.triggerRepaint()). */
    update(trains, { selectedTrain, selectedLines }) {
      const any = selectedLines.size > 0;
      count = Math.min(trains.length, CAP);
      selectedIndex = -1;
      for (let i = 0; i < count; i++) {
        const t = trains[i];
        const o = i * STRIDE;
        geo.toLocal(t.x, t.z, tmp);
        inst[o] = tmp.x;
        inst[o + 1] = 0.003;
        inst[o + 2] = tmp.z;
        inst[o + 3] = t.a;
        // à direita de quem anda: no sentido do traçado o afastamento da linha soma, no contrário inverte
        inst[o + 4] = t.dir === 0 ? t.line.offsetK : -t.line.offsetK;
        inst[o + 5] = t.alpha * (any && !selectedLines.has(t.line.id) ? 0.25 : 1);
        inst[o + 6] = t === selectedTrain ? 1 : 0;
        if (t === selectedTrain) selectedIndex = i;
        const c = t.line.rgb;
        inst[o + 7] = c[0];
        inst[o + 8] = c[1];
        inst[o + 9] = c[2];
      }
      dirty = true;
    },
  };
}
