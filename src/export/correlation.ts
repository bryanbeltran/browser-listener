import type {
  ConsoleEntry,
  CorrelationConfidence,
  CorrelationEdge,
  CorrelationEdgeType,
  CorrelationGraph,
  CorrelationNode,
  CorrelationNodeType,
  MarkerEntry,
  NavigationEntry,
  NetworkEntry,
  SessionData,
} from "../shared/types.js";

export const CORRELATION_GRAPH_SCHEMA_VERSION = 1 as const;
const CONSOLE_WINDOW_MS = 10_000;
const RETRY_WINDOW_MS = 30_000;

interface EventRecord {
  node: CorrelationNode;
  entry: NetworkEntry | ConsoleEntry | NavigationEntry | MarkerEntry;
}

function nodeId(type: CorrelationNodeType, eventId: string): string {
  return `${type}:${eventId}`;
}

function eventIdFor(record: EventRecord): string {
  return record.node.id;
}

function timestamp(record: EventRecord): number {
  return record.node.timestamp;
}

function sameScope(left: EventRecord, right: EventRecord): boolean {
  return left.node.tabId == null || right.node.tabId == null || left.node.tabId === right.node.tabId;
}

function sameFrame(left: EventRecord, right: EventRecord): boolean {
  return left.node.frameId == null || right.node.frameId == null || left.node.frameId === right.node.frameId;
}

function nodeFor(
  type: CorrelationNodeType,
  entry: NetworkEntry | ConsoleEntry | NavigationEntry | MarkerEntry,
): CorrelationNode {
  const frameId = "frameId" in entry ? entry.frameId : undefined;
  return {
    id: nodeId(type, entry.id),
    eventId: entry.id,
    type,
    timestamp: entry.timestamp,
    ...(entry.tabId == null ? {} : { tabId: entry.tabId }),
    ...(frameId == null ? {} : { frameId }),
    ...(type === "network" && (entry as NetworkEntry).statusCode == null
      ? {}
      : type === "network"
        ? { statusCode: (entry as NetworkEntry).statusCode }
        : {}),
    ...(type === "console" ? { level: (entry as ConsoleEntry).level } : {}),
  };
}

function records<T extends NetworkEntry | ConsoleEntry | NavigationEntry | MarkerEntry>(
  type: CorrelationNodeType,
  entries: T[],
): EventRecord[] {
  return entries.map((entry) => ({ node: nodeFor(type, entry), entry }));
}

function edgeId(type: CorrelationEdgeType, from: string, to: string): string {
  return `${type}:${from}->${to}`;
}

function addEdge(
  edges: Map<string, CorrelationEdge>,
  from: EventRecord,
  to: EventRecord,
  type: CorrelationEdgeType,
  confidence: CorrelationConfidence,
  ambiguous: boolean,
  source: string,
  rule: string,
): void {
  if (from.node.id === to.node.id) return;
  const id = edgeId(type, from.node.id, to.node.id);
  if (edges.has(id)) return;
  edges.set(id, {
    id,
    from: from.node.id,
    to: to.node.id,
    type,
    confidence,
    ambiguous,
    provenance: { source, rule },
  });
}

function nearest<T extends EventRecord>(source: EventRecord, candidates: T[]): T | undefined {
  return [...candidates].sort((left, right) =>
    Math.abs(timestamp(left) - timestamp(source)) - Math.abs(timestamp(right) - timestamp(source)) ||
    eventIdFor(left).localeCompare(eventIdFor(right)),
  )[0];
}

function addDirectNetworkEdges(
  network: EventRecord[],
  edges: Map<string, CorrelationEdge>,
): void {
  const byEventId = new Map(network.map((record) => [record.node.eventId, record]));
  const byRequestId = new Map<string, EventRecord[]>();
  for (const record of network) {
    const requestId = (record.entry as NetworkEntry).requestId;
    const values = byRequestId.get(requestId) ?? [];
    values.push(record);
    byRequestId.set(requestId, values);
  }

  for (const record of network) {
    const entry = record.entry as NetworkEntry;
    if (entry.redirectFromId) {
      const previous = byEventId.get(entry.redirectFromId);
      if (previous) {
        addEdge(edges, previous, record, "redirect", "direct", false, "Network.redirectFromId", "browser redirect identity");
      }
    }
    const initiatorRequestId = entry.initiator?.requestId;
    if (initiatorRequestId) {
      const candidates = (byRequestId.get(initiatorRequestId) ?? []).filter((candidate) => candidate.node.id !== record.node.id);
      for (const candidate of candidates) {
        addEdge(
          edges,
          candidate,
          record,
          "initiator",
          candidates.length === 1 ? "direct" : "supported",
          candidates.length > 1,
          "Network.initiator.requestId",
          "browser-provided initiator request identity",
        );
      }
    }
  }
}

