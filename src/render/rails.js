// Linhas de trem em neon: uma fita por serviço + reflexo no "chão espelhado".
// Cada serviço tem uma textura 1D de rastro, repintada a cada quadro com a posição dos trens.

import * as THREE from 'three';
import { buildRibbonGeometry, railMaterial } from './ribbon.js';
import { clamp, lerp } from '../core/util.js';

const LIFT = 0.06; // km acima do chão (a fita "flutua" sobre o reflexo)
const TEXEL_KM = 0.015;

// Deslocamento lateral (px) para separar linhas que compartilham corredores
// (ex.: 10 e 11 entre Barra Funda e Brás; 11 e 12 entre Brás e Tatuapé; 7 e 8 até a Lapa).
const OFFSETS = { L7: 4, L8: -4, L9: -4, L10: -4, L11: 4, L12: -4, L2: 3 };

export function createRails(stage, net) {
  const group = new THREE.Group();
  const items = [];
  for (const line of net.lines) {
    line.offsetPx = OFFSETS[line.id] ?? 0;
    for (const sv of line.services) {
      const n = clamp(Math.ceil(sv.length / TEXEL_KM), 64, 4096);
      const data = new Uint8Array(n);
      const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat, THREE.UnsignedByteType);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;

      const geo = buildRibbonGeometry([{ pts: sv.path }], LIFT);
      const mat = railMaterial(stage.shared, { color: line.neon, length: sv.length, trailTex: tex, offset: line.offsetPx });
      const matMirror = railMaterial(stage.shared, { color: line.neon, length: sv.length, trailTex: tex, offset: line.offsetPx, mirror: true });
      const mesh = new THREE.Mesh(geo, mat);
      const mirror = new THREE.Mesh(geo, matMirror);
      mesh.frustumCulled = mirror.frustumCulled = false;
      mesh.renderOrder = 10 + line.index;
      mirror.renderOrder = 3;
      group.add(mirror, mesh);
      items.push({ line, sv, mesh, mirror, mat, matMirror, tex, data, n, intensity: 1, flow: 0, reveal: 0 });
    }
  }
  stage.scene.add(group);
  const byService = new Map(items.map((it) => [it.sv, it]));

  return {
    group,
    items,
    LIFT,
    /** Revela as linhas (animação de entrada). p: 0..1 global. */
    setReveal(p) {
      for (const it of items) {
        const order = it.line.index / net.lines.length;
        const local = clamp((p - order * 0.55) / 0.45, 0, 1);
        const k = 1 - Math.pow(1 - local, 2.2);
        it.reveal = k * (it.sv.length + 1);
        it.mat.uniforms.uReveal.value = it.reveal;
        it.matMirror.uniforms.uReveal.value = it.reveal;
      }
    },
    /** Destaque: linha selecionada brilha e "flui"; as demais apagam. */
    update(dt, { selectedLines, distance }) {
      const any = selectedLines && selectedLines.size > 0;
      const width = clamp(lerp(6.2, 5.0, (Math.log(distance) - Math.log(2)) / (Math.log(120) - Math.log(2))), 4.6, 6.6);
      const k = 1 - Math.exp(-dt * 6);
      for (const it of items) {
        const on = any && selectedLines.has(it.line.id);
        const targetI = !any ? 1 : on ? 1.2 : 0.11;
        it.intensity += (targetI - it.intensity) * k;
        it.flow += ((on ? 1 : 0) - it.flow) * k;
        const u = it.mat.uniforms;
        u.uIntensity.value = it.intensity;
        u.uFlow.value = it.flow;
        u.uWidth.value = width * (on ? 1.15 : 1);
        const um = it.matMirror.uniforms;
        um.uIntensity.value = it.intensity;
        um.uWidth.value = width * 2.2;
      }
    },
    /** Pinta os rastros dos trens nas texturas. */
    paintTrails(trains) {
      for (const it of items) it.data.fill(0);
      for (const tr of trains) {
        const it = byService.get(tr.sv);
        if (!it) continue;
        const { data, n } = it;
        const L = it.sv.length;
        const len = tr.at >= 0 ? 0.12 : 0.18 + (tr.v / 25) * 1.25; // km
        const sign = tr.dir === 0 ? -1 : 1; // rastro fica atrás do trem
        const head = (tr.s / L) * (n - 1);
        const tail = ((tr.s + sign * len) / L) * (n - 1);
        const a = Math.max(0, Math.floor(Math.min(head, tail)));
        const b = Math.min(n - 1, Math.ceil(Math.max(head, tail)));
        const span = Math.abs(tail - head) || 1;
        const amp = 255 * tr.alpha;
        for (let i = a; i <= b; i++) {
          const f = 1 - Math.abs(i - head) / span; // 1 na cabeça → 0 na cauda
          if (f <= 0) continue;
          const val = amp * f * f;
          if (val > data[i]) data[i] = val;
        }
        // brilho um pouco à frente da cabeça (farol)
        const ahead = Math.round(head - sign * 2);
        if (ahead >= 0 && ahead < n) data[ahead] = Math.max(data[ahead], amp * 0.6);
      }
      for (const it of items) it.tex.needsUpdate = true;
    },
  };
}
