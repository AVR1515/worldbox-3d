import { generateBaseTerrain } from './world-generation.js';

self.onmessage = event => {
  try {
    const result = generateBaseTerrain(event.data);
    self.postMessage(result, [result.height.buffer, result.moisture.buffer, result.jitter.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
