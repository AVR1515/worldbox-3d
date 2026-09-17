import { it, expect, vi } from 'vitest';
import { GpuTimer } from '../../js/gpu-timer.js';

it('bounds asynchronous queries and discards disjoint measurements', () => {
  const gl = { getExtension: () => ({ GPU_DISJOINT_EXT: 1, TIME_ELAPSED_EXT: 2 }), createQuery: () => ({}),
    getParameter: vi.fn(() => false), getQueryParameter: vi.fn(() => false), beginQuery: vi.fn(), endQuery: vi.fn(), deleteQuery: vi.fn(),
    QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4 };
  const timer = new GpuTimer(gl);
  for (let i = 0; i < 20; i++) { timer.begin(); timer.end(); }
  expect(timer.pending).toHaveLength(4); expect(gl.beginQuery).toHaveBeenCalledTimes(4);
  gl.getQueryParameter.mockImplementation((q, kind) => kind === 3 ? true : 12500000);
  timer.begin(); timer.end(); expect(timer.lastMs).toBe(12.5);
  gl.getParameter.mockReturnValue(true); timer.begin();
  expect(timer.lastMs).toBe(null); expect(timer.pending).toHaveLength(0);
});
it('does nothing when GPU queries are unavailable', () => {
  const timer = new GpuTimer({}); timer.begin(); timer.end(); timer.clear();
  expect(timer.lastMs).toBe(null);
});
