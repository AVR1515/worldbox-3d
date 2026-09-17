// Visual settings never change simulation density, resources or creature sizes.
export const GRAPHICS_PRESETS = Object.freeze({
  low: { resolution: 0.75, shadowSize: 512, vegetation: 0.25, water: 0, viewDistance: 0.8, bloom: false, antialias: false, ambientOcclusion: false, wind: false },
  medium: { resolution: 1, shadowSize: 1024, vegetation: 0.5, water: 1, viewDistance: 1, bloom: false, antialias: true, ambientOcclusion: false, wind: true },
  high: { resolution: 1, shadowSize: 2048, vegetation: 0.8, water: 2, viewDistance: 1.25, bloom: true, antialias: true, ambientOcclusion: false, wind: true },
  ultra: { resolution: 1.25, shadowSize: 4096, vegetation: 1, water: 3, viewDistance: 1.6, bloom: true, antialias: true, ambientOcclusion: true, wind: true },
});
export const GRAPHICS_OPTIONS = Object.freeze({
  resolution: { '0.75': 0.75, '1': 1, '1.25': 1.25, '1.5': 1.5 },
  shadowSize: { '512': 512, '1024': 1024, '2048': 2048, '4096': 4096 },
  vegetation: { sparse: 0.25, normal: 0.5, dense: 0.8, lush: 1 },
  water: { basic: 0, waves: 1, foam: 2, ultra: 3 },
  viewDistance: { near: 0.8, normal: 1, far: 1.25, ultra: 1.6 },
});
export function resolveGraphics(settings = {}) {
  const quality = Object.hasOwn(GRAPHICS_PRESETS, settings.quality) ? settings.quality : 'high';
  const result = { quality, ...GRAPHICS_PRESETS[quality], ambientOcclusionResolution: 0.5 };
  if (['0.5', '1'].includes(String(settings.ambientOcclusionResolution))) result.ambientOcclusionResolution = Number(settings.ambientOcclusionResolution);
  for (const [key, values] of Object.entries(GRAPHICS_OPTIONS)) {
    if (Object.hasOwn(values, settings[key])) result[key] = values[settings[key]];
  }
  for (const key of ['bloom', 'antialias', 'ambientOcclusion', 'wind']) {
    if (settings[key] === 'on' || settings[key] === true) result[key] = true;
    if (settings[key] === 'off' || settings[key] === false) result[key] = false;
  }
  // An explicit percentage stays fixed unless automatic adjustment is explicitly enabled.
  result.dynamicResolution = settings.dynamicResolution === 'on' || settings.dynamicResolution === true ||
    ((settings.dynamicResolution == null || settings.dynamicResolution === 'auto') &&
      !Object.hasOwn(GRAPHICS_OPTIONS.resolution, settings.resolution));
  if (settings.reducedMotion) result.wind = false;
  return result;
}
