import * as THREE from 'three';

// Extracted from main.js (Fase 8): owns gameTime/lockDay directly instead of leaving them as
// module-level `let` bindings that history, population sampling and the save system all read
// and write from all over main.js. Everything else about the cycle (the STOPS table, sampleDay)
// is unchanged from the original.
// Shortened from 180s: a full day used to take 45s of real time even at the old max speed (x4),
// which made "watch my world grow" feel like waiting on a loading bar. 110s keeps the day/night
// lighting transitions readable at x1 while giving the new x8 speed tier (js/main.js) a ~14s day.
export const DAY_LENGTH = 110;
const LOCK_T = 0.4;
// Night used to bottom out at intensity/hemi 0.2 with near-black sky/ambient colors (0x0c1430,
// 0x1b2440), which left villages essentially unreadable for roughly half of every day — exactly
// when disasters, war and other "watch what's happening" moments are just as likely to land.
// Raised the night floor and lightened the night sky/ambient colors so the world stays a legible
// deep blue instead of going near-black, without flattening the day/night mood into constant noon.
const STOPS = [
  { t: 0.00, sky: 0x1a2550, sun: 0x3d4d80, amb: 0x2c3a5c, intensity: 0.4,  hemi: 0.4 },
  { t: 0.06, sky: 0x1a2550, sun: 0x3d4d80, amb: 0x2c3a5c, intensity: 0.4,  hemi: 0.4 },
  { t: 0.14, sky: 0xf6a35c, sun: 0xffb37a, amb: 0x5a4636, intensity: 0.95, hemi: 0.55 },
  { t: 0.24, sky: 0x8fcdf5, sun: 0xfff3d6, amb: 0x4a5266, intensity: 1.2,  hemi: 0.75 },
  { t: 0.70, sky: 0x8fcdf5, sun: 0xfff3d6, amb: 0x4a5266, intensity: 1.2,  hemi: 0.75 },
  { t: 0.80, sky: 0xf17a4d, sun: 0xff9e5e, amb: 0x5a4636, intensity: 0.9,  hemi: 0.5 },
  { t: 0.90, sky: 0x28325c, sun: 0x3c4472, amb: 0x2c3a5c, intensity: 0.42, hemi: 0.4 },
  { t: 1.00, sky: 0x1a2550, sun: 0x3d4d80, amb: 0x2c3a5c, intensity: 0.4,  hemi: 0.4 },
];
const _cA = new THREE.Color(), _cB = new THREE.Color(), _sky = new THREE.Color(), _sunC = new THREE.Color(), _hemiC = new THREE.Color();

function sampleDay(t) {
  let i = 0;
  while (i < STOPS.length - 2 && STOPS[i + 1].t < t) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  const span = Math.max(0.0001, b.t - a.t);
  const local = Math.min(1, Math.max(0, (t - a.t) / span));
  _sky.copy(_cA.set(a.sky)).lerp(_cB.set(b.sky), local);
  _sunC.copy(_cA.set(a.sun)).lerp(_cB.set(b.sun), local);
  _hemiC.copy(_cA.set(a.amb)).lerp(_cB.set(b.amb), local);
  const intensity = a.intensity + (b.intensity - a.intensity) * local;
  const hemiI = a.hemi + (b.hemi - a.hemi) * local;
  return { sky: _sky, sunColor: _sunC, hemiColor: _hemiC, intensity, hemiI };
}

export class DayNightCycle {
  constructor({ fog, sun, hemi, rig, renderSystem, dayCounterEl }) {
    this.fog = fog; this.sun = sun; this.hemi = hemi; this.rig = rig;
    this.renderSystem = renderSystem; this.dayCounterEl = dayCounterEl;
    this.gameTime = DAY_LENGTH * 0.32;
    this.lockDay = false;
  }

  reset() { this.gameTime = DAY_LENGTH * 0.32; }
  advance(dt) { this.gameTime += dt; }
  dayNumber() { return Math.floor(this.gameTime / DAY_LENGTH) + 1; }
  toggleLock() { this.lockDay = !this.lockDay; return this.lockDay; }

  update() {
    const realT = (this.gameTime % DAY_LENGTH) / DAY_LENGTH;
    const t = this.lockDay ? LOCK_T : realT;
    const s = sampleDay(t);
    this.fog.color.copy(s.sky);
    // Ease into a clearer daytime view while retaining haze at the horizon.
    const daylight = THREE.MathUtils.smoothstep(s.intensity, 0.2, 1.2);
    const visibility = this.renderSystem.graphics?.viewDistance || 1;
    this.fog.near = (70 + daylight * 65) * visibility;
    this.fog.far = (340 + daylight * 160) * visibility;
    if (this.rig.aerial) {
      // Height is not atmospheric distance: keep the visible map ahead of the fog,
      // including at the largest zoom-out and on portrait screens.
      this.fog.near = Math.max(450, this.rig.distance * 2);
      this.fog.far = this.fog.near + Math.max(400, this.rig.distance);
    }
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = this.rig.aerial ? 0.8 : s.intensity * 0.95;
    this.hemi.color.copy(s.sky);
    this.hemi.groundColor.copy(s.hemiColor);
    this.hemi.intensity = this.rig.aerial ? 0.38 : s.hemiI * 0.5;
    if (this.rig.aerial) {
      this.sun.color.set(0xfff4e5);
      this.hemi.color.set(0xf2f5ff);
      this.hemi.groundColor.set(0x656b58);
    }
    const angle = t * Math.PI * 2 - Math.PI / 2;
    const R = 85;
    this.sun.position.set(this.rig.target.x + Math.cos(angle) * R, Math.max(18, Math.sin(angle) * R + 24), this.rig.target.z + Math.sin(angle * 0.7) * 46);
    this.sun.target.position.copy(this.rig.target);
    this.sun.target.updateMatrixWorld();
    // Concentrate shadow texels around the inspected area when zooming in.
    const span = Math.max(18, Math.min(150, this.rig.distance * 0.7));
    const shadowCamera = this.sun.shadow.camera;
    const lightDistance = this.sun.position.distanceTo(this.rig.target);
    const shadowFar = lightDistance + span * 2 + 40;
    if (Math.abs(shadowCamera.right - span) > 0.5 || Math.abs(shadowCamera.far - shadowFar) > 0.5) {
      shadowCamera.near = 0.5;
      shadowCamera.far = shadowFar;
      shadowCamera.left = shadowCamera.bottom = -span;
      shadowCamera.right = shadowCamera.top = span;
      shadowCamera.updateProjectionMatrix();
    }
    // Sky dome + sun disc + stars replace the old flat scene.background color (RenderSystem.updateSky).
    this.renderSystem.updateSky({ horizon: s.sky, sunColor: s.sunColor, angle });
    this.dayCounterEl.textContent = `Día ${this.dayNumber()}`;
  }

  restore({ gameTime, lockDay } = {}) {
    this.gameTime = Number.isFinite(gameTime) ? Math.max(0, gameTime) : DAY_LENGTH * 0.32;
    this.lockDay = Boolean(lockDay);
  }
}
