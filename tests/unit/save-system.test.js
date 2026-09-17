import { describe, expect, it } from 'vitest';
import {
  LEGACY_SAVE_KEYS,
  SAVE_BACKUP_KEY,
  SAVE_FORMAT_VERSION,
  SAVE_STORAGE_KEY,
  AsyncSaveRepository,
  SaveRepository,
  encodeSnapshotForStorage,
  migrateSaveSnapshot,
  validateSaveSnapshot,
} from '../../js/save-system.js';

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function snapshot(version = SAVE_FORMAT_VERSION) {
  const size = 32;
  return {
    version,
    ...(version === SAVE_FORMAT_VERSION ? { schema: { name: 'worldbox3d', version } } : {}),
    world: { size, height: Array((size + 1) ** 2).fill(0), moisture: Array((size + 1) ** 2).fill(0.5) },
    creatures: { creatures: [] },
    settlements: { settlements: [] },
    ...(version === SAVE_FORMAT_VERSION ? { ships: { version: 1, timer: 18, ships: [] } } : {}),
    ...(version === SAVE_FORMAT_VERSION ? { civilization: { version: 2, people: [], clans: [], productionSites: [], armies: [], communities: [], cultures: [], languages: [], religions: [] } } : {}),
  };
}

// Simulates a browser storage quota: setItem() throws (like a real QuotaExceededError) once the
// combined size of everything stored would exceed `limit`, and only that call - no partial write.
class QuotaStorage {
  constructor(limit, initial = {}) {
    this.limit = limit;
    this.values = new Map(Object.entries(initial));
  }
  _size() { let total = 0; for (const value of this.values.values()) total += value.length; return total; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    const next = String(value);
    const projected = this._size() - (this.values.get(key)?.length || 0) + next.length;
    if (projected > this.limit) { const error = new Error('QuotaExceededError'); error.name = 'QuotaExceededError'; throw error; }
    this.values.set(key, next);
  }
  removeItem(key) { this.values.delete(key); }
}

class MemoryAsyncBackend {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  async read(key) { return this.values.get(key) ?? null; }
  async commit(serialized, { backupCurrent = true } = {}) {
    if (backupCurrent && this.values.has('current')) this.values.set('backup', this.values.get('current'));
    this.values.set('current', serialized);
  }
  async write(key, value) { this.values.set(key, value); }
  async remove(key) { this.values.delete(key); }
  async list(prefix = '') { return [...this.values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })); }
}

