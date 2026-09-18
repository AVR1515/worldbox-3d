import * as THREE from 'three';

export class CameraRig {
  constructor(camera, dom, target) {
    this.camera = camera;
    this.dom = dom;
    this.target = target.clone();
    this.azimuth = Math.PI * 0.25;
    this.polar = Math.PI * 0.32;
    this.distance = 46;
    this.minDist = 8;
    this.maxDist = 240;
    this.panDisabled = false;
    this.aerial = false;
    this._closeFollow = false;
    this.firstPerson = false;
    this.shakeTime = 0; this.shakeDuration = 0; this.shakeIntensity = 0;
    this.keys = {};
    this._dragButton = -1;
    this._lastX = 0; this._lastY = 0;
    // A single finger is reserved for painting/applying the current tool (js/main.js's own
    // pointerdown/pointermove on the canvas already does that, mirroring left-click on desktop).
    // Two fingers rotate + pinch-zoom instead — the touch equivalent of right-click-drag + wheel —
    // so touch devices get camera control without a finger ever being ambiguous between "paint"
    // and "look around". `multiTouch` lets main.js suppress tool application while a two-finger
    // gesture is in progress, so rotating/zooming never also drags a stray edit across the terrain.
    this._touches = new Map();
    this._pinch = null;
    this._singleTouchLast = null;
    this.multiTouch = false;
    // main.js assigns this to `() => currentTool === 'inspect'`: the hand/inspect tool has
    // nothing to paint or drag-apply, so its single finger is free to pan instead of being
    // reserved for tool application like every other (paintable) tool's finger is.
    this.isPanTool = null;

    dom.addEventListener('contextmenu', e => e.preventDefault());
    dom.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') {
        this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this._touches.size === 1) this._singleTouchLast = { x: e.clientX, y: e.clientY };
        if (this._touches.size === 2) {
          this.multiTouch = true;
          this._singleTouchLast = null;
          const [a, b] = [...this._touches.values()];
          this._pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
        }
        return;
      }
      if (e.button === 2 || e.button === 1) {
        this._dragButton = e.button;
        this._lastX = e.clientX; this._lastY = e.clientY;
        dom.setPointerCapture(e.pointerId);
      }
    });
    const releaseTouch = e => {
      if (e.pointerType !== 'touch') return;
      this._touches.delete(e.pointerId);
      if (this._touches.size < 2) { this.multiTouch = false; this._pinch = null; }
      if (this._touches.size < 1) this._singleTouchLast = null;
    };
    dom.addEventListener('pointerup', e => { this._dragButton = -1; releaseTouch(e); });
    dom.addEventListener('pointercancel', releaseTouch);
    dom.addEventListener('pointerleave', e => { this._dragButton = -1; releaseTouch(e); });
    dom.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') {
        if (!this._touches.has(e.pointerId)) return;
        this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this._touches.size === 1 && this._singleTouchLast && this.isPanTool?.()) {
          const dx = e.clientX - this._singleTouchLast.x, dy = e.clientY - this._singleTouchLast.y;
          this._singleTouchLast = { x: e.clientX, y: e.clientY };
          this._pan(dx, dy);
        } else if (this._touches.size === 2 && this._pinch) {
          const [a, b] = [...this._touches.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
          this.distance = Math.min(this.maxDist, Math.max(this.minDist, this.distance * (this._pinch.dist / Math.max(1, dist))));
          if (!this.aerial) {
            this.azimuth -= (midX - this._pinch.midX) * 0.0055;
            this.polar = Math.min(Math.PI * 0.49, Math.max(0.08, this.polar - (midY - this._pinch.midY) * 0.0045));
          }
          this._pinch = { dist, midX, midY };
        }
        return;
      }
      if (this._dragButton === -1) return;
      const dx = e.clientX - this._lastX, dy = e.clientY - this._lastY;
      this._lastX = e.clientX; this._lastY = e.clientY;
      if (this._dragButton === 2 && !this.aerial) {
        this.azimuth -= dx * 0.0055;
        this.polar = Math.min(Math.PI * 0.49, Math.max(0.08, this.polar - dy * 0.0045));
      } else if (this._dragButton === 1 || this.aerial) {
        this._pan(dx, dy);
      }
    });
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      this.distance = Math.min(this.maxDist, Math.max(this.minDist, this.distance + e.deltaY * 0.04));
    }, { passive: false });

    window.addEventListener('keydown', e => { this.keys[e.code] = true; });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
  }

  _pan(dx, dy) {
    const forward = new THREE.Vector3(Math.sin(this.azimuth), 0, Math.cos(this.azimuth));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const scale = this.distance * 0.0016;
    this.target.addScaledVector(right, -dx * scale);
    this.target.addScaledVector(forward, dy * scale);
  }

  setAerial(active, size = 180, fit = true) {
    if (active && !this.aerial) this._orbitState = {
      polar: this.polar, azimuth: this.azimuth, distance: this.distance,
      maxDist: this.maxDist, target: this.target.clone(),
    };
    this.aerial = Boolean(active);
    if (this.aerial) {
      this.polar = 0.001;
      this.azimuth = 0;
      if (fit) {
        const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
        const distance = size * 0.6 / (Math.tan(halfFov) * Math.min(1, this.camera.aspect));
        this.maxDist = Math.max(240, distance * 1.3);
        this.distance = distance;
        this.target.set(0, 0, 0);
      } else this.maxDist = Math.max(240, this.distance * 1.3);
    } else if (this._orbitState) {
      const saved = this._orbitState;
      this.polar = saved.polar;
      this.azimuth = saved.azimuth;
      this.distance = saved.distance;
      this.maxDist = saved.maxDist;
      this.target.copy(saved.target);
      this._orbitState = null;
    }
  }

  // Close third-person follow for "Vista humana" (js/main.js) — same save/restore pattern as
  // setAerial() below, but only touches polar/distance/minDist/maxDist, not azimuth: azimuth stays
  // whatever the player last had it at, so toggling human view on/off doesn't spin the camera
  // around. minDist (normally 8, tuned for the RTS-scale orbit camera) has to drop too, or the
  // very next wheel-zoom tick clamps distance straight back out of close-follow range.
  setCloseFollow(active) {
    if (active && !this._closeFollow) this._closeFollowState = {
      polar: this.polar, distance: this.distance, minDist: this.minDist, maxDist: this.maxDist,
    };
    this._closeFollow = Boolean(active);
    if (this._closeFollow) {
      this.polar = 1.3;
      this.minDist = 2.5;
      this.maxDist = Math.max(this.maxDist, 14);
      this.distance = 4.5;
    } else if (this._closeFollowState) {
      const saved = this._closeFollowState;
      this.polar = saved.polar; this.distance = saved.distance;
      this.minDist = saved.minDist; this.maxDist = saved.maxDist;
      this._closeFollowState = null;
    }
    this.firstPerson = false; // always re-enter human view in third person
  }

  setFirstPerson(active) {
    this.firstPerson = Boolean(active) && this._closeFollow;
  }

  // Punchy feedback for explosions/impacts: a decaying random jitter on top of wherever the
  // orbit/first-person math already placed the camera this frame. Intensity is in world units
  // (roughly meters of jitter at its peak); callers scale it down with distance from the blast
  // so a nuke on the far side of the map doesn't shake the camera as hard as one under your nose.
  shake(intensity, duration = 0.4) {
    if (!(intensity > 0)) return;
    // Keep the strongest shake in flight rather than averaging two overlapping ones away.
    if (intensity >= this.shakeIntensity) { this.shakeIntensity = intensity; this.shakeDuration = duration; }
    this.shakeTime = Math.max(this.shakeTime || 0, duration);
  }

  update(dt, worldHalfSize, heightSampler) {
    if (this.aerial) { this.polar = 0.001; this.azimuth = 0; }
    const panSpeed = this.distance * 0.9 * dt;
    const forward = new THREE.Vector3(Math.sin(this.azimuth), 0, Math.cos(this.azimuth));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    if (!this.panDisabled) {
      if (this.keys['KeyW'] || this.keys['ArrowUp']) this.target.addScaledVector(forward, -panSpeed);
      if (this.keys['KeyS'] || this.keys['ArrowDown']) this.target.addScaledVector(forward, panSpeed);
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) this.target.addScaledVector(right, -panSpeed);
      if (this.keys['KeyD'] || this.keys['ArrowRight']) this.target.addScaledVector(right, panSpeed);
    }
    if (worldHalfSize) {
      this.target.x = Math.max(-worldHalfSize, Math.min(worldHalfSize, this.target.x));
      this.target.z = Math.max(-worldHalfSize, Math.min(worldHalfSize, this.target.z));
    }
    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    const dirX = sp * Math.sin(this.azimuth), dirY = cp, dirZ = sp * Math.cos(this.azimuth);
    if (this.firstPerson) {
      // Same azimuth/polar the third-person orbit uses (so right-drag "look around" feels
      // identical in both modes) — just placed at the target itself instead of `distance` away,
      // and looking outward along -dir instead of lookAt(target). lookAt(target) at ~0 distance
      // would aim at (or through) the camera's own position, an undefined/flickery direction.
      // Nudged slightly forward (along the look direction) from the target's exact centre, so the
      // near clip plane doesn't sit inside the possessed creature's own head/body geometry.
      this.camera.position.set(this.target.x - dirX * 0.15, this.target.y - dirY * 0.15, this.target.z - dirZ * 0.15);
      this._lookAtTmp = this._lookAtTmp || new THREE.Vector3();
      this._lookAtTmp.set(this.target.x - dirX, this.target.y - dirY, this.target.z - dirZ);
      this.camera.lookAt(this._lookAtTmp);
    } else {
      this.camera.position.set(this.target.x + this.distance * dirX, this.target.y + this.distance * dirY, this.target.z + this.distance * dirZ);
      this.camera.lookAt(this.target);
    }
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const k = this.shakeDuration > 0 ? this.shakeTime / this.shakeDuration : 0;
      const mag = this.shakeIntensity * k * k; // ease-out: sharp kick, quick settle
      this.camera.position.x += (Math.random() - 0.5) * mag;
      this.camera.position.y += (Math.random() - 0.5) * mag * 0.6;
      this.camera.position.z += (Math.random() - 0.5) * mag;
      if (!this.firstPerson) this.camera.lookAt(this.target);
    }
    // Zooming/panning can otherwise push the camera below the terrain surface at its own
    // x/z (e.g. a nearby hill rising above the orbit target), which puts the near clip plane
    // inside the ground mesh and renders as a solid blurry smear. Push the camera back up to a
    // safe clearance above the ground directly beneath it whenever a height sampler is given.
    if (heightSampler) {
      const clearance = this.firstPerson ? 0.3 : (this._closeFollow ? 0.5 : 1.2);
      const groundY = heightSampler(this.camera.position.x, this.camera.position.z);
      if (Number.isFinite(groundY) && this.camera.position.y < groundY + clearance) {
        this.camera.position.y = groundY + clearance;
        if (!this.firstPerson) this.camera.lookAt(this.target);
      }
    }
  }
}
