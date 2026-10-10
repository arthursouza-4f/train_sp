// Chão estilizado (grade + pulso de "radar"), represas, rios e limite do município.

import * as THREE from 'three';
import { buildRibbonGeometry, contextMaterial } from './ribbon.js';

const GROUND_VERT = /* glsl */ `
  varying vec3 vWorld;
  varying float vDepth;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const GROUND_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec2 uFog;
  uniform vec3 uBg;
  varying vec3 vWorld;
  varying float vDepth;

  float grid(vec2 p, float cell) {
    vec2 q = p / cell;
    vec2 fw = fwidth(q);
    vec2 g = abs(fract(q - 0.5) - 0.5) / max(fw, 1e-5);
    float l = 1.0 - min(min(g.x, g.y), 1.0);
    float fade = 1.0 - smoothstep(0.08, 0.35, max(fw.x, fw.y));
    return l * fade;
  }

  void main() {
    vec2 p = vWorld.xz;
    float r = length(p - vec2(2.0, 2.0));
    vec3 col = uBg + vec3(0.010, 0.016, 0.032) * (1.0 - smoothstep(5.0, 75.0, r));
    float g1 = grid(p, 1.0);
    float g10 = grid(p, 10.0);
    col += vec3(0.030, 0.050, 0.090) * g1 + vec3(0.050, 0.085, 0.150) * g10;
    // pulso de radar saindo do centro
    float wave = fract(uTime * 0.035);
    float ring = exp(-pow((r - wave * 95.0) / 1.6, 2.0)) * (1.0 - wave);
    col += vec3(0.020, 0.060, 0.110) * ring * (0.35 + g1 * 2.0 + g10 * 2.0);
    float fog = smoothstep(uFog.x, uFog.y * 1.15, vDepth);
    col = mix(col, uBg, fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const LAKE_FRAG = /* glsl */ `
  uniform vec2 uFog;
  uniform vec3 uBg;
  varying vec3 vWorld;
  varying float vDepth;
  void main() {
    vec3 col = vec3(0.020, 0.058, 0.105);
    col += vec3(0.0, 0.02, 0.04) * sin(vWorld.x * 3.0 + vWorld.z * 2.0) * 0.3;
    float fog = smoothstep(uFog.x, uFog.y * 1.15, vDepth);
    gl_FragColor = vec4(mix(col, uBg, fog), 1.0);
  }
`;

export function createGround(stage, context) {
  const group = new THREE.Group();
  const shared = stage.shared;
  const bg = new THREE.Vector3(0x04 / 255, 0x06 / 255, 0x0c / 255);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uFog: shared.uFog, uBg: { value: bg } },
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      depthWrite: false,
    }),
  );
  ground.renderOrder = 0;
  group.add(ground);

  // represas (polígonos preenchidos)
  const shapes = context.lakes.map((lk) => {
    const pts = [];
    for (let i = 0; i < lk.pts.length; i += 2) pts.push(new THREE.Vector2(lk.pts[i], lk.pts[i + 1]));
    return new THREE.Shape(pts);
  });
  if (shapes.length) {
    const lakeGeo = new THREE.ShapeGeometry(shapes, 1).rotateX(Math.PI / 2);
    const lakes = new THREE.Mesh(
      lakeGeo,
      new THREE.ShaderMaterial({
        uniforms: { uFog: shared.uFog, uBg: { value: bg } },
        vertexShader: GROUND_VERT,
        fragmentShader: LAKE_FRAG,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    lakes.position.y = 0.004;
    lakes.renderOrder = 1;
    group.add(lakes);

    const shore = new THREE.Mesh(
      buildRibbonGeometry(context.lakes.map((l) => ({ pts: l.pts })), 0.005),
      contextMaterial(shared, { color: [0.12, 0.33, 0.55], width: 1.1, opacity: 0.7 }),
    );
    shore.renderOrder = 2;
    shore.frustumCulled = false;
    group.add(shore);
  }

  const major = context.rivers.filter((r) => r.major);
  const minor = context.rivers.filter((r) => !r.major);
  const riverMeshes = [
    [major, 2.2, 0.9],
    [minor, 1.3, 0.6],
  ].map(([list, width, opacity]) => {
    const m = new THREE.Mesh(
      buildRibbonGeometry(list.map((r) => ({ pts: r.pts })), 0.006),
      contextMaterial(shared, { color: [0.1, 0.36, 0.62], width, opacity }),
    );
    m.renderOrder = 2;
    m.frustumCulled = false;
    group.add(m);
    return m;
  });

  const city = new THREE.Mesh(
    buildRibbonGeometry(context.city.map((pts) => ({ pts })), 0.007),
    contextMaterial(shared, { color: [0.32, 0.4, 0.62], width: 1.0, opacity: 0.55, dash: 0.5 }),
  );
  city.renderOrder = 2;
  city.frustumCulled = false;
  group.add(city);

  stage.scene.add(group);
  return { group, ground, riverMeshes, city };
}
