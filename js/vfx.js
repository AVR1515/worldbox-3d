import * as THREE from 'three';

// Temporary visual effects that used to live inline in main.js: explosion/lightning flashes,
// tornado funnels and the glowing war beams drawn between clashing armies. None of this holds
// simulation state of its own — it reacts to what main.js's power handlers and onStep callback
// tell it, and reads world/creatures/settlements through setSimContext() because those get
// replaced wholesale on every new game (see GameSession) rather than mutated in place.
export function createVfxSystem(scene) {
  const flashes = [];
  const tornadoes = [];
  const warBeams = new Map();
  const _upV = new THREE.Vector3(0, 1, 0);
  let _warBeamCheckT = 0;
  let ctx = { world: null, creatures: null, settlements: null, reducedMotion: false };

  function setSimContext(next) {
    ctx = { ...ctx, ...next };
  }

  function spawnExplosion(x, y, z, radius, color = 0xffb84d, implosion = false) {
    const geo = new THREE.SphereGeometry(Math.max(0.6, radius * 0.9), 16, 12);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const ball = new THREE.Mesh(geo, mat);
    ball.position.set(x, y + radius * 0.4, z);
    scene.add(ball);
    flashes.push({ mesh: ball, t: 0.5, duration: 0.5, baseOpacity: 0.85 });
    const ringGeoEx = new THREE.RingGeometry(radius * 0.2, radius, 24);
    ringGeoEx.rotateX(-Math.PI / 2);
    const ringMatEx = new THREE.MeshBasicMaterial({ color: implosion ? 0x261334 : 0x3a2418, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeoEx, ringMatEx);
    ring.position.set(x, y + 0.08, z);
    scene.add(ring);
    flashes.push({ mesh: ring, t: 1.3, duration: 1.3, baseOpacity: 0.55 });
    const light = new THREE.PointLight(color, implosion ? 6 : 10, Math.max(10, radius * 10));
    light.position.set(x, y + radius, z);
    scene.add(light);
    flashes.push({ mesh: light, t: 0.4, duration: 0.4, isLight: true, baseIntensity: 10 });
  }

  function flashLightning(x, y, z) {
    const geo = new THREE.CylinderGeometry(0.05, 0.35, 14, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xdcefff, transparent: true, opacity: 0.9 });
    const bolt = new THREE.Mesh(geo, mat);
    bolt.position.set(x, y + 7, z);
    scene.add(bolt);
    flashes.push({ mesh: bolt, t: 0.25, duration: 0.25, baseOpacity: 0.9 });
    const flashLight = new THREE.PointLight(0xbfe0ff, 6, 18);
    flashLight.position.set(x, y + 3, z);
    scene.add(flashLight);
    flashes.push({ mesh: flashLight, t: 0.18, duration: 0.18, isLight: true, baseIntensity: 6 });
  }

  function updateFlashes(dt) {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t -= dt;
      if (f.t <= 0) {
        scene.remove(f.mesh);
        f.mesh.geometry?.dispose();
        f.mesh.material?.dispose();
        flashes.splice(i, 1);
        continue;
      }
      const d = f.duration || 0.25;
      if (f.mesh.material && f.baseOpacity !== undefined) f.mesh.material.opacity = Math.max(0, f.t / d) * f.baseOpacity;
      if (f.isLight) f.mesh.intensity = Math.max(0, f.t / d) * (f.baseIntensity ?? 6);
    }
  }

  function applyAcidRain(x, z, radius) {
    const { world, creatures } = ctx;
    for (const c of creatures.creatures) {
      if (!c.alive) continue;
      const dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      c.health -= c.maxHealth * 0.5;
    }
    const [gx, gz] = world.worldToGrid(x, z);
    world.forEachInRadius(gx, gz, radius, (cx, cz) => { if (Math.random() < 0.4) world.removeTree(cx, cz); });
    const geo = new THREE.CylinderGeometry(radius, radius, 0.1, 24, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0x6fbf3f, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(geo, mat);
    disc.position.set(x, world.groundY(gx, gz) + 3, z);
    scene.add(disc);
    flashes.push({ mesh: disc, t: 1.1, duration: 1.1, baseOpacity: 0.4 });
  }

  function spawnTornado(x, z) {
    const { world } = ctx;
    const geo = new THREE.CylinderGeometry(0.15, 2.2, 9, 10, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xb9c3cc, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, world.heightAtWorld(x, z) + 4.5, z);
    scene.add(mesh);
    tornadoes.push({
      mesh, x, z,
      vx: (Math.random() - 0.5) * 3, vz: (Math.random() - 0.5) * 3,
      life: 16 + Math.random() * 8,
    });
  }

  function updateTornadoes(dt) {
    const { world, creatures, settlements } = ctx;
    if (!world) return;
    for (let i = tornadoes.length - 1; i >= 0; i--) {
      const t = tornadoes[i];
      t.life -= dt;
      if (t.life <= 0) { scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose(); tornadoes.splice(i, 1); continue; }
      t.vx += (Math.random() - 0.5) * 2 * dt;
      t.vz += (Math.random() - 0.5) * 2 * dt;
      const speed = Math.hypot(t.vx, t.vz) || 1;
      const maxSpeed = 3.5;
      if (speed > maxSpeed) { t.vx = t.vx / speed * maxSpeed; t.vz = t.vz / speed * maxSpeed; }
      t.x += t.vx * dt; t.z += t.vz * dt;
      t.x = Math.max(-world.size / 2, Math.min(world.size / 2, t.x));
      t.z = Math.max(-world.size / 2, Math.min(world.size / 2, t.z));
      t.mesh.position.set(t.x, world.heightAtWorld(t.x, t.z) + 4.5, t.z);
      // "Reducir movimiento" apaga el giro continuo (el objetivo típico de esta preferencia),
      // no la simulación del tornado en sí: sigue dañando y desplazándose por el mapa igual.
      if (!ctx.reducedMotion) t.mesh.rotation.y += dt * 6;
      for (const c of creatures.creatures) {
        if (!c.alive) continue;
        const dx = c.x - t.x, dz = c.z - t.z;
        if (dx * dx + dz * dz < 1.8 * 1.8) {
          c.health -= dt * 55;
          const d = Math.hypot(dx, dz) || 1;
          c.x += (dx / d) * dt * 2.2;
          c.z += (dz / d) * dt * 2.2;
        }
      }
      const [gx, gz] = world.worldToGrid(t.x, t.z);
      world.forEachInRadius(gx, gz, 2, (cx, cz) => { if (Math.random() < 0.25) world.removeTree(cx, cz); });
      for (const s of settlements.settlements) {
        for (const h of s.houses.slice()) {
          const dx = h.x - t.x, dz = h.z - t.z;
          if (dx * dx + dz * dz < 4 && Math.random() < dt * 0.5) {
            settlements.removeHouse(h);
            s.houses = s.houses.filter(x => x !== h);
          }
        }
      }
    }
  }

  function ensureWarBeam(key, colorA, colorB, ax, az, bx, bz) {
    let beam = warBeams.get(key);
    if (!beam) {
      const geo = new THREE.CylinderGeometry(0.12, 0.12, 1, 6, 1, true);
      const mat = new THREE.MeshBasicMaterial({ color: colorA.clone().lerp(colorB, 0.5), transparent: true, opacity: 0, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      beam = { mesh, opacity: 0, fadeOut: false };
      warBeams.set(key, beam);
    }
    beam.fadeOut = false;
    const dx = bx - ax, dz = bz - az;
    const len = Math.max(0.001, Math.hypot(dx, dz));
    const dir = new THREE.Vector3(dx, 0, dz).normalize();
    beam.mesh.quaternion.setFromUnitVectors(_upV, dir);
    beam.mesh.position.set((ax + bx) / 2, 34, (az + bz) / 2);
    beam.mesh.scale.set(1, len, 1);
  }

  function updateWarBeams(dt) {
    const { creatures, settlements } = ctx;
    if (!creatures || !settlements) return;
    _warBeamCheckT -= dt;
    if (_warBeamCheckT <= 0) {
      _warBeamCheckT = 0.6;
      const soldiers = creatures.creatures.filter(c => c.alive && c.role === 'soldado' && c.warTargetEmpire != null);
      const seenPairs = new Set();
      for (const s of soldiers) {
        const nearbyEnemies = creatures.queryRadius(s.x, s.z, 15, o =>
          o.alive && o.role === 'soldado' && o.warTargetEmpire != null && o.id !== s.id, []);
        for (const o of nearbyEnemies) {
          if (o === s || o.empireId === s.empireId || s.warTargetEmpire !== o.empireId) continue;
          const key = [s.empireId, o.empireId].sort((a, b) => a - b).join('-');
          if (seenPairs.has(key)) continue;
          seenPairs.add(key);
          const eA = settlements.empires.find(e => e.id === s.empireId);
          const eB = settlements.empires.find(e => e.id === o.empireId);
          if (eA && eB) ensureWarBeam(key, eA.color, eB.color, s.x, s.z, o.x, o.z);
        }
      }
      for (const [key, beam] of warBeams) if (!seenPairs.has(key)) beam.fadeOut = true;
    }
    for (const [key, beam] of Array.from(warBeams)) {
      beam.opacity += (beam.fadeOut ? -1 : 1) * dt * 1.4;
      beam.opacity = Math.max(0, Math.min(0.75, beam.opacity));
      beam.mesh.material.opacity = beam.opacity;
      if (beam.fadeOut && beam.opacity <= 0.001) {
        scene.remove(beam.mesh);
        beam.mesh.geometry.dispose();
        beam.mesh.material.dispose();
        warBeams.delete(key);
      }
    }
  }

  function clear() {
    for (const f of flashes.splice(0)) { scene.remove(f.mesh); f.mesh.geometry?.dispose(); f.mesh.material?.dispose(); }
    for (const t of tornadoes.splice(0)) { scene.remove(t.mesh); t.mesh.geometry?.dispose(); t.mesh.material?.dispose(); }
    warBeams.forEach(b => { scene.remove(b.mesh); b.mesh.geometry?.dispose(); b.mesh.material?.dispose(); });
    warBeams.clear();
  }

  return {
    setSimContext, spawnExplosion, flashLightning, updateFlashes, applyAcidRain,
    spawnTornado, updateTornadoes, updateWarBeams, clear,
  };
}
