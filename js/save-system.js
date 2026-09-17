export const SAVE_FORMAT_VERSION = 8;
export const SAVE_STORAGE_KEY = 'worldbox3d.save.v8';
export const LEGACY_SAVE_KEYS = Object.freeze(['worldbox3d.save.v7', 'worldbox3d.save.v6', 'worldbox3d.save.v5', 'worldbox3d.save.v4', 'worldbox3d.save.v3', 'worldbox3d.save.v2', 'worldbox3d.save.v1']);
export const SAVE_BACKUP_KEY = `${SAVE_STORAGE_KEY}.backup`;
export const SAVE_PENDING_KEY = `${SAVE_STORAGE_KEY}.pending`;
export const SAVE_DATABASE_NAME = 'worldbox3d';
export const SAVE_DATABASE_STORE = 'saves';

const PACKED_WORLD_ARRAYS = Object.freeze({
  height: 'f32',
  moisture: 'f32',
  jitter: 'f32',
  riverHeight: 'f32',
  treeState: 'u8',
  treeKind: 'u8',
  burnt: 'u8',
  swampy: 'u8',
  riverMask: 'u8',
  biome: 'u8',
  temperature: 'f32',
  lava: 'u8',
  ice: 'u8',
  mineralType: 'u8',
  mineralAmount: 'f32',
});

function bytesToBase64(bytes) {
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return globalThis.btoa(binary);
  }
  return globalThis.Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value) {
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  return Uint8Array.from(globalThis.Buffer.from(value, 'base64'));
}

function packNumericArray(values, type) {
  const typed = type === 'f32' ? new Float32Array(values) : new Uint8Array(values);
  return { encoding: `${type}-base64`, data: bytesToBase64(new Uint8Array(typed.buffer)) };
}

function unpackNumericArray(value, type) {
  if (Array.isArray(value)) return value;
  if (!value || value.encoding !== `${type}-base64` || typeof value.data !== 'string') {
    throw new Error('Matriz de terreno compactada inválida');
  }
  const bytes = base64ToBytes(value.data);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return Array.from(type === 'f32' ? new Float32Array(buffer) : new Uint8Array(buffer));
}

export function encodeSnapshotForStorage(snapshot) {
  const packedWorld = { ...snapshot.world };
  for (const [field, type] of Object.entries(PACKED_WORLD_ARRAYS)) {
    if (Array.isArray(packedWorld[field])) packedWorld[field] = packNumericArray(packedWorld[field], type);
  }
  return {
    ...snapshot,
    schema: { ...snapshot.schema, encoding: 'base64-typed-arrays' },
    world: packedWorld,
  };
}

export function decodeSnapshotFromStorage(snapshot) {
  if (snapshot?.schema?.encoding !== 'base64-typed-arrays') return snapshot;
  const world = { ...snapshot.world };
  for (const [field, type] of Object.entries(PACKED_WORLD_ARRAYS)) {
    if (world[field] != null) world[field] = unpackNumericArray(world[field], type);
  }
  return { ...snapshot, world };
}

function assertRecord(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value;
}

export function migrateSaveSnapshot(input) {
  const snapshot = assertRecord(input, 'El guardado no contiene un objeto válido');
  const version = Number(snapshot.version ?? 1);
  if (!Number.isInteger(version)) throw new Error(`Versión de guardado no compatible: ${version}`);

  if (version === SAVE_FORMAT_VERSION) {
    return snapshot.schema?.version === SAVE_FORMAT_VERSION
      ? snapshot
      : { ...snapshot, schema: { name: 'worldbox3d', version: SAVE_FORMAT_VERSION } };
  }

  if (version >= 1 && version < SAVE_FORMAT_VERSION) {
    const creatureContainer = Array.isArray(snapshot.creatures)
      ? snapshot.creatures
      : snapshot.creatures?.creatures;
    const hasShips = version >= 3 && Array.isArray(snapshot.ships?.ships);
    const recoveredCreatures = Array.isArray(creatureContainer)
      ? creatureContainer.map(creature => creature?.sailing && !hasShips ? { ...creature, sailing: false } : creature)
      : [];
    const creatures = Array.isArray(snapshot.creatures)
      ? recoveredCreatures
      : { ...(snapshot.creatures || {}), creatures: recoveredCreatures };
    return {
      ...snapshot,
      creatures,
      ships: version >= 3 && snapshot.ships
        ? snapshot.ships
        : { version: 1, timer: 18, ships: [] },
      civilization: snapshot.civilization || { version: 1, people: [], clans: [], productionSites: [], armies: [] },
      cataclysms: snapshot.cataclysms || { version: 1, mines: [], nextMineId: 1, disasterTimer: 120 },
      version: SAVE_FORMAT_VERSION,
      schema: {
        name: 'worldbox3d',
        version: SAVE_FORMAT_VERSION,
        migratedFrom: version,
      },
    };
  }

  throw new Error(`Versión de guardado no compatible: ${version}`);
}

