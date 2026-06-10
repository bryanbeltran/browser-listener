/**
 * Optional MHTML snapshot via chrome.pageCapture (tab must still exist).
 * @see https://developer.chrome.com/docs/extensions/reference/api/pageCapture
 */
export async function captureTabMhtml(tabId: number): Promise<string | null> {
  try {
    const result = await chrome.pageCapture.saveAsMHTML({ tabId });
    if (result == null) return null;
    if (typeof result === "string") return result;
    return await result.text();
  } catch {
    return null;
  }
}
