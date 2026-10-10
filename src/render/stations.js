// Estações: marcadores billboard (tamanho em px) + feixes de luz nas estações de integração.

import * as THREE from 'three';
import { clamp, lerp } from '../core/util.js';

const MARKER_VERT = /* glsl */ `
  uniform vec2 uResolution;
  uniform float uScale;
  uniform float uAppear;
  attribute vec2 corner;
  attribute vec3 iPos;
  attribute vec3 iColor;
  attribute float iSize;
  attribute float iKind;
  attribute float iState;
  attribute float iSel;
  attribute float iDelay;
  varying vec2 vC;
  varying float vM;
  varying vec3 vColor;
  varying float vKind;
  varying float vI;
  varying float vSel;
  void main() {
    vec4 c = projectionMatrix * modelViewMatrix * vec4(iPos, 1.0);
    float pop = smoothstep(iDelay, iDelay + 0.12, uAppear);
    float m = iSize * uScale * (1.0 + iSel * 0.35) * pop;
    float R = m * (iSel > 0.5 ? 4.0 : 2.1) + 1.5;
    vC = corner * R;
    vM = m;
    vColor = iColor;
    vKind = iKind;
    vI = iState;
    vSel = iSel;
    c.xy += corner * R / (0.5 * uResolution) * c.w;
    gl_Position = c;
  }
`;

const MARKER_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vC;
  varying float vM;
  varying vec3 vColor;
  varying float vKind;
  varying float vI;
  varying float vSel;
  void main() {
    if (vM < 0.05) discard;
    float r = length(vC);
    float aa = 0.9;
    vec3 c;
    float a;
    if (vKind < 0.5) {
      float ring = 1.0 - smoothstep(vM - aa, vM + aa * 0.3, r);
      float fill = 1.0 - smoothstep(vM * 0.52 - aa * 0.5, vM * 0.52 + aa * 0.5, r);
      c = mix(vColor, vec3(1.0), fill);
      a = ring;
    } else {
      float outer = 1.0 - smoothstep(vM - aa, vM + aa * 0.3, r);
      float white = 1.0 - smoothstep(vM - 1.7 - aa * 0.5, vM - 1.7 + aa * 0.5, r);
      float inner = 1.0 - smoothstep(vM * 0.42 - aa * 0.5, vM * 0.42 + aa * 0.5, r);
      c = mix(vec3(0.02, 0.03, 0.07), vec3(1.0), white);
      c = mix(c, vec3(0.05, 0.07, 0.13), inner);
      a = outer;
    }
    vec3 gcol = vKind < 0.5 ? vColor : vec3(0.8, 0.9, 1.0);
    float glow = exp(-pow(max(r - vM, 0.0) / (vM * 0.8 + 1.0), 2.0)) * 0.5 * (1.0 - a);
    float pulse = 0.0;
    if (vSel > 0.5) {
      float ph = fract(uTime * 0.6);
      float rr = vM + ph * vM * 2.6;
      pulse = (1.0 - smoothstep(0.0, 1.8, abs(r - rr))) * (1.0 - ph) * 0.9;
    }
    vec3 rgb = c * a + gcol * glow + vec3(1.0) * pulse;
    float alpha = clamp(a + glow + pulse, 0.0, 1.0);
    gl_FragColor = vec4(rgb * vI, alpha * vI);
  }
`;

const BEAM_VERT = /* glsl */ `
  uniform vec2 uResolution;
  uniform float uAppear;
  attribute vec2 corner; // x: -1/1 (largura), y: 0/1 (base/topo)
  attribute vec3 iPos;
  attribute vec3 iColor;
  attribute float iHeight;
  attribute float iState;
  attribute float iDelay;
  varying float vY;
  varying float vX;
  varying vec3 vColor;
  varying float vI;
  vec2 scr(vec4 c) { return c.xy / c.w * 0.5 * uResolution; }
  void main() {
    float pop = smoothstep(iDelay, iDelay + 0.2, uAppear);
    vec3 base = iPos;
    vec3 top = iPos + vec3(0.0, iHeight * pop, 0.0);
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 cb = mvp * vec4(base, 1.0);
    vec4 ct = mvp * vec4(top, 1.0);
    vec4 c = corner.y > 0.5 ? ct : cb;
    vec2 d = scr(ct) - scr(cb);
    float l = length(d);
    vec2 n = l > 1e-3 ? vec2(-d.y, d.x) / l : vec2(1.0, 0.0);
    float w = mix(3.2, 1.2, corner.y);
    c.xy += n * corner.x * w / (0.5 * uResolution) * c.w;
    gl_Position = c;
    vY = corner.y;
    vX = corner.x;
    vColor = iColor;
    vI = iState * clamp(l / 18.0, 0.0, 1.0);
  }
`;

const BEAM_FRAG = /* glsl */ `
  varying float vY;
  varying float vX;
  varying vec3 vColor;
  varying float vI;
  void main() {
    float a = pow(1.0 - vY, 1.6) * (1.0 - abs(vX)) * vI;
    gl_FragColor = vec4((vColor * 0.8 + vec3(0.25)) * a, 1.0);
  }
