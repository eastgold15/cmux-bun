import { Value } from "typebox/value";
import type { AnsiParser } from "../core/parser/ansi-parser.js";
import type { TabInfoList, TabInfo } from "../contracts/mcp.js";
import {
  CreateTabRequestSchema,
  type CreateTabRequest,
  FocusTabRequestSchema,
  type FocusTabRequest,
  CloseTabRequestSchema,
  type SendInputRequest,
  SendInputRequestSchema,
  type GetTabOutputResponse,
} from "../contracts/rpc.js";

/**
 * Handlers 的运行时上下文 —— 由 main.ts 注入。
 * agents/ 不直接 import core/ 或 state/ 的具体实现，只通过这个接口访问。
 */
export interface AgentContext {
  getActiveTabId: () => string | null;
  getTabIds: () => string[];
  getTabName: (id: string) => string;
  getTabCwd: (id: string) => string | undefined;
  createTab: (name: string, cwd?: string, shell?: string, existingId?: string) => string;
  removeTab: (id: string) => void;
  focusTab: (tabId: string) => void;
  splitPane: (targetId: string, direction: "horizontal" | "vertical") => void;
  sendInput: (tabId: string, data: string) => void;
  getParser: (tabId: string) => AnsiParser | undefined;
  getGitBranch: (cwd: string) => string | null;
  /** 向 Tab 状态机发送事件 */
  sendTabEvent: (tabId: string, event: Record<string, unknown>) => void;
  /** 创建 worktree 并自动创建对应 Tab */
  createWorktreeTab: (params: { branch: string; tabName?: string; baseTabId?: string }) => Promise<{ tabId: string; path: string; branch: string }>;
  /** 移除 worktree 并关闭对应 Tab */
  removeWorktreeTab: (tabId: string, force?: boolean) => Promise<{ ok: boolean }>;
  /** 判断 Tab 是否为 worktree */
  isWorktreeTab: (tabId: string) => boolean;
}

export function createHandlers(ctx: AgentContext) {
  return {
    list_tabs(): TabInfoList {
      const tabIds = ctx.getTabIds();
      const activeId = ctx.getActiveTabId();
      const tabs: TabInfo[] = tabIds.map((id) => {
        const cwd = ctx.getTabCwd(id) ?? process.cwd();
        return {
          id,
          name: ctx.getTabName(id),
          cwd,
          isActive: id === activeId,
          gitBranch: ctx.getGitBranch(cwd) ?? undefined,
          isWorktree: ctx.isWorktreeTab(id) || undefined,
        };
      });
      return { tabs, activeTabId: activeId ?? undefined };
    },

    create_tab(params: CreateTabRequest): string {
      if (!Value.Check(CreateTabRequestSchema, params)) {
        throw new Error("Invalid create_tab parameters");
      }
      return ctx.createTab(params.name, params.cwd, params.shell);
    },

    focus_tab(params: FocusTabRequest): { ok: boolean } {
      if (!Value.Check(FocusTabRequestSchema, params)) {
        throw new Error("Invalid focus_tab parameters");
      }
      ctx.focusTab(params.tabId);
      return { ok: true };
    },

    close_tab(params: { tabId: string }): { ok: boolean } {
      if (!Value.Check(CloseTabRequestSchema, params)) {
        throw new Error("Invalid close_tab parameters");
      }
      ctx.removeTab(params.tabId);
      return { ok: true };
    },

    split_pane(params: { targetTabId?: string; direction: "horizontal" | "vertical" }): { ok: boolean } {
      const targetId = params.targetTabId ?? ctx.getActiveTabId();
      if (!targetId) throw new Error("No active tab to split");
      ctx.splitPane(targetId, params.direction);
      return { ok: true };
    },

    send_input(params: SendInputRequest): { ok: boolean } {
      if (!Value.Check(SendInputRequestSchema, params)) {
        throw new Error("Invalid send_input parameters");
      }
      ctx.sendInput(params.tabId, params.data);
      return { ok: true };
    },

    get_tab_output(params: { tabId?: string; lines?: number }): GetTabOutputResponse {
      const tabId = params.tabId ?? ctx.getActiveTabId();
      if (!tabId) throw new Error("No active tab");
      const parser = ctx.getParser(tabId);
      if (!parser) throw new Error(`Tab ${tabId} not found`);
      const allRows = parser.getRows();
      const count = params.lines ?? 50;
      const lines = allRows.slice(-count);
      const cwd = ctx.getTabCwd(tabId) ?? process.cwd();
      return {
        lines,
        cwd,
        gitBranch: ctx.getGitBranch(cwd) ?? undefined,
      };
    },

    /** 获取 Git 上下文坐标（分支名 + cwd），不提供具体 diff */
    get_git_context(params: { tabId?: string }): { branch: string | null; cwd: string } {
      const tabId = params.tabId ?? ctx.getActiveTabId();
      const cwd = tabId ? (ctx.getTabCwd(tabId) ?? process.cwd()) : process.cwd();
      return { branch: ctx.getGitBranch(cwd), cwd };
    },

    // ─── Agent Lifecycle 通知 ───

    notify_lifecycle_started(params: { tabId?: string; task: string }): { ok: boolean } {
      const tabId = params.tabId ?? ctx.getActiveTabId();
      if (!tabId) throw new Error("No active tab");
      ctx.sendTabEvent(tabId, { type: "AGENT_STARTED", task: params.task });
      return { ok: true };
    },

    notify_lifecycle_completed(params: { tabId?: string; summary?: string }): { ok: boolean } {
      const tabId = params.tabId ?? ctx.getActiveTabId();
      if (!tabId) throw new Error("No active tab");
      ctx.sendTabEvent(tabId, { type: "AGENT_COMPLETED", summary: params.summary });
      return { ok: true };
    },

    notify_lifecycle_error(params: { tabId?: string; error: string }): { ok: boolean } {
      const tabId = params.tabId ?? ctx.getActiveTabId();
      if (!tabId) throw new Error("No active tab");
      ctx.sendTabEvent(tabId, { type: "AGENT_ERROR", error: params.error });
      return { ok: true };
    },

    // ─── Worktree 管理 ───

    async create_worktree(params: { branch: string; tabName?: string; baseTabId?: string }): Promise<{ tabId: string; path: string; branch: string }> {
      return ctx.createWorktreeTab(params);
    },

    async remove_worktree(params: { tabId: string; force?: boolean }): Promise<{ ok: boolean }> {
      return ctx.removeWorktreeTab(params.tabId, params.force);
    },
  };
}