export function validateSaveSnapshot(snapshot) {
  assertRecord(snapshot, 'Guardado vacío');
  const size = Number(snapshot.world?.size);
  const expectedVertices = (size + 1) * (size + 1);

  if (snapshot.version !== SAVE_FORMAT_VERSION) throw new Error('Formato de guardado incompatible');
  if (snapshot.schema?.version !== SAVE_FORMAT_VERSION) throw new Error('Metadatos de guardado incompatibles');
  if (!Number.isInteger(size) || size < 32 || size > 720) throw new Error('Tamaño de mundo inválido');
  if (!Array.isArray(snapshot.world?.height) || snapshot.world.height.length !== expectedVertices) {
    throw new Error('Terreno incompleto');
  }
  if (!Array.isArray(snapshot.world.moisture) || snapshot.world.moisture.length !== expectedVertices) throw new Error('Terreno incompleto: moisture');
  for (const [field, type] of Object.entries(PACKED_WORLD_ARRAYS)) {
    const values = snapshot.world[field];
    if (values == null) continue; // Campos opcionales en guardados anteriores.
    if (!Array.isArray(values) || values.length !== expectedVertices) throw new Error(`Terreno incompleto: ${field}`);
    if (values.some(value => !Number.isFinite(value) || (type === 'f32' && !Number.isFinite(Math.fround(value))) || (type === 'u8' && (!Number.isInteger(value) || value < 0 || value > 255)))) {
      throw new Error(`Datos de terreno inválidos: ${field}`);
    }
  }

  const creatureRecords = Array.isArray(snapshot.creatures)
    ? snapshot.creatures
    : snapshot.creatures?.creatures;
  if (!Array.isArray(creatureRecords)) throw new Error('Criaturas incompletas');
  assertRecord(snapshot.settlements, 'Asentamientos incompletos');
  if (!Array.isArray(snapshot.settlements.settlements)) throw new Error('Asentamientos incompletos');
  const ships = assertRecord(snapshot.ships, 'Expediciones incompletas');
  if (!Array.isArray(ships.ships)) throw new Error('Expediciones incompletas');
  assertRecord(snapshot.civilization, 'Civilizaciones incompletas');
  return snapshot;
}

function parseCandidate(raw) {
  if (!raw) return null;
  return validateSaveSnapshot(migrateSaveSnapshot(decodeSnapshotFromStorage(JSON.parse(raw))));
}

