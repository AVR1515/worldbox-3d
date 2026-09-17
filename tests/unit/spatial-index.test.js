import { describe, expect, it } from 'vitest';
import { SpatialIndex } from '../../js/core/spatial-index.js';

describe('SpatialIndex', () => {
  it('queryRadius encuentra los puntos dentro del radio y descarta los de fuera', () => {
    const index = new SpatialIndex(8);
    index.rebuild([{ x: 0, z: 0, id: 'a' }, { x: 3, z: 0, id: 'b' }, { x: 50, z: 50, id: 'c' }]);
    const found = index.queryRadius(0, 0, 5).map(p => p.id).sort();
    expect(found).toEqual(['a', 'b']);
  });

  it('nearest() devuelve el punto más cercano que cumple el predicado', () => {
    const index = new SpatialIndex(8);
    index.rebuild([{ x: 1, z: 0, id: 'near' }, { x: 4, z: 0, id: 'far' }]);
    expect(index.nearest(0, 0, 10)?.id).toBe('near');
    expect(index.nearest(0, 0, 10, p => p.id === 'far')?.id).toBe('far');
  });

  // Regresión: un radio Infinity (usado por CreatureManager.nearestOfType() para "el humano más
  // cercano en cualquier punto del mapa" — ver "Vista humana" en js/main.js) hacía que
  // queryRadius() calculara un rango de celdas de -Infinity a Infinity y colgara la pestaña entera
  // en un bucle que nunca termina (confirmado en vivo: hasta un `Runtime.evaluate` trivial dejaba
  // de responder). Cualquier radio no finito debe recorrer solo las celdas que existen, nunca un
  // rango de celdas calculado a partir del propio radio.
  it('un radio Infinity recorre todo el índice en vez de colgarse', () => {
    const index = new SpatialIndex(8);
    index.rebuild([{ x: 0, z: 0, id: 'a' }, { x: 500, z: -500, id: 'b' }, { x: -3000, z: 3000, id: 'c' }]);
    const found = index.queryRadius(0, 0, Infinity).map(p => p.id).sort();
    expect(found).toEqual(['a', 'b', 'c']);
    expect(index.nearest(1000, -1000, Infinity)?.id).toBe('b');
  });
});
