import * as THREE from 'three';
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { fitGeometryToHeight } from './core/gltf-utils.js';

const loader = new GLTFLoader();
const cache = new Map();
export const TREE_ASSETS = {
  round: { file: 'tree_001', height: 3.2 },
  pine: { file: 'fir_001', height: 3.8 },
  dry: { file: 'tree_001', height: 2.7 },
};
export function loadEnvironmentMesh(url, height) {
  if (typeof document === 'undefined' || !document.baseURI) return Promise.resolve(null);
  const key = `${url}:${height}`;
  if (!cache.has(key)) cache.set(key, loader.loadAsync(url).then(gltf => {
    let source;
    gltf.scene.traverse(node => { if (!source && node.isMesh) source = node; });
    if (!source) throw new Error(`Modelo sin malla: ${url}`);
    const geometry = fitGeometryToHeight(source, height);
    const material = (Array.isArray(source.material) ? source.material[0] : source.material).clone();
    material.roughness = 0.88;
    material.metalness = 0;
    if (material.map) material.map.anisotropy = 4;
    return { geometry, material };
  }).catch(error => { console.warn(`No se pudo cargar ${url}; se conserva el modelo básico.`, error); return null; }));
  return cache.get(key);
}

export function addVegetationWind(material, time, strength, height) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uWindTime = time;
    shader.uniforms.uWindStrength = strength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform float uWindStrength;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 anchor = vec3(0.0);
        #ifdef USE_INSTANCING
          anchor = instanceMatrix[3].xyz;
        #endif
        float tip = clamp(position.y / ${height.toFixed(4)}, 0.0, 1.0);
        transformed.x += sin(uWindTime * 1.7 + anchor.x * 0.8 + anchor.z * 0.5) * tip * tip * uWindStrength * ${ (height * 0.035).toFixed(4) };
      `);
  };
  material.customProgramCacheKey = () => `vegetation-wind-${height}`;
}
