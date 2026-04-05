export interface TabState {
  id: string;
  name: string;
  cwd: string;
  isBusy: boolean;
  hasAlert: boolean;
  lastOutput: string[];
}

export interface PaneState {
  id: string;
  tabId: string;
  cwd: string;
  splitDirection: "horizontal" | "vertical";
  splitRatio: number;
}

export type TabEvent =
  | { type: "DATA_RECEIVED"; data: string }
  | { type: "PROCESS_EXITED"; code: number }
  | { type: "USER_INPUT"; key: string }
  | { type: "DETECT_NOTIFY_SIGNAL" };
