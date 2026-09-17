import * as THREE from 'three';

// Sample the same b-c triangle split as World.heightAtWorld, at every blade vertex.
export function groundGrassMaterial(material, world) {
  const previous = material.onBeforeCompile;
  const texture = new THREE.DataTexture(world.height, world.verts, world.verts, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  material.onBeforeCompile = shader => {
    previous(shader);
    shader.uniforms.uGrassGround = { value: texture };
    shader.uniforms.uGrassGrid = { value: world.verts };
    shader.uniforms.uGrassHalf = { value: world.half };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform sampler2D uGrassGround;
      uniform float uGrassGrid;
      uniform float uGrassHalf;
      float grassHeight(vec2 p) {
        vec2 cell = clamp(p + uGrassHalf, vec2(0.0), vec2(uGrassGrid - 1.0001));
        vec2 base = floor(cell), f = fract(cell);
        float a = texture2D(uGrassGround, (base + vec2(.5,.5))/uGrassGrid).r;
        float b = texture2D(uGrassGround, (base + vec2(1.5,.5))/uGrassGrid).r;
        float c = texture2D(uGrassGround, (base + vec2(.5,1.5))/uGrassGrid).r;
        float d = texture2D(uGrassGround, (base + vec2(1.5,1.5))/uGrassGrid).r;
        return f.x+f.y <= 1.0 ? a+(b-a)*f.x+(c-a)*f.y : b*(1.0-f.y)+c*(1.0-f.x)+d*(f.x+f.y-1.0);
      }`);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      #ifdef USE_INSTANCING
        vec3 groundPoint = (instanceMatrix * vec4(transformed, 1.0)).xyz;
        transformed.y = position.y + (grassHeight(groundPoint.xz) - .008 - instanceMatrix[3].y) / instanceMatrix[1].y;
      #endif
      #include <project_vertex>`);
  };
  material.customProgramCacheKey = () => 'grass-ground-conforming-v1';
  return texture;
}

export function lowestSupport(world, x, z, radius) {
  let h = world.heightAtWorld(x,z);
  for (let i=0;i<8;i++) {
    const a=i*Math.PI/4;
    h=Math.min(h, world.heightAtWorld(x+Math.cos(a)*radius,z+Math.sin(a)*radius));
  }
  return h;
}
