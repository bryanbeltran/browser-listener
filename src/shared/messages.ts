export const MessageType = {
  GET_STATE: "GET_STATE",
  START_CAPTURE: "START_CAPTURE",
  STOP_AND_EXPORT: "STOP_AND_EXPORT",
  DISCARD_CAPTURE: "DISCARD_CAPTURE",
  CONSENT_AND_START: "CONSENT_AND_START",
  SET_REDACTION: "SET_REDACTION",
} as const;

export type MessageTypeName = (typeof MessageType)[keyof typeof MessageType];

export interface PopupStateResponse {
  session: import("./types.js").PopupSessionView | null;
  counts: import("./types.js").PopupCounts;
  canExport: boolean;
  redactionEnabled: boolean;
}

export interface ExportEntityCounts {
  network: number;
  navigation: number;
  console: number;
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
