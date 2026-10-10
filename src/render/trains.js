// Trens: caixa 3D instanciada (tamanho mínimo em px para ficar visível de longe)
// + brilho em cápsula sob o trem (aditivo). Atualizado a cada quadro com a simulação.

import * as THREE from 'three';
import { clamp, lerp } from '../core/util.js';

const CAP = 1200;

const BODY_VERT = /* glsl */ `
  uniform float uPx;
  uniform float uLenPx;
  uniform float uWidPx;
  uniform float uRealLen;
  attribute vec3 iPos;
  attribute float iAng;
  attribute vec3 iColor;
  attribute float iAlpha;
  attribute float iSel;
  attribute float iSide;
  varying vec3 vN;
  varying vec3 vNL;
  varying vec3 vLocal;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSel;
  void main() {
    vec4 vc = modelViewMatrix * vec4(iPos, 1.0);
    float wpp = max(-vc.z, 0.01) * uPx;
    float s = 1.0 + iSel * 0.3;
    float L = max(uRealLen, uLenPx * wpp) * s;
    float W = uWidPx * wpp * s;
    float H = W * 0.85;
    vec3 p = position * vec3(L, H, W);
    p.y += H * 0.5;
    float c = cos(iAng);
    float sn = sin(iAng);
    vec3 r = vec3(p.x * c - p.z * sn, p.y, p.x * sn + p.z * c);
    r += vec3(-sn, 0.0, c) * iSide * wpp;
    vN = vec3(normal.x * c - normal.z * sn, normal.y, normal.x * sn + normal.z * c);
    vNL = normal;
    vLocal = position;
    vColor = iColor;
    vAlpha = iAlpha;
    vSel = iSel;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + r, 1.0);
  }
`;

const BODY_FRAG = /* glsl */ `
  varying vec3 vN;
  varying vec3 vNL;
  varying vec3 vLocal;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSel;
  void main() {
    vec3 n = normalize(vN);
    float light = 0.62 + 0.38 * max(dot(n, normalize(vec3(0.35, 1.0, 0.25))), 0.0);
    float top = step(0.5, vNL.y);
    float side = step(0.5, abs(vNL.z));
    // carroceria prateada, faixa na cor da linha nas laterais, teto levemente tingido
    vec3 col = vec3(0.84, 0.88, 0.94);
    float band = side * step(-0.14, vLocal.y) * step(vLocal.y, 0.16);
    col = mix(col, vColor * 1.1, band);
    col = mix(col, vColor * 0.9 + 0.1, top * 0.4);
    // divisão entre os 6 carros (some quando o trem é pequeno na tela)
    float cx = fract((vLocal.x + 0.5) * 6.0);
    float fw = fwidth(cx);
    float gap = 1.0 - smoothstep(0.0, fw * 1.5 + 0.015, min(cx, 1.0 - cx));
    gap *= (1.0 - smoothstep(0.08, 0.25, fw)) * (1.0 - step(0.5, abs(vNL.x)));
    col *= 1.0 - gap * 0.5;
    col *= light;
    // farol na frente (sentido do movimento), lanterna atrás
    float front = step(0.5, vNL.x);
    float back = step(0.5, -vNL.x);
    col = mix(col, vec3(1.0, 0.97, 0.85) * 1.3, front);
    col = mix(col, vec3(1.0, 0.18, 0.2), back * 0.85);
    col += vColor * 0.12 + vSel * 0.25;
    gl_FragColor = vec4(col, vAlpha);
  }
`;

// brilho alongado (cápsula) deitado no chão, orientado com o trem
const HALO_VERT = /* glsl */ `
  uniform float uPx;
  uniform float uLenPx;
  uniform float uWidPx;
  uniform float uRealLen;
  uniform float uHaloPx;
  attribute vec2 corner;
  attribute vec3 iPos;
  attribute vec3 iColor;
  attribute float iAlpha;
  attribute float iSel;
  attribute float iSide;
  attribute float iAng;
  varying vec2 vP;
  varying vec2 vHalf;
  varying float vM;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSel;
  void main() {
    vec4 vc = modelViewMatrix * vec4(iPos, 1.0);
    float wpp = max(-vc.z, 0.01) * uPx;
    float s = 1.0 + iSel * 0.3;
    float L = max(uRealLen, uLenPx * wpp) * s;
    float W = uWidPx * wpp * s;
    float m = uHaloPx * wpp * (1.0 + iSel * 1.2);
    vec2 hs = vec2(L * 0.5, W * 0.5);
    vec2 local = corner * (hs + m);
    float c = cos(iAng);
    float sn = sin(iAng);
    vec3 off = vec3(local.x * c - local.y * sn, 0.0, local.x * sn + local.y * c);
    off += vec3(-sn, 0.0, c) * iSide * wpp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + off + vec3(0.0, W * 0.2, 0.0), 1.0);
    vP = local;
    vHalf = hs;
    vM = m;
    vColor = iColor;
    vAlpha = iAlpha;
    vSel = iSel;
  }
`;