describe('migraciones de guardado', () => {
  it('conserva pasajeros embarcados cuando la versión antigua ya guarda barcos', () => {
    const legacy = snapshot(7);
    legacy.creatures.creatures = [{ id: 4, sailing: true }];
    legacy.ships = { ships: [{ crewIds: [4] }] };
    expect(migrateSaveSnapshot(legacy).creatures.creatures[0].sailing).toBe(true);
  });

  it('rechaza matrices opcionales truncadas y valores no finitos antes de guardar', () => {
    const invalid = snapshot();
    invalid.world.moisture = [0];
    expect(() => validateSaveSnapshot(invalid)).toThrow(/terreno incompleto/i);
    invalid.world.moisture = snapshot().world.moisture;
    invalid.world.height[4] = NaN;
    expect(() => validateSaveSnapshot(invalid)).toThrow(/inválidos/i);
  });
  it('migra un guardado v1 al formato actual sin perder los datos', () => {
    const legacy = snapshot(1);
    legacy.world.seed = 4242;

    const migrated = migrateSaveSnapshot(legacy);

    expect(migrated.version).toBe(SAVE_FORMAT_VERSION);
    expect(migrated.schema).toMatchObject({ version: SAVE_FORMAT_VERSION, migratedFrom: 1 });
    expect(migrated.world.seed).toBe(4242);
    expect(validateSaveSnapshot(migrated)).toBe(migrated);
  });

  it('recupera pasajeros huérfanos al migrar un guardado sin barcos', () => {
    const legacy = snapshot(2);
    legacy.creatures.creatures.push({ id: 8, type: 'human', sailing: true });

    const migrated = migrateSaveSnapshot(legacy);

    expect(migrated.creatures.creatures[0].sailing).toBe(false);
    expect(migrated.ships).toEqual({ version: 1, timer: 18, ships: [] });
  });

  it('migra la fase 2 conservando sus expediciones', () => {
    const legacy = snapshot(3);
    legacy.ships = { version: 1, timer: 7, ships: [{ crewIds: [4] }] };
    const migrated = migrateSaveSnapshot(legacy);
    expect(migrated.schema).toMatchObject({ version: SAVE_FORMAT_VERSION, migratedFrom: 3 });
    expect(migrated.ships).toEqual(legacy.ships);
  });

  it('migra la fase 3 agregando el sistema de civilización sin perder el mundo', () => {
    const legacy = snapshot(4);
    legacy.world.seed = 9876;

    const migrated = migrateSaveSnapshot(legacy);

    expect(migrated.schema).toMatchObject({ version: SAVE_FORMAT_VERSION, migratedFrom: 4 });
    expect(migrated.world.seed).toBe(9876);
    expect(migrated.civilization).toEqual({ version: 1, people: [], clans: [], productionSites: [], armies: [] });
  });

  it('migra la fase 4 conservando genealogías y preparando la evolución social', () => {
    const legacy = snapshot(5);
    legacy.civilization = { version: 1, people: [{ creatureId: 3, generation: 2 }], clans: [], productionSites: [], armies: [] };

    const migrated = migrateSaveSnapshot(legacy);

    expect(migrated.schema).toMatchObject({ version: SAVE_FORMAT_VERSION, migratedFrom: 5 });
    expect(migrated.civilization.people[0]).toMatchObject({ creatureId: 3, generation: 2 });
  });

  it('rechaza versiones futuras que todavía no puede interpretar', () => {
    expect(() => migrateSaveSnapshot({ version: 99 })).toThrow(/no compatible/i);
    expect(() => migrateSaveSnapshot({ version: 2.5 })).toThrow(/no compatible/i);
  });

  it('rechaza terreno truncado', () => {
    const invalid = snapshot();
    invalid.world.height.pop();
    expect(() => validateSaveSnapshot(invalid)).toThrow(/terreno incompleto/i);
  });
});

