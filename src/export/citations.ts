import type { CitationArtifact, EvidenceCitation } from "../shared/types.js";

export const EVIDENCE_CITATION_SCHEMA_VERSION = 1 as const;

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

export function buildEvidenceCitation(
  bundleId: string,
  artifact: CitationArtifact,
  eventId: string,
  schemaVersion: number,
): EvidenceCitation {
  return {
    schemaVersion: EVIDENCE_CITATION_SCHEMA_VERSION,
    bundleId,
    artifact,
    eventId,
    address: `browser-listener://${encodePart(bundleId)}/${encodePart(artifact)}/${encodePart(eventId)}?schema=${schemaVersion}`,
  };
}

export function buildBundleCitation(bundleId: string, schemaVersion: number): string {
  return `browser-listener://${encodePart(bundleId)}?schema=${schemaVersion}`;
}