function addDocumentAndFrameEdges(
  network: EventRecord[],
  navigation: EventRecord[],
  edges: Map<string, CorrelationEdge>,
): void {
  for (const record of network) {
    const entry = record.entry as NetworkEntry;
    const matches = navigation.filter((candidate) => {
      const nav = candidate.entry as NavigationEntry;
      return (
        sameScope(record, candidate) &&
        sameFrame(record, candidate) &&
        entry.documentUrl != null &&
        nav.url === entry.documentUrl &&
        timestamp(candidate) <= timestamp(record)
      );
    });
    const document = nearest(record, matches);
    if (document) {
      addEdge(edges, document, record, "document", "direct", false, "Network.documentURL", "matching navigation URL and capture scope");
    }

    if (record.node.frameId != null) {
      const frameMatches = navigation.filter((candidate) =>
        sameScope(record, candidate) &&
        candidate.node.frameId === record.node.frameId &&
        timestamp(candidate) <= timestamp(record),
      );
      const frame = nearest(record, frameMatches);
      if (frame && frame.node.id !== document?.node.id) {
        addEdge(edges, frame, record, "frame", "supported", frameMatches.length > 1, "tabId/frameId", "nearest navigation in the same frame");
      }
    }
  }
}

function addPreflightRetryAndCacheEdges(
  network: EventRecord[],
  edges: Map<string, CorrelationEdge>,
): void {
  const sorted = [...network].sort((left, right) => timestamp(left) - timestamp(right) || eventIdFor(left).localeCompare(eventIdFor(right)));
  for (const record of sorted) {
    const entry = record.entry as NetworkEntry;
    if (entry.isPreflight) {
      const actual = sorted.filter((candidate) => {
        const candidateEntry = candidate.entry as NetworkEntry;
        return (
          candidate.node.id !== record.node.id &&
          !candidateEntry.isPreflight &&
          candidateEntry.url === entry.url &&
          sameScope(record, candidate) &&
          sameFrame(record, candidate) &&
          timestamp(candidate) >= timestamp(record) &&
          timestamp(candidate) - timestamp(record) <= CONSOLE_WINDOW_MS
        );
      });
      for (const candidate of actual) {
        addEdge(edges, record, candidate, "preflight", "supported", actual.length > 1, "Network.isPreflight + URL", "bounded same-target request correlation");
      }
    }

    const prior = sorted.filter((candidate) => {
      const candidateEntry = candidate.entry as NetworkEntry;
      return (
        candidate.node.id !== record.node.id &&
        candidateEntry.url === entry.url &&
        candidateEntry.method === entry.method &&
        sameScope(record, candidate) &&
        timestamp(candidate) < timestamp(record) &&
        timestamp(record) - timestamp(candidate) <= RETRY_WINDOW_MS &&
        ((entry.error != null || (entry.statusCode ?? 0) >= 400) &&
          (candidateEntry.error != null || (candidateEntry.statusCode ?? 0) >= 400))
      );
    });
    const previous = nearest(record, prior);
    if (previous) {
      addEdge(edges, previous, record, "retry", "heuristic", prior.length > 1, "method + URL + failure state", "nearby repeated failed request; inspect ambiguity");
    }

    if (entry.fromCache) {
      const cachedPrior = sorted.filter((candidate) => {
        const candidateEntry = candidate.entry as NetworkEntry;
        return (
          candidate.node.id !== record.node.id &&
          candidateEntry.url === entry.url &&
          candidateEntry.method === entry.method &&
          sameScope(record, candidate) &&
          timestamp(candidate) < timestamp(record)
        );
      });
      const source = nearest(record, cachedPrior);
      if (source) addEdge(edges, source, record, "cache", "supported", cachedPrior.length > 1, "Network.fromCache + method + URL", "prior matching request for cache hit");
    }
  }
}

