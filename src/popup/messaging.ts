export function sendMessageWithTimeout<T>(
  message: object,
  timeoutMs = 120_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Background did not respond in time — try again"));
    }, timeoutMs);
    chrome.runtime.sendMessage(message, (response) => {
      clearTimeout(timer);
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response as T);
    });
  });
}
