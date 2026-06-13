export const MessageType = {
  GET_STATE: "GET_STATE",
  START_CAPTURE: "START_CAPTURE",
  STOP_AND_EXPORT: "STOP_AND_EXPORT",
  EXPORT_CAPTURE: "EXPORT_CAPTURE",
  DISCARD_CAPTURE: "DISCARD_CAPTURE",
  CONSENT_AND_START: "CONSENT_AND_START",
} as const;

export type MessageTypeName = (typeof MessageType)[keyof typeof MessageType];

export interface PopupStateResponse {
  session: import("./types.js").CaptureSession | null;
  counts: {
    network: number;
  };
  canExport: boolean;
}

export interface ExportEntityCounts {
  network: number;
  posts: number;
  comments: number;
  reactions: number;
}

export interface ExportZipResponse {
  ok: boolean;
  error?: string;
  zipBase64?: string;
  filename?: string;
  counts?: ExportEntityCounts;
}
