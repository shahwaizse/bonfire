// Small in-memory TTL caches; successful public evidence only, never failed requests.
export class ResultCache {
  constructor({ maxEntries = 64, ttlMs = 30000 } = {}) { this.maxEntries = maxEntries; this.ttlMs = ttlMs; this.entries = new Map(); }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() - entry.time >= this.ttlMs) { this.entries.delete(key); return null; }
    this.entries.delete(key); this.entries.set(key, entry);
    return structuredClone(entry.value);
  }
  set(key, value) {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, { time: Date.now(), value: structuredClone(value) });
  }
}
