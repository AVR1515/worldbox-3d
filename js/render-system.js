import * as THREE from 'three';
import { EffectComposer } from '../node_modules/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../node_modules/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../node_modules/three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from '../node_modules/three/examples/jsm/postprocessing/SMAAPass.js';
import { SSAOPass } from '../node_modules/three/examples/jsm/postprocessing/SSAOPass.js';
import { resolveGraphics } from './graphics-config.js';
import { GpuTimer } from './gpu-timer.js';
import { DynamicResolution } from './dynamic-resolution.js';

// Radial-gradient canvas sprites for the sun disc and stars — same technique the game already
// uses for city name labels (settlements.js's buildLabelTexture), just applied to the sky.
function buildGlowTexture(size, inner, outer) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const SKY_VERTEX_SHADER = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAGMENT_SHADER = `
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  varying vec3 vWorldPosition;
  void main() {
    // Match the fog color below the horizon, regardless of camera height/pan.
    float h = normalize(vWorldPosition - cameraPosition).y;
    float t = smoothstep(0.0, 0.62, h);
    gl_FragColor = vec4(mix(uHorizon, uZenith, t), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const ZENITH_TINT = new THREE.Color(0x03040f);

// Same radial-gradient canvas technique as buildGlowTexture, but with a few darker blobs
// painted on top so the moon reads as a sphere with craters instead of a flat glow dot.
function buildMoonTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  base.addColorStop(0, 'rgba(238,242,255,1)');
  base.addColorStop(0.78, 'rgba(206,216,242,1)');
  base.addColorStop(1, 'rgba(206,216,242,0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(150,162,196,0.4)';
  for (const [cx, cy, cr] of [[0.4, 0.35, 0.1], [0.63, 0.56, 0.075], [0.3, 0.62, 0.065], [0.56, 0.28, 0.05]]) {
    ctx.beginPath(); ctx.arc(cx * size, cy * size, cr * size, 0, Math.PI * 2); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A handful of overlapping soft blobs read as one fluffy cloud puff instead of a single
// perfectly round dot.
function buildCloudTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (const [bx, by, br] of [[0.5, 0.56, 0.42], [0.3, 0.52, 0.3], [0.7, 0.5, 0.32], [0.42, 0.36, 0.26], [0.6, 0.62, 0.28]]) {
    const gradient = ctx.createRadialGradient(bx * size, by * size, 0, bx * size, by * size, br * size);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(bx * size, by * size, br * size, 0, Math.PI * 2); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class RenderSystem {
  constructor(canvas, { shadowSpan = 150 } = {}) {
    // SMAA owns antialiasing. Context MSAA otherwise stays enabled even when the
    // user disables smoothing, making the direct/low-quality path more expensive.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    const gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = gl.getParameter(gpuInfo ? gpuInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    this.gpuTimer = new GpuTimer(gl);
    this.profileGpu = false;
    this.resolutionController = new DynamicResolution();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // EffectComposer's passes (SSAO, bloom, output, SMAA) each issue their own internal
    // renderer.render() call, and info.autoReset (on by default) clears renderer.info.render
    // before every single one of those — so with any post-processing enabled, main.js's
    // diagnostics read of renderer.info after composer.render() only ever saw whichever tiny
    // full-screen quad pass rendered last (typically SMAA's), not the real scene's draw calls or
    // triangle count. Reset it manually, once, at the start of our own render() below instead, so
    // it accumulates across every pass in the frame like the diagnostics panel already assumes.
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.88;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.fog = new THREE.Fog(0x8fcdf5, 70, 340);
    this.scene.fog = this.fog;
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1400);
    this.hemi = new THREE.HemisphereLight(0xbcd9f0, 0x33301f, 0.55);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -shadowSpan;
    this.sun.shadow.camera.right = shadowSpan;
    this.sun.shadow.camera.top = shadowSpan;
    this.sun.shadow.camera.bottom = -shadowSpan;
    this.sun.shadow.camera.near = 5;
    this.sun.shadow.camera.far = 440;
    // World objects are small: a large depth bias erases stone/contact shadows.
    this.sun.shadow.bias = -0.000025;
    this.sun.shadow.normalBias = 0.012;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    // Outdoor reflections: a sky/ground hemisphere instead of indoor light panels.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = new THREE.Scene();
    const envGeometry = new THREE.SphereGeometry(100, 32, 16);
    const colors = new Float32Array(envGeometry.attributes.position.count * 3);
    const horizon = new THREE.Color(0xd6e7ea), zenith = new THREE.Color(0x608fbd), ground = new THREE.Color(0x626b51), tint = new THREE.Color();
    for (let i = 0; i < envGeometry.attributes.position.count; i++) {
      const y = envGeometry.attributes.position.getY(i) / 100;
      tint.copy(horizon).lerp(y > 0 ? zenith : ground, Math.sqrt(Math.abs(y)));
      tint.multiplyScalar(0.35).toArray(colors, i * 3);
    }
    envGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const envMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    environment.add(new THREE.Mesh(envGeometry, envMaterial));
    this.scene.environment = pmrem.fromScene(environment, 0.04).texture;
    envGeometry.dispose(); envMaterial.dispose();
    pmrem.dispose();

    this._buildSky();
    this._buildComposer();
    this.postFXEnabled = true;
    this.resize();
  }

  _buildSky() {
    const skyGeo = new THREE.SphereGeometry(500, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { uHorizon: { value: new THREE.Color(0x8fcdf5) }, uZenith: { value: new THREE.Color(0x2c4f8f) } },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.renderOrder = -1;
    this.sky.matrixAutoUpdate = true;
    this.scene.add(this.sky);

    const sunTexture = buildGlowTexture(128, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTexture, color: 0xfff3d6, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, opacity: 0,
    }));
    this.sunSprite.scale.setScalar(26);
    this.sunSprite.renderOrder = -1;
    this.scene.add(this.sunSprite);

    const starTexture = buildGlowTexture(32, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    const starCount = 900;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      // Points on a sphere, upper hemisphere only (biased up) — no point paying fill-rate for
      // stars that would render below the horizon, behind the terrain, all game long.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - Math.random() * 0.92);
      const r = 480;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi) + 40;
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 2.4, map: starTexture, transparent: true, depthWrite: false,
      opacity: 0, sizeAttenuation: false, fog: false,
    }));
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);

    const moonTexture = buildMoonTexture(128);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: moonTexture, color: 0xffffff, transparent: true, depthWrite: false,
      blending: THREE.NormalBlending, fog: false, opacity: 0,
    }));
    this.moonSprite.scale.setScalar(17);
    this.moonSprite.renderOrder = -1;
    this.scene.add(this.moonSprite);

    // Cloud puffs on a group so a single slow Y rotation drifts all of them across the sky
    // without any per-sprite position bookkeeping.
    const cloudTexture = buildCloudTexture(128);
    this.clouds = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTexture, color: 0xffffff, transparent: true, depthWrite: false, fog: false, opacity: 0.55,
      }));
      const theta = Math.random() * Math.PI * 2;
      const r = 250 + Math.random() * 100;
      const y = 55 + Math.random() * 75;
      sprite.position.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
      const scale = 36 + Math.random() * 46;
      sprite.scale.set(scale * (1.1 + Math.random() * 0.5), scale * 0.55, 1);
      sprite.renderOrder = -1;
      this.clouds.add(sprite);
    }
    this.scene.add(this.clouds);

    this._zenithTmp = new THREE.Color();
    this._sunDirTmp = new THREE.Vector3();
    this._moonDirTmp = new THREE.Vector3();
    this._cloudColorTmp = new THREE.Color();
    this._cloudNightTmp = new THREE.Color(0x8fa3c9);
  }

  // Called once per frame from main.js's day/night cycle with the horizon color and sun color
  // sampleDay() already computes, plus the same time-of-day angle used to aim the shadow light —
  // this method owns turning that into a zenith tint, the sun disc's sky position, and how much
  // the stars should show, so main.js doesn't need to know how the sky is actually built.
  updateSky({ horizon, sunColor, angle }) {
    this._zenithTmp.copy(horizon).lerp(ZENITH_TINT, 0.72);
    this.sky.material.uniforms.uHorizon.value.copy(horizon);
    this.sky.material.uniforms.uZenith.value.copy(this._zenithTmp);

    const dir = this._sunDirTmp.set(Math.cos(angle), Math.sin(angle), 0.32).normalize();
    this.sunSprite.position.copy(this.camera.position).addScaledVector(dir, 380);
    this.sunSprite.material.color.copy(sunColor);
    const heightFade = Math.max(0, Math.min(1, (dir.y + 0.06) / 0.26));
    this.sunSprite.material.opacity = heightFade * 0.85;
    this.sunSprite.visible = heightFade > 0.002;
    this.stars.material.opacity = (1 - heightFade) * 0.85;

    const moonDir = this._moonDirTmp.set(Math.cos(angle + Math.PI), Math.sin(angle + Math.PI), 0.32).normalize();
    this.moonSprite.position.copy(this.camera.position).addScaledVector(moonDir, 380);
    const moonHeightFade = Math.max(0, Math.min(1, (moonDir.y + 0.06) / 0.26));
    this.moonSprite.material.opacity = moonHeightFade * 0.9;
    this.moonSprite.visible = moonHeightFade > 0.002;

    this._cloudColorTmp.set(0xffffff).lerp(this._cloudNightTmp, 1 - heightFade);
    for (const sprite of this.clouds.children) sprite.material.color.copy(this._cloudColorTmp);
  }

  _buildComposer() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.aoPass = new SSAOPass(this.scene, this.camera, size.x, size.y, 16);
    this.aoPass.kernelRadius = 0.6;
    this.aoPass.minDistance = 0.02 / this.camera.far;
    this.aoPass.maxDistance = 0.8 / this.camera.far;
    this.aoPass.ssaoMaterial.fragmentShader = this.aoPass.ssaoMaterial.fragmentShader.replace('1.0 - occlusion', '1.0 - occlusion * 0.45');
    this.aoPass.enabled = false;
    this._patchAoVisibilityOverride(this.aoPass);
    this.composer.addPass(this.aoPass);
    // Deliberately subtle: this project's materials aren't emissive/HDR by design, so bloom is
    // meant to catch lava, magic and explosion flashes glowing, not haze up ordinary daylight.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.4, 0.88);
    this.composer.addPass(this.bloomPass);
    const output = new OutputPass();
    output.material.fragmentShader = output.material.fragmentShader.replace('gl_FragColor = texture2D( tDiffuse, vUv );', `gl_FragColor = texture2D( tDiffuse, vUv );
      float luminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor.rgb = mix(vec3(luminance), gl_FragColor.rgb, 0.86);`);
    this.composer.addPass(output);
    // SMAA replaces the antialiasing the canvas context would normally provide: once the scene
    // renders into the composer's offscreen buffers, the renderer's own `antialias: true` no
    // longer touches the final image.
    this.smaaPass = new SMAAPass(size.x, size.y);
    this.composer.addPass(this.smaaPass);
  }

  // C-10: SSAOPass.overrideVisibility()/restoreVisibility() each do a full scene.traverse() to
  // hide Points/Lines before rendering normals+depth — this game has exactly two such objects
  // ever (the star field, the rain particles), never a Line, so at 1.500 creatures that walks
  // ~12.000 objects twice a frame for something that only ever touches 1-2 of them (measured
  // ~4ms/frame of render() at 1.500 population). Cache that short list instead, refreshed
  // periodically rather than every frame — the set only changes on rare events like weather
  // regenerating the rain mesh, so a few frames of staleness around such an event (at most:
  // AO's normal pass briefly sees an old/new points object it shouldn't) is an acceptable,
  // effectively invisible trade-off for skipping ~12.000 object visits on every other frame.
  _patchAoVisibilityOverride(aoPass) {
    let hidden = [];
    let refreshCountdown = 0;
    aoPass.overrideVisibility = () => {
      if (refreshCountdown-- <= 0) {
        refreshCountdown = 90;
        hidden = [];
        this.scene.traverse(obj => { if (obj.isPoints || obj.isLine) hidden.push(obj); });
      }
      for (const obj of hidden) { obj.userData._aoWasVisible = obj.visible; obj.visible = false; }
    };
    aoPass.restoreVisibility = () => {
      for (const obj of hidden) obj.visible = obj.userData._aoWasVisible;
    };
  }

  resize(width = window.innerWidth, height = window.innerHeight) {
    const safeHeight = Math.max(1, height);
    this.camera.aspect = width / safeHeight;
    this.camera.userData.viewportHeight = safeHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, safeHeight);
    this.composer?.setSize(width, safeHeight);
    if (this.aoPass) {
      const ratio = this.renderer.getPixelRatio() * (this.graphics?.ambientOcclusionResolution ?? 0.5);
      this.aoPass.setSize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(safeHeight * ratio)));
    }
  }

  render() {
    if (this.profileGpu) this.gpuTimer?.begin();
    else if (this.gpuTimer?.pending.length) this.gpuTimer.clear();
    this.renderer.info.reset();
    // Update shadows for the color pass, not again for SSAO's normals pass.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = this.renderer.shadowMap.enabled;
    this.sky.position.copy(this.camera.position);
    this.stars.position.copy(this.camera.position);
    if (this.clouds) {
      this.clouds.position.copy(this.camera.position);
      const now = performance.now();
      const cloudDt = this._lastCloudTime ? Math.min(0.1, (now - this._lastCloudTime) / 1000) : 0;
      this._lastCloudTime = now;
      this.clouds.rotation.y += cloudDt * 0.006;
    }
    // Color and SSAO render the same frame. Propagate transforms once, instead of
    // traversing every character and building again for each composer pass.
    const autoUpdate = this.scene.matrixWorldAutoUpdate;
    if (autoUpdate) this.scene.updateMatrixWorld();
    this.scene.matrixWorldAutoUpdate = false;
    try {
      if (this.postFXEnabled && this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    } finally {
      this.scene.matrixWorldAutoUpdate = autoUpdate;
      this.gpuTimer?.end();
    }
  }

  setQuality(level = 'high') {
    this.setGraphics({ quality: level });
  }

  updateFrameBudget(seconds) {
    if (!this.graphics?.dynamicResolution) return;
    const scale = this.resolutionController.sample(seconds);
    if (scale == null) return;
    const ratio = this.basePixelRatio * scale;
    this.renderer.setPixelRatio(ratio);
    this.composer?.setPixelRatio(ratio);
    this.resize();
  }

  setGraphics(settings = {}) {
    const config = resolveGraphics(settings);
    this.graphics = config;
    const ratio = Math.min((window.devicePixelRatio || 1) * config.resolution, 2.5);
    this.basePixelRatio = ratio;
    this.resolutionController.reset();
    this.renderer.setPixelRatio(ratio);
    this.composer?.setPixelRatio(ratio);
    const size = Math.min(config.shadowSize, this.renderer.capabilities.maxTextureSize);
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose?.();
      this.sun.shadow.map = null;
      this.sun.shadow.needsUpdate = true;
    }
    this.bloomPass.enabled = config.bloom;
    this.bloomPass.strength = 0.16;
    this.bloomPass.threshold = 1.05;
    this.smaaPass.enabled = config.antialias;
    this.aoPass.enabled = config.ambientOcclusion;
    this.postFXEnabled = config.bloom || config.antialias || config.ambientOcclusion;
    this.setShadows(settings.shadows !== false);
    this.resize();
  }

  setShadows(enabled) {
    this.renderer.shadowMap.enabled = Boolean(enabled);
    this.sun.castShadow = Boolean(enabled);
    this.renderer.shadowMap.needsUpdate = true;
    this.sun.shadow.needsUpdate = true;
  }
}
