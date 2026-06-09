export const MessageType = {
  GET_STATE: "GET_STATE",
  START_CAPTURE: "START_CAPTURE",
  STOP_AND_EXPORT: "STOP_AND_EXPORT",
  CONSENT_AND_START: "CONSENT_AND_START",
  RECORD_EVENT: "RECORD_EVENT",
  CAPTURE_STATE_CHANGED: "CAPTURE_STATE_CHANGED",
} as const;

export type MessageTypeName = (typeof MessageType)[keyof typeof MessageType];

export interface PopupStateResponse {
  session: import("./types.js").CaptureSession | null;
  counts: {
    console: number;
    network: number;
    userActions: number;
    timeline: number;
  };
  canExport: boolean;
}
