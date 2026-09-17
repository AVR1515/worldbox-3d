import * as THREE from 'three';

// Both shader stages use the same waves; fragment normals retain small ripples
// even where the horizon mesh is coarse. Opaque water hides the finite seabed.
const COMMON = `
uniform float uTime;
uniform float uWaterQuality;
uniform float uWorldSize;
uniform sampler2D uSeabed;
varying vec2 vWaterXZ;
float waterDepth(vec2 p) {
  vec2 uv = (p + uWorldSize * 0.5 + 0.5) / (uWorldSize + 1.0);
  float inside = 1.0 - smoothstep(uWorldSize * 0.5 - 4.0, uWorldSize * 0.5 - 0.5, max(abs(p.x), abs(p.y)));
  return mix(12.0, 5.0 - texture2D(uSeabed, uv).r * 17.0, inside);
}
float oceanWave(vec2 p) {
  #if OCEAN_QUALITY == 0
    return 0.0;
  #else
  p += vec2(sin(p.y * 0.075), sin(p.x * 0.09)) * 1.4;
  float waves = sin(dot(p, vec2(0.48, 0.22)) - uTime * 1.35) * 0.095
    + sin(dot(p, vec2(-0.26, 0.63)) - uTime * 1.05) * 0.055;
  #if OCEAN_QUALITY >= 3
  waves += sin(dot(p, vec2(1.25, 0.9)) - uTime * 2.1) * 0.018
    * (1.0 - smoothstep(35.0, 130.0, length(cameraPosition.xz - p)));
  #endif
  return waves;
  #endif
}
// Analytic derivative of oceanWave, including its domain warp and distance fade.
// Replaces four complete wave evaluations for every water pixel.
vec2 oceanGradient(vec2 p) {
  #if OCEAN_QUALITY == 0
    return vec2(0.0);
  #else
    vec2 q = p + vec2(sin(p.y * 0.075), sin(p.x * 0.09)) * 1.4;
    vec2 gradient = cos(dot(q, vec2(0.48, 0.22)) - uTime * 1.35) * 0.095 * vec2(0.48, 0.22)
      + cos(dot(q, vec2(-0.26, 0.63)) - uTime * 1.05) * 0.055 * vec2(-0.26, 0.63);
    #if OCEAN_QUALITY >= 3
      vec2 offset = q - cameraPosition.xz;
      float distanceToCamera = length(offset);
      float t = clamp((distanceToCamera - 35.0) / 95.0, 0.0, 1.0);
      float fade = 1.0 - t * t * (3.0 - 2.0 * t);
      vec2 fadeGradient = -6.0 * t * (1.0 - t) / 95.0 * offset / max(distanceToCamera, 0.001);
      float phase = dot(q, vec2(1.25, 0.9)) - uTime * 2.1;
      gradient += 0.018 * (cos(phase) * vec2(1.25, 0.9) * fade + sin(phase) * fadeGradient);
    #endif
    return vec2(gradient.x + gradient.y * cos(p.x * 0.09) * 0.126,
      gradient.y + gradient.x * cos(p.y * 0.075) * 0.105);
  #endif
}
`;

export function createOceanMaterial(world) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x247b9d, roughness: 0.26, metalness: 0.05,
    clearcoat: 0.4, clearcoatRoughness: 0.22, envMapIntensity: 0.75,
    side: THREE.DoubleSide,
  });
  material.defines = { OCEAN_QUALITY: world.graphics.water };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uTime: world._waterTimeUniform,
      uWaterQuality: world._waterQualityUniform,
      uWorldSize: { value: world.size },
      uSeabed: { value: world._seabedTexture },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWaterXZ = position.xz;
        transformed.y += oceanWave(position.xz) * smoothstep(0.0, 1.5, waterDepth(position.xz));
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float depth = waterDepth(vWaterXZ);
        float shallow = 1.0 - smoothstep(0.0, 3.8, depth);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.39, 0.36), shallow * 0.55);
        #if OCEAN_QUALITY >= 2
        float breakup = sin(vWaterXZ.x * 9.0 + sin(vWaterXZ.y * 5.0)) * sin(vWaterXZ.y * 11.0 - uTime);
        float wash = sin(depth * 10.0 - uTime * 2.2 + sin(vWaterXZ.x * 0.9 + vWaterXZ.y * 0.7));
        float foam = (1.0 - smoothstep(0.05, 0.85, depth)) * smoothstep(-0.1, 0.45, wash + breakup * 0.35);
        foam *= step(-0.15, depth) * step(1.5, uWaterQuality);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.92, 0.88), foam * 0.88);
        #endif
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 p = vWaterXZ;
        float attenuation = smoothstep(0.0, 1.5, depth);
        vec2 gradient = oceanGradient(p);
        float ripple = 0.0;
        #if OCEAN_QUALITY >= 2
        ripple = sin(p.x * 5.1 + p.y * 3.7 - uTime * 2.0) * 0.018
          * (1.0 - smoothstep(15.0, 55.0, length(cameraPosition.xz - p)));
        #endif
        normal = normalize(mat3(viewMatrix) * vec3((-gradient.x + ripple) * attenuation, 1.0, (-gradient.y + ripple) * attenuation));
      `);
  };
  return material;
}

export function updateSeabed(world) {
  const length = world.n * 4;
  if (!world._seabedTexture || world._seabedTexture.image.data.length !== length) {
    world._seabedTexture?.dispose();
    world._seabedTexture = new THREE.DataTexture(new Uint8Array(length), world.verts, world.verts);
    world._seabedTexture.minFilter = world._seabedTexture.magFilter = THREE.LinearFilter;
    world._seabedTexture.generateMipmaps = false;
  }
  const pixels = world._seabedTexture.image.data;
  for (let i = 0; i < world.n; i++) {
    pixels[i * 4] = Math.round(THREE.MathUtils.clamp(world.height[i] / 17, 0, 1) * 255);
    pixels[i * 4 + 3] = 255;
  }
  world._seabedTexture.needsUpdate = true;
}
