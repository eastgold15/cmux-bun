import { Type } from "typebox";
import type { Static } from "typebox";

// ─── MCP Tool Parameter Schemas ───

export const ListTabsParamsSchema = Type.Object({});

export const CreateTabParamsSchema = Type.Object({
  name: Type.Optional(Type.String({ description: "Tab 名称", default: "Terminal" })),
  cwd: Type.Optional(Type.String({ description: "工作目录" })),
  shell: Type.Optional(Type.String({ description: "Shell 可执行文件" })),
});
export type CreateTabParams = Static<typeof CreateTabParamsSchema>;

export const CloseTabParamsSchema = Type.Object({
  tabId: Type.String({ description: "要关闭的 Tab ID" }),
});
export type CloseTabParams = Static<typeof CloseTabParamsSchema>;

export const FocusTabParamsSchema = Type.Object({
  tabId: Type.String({ description: "要聚焦的 Tab ID" }),
});
export type FocusTabParams = Static<typeof FocusTabParamsSchema>;

export const SplitPaneParamsSchema = Type.Object({
  targetTabId: Type.Optional(Type.String({ description: "要分屏的 Tab，默认为当前活跃 Tab" })),
  direction: Type.Union([
    Type.Literal("horizontal"),
    Type.Literal("vertical"),
  ], { description: "分屏方向" }),
});
export type SplitPaneParams = Static<typeof SplitPaneParamsSchema>;

export const ReadTabOutputParamsSchema = Type.Object({
  tabId: Type.Optional(Type.String({ description: "Tab ID，省略则使用当前活跃 Tab" })),
  lines: Type.Optional(Type.Number({ description: "返回的最近行数", default: 50 })),
});
export type ReadTabOutputParams = Static<typeof ReadTabOutputParamsSchema>;

export const SendTerminalInputParamsSchema = Type.Object({
  tabId: Type.Optional(Type.String()),
  text: Type.String({ description: "输入到终端的文本" }),
  pressEnter: Type.Optional(Type.Boolean({ description: "是否追加回车", default: false })),
});
export type SendTerminalInputParams = Static<typeof SendTerminalInputParamsSchema>;

export const GetGitStatusParamsSchema = Type.Object({
  tabId: Type.Optional(Type.String()),
});
export type GetGitStatusParams = Static<typeof GetGitStatusParamsSchema>;

// ─── Tab Info (MCP 返回结构) ───

export const TabInfoSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  cwd: Type.String(),
  isActive: Type.Boolean(),
  gitBranch: Type.Optional(Type.String()),
});
export type TabInfo = Static<typeof TabInfoSchema>;

export const TabInfoListSchema = Type.Object({
  tabs: Type.Array(TabInfoSchema),
  activeTabId: Type.Optional(Type.String()),
});
export type TabInfoList = Static<typeof TabInfoListSchema>;

// ─── Agent Lifecycle 通知参数 ───

export const NotifyStartedParamsSchema = Type.Object({
  tabId: Type.Optional(Type.String({ description: "目标 Tab，默认当前活跃" })),
  task: Type.String({ description: "任务描述，如 'refactoring layout module'" }),
});
export type NotifyStartedParams = Static<typeof NotifyStartedParamsSchema>;

export const NotifyCompletedParamsSchema = Type.Object({
  tabId: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String({ description: "完成摘要" })),
});
export type NotifyCompletedParams = Static<typeof NotifyCompletedParamsSchema>;

export const NotifyErrorParamsSchema = Type.Object({
  tabId: Type.Optional(Type.String()),
  error: Type.String({ description: "错误信息" }),
});
export type NotifyErrorParams = Static<typeof NotifyErrorParamsSchema>;
