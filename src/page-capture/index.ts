import type { PageCaptureStub } from "../shared/types.js";

/**
 * Future: full page archive (MHTML / webarchive).
 *
 * Limits / TODOs:
 * - chrome.pageCapture.saveAsMHTML requires activeTab or host permission for the tab URL.
 *   It saves the **current** tab DOM as MHTML; it does not include live network bodies or
 *   post-load dynamic state unless already in the DOM.
 * - No access to cross-origin iframe internals beyond what the browser serializes.
 * - Large pages produce large files; export should be user-triggered, not per-request.
 * - Alternative later: chrome.debugger Page.captureSnapshot, DevTools Protocol, or
 *   offscreen document + scripting — each needs separate permissions and UX.
 */
export function pageCaptureStub(): PageCaptureStub {
  return {
    supported: false,
    note:
      "Page archive not implemented. Planned: chrome.pageCapture.saveAsMHTML and/or debugger/DevTools hooks.",
  };
}

/**
 * Stub for future MHTML export of a tab.
 * @see https://developer.chrome.com/docs/extensions/reference/api/pageCapture
 */
export async function saveTabAsMhtml(_tabId: number): Promise<void> {
  throw new Error("Page capture not implemented yet. See src/page-capture/index.ts.");
}
