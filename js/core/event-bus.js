export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(type, listener) {
    if (typeof listener !== 'function') throw new TypeError('El listener debe ser una función');
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    bucket.add(listener);
    return () => this.off(type, listener);
  }

  once(type, listener) {
    const unsubscribe = this.on(type, payload => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  off(type, listener) {
    const bucket = this.listeners.get(type);
    if (!bucket) return false;
    const removed = bucket.delete(listener);
    if (!bucket.size) this.listeners.delete(type);
    return removed;
  }

  emit(type, payload) {
    const bucket = this.listeners.get(type);
    if (!bucket?.size) return 0;
    for (const listener of [...bucket]) listener(payload);
    return bucket.size;
  }

  clear(type) {
    if (type === undefined) this.listeners.clear();
    else this.listeners.delete(type);
  }
}