describe('repositorio IndexedDB', () => {
  it('devuelve el respaldo válido aunque no pueda reparar el almacén', async () => {
    const backend = new MemoryAsyncBackend({ current: '{roto', backup: JSON.stringify(snapshot()) });
    backend.commit = async () => { throw new Error('Cuota agotada'); };
    const repository = new AsyncSaveRepository(backend);
    expect(await repository.load()).toMatchObject({ version: SAVE_FORMAT_VERSION });
    expect(repository.lastError?.message).toBe('Cuota agotada');
  });

  it('recupera el último guardado local tras fallar IndexedDB incluso al reiniciar', async () => {
    const old = snapshot(); old.savedAt = 10;
    const latest = snapshot(); latest.savedAt = 20;
    const backend = new MemoryAsyncBackend({ current: JSON.stringify(old) });
    backend.commit = async () => { throw new Error('Cuota agotada'); };
    const local = new SaveRepository(new MemoryStorage());
    await new AsyncSaveRepository(backend, local).save(latest);
    const reopened = new AsyncSaveRepository(backend, local);
    expect((await reopened.load()).savedAt).toBe(20);
  });

  it('consultar la existencia no repara ni escribe el guardado', async () => {
    const backend = new MemoryAsyncBackend({ backup: JSON.stringify(snapshot()) });
    const repository = new AsyncSaveRepository(backend);
    expect(await repository.hasSave()).toBe(true);
    expect(backend.values.has('current')).toBe(false);
  });
  it('administra ranuras independientes e importables', async () => {
    const backend = new MemoryAsyncBackend();
    const repository = new AsyncSaveRepository(backend);
    const original = snapshot(); original.savedAt = 42;
    await repository.saveSlot('1', original, { name: 'Mi mundo', thumbnail: 'data:image/jpeg;base64,AA==' });
    expect(await repository.listSlots()).toEqual([expect.objectContaining({ id: '1', name: 'Mi mundo', savedAt: 42 })]);
    expect((await repository.loadSlot('1')).world.size).toBe(32);
    const exported = await repository.exportSlot('1');
    await repository.importSlot('2', exported, { name: 'Copia' });
    expect((await repository.listSlots()).map(slot => slot.id)).toEqual(['1', '2']);
    await repository.deleteSlot('1');
    expect((await repository.listSlots()).map(slot => slot.id)).toEqual(['2']);
  });
  it('actualiza en el propio almacén un guardado de la fase 4', async () => {
    const legacy = snapshot(5);
    legacy.civilization = { version: 1, people: [], clans: [], productionSites: [], armies: [] };
    const backend = new MemoryAsyncBackend({ current: JSON.stringify(legacy) });
    const repository = new AsyncSaveRepository(backend);

    const loaded = await repository.load();

    expect(loaded.version).toBe(SAVE_FORMAT_VERSION);
    expect(JSON.parse(backend.values.get('current')).version).toBe(SAVE_FORMAT_VERSION);
  });

  it('migra el guardado local al almacén asíncrono y limpia las claves antiguas', async () => {
    const storage = new MemoryStorage({ [LEGACY_SAVE_KEYS[0]]: JSON.stringify(snapshot(2)) });
    const legacyRepository = new SaveRepository(storage);
    const backend = new MemoryAsyncBackend();
    const repository = new AsyncSaveRepository(backend, legacyRepository);

    const loaded = await repository.load();

    expect(loaded.version).toBe(SAVE_FORMAT_VERSION);
    expect(backend.values.has('current')).toBe(true);
    expect(storage.getItem(LEGACY_SAVE_KEYS[0])).toBeNull();
  });

  it('conserva y recupera una copia anterior de forma asíncrona', async () => {
    const backend = new MemoryAsyncBackend();
    const repository = new AsyncSaveRepository(backend);
    const first = snapshot(); first.savedAt = 1;
    const second = snapshot(); second.savedAt = 2;

    await repository.save(first);
    await repository.save(second);
    backend.values.set('current', '{dañado');

    const recovered = await repository.load();
    expect(recovered.savedAt).toBe(1);
    expect(JSON.parse(backend.values.get('current')).savedAt).toBe(1);
  });
});

describe('repositorio de guardado', () => {
  it('reparar el principal no sustituye el respaldo por JSON corrupto', () => {
    const storage = new MemoryStorage({ [SAVE_STORAGE_KEY]: '{roto', [SAVE_BACKUP_KEY]: JSON.stringify(snapshot()) });
    const repository = new SaveRepository(storage);
    repository.load();
    expect(JSON.parse(storage.getItem(SAVE_BACKUP_KEY)).version).toBe(SAVE_FORMAT_VERSION);
  });
  it('encuentra el formato antiguo y lo repara en la clave actual', () => {
    const storage = new MemoryStorage({ [LEGACY_SAVE_KEYS[0]]: JSON.stringify(snapshot(1)) });
    const repository = new SaveRepository(storage);

    const loaded = repository.load();

    expect(loaded.version).toBe(SAVE_FORMAT_VERSION);
    expect(JSON.parse(storage.getItem(SAVE_STORAGE_KEY)).version).toBe(SAVE_FORMAT_VERSION);
    expect(storage.getItem(LEGACY_SAVE_KEYS[0])).toBeNull();
  });

  it('recupera la copia anterior cuando el guardado principal está dañado', () => {
    const storage = new MemoryStorage({
      [SAVE_STORAGE_KEY]: '{incompleto',
      [SAVE_BACKUP_KEY]: JSON.stringify(snapshot()),
    });
    const repository = new SaveRepository(storage);

    expect(repository.load()).toMatchObject({ version: SAVE_FORMAT_VERSION });
    expect(JSON.parse(storage.getItem(SAVE_STORAGE_KEY)).version).toBe(SAVE_FORMAT_VERSION);
  });

  it('conserva una copia de seguridad al reemplazar un guardado', () => {
    const first = snapshot();
    first.savedAt = 1;
    const second = snapshot();
    second.savedAt = 2;
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage);

    repository.save(first);
    repository.save(second);

    expect(JSON.parse(storage.getItem(SAVE_STORAGE_KEY)).savedAt).toBe(2);
    expect(JSON.parse(storage.getItem(SAVE_BACKUP_KEY)).savedAt).toBe(1);
  });

  it('compacta el terreno al guardar y lo expande al cargar', () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage);
    const original = snapshot();
    original.world.height[3] = 12.5;

    repository.save(original);
    const stored = JSON.parse(storage.getItem(SAVE_STORAGE_KEY));

    expect(stored.schema.encoding).toBe('base64-typed-arrays');
    expect(stored.world.height).toMatchObject({ encoding: 'f32-base64' });
    expect(repository.load().world.height[3]).toBe(12.5);
  });
});

