export const MessageType = {
  GET_STATE: "GET_STATE",
  START_CAPTURE: "START_CAPTURE",
  STOP_AND_EXPORT: "STOP_AND_EXPORT",
  DISCARD_CAPTURE: "DISCARD_CAPTURE",
  CONSENT_AND_START: "CONSENT_AND_START",
  SET_REDACTION: "SET_REDACTION",
  SET_REDACTION_CONFIG: "SET_REDACTION_CONFIG",
  RESET_REDACTION_CONFIG: "RESET_REDACTION_CONFIG",
  GET_REDACTION_PREVIEW: "GET_REDACTION_PREVIEW",
  ADD_MARKER: "ADD_MARKER",
  PAUSE_CAPTURE: "PAUSE_CAPTURE",
  RESUME_CAPTURE: "RESUME_CAPTURE",
} as const;

export type MessageTypeName = (typeof MessageType)[keyof typeof MessageType];

export interface PopupStateResponse {
  session: import("./types.js").PopupSessionView | null;
  counts: import("./types.js").PopupCounts;
  canExport: boolean;
  redactionEnabled: boolean;
  redactionConfig?: import("./types.js").RedactionConfig;
}

export interface ExportEntityCounts {
  network: number;
  navigation: number;
  console: number;
  markers?: number;
  requestBodies: number;
  responseBodies: number;
}

export interface ExportZipResponse {
  ok: boolean;
  error?: string;
  zipBase64?: string;
  filename?: string;
  counts?: ExportEntityCounts;
}
