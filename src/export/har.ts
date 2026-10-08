import type { NetworkEntry, NavigationEntry, SessionData } from "../shared/types.js";
import { getExtensionVersion } from "../shared/extension-version.js";

export const HAR_VERSION = "1.2" as const;

interface HarHeader {
  name: string;
  value: string;
}

interface HarQueryParameter {
  name: string;
  value: string;
}

interface HarPage {
  startedDateTime: string;
  id: string;
  title: string;
  pageTimings: Record<string, number>;
  _browserListener: {
    sessionId: string;
    url: string;
    tabId?: number;
    frameId?: number;
  };
}

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    cookies: never[];
    headers: HarHeader[];
    queryString: HarQueryParameter[];
    headersSize: number;
    bodySize: number;
    postData?: {
      mimeType: string;
      text: string;
    };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    cookies: never[];
    headers: HarHeader[];
    content: {
      size: number;
      mimeType: string;
      text?: string;
    };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: {
    blocked: number;
    dns: number;
    connect: number;
    send: number;
    wait: number;
    receive: number;
    ssl: number;
  };
  serverIPAddress?: string;
  comment?: string;
  _browserListener: {
    id: string;
    sessionId: string;
    requestId: string;
    type: string;
    tabId?: number;
    frameId?: string;
    documentUrl?: string;
    redirectFromId?: string;
    initiator?: NetworkEntry["initiator"];
    isPreflight?: boolean;
    fromCache?: boolean;
    fromServiceWorker?: boolean;
    connectionReused?: boolean;
    bodyCaptured?: boolean;
    requestBodyTruncated?: boolean;
    responseBodyTruncated?: boolean;
    requestBodyState?: NetworkEntry["requestBodyState"];
    responseBodyState?: NetworkEntry["responseBodyState"];
    requestBodySkipReason?: NetworkEntry["requestBodySkipReason"];
    responseBodySkipReason?: NetworkEntry["responseBodySkipReason"];
    requestBodyEncoding?: NetworkEntry["requestBodyEncoding"];
    responseBodyEncoding?: NetworkEntry["responseBodyEncoding"];
    requestTransferSize?: number;
    responseTransferSize?: number;
    oneRequestCapture?: boolean;
    timing?: NetworkEntry["timing"];
  };
}

export interface HarDocument {
  log: {
    version: typeof HAR_VERSION;
    creator: { name: string; version: string };
    pages: HarPage[];
    entries: HarEntry[];
  };
}

function headers(value: Record<string, string> | undefined): HarHeader[] {
  return Object.entries(value ?? {}).map(([name, headerValue]) => ({ name, value: headerValue }));
}

function queryString(url: string): HarQueryParameter[] {
  try {
    const parsed = new URL(url);
    const result: HarQueryParameter[] = [];
    parsed.searchParams.forEach((value, name) => result.push({ name, value }));
    return result;
  } catch {
    return [];
  }
}

function headerValue(value: Record<string, string> | undefined, name: string): string | undefined {
  const key = Object.keys(value ?? {}).find((candidate) => candidate.toLowerCase() === name);
  return key ? value?.[key] : undefined;
}

function startedAt(entry: NetworkEntry): number {
  return entry.timing?.start ?? entry.timestamp;
}

function harPage(entry: NavigationEntry): HarPage {
  return {
    startedDateTime: new Date(entry.timestamp).toISOString(),
    id: `page-${entry.id}`,
    title: entry.title ?? "",
    pageTimings: {},
    _browserListener: {
      sessionId: entry.sessionId,
      url: entry.url,
      tabId: entry.tabId,
      frameId: entry.frameId,
    },
  };
}

function harEntry(entry: NetworkEntry): HarEntry {
  const requestContentType = headerValue(entry.requestHeaders, "content-type") ?? "";
  const responseContentType = entry.contentType ?? headerValue(entry.responseHeaders, "content-type") ?? "";
  const duration = entry.timing?.durationMs ?? 0;

  return {
    startedDateTime: new Date(startedAt(entry)).toISOString(),
    time: duration,
    request: {
      method: entry.method,
      url: entry.url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headers(entry.requestHeaders),
      queryString: queryString(entry.url),
      headersSize: -1,
      bodySize: entry.requestBodySize ?? -1,
      ...(entry.requestBody == null
        ? {}
        : { postData: { mimeType: requestContentType, text: entry.requestBody } }),
    },
    response: {
      status: entry.statusCode ?? 0,
      statusText: entry.statusLine ?? "",
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headers(entry.responseHeaders),
      content: {
        size: entry.responseBodySize ?? -1,
        mimeType: responseContentType,
        ...(entry.responseBody == null ? {} : { text: entry.responseBody }),
      },
      redirectURL: "",
      headersSize: -1,
      bodySize: entry.responseBodySize ?? -1,
    },
    cache: {},
    timings: {
      blocked: -1,
      dns: -1,
      connect: -1,
      send: 0,
      wait: duration,
      receive: 0,
      ssl: -1,
    },
    ...(entry.ip == null ? {} : { serverIPAddress: entry.ip }),
    ...(entry.error == null ? {} : { comment: entry.error }),
    _browserListener: {
      id: entry.id,
      sessionId: entry.sessionId,
      requestId: entry.requestId,
      type: entry.type,
      tabId: entry.tabId,
      frameId: entry.frameId,
      documentUrl: entry.documentUrl,
      redirectFromId: entry.redirectFromId,
      initiator: entry.initiator,
      isPreflight: entry.isPreflight,
      fromCache: entry.fromCache,
      fromServiceWorker: entry.fromServiceWorker,
      connectionReused: entry.connectionReused,
      bodyCaptured: entry.bodyCaptured,
      requestBodyTruncated: entry.requestBodyTruncated,
      responseBodyTruncated: entry.responseBodyTruncated,
      requestBodyState: entry.requestBodyState,
      responseBodyState: entry.responseBodyState,
      requestBodySkipReason: entry.requestBodySkipReason,
      responseBodySkipReason: entry.responseBodySkipReason,
      requestBodyEncoding: entry.requestBodyEncoding,
      responseBodyEncoding: entry.responseBodyEncoding,
      requestTransferSize: entry.requestTransferSize,
      responseTransferSize: entry.responseTransferSize,
      oneRequestCapture: entry.oneRequestCapture,
      timing: entry.timing,
    },
  };
}

export function buildHar(data: SessionData): HarDocument {
  return {
    log: {
      version: HAR_VERSION,
      creator: { name: "Browser Listener", version: data.session?.extensionVersion ?? getExtensionVersion() },
      pages: data.navigation.map(harPage),
      entries: data.network.map(harEntry),
    },
  };
}
