// Fitas (ribbons) com largura constante em pixels, extrudadas no espaço de tela.
// Usadas nas linhas de trem (neon), rios e limite do município.

import * as THREE from 'three';

/**
 * Monta a geometria de várias polilinhas.
 * polylines: [{ pts: ArrayLike<number> (x,z intercalados, km), y?: number }]
 * Atributos: position (centro), aPrev, aNext, aSide (-1/+1), aDist (km ao longo da polilinha).
 */
export function buildRibbonGeometry(polylines, defaultY = 0) {
  let total = 0;
  for (const pl of polylines) total += pl.pts.length / 2;
  const pos = new Float32Array(total * 2 * 3);
  const prev = new Float32Array(total * 2 * 3);
  const next = new Float32Array(total * 2 * 3);
  const side = new Float32Array(total * 2);
  const distA = new Float32Array(total * 2);
  const index = [];
  let v = 0;
  for (const pl of polylines) {
    const p = pl.pts;
    const n = p.length / 2;
    const y = pl.y ?? defaultY;
    const base = v;
    let d = 0;
    for (let i = 0; i < n; i++) {
      const x = p[2 * i];
      const z = p[2 * i + 1];
      if (i > 0) d += Math.hypot(x - p[2 * i - 2], z - p[2 * i - 1]);
      const ip = Math.max(0, i - 1);
      const inx = Math.min(n - 1, i + 1);
      for (let s = 0; s < 2; s++) {
        const k = v + s;
        pos[3 * k] = x; pos[3 * k + 1] = y; pos[3 * k + 2] = z;
        prev[3 * k] = p[2 * ip]; prev[3 * k + 1] = y; prev[3 * k + 2] = p[2 * ip + 1];
        next[3 * k] = p[2 * inx]; next[3 * k + 1] = y; next[3 * k + 2] = p[2 * inx + 1];
        side[k] = s === 0 ? -1 : 1;
        distA[k] = d;
      }
      v += 2;
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + 2 * i;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPrev', new THREE.BufferAttribute(prev, 3));
  g.setAttribute('aNext', new THREE.BufferAttribute(next, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setAttribute('aDist', new THREE.BufferAttribute(distA, 1));
  g.setIndex(total * 2 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

export const RIBBON_VERT = /* glsl */ `
  uniform vec2 uResolution;
  uniform float uWidth;
  uniform float uOffset;
  uniform float uMirror;
  attribute vec3 aPrev;
  attribute vec3 aNext;
  attribute float aSide;
  attribute float aDist;
  varying float vSide;
  varying float vDist;
  varying float vDepth;

  vec2 scr(vec4 c) { return c.xy / c.w * 0.5 * uResolution; }

  void main() {
    vec3 P = position, A = aPrev, B = aNext;
    if (uMirror > 0.5) { P.y = -P.y; A.y = -A.y; B.y = -B.y; }
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 c = mvp * vec4(P, 1.0);
    vec4 ca = mvp * vec4(A, 1.0);
    vec4 cb = mvp * vec4(B, 1.0);
    vSide = aSide;
    vDist = aDist;
    vDepth = c.w;
    // atrás da câmera: não extruda, o recorte da GPU cuida do resto
    if (c.w < 1e-3) { gl_Position = c; return; }
    vec2 s = scr(c);
    vec2 d0 = ca.w > 1e-3 ? s - scr(ca) : vec2(0.0);
    vec2 d1 = cb.w > 1e-3 ? scr(cb) - s : vec2(0.0);
    float l0 = length(d0);
    float l1 = length(d1);
    if (l0 < 1e-5 && l1 < 1e-5) { d1 = vec2(1.0, 0.0); l1 = 1.0; }
    d0 = l0 > 1e-5 ? d0 / l0 : d1 / l1;
    d1 = l1 > 1e-5 ? d1 / l1 : d0;
    vec2 t = d0 + d1;
    float lt = length(t);
    t = lt > 1e-4 ? t / lt : d1;
    vec2 nrm = vec2(-t.y, t.x);
    float miter = 1.0 / max(dot(nrm, vec2(-d1.y, d1.x)), 0.6);
    vec2 off = nrm * (aSide * uWidth + uOffset) * miter;
    c.xy += off / (0.5 * uResolution) * c.w;
    gl_Position = c;
  }
`;

const RAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uReveal;
  uniform float uLength;
  uniform sampler2D uTrail;
  uniform float uFlow;
  uniform float uMirror;
  uniform float uCore;
  uniform vec2 uFog;
  varying float vSide;
  varying float vDist;
  varying float vDepth;

  void main() {
    if (vDist > uReveal) discard;
    float d = abs(vSide);
    float aa = fwidth(vSide) * 1.2;
    float core = 1.0 - smoothstep(uCore - aa, uCore + aa, d);
    float halo = exp(-d * d * 4.5) * (1.0 - smoothstep(0.7, 1.0, d));
    float trail = texture2D(uTrail, vec2(vDist / uLength, 0.5)).r;
    float flow = uFlow * pow(max(0.0, sin(vDist * 5.0 - uTime * 4.2)), 14.0);
    float tip = uReveal < uLength ? 1.0 - smoothstep(0.0, 0.9, uReveal - vDist) : 0.0;

    vec3 col = uColor * (halo * 0.42 + core * 0.8) + vec3(core * 0.3);
    col += (uColor * 1.15 + vec3(0.2)) * trail * (core * 1.1 + halo * 1.0);
    col += (uColor * 0.7 + vec3(0.45)) * flow * (core + halo * 0.8);
    col += vec3(1.0) * tip * (halo * 1.6 + core);
    float fog = 1.0 - smoothstep(uFog.x, uFog.y, vDepth) * 0.8;
    col *= uIntensity * fog;
    if (uMirror > 0.5) col *= 0.2 * halo;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const CONTEXT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uDash;
  uniform vec2 uFog;
  varying float vSide;
  varying float vDist;
  varying float vDepth;
  void main() {
    float d = abs(vSide);
    float aa = fwidth(vSide) * 1.2;
    float core = 1.0 - smoothstep(0.45 - aa, 0.45 + aa, d);
    float halo = exp(-d * d * 3.0) * (1.0 - d);
    float a = core * 0.8 + halo * 0.35;
    if (uDash > 0.0) a *= step(0.45, fract(vDist / uDash));
    float fog = 1.0 - smoothstep(uFog.x, uFog.y, vDepth) * 0.85;
    gl_FragColor = vec4(uColor * a * uOpacity * fog, 1.0);
  }
`;

export function railMaterial(shared, { color, length, trailTex, offset = 0, mirror = false }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Vector3(...color) },
      uIntensity: { value: 1 },
      uReveal: { value: 0 },
      uLength: { value: length },
      uTrail: { value: trailTex },
      uFlow: { value: 0 },
      uMirror: { value: mirror ? 1 : 0 },
      uWidth: { value: 6 },
      uOffset: { value: offset },
      uCore: { value: 0.28 },
      uFog: shared.uFog,
    },
    vertexShader: RIBBON_VERT,
    fragmentShader: RAIL_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: !mirror,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

export function contextMaterial(shared, { color, width = 1.5, opacity = 1, dash = 0 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Vector3(...color) },
      uOpacity: { value: opacity },
      uWidth: { value: width },
      uOffset: { value: 0 },
      uMirror: { value: 0 },
      uDash: { value: dash },
      uFog: shared.uFog,
    },
    vertexShader: RIBBON_VERT,
    fragmentShader: CONTEXT_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}
