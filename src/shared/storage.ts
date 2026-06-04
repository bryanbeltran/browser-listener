import type { CaptureSession, ConsoleEntry, NetworkEntry, StorageSchema } from "./types.js";

const KEYS = {
  session: "session",
  consoleEntries: "consoleEntries",
  networkEntries: "networkEntries",
} as const;

const EMPTY: StorageSchema = {
  session: null,
  consoleEntries: [],
  networkEntries: [],
};

export async function readStorage(): Promise<StorageSchema> {
  const data = await chrome.storage.local.get(Object.values(KEYS));
  return {
    session: (data[KEYS.session] as CaptureSession | null) ?? null,
    consoleEntries: (data[KEYS.consoleEntries] as ConsoleEntry[]) ?? [],
    networkEntries: (data[KEYS.networkEntries] as NetworkEntry[]) ?? [],
  };
}

export async function writeSession(session: CaptureSession | null): Promise<void> {
  await chrome.storage.local.set({ [KEYS.session]: session });
}

export async function appendConsoleEntry(entry: ConsoleEntry): Promise<void> {
  const { consoleEntries } = await readStorage();
  consoleEntries.push(entry);
  await chrome.storage.local.set({ [KEYS.consoleEntries]: consoleEntries });
}

export async function appendNetworkEntry(entry: NetworkEntry): Promise<void> {
  const { networkEntries } = await readStorage();
  const idx = networkEntries.findIndex((e) => e.requestId === entry.requestId);
  if (idx >= 0) {
    networkEntries[idx] = { ...networkEntries[idx], ...entry };
  } else {
    networkEntries.push(entry);
  }
  await chrome.storage.local.set({ [KEYS.networkEntries]: networkEntries });
}

export async function clearLogs(): Promise<void> {
  const { session } = await readStorage();
  await chrome.storage.local.set({
    [KEYS.consoleEntries]: [],
    [KEYS.networkEntries]: [],
    [KEYS.session]: session,
  });
}

export async function resetAll(): Promise<void> {
  await chrome.storage.local.set(EMPTY);
}