export class SaveRepository {
  constructor(storage) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new Error('Se necesita un almacenamiento compatible con localStorage');
    }
    this.storage = storage;
    this.lastError = null;
  }

  load({ repair = true } = {}) {
    this.lastError = null;
    const candidates = [
      SAVE_STORAGE_KEY,
      SAVE_PENDING_KEY,
      SAVE_BACKUP_KEY,
      ...LEGACY_SAVE_KEYS,
    ];

    for (const key of candidates) {
      const raw = this.storage.getItem(key);
      if (!raw) continue;
      try {
        const snapshot = parseCandidate(raw);
        if (repair && key !== SAVE_STORAGE_KEY) {
          try { this.save(snapshot); } catch (error) { this.lastError = error; }
        }
        return snapshot;
      } catch (error) {
        this.lastError = error;
      }
    }
    return null;
  }

  hasSave() {
    return Boolean(this.load({ repair: false }));
  }

  save(input) {
    const snapshot = validateSaveSnapshot(migrateSaveSnapshot(input));
    const serialized = JSON.stringify(encodeSnapshotForStorage(snapshot));
    const previous = this.storage.getItem(SAVE_STORAGE_KEY);
    const recoveryEntries = [SAVE_BACKUP_KEY, SAVE_PENDING_KEY, ...LEGACY_SAVE_KEYS]
      .map(key => [key, this.storage.getItem(key)]).filter(([, raw]) => raw);

    this.storage.removeItem(SAVE_PENDING_KEY);
    if (previous) {
      try {
        parseCandidate(previous);
        this.storage.setItem(SAVE_BACKUP_KEY, previous);
      } catch { /* No sustituir una copia válida por el principal corrupto. */ }
    }
    try {
      this.storage.setItem(SAVE_STORAGE_KEY, serialized);
    } catch (error) {
      this.storage.removeItem(SAVE_BACKUP_KEY);
      for (const key of LEGACY_SAVE_KEYS) this.storage.removeItem(key);
      try {
        this.storage.setItem(SAVE_STORAGE_KEY, serialized);
      } catch {
        for (const [key, raw] of recoveryEntries) {
          try { this.storage.setItem(key, raw); } catch { /* Recuperación con cuota limitada. */ }
        }
        throw error;
      }
    }
    this.storage.removeItem(SAVE_PENDING_KEY);
    for (const key of LEGACY_SAVE_KEYS) this.storage.removeItem(key);
    return snapshot;
  }

  clear() {
    for (const key of [SAVE_STORAGE_KEY, SAVE_BACKUP_KEY, SAVE_PENDING_KEY, ...LEGACY_SAVE_KEYS]) {
      this.storage.removeItem(key);
    }
  }
}

export class IndexedDbSaveBackend {
  constructor(indexedDB, { databaseName = SAVE_DATABASE_NAME, storeName = SAVE_DATABASE_STORE } = {}) {
    if (!indexedDB?.open) throw new Error('IndexedDB no está disponible');
    this.indexedDB = indexedDB;
    this.databaseName = databaseName;
    this.storeName = storeName;
    this.databasePromise = null;
  }

  open() {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) database.createObjectStore(this.storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB está bloqueado por otra pestaña'));
    });
    return this.databasePromise;
  }

  async read(key) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readonly');
      const request = transaction.objectStore(this.storeName).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error('No se pudo leer el guardado'));
      transaction.onabort = () => reject(transaction.error || new Error('Lectura de guardado cancelada'));
    });
  }

  async commit(serialized, { backupCurrent = true } = {}) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      if (backupCurrent) {
        const currentRequest = store.get('current');
        currentRequest.onsuccess = () => {
          if (currentRequest.result) store.put(currentRequest.result, 'backup');
          store.put(serialized, 'current');
        };
      } else {
        store.put(serialized, 'current');
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar el mundo'));
      transaction.onabort = () => reject(transaction.error || new Error('Guardado cancelado'));
    });
  }

  async write(key, serialized) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      transaction.objectStore(this.storeName).put(serialized, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo escribir la ranura'));
      transaction.onabort = () => reject(transaction.error || new Error('Escritura cancelada'));
    });
  }

  async remove(key) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      transaction.objectStore(this.storeName).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo borrar la ranura'));
    });
  }

  async list(prefix = '') {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.openCursor();
      const rows = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(rows); return; }
        if (String(cursor.key).startsWith(prefix)) rows.push({ key: String(cursor.key), value: cursor.value });
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('No se pudieron listar las ranuras'));
    });
  }
}

export class AsyncSaveRepository {
  constructor(backend, legacyRepository = null) {
    this.backend = backend;
    this.legacyRepository = legacyRepository;
    this.lastError = null;
    this.storageKind = 'indexeddb';
  }

