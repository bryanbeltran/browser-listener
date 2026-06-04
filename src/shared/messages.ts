export const MessageType = {
  GET_STATE: "GET_STATE",
  START_CAPTURE: "START_CAPTURE",
  STOP_CAPTURE: "STOP_CAPTURE",
  CLEAR_LOGS: "CLEAR_LOGS",
  EXPORT_LOGS: "EXPORT_LOGS",
  CONSOLE_LOG: "CONSOLE_LOG",
  CAPTURE_STATE_CHANGED: "CAPTURE_STATE_CHANGED",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export interface GetStateResponse {
  session: import("./types.js").CaptureSession | null;
  consoleCount: number;
  networkCount: number;
}

export interface CaptureStateChanged {
  active: boolean;
  sessionId: string | null;
}