`;

function quad(cornerData, index) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('corner', new THREE.Float32BufferAttribute(cornerData, 2));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

export function createStations(stage, net, lift) {
  const N = net.stations.length;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const kind = new Float32Array(N);
  const state = new Float32Array(N).fill(1);
  const sel = new Float32Array(N);
  const delay = new Float32Array(N);

  const nl = net.lines.length;
  net.stations.forEach((s, i) => {
    pos.set([s.x, lift + 0.002, s.z], i * 3);
    const c = s.isTransfer ? [1, 1, 1] : s.lineObjs[0].neon;
    col.set(c, i * 3);
    size[i] = s.isTransfer ? 6.2 + Math.min(3, s.lines.length - 2) * 0.9 : s.isTerminal ? 4.6 : 3.9;
    kind[i] = s.isTransfer ? 1 : 0;
    // aparece logo depois que a linha "chega" até ela na animação de entrada
    const li = Math.min(...s.lineObjs.map((l) => l.index));
    const sv = s.lineObjs[0].services[0];
    const st = sv.stops.find((x) => x.station === s);
    const frac = st ? st.s / sv.length : 0.5;
    delay[i] = clamp((li / nl) * 0.55 + frac * 0.45, 0, 0.95);
  });

  const geo = quad([-1, -1, 1, -1, 1, 1, -1, 1], [0, 1, 2, 0, 2, 3]);
  const attr = (arr, n) => {
    const a = new THREE.InstancedBufferAttribute(arr, n);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  geo.setAttribute('iPos', attr(pos, 3));
  geo.setAttribute('iColor', attr(col, 3));
  geo.setAttribute('iSize', attr(size, 1));
  geo.setAttribute('iKind', attr(kind, 1));
  geo.setAttribute('iState', attr(state, 1));
  geo.setAttribute('iSel', attr(sel, 1));
  geo.setAttribute('iDelay', attr(delay, 1));
  geo.instanceCount = N;

  const uniforms = {
    uResolution: stage.shared.uResolution,
    uTime: stage.shared.uTime,
    uScale: { value: 1 },
    uAppear: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: MARKER_VERT,
    fragmentShader: MARKER_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    premultipliedAlpha: true,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 40;
  stage.scene.add(mesh);

  // feixes de luz (integrações)
  const transfers = net.stations.filter((s) => s.isTransfer);
  const M = transfers.length;
  const bPos = new Float32Array(M * 3);
  const bCol = new Float32Array(M * 3);
  const bH = new Float32Array(M);
  const bState = new Float32Array(M).fill(1);
  const bDelay = new Float32Array(M);
  transfers.forEach((s, i) => {
    bPos.set([s.x, lift, s.z], i * 3);
    // mistura das cores das linhas que se cruzam
    const mix = [0, 0, 0];
    for (const l of s.lineObjs) for (let k = 0; k < 3; k++) mix[k] += l.neon[k] / s.lineObjs.length;
    bCol.set(mix, i * 3);
    bH[i] = 0.35 + s.lines.length * 0.22;
    bDelay[i] = delay[s.index];
  });
  const bGeo = quad([-1, 0, 1, 0, 1, 1, -1, 1], [0, 1, 2, 0, 2, 3]);
  bGeo.setAttribute('iPos', attr(bPos, 3));
  bGeo.setAttribute('iColor', attr(bCol, 3));
  bGeo.setAttribute('iHeight', attr(bH, 1));
  bGeo.setAttribute('iState', attr(bState, 1));
  bGeo.setAttribute('iDelay', attr(bDelay, 1));
  bGeo.instanceCount = M;
  const beams = new THREE.Mesh(
    bGeo,
    new THREE.ShaderMaterial({
      uniforms: { uResolution: stage.shared.uResolution, uAppear: uniforms.uAppear },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  beams.frustumCulled = false;
  beams.renderOrder = 30;
  stage.scene.add(beams);

  const target = new Float32Array(N).fill(1);
  const bTarget = new Float32Array(M).fill(1);
  const transferIndex = new Map(transfers.map((s, i) => [s, i]));

  return {
    mesh,
    beams,
    uniforms,
    /** selectedLines: Set de ids; selectedStation: estação ou null */
    setSelection(selectedLines, selectedStation) {
      const any = selectedLines && selectedLines.size > 0;
      net.stations.forEach((s, i) => {
        const on = !any || s.lines.some((l) => selectedLines.has(l));
        target[i] = s === selectedStation ? 1 : on ? 1 : 0.22;
        sel[i] = s === selectedStation ? 1 : 0;
        if (transferIndex.has(s)) bTarget[transferIndex.get(s)] = s === selectedStation ? 1.6 : on ? 1 : 0.15;
      });
      geo.attributes.iSel.needsUpdate = true;
    },
    update(dt, distance) {
      const k = 1 - Math.exp(-dt * 7);
      let changed = false;
      for (let i = 0; i < N; i++) {
        const d = target[i] - state[i];
        if (Math.abs(d) > 0.002) { state[i] += d * k; changed = true; }
      }
      if (changed) geo.attributes.iState.needsUpdate = true;
      let bChanged = false;
      for (let i = 0; i < M; i++) {
        const d = bTarget[i] - bState[i];
        if (Math.abs(d) > 0.002) { bState[i] += d * k; bChanged = true; }
      }
      if (bChanged) bGeo.attributes.iState.needsUpdate = true;
      const t = clamp((Math.log(distance) - Math.log(2)) / (Math.log(110) - Math.log(2)), 0, 1);
      uniforms.uScale.value = lerp(1.5, 0.78, t);
    },
  };
}
