import { getExtensionVersion } from "../shared/extension-version.js";
import type { CapabilityMatrix, CapabilityStatus } from "../shared/types.js";

export const CAPABILITY_MATRIX_SCHEMA_VERSION = 1 as const;

function capability(supported: boolean, reason?: string): CapabilityStatus {
  return supported ? { supported: true } : { supported: false, reason };
}

/**
 * Describe the current adapter rather than allowing unsupported browser behavior
 * to disappear silently from a capture. This is deliberately capability-level
 * metadata; it does not probe a page or expand capture scope.
 */
export function buildCapabilityMatrix(): CapabilityMatrix {
  const debuggerAvailable = typeof chrome !== "undefined" && typeof chrome.debugger?.sendCommand === "function";
  const storageAvailable = typeof chrome !== "undefined" && typeof chrome.storage?.local?.get === "function";
  const downloadsAvailable = typeof chrome !== "undefined" && typeof chrome.downloads?.download === "function";
  let manifestVersion = 3;
  try {
    manifestVersion = chrome.runtime.getManifest().manifest_version;
  } catch {
    /* Test and degraded contexts may not expose runtime metadata. */
  }

  return {
    schemaVersion: CAPABILITY_MATRIX_SCHEMA_VERSION,
    adapter: "chromium-mv3",
    browserFamily: "chromium",
    versions: {
      extension: getExtensionVersion(),
      manifest: manifestVersion,
      ...(typeof navigator !== "undefined" && navigator.userAgent ? { userAgent: navigator.userAgent } : {}),
    },
    debuggerDomains: {
      Network: capability(debuggerAvailable, "chrome.debugger.sendCommand is unavailable"),
      Runtime: capability(debuggerAvailable, "chrome.debugger.sendCommand is unavailable"),
      Log: capability(debuggerAvailable, "chrome.debugger.sendCommand is unavailable"),
      Performance: capability(debuggerAvailable, "chrome.debugger.sendCommand is unavailable"),
      Page: capability(debuggerAvailable, "chrome.debugger.sendCommand is unavailable"),
    },
    bodyRetrieval: capability(debuggerAvailable, "CDP body retrieval requires chrome.debugger"),
    workerTargets: capability(false, "Worker target inventory is not captured by the core adapter"),
    screenshots: capability(debuggerAvailable, "Page.captureScreenshot requires chrome.debugger"),
    downloads: capability(downloadsAvailable, "chrome.downloads is unavailable; page-mediated download may be used"),
    storage: capability(storageAvailable, "chrome.storage.local is unavailable"),
    lifecycleRecovery: capability(debuggerAvailable && storageAvailable, "Debugger and local storage are required for recovery"),
  };
}
