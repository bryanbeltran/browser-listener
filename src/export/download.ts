import { uint8ToBase64 } from "../shared/bytes.js";

function downloadUrl(url: string, filename: string, saveAs: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs }, (downloadId) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (downloadId === undefined) {
        reject(new Error("Download failed"));
        return;
      }
      resolve();
    });
  });
}

/** Popup / extension pages — blob URL + optional Save As (needs user gesture). */
export async function downloadZipFromPage(
  zip: Uint8Array,
  filename: string,
  saveAs = true,
): Promise<void> {
  const copy = new Uint8Array(zip);
  const url = URL.createObjectURL(new Blob([copy], { type: "application/zip" }));
  try {
    await downloadUrl(url, filename, saveAs);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Service worker — no DOM; data URL, default save path (no Save As dialog). */
export async function downloadZipFromWorker(
  zip: Uint8Array,
  filename: string,
  saveAs = false,
): Promise<void> {
  const url = `data:application/zip;base64,${uint8ToBase64(zip)}`;
  await downloadUrl(url, filename, saveAs);
}