function addConsoleEdges(
  network: EventRecord[],
  consoleRecords: EventRecord[],
  edges: Map<string, CorrelationEdge>,
): void {
  for (const consoleRecord of consoleRecords) {
    const consoleEntry = consoleRecord.entry as ConsoleEntry;
    if (!/(error|exception)/i.test(`${consoleEntry.level} ${consoleEntry.method ?? ""}`)) continue;
    const candidates = network.filter((networkRecord) => {
      const networkEntry = networkRecord.entry as NetworkEntry;
      const sameUrl = !consoleEntry.url || consoleEntry.url === networkEntry.url || consoleEntry.url === networkEntry.documentUrl;
      return sameScope(consoleRecord, networkRecord) && sameUrl && Math.abs(timestamp(consoleRecord) - timestamp(networkRecord)) <= CONSOLE_WINDOW_MS;
    });
    for (const candidate of candidates) {
      addEdge(edges, candidate, consoleRecord, "console-error", "heuristic", candidates.length > 1, "console URL/time proximity", "nearby error; relationship is not causal proof");
    }
  }
}

function addMarkerEdges(
  markerRecords: EventRecord[],
  network: EventRecord[],
  consoleRecords: EventRecord[],
  navigation: EventRecord[],
  edges: Map<string, CorrelationEdge>,
): void {
  for (const markerRecord of markerRecords) {
    const marker = markerRecord.entry as MarkerEntry;
    const networkCandidates = marker.nearestNetworkId
      ? network.filter((record) => record.node.eventId === marker.nearestNetworkId)
      : network.filter((record) => sameScope(markerRecord, record) && Math.abs(timestamp(markerRecord) - timestamp(record)) <= CONSOLE_WINDOW_MS);
    const consoleCandidates = marker.nearestConsoleId
      ? consoleRecords.filter((record) => record.node.eventId === marker.nearestConsoleId)
      : consoleRecords.filter((record) => sameScope(markerRecord, record) && Math.abs(timestamp(markerRecord) - timestamp(record)) <= CONSOLE_WINDOW_MS);
    const navigationCandidates = navigation.filter((record) => sameScope(markerRecord, record) && Math.abs(timestamp(markerRecord) - timestamp(record)) <= CONSOLE_WINDOW_MS);
    const nearestNetwork = marker.nearestNetworkId ? networkCandidates : [nearest(markerRecord, networkCandidates)].filter(Boolean) as EventRecord[];
    const nearestConsole = marker.nearestConsoleId ? consoleCandidates : [nearest(markerRecord, consoleCandidates)].filter(Boolean) as EventRecord[];
    const nearestNavigation = [nearest(markerRecord, navigationCandidates)].filter(Boolean) as EventRecord[];
    for (const target of [...nearestNetwork, ...nearestConsole, ...nearestNavigation]) {
      addEdge(
        edges,
        markerRecord,
        target,
        "marker-context",
        marker.nearestNetworkId === target.node.eventId || marker.nearestConsoleId === target.node.eventId ? "direct" : "heuristic",
        false,
        marker.nearestNetworkId === target.node.eventId
          ? "Marker.nearestNetworkId"
          : marker.nearestConsoleId === target.node.eventId
            ? "Marker.nearestConsoleId"
            : "marker timestamp and tab scope",
        "human-authored reproduction context",
      );
    }
  }
}

/** Build a deterministic graph from browser-provided IDs and explicitly bounded heuristics. */
export function buildCorrelationGraph(data: SessionData): CorrelationGraph {
  const network = records("network", data.network);
  const consoleRecords = records("console", data.console);
  const navigation = records("navigation", data.navigation);
  const markerRecords = records("marker", data.markers ?? []);
  const edges = new Map<string, CorrelationEdge>();

  addDirectNetworkEdges(network, edges);
  addDocumentAndFrameEdges(network, navigation, edges);
  addPreflightRetryAndCacheEdges(network, edges);
  addConsoleEdges(network, consoleRecords, edges);
  addMarkerEdges(markerRecords, network, consoleRecords, navigation, edges);

  const nodes = [...network, ...consoleRecords, ...navigation, ...markerRecords]
    .map((record) => record.node)
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
  return {
    schemaVersion: CORRELATION_GRAPH_SCHEMA_VERSION,
    nodes,
    edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}
