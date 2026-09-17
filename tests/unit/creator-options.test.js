import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { World, BIOME_IDS } from '../../js/world.js';
import { generateBaseTerrain, regionalClimate } from '../../js/world-generation.js';
describe('Opciones del creador', () => {
  it('el relieve cambia las alturas con la misma semilla en cada mapa', () => {
    for (const mapType of ['island','continents','archipelago','ring']) {
      const opts={size:64,seed:7249,mapType,maxHeight:17};
      const flat=generateBaseTerrain({...opts,mountainLevel:0}).height;
      const mountains=generateBaseTerrain({...opts,mountainLevel:2}).height;
      expect(Math.max(...mountains)).toBeGreaterThan(Math.max(...flat));
    }
  });
  it('mixto genera regiones variables y biomas fríos, secos y tropicales reproducibles', () => {
    const world=new World(new THREE.Scene(),{size:64});
    try {
      world.generate({seed:7249,climate:'mixto',mountainLevel:0});
      const climates=new Set(), biomes=new Set();
      for(let z=0;z<=64;z++)for(let x=0;x<=64;x++) {
        if(world.isWater(x,z))continue;
        climates.add(world.climateAt(x,z));
        biomes.add(BIOME_IDS[world.biome[world.idx(x,z)]]);
        expect(world.climateAt(x,z)).toBe(regionalClimate(x,z,64,7249));
      }
      expect(climates.size).toBe(4);
      expect(biomes.has('tundra')).toBe(true);
      expect(biomes.has('desert')).toBe(true);
      expect(biomes.has('jungle')).toBe(true);
      expect(world.serialize().climate).toBe('mixto');
      // Regresión: _buildClimateOverlay() nunca asignaba un atributo 'normal' a la malla de
      // hielo/lava, pero usa MeshStandardMaterial (material iluminado) — sin normales, WebGL usa
      // el valor por defecto del atributo (0,0,0), y normalize(vec3(0,0,0)) en el shader de
      // iluminación es NaN. Ese NaN por píxel se contagiaba a los píxeles vecinos en cada pasada
      // de desenfoque gaussiano de UnrealBloomPass (5 niveles), lo que en la práctica dejaba toda
      // la pantalla en negro con clima 'mixto' + Bloom activado (el ajuste por defecto) en cuanto
      // la región ártica generaba agua helada — reproducido en vivo tanto en GPU discreta
      // (advertencias WebGL "Framebuffer is incomplete: Attachment has zero size") como en
      // gráficos integrados Intel (FPS colapsando a ~13-14 con picos de hasta 1000+ ms). Nunca
      // ocurría con un clima uniforme porque `this.ice` nunca tenía ninguna celda activa.
      // Climate provinces no longer guarantee that this seed puts snow on the coast.
      // Explicitly freeze a water cell to retain the ice-normal rendering regression.
      world.height[0] = 1; world.temperature[0] = -12; world._classifyBiome(0,0);
      world.buildClimateOverlays();
      const iceGeo = world.iceMesh.geometry;
      expect(iceGeo.attributes.position.count).toBeGreaterThan(0); // esta semilla sí genera hielo
      expect(iceGeo.attributes.normal).toBeTruthy();
      const normals = iceGeo.attributes.normal.array;
      expect(normals.length).toBe(iceGeo.attributes.position.array.length);
      for (let i = 0; i < normals.length; i++) expect(Number.isFinite(normals[i])).toBe(true);
    }finally{world.dispose();}
  });
  it('vegetación densa produce más árboles que escasa', () => {
    const counts=[];
    for(const humidity of ['arido','normal','exuberante']) {
      const world=new World(new THREE.Scene(),{size:64});
      try {world.generate({seed:7249,humidity,mountainLevel:0});counts.push(world.treeState.reduce((sum,v)=>sum+(v>0?1:0),0));}finally{world.dispose();}
    }
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[1]);
  });
});
