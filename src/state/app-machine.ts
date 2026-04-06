import { createMachine, assign, createActor } from "xstate";
import type { LayoutNode } from "../core/layout/layout-tree.js";

export interface AppContext {
  activeTabId: string | null;
  tabIds: string[];
  // 分屏布局：leaf 的 tabId 与 tabIds 一致
  layoutRoot: LayoutNode | null;
  focusedPaneId: string | null;
}

type AppEvent =
  | { type: "ADD_TAB"; tabId: string }
  | { type: "REMOVE_TAB"; tabId: string }
  | { type: "SWITCH_TAB"; tabId: string }
  | { type: "SWITCH_TAB_INDEX"; index: number }
  | { type: "SPLIT_PANE"; targetTabId: string; newTabId: string; direction: "horizontal" | "vertical"; ratio?: number }
  | { type: "CLOSE_PANE"; tabId: string }
  | { type: "FOCUS_PANE"; tabId: string }
  | { type: "SET_LAYOUT"; layoutRoot: LayoutNode };

export const appMachine = createMachine({
  id: "app",
  initial: "running",
  context: {
    activeTabId: null as string | null,
    tabIds: [] as string[],
    layoutRoot: null as LayoutNode | null,
    focusedPaneId: null as string | null,
  },
  states: {
    running: {
      on: {
        ADD_TAB: {
          actions: assign({
            tabIds: ({ context, event }) => [...context.tabIds, event.tabId],
            activeTabId: ({ context, event }) =>
              context.activeTabId ?? event.tabId,
            focusedPaneId: ({ context, event }) =>
              context.focusedPaneId ?? event.tabId,
          }),
        },
        REMOVE_TAB: {
          actions: assign({
            tabIds: ({ context, event }) =>
              context.tabIds.filter((id) => id !== event.tabId),
            activeTabId: ({ context, event }) => {
              if (context.activeTabId !== event.tabId) return context.activeTabId;
              const remaining = context.tabIds.filter((id) => id !== event.tabId);
              return remaining[0] ?? null;
            },
            focusedPaneId: ({ context, event }) => {
              if (context.focusedPaneId !== event.tabId) return context.focusedPaneId;
              const remaining = context.tabIds.filter((id) => id !== event.tabId);
              return remaining[0] ?? null;
            },
          }),
        },
        SWITCH_TAB: {
          actions: assign({
            activeTabId: ({ event }) => event.tabId,
            focusedPaneId: ({ event }) => event.tabId,
          }),
        },
        SWITCH_TAB_INDEX: {
          actions: assign({
            activeTabId: ({ context, event }) =>
              context.tabIds[event.index] ?? context.activeTabId,
            focusedPaneId: ({ context, event }) =>
              context.tabIds[event.index] ?? context.focusedPaneId,
          }),
        },
        SPLIT_PANE: {
          actions: assign({
            tabIds: ({ context, event }) => [...context.tabIds, event.newTabId],
            focusedPaneId: ({ event }) => event.newTabId,
          }),
        },
        CLOSE_PANE: {
          actions: assign({
            tabIds: ({ context, event }) =>
              context.tabIds.filter((id) => id !== event.tabId),
            focusedPaneId: ({ context, event }) => {
              if (context.focusedPaneId !== event.tabId) return context.focusedPaneId;
              const remaining = context.tabIds.filter((id) => id !== event.tabId);
              return remaining[0] ?? null;
            },
          }),
        },
        FOCUS_PANE: {
          actions: assign({
            focusedPaneId: ({ event }) => event.tabId,
          }),
        },
        SET_LAYOUT: {
          actions: assign({
            layoutRoot: ({ event }) => event.layoutRoot,
          }),
        },
      },
    },
  },
});

export function createAppActor() {
  return createActor(appMachine);
}
