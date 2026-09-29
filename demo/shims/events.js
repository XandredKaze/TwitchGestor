// Versione minima di EventEmitter per il browser (demo).
export class EventEmitter {
  #l = new Map();
  on(name, fn) {
    if (!this.#l.has(name)) this.#l.set(name, []);
    this.#l.get(name).push(fn);
    return this;
  }
  once(name, fn) {
    const w = (...a) => { this.off(name, w); fn(...a); };
    return this.on(name, w);
  }
  off(name, fn) {
    this.#l.set(name, (this.#l.get(name) ?? []).filter((f) => f !== fn));
    return this;
  }
  removeAllListeners(name) {
    if (name) this.#l.delete(name); else this.#l.clear();
    return this;
  }
  emit(name, ...args) {
    for (const fn of [...(this.#l.get(name) ?? [])]) fn(...args);
    return (this.#l.get(name) ?? []).length > 0;
  }
}
export default { EventEmitter };
