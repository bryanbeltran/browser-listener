/** Console method levels we intercept in the content script. */
export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  level: ConsoleLevel;
  args: string[];
  url: string;
  tabId?: number;
}

/** Network metadata only — no response body (see README API limits). */
export interface NetworkEntry {
  id: string;
  sessionId: string;
  requestId: string;
  timestamp: number;
  url: string;
  method: string;
  type: chrome.webRequest.ResourceType;
  tabId?: number;
  statusCode?: number;
  statusLine?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  ip?: string;
  fromCache?: boolean;
  error?: string;
}

export interface CaptureSession {
  id: string;
  active: boolean;
  startedAt: number;
  stoppedAt?: number;
}

export interface PageCaptureStub {
  supported: boolean;
  note: string;
}

export interface ExportPayload {
  exportedAt: number;
  session: CaptureSession | null;
  console: ConsoleEntry[];
  network: NetworkEntry[];
  pageCapture: PageCaptureStub;
}

export interface StorageSchema {
  session: CaptureSession | null;
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
}
