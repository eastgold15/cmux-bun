import { Type } from "typebox";
import type { Static } from "typebox";

export const TerminalInstanceOptionsSchema = Type.Object({
  shell: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
  cols: Type.Optional(Type.Number()),
  rows: Type.Optional(Type.Number()),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
});
export type TerminalInstanceOptions = Static<typeof TerminalInstanceOptionsSchema>;

export const CellSchema = Type.Object({
  char: Type.String(),
  fg: Type.String(),
  bg: Type.String(),
  bold: Type.Boolean(),
  underline: Type.Boolean(),
  width: Type.Number(),
});
export type Cell = Static<typeof CellSchema>;
