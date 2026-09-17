import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInspectionPanel } from '../../js/ui-inspect.js';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) {
      const classes = new Set(['hidden']);
      nodes.set(id, { innerHTML: '', listeners: {}, classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) }, addEventListener(name, fn) { this.listeners[name] = fn; } });
    }
    return nodes.get(id);
  };
  vi.stubGlobal('document', { getElementById: element });
  const c = { id: 1, type: 'human', name: '<img src=x onerror=alert(1)>', alive: true, age: 8, health: 90, maxHealth: 100, hunger: 20 };
  const creatures = { creatures: [c] };
  const settlements = { settlements: [], empires: [] };
  let following = null;
  const panel = createInspectionPanel({ getCreatures: () => creatures, getSettlements: () => settlements, getCivilization: () => null, getStatuses: () => null, getFollowing: () => following, setFollowing: value => { following = value; }, toast: vi.fn(), editName: vi.fn() });
  return { panel, element, c, creatures, settlements, following: () => following };
}
describe('inspector', () => {
  it('escapa nombres importados y permite seguir y dejar de seguir', () => {
    const f = fixture(); f.panel.showCreatureInspect(f.c);
    expect(f.element('inspectPanel').innerHTML).toContain('&lt;img');
    expect(f.element('inspectPanel').innerHTML).not.toContain('<img');
    f.element('favoriteBtn').listeners.click();
    expect(f.following()).toBe(f.c);
    f.element('favoriteBtn').listeners.click();
    expect(f.following()).toBeNull();
  });
  it('actualiza estadísticas y se cierra cuando muere la criatura', () => {
    const f = fixture(); f.panel.showCreatureInspect(f.c);
    f.c.health = 25; f.panel.refreshIfOpen();
    expect(f.element('inspectPanel').innerHTML).toContain('width:25%');
    f.c.alive = false; f.panel.refreshIfOpen();
    expect(f.element('inspectPanel').classList.contains('hidden')).toBe(true);
  });
  it('escapa una ciudad y cierra el panel cuando desaparece', () => {
    const f = fixture();
    const s = { id: 2, name: '<script>alert(1)</script>', level: 0, pop: 0, houses: [], resources: {} };
    f.settlements.settlements.push(s); f.panel.showSettlementInspect(s);
    expect(f.element('inspectPanel').innerHTML).not.toContain('<script>');
    f.settlements.settlements.length = 0; f.panel.refreshIfOpen();
    expect(f.element('inspectPanel').classList.contains('hidden')).toBe(true);
  });
});
