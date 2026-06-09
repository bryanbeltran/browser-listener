import { vi } from "vitest";

export function installChromeStorageMock(): Record<string, unknown> {
  const store: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (keys == null) return { ...store };
      const k = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of k) {
        if (key in store) out[key] = store[key];
      }
      return out;
    }),
    set: vi.fn(async (obj: Record<string, unknown>) => {
      Object.assign(store, obj);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const k = Array.isArray(keys) ? keys : [keys];
      for (const key of k) delete store[key];
    }),
  };
  vi.stubGlobal("chrome", { storage: { local } });
  return store;
}

export function uninstallChromeStorageMock(): void {
  vi.unstubAllGlobals();
}