describe('cuota de almacenamiento agotada', () => {
  it('conserva la única partida antigua si la nueva no cabe ni liberando espacio', () => {
    const old = JSON.stringify(snapshot(2));
    const storage = new QuotaStorage(old.length + 10, { [LEGACY_SAVE_KEYS[0]]: old });
    const repository = new SaveRepository(storage);
    const next = snapshot(); next.history = ['x'.repeat(old.length * 3)];
    expect(() => repository.save(next)).toThrow();
    expect(storage.getItem(LEGACY_SAVE_KEYS[0])).toBe(old);
    expect(repository.load({ repair: false })).toBeTruthy();
  });
  it('libera la copia de seguridad y las claves antiguas y reintenta cuando setItem() falla', () => {
    const serializedLength = JSON.stringify(encodeSnapshotForStorage(validateSaveSnapshot(migrateSaveSnapshot(snapshot())))).length;
    const dummyLegacyBlob = 'x'.repeat(serializedLength);
    // Room for the real save alone, but not for it plus the legacy dummy blob still sitting there
    // — the first attempt must fail, and only succeed once the legacy key (and backup, harmlessly)
    // are freed.
    const storage = new QuotaStorage(serializedLength + 5, { [LEGACY_SAVE_KEYS[0]]: dummyLegacyBlob });
    const repository = new SaveRepository(storage);

    expect(() => repository.save(snapshot())).not.toThrow();
    expect(JSON.parse(storage.getItem(SAVE_STORAGE_KEY)).version).toBe(SAVE_FORMAT_VERSION);
    expect(storage.getItem(LEGACY_SAVE_KEYS[0])).toBeNull(); // se liberó para hacer sitio
  });

  it('restaura el valor anterior y relanza el error si ni siquiera liberando espacio cabe el guardado', () => {
    const storage = new QuotaStorage(5); // ni el guardado más pequeño cabe aquí
    const repository = new SaveRepository(storage);

    expect(() => repository.save(snapshot())).toThrow();
    expect(storage.getItem(SAVE_STORAGE_KEY)).toBeNull(); // nunca llegó a escribirse
  });

  it('AsyncSaveRepository cae a localStorage cuando IndexedDB rechaza el commit', async () => {
    const backend = { read: async () => null, commit: async () => { throw new Error('IndexedDB lleno'); } };
    const legacyStorage = new MemoryStorage();
    const legacyRepository = new SaveRepository(legacyStorage);
    const repository = new AsyncSaveRepository(backend, legacyRepository);

    const saved = await repository.save(snapshot());

    expect(saved.version).toBe(SAVE_FORMAT_VERSION);
    expect(repository.storageKind).toBe('localstorage');
    expect(repository.lastError).toBeInstanceOf(Error);
    expect(JSON.parse(legacyStorage.getItem(SAVE_STORAGE_KEY)).version).toBe(SAVE_FORMAT_VERSION);
  });

  it('AsyncSaveRepository relanza el error si tampoco hay repositorio local de respaldo', async () => {
    const backend = { read: async () => null, commit: async () => { throw new Error('IndexedDB lleno'); } };
    const repository = new AsyncSaveRepository(backend, null);

    await expect(repository.save(snapshot())).rejects.toThrow('IndexedDB lleno');
  });
});
