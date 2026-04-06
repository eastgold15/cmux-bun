import { Type } from "typebox";
import type { Static } from "typebox";

// ─── RPC Request / Response Schemas ───

export const CreateTabRequestSchema = Type.Object({
  name: Type.String(),
  cwd: Type.Optional(Type.String()),
  shell: Type.Optional(Type.String()),
});
export type CreateTabRequest = Static<typeof CreateTabRequestSchema>;

export const CreateTabResponseSchema = Type.Object({
  tabId: Type.String(),
});
export type CreateTabResponse = Static<typeof CreateTabResponseSchema>;

export const FocusTabRequestSchema = Type.Object({
  tabId: Type.String(),
});
export type FocusTabRequest = Static<typeof FocusTabRequestSchema>;

export const CloseTabRequestSchema = Type.Object({
  tabId: Type.String(),
});
export type CloseTabRequest = Static<typeof CloseTabRequestSchema>;

export const ListTabsResponseSchema = Type.Array(Type.String());
export type ListTabsResponse = Static<typeof ListTabsResponseSchema>;

export const OkResponseSchema = Type.Object({ ok: Type.Boolean() });
export type OkResponse = Static<typeof OkResponseSchema>;

export const SendInputRequestSchema = Type.Object({
  tabId: Type.String(),
  data: Type.String(),
});
export type SendInputRequest = Static<typeof SendInputRequestSchema>;

export const GetTabOutputRequestSchema = Type.Object({
  tabId: Type.Optional(Type.String()),
  lines: Type.Optional(Type.Number({ default: 50 })),
});
export type GetTabOutputRequest = Static<typeof GetTabOutputRequestSchema>;

export const GetTabOutputResponseSchema = Type.Object({
  lines: Type.Array(Type.String()),
  cwd: Type.String(),
  gitBranch: Type.Optional(Type.String()),
});
export type GetTabOutputResponse = Static<typeof GetTabOutputResponseSchema>;

// ─── Worktree RPC Schemas ───

export const CreateWorktreeRequestSchema = Type.Object({
  branch: Type.String(),
  tabName: Type.Optional(Type.String()),
  baseTabId: Type.Optional(Type.String()),
});
export type CreateWorktreeRequest = Static<typeof CreateWorktreeRequestSchema>;

export const RemoveWorktreeRequestSchema = Type.Object({
  tabId: Type.String(),
  force: Type.Optional(Type.Boolean({ default: false })),
});
export type RemoveWorktreeRequest = Static<typeof RemoveWorktreeRequestSchema>;