  async load({ repair = true } = {}) {
    this.lastError = null;
    let local = null;
    try { local = this.legacyRepository?.load({ repair: false }) || null; }
    catch (error) { this.lastError = error; }
    for (const key of ['current', 'backup']) {
      let raw = null;
      try {
        raw = await this.backend.read(key);
      } catch (error) {
        this.lastError = error;
        break;
      }
      if (!raw) continue;
      try {
        const storedVersion = Number(JSON.parse(raw)?.version ?? 1);
        const snapshot = parseCandidate(raw);
        // Un commit fallido puede dejar IndexedDB con una partida anterior al fallback local.
        if (local && Number(local.savedAt || 0) > Number(snapshot.savedAt || 0)) break;
        if (repair && (key === 'backup' || storedVersion !== SAVE_FORMAT_VERSION)) {
          try { await this._saveSnapshot(snapshot, false); } catch (error) { this.lastError = error; }
        }
        return snapshot;
      } catch (error) {
        this.lastError = error;
      }
    }

    if (this.legacyRepository) {
      const legacy = local;
      if (legacy) {
        if (repair) {
          try {
            await this._saveSnapshot(legacy, false);
            if (this.storageKind === 'indexeddb') this.legacyRepository.clear();
          } catch (error) { this.lastError = error; }
        }
        return legacy;
      }
      if (this.legacyRepository.lastError) this.lastError = this.legacyRepository.lastError;
    }
    return null;
  }

  async hasSave() {
    return Boolean(await this.load({ repair: false }));
  }

  async _saveSnapshot(input, backupCurrent) {
    const snapshot = validateSaveSnapshot(migrateSaveSnapshot(input));
    const serialized = JSON.stringify(encodeSnapshotForStorage(snapshot));
    try {
      await this.backend.commit(serialized, { backupCurrent });
      this.storageKind = 'indexeddb';
    } catch (error) {
      this.lastError = error;
      if (!this.legacyRepository) throw error;
      this.legacyRepository.save(snapshot);
      this.storageKind = 'localstorage';
    }
    return snapshot;
  }

  async save(input) {
    return this._saveSnapshot(input, true);
  }

  async saveSlot(id, input, metadata = {}) {
    const snapshot = validateSaveSnapshot(migrateSaveSnapshot(input));
    snapshot.slot = { id: String(id), name: String(metadata.name || `Ranura ${id}`), thumbnail: metadata.thumbnail || null };
    const serialized = JSON.stringify(encodeSnapshotForStorage(snapshot));
    if (!this.backend.write) throw new Error('Las ranuras requieren IndexedDB');
    await this.backend.write(`slot:${id}`, serialized);
    return snapshot;
  }

  async loadSlot(id) {
    const raw = await this.backend.read(`slot:${id}`);
    return raw ? parseCandidate(raw) : null;
  }

  async listSlots() {
    if (!this.backend.list) return [];
    const rows = await this.backend.list('slot:');
    return rows.map(row => {
      try {
        const snapshot = decodeSnapshotFromStorage(JSON.parse(row.value));
        return { id: row.key.slice(5), name: snapshot.slot?.name || `Ranura ${row.key.slice(5)}`, thumbnail: snapshot.slot?.thumbnail || null, savedAt: snapshot.savedAt || 0 };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  async deleteSlot(id) { if (this.backend.remove) await this.backend.remove(`slot:${id}`); }

  async exportSlot(id) {
    const snapshot = await this.loadSlot(id);
    if (!snapshot) throw new Error('La ranura está vacía');
    return JSON.stringify(snapshot, null, 2);
  }

  async importSlot(id, text, metadata = {}) {
    const snapshot = parseCandidate(text);
    return this.saveSlot(id, snapshot, { name: metadata.name || snapshot.slot?.name || `Ranura ${id}`, thumbnail: snapshot.slot?.thumbnail || null });
  }
}

class AsyncLocalSaveRepository {
  constructor(repository) {
    this.repository = repository;
    this.storageKind = 'localstorage';
  }
  async load(options) { return this.repository.load(options); }
  async hasSave() { return this.repository.hasSave(); }
  async save(input) { return this.repository.save(input); }
  get lastError() { return this.repository.lastError; }
}

export function createBrowserSaveRepository({
  storage = globalThis.localStorage,
  indexedDB = globalThis.indexedDB,
} = {}) {
  const legacyRepository = new SaveRepository(storage);
  if (!indexedDB?.open) return new AsyncLocalSaveRepository(legacyRepository);
  return new AsyncSaveRepository(new IndexedDbSaveBackend(indexedDB), legacyRepository);
}
