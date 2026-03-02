/**
 * In-memory storage adapter for tests.
 */
export function createMemStore() {
  const store = new Map()
  return {
    async get(key) {
      return store.get(key) ?? null
    },
    async set(key, value) {
      store.set(key, value)
    },
    _store: store,
  }
}