const HALO_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vP;
  varying vec2 vHalf;
  varying float vM;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSel;
  void main() {
    vec2 q = abs(vP) - vHalf;
    float d = length(max(q, 0.0)) / vM; // 0 dentro do trem, 1 na borda do brilho
    if (d > 1.0) discard;
    float g = exp(-d * d * 4.0) * (1.0 - d);
    vec3 col = vColor * g * 1.05 + vec3(1.0) * exp(-d * d * 30.0) * 0.18;
    if (vSel > 0.5) {
      float ph = fract(uTime * 0.8);
      float ring = 1.0 - smoothstep(0.0, 0.06, abs(d - (0.15 + ph * 0.8)));
      col += vec3(1.0) * ring * (1.0 - ph) * 0.9;
    }
    gl_FragColor = vec4(col * vAlpha, 1.0);
  }
`;

export function createTrains(stage, lift) {
  const pos = new Float32Array(CAP * 3);
  const ang = new Float32Array(CAP);
  const col = new Float32Array(CAP * 3);
  const alpha = new Float32Array(CAP);
  const sel = new Float32Array(CAP);
  const side = new Float32Array(CAP);
  const attr = (arr, n) => {
    const a = new THREE.InstancedBufferAttribute(arr, n);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  const A = {
    iPos: attr(pos, 3),
    iAng: attr(ang, 1),
    iColor: attr(col, 3),
    iAlpha: attr(alpha, 1),
    iSel: attr(sel, 1),
    iSide: attr(side, 1),
  };

  const box = new THREE.BoxGeometry(1, 1, 1);
  const bodyGeo = new THREE.InstancedBufferGeometry();
  bodyGeo.index = box.index;
  bodyGeo.setAttribute('position', box.attributes.position);
  bodyGeo.setAttribute('normal', box.attributes.normal);
  for (const k in A) bodyGeo.setAttribute(k, A[k]);
  bodyGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

  const sizeU = {
    uLenPx: { value: 15 },
    uWidPx: { value: 5.5 },
    uRealLen: { value: 0.13 },
    uHaloPx: { value: 16 },
  };
  const body = new THREE.Mesh(
    bodyGeo,
    new THREE.ShaderMaterial({
      uniforms: { uPx: stage.shared.uPx, ...sizeU },
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: true,
    }),
  );
  body.frustumCulled = false;
  body.renderOrder = 60;

  const haloGeo = new THREE.InstancedBufferGeometry();
  haloGeo.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  haloGeo.setIndex([0, 1, 2, 0, 2, 3]);
  for (const k in A) haloGeo.setAttribute(k, A[k]);
  haloGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const halo = new THREE.Mesh(
    haloGeo,
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: stage.shared.uTime,
        uPx: stage.shared.uPx,
        ...sizeU,
      },
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.frustumCulled = false;
  halo.renderOrder = 50;
  stage.scene.add(halo, body);

  let count = 0;
  const visible = { value: 0 };

  return {
    body,
    halo,
    /** Ordem de desenho = ordem de `trains`; guarda índices para picking. */
    update(trains, { selectedTrain, selectedLines, distance, appear }) {
      const any = selectedLines && selectedLines.size > 0;
      count = Math.min(trains.length, CAP);
      visible.value += (appear - visible.value) * 0.1;
      for (let i = 0; i < count; i++) {
        const t = trains[i];
        pos[i * 3] = t.x;
        pos[i * 3 + 1] = lift + 0.004;
        pos[i * 3 + 2] = t.z;
        ang[i] = t.a;
        const c = t.line.neon;
        col[i * 3] = c[0];
        col[i * 3 + 1] = c[1];
        col[i * 3 + 2] = c[2];
        const dim = any && !selectedLines.has(t.line.id) ? 0.18 : 1;
        alpha[i] = t.alpha * dim * visible.value;
        sel[i] = t === selectedTrain ? 1 : 0;
        // lado da via: cada sentido numa "pista" + deslocamento da própria linha
        side[i] = 2.4 + (t.dir === 0 ? -t.line.offsetPx : t.line.offsetPx);
      }
      for (const k in A) A[k].needsUpdate = true;
      bodyGeo.instanceCount = count;
      haloGeo.instanceCount = count;
      const z = clamp((Math.log(distance) - Math.log(2)) / (Math.log(110) - Math.log(2)), 0, 1);
      sizeU.uLenPx.value = lerp(18, 6.5, z);
      sizeU.uWidPx.value = lerp(7.5, 3.4, z);
      sizeU.uHaloPx.value = lerp(11, 5.5, z);
    },
    get count() {
      return count;
    },
  };
}
