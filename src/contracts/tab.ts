import { Type } from "typebox";
import type { Static } from "typebox";

// ─── TabState ───

export const TabStateSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  cwd: Type.String(),
  isBusy: Type.Boolean({ default: false }),
  hasAlert: Type.Boolean({ default: false }),
  lastOutput: Type.Array(Type.String(), { default: [] }),
});
export type TabState = Static<typeof TabStateSchema>;

// ─── TabContext (XState tab machine) ───

export const TabContextSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  cwd: Type.String(),
  lastOutput: Type.Array(Type.String()),
});
export type TabContext = Static<typeof TabContextSchema>;

// ─── TabEvent ───

export const TabEventSchema = Type.Union([
  Type.Object({ type: Type.Literal("DATA_RECEIVED"), data: Type.String() }),
  Type.Object({ type: Type.Literal("PROCESS_EXITED"), code: Type.Number() }),
  Type.Object({ type: Type.Literal("USER_INPUT"), key: Type.String() }),
  Type.Object({ type: Type.Literal("DETECT_NOTIFY_SIGNAL") }),
  // Agent Lifecycle 事件
  Type.Object({ type: Type.Literal("AGENT_STARTED"), task: Type.String() }),
  Type.Object({ type: Type.Literal("AGENT_COMPLETED"), summary: Type.Optional(Type.String()) }),
  Type.Object({ type: Type.Literal("AGENT_ERROR"), error: Type.String() }),
  Type.Object({ type: Type.Literal("AGENT_ACK") }),
]);
export type TabEvent = Static<typeof TabEventSchema>;

// ─── AgentLifecycle ───

export type AgentLifecycle = "idle" | "busy" | "success" | "error";
