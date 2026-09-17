import { it, expect } from 'vitest';
import { DynamicResolution } from '../../js/dynamic-resolution.js';
import { resolveGraphics } from '../../js/graphics-config.js';

it('respects explicit resolution and lets the user opt in or out', () => {
  expect(resolveGraphics().dynamicResolution).toBe(true);
  expect(resolveGraphics({ resolution: '1' }).dynamicResolution).toBe(false);
  expect(resolveGraphics({ dynamicResolution: 'off' }).dynamicResolution).toBe(false);
  expect(resolveGraphics({ resolution: '1', dynamicResolution: 'on' }).dynamicResolution).toBe(true);
});
it('ignores loading stalls, stays bounded and recovers slowly without oscillating', () => {
  const controller = new DynamicResolution();
  for (let i = 0; i < 100; i++) controller.sample(5);
  expect(controller.scale).toBe(1);
  for (let i = 0; i < 1000; i++) controller.sample(.08);
  expect(controller.scale).toBe(.5);
  for (let i = 0; i < 1000; i++) controller.sample(1 / 30);
  expect(controller.scale).toBe(.5);
  for (let i = 0; i < 5000; i++) controller.sample(1 / 60);
  expect(controller.scale).toBe(1);
  controller.reset(); expect(controller.averageMs).toBe(null);
});
