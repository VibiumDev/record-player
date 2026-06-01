import "@testing-library/jest-dom";

// jsdom's localStorage in this environment lacks working methods (clear/getItem
// are undefined), so provide an in-memory Storage shim for tests that use it.
if (typeof window.localStorage?.clear !== "function") {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    key: (index) => Array.from(store.keys())[index] ?? null,
  };
  Object.defineProperty(window, "localStorage", { writable: true, value: memoryStorage });
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
