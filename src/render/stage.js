import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { clamp, easeInOutCubic } from '../core/util.js';

// Cores definidas em sRGB direto nos shaders: sem conversões automáticas.
THREE.ColorManagement.enabled = false;

const FOV = 40;

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.isMobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.isMobile,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x04060c, 1);
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 2);
    this.minDpr = Math.min(1, this.maxDpr);
    this.dpr = this.maxDpr;
    this.renderer.setPixelRatio(this.dpr);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 900);
    this.camera.position.set(0, 140, 0.01);

    // uniforms compartilhados por todos os shaders
    this.shared = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uPx: { value: 0.001 }, // unidades de mundo por px CSS a 1 unidade de profundidade
      uFog: { value: new THREE.Vector2(80, 300) }, // profundidade (km) onde a névoa começa/termina
    };

    const c = (this.controls = new MapControls(this.camera, canvas));
    c.enableDamping = true;
    c.dampingFactor = 0.085;
    c.screenSpacePanning = false;
    c.minDistance = 0.6;
    c.maxDistance = 170;
    c.maxPolarAngle = 1.22;
    c.zoomToCursor = true;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 1.15;
    c.target.set(0, 0, 0);
    c.addEventListener('start', () => {
      this.anim = null;
      this.userActive = true;
      this.onUserStart?.();
    });
    c.addEventListener('end', () => (this.userActive = false));

    this.bounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };
    this.anim = null;
    this.frameTimes = [];
    this.lastQualityChange = 0;
    this._resize = this.resize.bind(this);
    window.addEventListener('resize', this._resize);
    window.visualViewport?.addEventListener('resize', this._resize);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth || 1;
    const h = this.canvas.clientHeight || innerHeight || 1;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.shared.uResolution.value.set(w, h);
    this.shared.uPx.value = (2 * Math.tan((FOV * Math.PI) / 360)) / h;
    this.onResize?.(w, h);
  }

  get distance() {
    return this.camera.position.distanceTo(this.controls.target);
  }

  get azimuth() {
    const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    return Math.atan2(off.x, off.z);
  }

  /**
   * Voo de câmera suave até `target` (centro do que se quer ver). O alvo real é deslocado
   * para que esse centro caia no meio da área livre da tela (descontando painéis em `insets`).
   * Qualquer gesto do usuário cancela.
   */
  flyTo({ target, distance, polar, azimuth, duration = 1.4 }) {
    this.onBeforeFly?.();
    const c = this.controls;
    const off = new THREE.Vector3().subVectors(this.camera.position, c.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    let toTheta = azimuth ?? sph.theta;
    while (toTheta - sph.theta > Math.PI) toTheta -= 2 * Math.PI;
    while (toTheta - sph.theta < -Math.PI) toTheta += 2 * Math.PI;
    const r = clamp(distance ?? sph.radius, c.minDistance, c.maxDistance);
    const phi = clamp(polar ?? sph.phi, 0.001, c.maxPolarAngle);
    let to = c.target.clone();
    if (target) {
      const t = this.applyInsets(target, r, phi, toTheta);
      to = new THREE.Vector3(t.x, 0, t.z);
    }
    this.anim = {
      t: 0,
      dur: duration,
      fromTarget: c.target.clone(),
      toTarget: to,
      from: { r: sph.radius, phi: sph.phi, theta: sph.theta },
      to: { r, phi, theta: toTheta },
    };
  }

  applyInsets(t, r, phi, theta) {
    const { top = 0, right = 0, bottom = 0, left = 0 } = this.insets ?? {};
    const pxW = (2 * Math.tan((FOV * Math.PI) / 360) * r) / this.height;
    const sR = ((right - left) / 2) * pxW;
    const sD = (((bottom - top) / 2) * pxW) / Math.max(0.35, Math.cos(phi));
    // direita da tela e "para baixo" (em direção à câmera) projetados no chão
    return {
      x: t.x + Math.cos(theta) * sR + Math.sin(theta) * sD,
      z: t.z - Math.sin(theta) * sR + Math.cos(theta) * sD,
    };
  }

  /**
   * Enquadra pontos (x,z intercalados). `align`: direção (rad, no plano x/z) que deve ficar
   * no eixo mais comprido da área livre da tela — gira o mapa para a linha caber maior.
   */
  fitPoints(pts, opts = {}) {
    // canvas ainda sem tamanho (aba oculta): enquadra quando houver área real
    if (this.width < 50 || this.height < 50) {
      this.pendingFit = [pts, opts];
      return;
    }
    this.pendingFit = null;
    const { polar = 0.75, padding = 1.15, duration = 1.4, azimuth, align } = opts;
    this.onBeforeFly?.();
    const { top = 0, right = 0, bottom = 0, left = 0 } = this.insets ?? {};
    const W = Math.max(80, this.width - left - right);
    const H = Math.max(80, this.height - top - bottom);
    let theta = azimuth ?? this.azimuth;
    if (align !== undefined) {
      // retrato: linha na vertical da tela; paisagem: na horizontal
      const cands = W < H ? [Math.atan2(-Math.cos(align), -Math.sin(align))] : [-align];
      cands.push(cands[0] + Math.PI);
      const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      theta = cands.map(norm).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
    }
    const rx = Math.cos(theta), rz = -Math.sin(theta); // direita da tela
    const ux = -Math.sin(theta), uz = -Math.cos(theta); // cima da tela
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const u = pts[i] * rx + pts[i + 1] * rz;
      const v = pts[i] * ux + pts[i + 1] * uz;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = Math.max(1.5, (maxU - minU) * padding);
    const h = Math.max(1.5, (maxV - minV) * padding * (0.25 + 0.85 * Math.cos(polar)));
    const tanV = Math.tan((FOV * Math.PI) / 360) * (H / this.height);
    const tanH = tanV * (W / H);
    const dist = Math.max(h / 2 / tanV, w / 2 / tanH);
    const cu = (minU + maxU) / 2;
    const cv = (minV + maxV) / 2;
    this.flyTo({
      target: { x: cu * rx + cv * ux, z: cu * rz + cv * uz },
      distance: dist,
      polar,
      azimuth: theta,
      duration,
    });
  }

  fitBox(minX, maxX, minZ, maxZ, opts = {}) {
    this.fitPoints([minX, minZ, maxX, minZ, maxX, maxZ, minX, maxZ], opts);
  }

  update(dt) {
    // tamanho do canvas pode mudar sem evento (aba oculta, painel redimensionado)
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (cw > 0 && ch > 0 && (cw !== this.width || ch !== this.height)) this.resize();
    if (this.pendingFit && this.width >= 50 && this.height >= 50) this.fitPoints(...this.pendingFit);
    const c = this.controls;
    if (this.anim) {
      const a = this.anim;
      a.t += dt / a.dur;
      const k = easeInOutCubic(Math.min(1, a.t));
      c.target.lerpVectors(a.fromTarget, a.toTarget, k);
      // raio interpolado em escala log: zoom parece uniforme
      const r = Math.exp(Math.log(a.from.r) + (Math.log(a.to.r) - Math.log(a.from.r)) * k);
      const phi = a.from.phi + (a.to.phi - a.from.phi) * k;
      const theta = a.from.theta + (a.to.theta - a.from.theta) * k;
      this.camera.position.setFromSpherical(new THREE.Spherical(r, phi, theta)).add(c.target);
      this.camera.lookAt(c.target);
      if (a.t >= 1) this.anim = null;
    }
    // mantém o alvo dentro da região metropolitana
    const b = this.bounds;
    const tx = clamp(c.target.x, b.minX, b.maxX);
    const tz = clamp(c.target.z, b.minZ, b.maxZ);
    if (tx !== c.target.x || tz !== c.target.z) {
      const dx = tx - c.target.x;
      const dz = tz - c.target.z;
      c.target.x = tx;
      c.target.z = tz;
      this.camera.position.x += dx;
      this.camera.position.z += dz;
    }
    c.update();
    // plano near proporcional à distância: mantém a precisão do depth buffer
    const near = clamp(this.distance * 0.01, 0.01, 2);
    if (Math.abs(near - this.camera.near) > this.camera.near * 0.05) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Qualidade adaptativa: ajusta o pixel ratio conforme o tempo de quadro. */
  adapt(dtMs, now) {
    if (!(dtMs > 0 && dtMs < 1000) || document.hidden) return;
    const f = this.frameTimes;
    f.push(dtMs);
    if (f.length < 90) return;
    const sorted = [...f].sort((a, b) => a - b);
    const med = sorted[f.length >> 1];
    f.length = 0;
    if (now - this.lastQualityChange < 2500) return;
    let next = this.dpr;
    if (med > 30 && this.dpr > this.minDpr) next = Math.max(this.minDpr, this.dpr - 0.25);
    else if (med < 18 && this.dpr < this.maxDpr) next = Math.min(this.maxDpr, this.dpr + 0.25);
    if (next !== this.dpr) {
      this.dpr = next;
      this.renderer.setPixelRatio(next);
      this.resize();
      this.lastQualityChange = now;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Projeta (x, y, z) do mundo em px CSS. Retorna false se atrás da câmera. */
  project(x, y, z, out) {
    const v = (this._v ??= new THREE.Vector3());
    v.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > -0.01) return false;
    out.depth = -v.z;
    v.applyMatrix4(this.camera.projectionMatrix);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    return true;
  }
}
