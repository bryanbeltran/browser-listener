export const REDACTION_PREFERENCE_KEY = "browserListenerRedactionEnabled";
export const DEFAULT_REDACTION_ENABLED = true;

export async function readRedactionPreference(): Promise<boolean> {
  const raw = await chrome.storage.local.get(REDACTION_PREFERENCE_KEY);
  const stored = raw[REDACTION_PREFERENCE_KEY];
  return stored == null ? DEFAULT_REDACTION_ENABLED : stored !== false;
}

export async function setRedactionPreference(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [REDACTION_PREFERENCE_KEY]: enabled });
}
