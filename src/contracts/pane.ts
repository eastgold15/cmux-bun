import { Type } from "typebox";
import type { Static } from "typebox";

export const PaneStateSchema = Type.Object({
  id: Type.String(),
  tabId: Type.String(),
  cwd: Type.String(),
  splitDirection: Type.Union([Type.Literal("horizontal"), Type.Literal("vertical")]),
  splitRatio: Type.Number({ default: 0.5 }),
});
export type PaneState = Static<typeof PaneStateSchema>;
